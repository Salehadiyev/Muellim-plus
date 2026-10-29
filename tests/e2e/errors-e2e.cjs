const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const DB = { classes: [], students: [], questions: [], tests: [], submissions: [], ai_usage: [], app_errors: [],
  teacher_access: [{ user_id: 'u1', email: 'a@b.az', approved: true, is_admin: true, daily_limit_usd: 10, monthly_limit_usd: 60 }] };
const ok = (m) => console.log('✓', m); const fail = (m) => { throw new Error(m); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 } }); const errs = [];
  let aiMode = 'abort';
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [{ key: 'opus', label: 'Opus', ready: true }] } });
    if (u.pathname === '/api/ai') return aiMode === 'abort' ? route.abort('internetdisconnected') : route.fulfill({ status: 429, json: { error: 'Bu günkü AI limiti doldu' } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/ai'); await p.reload(); await p.waitForSelector('[data-tab=topic]'); await p.click('[data-tab=topic]');
  await p.waitForSelector('#tyGen, #genTopic, form button[type=submit]');
  const go = async () => { await p.evaluate(() => { const b = document.querySelector('#tabBody form button[type=submit], #tabBody button.primary'); b.click(); }); await p.waitForSelector('#toast.show'); return p.textContent('#toast'); };
  console.log('  offline toast:', await go()); ok('network error → clear internet message');
  aiMode = 'limit'; await p.waitForTimeout(3500);
  console.log('  limit toast:', await go());
  // unexpected error → logged
  await p.evaluate(() => { setTimeout(() => { throw new Error('Gözlənilməz sınaq xətası'); }, 0); });
  await p.evaluate(() => { Promise.reject(new Error('Rədd edilmiş vəd')); });
  await p.waitForTimeout(500);
  const db = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  console.log('  logged:', db.app_errors.map((e) => e.source + ':' + e.message).join(' | '));
  if (db.app_errors.some((e) => /limit|İnternet|fetch/i.test(e.message))) fail('expected errors logged');
  if (!db.app_errors.some((e) => /Gözlənilməz sınaq xətası/.test(e.message))) fail('unexpected error not logged');
  if (db.app_errors.some((e) => /#\/s\/|[A-Z0-9]{8}/.test(e.url))) fail('code leaked in url');
  ok('only unexpected errors logged');
  await p.goto('http://app.test/#/settings'); await p.waitForSelector('#errCard table');
  console.log('  settings rows:', await p.$$eval('#errCard tbody tr', (x) => x.length)); await p.screenshot({ path: path.join(T, 'errors.png'), fullPage: true });
  await p.click('#errClear'); await p.waitForSelector('#errCard .empty'); ok('admin sees and clears errors');
  console.log(errs.filter((e) => !/Gözlənilməz|Rədd/.test(e)).length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
