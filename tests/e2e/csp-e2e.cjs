// CSP (index.html) heç nəyi səssizcə bloklamır: əsas səhifələr + real pdf.js ilə PDF açma + tələbə səhifəsi
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: [{ id: 's1', class_id: 'c1', full_name: 'Əli', access_code: 'ALI23456' }],
  questions: [{ id: 'q1', teacher_id: 'u1', body: 'Hesabla: $\\frac{1}{2}+\\frac{1}{3}$', qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: '1', option_figures: [], figure: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#000"/></svg>', created_at: new Date().toISOString() }],
  tests: [{ id: 't1', teacher_id: 'u1', class_id: 'c1', title: 'T', question_ids: ['q1'], is_open: true, created_at: new Date().toISOString() }], submissions: [], ai_usage: [] };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1300 } }); const errs = [];
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') {
      if (u.pathname.includes('pdf.worker')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(G + '/pdfjs-dist/build/pdf.worker.min.mjs') });
      if (u.pathname.includes('pdfjs-dist')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(G + '/pdfjs-dist/build/pdf.min.mjs') });
      if (u.pathname.includes('supabase')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(FX, 'mock-supabase.js')) });
      return route.fulfill({ contentType: u.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
    }
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.reload();
  for (const h of ['#/', '#/bank', '#/classes', '#/tests', '#/settings', '#/newtest']) { await p.goto('http://app.test/' + h); await p.waitForTimeout(400); if (await p.$('#auth')) { console.log('FAIL logged out at ' + h); process.exit(1); } }
  await p.goto('http://app.test/#/pdf'); await p.waitForSelector('#pdfPicker input[type=file]', { state: 'attached' });
  await p.setInputFiles('#pdfPicker input[type=file]', path.join(FX, 'book.pdf')); await p.waitForSelector('#pdfPicker canvas', { timeout: 20000 });
  console.log('pdf rendered:', await p.$eval('#pdfPicker canvas', (c) => c.width > 100));
  await p.goto('http://app.test/#/s/ALI23456/t1'); await p.waitForSelector('#st'); await p.waitForSelector('.q-fig svg');
  const v = await p.evaluate(() => window.__csp);
  console.log('csp violations:', JSON.stringify(v));
  if (v.length) { console.log('FAIL csp blocked something'); process.exit(1); }
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
