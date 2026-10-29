const { chromium } = require(process.env.PW || 'playwright'); const svg = (k) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect x="10" y="10" width="100" height="100" fill="none" stroke="#000" stroke-width="3"/><circle cx="${20 + k * 18}" cy="60" r="12" fill="#000"/></svg>`;
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: [], questions: [{ id: 'b1', teacher_id: 'u1', body: 'Bank sorusu', qtype: 'mcq', options: ['1','2','3','4','5'], answer: '2', option_figures: [], created_at: new Date().toISOString() }], tests: [], submissions: [], ai_usage: [] };
const calls = []; let failFirstVerify = true; let incompleteNext = false;
const reply = (b) => {
  calls.push(b.action);
  if (b.action === 'tryos_analyze') return { text: 'Soru işaretinin yerine hangi şekil gelir?', analysis: { section: 'sayisal', topic: 'Şekil dizisi', family: 'Şekil dizisi', options_are_figures: true, figure_required: true, complete: !incompleteNext, uncertain: [], difficulty: 'orta' } };
  if (b.action === 'clean_copy') return { questions: [{ body: 'Soru işaretinin yerine hangi şekil gelir? (orijinal)' + (b.feedback ? ' v2' : ''), figure: svg(0), options: ['A','B','C','D','E'], option_figures: [0,1,2,3,4].map(svg), answer: 'C', solution: 's', exam: 'tryos', section: 'sayisal', topic: 'Şekil dizisi', difficulty: 'orta', unreadable: [], model: 'opus' }] };
  if (b.action === 'tryos_from_examples') return { questions: Array.from({ length: b.perSample }, (_, i) => ({ body: `Yeni (${b.mode}) soru ${Math.random().toString(36).slice(2, 6)}`, figure: svg(1), options: ['A','B','C','D','E'], option_figures: [0,1,2,3,4].map(svg), answer: 'B', solution: 's', exam: 'tryos', section: 'sayisal', difficulty: 'orta', model: 'opus' })), rejected: [] };
  if (b.action === 'verify') {
    const q = b.questions[0];
    const bad = failFirstVerify && /orijinal\)$/.test(q.body); if (bad) failFirstVerify = false;
    return { results: [{ ok: !bad, correct: { ok: !bad, index: 2, issues: bad ? ['kor həll B tapdı'] : [] }, fit: { ok: true, issues: [] }, index: 2, expected: 2, issue: '', _mode: b.mode, _img: !!(b.sample && b.sample.image), _render: !!q.render }] };
  }
  return {};
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
  const verifies = [];
  await ctx.route('**/*', async (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [{ key: 'opus', label: 'Opus', ready: true }] } });
    if (u.pathname === '/api/ai') { const body = JSON.parse(route.request().postData()); if (body.action === 'verify') verifies.push({ mode: body.mode, sampleImg: !!body.sample?.image, render: !!body.questions[0].render }); await new Promise((r) => setTimeout(r, 150)); return route.fulfill({ json: reply(body) }); }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://app.test/'); await p.evaluate((db) => { localStorage.setItem('mockdb', JSON.stringify(db)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/pdf'); await p.reload(); await p.waitForSelector('#pdfPicker input[type=file]', { state: 'attached' }); console.log('bar hidden at start:', await p.$eval('#pdfBar', (e) => e.hidden));
  await p.setInputFiles('#pdfPicker input[type=file]', path.join(FX, 'page.jpg')); await p.waitForSelector('#pdfPicker canvas');
  const crop = async (y1, y2) => { const bx = await (await p.$('#pdfPicker canvas')).boundingBox(); await p.mouse.move(bx.x + 30, bx.y + y1); await p.mouse.down(); await p.mouse.move(bx.x + bx.width - 30, bx.y + y2, { steps: 4 }); await p.mouse.up(); await p.waitForSelector('.crop-choice:not([hidden])'); };
  await crop(60, 260); await p.screenshot({ path: path.join(T, 'pdf1-choice.png') });
  await p.click('text=Orijinalı təmiz çıxart');
  await crop(280, 480); await p.click('.crop-choice >> text=AI ilə yarat'); await p.selectOption('.crop-choice [data-n]', '3'); await p.click('.crop-choice >> text=Yeni quruluş');
  incompleteNext = false;
  await p.waitForFunction(() => document.querySelectorAll('.pdf-job .tag.ai').length >= 2 && !document.querySelector('.pdf-job')?.textContent.includes('hazırlanır'), null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const jobs = await p.$$eval('.pdf-job', (x) => x.map((j) => j.querySelector('.row').textContent.replace(/\s+/g, ' ').trim() + ' | qs=' + j.querySelectorAll('.mini').length + ' checked=' + j.querySelectorAll('.check:checked').length));
  console.log('jobs:', jobs);
  console.log('orig body after retry:', await p.$eval('.pdf-job .mini-text', (e) => e.textContent));
  console.log('verify calls:', JSON.stringify(verifies));
  console.log('bar:', (await p.textContent('#pdfBar')).replace(/\s+/g, ' ').trim());
  await p.click('#pdfSave'); await p.waitForSelector('text=sual banka əlavə olundu');
  const db = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  console.log('bank now:', db.questions.length, '| sources:', db.questions.slice(1).map((q) => q.source).join(','), '| cards left:', await p.$$eval('.pdf-job', (x) => x.length));
  console.log('calls:', calls.join(','));
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
