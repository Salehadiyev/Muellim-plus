// Səhv dəftəri: səhv cavab dəftərə düşür → (vaxt çatanda) bənzəri verilir → səhv: qalır; düz: silinir. Müəllim bölməsi.
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const now = (d) => new Date(Date.now() - d * 1000).toISOString();
const q = (id, body, opts, ans, extra = {}) => ({ id, teacher_id: 'u1', body, qtype: 'mcq', options: opts, answer: ans, solution: 'həll ' + id, option_figures: [], topic: 'Fonksiyonlar', exam: 'tryos', ai_status: 'passed', created_at: now(600), ...extra });
const DB = {
  classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }],
  questions: [q('q1', '1+1=?', ['1', '2', '3', '4', '5'], '2', { topic: 'Sayılar' }), q('q2', 'f(2)=?', ['3', '4', '5', '6', '7'], '4'), q('q3', 'g(3)=? (bənzər)', ['5', '6', '7', '8', '9'], '6', { similar_to: 'q2' })],
  tests: [{ id: 'tA', teacher_id: 'u1', class_id: 'c1', title: 'Fonksiyonlar', question_ids: ['q1', 'q2'], is_open: true, review_mode: 'after_submit', created_at: now(300) }],
  submissions: [], ai_usage: [], mistakes: []
};
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    if (u.pathname === '/api/ai') { const bd = JSON.parse(route.request().postData());
      if (bd.action === 'tryos_from_examples') return route.fulfill({ json: { questions: [{ body: 'AI bənzər: 2+3=?', qtype: 'mcq', options: ['4', '5', '6', '7', '8'], answer: '5', solution: 's', exam: 'tryos', section: 'matematik', topic: 'Sayılar', difficulty: 'asan' }], rejected: [] } });
      if (bd.action === 'verify') return route.fulfill({ json: { results: [{ ok: false, correct: { ok: false, issues: ['kor həll başqa cavab tapdı'] }, fit: { ok: true, issues: [] } }] } });
      return route.fulfill({ json: {} }); }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (d) => p.evaluate((x) => localStorage.setItem('mockdb', JSON.stringify(x)), d);
  await p.goto('http://app.test/'); await setDb(DB);
  // 1) test: q1 düz, q2 səhv
  await p.goto('http://app.test/#/s/ALI23456/tA'); await p.waitForSelector('#st');
  await p.check('input[name=q_q1][value="2"]'); await p.check('input[name=q_q2][value="5"]');
  await p.click('#st button[type=submit]'); await p.waitForSelector('.score-big');
  let d = await db(); console.log('mistakes after test:', d.mistakes.map((m) => m.question_id + ':' + m.status).join(','));
  await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('.notebook');
  console.log('portal waiting:', (await p.textContent('.notebook p')).replace(/\s+/g, ' ').trim());
  // 2) vaxt çatıb → bənzəri (q3)
  d = await db(); d.mistakes.forEach((m) => { m.due_at = now(60); }); await setDb(d);
  await p.goto('http://app.test/#/s/ALI23456?x=1'); await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('.notebook a.btn');
  console.log('portal due:', (await p.textContent('.notebook a.btn')).trim());
  await p.screenshot({ path: path.join(T, 'nb1-portal.png'), fullPage: true });
  await p.click('.notebook a.btn'); await p.waitForSelector('#nbForm');
  console.log('practice q:', (await p.textContent('#nbForm .q-text')).trim());
  await p.check('#nbForm input[value="5"]'); await p.click('#nbBtn'); await p.waitForSelector('.nb-bad');
  console.log('btn after answer:', (await p.textContent('#nbBtn')).trim()); console.log('wrong:', (await p.textContent('.nb-bad strong:nth-of-type(2)')).trim(), '| marked:', await p.$$eval('.opt-choice.right, .opt-choice.wrong', (x) => x.map((e) => e.className.split(' ').pop() + ':' + e.querySelector('input').value).join(',')));
  await p.screenshot({ path: path.join(T, 'nb2-wrong.png'), fullPage: true });
  await p.click('#nbBtn'); await p.waitForSelector('text=Bu günlük bitdi');
  d = await db(); console.log('after wrong:', d.mistakes.map((m) => `${m.status} attempts=${m.attempts} seen=${m.seen.join('|')} later=${new Date(m.due_at) > Date.now()}`).join(','));
  // 3) yenidən vaxt çatıb → görülən bənzər yox → orijinal q2; düz → silinir
  d.mistakes.forEach((m) => { m.due_at = now(60); }); await setDb(d);
  await p.goto('http://app.test/#/s/ALI23456/defter?y'); await p.goto('http://app.test/#/s/ALI23456/defter'); await p.waitForSelector('#nbForm');
  console.log('second practice q:', (await p.textContent('#nbForm .q-text')).trim());
  await p.check('#nbForm input[value="4"]'); await p.click('#nbBtn'); await p.waitForSelector('.nb-ok');
  console.log('right:', (await p.textContent('.nb-ok')).trim());
  await p.click('#nbBtn'); await p.waitForSelector('text=Bu günlük bitdi');
  await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('.notebook');
  console.log('portal after:', (await p.textContent('.notebook')).replace(/\s+/g, ' ').trim());
  // 4) müəllim bölməsi
  d = await db(); d.mistakes.push({ id: 'm9', teacher_id: 'u1', student_id: 's2', question_id: 'q1', test_id: 'tA', status: 'open', attempts: 0, seen: [], practice_id: null, due_at: now(-3600), created_at: now(10) }); await setDb(d);
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  await p.setViewportSize({ width: 1024, height: 1200 });
  await p.goto('http://app.test/#/class/c1'); await p.reload(); await p.click('[data-ctab=mk]'); await p.waitForSelector('#mkPane .stat');
  console.log('teacher stats:', await p.$$eval('#mkPane .stat .value', (x) => x.map((e) => e.textContent.trim()).join(' | ')), '| gen btn:', (await p.textContent('#mkGen')).trim());
  console.log('teacher rows:', await p.$$eval('#mkPane .srow', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  await p.screenshot({ path: path.join(T, 'nb3-teacher.png'), fullPage: true });
  await p.click('#mkGen'); await p.waitForSelector('#mkPane .warn-list li', { timeout: 20000 });
  console.log('gen note:', (await p.textContent('#mkPane .warn-list li')).trim());
  console.log('tile label:', (await p.textContent('#mkPane .qstat .qs-p')).trim(), '| draft notice:', await p.isVisible('#mkPane .notice'));
  await p.click('#mkPane .qstat'); await p.waitForSelector('#rvDialog[open] .pair-view');
  console.log('pair:', await p.$$eval('#rvDialog .pair-view .q-text', (x) => x.map((e) => e.textContent.trim()).join(' || ')));
  await p.screenshot({ path: path.join(T, 'nb4-pair.png') });
  await p.click('#rvDialog [data-sapp]'); await p.waitForSelector('#rvDialog >> text=Təsdiqi götür'); await p.click('#rvDialog [data-close]');
  await p.waitForFunction(() => (document.querySelector('#mkPane .qstat .qs-p')?.textContent || '').includes('bənzəri var'));
  console.log('after approve:', (await p.textContent('#mkPane .qstat .qs-p')).trim());
  await p.goto('http://app.test/#/bank'); await p.waitForSelector('#list .qtile'); await p.selectOption('#fSource', 'similar');
  await p.waitForFunction(() => document.querySelectorAll('#list .qtile').length === 2);
  console.log('bank similar:', await p.$$eval('#list .qtile', (x) => x.map((e) => e.querySelector('.qt-text').textContent.trim() + (e.querySelector('.qt-sim') ? ' [↔]' : '')).join(' | ')));
  // 5) 010 olmayan baza: portal və müəllim bölməsi sınmır
  d = await db(); delete d.mistakes; await setDb(d);
  await p.goto('http://app.test/#/class/c1'); await p.reload(); await p.click('[data-ctab=mk]'); await p.waitForSelector('#mkPane .notice');
  console.log('no 010 teacher:', (await p.textContent('#mkPane .notice')).includes('010_mistakes.sql'));
  await p.goto('http://app.test/#/s/ALI23456'); await p.reload(); await p.waitForSelector('text=Nəticələrim');
  console.log('no 010 portal ok:', !(await p.$('.notebook')));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
