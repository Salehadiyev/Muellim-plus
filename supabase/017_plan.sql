-- Müəllim+ · 17-ci yeniləmə: qrupun mövzu planı (hansı mövzu keçilib, ardıcıllıq)
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- Plan yalnız müəllimə görünür (classes cədvəlinin öz qaydaları: müəllim yalnız öz qrupunu görür/dəyişir).

alter table public.classes add column if not exists plan jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_plan_check') then
    alter table public.classes add constraint classes_plan_check
      check (plan is null or (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 60000));
  end if;
end $$;
