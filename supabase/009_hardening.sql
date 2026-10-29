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
