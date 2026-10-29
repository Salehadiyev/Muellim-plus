const { chromium } = require(process.env.PW || 'playwright'); const now = (d) => new Date(Date.now() - d * 1000).toISOString();
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const topics = ['Kümeler', 'Kümeler', 'Fonksiyonlar', 'Fonksiyonlar', 'Üslü sayılar', 'Üslü sayılar'];
const qs = topics.map((tp, i) => ({ exam: i % 2 ? 'tryos' : 'general', id: 'q' + i, teacher_id: 'u1', body: `${tp} sorusu ${i + 1}`, qtype: 'mcq', options: ['A' + i, 'B' + i, 'C' + i, 'D' + i, 'E' + i], answer: 'C' + i, topic: tp, option_figures: [], created_at: now(900) }));
const studs = ['Əli Həsənov', 'Nərgiz Quliyeva', 'Rəşad Məmmədov', 'Leyla Əliyeva'].map((n, i) => ({ id: 's' + i, class_id: 'c1', full_name: n, access_code: 'CODE000' + i }));
const tests = [0, 1, 2].map((k) => ({ id: 't' + k, teacher_id: 'u1', class_id: 'c1', title: 'Test ' + (k + 1), question_ids: qs.map((q) => q.id), is_open: true, created_at: now(800 - k * 100) }));
const skill = [0.9, 0.6, 0.35, null];
let rnd = 7; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
const subs = [];
tests.forEach((t, k) => studs.forEach((s, i) => {
  if (skill[i] === null) return;
  const ans = {}; let sc = 0;
  qs.forEach((q, j) => { const p = skill[i] - (q.topic === 'Fonksiyonlar' ? 0.3 : 0) + k * 0.05; const x = r(); if (x < 0.1) return; if (x < p) { ans[q.id] = q.answer; sc++; } else ans[q.id] = q.options[1]; });
  subs.push({ id: `x${k}${i}`, test_id: t.id, student_id: s.id, student_name: s.full_name, answers: ans, score: sc, total: 6, created_at: now(700 - k * 100 - i) });
}));
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: studs, questions: qs, tests, submissions: subs, ai_usage: [] };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 } }); const errs = [];
  const calls = [];
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.pathname === '/api/ai') { const body = JSON.parse(route.request().postData()); calls.push(body.action + (body.sample ? '' : ''));
      if (body.action === 'transform') return route.fulfill({ json: { question: { body: 'Yeni ümumi sual ' + Math.random().toString(36).slice(2, 5), qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: '3', solution: 's', topic: 'Kümeler', difficulty: 'orta' } } });
      if (body.action === 'tryos_from_examples') return route.fulfill({ json: { questions: [{ body: 'Yeni TR-YÖS sorusu ' + Math.random().toString(36).slice(2, 5), options: ['A', 'B', 'C', 'D', 'E'], answer: 'B', solution: 's', exam: 'tryos', topic: body.samples[0].topic }], rejected: [] } });
      if (body.action === 'verify') { const bad = /TR-YÖS/.test(body.questions[0].body); return route.fulfill({ json: { results: [{ ok: !bad, correct: { ok: !bad, issues: bad ? ['kor həll A tapdı'] : [] }, fit: null }] } }); }
    }
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k' } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/student/s1'); await p.reload(); await p.waitForSelector('#practice');
  console.log('practice intro:', await p.$eval('#practice p.muted', (e) => e.textContent.slice(0, 60)), '| N options:', await p.$$eval('#pN option', (x) => x.map((o) => o.textContent).join(',')));
  await p.selectOption('#pN', '3'); await p.click('#pGo');
  await p.waitForFunction(() => document.querySelectorAll('#practice .mini .mini-q').length === 3 && !document.querySelector('#practice').textContent.includes('hazırlanır'), null, { timeout: 20000 });
  await p.waitForFunction(() => !document.querySelector('#pGo').disabled, null, { timeout: 20000 });
  console.log('practice cards:', await p.$$eval('#practice .mini', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 90))));
  console.log('AI calls:', calls.join(','));
  // approve the draft one
  const draft = await p.$('#practice .mini:has(.mini-why) .mini-open');
  if (draft) { await draft.click(); await p.click('#qDialog [data-approve]'); }
  console.log('selected after approve:', await p.$eval('#practice .row.between strong', (e) => e.textContent));
  await p.screenshot({ path: path.join(T, 'pr1.png'), fullPage: true });
  await p.click('#pSend'); await p.waitForSelector('#pDone .notice');
  let db = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const pt = db.tests.find((t) => t.student_id === 's1'); console.log('personal test:', pt.title, pt.question_ids.length, pt.review_mode, '| new questions:', db.questions.length - 6);
  // report
  console.log('report:\n' + await p.$eval('#rpText', (e) => e.value));
  await p.selectOption('#rpDays', '7'); console.log('report 7d first lines:', (await p.$eval('#rpText', (e) => e.value)).split('\n').slice(1, 4).join(' / '));
  await p.goto('http://app.test/#/class/c1'); await p.click('text=Analiz'); await p.waitForSelector('.tbars');
  console.log('stats:', await p.$$eval('.stat .value', (x) => x.map((e) => e.textContent).join(' | ')));
  console.log('topics:', await p.$$eval('.tbar', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  console.log('trend:', await p.$$eval('.trend-c', (x) => x.map((e) => e.title).join(' | ')));
  console.log('hard:', await p.$$eval('.hard-q', (x) => x.slice(0, 2).map((e) => e.textContent.replace(/\s+/g, ' ').trim())));
  console.log('students:', await p.$$eval('tbody tr', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim())));
  await p.screenshot({ path: path.join(T, 'an1.png'), fullPage: true });
  await p.click('.hard-q'); await p.waitForSelector('#rvDialog[open]'); await p.click('#rvDialog [data-close]');
  await p.click('tbody a >> nth=0'); await p.waitForSelector('text=Mövzular'); await p.screenshot({ path: path.join(T, 'an2.png'), fullPage: true });
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
