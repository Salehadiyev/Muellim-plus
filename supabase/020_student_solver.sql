-- Sualını soruş: tələbə kodu ilə server AI sorğusuna xərc rezervi.
-- Şəkil və həll bazada saxlanmır; yalnız xərc uçotu aparılır.
create table if not exists public.student_ai_tickets (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete cascade,
 usage_id bigint not null unique references public.ai_usage(id) on delete cascade,
 finished boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.student_ai_tickets enable row level security;
revoke all on public.student_ai_tickets from public,anon,authenticated;

create or replace function public.student_ai_reserve(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype; a public.teacher_access%rowtype; teacher uuid; u bigint; ticket uuid; used int;
 d timestamptz := date_trunc('day',now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
 m timestamptz := date_trunc('month',now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
begin
 select * into s from public.students where access_code=upper(btrim(coalesce(p_code,'')));
 if not found then raise exception 'Tələbə linki etibarsızdır'; end if;
 select teacher_id into teacher from public.classes where id=s.class_id;
 perform pg_advisory_xact_lock(hashtextextended(teacher::text,20));
 select count(*) into used from public.student_ai_tickets where student_id=s.id and created_at>=d;
 if used>=3 then raise exception 'Gündəlik 3 sual limitin dolub. Bakı vaxtı ilə 00:00-da yenilənəcək'; end if;
 select * into a from public.teacher_access where user_id=teacher;
 if not found or not a.approved then raise exception 'AI istifadəsi aktiv deyil'; end if;
 -- Paralel sorğular da rezervi görür; itən sorğular rezervi saxlayır.
 if coalesce((select sum(cost_usd) from public.ai_usage where teacher_id=teacher and created_at>=d),0)+0.25>a.daily_limit_usd
 or coalesce((select sum(cost_usd) from public.ai_usage where teacher_id=teacher and created_at>=m),0)+0.25>a.monthly_limit_usd then
  raise exception 'AI xərc limiti dolub. Müəlliminizlə əlaqə saxlayın';
 end if;
 insert into public.ai_usage(teacher_id,action,model,for_model,role,cost_usd) values(teacher,'student_solve','gpt-sol','gpt-sol','main',0.25) returning id into u;
 insert into public.student_ai_tickets(student_id,usage_id) values(s.id,u) returning id into ticket;
 return jsonb_build_object('ticket',ticket,'remaining',2-used);
end $$;

create or replace function public.student_ai_finish(p_ticket uuid,p_input int,p_output int,p_cost numeric)
returns void language plpgsql security definer set search_path=public as $$
declare t public.student_ai_tickets%rowtype;
begin
 if p_input is null or p_output is null or p_cost is null or p_input<0 or p_output<0 or p_cost<0 or p_cost>10 then raise exception 'Yanlış xərc'; end if;
 select * into t from public.student_ai_tickets where id=p_ticket for update;
 if not found or t.finished then raise exception 'Sorğu tapılmadı və ya tamamlanıb'; end if;
 update public.ai_usage set input_tokens=p_input,output_tokens=p_output,cost_usd=p_cost where id=t.usage_id;
 update public.student_ai_tickets set finished=true where id=t.id;
end $$;
revoke all on function public.student_ai_reserve(text),public.student_ai_finish(uuid,int,int,numeric) from public;
grant execute on function public.student_ai_reserve(text),public.student_ai_finish(uuid,int,int,numeric) to anon,authenticated;

-- Tələbəyə yalnız öz qalan sual sayı görünür; rezerv tokeni göstərilmir.
create or replace function public.student_ai_allowance(p_code text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s public.students%rowtype;
 d timestamptz := date_trunc('day',now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
begin
 select * into s from public.students where access_code=upper(btrim(coalesce(p_code,'')));
 if not found then raise exception 'Tələbə linki etibarsızdır'; end if;
 return jsonb_build_object('remaining',greatest(0,3-(select count(*) from public.student_ai_tickets where student_id=s.id and created_at>=d)), 'limit',3,'resets_at',d+interval '1 day');
end $$;
revoke all on function public.student_ai_allowance(text) from public;
grant execute on function public.student_ai_allowance(text) to anon,authenticated;
