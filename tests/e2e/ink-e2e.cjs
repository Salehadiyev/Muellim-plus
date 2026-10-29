// Qaralama: tələbə sualın üstündə yazır (yadda qalır), göndərəndə şəkil müəllimə gedir; 015 olmadan test yenə göndərilir
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const q = (id, body, ans) => ({ id, teacher_id: 'u1', body, qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: ans, option_figures: [], topic: 'Sayılar', created_at: new Date().toISOString() });
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }], students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }],
  questions: [q('11111111-1111-4111-8111-111111111111', '12 · 3 = ?', '36'.slice(0, 1)), q('22222222-2222-4222-8222-222222222222', '7 + 8 = ?', '5')],
  tests: [{ id: 'tA', teacher_id: 'u1', class_id: 'c1', title: 'Hesab', question_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], is_open: true, review_mode: 'after_submit', created_at: new Date().toISOString() },
          { id: 'tB', teacher_id: 'u1', class_id: 'c1', title: 'İkinci', question_ids: ['22222222-2222-4222-8222-222222222222'], is_open: true, review_mode: 'after_submit', created_at: new Date().toISOString() }],
  submissions: [], ai_usage: [], mistakes: [], lesson_notes: [], lessons: [], payments: [], submission_drawings: [] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 820, height: 1100 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  await p.goto('http://app.test/'); await p.evaluate((d) => localStorage.setItem('mockdb', JSON.stringify(d)), DB);
  await p.goto('http://app.test/#/s/ALI23456/tA'); await p.reload(); await p.waitForSelector('#st .ink-open-btn');
  console.log('ink buttons:', await p.$$eval('#st .ink-open-btn', (x) => x.length));
  await p.click('#st fieldset >> nth=0 >> .ink-open-btn'); await p.waitForSelector('.ink-modal canvas.ink-c2');
  const box = await (await p.$('.ink-c2')).boundingBox();
  const line = async (x1, y1, x2, y2) => { await p.mouse.move(box.x + x1, box.y + y1); await p.mouse.down(); await p.mouse.move(box.x + x2, box.y + y2, { steps: 8 }); await p.mouse.up(); };
  await line(60, 300, 300, 340); await line(80, 380, 260, 420);
  await p.click('.ink-modal [data-c="#dc2626"]'); await line(100, 450, 320, 450);
  await p.click('.ink-modal [data-undo]');
  await p.screenshot({ path: path.join(T, 'ink1-draw.png') });
  await p.click('.ink-modal [data-done]'); await p.waitForSelector('.ink-modal', { state: 'detached' });
  console.log('label after:', (await p.textContent('#st fieldset >> nth=0 >> .ink-open-btn')).trim());
  // yenilə — yazılar qalır
  await p.reload(); await p.waitForSelector('#st .ink-open-btn');
  console.log('after reload:', (await p.textContent('#st fieldset >> nth=0 >> .ink-open-btn')).trim(), '| strokes:', await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('_ink')))))[0].s.length));
  await p.check('#st input[value="3"] >> nth=0'); await p.check('#st fieldset >> nth=1 >> input[value="5"]');
  await p.click('#st button[type=submit]'); await p.waitForSelector('.score-big');
  let d = await db(); console.log('saved drawings:', d.submission_drawings.map((x) => x.question_id.slice(0, 8) + ':' + x.image.slice(0, 23) + ':' + (x.image.length > 1000)).join(','), '| ink draft cleared:', !(await p.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('_ink')))));
  // müəllim görür
  await p.evaluate(() => localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })));
  await p.setViewportSize({ width: 1024, height: 1200 });
  await p.goto('http://app.test/#/test/tA'); await p.reload(); await p.click('[data-sub] >> text=Əli Həsənov'); await p.waitForSelector('#rvDialog .rv-ink img');
  console.log('teacher sees:', await p.$$eval('#rvDialog .rv-ink', (x) => x.length), '|', (await p.textContent('#rvDialog p.muted')).replace(/\s+/g, ' ').includes('1 sualda həll yazıb'));
  await p.screenshot({ path: path.join(T, 'ink2-teacher.png'), fullPage: true });
  // 015 olmadan: test yenə göndərilir
  d.submission_drawings = undefined; await p.evaluate((x) => { delete x.submission_drawings; localStorage.setItem('mockdb', JSON.stringify(x)); localStorage.removeItem('mocksession'); }, d);
  await p.setViewportSize({ width: 820, height: 1100 });
  await p.goto('http://app.test/#/s/ALI23456/tB'); await p.reload(); await p.waitForSelector('#st .ink-open-btn');
  await p.click('#st .ink-open-btn'); await p.waitForSelector('.ink-c2'); const bx2 = await (await p.$('.ink-c2')).boundingBox();
  await p.mouse.move(bx2.x + 50, bx2.y + 300); await p.mouse.down(); await p.mouse.move(bx2.x + 200, bx2.y + 320, { steps: 5 }); await p.mouse.up(); await p.click('.ink-modal [data-done]');
  await p.check('#st input[value="5"]'); await p.click('#st button[type=submit]'); await p.waitForSelector('.score-big');
  console.log('no 015 submit ok:', (await db()).submissions.length === 2, '| toast:', (await p.textContent('#toast')).trim());
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
