-- Müəllim+ · 5-ci yeniləmə: hər şagirdə şəxsi link
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run

create extension if not exists pgcrypto;

-- 8 simvollu kod: oxşar hərflər (0/O, 1/I/L) yoxdur
create or replace function public.gen_student_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
  end loop;
  return code;
end;
$$;

alter table public.students add column if not exists access_code text not null default public.gen_student_code();
create unique index if not exists students_access_code_idx on public.students(access_code);

alter table public.submissions add column if not exists student_id uuid references public.students(id) on delete set null;
create unique index if not exists submissions_one_per_student on public.submissions(test_id, student_id) where student_id is not null;
create index if not exists submissions_student_idx on public.submissions(student_id);

-- Şagird kabineti: adı, sinfi, sinfin testləri və öz nəticələri
create or replace function public.student_portal(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  cls public.classes%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  select * into cls from public.classes where id = s.class_id;

  return jsonb_build_object(
    'name', s.full_name,
    'class', cls.name,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'is_open', t.is_open, 'created_at', t.created_at,
          'count', coalesce(array_length(t.question_ids, 1), 0),
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

-- Şəxsi linklə test: yalnız öz sinfinin açıq testi, cavablar gizli
create or replace function public.student_get_test(p_code text, p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  done public.submissions%rowtype;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found then
    return null;
  end if;

  select * into done from public.submissions where test_id = t.id and student_id = s.id limit 1;
  if found then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name,
      'result', jsonb_build_object('score', done.score, 'total', done.total, 'created_at', done.created_at));
  end if;
  if not t.is_open then
    return jsonb_build_object('id', t.id, 'title', t.title, 'name', s.full_name, 'closed', true);
  end if;

  return jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'name', s.full_name,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options,
                           'figure', q.figure, 'option_figures', q.option_figures)
        order by array_position(t.question_ids, q.id)
      )
      from public.questions q
      where q.id = any(t.question_ids) and q.teacher_id = t.teacher_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_submit_test(p_code text, p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.students%rowtype;
  t public.tests%rowtype;
  q record;
  v_score int := 0;
  v_total int := 0;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'Link etibarsızdır';
  end if;
  select * into t from public.tests where id = p_test_id and class_id = s.class_id;
  if not found or not t.is_open then
    raise exception 'Bu test bağlıdır';
  end if;
  if exists (select 1 from public.submissions where test_id = t.id and student_id = s.id) then
    raise exception 'Bu testi artıq göndərmisiniz';
  end if;

  for q in
    select id, qtype, answer from public.questions
    where id = any(t.question_ids) and teacher_id = t.teacher_id
  loop
    if q.qtype = 'mcq' then
      v_total := v_total + 1;
      if lower(btrim(coalesce(p_answers ->> (q.id::text), ''))) = lower(btrim(q.answer)) then
        v_score := v_score + 1;
      end if;
    end if;
  end loop;

  insert into public.submissions (test_id, student_id, student_name, answers, score, total)
  values (t.id, s.id, s.full_name, coalesce(p_answers, '{}'::jsonb), v_score, v_total);

  return jsonb_build_object('score', v_score, 'total', v_total);
end;
$$;

grant execute on function public.student_portal(text) to anon, authenticated;
grant execute on function public.student_get_test(text, uuid) to anon, authenticated;
grant execute on function public.student_submit_test(text, uuid, jsonb) to anon, authenticated;
