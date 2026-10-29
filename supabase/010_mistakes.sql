-- Müəllim+ · 10-cu yeniləmə: səhv dəftəri
-- Supabase → SQL Editor → New query → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir.
-- Şagird testdə səhv etdiyi sual dəftərinə düşür. Bir gün sonra ona həmin sualın BƏNZƏRİ verilir
-- (bankdan: əvvəl müəllimin AI ilə hazırladığı bənzər, sonra eyni mövzu/tip). Düz tapsa dəftərdən silinir,
-- səhv etsə 2 gün sonra başqa bənzəri gəlir.

-- Sualın hansı sualın bənzəri olduğu (AI ilə hazırlanan bənzərlər üçün)
alter table public.questions add column if not exists similar_to uuid references public.questions(id) on delete set null;
create index if not exists questions_similar_idx on public.questions(similar_to) where similar_to is not null;

create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  test_id uuid references public.tests(id) on delete set null,
  practice_id uuid references public.questions(id) on delete set null,
  seen uuid[] not null default '{}',
  attempts int not null default 0,
  status text not null default 'open' check (status in ('open', 'cleared')),
  due_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create unique index if not exists mistakes_open_uniq on public.mistakes(student_id, question_id) where status = 'open';
create index if not exists mistakes_student_idx on public.mistakes(student_id, status, due_at);
create index if not exists mistakes_teacher_idx on public.mistakes(teacher_id, status);

alter table public.mistakes enable row level security;
-- Müəllim yalnız öz şagirdlərinin dəftərini görür və sətir silə bilər (yazmaq yalnız aşağıdakı funksiyalarla)
drop policy if exists "own mistakes read" on public.mistakes;
create policy "own mistakes read" on public.mistakes for select to authenticated using (teacher_id = auth.uid());
drop policy if exists "own mistakes delete" on public.mistakes;
create policy "own mistakes delete" on public.mistakes for delete to authenticated using (teacher_id = auth.uid());
revoke insert, update on public.mistakes from anon, authenticated;

-- Test göndəriləndə səhv cavablanan suallar dəftərə yazılır (boş saxlananlar yox)
create or replace function public.record_mistakes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tests%rowtype;
  q record;
  v text;
begin
  if new.student_id is null then return new; end if;
  select * into t from public.tests where id = new.test_id;
  if not found then return new; end if;
  for q in select id, answer from public.questions where id = any(t.question_ids) and teacher_id = t.teacher_id and qtype = 'mcq' loop
    v := btrim(coalesce(new.answers ->> (q.id::text), ''));
    if v <> '' and lower(v) <> lower(btrim(q.answer)) then
      insert into public.mistakes (teacher_id, student_id, question_id, test_id)
      values (t.teacher_id, new.student_id, q.id, t.id) on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists submissions_mistakes on public.submissions;
create trigger submissions_mistakes after insert on public.submissions for each row execute function public.record_mistakes();

-- Təkrar üçün sual seç: əvvəl bu sualın bənzəri, sonra eyni mövzu və tip, sonra eyni mövzu; görülənlər yox.
-- Heç nə tapılmasa — orijinal sualın özü.
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
  order by (q.similar_to = o.id or o.similar_to = q.id) desc nulls last,
           (q.subtype is not distinct from o.subtype) desc,
           (q.difficulty is not distinct from o.difficulty) desc,
           random()
  limit 1;
  return coalesce(v, o.id);
end;
$$;
revoke execute on function public.pick_practice(uuid) from public, anon, authenticated;

-- Şagird: dəftərin vəziyyəti və təkrar vaxtı çatmış suallar (cavabsız)
create or replace function public.student_mistakes(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
  r record;
  items jsonb := '[]'::jsonb;
begin
  select * into s from public.students where access_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Link etibarsızdır'; end if;
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
    'due', (select count(*) from public.mistakes where student_id = s.id and status = 'open' and due_at <= now()),
    'next_at', (select min(due_at) from public.mistakes where student_id = s.id and status = 'open' and due_at > now()),
    'cleared', (select count(*) from public.mistakes where student_id = s.id and status = 'cleared'));
end;
$$;

-- Şagird cavabı: düzdürsə dəftərdən silinir, səhvdirsə 2 gün sonra başqa bənzəri gəlir
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
