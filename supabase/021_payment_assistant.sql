-- 021: Qəşəm üçün ayrıca hesab, yalnız dərsləri oxumaq və aylıq ödənişi qeyd etmək.
create table if not exists public.payment_assistants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'Qəşəm' check (char_length(display_name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (user_id <> teacher_id)
);
create table if not exists public.assistant_payment_log (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  student_id uuid not null,
  student_name text not null,
  payment_id uuid not null,
  billing_month date not null,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now()
);
alter table public.payment_assistants enable row level security;
alter table public.assistant_payment_log enable row level security;
revoke all on public.payment_assistants, public.assistant_payment_log from anon, authenticated;
grant select on public.payment_assistants, public.assistant_payment_log to authenticated;
drop policy if exists "owner reads assistants" on public.payment_assistants;
create policy "owner reads assistants" on public.payment_assistants for select to authenticated using (teacher_id=auth.uid());
drop policy if exists "owner reads assistant log" on public.assistant_payment_log;
create policy "owner reads assistant log" on public.assistant_payment_log for select to authenticated using (teacher_id=auth.uid());

create or replace function public.payment_assistant_access()
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce((select jsonb_build_object('role','payment_assistant','name',a.display_name,'active',a.active and t.approved)
 from payment_assistants a join teacher_access t on t.user_id=a.teacher_id where a.user_id=auth.uid()),'null'::jsonb);
$$;

create or replace function public.set_payment_assistant(p_email text,p_name text default 'Qəşəm',p_active boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if not public.is_approved() or exists(select 1 from payment_assistants where user_id=auth.uid()) then raise exception 'Yalnız müəllim'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 80 or p_active is null then raise exception 'Ad və icazə düzgün deyil'; end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email));
 if target is null then raise exception 'Bu e-poçtla hesab yoxdur. Əvvəl Supabase Authentication bölməsində ayrıca hesab yaradın.'; end if;
 if target=auth.uid() then raise exception 'Öz hesabınızı köməkçi edə bilməzsiniz'; end if;
 perform 1 from teacher_access where user_id=target for update;
 if exists(select 1 from teacher_access where user_id=target and (approved or is_admin)) or exists(select 1 from classes where teacher_id=target) or exists(select 1 from questions where teacher_id=target) then raise exception 'Ayrıca, müəllim kimi təsdiqlənməmiş hesab seçin'; end if;
 insert into payment_assistants(user_id,teacher_id,email,display_name,active) values(target,auth.uid(),lower(trim(p_email)),trim(p_name),p_active)
 on conflict(user_id) do update set display_name=excluded.display_name,active=excluded.active where payment_assistants.teacher_id=auth.uid();
 if not found then raise exception 'Bu hesab başqa müəllimə bağlıdır'; end if;
end;
$$;

create or replace function public.payment_assistant_ledger(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare owner_id uuid; result jsonb; start_month date;
begin
 select a.teacher_id into owner_id from payment_assistants a join teacher_access t on t.user_id=a.teacher_id where a.user_id=auth.uid() and a.active and t.approved;
 if owner_id is null then raise exception 'Giriş icazəsi yoxdur'; end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<date '2000-01-01' or p_month>date '2100-01-01' then raise exception 'Ay düzgün deyil'; end if;
 start_month:=date_trunc('month',now() at time zone 'Asia/Baku')::date;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name,'class_name',c.name,'monthly_fee',s.lesson_price,'pay_day',s.pay_day,
 'next_month',(coalesce(date_trunc('month',s.billing_start)::date,start_month)+make_interval(months=>case when s.lesson_price>0 then least(1200,floor(p.total/s.lesson_price))::int else 0 end))::date,
 'remaining',case when s.lesson_price>0 then s.lesson_price-mod(p.total,s.lesson_price) else 0 end,
 'lessons',(select coalesce(jsonb_agg(jsonb_build_object('date',l.lesson_date,'status',l.status,'topic',l.topic) order by l.lesson_date desc),'[]'::jsonb) from lessons l where l.teacher_id=owner_id and l.student_id=s.id and l.lesson_date>=p_month and l.lesson_date<(p_month+interval '1 month'))
 ) order by s.full_name),'[]'::jsonb) into result
 from students s join classes c on c.id=s.class_id
 cross join lateral(select coalesce(sum(amount),0)::numeric as total from payments where teacher_id=owner_id and student_id=s.id) p
 where c.teacher_id=owner_id;
 return jsonb_build_object('students',result);
end;
$$;

create or replace function public.payment_assistant_mark(p_student uuid,p_month date,p_expected_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a payment_assistants%rowtype; s students%rowtype; total numeric; due numeric; next_month date; pay_id uuid;
begin
 -- İcazəni bağlama ilə eyni anda gələn sorğular da kilidlə ardıcıllaşır.
 select * into a from payment_assistants where user_id=auth.uid() and active for share;
 if not found or not exists(select 1 from teacher_access where user_id=a.teacher_id and approved) then raise exception 'Giriş icazəsi yoxdur'; end if;
 select st.* into s from students st join classes c on c.id=st.class_id where st.id=p_student and c.teacher_id=a.teacher_id for update of st;
 if not found then raise exception 'Tələbə tapılmadı'; end if;
 if coalesce(s.lesson_price,0)<=0 then raise exception 'Aylıq məbləği müəllim təyin etməlidir'; end if;
 select coalesce(sum(amount),0) into total from payments where teacher_id=a.teacher_id and student_id=s.id;
 if floor(total/s.lesson_price)>1200 then raise exception 'Ödənişləri müəllim yoxlamalıdır'; end if;
 next_month:=(coalesce(date_trunc('month',s.billing_start)::date,date_trunc('month',now() at time zone 'Asia/Baku')::date)+make_interval(months=>floor(total/s.lesson_price)::int))::date;
 due:=s.lesson_price-mod(total,s.lesson_price);
 if p_month is distinct from next_month or p_expected_amount is distinct from due then raise exception 'Ödəniş vəziyyəti dəyişib. Siyahını yeniləyin.'; end if;
 if next_month>date_trunc('month',now() at time zone 'Asia/Baku')::date then raise exception 'Növbəti ayın ödənişini yalnız müəllim daxil edə bilər'; end if;
 insert into payments(teacher_id,student_id,amount,paid_on,note) values(a.teacher_id,s.id,due,(now() at time zone 'Asia/Baku')::date,a.display_name||' · '||to_char(next_month,'YYYY-MM')||' aylıq ödəniş') returning id into pay_id;
 insert into assistant_payment_log(teacher_id,actor_id,actor_name,student_id,student_name,payment_id,billing_month,amount) values(a.teacher_id,auth.uid(),a.display_name,s.id,s.full_name,pay_id,next_month,due);
 return jsonb_build_object('saved',true,'amount',due);
end;
$$;

-- Köməkçi sonradan təsadüfən müəllim/admin kimi təsdiqlənə bilməz.
create or replace function public.guard_payment_assistant_access()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.approved or new.is_admin) and exists(select 1 from payment_assistants where user_id=new.user_id) then raise exception 'Köməkçi hesabı müəllim və ya admin ola bilməz'; end if;
 return new;
end;
$$;
drop trigger if exists guard_payment_assistant_access on public.teacher_access;
create trigger guard_payment_assistant_access before insert or update on public.teacher_access for each row execute function public.guard_payment_assistant_access();
revoke execute on function public.payment_assistant_access(),public.set_payment_assistant(text,text,boolean),public.payment_assistant_ledger(date),public.payment_assistant_mark(uuid,date,numeric),public.guard_payment_assistant_access() from public,anon;
grant execute on function public.payment_assistant_access(),public.set_payment_assistant(text,text,boolean),public.payment_assistant_ledger(date),public.payment_assistant_mark(uuid,date,numeric) to authenticated;

-- Müəllimin daxil etdiyi ödənişlə eyni vaxtda gələn köməkçi sorğusunu da ardıcıllaşdır.
create or replace function public.lock_payment_student()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='DELETE' then perform 1 from students where id=old.student_id for update; return old; end if;
 perform 1 from students where id=new.student_id for update;
 return new;
end;
$$;
drop trigger if exists lock_payment_student on public.payments;
create trigger lock_payment_student before insert or update or delete on public.payments for each row execute function public.lock_payment_student();
revoke execute on function public.lock_payment_student() from public,anon,authenticated;

-- E-poçt dəyişsə də sahib hesabın sabit kimliyi ilə girişi bağlaya bilir.
create or replace function public.toggle_payment_assistant(p_user uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_approved() or p_active is null then raise exception 'Giriş icazəsi yoxdur'; end if;
 update payment_assistants set active=p_active where user_id=p_user and teacher_id=auth.uid();
 if not found then raise exception 'Köməkçi tapılmadı'; end if;
end;
$$;
revoke execute on function public.toggle_payment_assistant(uuid,boolean) from public,anon;
grant execute on function public.toggle_payment_assistant(uuid,boolean) to authenticated;
