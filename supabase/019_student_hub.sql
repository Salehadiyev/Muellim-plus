-- Müəllim+ · 019: tələbə portalı, material qeydləri və müəllimə suallar
create table if not exists public.material_progress (
 student_id uuid references public.students(id) on delete cascade,
 note_id uuid references public.lesson_notes(id) on delete cascade,
 completed boolean not null default false, updated_at timestamptz not null default now(),
 primary key(student_id,note_id)
);
create table if not exists public.student_questions (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
 test_id uuid references public.tests(id) on delete cascade, question_id uuid references public.questions(id) on delete cascade,
 note_id uuid references public.lesson_notes(id) on delete cascade,
 body text not null check(char_length(body) between 1 and 2000),
 reply text check(char_length(reply)<=4000), replied_at timestamptz, created_at timestamptz not null default now(),
 check((note_id is not null and test_id is null and question_id is null) or (note_id is null and test_id is not null and question_id is not null))
);
create index if not exists student_questions_student_idx on public.student_questions(student_id,created_at desc);
alter table public.material_progress enable row level security;
alter table public.student_questions enable row level security;
drop policy if exists "teacher progress" on public.material_progress;
create policy "teacher progress" on public.material_progress for select to authenticated using(exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student_id and c.teacher_id=auth.uid()));
drop policy if exists "teacher questions" on public.student_questions;
create policy "teacher questions" on public.student_questions for select to authenticated using(exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student_id and c.teacher_id=auth.uid()));
drop policy if exists "teacher replies" on public.student_questions;
create policy "teacher replies" on public.student_questions for update to authenticated using(exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student_id and c.teacher_id=auth.uid())) with check(public.is_approved() and exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student_id and c.teacher_id=auth.uid()));
revoke all on public.material_progress,public.student_questions from anon,authenticated;
grant select on public.material_progress,public.student_questions to authenticated;
grant update(reply,replied_at) on public.student_questions to authenticated;

create or replace function public.student_material_done(p_code text,p_note_id uuid,p_completed boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype;
begin
 select * into s from public.students where access_code=upper(btrim(coalesce(p_code,'')));
 if not found then raise exception 'Link etibarsızdır'; end if;
 if not exists(select 1 from public.lesson_notes n join public.classes c on c.id=s.class_id where n.id=p_note_id and n.teacher_id=c.teacher_id and (n.student_id=s.id or (n.student_id is null and n.class_id=s.class_id))) then raise exception 'Material tapılmadı'; end if;
 insert into public.material_progress values(s.id,p_note_id,p_completed,now()) on conflict(student_id,note_id) do update set completed=excluded.completed,updated_at=excluded.updated_at;
end $$;

create or replace function public.student_ask(p_code text,p_body text,p_test_id uuid default null,p_question_id uuid default null,p_note_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype; v_id uuid;
begin
 select * into s from public.students where access_code=upper(btrim(coalesce(p_code,'')));
 if not found then raise exception 'Link etibarsızdır'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Sual 1–2000 simvol olmalıdır'; end if;
 if p_note_id is not null then
  if p_test_id is not null or p_question_id is not null or not exists(select 1 from public.lesson_notes n join public.classes c on c.id=s.class_id where n.id=p_note_id and n.teacher_id=c.teacher_id and (n.student_id=s.id or (n.student_id is null and n.class_id=s.class_id))) then raise exception 'Material tapılmadı'; end if;
 else
  if not exists(select 1 from public.tests t join public.classes c on c.id=s.class_id join public.questions q on q.id=p_question_id and q.teacher_id=t.teacher_id where t.id=p_test_id and t.teacher_id=c.teacher_id and t.class_id=s.class_id and (t.student_id is null or t.student_id=s.id) and q.id=any(t.question_ids)) then raise exception 'Sual tapılmadı'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(s.id::text,19));
 if (select count(*) from public.student_questions where student_id=s.id and created_at>now()-interval '1 day')>=20 then raise exception 'Bu gün üçün 20 sual limiti doldu'; end if;
 insert into public.student_questions(student_id,test_id,question_id,note_id,body) values(s.id,p_test_id,p_question_id,p_note_id,btrim(p_body)) returning id into v_id;
 return v_id;
end $$;

create or replace function public.student_hub(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype; c public.classes%rowtype;
begin
 select * into s from public.students where access_code=upper(btrim(coalesce(p_code,'')));
 if not found then raise exception 'Link etibarsızdır'; end if;
 select * into c from public.classes where id=s.class_id;
 return jsonb_build_object('schedule',c.schedule,
 'progress',coalesce((select jsonb_agg(jsonb_build_object('note_id',p.note_id,'completed',p.completed)) from public.material_progress p join public.lesson_notes n on n.id=p.note_id where p.student_id=s.id and n.teacher_id=c.teacher_id and (n.student_id=s.id or (n.student_id is null and n.class_id=s.class_id))),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'reply',m.reply,'replied_at',m.replied_at,'created_at',m.created_at,'note_id',m.note_id,'test_id',m.test_id,'question_id',m.question_id) order by m.created_at desc) from (select * from public.student_questions where student_id=s.id order by created_at desc limit 100) m),'[]'::jsonb),
 'related',coalesce((select jsonb_agg(jsonb_build_object('note_id',n.id,'test_id',t.id)) from public.lesson_notes n join public.tests t on t.class_id=s.class_id and t.teacher_id=c.teacher_id and (t.student_id is null or t.student_id=s.id) where n.teacher_id=c.teacher_id and (n.student_id=s.id or (n.student_id is null and n.class_id=s.class_id)) and nullif(btrim(n.topic),'') is not null and exists(select 1 from public.questions q where q.id=any(t.question_ids) and q.teacher_id=c.teacher_id and lower(btrim(q.topic))=lower(btrim(n.topic)))),'[]'::jsonb));
end $$;
revoke all on function public.student_material_done(text,uuid,boolean),public.student_ask(text,text,uuid,uuid,uuid),public.student_hub(text) from public;
grant execute on function public.student_material_done(text,uuid,boolean),public.student_ask(text,text,uuid,uuid,uuid),public.student_hub(text) to anon,authenticated;
