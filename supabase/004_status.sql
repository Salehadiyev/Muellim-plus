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
