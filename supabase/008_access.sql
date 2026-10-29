-- Müəllim+ · 8-ci yeniləmə: müəllim təsdiqi, AI xərc limitləri, admin
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run
-- Mövcud müəllimlər avtomatik təsdiqlənir; ən əvvəl qeydiyyatdan keçən hesab admin olur.

create table if not exists public.teacher_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  approved boolean not null default false,
  is_admin boolean not null default false,
  daily_limit_usd numeric(10, 2) not null default 2,
  monthly_limit_usd numeric(10, 2) not null default 20,
  note text,
  created_at timestamptz not null default now()
);
alter table public.teacher_access enable row level security;

-- Admin yoxlaması (RLS içində dövrə düşməsin deyə security definer)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.teacher_access where user_id = auth.uid()), false);
$$;

drop policy if exists "read own access" on public.teacher_access;
create policy "read own access" on public.teacher_access for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin updates access" on public.teacher_access;
create policy "admin updates access" on public.teacher_access for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin bütün müəllimlərin AI xərcini görür (yalnız oxumaq)
drop policy if exists "admin reads usage" on public.ai_usage;
create policy "admin reads usage" on public.ai_usage for select to authenticated
  using (public.is_admin());

-- Yeni qeydiyyat → təsdiq gözləyən sətir
create or replace function public.handle_new_teacher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.teacher_access (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_access on auth.users;
create trigger on_auth_user_created_access after insert on auth.users
  for each row execute function public.handle_new_teacher();

-- Mövcud hesablar: təsdiqlənir; ən birinci hesab admin
insert into public.teacher_access (user_id, email, approved, created_at)
  select id, email, true, coalesce(created_at, now()) from auth.users
  on conflict (user_id) do nothing;
update public.teacher_access set is_admin = true
  where user_id = (select id from auth.users order by created_at nulls last limit 1)
    and not exists (select 1 from public.teacher_access where is_admin);

-- Server hər AI sorğusundan əvvəl çağırır: təsdiq və bu gün / bu ay xərc (Bakı vaxtı)
create or replace function public.ai_gate()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a public.teacher_access%rowtype;
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
begin
  select * into a from public.teacher_access where user_id = auth.uid();
  if not found then
    return jsonb_build_object('approved', false, 'registered', false);
  end if;
  return jsonb_build_object(
    'approved', a.approved, 'is_admin', a.is_admin, 'registered', true,
    'daily_limit', a.daily_limit_usd, 'monthly_limit', a.monthly_limit_usd,
    'today', coalesce((select sum(cost_usd) from public.ai_usage where teacher_id = a.user_id and created_at >= day_start), 0),
    'month', coalesce((select sum(cost_usd) from public.ai_usage where teacher_id = a.user_id and created_at >= month_start), 0)
  );
end;
$$;
revoke execute on function public.ai_gate() from public, anon;
grant execute on function public.ai_gate() to authenticated;

-- Admin üçün siyahı: müəllimlər və bu ayın xərci
create or replace function public.admin_teachers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
begin
  if not public.is_admin() then raise exception 'Yalnız admin'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'email', a.email, 'approved', a.approved, 'is_admin', a.is_admin,
      'daily_limit', a.daily_limit_usd, 'monthly_limit', a.monthly_limit_usd, 'note', a.note, 'created_at', a.created_at,
      'month', coalesce((select sum(cost_usd) from public.ai_usage u where u.teacher_id = a.user_id and u.created_at >= month_start), 0),
      'questions', (select count(*) from public.questions q where q.teacher_id = a.user_id),
      'students', (select count(*) from public.students s join public.classes c on c.id = s.class_id where c.teacher_id = a.user_id)
    ) order by a.approved, a.created_at desc)
    from public.teacher_access a
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_teachers() from public, anon;
grant execute on function public.admin_teachers() to authenticated;
