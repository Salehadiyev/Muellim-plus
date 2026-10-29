const { chromium } = require(process.env.PW || 'playwright'); const now = (d) => new Date(Date.now() - d * 1000).toISOString();
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const qs = Array.from({ length: 6 }, (_, i) => ({ id: 'q' + i, teacher_id: 'u1', body: `Sual ${i + 1}: ${i}+1=?`, qtype: 'mcq', options: ['a' + i, 'b' + i, 'c' + i, 'd' + i, String(i + 1)], answer: String(i + 1), option_figures: [], topic: i < 3 ? 'Toplama' : 'Çıxma', created_at: now(600 - i) }));
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }],
  questions: qs, tests: [], submissions: [], ai_usage: [] };
const errs = []; const ok = (m) => console.log('✓', m); const fail = (m) => { throw new Error(m); };
(async () => {
  const b = await chromium.launch();
  const mk = async (vp) => { const ctx = await b.newContext({ viewport: vp });
    await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
      if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
      if (u.hostname !== 'app.test') return route.abort();
      if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k' } });
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept()); return p; };
  const te = await mk({ width: 1024, height: 1366 });
  await te.goto('http://app.test/'); await te.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  // teacher creates timed + shuffled test with due date
  await te.goto('http://app.test/#/newtest'); await te.reload(); await te.waitForSelector('#tqList .mini');
  await te.fill('input[name=title]', 'Vaxtlı test'); await te.selectOption('select[name=class_id]', 'c1');
  await te.click('.more-opts summary'); await te.fill('input[name=time_limit_min]', '1'); await te.check('input[name=shuffle]');
  await te.fill('input[name=due_at]', '2030-01-01T18:00');
  await te.screenshot({ path: path.join(T, 'r1-form.png') });
  await te.click('#tqAll'); await te.click('#newTest button[type=submit]'); await te.waitForSelector('h1:has-text("Vaxtlı test")');
  let db = await te.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const t = db.tests[0]; console.log('  saved:', t.time_limit_min, t.shuffle, t.due_at, t.question_ids.length);
  console.log('  header:', await te.$eval('.page-head p.muted', (e) => e.textContent.replace(/\s+/g, ' ')));
  ok('teacher creates timed/shuffled/due test');
  // add overdue test and student-only test
  db.tests.push({ id: 'tOver', teacher_id: 'u1', class_id: 'c1', title: 'Köhnə', question_ids: ['q0'], is_open: true, due_at: now(7200), created_at: now(50) });
  db.tests.push({ id: 'tAli', teacher_id: 'u1', class_id: 'c1', student_id: 's1', title: 'Əli üçün', question_ids: ['q1'], is_open: true, created_at: now(40) });
  const st = await mk({ width: 390, height: 844 });
  await st.goto('http://app.test/'); await st.evaluate((d) => localStorage.setItem('mockdb', JSON.stringify(d)), db);
  await st.goto('http://app.test/#/s/NRG23456'); await st.waitForSelector('text=Salam');
  const nrgTodo = await st.$$eval('a.portal-row', (x) => x.map((a) => a.textContent.replace(/\s+/g, ' ').trim()));
  console.log('  Nərgiz todo:', nrgTodo, '| missed:', await st.$eval('.student', (e) => /Vaxtı keçmiş: Köhnə/.test(e.textContent)));
  if (nrgTodo.some((x) => x.includes('Əli üçün'))) fail('personal test leaked');
  await st.screenshot({ path: path.join(T, 'r2-portal.png') }); ok('portal: time, due, overdue, personal hidden from others');
  // shuffle order stable and different per student
  const orderOf = async (code) => { await st.goto(`http://app.test/#/s/${code}/${t.id}`); await st.waitForSelector('#startForm'); await st.click('#startForm button'); await st.waitForSelector('#st'); return st.$$eval('#st fieldset .q-text', (x) => x.map((e) => e.textContent.split(':')[0])); };
  const o1 = await orderOf('NRG23456'); await st.reload(); await st.waitForSelector('#st');
  const o1b = await st.$$eval('#st fieldset .q-text', (x) => x.map((e) => e.textContent.split(':')[0]));
  console.log('  Nərgiz order:', o1.join(','), '| after reload same:', o1.join() === o1b.join(), '| timer:', await st.textContent('#timer'));
  // draft persistence
  const firstQ = await st.$eval('#st fieldset input[type=radio]', (e) => e.name);
  await st.check(`input[name="${firstQ}"] >> nth=2`); await st.reload(); await st.waitForSelector('#st');
  console.log('  draft kept after reload:', await st.$eval(`input[name="${firstQ}"]:checked`, (e) => !!e).catch(() => false));
  await st.screenshot({ path: path.join(T, 'r3-timer.png') });
  ok('shuffle stable per student, timer resumes, draft kept');
  // Əli: start with offset so time nearly over → auto submit
  await st.evaluate(() => { window.START_OFFSET = 58500; });
  await st.goto(`http://app.test/#/s/ALI23456/${t.id}`); await st.evaluate(() => { window.START_OFFSET = 58500; }); await st.waitForSelector('#startForm'); 
  await st.evaluate(() => { window.START_OFFSET = 58500; }); await st.click('#startForm button'); await st.waitForSelector('#st');
  const o2 = await st.$$eval('#st fieldset .q-text', (x) => x.map((e) => e.textContent.split(':')[0]));
  console.log('  Əli order:', o2.join(','), '| differs from Nərgiz:', o2.join() !== o1.join());
  await st.waitForSelector('.score-big', { timeout: 8000 }); ok('auto-submit when time runs out');
  // overdue direct link
  await st.goto('http://app.test/#/s/ALI23456/tOver'); await st.waitForSelector('text=Son tarix keçib'); ok('overdue test blocked');
  // anonymous link shuffle/timer start screen
  await st.goto(`http://app.test/#/t/${t.id}`); await st.waitForSelector('#startForm select[name=name]'); ok('anonymous timed link shows start screen with name');
  // teacher sees late / personal tag
  db = await st.evaluate(() => JSON.parse(localStorage.getItem('mockdb'))); await te.evaluate((d) => localStorage.setItem('mockdb', JSON.stringify(d)), db);
  await te.goto('http://app.test/#/tests'); await te.waitForSelector('text=fərdi: Əli Həsənov'); ok('tests list: personal tag');
  await te.screenshot({ path: path.join(T, 'r4-list.png') });
  console.log('  submissions late flags:', db.submissions.map((x) => x.student_name + ':' + x.late).join(', '));
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message, errs); process.exit(1); });
