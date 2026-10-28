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
