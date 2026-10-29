// Tələbə analizi, deneme nəticələri, imtahan tarixi, dərs qeydləri (müəllim yükləyir → tələbə görür); 012 olmadan sınmır
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const q = (id, topic, ans) => ({ id, teacher_id: 'u1', body: 'Sual ' + id, qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: ans, option_figures: [], topic, created_at: ago(30) });
const QS = [q('f1', 'Fonksiyonlar', '2'), q('f2', 'Fonksiyonlar', '3'), q('f3', 'Fonksiyonlar', '4'), q('k1', 'Kümeler', '1'), q('k2', 'Kümeler', '2'), q('s1', 'Sayılar', '5')];
const T6 = QS.map((x) => x.id);
const sub = (id, test, ans, score, d) => ({ id, test_id: test, student_id: 's1', student_name: 'Əli Həsənov', answers: ans, score, total: 6, created_at: ago(d) });
const DB = {
  classes: [{ id: 'c1', name: '11A', teacher_id: 'u1', exam_date: null }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }],
  questions: QS,
  tests: [
    { id: 'd1', teacher_id: 'u1', class_id: 'c1', title: 'Deneme 1', kind: 'deneme', question_ids: T6, is_open: false, review_mode: 'after_close', created_at: ago(10) },
    { id: 'd2', teacher_id: 'u1', class_id: 'c1', title: 'Deneme 2', kind: 'deneme', question_ids: T6, is_open: false, review_mode: 'after_close', created_at: ago(5) },
    { id: 'h1', teacher_id: 'u1', class_id: 'c1', title: 'Ev tapşırığı', question_ids: T6, is_open: true, review_mode: 'after_close', created_at: ago(2) }],
  submissions: [
    sub('x1', 'd1', { f1: '1', f2: '1', f3: '4', k1: '1', k2: '', s1: '5' }, 3, 9),
    sub('x2', 'd2', { f1: '2', f2: '1', f3: '1', k1: '1', k2: '2', s1: '5' }, 4, 4),
    sub('x3', 'h1', { f1: '2', f2: '3', f3: '4', k1: '1', k2: '2', s1: '5' }, 6, 1)],
  ai_usage: [], mistakes: [], lesson_notes: []
};
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1300 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname === 'files.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (d) => p.evaluate((x) => localStorage.setItem('mockdb', JSON.stringify(x)), d);
  await p.goto('http://app.test/'); await setDb(DB);
  console.log('login only:', !(await p.isVisible('text=qeydiyyat')) && await p.isVisible('text=Daxil ol'));
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  // müəllim: imtahan tarixi + qeydlər
  await p.goto('http://app.test/#/class/c1'); await p.reload(); await p.waitForSelector('#examDate');
  const exam = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  await p.fill('#examDate', exam); await p.click('#saveExam'); await p.waitForSelector('text=Yadda saxlandı');
  console.log('exam saved:', (await db()).classes[0].exam_date === exam, '|', (await p.textContent('#examLeft')).trim());
  await p.click('[data-ctab=nt]'); await p.waitForSelector('#ntNew'); await p.click('#ntNew');
  await p.fill('#ntForm input[name=title]', 'Fonksiyonlar — 1-ci dərs'); await p.fill('#ntForm input[name=topic]', 'Fonksiyonlar');
  await p.fill('#ntForm textarea[name=body]', 'f(x) = 2x + 1 tərifi'); await p.setInputFiles('#ntForm input[name=file]', path.join(FX, 'book.pdf'));
  await p.click('#ntForm button[type=submit]'); await p.waitForSelector('#ntPane .nt-item');
  await p.click('#ntNew'); await p.fill('#ntForm input[name=title]', 'Əli üçün tapşırıq'); await p.selectOption('#ntForm select[name=to]', 's1'); await p.fill('#ntForm textarea[name=body]', 'Kümeler təkrar');
  await p.click('#ntForm button[type=submit]'); await p.waitForFunction(() => document.querySelectorAll('#ntPane .nt-item').length === 2);
  let d = await db();
  console.log('notes saved:', d.lesson_notes.map((n) => `${n.title}|${n.class_id || '-'}|${n.student_id || '-'}|${n.file_path ? n.file_path.split('/')[0] + '/*.' + n.file_path.split('.').pop() : '-'}`).join(' ; '), '| files:', (d._files || []).length);
  console.log('teacher list:', await p.$$eval('#ntPane .nt-meta', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  await p.screenshot({ path: path.join(T, 'in1-teacher-notes.png'), fullPage: true });
  await p.goto('http://app.test/#/newtest'); await p.waitForSelector('#newTest select[name=kind]');
  console.log('kind options:', await p.$$eval('#newTest select[name=kind] option', (x) => x.map((o) => o.value).join(',')));
  await p.goto('http://app.test/#/tests'); await p.waitForSelector('.tcard'); await p.click('[data-f=all]');
  console.log('deneme tags:', await p.$$eval('.tcard .tag.deneme', (x) => x.length));
  // tələbə
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('.exam-chip');
  console.log('exam chip:', (await p.textContent('.exam-chip span')).trim());
  console.log('deneme rows:', await p.$$eval('.deneme-card .dn-row', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  console.log('deneme trend:', (await p.textContent('.deneme-card .tag')).trim(), '| bars:', await p.$$eval('.deneme-card .spark-b', (x) => x.length));
  console.log('topics:', await p.$$eval('.sbar', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  console.log('weak:', (await p.textContent('.weak-box')).replace(/\s+/g, ' ').trim());
  console.log('student notes:', await p.$$eval('details.nt-item .nt-head strong', (x) => x.map((e) => e.textContent).join(' | ')));
  await p.click('.weak-box [data-nt]'); await p.waitForTimeout(300);
  console.log('note opened:', await p.$eval('details.nt-item[open] strong', (e) => e.textContent), '| hash:', await p.evaluate(() => location.hash), '| pdf link:', await p.$eval('details.nt-item[open] a.btn', (e) => e.href.includes('/storage/v1/object/public/notes/u1/')));
  await p.screenshot({ path: path.join(T, 'in2-student.png'), fullPage: true });
  await p.goto('http://app.test/#/s/NRG23456'); await p.waitForSelector('text=Nəticələrim');
  console.log('other student notes:', await p.$$eval('details.nt-item', (x) => x.length), '| no analysis:', !(await p.$('.deneme-card')));
  // 012 olmayan baza
  d = await db(); delete d.lesson_notes; d.classes.forEach((c) => delete c.exam_date); await setDb(d);
  await p.goto('http://app.test/#/s/ALI23456?z'); await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('text=Nəticələrim');
  console.log('no 012 portal:', !(await p.$('.exam-chip')) && !(await p.$('details.nt-item')));
  await p.setViewportSize({ width: 1024, height: 900 });
  await p.goto('http://app.test/#/class/c1'); await p.reload(); await p.click('[data-ctab=nt]'); await p.waitForSelector('#ntPane .notice');
  console.log('no 012 teacher:', (await p.textContent('#ntPane .notice')).includes('012_student_insights.sql'));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
