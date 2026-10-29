-- Müəllim+ · 16-cı yeniləmə: aylıq ödəniş (məbləğ + ayın neçəsi), davamiyyət puldan ayrı
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- students.lesson_price artıq AYLIQ məbləğdir. Borc = ödəniş günü çatmış aylar × aylıq məbləğ − ödənişlər.

alter table public.students add column if not exists pay_day int check (pay_day is null or pay_day between 1 and 31);
alter table public.students add column if not exists billing_start date;
update public.students set billing_start = date_trunc('month', current_date)::date where lesson_price is not null and billing_start is null;

-- Dərslər artıq pul yazmır (yalnız gəldi / gəlmədi)
update public.lessons set fee = 0 where fee <> 0;
-- Bir gündə bir qeyd: təkrarlananların sonuncusu qalır
delete from public.lessons a using public.lessons b
  where a.student_id = b.student_id and a.lesson_date = b.lesson_date and (a.created_at, a.id) < (b.created_at, b.id);
create unique index if not exists lessons_one_per_day on public.lessons(student_id, lesson_date);
