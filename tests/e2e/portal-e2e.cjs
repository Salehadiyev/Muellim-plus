const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
 const shot = (p, n) => p.screenshot({ path: path.join(T, n + '.png'), fullPage: true });
const now = (d) => new Date(Date.now() - d * 1000).toISOString();
const DB = {
  classes: [{ id: 'c1', name: '7A', grade: 7, teacher_id: 'u1', created_at: now(900) }, { id: 'c2', name: '8B', grade: 8, teacher_id: 'u1', created_at: now(800) }],
  students: [
    { id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456', created_at: now(700) },
    { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456', created_at: now(700) },
    { id: 's3', class_id: 'c1', full_name: 'Rəşad Məmmədov', access_code: 'RSD23456', created_at: now(700) },
    { id: 's4', class_id: 'c2', full_name: 'Başqa tələbə', access_code: 'OTH23456', created_at: now(700) }],
  questions: [
    { id: 'q1', teacher_id: 'u1', body: '2 + 3 = ?', qtype: 'mcq', options: ['4', '5', '6', '7', '8'], answer: '5', created_at: now(600), option_figures: [] },
    { id: 'q2', teacher_id: 'u1', body: '3 · 4 = ?', qtype: 'mcq', options: ['7', '10', '12', '14', '16'], answer: '12', created_at: now(600), option_figures: [] }],
  tests: [
    { id: 'tA', teacher_id: 'u1', class_id: 'c1', title: 'Toplama və vurma', question_ids: ['q1', 'q2'], is_open: true, created_at: now(300) },
    { id: 'tB', teacher_id: 'u1', class_id: 'c1', title: 'Bağlı test', question_ids: ['q1'], is_open: false, created_at: now(200) },
    { id: 'tC', teacher_id: 'u1', class_id: 'c2', title: 'Başqa qrup', question_ids: ['q1'], is_open: true, created_at: now(100) }],
  submissions: [], ai_usage: []
};
const errors = []; const step = (s) => console.log('✓', s);
const fail = (m) => { throw new Error(m); };
(async () => {
  const browser = await chromium.launch();
  const mk = async (opts, init) => {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: url.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
      if (url.hostname !== 'app.test') return route.abort();
      if (url.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'https://x', supabaseAnonKey: 'k' } });
      const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
      route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', (d) => { p.lastDialog = d.message(); d.accept(); });
    return p;
  };
  // shared storage: one origin, copy DB between pages via localStorage
  const teacher = await mk({ viewport: { width: 1024, height: 1366 } });
  await teacher.goto('http://app.test/');
  await teacher.evaluate((db) => { localStorage.setItem('mockdb', JSON.stringify(db)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  const getDb = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (p, db) => p.evaluate((d) => localStorage.setItem('mockdb', JSON.stringify(d)), db);

  await teacher.goto('http://app.test/#/class/c1'); await teacher.reload();
  await teacher.waitForSelector('[data-share]');
  if ((await teacher.$$('[data-share]')).length !== 3) fail('share buttons');
  if (!(await teacher.isVisible('text=ALI23456'))) fail('code visible');
  await shot(teacher, 'p1-class'); step('class page: 3 personal links + codes');
  await teacher.click('#allLinks'); await teacher.waitForTimeout(300);
  const clip = teacher.lastDialog || await teacher.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  step('all links → ' + (teacher.lastDialog ? 'prompt fallback' : 'clipboard') + ': ' + JSON.stringify((clip || '').split('\n').slice(0, 3)));
  teacher.lastDialog = null;
  await teacher.click('[data-more="s3"] summary'); await teacher.click('[data-recode="s3"]'); await teacher.waitForSelector('text=Yeni link yaradıldı');
  let db = await getDb(teacher); const newRsd = db.students.find((s) => s.id === 's3').access_code;
  if (newRsd === 'RSD23456' || !/^[A-HJ-NP-Z2-9]{8}$/.test(newRsd)) fail('recode ' + newRsd);
  step('new link for Rəşad: ' + newRsd + ' (old invalid)');

  // student on phone, same origin storage
  const st = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await st.goto('http://app.test/'); await setDb(st, db);
  await st.goto('http://app.test/#/s/ali23456');
  await st.waitForSelector('text=Salam, Əli Həsənov');
  const todo = await st.$$eval('a.portal-row', (x) => x.map((a) => a.textContent.trim()));
  if (todo.length !== 1 || !todo[0].includes('Toplama')) fail('todo ' + JSON.stringify(todo));
  if (await st.isVisible('text=Bağlı test')) fail('closed test shown');
  if (await st.isVisible('text=Başqa qrup')) fail('other class shown');
  await shot(st, 'p2-portal'); step('portal: lower-case code ok, 1 open test, closed/other class hidden');
  await st.click('text=Başla'); await st.waitForSelector('#st');
  if (await st.$('select[name=name], input[name=name]')) fail('name field present');
  await st.check('input[name=q_q1][value="5"]'); await st.check('input[name=q_q2][value="10"]');
  await shot(st, 'p3-test');
  await st.click('#st button[type=submit]'); await st.waitForSelector('.score-big');
  if ((await st.textContent('.score-big')).trim() !== '1/2') fail('score');
  await shot(st, 'p4-done'); step('test via link: no name picker, score 1/2');
  await st.click('text=Testlərimə qayıt'); await st.waitForSelector('text=Nəticələrim');
  if (!(await st.isVisible('text=Hazırda yazılacaq test yoxdur'))) fail('todo not emptied');
  if (!(await st.isVisible('text=orta 50%'))) fail('avg');
  await shot(st, 'p5-portal-after'); step('portal after: result 1/2, avg 50%');
  await st.goto('http://app.test/#/s/ALI23456/tA'); await st.waitForSelector('.score-big');
  if (await st.$('#st')) fail('can resubmit'); step('reopen test link → shows result, no resubmit');
  await st.goto('http://app.test/#/s/ALI23456/tC'); await st.waitForSelector('text=Test açılmadı'); step('other class test blocked');
  await st.goto('http://app.test/#/s'); await st.waitForSelector('text=Salam, Əli Həsənov'); step('#/s remembers code');
  await st.goto('http://app.test/#/s/RSD23456'); await st.waitForSelector('#codeForm');
  if (!(await st.isVisible('text=etibarsızdır'))) fail('bad code msg');
  await shot(st, 'p6-badcode');
  await st.fill('input[name=code]', newRsd.toLowerCase()); await st.click('#codeForm button');
  await st.waitForSelector('text=Salam, Rəşad Məmmədov'); step('old code rejected; typed new code works');

  // teacher results
  db = await getDb(st); await setDb(teacher, db);
  await teacher.goto('http://app.test/#/test/tA'); await teacher.waitForSelector('text=Hələ göndərməyənlər (2)');
  if (!(await teacher.isVisible('.missing-list >> text=Nərgiz Quliyeva')) || await teacher.isVisible('.missing-list >> text=Əli Həsənov')) fail('missing list');
  if (!(await teacher.isVisible('td >> text=Əli Həsənov'))) fail('submission row');
  await teacher.click('#remind'); await teacher.waitForTimeout(200);
  await shot(teacher, 'p7-results'); step('results: 1 submitted, 2 not yet + reminder');

  // old anonymous link still works
  await st.goto('http://app.test/#/t/tA'); await st.waitForSelector('select[name=name]'); step('old general link still works');
  // portal SQL missing
  await st.evaluate(() => { window.PORTAL_DOWN = true; }); await st.goto('http://app.test/#/s/NRG23456');
  await st.evaluate(() => { window.PORTAL_DOWN = true; location.hash = '#/s/NRG23456/x'; });
  // before SQL: no codes → notice
  db.students.forEach((s) => delete s.access_code); await setDb(teacher, db);
  await teacher.goto('http://app.test/#/class/c1'); await teacher.waitForSelector('text=005_student_links.sql');
  if (await teacher.$('[data-share]')) fail('share without code'); step('without 005: notice, no broken buttons');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message, errors); process.exit(1); });
