// Qrupun mövzu planı: keçildi işarəsi, ardıcıllıq, mövzu üzrə faiz, zəif tələbələr, həftəlik plan; 017 olmadan yumşaq xəta
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const q = (id, topic) => ({ id, teacher_id: 'u1', body: id, qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: '1', option_figures: [], topic, created_at: new Date().toISOString() });
const QS = [q('k1', 'Kümeler ve Venn şemaları'), q('k2', 'Kümeler ve Venn şemaları'), q('k3', 'Kümeler ve Venn şemaları'), q('f1', 'Fonksiyonlar'), q('f2', 'Fonksiyonlar'), q('f3', 'Fonksiyonlar'), q('x1', 'Logaritma')];
const ans = (m) => Object.fromEntries(Object.entries(m));
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1', exam_date: ymd(56) }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }],
  questions: QS,
  tests: [{ id: 't1', teacher_id: 'u1', class_id: 'c1', title: 'T1', question_ids: QS.map((x) => x.id), is_open: false, created_at: new Date().toISOString() }],
  submissions: [
    { id: 'x1', test_id: 't1', student_id: 's1', student_name: 'Əli Həsənov', score: 4, total: 7, answers: ans({ k1: '1', k2: '1', k3: '1', f1: '2', f2: '2', f3: '2', x1: '1' }), created_at: new Date().toISOString() },
    { id: 'x2', test_id: 't1', student_id: 's2', student_name: 'Nərgiz Quliyeva', score: 4, total: 7, answers: ans({ k1: '1', k2: '2', k3: '1', f1: '1', f2: '2', f3: '1', x1: '1' }), created_at: new Date().toISOString() }],
  ai_usage: [], mistakes: [], lesson_notes: [], lessons: [], payments: [] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1300 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  const open = async () => { await p.goto('http://app.test/#/class/c1'); await p.reload(); await p.click('[data-ctab="pl"]'); await p.waitForSelector('#plPane .prow'); };
  await open();
  const rows = () => p.$$eval('#plPane .prow', (x) => x.map((r) => r.querySelector('.pr-t').textContent + ':' + r.querySelector('.pchip').textContent));
  const r0 = await rows();
  console.log('topics:', r0.length, '| kümeler:', r0.find((x) => x.startsWith('Kümeler')), '| fonk:', r0.find((x) => x.startsWith('Fonksiyonlar')), '| extra:', r0.at(-1));
  console.log('weak:', (await p.textContent('#plPane .notice')).replace(/\s+/g, ' ').trim());
  console.log('weak student:', await p.$$eval('#plPane .pr-weak', (x) => x.map((e) => e.textContent).join(' | ')));
  const weeks = await p.$$eval('#plPane .pw-list li', (x) => x.map((l) => (l.classList.contains('rev') ? 'R' : 'S') + l.querySelector('.pw-i').textContent.split(' · ').length));
  console.log('weeks:', weeks.length, weeks.join(','), '| last:', await p.$eval('#plPane .pw-list li:last-child .pw-i', (e) => e.textContent));
  // keçildi + ardıcıllıq + yeni mövzu + silmək
  await p.check('#plPane [data-pdone="0"]'); await p.waitForFunction(() => document.querySelector('#plPane .prow.done'));
  await p.click('#plPane [data-pdn="0"]'); await p.waitForTimeout(150);
  await p.fill('#pAdd input', 'Problemler'); await p.click('#pAdd button'); await p.waitForTimeout(150);
  await p.click('#plPane [data-pdel="2"]'); await p.waitForTimeout(150);
  let d = await db(); const t = d.classes[0].plan.topics;
  console.log('saved:', t[0].t, t[0].done, '|', t[1].t, t[1].done === new Date().toLocaleDateString('sv'), '| last:', t.at(-1).t, '| count:', t.length);
  await p.screenshot({ path: path.join(T, 'plan1.png'), fullPage: true });
  // yenidən açanda plan qalır; 1 keçilmiş
  await open(); console.log('reload:', (await p.textContent('#plPane .plan-prog')).replace(/\s+/g, ' ').trim());
  // telefon görünüşü
  await p.setViewportSize({ width: 390, height: 900 }); await p.screenshot({ path: path.join(T, 'plan2-phone.png'), fullPage: false });
  console.log('no hscroll:', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // 017 olmadan: yazanda yumşaq xəta
  await p.setViewportSize({ width: 1024, height: 1300 });
  await p.evaluate(() => { const x = JSON.parse(localStorage.getItem('mockdb')); x.__missing_columns = { classes: ['plan'] }; localStorage.setItem('mockdb', JSON.stringify(x)); });
  await open(); await p.click('#plPane [data-pdone="3"]'); await p.waitForSelector('#toast');
  await p.waitForTimeout(200); console.log('no 017:', (await p.textContent('#toast')).trim(), '| reverted:', !(await p.isChecked('#plPane [data-pdone="3"]')));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
