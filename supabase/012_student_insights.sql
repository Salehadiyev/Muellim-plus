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
