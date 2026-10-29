// Dərs və ödəniş dəftəri, gizli qeyd, real çətinlik (bank + avtomatik test "Bankdan"); 013 olmadan sınmır
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const nd = new Date(); const pad2 = (n) => String(n).padStart(2, '0'); const first = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-01`;
const q = (id, diff, ans) => ({ id, teacher_id: 'u1', body: 'Fonksiyon sualı ' + id, qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: ans, option_figures: [], topic: 'Fonksiyonlar', difficulty: diff, ai_status: 'passed', exam: 'tryos', created_at: ago(20) });
const QS = [q('a1', 'asan', '1'), q('a2', 'asan', '1'), q('o1', 'orta', '1'), q('o2', 'orta', '1'), q('c1q', 'çətin', '1')];
const studs = ['Əli Həsənov', 'Nərgiz Quliyeva', 'Rəşad Məmmədov'].map((n, i) => ({ id: 's' + i, class_id: 'c1', full_name: n, access_code: 'CODE234' + i, lesson_price: i === 0 ? 200 : null, pay_day: i === 0 ? 1 : null, billing_start: i === 0 ? first : null }));
// a1: hamı səhv edir (real çətin), qalanları düz
const subs = studs.map((st, i) => ({ id: 'x' + i, test_id: 't1', student_id: st.id, student_name: st.full_name, answers: { a1: '2', a2: '1', o1: '1', o2: '1', c1q: '1' }, score: 4, total: 5, created_at: ago(3) }));
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: studs, questions: QS,
  tests: [{ id: 't1', teacher_id: 'u1', class_id: 'c1', title: 'Fonksiyonlar', question_ids: QS.map((x) => x.id), is_open: false, review_mode: 'after_submit', created_at: ago(5) }],
  submissions: subs, ai_usage: [], mistakes: [], lesson_notes: [], lessons: [], payments: [] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1200 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  let promptAnswer = null; p.on('dialog', (d) => (d.type() === 'prompt' && promptAnswer !== null ? d.accept(promptAnswer) : d.accept()));
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (d) => p.evaluate((x) => localStorage.setItem('mockdb', JSON.stringify(x)), d);
  await p.goto('http://app.test/'); await setDb(DB);
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  await p.goto('http://app.test/#/'); await p.reload(); await p.waitForFunction(() => document.getElementById('navStCount')?.textContent === '3');
  console.log('nav count:', await p.textContent('#navStCount'));
  await p.click('nav >> text=Dərslər'); await p.waitForSelector('.ls-row');
  const row = (i) => `.ls-row[data-sid="s${i}"]`;
  const chip = async (i) => (await p.textContent(`${row(i)} .ls-bal`)).replace(/\s+/g, ' ').trim();
  console.log('rows:', await p.$$eval('.ls-row', (x) => x.length), '| stats:', await p.$$eval('.ls-stats4 .value', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  console.log('Əli overdue:', await chip(0));
  // davamiyyət: gəldi → yenə bas (silinir) → geri al → gəlmədi
  await p.click(`${row(0)} [data-att=came]`); await p.waitForSelector(`${row(0)} [data-att=came].on-came`);
  let d = await db(); console.log('came:', d.lessons.map((l) => l.status + ':' + l.fee).join(','), '| money unchanged:', (await chip(0)).includes('Gecikir'));
  await p.click(`${row(0)} [data-att=came]`); await p.waitForSelector(`${row(0)} [data-att=came]:not(.on-came)`);
  console.log('toggle off:', (await db()).lessons.length, '| undo bar:', (await p.textContent('#undoBar span')).trim());
  await p.click('#undoBar button'); await p.waitForSelector(`${row(0)} [data-att=came].on-came`); console.log('undo restored:', (await db()).lessons.length);
  await p.click(`${row(0)} [data-att=missed]`); await p.waitForSelector(`${row(0)} [data-att=missed].on-miss`);
  d = await db(); console.log('switched:', d.lessons.map((l) => l.status).join(','), '| one per day:', d.lessons.filter((l) => l.student_id === 's0').length);
  await p.click('#allCame'); await p.waitForSelector(`${row(1)} [data-att=came].on-came`);
  d = await db(); console.log('all came:', d.lessons.map((l) => l.student_id + ':' + l.status).sort().join(','));
  await p.click('#undoBar button'); await p.waitForSelector(`${row(1)} [data-att=came]:not(.on-came)`); console.log('all came undone:', (await db()).lessons.length);
  // aylıq ödəniş: ödə → geri al → yenə ödə
  promptAnswer = '200'; await p.click(`${row(0)} [data-pay]`); await p.waitForFunction((r) => document.querySelector(r + ' .ls-bal').textContent.includes('ödənilib'), row(0));
  console.log('paid:', await chip(0));
  await p.click('#undoBar button'); await p.waitForFunction((r) => document.querySelector(r + ' .ls-bal').textContent.includes('Gecikir'), row(0)); console.log('pay undone:', (await db()).payments.length);
  await p.click(`${row(0)} [data-pay]`); await p.waitForFunction((r) => document.querySelector(r + ' .ls-bal').textContent.includes('ödənilib'), row(0));
  // Nərgiz: aylıq 150, ayın 28-i
  await p.fill(`${row(1)} [data-price]`, '150'); await p.dispatchEvent(`${row(1)} [data-price]`, 'change'); await p.waitForSelector('text=Aylıq məbləğ yadda saxlandı');
  await p.fill(`${row(1)} [data-pday]`, '28'); await p.dispatchEvent(`${row(1)} [data-pday]`, 'change'); await p.waitForSelector('text=Ödəniş günü: ayın 28-i');
  d = await db(); const n1 = d.students.find((x) => x.id === 's1');
  const expect1 = nd.getDate() >= 28 ? 'Gecikir' : 'Gözlənilir';
  console.log('Nərgiz:', n1.lesson_price, n1.pay_day, n1.billing_start === first, '| chip ok:', (await chip(1)).includes(expect1));
  console.log('stats after:', await p.$$eval('.ls-stats4 .value', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  await p.screenshot({ path: path.join(T, 'ls1-list.png'), fullPage: true });
  await p.click(`${row(0)} [data-hist]`); await p.waitForSelector('#rvDialog[open] .h-month');
  console.log('history months:', await p.$$eval('#rvDialog .h-month', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  console.log('report:', (await p.textContent('#rvDialog p.pre')).trim());
  await p.screenshot({ path: path.join(T, 'ls2-history.png') });
  await p.click('#rvDialog [data-close]');
  // gizli qeyd + tələbə səhifəsində xülasə
  await p.goto('http://app.test/#/student/s0'); await p.waitForSelector('#tNote'); await p.waitForSelector('#ledgerCard .pchip');
  await p.fill('#tNote', 'Üslü sayılarda zəifdir'); await p.waitForSelector('#noteState >> text=yadda saxlandı');
  console.log('note saved:', (await db()).students[0].teacher_note, '| ledger:', (await p.textContent('#ledgerCard')).replace(/\s+/g, ' ').trim().slice(0, 140));
  await p.screenshot({ path: path.join(T, 'ls3-student.png'), fullPage: true });
  // real çətinlik: bank
  await p.goto('http://app.test/#/bank'); await p.waitForSelector('#list .qtile'); await p.waitForSelector('.real-box');
  console.log('real box:', (await p.textContent('.real-box')).replace(/\s+/g, ' ').trim());
  console.log('tile a1:', await p.$$eval('#list .qtile', (x) => x.map((e) => e.querySelector('.qt-stat')?.textContent.trim() || '').filter((t) => t.includes('real')).join(' | ')));
  await p.selectOption('#fReal', 'çətin'); await p.waitForFunction(() => document.querySelectorAll('#list .qtile').length === 1);
  console.log('real filter çətin:', await p.textContent('#list .qtile .qt-text'));
  await p.selectOption('#fReal', ''); await p.click('#realFix'); await p.waitForSelector('text=çətinliyi yeniləndi');
  console.log('after fix:', (await db()).questions.map((x) => x.id + ':' + x.difficulty).join(','));
  // avtomatik test: Bankdan 1 asan / 1 orta / 2 çətin (çətin 2-ci bankda yoxdur, AI-sız)
  await p.goto('http://app.test/#/auto'); await p.waitForSelector('#autoForm');
  await p.fill('#autoForm input[name=topic]', 'fonksiyon'); await p.fill('#autoForm input[name=n0]', '1'); await p.fill('#autoForm input[name=n1]', '1'); await p.fill('#autoForm input[name=n2]', '3');
  await p.click('[data-src=bank]'); await p.uncheck('#autoForm input[name=fillBank]'); await p.click('#autoRun'); await p.waitForSelector('#aTest');
  console.log('bank auto groups:', (await p.$$eval('#autoOut .dgroup', (x) => x.map((e) => e.textContent.trim()))).join(' | '));
  console.log('bank auto notes:', await p.$$eval('#autoOut .warn-list li', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  console.log('bank tags:', await p.$$eval('#autoOut .mini-meta .tag:first-child', (x) => [...new Set(x.map((e) => e.textContent.trim()))].join(',')));
  const before = (await db()).questions.length; await p.click('#aTest'); await p.waitForSelector('#newTest');
  console.log('no duplicates on test:', (await db()).questions.length === before, '| checked:', await p.$$eval('#tqList .check:checked', (x) => x.length));
  // 013 olmayan baza
  d = await db(); delete d.lessons; delete d.payments; await setDb(d);
  await p.goto('http://app.test/#/lessons'); await p.reload(); await p.waitForSelector('.notice');
  console.log('no 013 lessons:', (await p.textContent('.notice')).includes('013_lessons.sql'));
  await p.goto('http://app.test/#/bank'); await p.waitForSelector('#list .qtile'); console.log('no 013 bank ok:', !(await p.$('.real-box .btn')));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
