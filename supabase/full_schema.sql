-- Müəllim+ · TAM SXEM (avtomatik yaradılıb: build-full.sh). Əl ilə dəyişməyin.
-- Yeni Supabase layihəsi üçün: SQL Editor → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.

-- ================= schema.sql =================
-- Müəllim+ verilənlər bazası
-- Supabase-də: SQL Editor → New query → bu faylın hamısını yapışdır → Run

create extension if not exists pgcrypto;

-- ===== Cədvəllər =====

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  grade int check (grade between 1 and 12),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text,
  grade int check (grade between 1 and 12),
  difficulty text not null default 'orta' check (difficulty in ('asan', 'orta', 'çətin')),
  qtype text not null default 'mcq' check (qtype in ('mcq', 'open')),
  body text not null,
  options jsonb not null default '[]'::jsonb,
  answer text not null,
  solution text,
  source text not null default 'manual' check (source in ('ai', 'book', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  question_ids uuid[] not null default '{}',
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  student_name text not null,
  answers jsonb not null default '{}'::jsonb,
  score int not null default 0,
  total int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists students_class_idx on public.students(class_id);
create index if not exists questions_teacher_idx on public.questions(teacher_id, created_at desc);
create index if not exists tests_teacher_idx on public.tests(teacher_id, created_at desc);
create index if not exists submissions_test_idx on public.submissions(test_id);

-- ===== Təhlükəsizlik: hər müəllim yalnız öz məlumatını görür =====

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.questions enable row level security;
alter table public.tests enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "own classes" on public.classes;
create policy "own classes" on public.classes for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists "own students" on public.students;
create policy "own students" on public.students for all to authenticated
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()));

drop policy if exists "own questions" on public.questions;
create policy "own questions" on public.questions for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists "own tests" on public.tests;
create policy "own tests" on public.tests for all to authenticated
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid()
    and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
  );

drop policy if exists "read own submissions" on public.submissions;
create policy "read own submissions" on public.submissions for select to authenticated
  using (exists (select 1 from public.tests t where t.id = test_id and t.teacher_id = auth.uid()));

drop policy if exists "delete own submissions" on public.submissions;
create policy "delete own submissions" on public.submissions for delete to authenticated
  using (exists (select 1 from public.tests t where t.id = test_id and t.teacher_id = auth.uid()));

-- ===== Şagird üçün funksiyalar (girişsiz, cavablar gizli qalır) =====

create or replace function public.get_test_for_student(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  result jsonb;
begin
  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open then
    return null;
  end if;

  select jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'students', coalesce((
      select jsonb_agg(s.full_name order by s.full_name)
      from public.students s where s.class_id = t.class_id
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options)
        order by array_position(t.question_ids, q.id)
      )
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.submit_test(p_test_id uuid, p_student_name text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  q record;
  v_name text;
  v_score int := 0;
  v_total int := 0;
begin
  v_name := left(btrim(coalesce(p_student_name, '')), 80);
  if v_name = '' then
    raise exception 'Adınızı yazın';
  end if;

  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open then
    raise exception 'Bu test bağlıdır';
  end if;

  for q in
    select id, qtype, answer from public.questions
    where id = any(t.question_ids) and teacher_id = t.teacher_id
  loop
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

grant execute on function public.get_test_for_student(uuid) to anon, authenticated;
grant execute on function public.submit_test(uuid, text, jsonb) to anon, authenticated;

-- ================= 002_tryos.sql =================
-- Müəllim+ · 2-ci yeniləmə: TR-YÖS, şəkillər, yoxlama
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

alter table public.questions add column if not exists figure text;
alter table public.questions add column if not exists option_figures jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists exam text not null default 'general';
alter table public.questions add column if not exists section text;
alter table public.questions add column if not exists subtype text;
alter table public.questions add column if not exists verified boolean;
alter table public.questions add column if not exists verify_note text;

create or replace function public.get_test_for_student(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  result jsonb;
begin
  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open then
    return null;
  end if;

  select jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'students', coalesce((
      select jsonb_agg(s.full_name order by s.full_name)
      from public.students s where s.class_id = t.class_id
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id)
      )
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_test_for_student(uuid) to anon, authenticated;

-- ================= 003_usage.sql =================
-- Müəllim+ · 3-cü yeniləmə: AI xərc və sual sayğacı
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  model text not null,
  for_model text,
  role text not null default 'main' check (role in ('main', 'helper')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  questions int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_teacher_idx on public.ai_usage(teacher_id, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists "insert own usage" on public.ai_usage;
create policy "insert own usage" on public.ai_usage for insert to authenticated
  with check (teacher_id = auth.uid());

drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select to authenticated
  using (teacher_id = auth.uid());

-- Hansı modelin yaratdığı sual banka düşüb
alter table public.questions add column if not exists model text;

-- Köməkçi xərcin (oxuma, yoxlama) hansı modelin işinə aid olduğu
alter table public.ai_usage add column if not exists for_model text;

-- ================= 004_status.sql =================
-- Müəllim+ · 4-cü yeniləmə: AI yoxlama statusları və müəllim təsdiqi
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

alter table public.questions add column if not exists ai_status text
  check (ai_status in ('passed', 'review', 'draft'));
alter table public.questions add column if not exists fit_ok boolean;
alter table public.questions add column if not exists fit_note text;
alter table public.questions add column if not exists teacher_approved boolean not null default false;

-- Köhnə suallar: əvvəlki "verified" nəticəsini statusa çevir (müəllim təsdiqi deyil)
update public.questions set ai_status = case when verified then 'passed' else 'review' end
  where ai_status is null and verified is not null;

-- ================= 005_student_links.sql =================
-- Müəllim+ · 5-ci yeniləmə: hər şagirdə şəxsi link
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

create extension if not exists pgcrypto;

-- 8 simvollu kod: oxşar hərflər (0/O, 1/I/L) yoxdur
create or replace function public.gen_student_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
  end loop;
  return code;
end;
$$;

alter table public.students add column if not exists access_code text not null default public.gen_student_code();
create unique index if not exists students_access_code_idx on public.students(access_code);

alter table public.submissions add column if not exists student_id uuid references public.students(id) on delete set null;
create unique index if not exists submissions_one_per_student on public.submissions(test_id, student_id) where student_id is not null;
create index if not exists submissions_student_idx on public.submissions(student_id);

-- Şagird kabineti: adı, sinfi, sinfin testləri və öz nəticələri
create or replace function public.student_portal(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  cls public.classes%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  select * into cls from public.classes where id = s.class_id;

  return jsonb_build_object(
    'name', s.full_name,
    'class', cls.name,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'is_open', t.is_open, 'created_at', t.created_at,
          'count', coalesce(array_length(t.question_ids, 1), 0),
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

-- Şəxsi linklə test: yalnız öz sinfinin açıq testi, cavablar gizli
create or replace function public.student_get_test(p_code text, p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  done public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then
    return null;
  end if;

  select * into done from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name,
      'result', jsonb_build_object('score', done.score, 'total', done.total, 'created_at', done.created_at));
  end if;
  if not t.is_open then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'closed', true);
  end if;

  return jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'name', s.full_name,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id)
      )
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_submit_test(p_code text, p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  q record;
  v_score int := 0;
  v_total int := 0;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'Link etibarsızdır';
  end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found or not t.is_open then
    raise exception 'Bu test bağlıdır';
  end if;
  if exists (select 1 from public.submissions where test_id = t.id and student_id = s.id) then
    raise exception 'Bu testi artıq göndərmisiniz';
  end if;

  for q in
    select id, qtype, answer from public.questions
    where id = any(t.question_ids) and teacher_id = t.teacher_id
  loop
    if q.qtype = 'mcq' then
      v_total := v_total + 1;
      if lower(btrim(coalesce(p_answers ->> (q.id::text), ''))) = lower(btrim(q.answer)) then
        v_score := v_score + 1;
      end if;
    end if;
  end loop;

  insert into public.submissions (test_id, student_id, student_name, answers, score, total)
  values (t.id, s.id, s.full_name, coalesce(p_answers, '{}'::jsonb), v_score, v_total);

  return jsonb_build_object('score', v_score, 'total', v_total);
end;
$$;

grant execute on function public.student_portal(text) to anon, authenticated;
grant execute on function public.student_get_test(text, uuid) to anon, authenticated;
grant execute on function public.student_submit_test(text, uuid, jsonb) to anon, authenticated;

-- ================= 006_review.sql =================
-- Müəllim+ · 6-cı yeniləmə: şagird testdən sonra səhvlərini görür (müəllim icazəsi ilə)
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

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
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run
-- 006_review.sql əvvəlcədən işlədilməlidir.

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

-- ================= 009_hardening.sql =================
-- Müəllim+ · 9-cu yeniləmə: möhkəmləndirmə
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run
-- İndekslər, ölçü limitləri, ümumi linkdə təkrar/axın göndərmənin qarşısı, səhv jurnalı.

-- ---------- indekslər (böyüyən cədvəllər üçün) ----------
create index if not exists tests_class_idx on public.tests(class_id);
create index if not exists tests_student_idx on public.tests(student_id) where student_id is not null;
create index if not exists submissions_test_created_idx on public.submissions(test_id, created_at desc);
create index if not exists questions_teacher_topic_idx on public.questions(teacher_id, topic);

-- ---------- ölçü limitləri (yalnız yeni yazılara tətbiq olunur) ----------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_answers_size') then
    alter table public.submissions add constraint submissions_answers_size check (octet_length(answers::text) <= 60000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_body_size') then
    alter table public.questions add constraint questions_body_size check (char_length(body) <= 20000 and char_length(coalesce(solution, '')) <= 20000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_figures_size') then
    alter table public.questions add constraint questions_figures_size
      check (octet_length(coalesce(figure, '')) <= 300000 and octet_length(option_figures::text) <= 900000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tests_size') then
    alter table public.tests add constraint tests_size check (coalesce(array_length(question_ids, 1), 0) <= 200) not valid;
  end if;
end $$;

-- ---------- göndərmə qoruması ----------
-- Ümumi (ad seçməklə) linkdə: eyni ad eyni testə ikinci dəfə göndərə bilmir; bir testə ən çox 1000 iş.
create or replace function public.guard_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.student_id is null and exists (
    select 1 from public.submissions s
    where s.test_id = new.test_id and s.student_id is null
      and lower(btrim(s.student_name)) = lower(btrim(new.student_name))) then
    raise exception 'Bu adla bu testə artıq cavab göndərilib';
  end if;
  if (select count(*) from public.submissions s where s.test_id = new.test_id) >= 1000 then
    raise exception 'Bu testə göndərilən işlərin sayı limitə çatıb';
  end if;
  return new;
end;
$$;
drop trigger if exists submissions_guard on public.submissions;
create trigger submissions_guard before insert on public.submissions
  for each row execute function public.guard_submission();

-- ---------- səhv jurnalı ----------
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  source text not null default 'client' check (source in ('client', 'server', 'student')),
  message text not null check (char_length(message) <= 1000),
  stack text check (char_length(stack) <= 4000),
  url text check (char_length(url) <= 500),
  agent text check (char_length(agent) <= 300)
);
create index if not exists app_errors_created_idx on public.app_errors(created_at desc);
alter table public.app_errors enable row level security;

drop policy if exists "anyone logs errors" on public.app_errors;
create policy "anyone logs errors" on public.app_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "admin reads errors" on public.app_errors;
create policy "admin reads errors" on public.app_errors for select to authenticated
  using (public.is_admin());

drop policy if exists "admin deletes errors" on public.app_errors;
create policy "admin deletes errors" on public.app_errors for delete to authenticated
  using (public.is_admin());

-- Jurnal şişməsin: 30 gündən köhnələr silinir; dəqiqədə 30-dan çox yazı qəbul edilmir (axına qarşı)
create or replace function public.guard_app_error()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.app_errors where created_at > now() - interval '1 minute') >= 30 then
    return null; -- səssizcə at
  end if;
  if random() < 0.02 then
    delete from public.app_errors where created_at < now() - interval '30 days';
  end if;
  return new;
end;
$$;
drop trigger if exists app_errors_guard on public.app_errors;
create trigger app_errors_guard before insert on public.app_errors
  for each row execute function public.guard_app_error();

-- ---------- AI xərc jurnalı saxtalaşdırılmasın (mənfi xərc limiti "azaltmasın") ----------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_usage_nonneg') then
    alter table public.ai_usage add constraint ai_usage_nonneg
      check (cost_usd >= 0 and input_tokens >= 0 and output_tokens >= 0 and questions >= 0) not valid;
  end if;
end $$;

-- ---------- yalnız təsdiqlənmiş müəllim yaza bilər (oxumaq dəyişmir) ----------
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.teacher_access where user_id = auth.uid()), false);
$$;

drop policy if exists "own classes" on public.classes;
create policy "own classes" on public.classes for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_approved());

drop policy if exists "own students" on public.students;
create policy "own students" on public.students for all to authenticated
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (public.is_approved() and exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()));

drop policy if exists "own questions" on public.questions;
create policy "own questions" on public.questions for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_approved());

drop policy if exists "own tests" on public.tests;
create policy "own tests" on public.tests for all to authenticated
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid() and public.is_approved()
    and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
  );

drop policy if exists "insert own usage" on public.ai_usage;
create policy "insert own usage" on public.ai_usage for insert to authenticated
  with check (teacher_id = auth.uid() and public.is_approved());

-- ================= 010_mistakes.sql =================
-- Müəllim+ · 10-cu yeniləmə: səhv dəftəri
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- Şagird testdə səhv etdiyi sual dəftərinə düşür. Bir gün sonra ona həmin sualın BƏNZƏRİ verilir
-- (bankdan: əvvəl müəllimin AI ilə hazırladığı bənzər, sonra eyni mövzu/tip). Düz tapsa dəftərdən silinir,
-- səhv etsə 2 gün sonra başqa bənzəri gəlir.

-- Sualın hansı sualın bənzəri olduğu (AI ilə hazırlanan bənzərlər üçün)
alter table public.questions add column if not exists similar_to uuid references public.questions(id) on delete set null;
create index if not exists questions_similar_idx on public.questions(similar_to) where similar_to is not null;

create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  test_id uuid references public.tests(id) on delete set null,
  practice_id uuid references public.questions(id) on delete set null,
  seen uuid[] not null default '{}',
  attempts int not null default 0,
  status text not null default 'open' check (status in ('open', 'cleared')),
  due_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create unique index if not exists mistakes_open_uniq on public.mistakes(student_id, question_id) where status = 'open';
create index if not exists mistakes_student_idx on public.mistakes(student_id, status, due_at);
create index if not exists mistakes_teacher_idx on public.mistakes(teacher_id, status);

alter table public.mistakes enable row level security;
-- Müəllim yalnız öz şagirdlərinin dəftərini görür və sətir silə bilər (yazmaq yalnız aşağıdakı funksiyalarla)
drop policy if exists "own mistakes read" on public.mistakes;
create policy "own mistakes read" on public.mistakes for select to authenticated using (teacher_id = auth.uid());
drop policy if exists "own mistakes delete" on public.mistakes;
create policy "own mistakes delete" on public.mistakes for delete to authenticated using (teacher_id = auth.uid());
revoke insert, update on public.mistakes from anon, authenticated;

-- Test göndəriləndə səhv cavablanan suallar dəftərə yazılır (boş saxlananlar yox)
create or replace function public.record_mistakes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tests%rowtype;
  q record;
  v text;
begin
  if new.student_id is null then return new; end if;
  select * into t from public.tests where id = new.test_id;
  if not found then return new; end if;
  for q in select id, answer from public.questions where id = any(t.question_ids) and teacher_id = t.teacher_id and qtype = 'mcq' loop
    v := btrim(coalesce(new.answers ->> (q.id::text), ''));
    if v <> '' and lower(v) <> lower(btrim(q.answer)) then
      insert into public.mistakes (teacher_id, student_id, question_id, test_id)
      values (t.teacher_id, new.student_id, q.id, t.id) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists submissions_mistakes on public.submissions;
create trigger submissions_mistakes after insert on public.submissions for each row execute function public.record_mistakes();

-- Təkrar üçün sual seç: əvvəl bu sualın bənzəri, sonra eyni mövzu və tip, sonra eyni mövzu; görülənlər yox.
-- Heç nə tapılmasa — orijinal sualın özü.
create or replace function public.pick_practice(p_mistake uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.mistakes%rowtype;
  o public.questions%rowtype;
  v uuid;
begin
  select * into m from public.mistakes where id = p_mistake;
  if not found then return null; end if;
  select * into o from public.questions where id = m.question_id;
  if not found then return null; end if;
  select q.id into v from public.questions q
  where q.teacher_id = m.teacher_id and q.id <> o.id and q.qtype = 'mcq'
    and not (q.id = any(m.seen))
    and (q.teacher_approved is true or q.ai_status = 'passed' or (q.ai_status is null and q.verified is not false))
    and (q.similar_to = o.id or o.similar_to = q.id or (o.topic is not null and o.topic <> '' and q.topic = o.topic))
  order by (q.similar_to = o.id or o.similar_to = q.id) desc nulls last,
           (q.subtype is not distinct from o.subtype) desc,
           (q.difficulty is not distinct from o.difficulty) desc,
           random()
  limit 1;
  return coalesce(v, o.id);
end;
$$;
revoke execute on function public.pick_practice(uuid) from public, anon, authenticated;

-- Şagird: dəftərin vəziyyəti və təkrar vaxtı çatmış suallar (cavabsız)
create or replace function public.student_mistakes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  r record;
  items jsonb := '[]'::jsonb;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  for r in select id from public.mistakes where student_id = s.id and status = 'open' and due_at <= now() and practice_id is null loop
    update public.mistakes set practice_id = public.pick_practice(r.id) where id = r.id;
  end loop;
  select coalesce(jsonb_agg(x order by x ->> 'due_at'), '[]'::jsonb) into items from (
    select jsonb_build_object('id', m.id, 'attempts', m.attempts, 'due_at', m.due_at,
      'question', jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options, 'figure', q.figure,
        'option_figures', q.option_figures, 'exam', q.exam, 'topic', q.topic)) as x
    from public.mistakes m join public.questions q on q.id = m.practice_id
    where m.student_id = s.id and m.status = 'open' and m.due_at <= now()
    order by m.due_at limit 10
  ) z;
  return jsonb_build_object(
    'name', s.full_name,
    'items', items,
    'open', (select count(*) from public.mistakes where student_id = s.id and status = 'open'),
    'due', (select count(*) from public.mistakes where student_id = s.id and status = 'open' and due_at <= now()),
    'next_at', (select min(due_at) from public.mistakes where student_id = s.id and status = 'open' and due_at > now()),
    'cleared', (select count(*) from public.mistakes where student_id = s.id and status = 'cleared'));
end;
$$;

-- Şagird cavabı: düzdürsə dəftərdən silinir, səhvdirsə 2 gün sonra başqa bənzəri gəlir
create or replace function public.student_answer_mistake(p_code text, p_mistake uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  m public.mistakes%rowtype;
  q public.questions%rowtype;
  ok boolean;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into m from public.mistakes where id = p_mistake and student_id = s.id and status = 'open' and due_at <= now() for update;
  if not found or m.practice_id is null then raise exception 'Bu sual artıq dəftərdə deyil'; end if;
  select * into q from public.questions where id = m.practice_id;
  if not found then raise exception 'Sual tapılmadı'; end if;
  ok := lower(btrim(coalesce(p_answer, ''))) = lower(btrim(q.answer));
  if ok then
    update public.mistakes set status = 'cleared', cleared_at = now(), attempts = attempts + 1, seen = array_append(seen, q.id) where id = m.id;
  else
    update public.mistakes set attempts = attempts + 1, seen = array_append(seen, q.id), practice_id = null, due_at = now() + interval '2 days' where id = m.id;
  end if;
  return jsonb_build_object('correct', ok, 'answer', q.answer, 'solution', q.solution);
end;
$$;

grant execute on function public.student_mistakes(text) to anon, authenticated;
grant execute on function public.student_answer_mistake(text, uuid, text) to anon, authenticated;

-- ================= 011_mistakes_safe.sql =================
-- Müəllim+ · 11-ci yeniləmə: səhv dəftəri — cavab sızmasın + köhnə səhvlər
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- 1) Şagirdə təkrar üçün AÇIQ testdəki sual verilmir (cavabı hələ gizlidir), istisna: şagird həmin testi
--    yazıb və test "göndərən kimi göstər" rejimindədir. Uyğun sual yoxdursa, təkrar test bağlanana qədər gözləyir.
-- 2) Bu yeniləmədən əvvəl göndərilmiş testlərdəki səhvlər də dəftərə yazılır (bir dəfə; düzəldilmişlər qayıtmır).

create or replace function public.practice_safe(p_q uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    join public.tests t on t.teacher_id = c.teacher_id and (t.class_id is null or t.class_id = s.class_id)
    where s.id = p_student and t.is_open and p_q = any(t.question_ids)
      and not (coalesce(t.review_mode, 'never') = 'after_submit'
               and exists (select 1 from public.submissions x where x.test_id = t.id and x.student_id = p_student))
  )
$$;
revoke execute on function public.practice_safe(uuid, uuid) from public, anon, authenticated;

create or replace function public.pick_practice(p_mistake uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.mistakes%rowtype;
  o public.questions%rowtype;
  v uuid;
begin
  select * into m from public.mistakes where id = p_mistake;
  if not found then return null; end if;
  select * into o from public.questions where id = m.question_id;
  if not found then return null; end if;
  select q.id into v from public.questions q
  where q.teacher_id = m.teacher_id and q.id <> o.id and q.qtype = 'mcq'
    and not (q.id = any(m.seen))
    and (q.teacher_approved is true or q.ai_status = 'passed' or (q.ai_status is null and q.verified is not false))
    and (q.similar_to = o.id or o.similar_to = q.id or (o.topic is not null and o.topic <> '' and q.topic = o.topic))
    and public.practice_safe(q.id, m.student_id)
  order by (q.similar_to = o.id or o.similar_to = q.id) desc nulls last,
           (q.subtype is not distinct from o.subtype) desc,
           (q.difficulty is not distinct from o.difficulty) desc,
           random()
  limit 1;
  if v is null and public.practice_safe(o.id, m.student_id) then v := o.id; end if;
  return v; -- null: hələ verilə biləcək sual yoxdur (test bağlananda yenidən yoxlanılır)
end;
$$;
revoke execute on function public.pick_practice(uuid) from public, anon, authenticated;

create or replace function public.student_mistakes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  r record;
  items jsonb := '[]'::jsonb;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  -- təyin edilmiş sual sonradan açıq testə düşübsə, yenisi seçilir
  update public.mistakes set practice_id = null
  where student_id = s.id and status = 'open' and practice_id is not null and not public.practice_safe(practice_id, s.id);
  for r in select id from public.mistakes where student_id = s.id and status = 'open' and due_at <= now() and practice_id is null loop
    update public.mistakes set practice_id = public.pick_practice(r.id) where id = r.id;
  end loop;
  select coalesce(jsonb_agg(x order by x ->> 'due_at'), '[]'::jsonb) into items from (
    select jsonb_build_object('id', m.id, 'attempts', m.attempts, 'due_at', m.due_at,
      'question', jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options, 'figure', q.figure,
        'option_figures', q.option_figures, 'exam', q.exam, 'topic', q.topic)) as x
    from public.mistakes m join public.questions q on q.id = m.practice_id
    where m.student_id = s.id and m.status = 'open' and m.due_at <= now()
    order by m.due_at limit 10
  ) z;
  return jsonb_build_object(
    'name', s.full_name,
    'items', items,
    'open', (select count(*) from public.mistakes where student_id = s.id and status = 'open'),
    'due', (select count(*) from public.mistakes where student_id = s.id and status = 'open' and due_at <= now() and practice_id is not null),
    'next_at', (select min(due_at) from public.mistakes where student_id = s.id and status = 'open' and due_at > now()),
    'cleared', (select count(*) from public.mistakes where student_id = s.id and status = 'cleared'));
end;
$$;

create or replace function public.student_answer_mistake(p_code text, p_mistake uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  m public.mistakes%rowtype;
  q public.questions%rowtype;
  ok boolean;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into m from public.mistakes where id = p_mistake and student_id = s.id and status = 'open' and due_at <= now() for update;
  if not found or m.practice_id is null then raise exception 'Bu sual artıq dəftərdə deyil'; end if;
  if not public.practice_safe(m.practice_id, s.id) then raise exception 'Bu sual hələ açıq testdədir, sonra təkrar edin'; end if;
  select * into q from public.questions where id = m.practice_id;
  if not found then raise exception 'Sual tapılmadı'; end if;
  ok := lower(btrim(coalesce(p_answer, ''))) = lower(btrim(q.answer));
  if ok then
    update public.mistakes set status = 'cleared', cleared_at = now(), attempts = attempts + 1, seen = array_append(seen, q.id) where id = m.id;
  else
    update public.mistakes set attempts = attempts + 1, seen = array_append(seen, q.id), practice_id = null, due_at = now() + interval '2 days' where id = m.id;
  end if;
  return jsonb_build_object('correct', ok, 'answer', q.answer, 'solution', q.solution);
end;
$$;

grant execute on function public.student_mistakes(text) to anon, authenticated;
grant execute on function public.student_answer_mistake(text, uuid, text) to anon, authenticated;

-- Köhnə testlərdəki səhvlər (yalnız dəftərdə heç olmayanlar; düzəldilmişlər qayıtmır)
insert into public.mistakes (teacher_id, student_id, question_id, test_id)
select distinct on (x.student_id, q.id) t.teacher_id, x.student_id, q.id, t.id
from public.submissions x
join public.tests t on t.id = x.test_id
join public.questions q on q.id = any(t.question_ids) and q.teacher_id = t.teacher_id and q.qtype = 'mcq'
where x.student_id is not null
  and btrim(coalesce(x.answers ->> (q.id::text), '')) <> ''
  and lower(btrim(x.answers ->> (q.id::text))) <> lower(btrim(q.answer))
  and not exists (select 1 from public.mistakes m where m.student_id = x.student_id and m.question_id = q.id)
order by x.student_id, q.id, x.created_at desc
on conflict do nothing;

-- ================= 012_student_insights.sql =================
-- Müəllim+ · 12-ci yeniləmə: deneme, imtahan tarixi, tələbə analizi, dərs qeydləri
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.

-- ---------- test növü və imtahan tarixi ----------
alter table public.tests add column if not exists kind text not null default 'homework';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tests_kind_check') then
    alter table public.tests add constraint tests_kind_check check (kind in ('homework', 'deneme'));
  end if;
end $$;
alter table public.classes add column if not exists exam_date date;

-- ---------- dərs qeydləri ----------
create table if not exists public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  topic text check (char_length(coalesce(topic, '')) <= 120),
  body text check (char_length(coalesce(body, '')) <= 20000),
  file_path text check (char_length(coalesce(file_path, '')) <= 300),
  file_name text check (char_length(coalesce(file_name, '')) <= 200),
  file_type text check (char_length(coalesce(file_type, '')) <= 100),
  created_at timestamptz not null default now(),
  check (class_id is not null or student_id is not null)
);
create index if not exists lesson_notes_class_idx on public.lesson_notes(class_id, created_at desc);
create index if not exists lesson_notes_student_idx on public.lesson_notes(student_id, created_at desc) where student_id is not null;
alter table public.lesson_notes enable row level security;
drop policy if exists "own notes" on public.lesson_notes;
create policy "own notes" on public.lesson_notes for all to authenticated
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid() and public.is_approved()
    and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
    and (student_id is null or exists (select 1 from public.students s join public.classes c on c.id = s.class_id where s.id = student_id and c.teacher_id = auth.uid()))
  );

-- Fayllar: "notes" qovluğu (ictimai oxunur, ünvan təsadüfidir); yalnız təsdiqli müəllim öz qovluğuna yazır/silir
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('notes', 'notes', true, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "notes upload own" on storage.objects';
    execute $p$create policy "notes upload own" on storage.objects for insert to authenticated
      with check (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved())$p$;
    execute 'drop policy if exists "notes delete own" on storage.objects';
    execute $p$create policy "notes delete own" on storage.objects for delete to authenticated
      using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

-- ---------- tələbə: dərs qeydləri ----------
create or replace function public.student_notes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'topic', n.topic, 'body', n.body, 'file_path', n.file_path,
      'file_name', n.file_name, 'file_type', n.file_type, 'personal', n.student_id is not null, 'created_at', n.created_at) order by n.created_at desc)
    from public.lesson_notes n
    where n.student_id = s.id or (n.student_id is null and n.class_id = s.class_id)
  ), '[]'::jsonb);
end;
$$;

-- ---------- tələbə: analiz (mövzular, nəticələr, deneme, imtahan tarixi) ----------
-- Mövzu üzrə düz/səhv yalnız cavabları tələbəyə açılmış testlərdən sayılır (açıq "bağlananda" testi sızmasın).
create or replace function public.student_analysis(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  v_exam date;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select exam_date into v_exam from public.classes where id = s.class_id;
  return jsonb_build_object(
    'exam_date', v_exam,
    'days_left', case when v_exam is null then null else v_exam - current_date end,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('topic', topic, 'right', r, 'total', n) order by (r::numeric / n), n desc)
      from (
        select coalesce(nullif(btrim(q.topic), ''), 'Digər') as topic,
               count(*) filter (where lower(btrim(coalesce(x.answers ->> (q.id::text), ''))) = lower(btrim(q.answer))) as r,
               count(*) as n
        from public.submissions x
        join public.tests t on t.id = x.test_id
        join public.questions q on q.id = any(t.question_ids) and q.teacher_id = t.teacher_id and q.qtype = 'mcq'
        where x.student_id = s.id and public.review_allowed(t)
        group by 1
      ) z), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object('title', t.title, 'kind', t.kind, 'score', x.score, 'total', x.total,
        'empty', (select count(*) from public.questions q where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id and q.qtype = 'mcq'
                  and btrim(coalesce(x.answers ->> (q.id::text), '')) = ''),
        'at', x.created_at) order by x.created_at)
      from public.submissions x join public.tests t on t.id = x.test_id
      where x.student_id = s.id), '[]'::jsonb));
end;
$$;

grant execute on function public.student_notes(text) to anon, authenticated;
grant execute on function public.student_analysis(text) to anon, authenticated;

-- ================= 013_lessons.sql =================
-- Müəllim+ · 13-cü yeniləmə: dərs və ödəniş dəftəri, gizli qeyd, sualların real çətinliyi
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- Bu məlumatları yalnız müəllim görür: tələbə funksiyaları (student_*) bu sahələri qaytarmır.

alter table public.students add column if not exists lesson_price numeric(10, 2) check (lesson_price is null or lesson_price between 0 and 100000);
alter table public.students add column if not exists teacher_note text check (char_length(coalesce(teacher_note, '')) <= 20000);

-- Dərslər: status came (keçildi) | missed (gəlmədi); fee — bu dərs üçün hesablanan məbləğ
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_date date not null default current_date,
  status text not null default 'came' check (status in ('came', 'missed')),
  fee numeric(10, 2) not null default 0 check (fee between 0 and 100000),
  topic text check (char_length(coalesce(topic, '')) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists lessons_student_idx on public.lessons(student_id, lesson_date desc);
create index if not exists lessons_teacher_idx on public.lessons(teacher_id, lesson_date desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0 and amount <= 1000000),
  paid_on date not null default current_date,
  note text check (char_length(coalesce(note, '')) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists payments_student_idx on public.payments(student_id, paid_on desc);
create index if not exists payments_teacher_idx on public.payments(teacher_id, paid_on desc);

alter table public.lessons enable row level security;
alter table public.payments enable row level security;
drop policy if exists "own lessons" on public.lessons;
create policy "own lessons" on public.lessons for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.is_approved()
    and exists (select 1 from public.students s join public.classes c on c.id = s.class_id where s.id = student_id and c.teacher_id = auth.uid()));
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.is_approved()
    and exists (select 1 from public.students s join public.classes c on c.id = s.class_id where s.id = student_id and c.teacher_id = auth.uid()));

-- Sualların real nəticəsi: neçə dəfə verilib, neçəsi düz (müəllimin öz testlərindən; boş cavab da sayılır)
create or replace function public.question_stats()
returns table (question_id uuid, attempts int, right_count int)
language sql stable security invoker set search_path = public as $$
  select q.id, count(*)::int,
         count(*) filter (where lower(btrim(coalesce(x.answers ->> (q.id::text), ''))) = lower(btrim(q.answer)))::int
  from public.submissions x
  join public.tests t on t.id = x.test_id
  join public.questions q on q.id = any(t.question_ids) and q.teacher_id = t.teacher_id and q.qtype = 'mcq'
  where t.teacher_id = auth.uid()
  group by q.id
$$;
grant execute on function public.question_stats() to authenticated;

-- ================= 014_materials.sql =================
-- Müəllim+ · 14-cü yeniləmə: materiallara video/link
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
alter table public.lesson_notes add column if not exists link_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_notes_link_check') then
    alter table public.lesson_notes add constraint lesson_notes_link_check
      check (link_url is null or (char_length(link_url) <= 500 and link_url ~* '^https?://'));
  end if;
end $$;

create or replace function public.student_notes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'topic', n.topic, 'body', n.body, 'file_path', n.file_path,
      'file_name', n.file_name, 'file_type', n.file_type, 'link_url', n.link_url, 'personal', n.student_id is not null, 'created_at', n.created_at) order by n.created_at desc)
    from public.lesson_notes n
    where n.student_id = s.id or (n.student_id is null and n.class_id = s.class_id)
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.student_notes(text) to anon, authenticated;

-- ================= 015_drawings.sql =================
-- Müəllim+ · 15-ci yeniləmə: tələbənin sual üzərində yazdığı həll (qaralama şəkli)
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- Şəkil yalnız tələbənin şəxsi linki ilə, öz göndərdiyi testə, göndərdikdən sonra 30 dəqiqə ərzində yazıla bilər.
-- Yalnız JPEG/PNG/WEBP (SVG yox — içində skript ola bilər). Görən yalnız testin müəllimidir.

create table if not exists public.submission_drawings (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  question_id uuid not null,
  image text not null check (char_length(image) <= 700000 and image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'),
  created_at timestamptz not null default now(),
  primary key (submission_id, question_id)
);
alter table public.submission_drawings enable row level security;
drop policy if exists "own drawings read" on public.submission_drawings;
create policy "own drawings read" on public.submission_drawings for select to authenticated
  using (exists (select 1 from public.submissions x join public.tests t on t.id = x.test_id where x.id = submission_id and t.teacher_id = auth.uid()));
drop policy if exists "own drawings delete" on public.submission_drawings;
create policy "own drawings delete" on public.submission_drawings for delete to authenticated
  using (exists (select 1 from public.submissions x join public.tests t on t.id = x.test_id where x.id = submission_id and t.teacher_id = auth.uid()));
revoke insert, update on public.submission_drawings from anon, authenticated;

create or replace function public.student_save_drawings(p_code text, p_test_id uuid, p_drawings jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  x public.submissions%rowtype;
  t public.tests%rowtype;
  k text;
  v text;
  n int := 0;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into x from public.submissions where test_id = p_test_id and student_id = s.id order by created_at desc limit 1;
  if not found then raise exception 'Əvvəlcə testi göndərin'; end if;
  if x.created_at < now() - interval '30 minutes' then raise exception 'Həlli göndərmə vaxtı keçib'; end if;
  select * into t from public.tests where id = p_test_id;
  if jsonb_typeof(p_drawings) <> 'object' then raise exception 'Yanlış məlumat'; end if;
  if (select count(*) from jsonb_object_keys(p_drawings)) > 60 then raise exception 'Çox şəkil'; end if;
  for k, v in select key, value from jsonb_each_text(p_drawings) loop
    if k !~ '^[0-9a-f-]{36}$' or not (k::uuid = any(t.question_ids)) then continue; end if;
    insert into public.submission_drawings (submission_id, question_id, image) values (x.id, k::uuid, v)
    on conflict (submission_id, question_id) do update set image = excluded.image, created_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function public.student_save_drawings(text, uuid, jsonb) to anon, authenticated;
