-- Müəllim+ · 6-cı yeniləmə: şagird testdən sonra səhvlərini görür (müəllim icazəsi ilə)
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

-- never: göstərmə · after_submit: göndərən kimi · after_close: test bağlananda
alter table public.tests add column if not exists review_mode text not null default 'never'
  check (review_mode in ('never', 'after_submit', 'after_close'));

create or replace function public.review_allowed(t public.tests)
returns boolean language sql immutable as $$
  select t.review_mode = 'after_submit' or (t.review_mode = 'after_close' and not t.is_open);
$$;

create or replace function public.student_portal(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  cls public.classes%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into cls from public.classes where id = s.class_id;
  return jsonb_build_object(
    'name', s.full_name,
    'class', cls.name,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'is_open', t.is_open, 'created_at', t.created_at,
          'count', coalesce(array_length(t.question_ids, 1), 0),
          'review', public.review_allowed(t),
          'review_mode', t.review_mode,
          'result', (select jsonb_build_object('score', sub.score, 'total', sub.total, 'created_at', sub.created_at)
                     from public.submissions sub where sub.test_id = t.id and sub.student_id = s.id limit 1)
        ) order by t.created_at desc)
      from public.tests t
      where t.class_id = s.class_id and t.teacher_id = cls.teacher_id
        and (t.is_open or exists (select 1 from public.submissions x where x.test_id = t.id and x.student_id = s.id))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_get_test(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  done public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then return null; end if;
  select * into done from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name,
      'review', public.review_allowed(t), 'review_mode', t.review_mode,
      'result', jsonb_build_object('score', done.score, 'total', done.total, 'created_at', done.created_at));
  end if;
  if not t.is_open then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'closed', true);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'review_mode', t.review_mode,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Şagirdin öz işi: sual, onun cavabı, düzgün cavab və həll — yalnız icazə varsa
create or replace function public.student_review(p_code text, p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  sub public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then return null; end if;
  select * into sub from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if not found then return null; end if;
  if not public.review_allowed(t) then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', false, 'review_mode', t.review_mode);
  end if;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'name', s.full_name, 'allowed', true,
    'score', sub.score, 'total', sub.total, 'answers', sub.answers,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures,
                           'answer', q.answer, 'solution', q.solution)
        order by array_position(t.question_ids, q.id))
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.student_portal(text) to anon, authenticated;
grant execute on function public.student_get_test(text, uuid) to anon, authenticated;
grant execute on function public.student_review(text, uuid) to anon, authenticated;
