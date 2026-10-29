-- Müəllim+ · 006 + 007 + 008 birlikdə (təkrar işlətmək zərərsizdir)
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run


-- ================= 006_review.sql =================
-- Müəllim+ · 6-cı yeniləmə: şagird testdən sonra səhvlərini görür (müəllim icazəsi ilə)

-- never: göstərmə · after_submit: göndərən kimi · after_close: test bağlananda
alter table public.tests add column if not exists review_mode text not null default 'never'
  check (review_mode in ('never', 'after_submit', 'after_close'));

create or replace function public.review_allowed(t public.tests)
returns boolean language sql immutable as $$
  select t.review_mode = 'after_submit' or (t.review_mode = 'after_close' and not t.is_open);
$$;

create or replace function public.student_portal(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  cls public.classes%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into cls from public.classes where id = s.class_id;
  return jsonb_build_object(
    'name', s.full_name,
    'class', cls.name,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'is_open', t.is_open, 'created_at', t.created_at,
          'count', coalesce(array_length(t.question_ids, 1), 0),
          'review', public.review_allowed(t),
          'review_mode', t.review_mode,
          'result', (select jsonb_build_object('score', sub.score, 'total', sub.total, 'created_at', sub.created_at)
                     from public.submissions sub where sub.test_id = t.id and sub.student_id = s.id limit 1)
        ) order by t.created_at desc)
      from public.tests t
      where t.class_id = s.class_id and t.teacher_id = cls.teacher_id
        and (t.is_open or exists (select 1 from public.submissions x where x.test_id = t.id and x.student_id = s.id))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_get_test(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  done public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then return null; end if;
  select * into done from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name,
      'review', public.review_allowed(t), 'review_mode', t.review_mode,
      'result', jsonb_build_object('score', done.score, 'total', done.total, 'created_at', done.created_at));
  end if;
  if not t.is_open then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'closed', true);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'review_mode', t.review_mode,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Şagirdin öz işi: sual, onun cavabı, düzgün cavab və həll — yalnız icazə varsa
create or replace function public.student_review(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  sub public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then return null; end if;
  select * into sub from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if not found then return null; end if;
  if not public.review_allowed(t) then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', false, 'review_mode', t.review_mode);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', true,
    'score', sub.score, 'total', sub.total, 'answers', sub.answers,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures,
                           'answer', q.answer, 'solution', q.solution)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.student_portal(text) to anon, authenticated;
grant execute on function public.student_get_test(text, uuid) to anon, authenticated;
grant execute on function public.student_review(text, uuid) to anon, authenticated;

-- ================= 007_test_rules.sql =================
-- Müəllim+ · 7-ci yeniləmə: vaxt limiti, son tarix, qarışdırma, fərdi (bir şagirdə) test

alter table public.tests add column if not exists time_limit_min int check (time_limit_min between 1 and 300);
alter table public.tests add column if not exists due_at timestamptz;
alter table public.tests add column if not exists shuffle boolean not null default false;
alter table public.tests add column if not exists student_id uuid references public.students(id) on delete cascade;

alter table public.submissions add column if not exists late boolean not null default false;

-- Vaxtlı testdə şagirdin başlama anı
create table if not exists public.test_starts (
  test_id uuid not null references public.tests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (test_id, student_id)
);
alter table public.test_starts enable row level security;
drop policy if exists "read own test starts" on public.test_starts;
create policy "read own test starts" on public.test_starts for select to authenticated
  using (exists (select 1 from public.tests t where t.id = test_id and t.teacher_id = auth.uid()));

-- Fərdi testin sahibi həmin sinifdən olmalıdır
create or replace function public.check_test_student() returns trigger language plpgsql as $$
begin
  if new.student_id is not null and not exists (
    select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id) then
    raise exception 'Şagird bu sinifdə deyil';
  end if;
  return new;
end;
$$;
drop trigger if exists tests_student_check on public.tests;
create trigger tests_student_check before insert or update on public.tests
  for each row execute function public.check_test_student();

-- Şagird bu testi görə bilərmi (sinif + fərdi test)
create or replace function public.test_visible_to(t public.tests, s public.students)
returns boolean language sql immutable as $$
  select t.class_id = s.class_id and (t.student_id is null or t.student_id = s.id);
$$;

-- Son tarix keçibmi (2 dəqiqə möhlət)
create or replace function public.test_overdue(t public.tests)
returns boolean language sql stable as $$
  select t.due_at is not null and now() > t.due_at + interval '2 minutes';
$$;

create or replace function public.student_portal(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  cls public.classes%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into cls from public.classes where id = s.class_id;
  return jsonb_build_object(
    'name', s.full_name,
    'class', cls.name,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'is_open', t.is_open, 'created_at', t.created_at,
          'count', coalesce(array_length(t.question_ids, 1), 0),
          'review', public.review_allowed(t), 'review_mode', t.review_mode,
          'time_limit_min', t.time_limit_min, 'due_at', t.due_at, 'overdue', public.test_overdue(t),
          'personal', t.student_id is not null,
          'result', (select jsonb_build_object('score', sub.score, 'total', sub.total, 'created_at', sub.created_at)
                     from public.submissions sub where sub.test_id = t.id and sub.student_id = s.id limit 1)
        ) order by t.created_at desc)
      from public.tests t
      where public.test_visible_to(t, s) and t.teacher_id = cls.teacher_id
        and (t.is_open or exists (select 1 from public.submissions x where x.test_id = t.id and x.student_id = s.id))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_get_test(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  done public.submissions%rowtype;
  st timestamptz;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id;
  if not found or not public.test_visible_to(t, s) then return null; end if;
  select * into done from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name,
      'review', public.review_allowed(t), 'review_mode', t.review_mode,
      'result', jsonb_build_object('score', done.score, 'total', done.total, 'created_at', done.created_at));
  end if;
  if not t.is_open then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'closed', true);
  end if;
  if public.test_overdue(t) then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'overdue', true, 'due_at', t.due_at);
  end if;
  select started_at into st from public.test_starts where test_id = t.id and student_id = s.id;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'review_mode', t.review_mode,
    'time_limit_min', t.time_limit_min, 'due_at', t.due_at, 'shuffle', t.shuffle,
    'started_at', st, 'now', now(), 'seed', s.id,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Vaxtlı testə başlamaq: başlama anı bir dəfə yazılır
create or replace function public.student_start_test(p_code text, p_test_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  st timestamptz;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into t from public.tests where id = p_test_id;
  if not found or not public.test_visible_to(t, s) or not t.is_open then raise exception 'Bu test bağlıdır'; end if;
  if public.test_overdue(t) then raise exception 'Son tarix keçib'; end if;
  insert into public.test_starts (test_id, student_id) values (t.id, s.id) on conflict do nothing;
  select started_at into st from public.test_starts where test_id = t.id and student_id = s.id;
  return jsonb_build_object('started_at', st, 'now', now());
end;
$$;

create or replace function public.student_submit_test(p_code text, p_test_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  q record;
  st timestamptz;
  v_late boolean := false;
  v_score int := 0;
  v_total int := 0;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into t from public.tests where id = p_test_id;
  if not found or not public.test_visible_to(t, s) or not t.is_open then raise exception 'Bu test bağlıdır'; end if;
  if public.test_overdue(t) then raise exception 'Son tarix keçib, cavablar qəbul edilmir'; end if;
  if exists (select 1 from public.submissions where test_id = t.id and student_id = s.id) then
    raise exception 'Bu testi artıq göndərmisiniz';
  end if;
  if t.time_limit_min is not null then
    select started_at into st from public.test_starts where test_id = t.id and student_id = s.id;
    -- vaxt + 1 dəqiqə möhlətdən sonra göndərilən iş "gecikmiş" kimi qeyd olunur
    v_late := st is null or now() > st + make_interval(mins => t.time_limit_min + 1);
  end if;
  for q in select id, qtype, answer from public.questions where id = any(t.question_ids) and teacher_id = t.teacher_id loop
    if q.qtype = 'mcq' then
      v_total := v_total + 1;
      if lower(btrim(coalesce(p_answers ->> (q.id::text), ''))) = lower(btrim(q.answer)) then
        v_score := v_score + 1;
      end if;
    end if;
  end loop;
  insert into public.submissions (test_id, student_id, student_name, answers, score, total, late)
  values (t.id, s.id, s.full_name, coalesce(p_answers, '{}'::jsonb), v_score, v_total, v_late);
  return jsonb_build_object('score', v_score, 'total', v_total, 'late', v_late);
end;
$$;

create or replace function public.student_review(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  sub public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id;
  if not found or not public.test_visible_to(t, s) then return null; end if;
  select * into sub from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if not found then return null; end if;
  if not public.review_allowed(t) then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', false, 'review_mode', t.review_mode);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', true,
    'score', sub.score, 'total', sub.total, 'answers', sub.answers,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures,
                           'answer', q.answer, 'solution', q.solution)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Ümumi (ad seçməklə) link: fərdi test bu yolla açılmır; son tarix və qarışdırma nəzərə alınır
create or replace function public.get_test_for_student(p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t public.tests%rowtype;
begin
  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open or t.student_id is not null then return null; end if;
  if public.test_overdue(t) then
    return jsonb_build_object('id', t.id, 'title', t.title, 'overdue', true, 'due_at', t.due_at);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title,
    'time_limit_min', t.time_limit_min, 'due_at', t.due_at, 'shuffle', t.shuffle,
    'students', coalesce((select jsonb_agg(s.full_name order by s.full_name) from public.students s where s.class_id = t.class_id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_test(p_test_id uuid, p_student_name text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.tests%rowtype;
  q record;
  v_name text;
  v_score int := 0;
  v_total int := 0;
begin
  v_name := left(btrim(coalesce(p_student_name, '')), 80);
  if v_name = '' then raise exception 'Adınızı yazın'; end if;
  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open or t.student_id is not null then raise exception 'Bu test bağlıdır'; end if;
  if public.test_overdue(t) then raise exception 'Son tarix keçib, cavablar qəbul edilmir'; end if;
  for q in select id, qtype, answer from public.questions where id = any(t.question_ids) and teacher_id = t.teacher_id loop
    if q.qtype = 'mcq' then
      v_total := v_total + 1;
      if lower(btrim(coalesce(p_answers ->> (q.id::text), ''))) = lower(btrim(q.answer)) then
        v_score := v_score + 1;
      end if;
    end if;
  end loop;
  insert into public.submissions (test_id, student_name, answers, score, total)
  values (t.id, v_name, coalesce(p_answers, '{}'::jsonb), v_score, v_total);
  return jsonb_build_object('score', v_score, 'total', v_total);
end;
$$;

grant execute on function public.student_portal(text) to anon, authenticated;
grant execute on function public.student_get_test(text, uuid) to anon, authenticated;
grant execute on function public.student_start_test(text, uuid) to anon, authenticated;
grant execute on function public.student_submit_test(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.student_review(text, uuid) to anon, authenticated;
grant execute on function public.get_test_for_student(uuid) to anon, authenticated;
grant execute on function public.submit_test(uuid, text, jsonb) to anon, authenticated;

-- ================= 008_access.sql =================
-- Müəllim+ · 8-ci yeniləmə: müəllim təsdiqi, AI xərc limitləri, admin
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
