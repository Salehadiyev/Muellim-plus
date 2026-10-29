const { chromium } = require(process.env.PW || 'playwright'); const base = { classes: [], students: [], questions: [], tests: [], submissions: [], ai_usage: [] };
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const DB = { ...base, teacher_access: [
  { user_id: 'u1', email: 'saleh@x.az', approved: true, is_admin: true, daily_limit_usd: 2, monthly_limit_usd: 20, today: 1.7, month: 6.2 },
  { user_id: 'u2', email: 'yeni@x.az', approved: false, is_admin: false, daily_limit_usd: 2, monthly_limit_usd: 20 }] };
const errs = []; const ok = (m) => console.log('✓', m); const fail = (m) => { throw new Error(m); };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 } });
    await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
      if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
      if (u.hostname !== 'app.test') return route.abort();
      if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k' } });
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept()); return p; };
  const sess = (id, email) => JSON.stringify({ access_token: 'tok', user: { id, email } });
  // admin
  const a = await mk(); await a.goto('http://app.test/');
  await a.evaluate(([d, s]) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', s); }, [DB, sess('u1', 'saleh@x.az')]);
  await a.reload(); await a.waitForSelector('text=Açıq testlər');
  console.log('  dashboard warning:', await a.$eval('.page-head + p', (e) => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('  nav:', await a.$$eval('nav .item', (x) => x.map((e) => e.textContent.trim()).join(' | ')));
  await a.click('nav >> text=Ayarlar'); await a.waitForSelector('text=Müəllimlər ›'); await a.screenshot({ path: path.join(T, 'set1.png'), fullPage: true });
  await a.click('text=Müəllimlər ›'); await a.waitForSelector('[data-save]'); ok('admin: settings → teachers');
  console.log('  rows:', await a.$$eval('tbody tr', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim())), '| notice:', await a.$eval('.notice', (e) => e.textContent));
  await a.screenshot({ path: path.join(T, 'ac1.png') });
  const r2 = 'tr[data-uid=u2]'; await a.check(`${r2} [data-f=approved]`); await a.fill(`${r2} [data-f=daily_limit_usd]`, '1'); await a.fill(`${r2} [data-f=monthly_limit_usd]`, '10'); await a.click(`${r2} [data-save]`);
  await a.waitForSelector('text=Yadda saxlandı');
  let db = await a.evaluate(() => JSON.parse(localStorage.getItem('mockdb'))); const u2 = db.teacher_access.find((x) => x.user_id === 'u2');
  console.log('  saved u2:', u2.approved, u2.daily_limit_usd, u2.monthly_limit_usd); ok('admin approves and sets limits');
  // pending teacher
  const p = await mk(); await p.goto('http://app.test/');
  db.teacher_access[1].approved = false;
  await p.evaluate(([d, s]) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', s); }, [db, sess('u2', 'yeni@x.az')]);
  await p.reload(); await p.waitForSelector('text=Təsdiq gözlənilir'); await p.screenshot({ path: path.join(T, 'ac2.png') });
  await p.goto('http://app.test/#/bank'); await p.waitForSelector('text=Təsdiq gözlənilir'); ok('unapproved: waiting screen on every page');
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.teacher_access[1].approved = true; localStorage.setItem('mockdb', JSON.stringify(d)); });
  await p.click('#recheck'); await p.waitForSelector('nav'); await p.click('nav >> text=Ayarlar'); await p.waitForSelector('text=Hesab'); if (await p.isVisible('text=Müəllimlər ›')) fail('non-admin sees admin'); ok('after approval: app opens, no admin menu');
  // student pages unaffected
  await p.goto('http://app.test/#/s'); await p.waitForSelector('#codeForm'); ok('student pages not gated');
  // without 008
  const n = await mk(); await n.goto('http://app.test/');
  await n.evaluate(([d, s]) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', s); }, [base, sess('u1', 'saleh@x.az')]);
  await n.reload(); await n.waitForSelector('text=Açıq testlər'); if (await n.isVisible('text=AI xərci')) fail('limit line w/o 008'); ok('without 008: works as before');
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message, errs); process.exit(1); });
