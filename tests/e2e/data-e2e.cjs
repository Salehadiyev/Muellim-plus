const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const now = new Date().toISOString();
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1', created_at: now }], students: [{ id: 's1', class_id: 'c1', full_name: 'Əli', access_code: 'ALI23456', created_at: now }],
  questions: Array.from({ length: 1205 }, (_, i) => ({ id: 'q' + i, teacher_id: 'u1', body: 'S ' + i, qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: '1', option_figures: [], created_at: new Date(Date.now() - i * 1000).toISOString() })),
  tests: [], submissions: [{ id: 'x', test_id: 't', student_name: 'Əli', answers: {}, score: 1, total: 1, created_at: now }], ai_usage: [] };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1024, height: 1000 }, acceptDownloads: true }); const errs = [];
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); }, DB);
  // privacy without login
  await p.goto('http://app.test/#/privacy'); await p.reload(); await p.waitForSelector('text=Məxfilik siyasəti'); await p.click('#pvBack'); console.log('✓ privacy page public');
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  await p.goto('http://app.test/#/settings'); await p.reload(); await p.waitForSelector('#exportBtn');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  const file = path.join(T, dl.suggestedFilename()); await dl.saveAs(file);
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('export:', dl.suggestedFilename().replace(/\d{4}-\d\d-\d\d/, 'DATE'), JSON.stringify(dump.counts));
  if (dump.questions.length !== 1205) { console.log('FAIL paging'); process.exit(1); }
  console.log('✓ export all data (paged)');
  console.log('csp:', JSON.stringify(await p.evaluate(() => window.__csp)));
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
