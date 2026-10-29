// AI → "Yaz və çevir": müəllim sualı yazır, səviyyə seçir, N yeni sual (transform) + yoxlama, banka saxla; şəkildən oxu
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const ROOT = path.join(__dirname, '..', '..');
const DB = { classes: [], students: [], questions: [], tests: [], submissions: [], ai_usage: [] };
const calls = []; let seq = 0;
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1300 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [{ key: 'opus', label: 'Opus', ready: true }] } });
    if (u.pathname === '/api/ai') { const bd = JSON.parse(route.request().postData()); calls.push(bd);
      if (bd.action === 'transform') return route.fulfill({ json: { question: { body: `Yeni sual ${++seq}: g(3x − 1) = 2x + 5, g(8) = ?`, qtype: 'mcq', options: ['5', '7', '9', '11', '13'], answer: '11', solution: 's', topic: bd.topic || 'Fonksiyonlar', difficulty: bd.difficulty, grade: 11 }, changes: ['rəqəmlər dəyişdi', 'funksiya adı dəyişdi'] } });
      if (bd.action === 'extract') return route.fulfill({ json: { text: 'Şəkildən oxunan sual: 2^5 = ?', topic: 'Üslü sayılar', grade: 11, difficulty: 'asan', answer: '32' } });
      if (bd.action === 'verify') return route.fulfill({ json: { results: [{ ok: true, correct: { ok: true, issues: [] }, fit: null }] } });
      return route.fulfill({ json: {} }); }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/ai'); await p.reload(); await p.click('[data-tab=rewrite]'); await p.waitForSelector('#rw');
  console.log('levels:', (await p.$$eval('#rw [data-level] strong', (x) => x.map((e) => e.textContent))).join(','));
  await p.setInputFiles('#rwImg', path.join(FX, 'page.jpg')); await p.waitForSelector('#rwOcr >> text=Oxundu');
  console.log('ocr:', await p.inputValue('#rw textarea[name=text]'), '|', await p.inputValue('#rw input[name=topic]'), '|', await p.inputValue('#rw select[name=difficulty]'));
  await p.fill('#rw textarea[name=text]', 'f(2x + 1) = 3x − 4 olarsa, f(5) neçədir?'); await p.fill('#rw input[name=topic]', 'Fonksiyonlar');
  await p.click('#rw [data-level=tam]'); await p.selectOption('#rw select[name=count]', '2'); await p.click('#rw button[type=submit]');
  await p.waitForSelector('#saveSel'); await p.waitForFunction(() => document.querySelectorAll('#results .mini').length === 2 && !document.querySelector('#results').textContent.includes('yoxlanılır'));
  const tr = calls.filter((c) => c.action === 'transform');
  console.log('transform calls:', tr.length, '| level:', tr[0].level, '| topic:', tr[0].topic, '| variant hint:', tr.every((c) => /variantdan/.test(c.text)));
  console.log('header:', (await p.textContent('#results .card p.small')).replace(/\s+/g, ' ').trim());
  await p.click('#saveSel'); await p.waitForSelector('text=2 sual banka əlavə olundu');
  const db = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  console.log('saved:', db.questions.length, db.questions.map((q) => q.source + ':' + q.ai_status).join(','));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
