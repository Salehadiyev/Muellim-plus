-- Müəllim+ · 18-ci yeniləmə: qrupun həftəlik dərs cədvəli
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- schedule = { "slots": [ { "d": 1..7 (1 = bazar ertəsi), "s": "16:00", "e": "17:00" } ], "since": "YYYY-MM-DD" }
-- Yalnız müəllimə görünür (classes cədvəlinin öz qaydaları).

alter table public.classes add column if not exists schedule jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_schedule_check') then
    alter table public.classes add constraint classes_schedule_check
      check (schedule is null or (jsonb_typeof(schedule) = 'object' and pg_column_size(schedule) <= 8000));
  end if;
end $$;
