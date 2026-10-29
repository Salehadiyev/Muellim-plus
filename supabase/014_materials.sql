-- Müəllim+ · 14-cü yeniləmə: materiallara video/link
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
alter table public.lesson_notes add column if not exists link_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_notes_link_check') then
    alter table public.lesson_notes add constraint lesson_notes_link_check
      check (link_url is null or (char_length(link_url) <= 500 and link_url ~* '^https?://'));
  end if;
end $$;

create or replace function public.student_notes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'topic', n.topic, 'body', n.body, 'file_path', n.file_path,
      'file_name', n.file_name, 'file_type', n.file_type, 'link_url', n.link_url, 'personal', n.student_id is not null, 'created_at', n.created_at) order by n.created_at desc)
    from public.lesson_notes n
    where n.student_id = s.id or (n.student_id is null and n.class_id = s.class_id)
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.student_notes(text) to anon, authenticated;
