const { chromium } = require(process.env.PW || 'playwright'); const now = (d) => new Date(Date.now() - d * 1000).toISOString();
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const q = (id, body, opts, ans, sol) => ({ id, teacher_id: 'u1', body, qtype: 'mcq', options: opts, answer: ans, solution: sol, option_figures: [], created_at: now(600) });
const DB = {
  classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }, { id: 's3', class_id: 'c1', full_name: 'Rəşad Məmmədov', access_code: 'RSD23456' }],
  questions: [q('q1', '$2+3=?$', ['4', '5', '6', '7', '8'], '5', '2+3=5'), q('q2', '$3\\cdot4=?$', ['7', '10', '12', '14', '16'], '12', '3·4=12'), q('q3', '$10-4=?$', ['5', '6', '7', '8', '9'], '6', '10-4=6')],
  tests: [{ id: 'tA', teacher_id: 'u1', class_id: 'c1', title: 'Hesab', question_ids: ['q1', 'q2', 'q3'], is_open: true, review_mode: 'after_submit', created_at: now(300) },
          { id: 'tB', teacher_id: 'u1', class_id: 'c1', title: 'Bağlananda', question_ids: ['q1'], is_open: true, review_mode: 'after_close', created_at: now(200) }],
  submissions: [{ id: 'x1', test_id: 'tA', student_id: 's2', student_name: 'Nərgiz Quliyeva', answers: { q1: '5', q2: '12', q3: '6' }, score: 3, total: 3, created_at: now(100) }], ai_usage: []
};
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
  const st = await mk({ width: 390, height: 844 });
  await st.goto('http://app.test/'); await st.evaluate((db) => localStorage.setItem('mockdb', JSON.stringify(db)), DB);
  await st.goto('http://app.test/#/s/ALI23456'); await st.waitForSelector('text=Salam');
  await st.click('a.portal-row:has-text("Hesab")'); await st.waitForSelector('#st');
  await st.check('input[name=q_q1][value="5"]'); await st.check('input[name=q_q2][value="10"]');
  await st.click('#st button[type=submit]'); await st.waitForSelector('.score-big');
  if (!(await st.isVisible('text=Səhvlərimə bax'))) fail('no review button after_submit'); ok('after_submit: "Səhvlərimə bax" after submit');
  await st.click('text=Səhvlərimə bax'); await st.waitForSelector('#rvList');
  const tags = await st.$$eval('#rvList .rv-q .tag', (x) => x.map((e) => e.textContent.trim()));
  console.log('  states:', tags.join(' | '));
  const wrongLi = await st.$eval('#rvList .rv-wrong li.wrong', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const rightLi = await st.$eval('#rvList .rv-wrong li.correct', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  console.log('  wrong q: chosen', JSON.stringify(wrongLi), '| correct', JSON.stringify(rightLi));
  await st.check('#onlyWrong'); console.log('  only wrong visible:', await st.$$eval('#rvList > [data-st]:not([hidden])', (x) => x.length));
  await st.screenshot({ path: path.join(T, 'rv1-student.png'), fullPage: true }); ok('student review page');
  // after_close test
  await st.goto('http://app.test/#/s/ALI23456/tB'); await st.waitForSelector('#st'); await st.check('input[name=q_q1][value="4"]'); await st.click('#st button[type=submit]'); await st.waitForSelector('.score-big');
  if (await st.isVisible('text=Səhvlərimə bax')) fail('after_close shows review while open');
  if (!(await st.isVisible('text=bağlayanda açılacaq'))) fail('after_close note'); ok('after_close: hidden while open, note shown');
  await st.goto('http://app.test/#/s/ALI23456/tB/review'); await st.waitForSelector('text=bağlayanda açılacaq'); ok('direct review URL blocked while open');
  // teacher
  const db = await st.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const te = await mk({ width: 1024, height: 1366 });
  await te.goto('http://app.test/'); await te.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, db);
  await te.goto('http://app.test/#/test/tA'); await te.reload(); await te.waitForSelector('[data-sub]');
  const cells = await te.$$eval('tbody tr', (rows) => rows.map((r) => r.querySelector('[data-sub]').textContent + ': ' + [...r.querySelectorAll('.cell')].map((c) => c.className.replace('cell c-', '')).join(',')));
  console.log('  matrix:', cells);
  await te.screenshot({ path: path.join(T, 'rv2-results.png'), fullPage: true });
  await te.click('[data-sub] >> text=Əli Həsənov'); await te.waitForSelector('#rvDialog[open] .rv-q');
  console.log('  dialog:', await te.$eval('#rvDialog p.muted', (e) => e.textContent.replace(/\s+/g, ' ').trim()));
  await te.screenshot({ path: path.join(T, 'rv3-dialog.png') }); await te.click('#rvDialog [data-close]'); ok('teacher: matrix + student detail');
  await te.selectOption('#rvMode', 'never'); await te.waitForSelector('text=Yadda saxlandı');
  const d2 = await te.evaluate(() => JSON.parse(localStorage.getItem('mockdb'))); console.log('  mode saved:', d2.tests.find((t) => t.id === 'tA').review_mode);
  // teacher student page
  await te.goto('http://app.test/#/class/c1'); await te.click('a:has-text("Əli Həsənov")'); await te.waitForSelector('text=Yazdığı test');
  console.log('  student page stats:', await te.$$eval('.stat .value', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  await te.click('[data-row]'); await te.waitForSelector('#rvDialog[open]');
  await te.screenshot({ path: path.join(T, 'rv4-student-page.png'), fullPage: true }); ok('teacher: student page');
  // student sees closed after mode changed to never
  await st.evaluate((d) => localStorage.setItem('mockdb', JSON.stringify(d)), d2);
  await st.goto('http://app.test/#/s/ALI23456/tA/review'); await st.waitForSelector('text=cavabları göstərmir'); ok('mode never → student review blocked');
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message, errs); process.exit(1); });
