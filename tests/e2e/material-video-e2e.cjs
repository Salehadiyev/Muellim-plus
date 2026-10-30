// Material videosu: müəllim, tələbə, telefon və xarici linklər.
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const DB = { classes: [{id:'c1',name:'11A',teacher_id:'u1'}], students: [{id:'s1',class_id:'c1',full_name:'Test',access_code:'ALI23456'}], questions: [], tests: [], submissions: [], ai_usage: [], mistakes: [], lesson_notes: [
'https://youtu.be/dQw4w9WgXcQ?t=1m30s', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://drive.google.com/file/d/example', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'
].map((link_url,i)=>({id:'n'+i,teacher_id:'u1',class_id:'c1',title:'Video '+i,link_url,created_at:new Date().toISOString()})) };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1300 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname === 'files.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (u.hostname === 'www.youtube-nocookie.com') return route.fulfill({ contentType: 'text/html', body: '<p>Video test</p>' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (d) => p.evaluate((x) => localStorage.setItem('mockdb', JSON.stringify(x)), d);
  await p.goto('http://app.test/'); await setDb(DB);

  const assert = require('node:assert/strict');
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  await p.goto('http://app.test/#/materials'); await p.reload();
  await p.waitForSelector('.material-video iframe');
  assert.equal(await p.locator('.material-video iframe').count(), 3);
  assert.equal(await p.locator('.material-video iframe').first().getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&start=90');
  console.log('teacher: embeds and timestamp ok');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto('http://app.test/#/s/ALI23456');
  await p.waitForSelector('details.nt-item');
  await p.locator('details.nt-item summary').first().click();
  assert.equal(await p.locator('.material-video iframe').count(), 3);
  await p.waitForFunction(() => { const r = document.querySelector('.material-video iframe')?.getBoundingClientRect(); return r && r.width > 200 && r.width < 390 && r.height > 100; });
  const bounds = await p.locator('.material-video iframe').first().boundingBox();
  assert(bounds.width > 200 && bounds.width < 390 && bounds.height > 100);
  assert.equal(await p.locator('a[href="https://drive.google.com/file/d/example"]').count(), 1);
  assert.equal(await p.locator('iframe[src*="evil"]').count(), 0);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await p.screenshot({ path: path.join(T, 'material-video-mobile.png'), fullPage: true });
  console.log('student: inline video, mobile layout and external fallback ok');
  assert.deepEqual(errs, []);
  console.log('NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
