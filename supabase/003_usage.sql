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
