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
