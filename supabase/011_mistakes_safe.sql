-- Müəllim+ · 11-ci yeniləmə: səhv dəftəri — cavab sızmasın + köhnə səhvlər
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- 1) Şagirdə təkrar üçün AÇIQ testdəki sual verilmir (cavabı hələ gizlidir), istisna: şagird həmin testi
--    yazıb və test "göndərən kimi göstər" rejimindədir. Uyğun sual yoxdursa, təkrar test bağlanana qədər gözləyir.
-- 2) Bu yeniləmədən əvvəl göndərilmiş testlərdəki səhvlər də dəftərə yazılır (bir dəfə; düzəldilmişlər qayıtmır).

create or replace function public.practice_safe(p_q uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    join public.tests t on t.teacher_id = c.teacher_id and (t.class_id is null or t.class_id = s.class_id)
    where s.id = p_student and t.is_open and p_q = any(t.question_ids)
      and not (coalesce(t.review_mode, 'never') = 'after_submit'
               and exists (select 1 from public.submissions x where x.test_id = t.id and x.student_id = p_student))
  )
$$;
revoke execute on function public.practice_safe(uuid, uuid) from public, anon, authenticated;

create or replace function public.pick_practice(p_mistake uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.mistakes%rowtype;
  o public.questions%rowtype;
  v uuid;
begin
  select * into m from public.mistakes where id = p_mistake;
  if not found then return null; end if;
  select * into o from public.questions where id = m.question_id;
  if not found then return null; end if;
  select q.id into v from public.questions q
  where q.teacher_id = m.teacher_id and q.id <> o.id and q.qtype = 'mcq'
    and not (q.id = any(m.seen))
    and (q.teacher_approved is true or q.ai_status = 'passed' or (q.ai_status is null and q.verified is not false))
    and (q.similar_to = o.id or o.similar_to = q.id or (o.topic is not null and o.topic <> '' and q.topic = o.topic))
    and public.practice_safe(q.id, m.student_id)
  order by (q.similar_to = o.id or o.similar_to = q.id) desc nulls last,
           (q.subtype is not distinct from o.subtype) desc,
           (q.difficulty is not distinct from o.difficulty) desc,
           random()
  limit 1;
  if v is null and public.practice_safe(o.id, m.student_id) then v := o.id; end if;
  return v; -- null: hələ verilə biləcək sual yoxdur (test bağlananda yenidən yoxlanılır)
end;
$$;
revoke execute on function public.pick_practice(uuid) from public, anon, authenticated;

create or replace function public.student_mistakes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  r record;
  items jsonb := '[]'::jsonb;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  -- təyin edilmiş sual sonradan açıq testə düşübsə, yenisi seçilir
  update public.mistakes set practice_id = null
  where student_id = s.id and status = 'open' and practice_id is not null and not public.practice_safe(practice_id, s.id);
  for r in select id from public.mistakes where student_id = s.id and status = 'open' and due_at <= now() and practice_id is null loop
    update public.mistakes set practice_id = public.pick_practice(r.id) where id = r.id;
  end loop;
  select coalesce(jsonb_agg(x order by x ->> 'due_at'), '[]'::jsonb) into items from (
    select jsonb_build_object('id', m.id, 'attempts', m.attempts, 'due_at', m.due_at,
      'question', jsonb_build_object('id', q.id, 'body', q.body, 'qtype', q.qtype, 'options', q.options, 'figure', q.figure,
        'option_figures', q.option_figures, 'exam', q.exam, 'topic', q.topic)) as x
    from public.mistakes m join public.questions q on q.id = m.practice_id
    where m.student_id = s.id and m.status = 'open' and m.due_at <= now()
    order by m.due_at limit 10
  ) z;
  return jsonb_build_object(
    'name', s.full_name,
    'items', items,
    'open', (select count(*) from public.mistakes where student_id = s.id and status = 'open'),
    'due', (select count(*) from public.mistakes where student_id = s.id and status = 'open' and due_at <= now() and practice_id is not null),
    'next_at', (select min(due_at) from public.mistakes where student_id = s.id and status = 'open' and due_at > now()),
    'cleared', (select count(*) from public.mistakes where student_id = s.id and status = 'cleared'));
end;
$$;

create or replace function public.student_answer_mistake(p_code text, p_mistake uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  m public.mistakes%rowtype;
  q public.questions%rowtype;
  ok boolean;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
  select * into m from public.mistakes where id = p_mistake and student_id = s.id and status = 'open' and due_at <= now() for update;
  if not found or m.practice_id is null then raise exception 'Bu sual artıq dəftərdə deyil'; end if;
  if not public.practice_safe(m.practice_id, s.id) then raise exception 'Bu sual hələ açıq testdədir, sonra təkrar edin'; end if;
  select * into q from public.questions where id = m.practice_id;
  if not found then raise exception 'Sual tapılmadı'; end if;
  ok := lower(btrim(coalesce(p_answer, ''))) = lower(btrim(q.answer));
  if ok then
    update public.mistakes set status = 'cleared', cleared_at = now(), attempts = attempts + 1, seen = array_append(seen, q.id) where id = m.id;
  else
    update public.mistakes set attempts = attempts + 1, seen = array_append(seen, q.id), practice_id = null, due_at = now() + interval '2 days' where id = m.id;
  end if;
  return jsonb_build_object('correct', ok, 'answer', q.answer, 'solution', q.solution);
end;
$$;

grant execute on function public.student_mistakes(text) to anon, authenticated;
grant execute on function public.student_answer_mistake(text, uuid, text) to anon, authenticated;

-- Köhnə testlərdəki səhvlər (yalnız dəftərdə heç olmayanlar; düzəldilmişlər qayıtmır)
insert into public.mistakes (teacher_id, student_id, question_id, test_id)
select distinct on (x.student_id, q.id) t.teacher_id, x.student_id, q.id, t.id
from public.submissions x
join public.tests t on t.id = x.test_id
join public.questions q on q.id = any(t.question_ids) and q.teacher_id = t.teacher_id and q.qtype = 'mcq'
where x.student_id is not null
  and btrim(coalesce(x.answers ->> (q.id::text), '')) <> ''
  and lower(btrim(x.answers ->> (q.id::text))) <> lower(btrim(q.answer))
  and not exists (select 1 from public.mistakes m where m.student_id = x.student_id and m.question_id = q.id)
order by x.student_id, q.id, x.created_at desc
on conflict do nothing;
