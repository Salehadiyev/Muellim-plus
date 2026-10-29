-- Müəllim+ baza sınaqları. Hər yoxlama uğursuz olsa "FAIL: ..." ilə dayanır.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as
  $$ begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean, text) to anon, authenticated;
-- xəta gözlənilən əməliyyat
create or replace function public.t_err(q text, m text) returns void language plpgsql as
  $$ begin execute q; raise exception 'FAIL: xəta gözlənilirdi: %', m; exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end $$;
grant execute on function public.t_err(text, text) to anon, authenticated;

-- ---------- məlumat ----------
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@x.az', now() - interval '3 day'),
  ('00000000-0000-4000-8000-0000000000a2', 'diger@x.az', now() - interval '2 day');
-- 008 mövcud hesabları təsdiqləyir; burada sonradan yaradılan hesablar üçün triggeri yoxlayırıq
insert into public.teacher_access (user_id, email, approved, is_admin) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@x.az', true, true),
  ('00000000-0000-4000-8000-0000000000a2', 'diger@x.az', true, false) on conflict (user_id) do update set approved = excluded.approved, is_admin = excluded.is_admin;
insert into public.classes (id, teacher_id, name) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', '11A'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2', '9B');
insert into public.students (id, class_id, full_name, access_code) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 'Əli', 'AAAAAAAA'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c1', 'Nərgiz', 'BBBBBBBB'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c2', 'Başqa', 'CCCCCCCC');
insert into public.questions (id, teacher_id, body, options, answer, qtype) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', '1+1', '["1","2","3","4","5"]', '2', 'mcq'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', '2+2', '["2","3","4","5","6"]', '4', 'mcq');
insert into public.tests (id, teacher_id, class_id, title, question_ids, review_mode, time_limit_min, due_at, student_id, is_open) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'A', '{00000000-0000-4000-8000-0000000000e1,00000000-0000-4000-8000-0000000000e2}', 'after_submit', null, null, null, true),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'B', '{00000000-0000-4000-8000-0000000000e1}', 'after_close', null, null, null, true),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Vaxtlı', '{00000000-0000-4000-8000-0000000000e1}', 'never', 1, null, null, true),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Gecikmiş', '{00000000-0000-4000-8000-0000000000e1}', 'never', null, now() - interval '1 hour', null, true),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Əli üçün', '{00000000-0000-4000-8000-0000000000e1}', 'after_submit', null, null, '00000000-0000-4000-8000-0000000000b1', true);

-- ---------- müəllimlər bir-birini görmür (RLS) ----------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select t_ok((select count(*) from classes) = 1, 'müəllim yalnız öz sinfini görür');
select t_ok((select count(*) from questions) = 0, 'başqa müəllimin sualları görünmür');
select t_ok((select count(*) from students) = 1, 'başqa sinfin şagirdləri görünmür');
select t_ok((select count(*) from tests) = 0, 'başqa müəllimin testləri görünmür');
update tests set title = 'oğurlandı' where id = '00000000-0000-4000-8000-0000000000f1';
select t_err($q$ insert into tests (teacher_id, class_id, title) values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1', 'x') $q$, 'başqasının sinfinə test');
select t_err($q$ update teacher_access set approved = true, is_admin = true where user_id = auth.uid() $q$, 'adi müəllim özünü admin edə bilmir') where false; -- update RLS-də sadəcə 0 sətir olur, aşağıda yoxlanılır
update teacher_access set is_admin = true, daily_limit_usd = 999 where user_id = auth.uid();
select t_ok((select not is_admin and daily_limit_usd < 999 from teacher_access where user_id = auth.uid()), 'özünü admin edə və limitini qaldıra bilmir');
select t_err('select admin_teachers()', 'admin olmayan admin siyahısını görə bilmir');
reset role;
select t_ok((select title from tests where id = '00000000-0000-4000-8000-0000000000f1') = 'A', 'başqasının testi dəyişmədi');

-- ---------- anonim istifadəçi cədvəlləri görmür ----------
set role anon;
reset request.jwt.claim.sub;
select t_ok((select count(*) from questions) = 0, 'anon sualları (cavablarla) görmür');
select t_ok((select count(*) from students) = 0, 'anon şagird siyahısını görmür');
select t_ok((select count(*) from submissions) = 0, 'anon nəticələri görmür');

-- ---------- şagird kabineti ----------
select t_ok(student_portal('XXXXXXXX') is null, 'yanlış kod');
select t_ok(student_portal('aaaaaaaa') ->> 'name' = 'Əli', 'kiçik hərflə kod');
select t_ok(jsonb_array_length(student_portal('AAAAAAAA') -> 'tests') = 5, 'Əli 5 test görür (fərdi daxil)');
select t_ok(jsonb_array_length(student_portal('BBBBBBBB') -> 'tests') = 4, 'Nərgiz fərdi testi görmür');
select t_ok(student_get_test('BBBBBBBB', '00000000-0000-4000-8000-0000000000f5') is null, 'başqasının fərdi testi açılmır');
select t_ok(student_get_test('CCCCCCCC', '00000000-0000-4000-8000-0000000000f1') is null, 'başqa sinfin testi açılmır');
select t_ok(get_test_for_student('00000000-0000-4000-8000-0000000000f5') is null, 'fərdi test ümumi linklə açılmır');
select t_ok(student_get_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f1')::text not like '%"answer"%', 'testdə cavab açarı yoxdur');
select t_ok(get_test_for_student('00000000-0000-4000-8000-0000000000f1')::text not like '%"answer"%', 'ümumi linkdə cavab açarı yoxdur');
select t_ok((student_submit_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f1', '{"00000000-0000-4000-8000-0000000000e1":"2","00000000-0000-4000-8000-0000000000e2":"5"}') ->> 'score')::int = 1, 'bal serverdə hesablanır');
select t_err($q$ select student_submit_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f1', '{}') $q$, 'eyni testi ikinci dəfə göndərmək olmur');
select t_ok((student_review('AAAAAAAA', '00000000-0000-4000-8000-0000000000f1') ->> 'allowed')::boolean, 'göndərən kimi səhvlərə baxış');
select t_ok(student_review('BBBBBBBB', '00000000-0000-4000-8000-0000000000f1') is null, 'yazmayan şagird baxışı görmür');
select student_submit_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f2', '{}');
select t_ok(not (student_review('AAAAAAAA', '00000000-0000-4000-8000-0000000000f2') ->> 'allowed')::boolean, 'bağlananda rejimi: test açıqkən gizli');
select t_ok(student_review('AAAAAAAA', '00000000-0000-4000-8000-0000000000f2')::text not like '%"answer"%', 'gizli rejimdə cavab yoxdur');
select t_ok((student_get_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f4') ->> 'overdue')::boolean, 'son tarix keçib');
select t_err($q$ select student_submit_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f4', '{}') $q$, 'son tarixdən sonra qəbul edilmir');
select t_ok((student_submit_test('BBBBBBBB', '00000000-0000-4000-8000-0000000000f3', '{}') ->> 'late')::boolean, 'başlamadan göndərilən vaxtlı test gecikmiş sayılır');
select t_ok(student_start_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f3') ->> 'started_at' = student_start_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f3') ->> 'started_at', 'başlama anı bir dəfə yazılır');
select t_ok(not (student_submit_test('AAAAAAAA', '00000000-0000-4000-8000-0000000000f3', '{}') ->> 'late')::boolean, 'vaxtında göndərilən gecikmiş deyil');
select t_ok((submit_test('00000000-0000-4000-8000-0000000000f1', 'Qonaq', '{"00000000-0000-4000-8000-0000000000e1":"2"}') ->> 'score')::int = 1, 'ümumi link işləyir');
select t_err($q$ select submit_test('00000000-0000-4000-8000-0000000000f5', 'Qonaq', '{}') $q$, 'fərdi testə ümumi linklə göndərmək olmur');

-- ---------- təsdiq və limit ----------
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a3', 'yeni@x.az');
select t_ok((select not approved from teacher_access where email = 'yeni@x.az'), 'yeni qeydiyyat təsdiq gözləyir');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a3';
select t_ok(not (ai_gate() ->> 'approved')::boolean, 'ai_gate: təsdiqsiz');
update teacher_access set approved = true where user_id = auth.uid();
select t_ok(not (ai_gate() ->> 'approved')::boolean, 'özünü təsdiqləyə bilmir');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
update teacher_access set approved = true where email = 'yeni@x.az';
select t_ok(jsonb_array_length(admin_teachers()) = 3, 'admin hamını görür');
reset role;
select t_ok((select approved from teacher_access where email = 'yeni@x.az'), 'admin təsdiqlədi');

-- ---------- 009: göndərmə qoruması, ölçü, səhv jurnalı ----------
set role anon;
reset request.jwt.claim.sub;
select t_err($q$ select submit_test('00000000-0000-4000-8000-0000000000f1', ' qonaq ', '{}') $q$, 'ümumi linkdə eyni adla ikinci göndərmə');
select t_err($q$ select student_submit_test('BBBBBBBB', '00000000-0000-4000-8000-0000000000f1', jsonb_build_object('x', repeat('a', 70000))) $q$, 'həddən böyük cavab qəbul edilmir');
insert into app_errors (source, message, url) values ('student', 'sınaq xətası', '/t/x');
select t_ok((select count(*) from app_errors) = 0, 'anon jurnalı oxuya bilmir');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
insert into app_errors (message) values ('müəllim xətası');
select t_ok((select count(*) from app_errors) = 0, 'adi müəllim jurnalı oxuya bilmir');
select t_err($q$ insert into app_errors (message, user_id) values ('saxta', '00000000-0000-4000-8000-0000000000a1') $q$, 'başqasının adından jurnal yazısı');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t_ok((select count(*) from app_errors) = 2, 'admin jurnalı görür');
reset role;
insert into app_errors (message) select 'axın ' || g from generate_series(1, 60) g;
select t_ok((select count(*) from app_errors) <= 32, 'dəqiqədə 30-dan çox jurnal yazısı atılır');
select t_err($q$ insert into questions (teacher_id, body, answer) values ('00000000-0000-4000-8000-0000000000a1', repeat('x', 20001), '1') $q$, 'həddən uzun sual mətni');

-- ---------- 009: təsdiqsiz yazı, mənfi xərc ----------
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a4', 'spam@x.az');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a4';
select t_err($q$ insert into classes (teacher_id, name) values (auth.uid(), 'spam') $q$, 'təsdiqsiz hesab sinif yarada bilmir');
select t_err($q$ insert into questions (teacher_id, body, answer) values (auth.uid(), 'spam', '1') $q$, 'təsdiqsiz hesab sual yaza bilmir');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select t_err($q$ insert into ai_usage (teacher_id, action, model, cost_usd) values (auth.uid(), 'x', 'opus', -100) $q$, 'mənfi xərc yazmaq olmur');
insert into ai_usage (teacher_id, action, model, cost_usd) values (auth.uid(), 'x', 'opus', 0.5);
insert into classes (teacher_id, name) values (auth.uid(), 'Təsdiqli müəllimin sinfi');
select t_ok((select count(*) from classes) = 2, 'təsdiqli müəllim normal yazır');
reset role;

\echo 'NO ERRORS: bütün baza yoxlamaları keçdi'
