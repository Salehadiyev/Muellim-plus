-- Müəllim+ · 2-ci yeniləmə: TR-YÖS, şəkillər, yoxlama
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

alter table public.questions add column if not exists figure text;
alter table public.questions add column if not exists option_figures jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists exam text not null default 'general';
alter table public.questions add column if not exists section text;
alter table public.questions add column if not exists subtype text;
alter table public.questions add column if not exists verified boolean;
alter table public.questions add column if not exists verify_note text;

create or replace function public.get_test_for_student(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  result jsonb;
begin
  select * into t from public.tests where id = p_test_id;
  if not found or not t.is_open then
    return null;
  end if;

  select jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'students', coalesce((
      select jsonb_agg(s.full_name order by s.full_name)
      from public.students s where s.class_id = t.class_id
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id)
      )
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_test_for_student(uuid) to anon, authenticated;
