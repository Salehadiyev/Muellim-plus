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

-- ---------- 010: səhv dəftəri ----------
reset role;
select t_ok((select count(*) from mistakes where student_id = '00000000-0000-4000-8000-0000000000b1' and status = 'open') = 1, 'səhv cavab dəftərə düşdü, boş cavab düşmədi');
select t_ok((select question_id from mistakes where student_id = '00000000-0000-4000-8000-0000000000b1') = '00000000-0000-4000-8000-0000000000e2', 'düz cavablanan sual dəftərdə deyil');
select t_ok((select count(*) from mistakes where student_id = '00000000-0000-4000-8000-0000000000b2') = 0, 'boş göndərilən test dəftər yaratmır');
insert into questions (id, teacher_id, body, options, answer, qtype, similar_to, ai_status) values
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1', '3+3', '["5","6","7","8","9"]', '6', 'mcq', '00000000-0000-4000-8000-0000000000e2', 'passed');
select id as mid from mistakes where student_id = '00000000-0000-4000-8000-0000000000b1' \gset
set role anon;
reset request.jwt.claim.sub;
select t_ok(jsonb_array_length(student_mistakes('AAAAAAAA') -> 'items') = 0 and (student_mistakes('AAAAAAAA') ->> 'open')::int = 1, 'təkrar bir gün sonra açılır');
reset role;
update mistakes set due_at = now() - interval '1 minute' where id = :'mid';
set role anon;
select t_ok(student_mistakes('AAAAAAAA') #>> '{items,0,question,id}' = '00000000-0000-4000-8000-0000000000e3', 'əvvəl həmin sualın bənzəri verilir');
select t_ok(student_mistakes('AAAAAAAA')::text not like '%"answer"%', 'dəftərdə cavab açarı yoxdur');
select t_ok(student_mistakes('BBBBBBBB') -> 'items' = '[]'::jsonb, 'başqa şagird bu dəftəri görmür');
select t_err(format('select student_answer_mistake(%L, %L, %L)', 'CCCCCCCC', :'mid', '6'), 'başqa şagird cavab verə bilmir');
select t_ok(not (student_answer_mistake('AAAAAAAA', :'mid', '5') ->> 'correct')::boolean, 'səhv cavab qəbul olunmur');
select t_ok(jsonb_array_length(student_mistakes('AAAAAAAA') -> 'items') = 0 and (student_mistakes('AAAAAAAA') ->> 'open')::int = 1, 'səhvdən sonra sual dəftərdə qalır, 2 gün sonra');
select t_err(format('select student_answer_mistake(%L, %L, %L)', 'AAAAAAAA', :'mid', '6'), 'vaxtı çatmamış suala cavab olmur');
reset role;
update mistakes set due_at = now() - interval '1 minute' where id = :'mid';
set role anon;
select t_ok(student_mistakes('AAAAAAAA') #>> '{items,0,question,id}' = '00000000-0000-4000-8000-0000000000e2', 'görülən bənzər təkrarlanmır, başqası yoxdursa orijinal');
select t_ok((student_answer_mistake('AAAAAAAA', :'mid', ' 4 ') ->> 'correct')::boolean, 'düz cavab');
select t_ok((student_mistakes('AAAAAAAA') ->> 'open')::int = 0 and (student_mistakes('AAAAAAAA') ->> 'cleared')::int = 1, 'düz tapılan sual dəftərdən silindi');
select t_ok((select count(*) from mistakes) = 0, 'anon dəftər cədvəlini görmür');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select t_ok((select count(*) from mistakes) = 0, 'başqa müəllim dəftəri görmür');
select t_err($q$ insert into mistakes (teacher_id, student_id, question_id) values (auth.uid(), '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000e1') $q$, 'müəllim dəftərə əl ilə yaza bilmir');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t_ok((select count(*) from mistakes) = 1, 'müəllim öz şagirdinin dəftərini görür');
select t_err($q$ update mistakes set status = 'open' $q$, 'müəllim statusu birbaşa dəyişə bilmir');
select t_ok((select status from mistakes) = 'cleared', 'status dəyişmədi');
reset role;

-- ---------- 011: açıq testdəki sualın cavabı dəftərdən sızmır ----------
reset role;
insert into mistakes (teacher_id, student_id, question_id, test_id, due_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f2', now() - interval '1 minute');
set role anon;
select t_ok((student_mistakes('AAAAAAAA') ->> 'due')::int = 0 and jsonb_array_length(student_mistakes('AAAAAAAA') -> 'items') = 0, 'açıq ("bağlananda") testdəki sual təkrara verilmir');
reset role;
select id as mid2 from mistakes where question_id = '00000000-0000-4000-8000-0000000000e1' \gset
update mistakes set practice_id = '00000000-0000-4000-8000-0000000000e1' where id = :'mid2';
set role anon;
select t_err(format('select student_answer_mistake(%L, %L, %L)', 'AAAAAAAA', :'mid2', '2'), 'açıq testdəki suala dəftərdən cavab almaq olmur');
reset role;
update tests set is_open = false where '00000000-0000-4000-8000-0000000000e1' = any(question_ids);
set role anon;
select t_ok(student_mistakes('AAAAAAAA') #>> '{items,0,question,id}' = '00000000-0000-4000-8000-0000000000e1', 'test bağlanandan sonra təkrara verilir');
reset role;

-- ---------- 012: deneme, analiz, dərs qeydləri ----------
reset role;
update tests set is_open = true, kind = 'deneme' where id = '00000000-0000-4000-8000-0000000000f1';
update classes set exam_date = current_date + 30 where id = '00000000-0000-4000-8000-0000000000c1';
update questions set topic = 'Fonksiyonlar' where id = '00000000-0000-4000-8000-0000000000e2';
set role anon;
select t_ok((student_analysis('AAAAAAAA') ->> 'days_left')::int = 30, 'imtahana qalan gün');
select t_ok(exists (select 1 from jsonb_array_elements(student_analysis('AAAAAAAA') -> 'results') r where r ->> 'kind' = 'deneme' and (r ->> 'score')::int = 1 and (r ->> 'empty')::int = 0), 'deneme nəticəsi: bal və boş sayı');
select t_ok(exists (select 1 from jsonb_array_elements(student_analysis('AAAAAAAA') -> 'topics') r where r ->> 'topic' = 'Fonksiyonlar' and (r ->> 'right')::int = 0 and (r ->> 'total')::int = 1), 'mövzu analizi (açıq, göndərən kimi göstər testi)');
select t_ok(not exists (select 1 from jsonb_array_elements(student_analysis('BBBBBBBB') -> 'topics') r where (r ->> 'total')::int > 0 and r ->> 'topic' = 'Fonksiyonlar'), 'başqa tələbənin analizi qarışmır');
reset role;
update tests set review_mode = 'after_close' where id = '00000000-0000-4000-8000-0000000000f1';
set role anon;
select t_ok(not exists (select 1 from jsonb_array_elements(student_analysis('AAAAAAAA') -> 'topics') r where r ->> 'topic' = 'Fonksiyonlar'), 'açıq "bağlananda" testi mövzu analizinə düşmür (cavab sızmır)');
reset role;
update tests set review_mode = 'after_submit' where id = '00000000-0000-4000-8000-0000000000f1';
-- dərs qeydləri: müəllim yazır, öz tələbəsi görür
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
insert into lesson_notes (class_id, title, topic, body) values ('00000000-0000-4000-8000-0000000000c1', 'Fonksiyonlar 1', 'Fonksiyonlar', 'f(x) tərifi');
insert into lesson_notes (student_id, title, body) values ('00000000-0000-4000-8000-0000000000b2', 'Nərgiz üçün', 'fərdi');
select t_err($q$ insert into lesson_notes (class_id, title) values ('00000000-0000-4000-8000-0000000000c2', 'başqasının sinfi') $q$, 'başqasının sinfinə qeyd yazmaq olmur');
select t_err($q$ insert into lesson_notes (title) values ('heç kimə') $q$, 'qeyd sinfə və ya tələbəyə bağlı olmalıdır');
insert into storage.objects (bucket_id, name) values ('notes', auth.uid()::text || '/a.pdf');
select t_err($q$ insert into storage.objects (bucket_id, name) values ('notes', '00000000-0000-4000-8000-0000000000a2/x.pdf') $q$, 'başqasının qovluğuna fayl yazmaq olmur');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select t_ok((select count(*) from lesson_notes) = 0, 'başqa müəllim qeydləri görmür');
delete from storage.objects where bucket_id = 'notes';
set role anon;
reset request.jwt.claim.sub;
select t_ok((select count(*) from lesson_notes) = 0, 'anon qeyd cədvəlini görmür');
select t_err($q$ insert into storage.objects (bucket_id, name) values ('notes', 'x/y.pdf') $q$, 'anon fayl yükləyə bilmir');
select t_ok(jsonb_array_length(student_notes('AAAAAAAA')) = 1, 'Əli yalnız sinif qeydini görür');
select t_ok(jsonb_array_length(student_notes('BBBBBBBB')) = 2, 'Nərgiz sinif + fərdi qeydi görür');
select t_ok(jsonb_array_length(student_notes('CCCCCCCC')) = 0, 'başqa sinif görmür');
reset role;
select t_ok((select count(*) from storage.objects) = 1, 'başqa müəllim faylı silə bilmədi');
select t_ok((select public from storage.buckets where id = 'notes'), 'qeyd qovluğu yaradıldı');

-- ---------- 013: dərs, ödəniş, gizli qeyd, real çətinlik ----------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
update students set lesson_price = 30, teacher_note = 'gizli: üslü sayılarda zəif' where id = '00000000-0000-4000-8000-0000000000b1';
insert into lessons (student_id, status, fee) values ('00000000-0000-4000-8000-0000000000b1', 'came', 30), ('00000000-0000-4000-8000-0000000000b1', 'missed', 0);
insert into payments (student_id, amount) values ('00000000-0000-4000-8000-0000000000b1', 20);
select t_err($q$ insert into payments (student_id, amount) values ('00000000-0000-4000-8000-0000000000b1', -5) $q$, 'mənfi ödəniş olmur');
select t_err($q$ insert into lessons (student_id) values ('00000000-0000-4000-8000-0000000000b3') $q$, 'başqasının tələbəsinə dərs yazmaq olmur');
select t_ok((select sum(fee) from lessons) - (select sum(amount) from payments) = 10, 'borc hesablanır');
select t_ok(exists (select 1 from question_stats() where question_id = '00000000-0000-4000-8000-0000000000e2' and attempts >= 1), 'real nəticə statistikası');
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select t_ok((select count(*) from lessons) = 0 and (select count(*) from payments) = 0, 'başqa müəllim dərs və ödənişləri görmür');
select t_ok((select count(*) from question_stats()) = 0, 'başqa müəllim statistikanı görmür');
select t_ok((select count(*) from students where teacher_note is not null) = 0, 'başqa müəllim gizli qeydi görmür');
set role anon;
reset request.jwt.claim.sub;
select t_ok((select count(*) from lessons) = 0 and (select count(*) from payments) = 0, 'anon dərs/ödəniş görmür');
select t_ok(student_portal('AAAAAAAA')::text not like '%gizli%' and student_portal('AAAAAAAA')::text not like '%lesson_price%', 'tələbə gizli qeydi və qiyməti görmür');
select t_ok(student_analysis('AAAAAAAA')::text not like '%gizli%' and student_mistakes('AAAAAAAA')::text not like '%gizli%', 'tələbə funksiyaları gizli qeydi qaytarmır');
reset role;

\echo 'NO ERRORS: bütün baza yoxlamaları keçdi'
