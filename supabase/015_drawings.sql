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
