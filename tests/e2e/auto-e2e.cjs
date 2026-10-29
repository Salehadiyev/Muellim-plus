// Avtomatik test: kitabdan 2 asan / 1 orta / 1 çətin (orta kitabda yoxdur → AI tamamlayır), sonra yalnız AI ilə 1/1/1
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: [], questions: [], tests: [], submissions: [], ai_usage: [] };
const calls = []; let seq = 0;
const Q = (body, difficulty) => ({ body, options: ['1', '2', '3', '4', '5'], answer: '2', solution: 's', exam: 'tryos', section: 'matematik', topic: 'Fonksiyonlar', difficulty, model: 'opus' });
const reply = (b) => {
  calls.push(b.action + (b.want ? ':' + b.want : '') + (b.mix ? ':' + JSON.stringify(b.mix) : ''));
  if (b.action === 'extract') return { questions: [
    { text: 'f(x) asan sual', topic: 'Fonksiyonlar', section: 'matematik', difficulty: 'asan', match: true, box: [5, 5, 90, 20] },
    { text: 'f(x) çətin sual', topic: 'Fonksiyonlar', section: 'matematik', difficulty: 'çətin', match: true, box: [5, 40, 90, 20] },
    { text: 'Kümeler sualı', topic: 'Kümeler', section: 'matematik', difficulty: 'orta', match: false, box: [5, 70, 90, 20] }] };
  if (b.action === 'tryos_analyze') return { text: 'kitab mətni', analysis: { section: 'matematik', topic: 'Fonksiyonlar', complete: true, uncertain: [], difficulty: 'orta' } };
  if (b.action === 'clean_copy') return { questions: [Q('Orijinal sual ' + (++seq), b.analysis.difficulty)] };
  if (b.action === 'tryos_from_examples') return { questions: [Q('Bənzər sual ' + (++seq), 'orta')], rejected: [] };
  if (b.action === 'tryos_plan') {
    const m = b.mix; const order = [...Array(m.asan).fill('asan'), ...Array(m.orta).fill('orta'), ...Array(m.cetin).fill('çətin')];
    return { plan: order.map((d) => ({ subtype: 't', idea: 'i', topic: b.topic, section: 'matematik', difficulty: d, visual: 'yok' })), notes: '' };
  }
  if (b.action === 'tryos_generate') return { questions: b.items.map((it) => Q('AI sual ' + it.difficulty + ' ' + (++seq), it.difficulty)) };
  if (b.action === 'verify') return { results: [{ ok: true, correct: { ok: true, issues: [] }, fit: { ok: true, issues: [] } }] };
  return {};
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 } });
  await ctx.route('**/*', async (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') {
      if (u.pathname.includes('pdf.worker')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(G + '/pdfjs-dist/build/pdf.worker.min.mjs') });
      if (u.pathname.includes('pdfjs-dist')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(G + '/pdfjs-dist/build/pdf.min.mjs') });
      return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    }
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [{ key: 'opus', label: 'Opus', ready: true }] } });
    if (u.pathname === '/api/ai') { const body = JSON.parse(route.request().postData()); await new Promise((r) => setTimeout(r, 60)); return route.fulfill({ json: reply(body) }); }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://app.test/'); await p.evaluate((db) => { localStorage.setItem('mockdb', JSON.stringify(db)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/tests'); await p.reload(); await p.click('text=⚡ Avtomatik test'); await p.waitForSelector('#autoForm');
  await p.fill('#autoForm input[name=topic]', 'Fonksiyonlar');
  await p.fill('#autoForm input[name=n0]', '2'); await p.fill('#autoForm input[name=n1]', '1'); await p.fill('#autoForm input[name=n2]', '1');
  console.log('total:', await p.textContent('#mixTotal'));
  await p.setInputFiles('#autoPdf', path.join(FX, 'book.pdf')); await p.waitForSelector('#pageRange:not([hidden])');
  console.log('pdf info:', (await p.textContent('#pdfInfo')).trim(), '| to:', await p.inputValue('input[name=to]'));
  await p.screenshot({ path: path.join(T, 'auto1-form.png'), fullPage: true });
  await p.click('#autoRun');
  await p.waitForSelector('#aTest', { timeout: 30000 });
  const groups = await p.$$eval('#autoOut .dgroup', (x) => x.map((e) => e.textContent.trim()));
  console.log('book groups:', groups.join(' | '));
  console.log('book items:', await p.$$eval('#autoOut .mini-text', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  console.log('notes:', await p.$$eval('#autoOut .warn-list li', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  console.log('extract calls:', calls.filter((c) => c.startsWith('extract')).length, '| want:', calls.find((c) => c.startsWith('extract')));
  console.log('fill plan:', calls.find((c) => c.startsWith('tryos_plan')));
  await p.screenshot({ path: path.join(T, 'auto2-book.png'), fullPage: true });
  await p.click('#aTest'); await p.waitForSelector('#newTest');
  console.log('newtest title:', await p.inputValue('#newTest input[name=title]'), '| checked:', await p.$$eval('#tqList .check:checked', (x) => x.length));
  // yalnız AI
  calls.length = 0;
  await p.goto('http://app.test/#/auto'); await p.waitForSelector('#autoForm');
  console.log('kept after return:', await p.$$eval('#autoOut .mini', (x) => x.length));
  await p.fill('#autoForm input[name=topic]', 'Polinomlar');
  for (const i of [0, 1, 2]) await p.fill(`#autoForm input[name=n${i}]`, '1');
  await p.click('[data-src=ai]'); await p.click('#autoRun'); await p.waitForSelector('#aPdf', { timeout: 30000 });
  console.log('ai plan:', calls.find((c) => c.startsWith('tryos_plan')), '| groups:', (await p.$$eval('#autoOut .dgroup', (x) => x.map((e) => e.textContent.trim()))).join(' | '));
  await p.click('#aPdf'); await p.waitForSelector('.sheet'); console.log('print ok:', await p.$$eval('.sheet', (x) => x.length) > 0);
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
