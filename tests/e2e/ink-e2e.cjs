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
// html2canvas təqlidi: seçimləri yadda saxlayır, elementin ölçüsündə (× scale) ağ şəkil qaytarır
const H2C = `window.html2canvas = async (el, o) => { const r = el.getBoundingClientRect(); window.__h2c = { scale: o.scale, sx: o.scrollX, sy: o.scrollY, w: Math.round(r.width), left: Math.round(r.left), top: Math.round(r.top), fixed: getComputedStyle(el).position, names: el.querySelectorAll('[name]').length, bars: el.querySelectorAll('.ink-bar').length };
  const c = document.createElement('canvas'); c.width = Math.round(r.width * o.scale); c.height = Math.round(r.height * o.scale); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000'; x.fillRect(10, 10, 40, 40); return c; };`;
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 820, height: 1100 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : u.pathname.includes('html2canvas') ? H2C : '' });
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
  // sualın şəkli: ayrıca sabit surətdən, yüksək keyfiyyətlə; surət sonra silinir
  await p.waitForFunction(() => window.__h2c && !document.querySelector('.ink-hint:not([hidden])'));
  const h = await p.evaluate(() => window.__h2c);
  console.log('capture:', `scale ${h.scale} | w ${h.w} | at ${h.left},${h.top} | ${h.fixed} | names ${h.names} | bars ${h.bars}`, '| clone removed:', await p.evaluate(() => !document.querySelector('body > div[aria-hidden="true"] fieldset')));
  // sualı böyüt / kiçilt / sürüşdür
  const inkData = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('_ink')))))[0]);
  await p.click('.ink-modal [data-zin]'); await p.click('.ink-modal [data-zin]');
  const b1 = (await inkData()).b;
  await p.click('.ink-modal [data-zout]');
  const b2 = (await inkData()).b;
  await p.click('.ink-modal [data-move]');
  console.log('move hint:', !(await p.$eval('.ink-hint', (x) => x.hidden)));
  const nS = (await inkData()).s.length;
  await line(200, 100, 260, 180);
  const b3 = (await inkData()).b;
  await p.click('.ink-modal [data-move]');
  // ovuc: barmaq yazır, sonra qələm gəlir → barmağın son xətti silinir; sonra barmaq yazmır, sualı da oynatmır
  const pe = (type, pointerType, id, x, y) => p.evaluate(([type, pointerType, id, x, y]) => { const c = document.querySelector('.ink-c2'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType, clientX: r.left + x, clientY: r.top + y, isPrimary: true })); }, [type, pointerType, id, x, y]);
  const nPalm = (await inkData()).s.length, bPalm = JSON.stringify((await inkData()).b);
  await pe('pointerdown', 'touch', 7, 500, 600); await pe('pointermove', 'touch', 7, 520, 610); await pe('pointerup', 'touch', 7, 520, 610);
  const afterTouch = (await inkData()).s.length;
  await pe('pointerdown', 'pen', 8, 100, 700); await pe('pointermove', 'pen', 8, 160, 720); await pe('pointerup', 'pen', 8, 160, 720);
  await pe('pointerdown', 'touch', 9, 300, 600); await pe('pointerdown', 'touch', 10, 400, 650); await pe('pointermove', 'touch', 9, 340, 640); await pe('pointermove', 'touch', 10, 460, 700); await pe('pointerup', 'touch', 9, 340, 640); await pe('pointerup', 'touch', 10, 460, 700);
  console.log('palm:', afterTouch - nPalm, '→', (await inkData()).s.length - nPalm, 'pen:', !(await inkData()).s.at(-1).t, '| question still:', JSON.stringify((await inkData()).b) === bPalm);
  await pe('pointerdown', 'pen', 8, 100, 750); await pe('pointerup', 'pen', 8, 100, 750); await p.click('.ink-modal [data-undo]'); await p.click('.ink-modal [data-undo]');
  // boş ağ kənarlar kəsilir → sualın özü (təqlidin qara kvadratı) böyük görünür
  console.log('trimmed bg dark:', await p.evaluate(() => { const c = document.querySelector('.ink-bgc'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) n++; return n / (d.length / 4) > 0.03; }));
  console.log('zoom:', b1.w > b2.w, '| moved:', b3.x - b2.x, b3.y - b2.y, '| no stroke while moving:', (await inkData()).s.length === nS);
  await p.screenshot({ path: path.join(T, 'ink1-draw.png') });
  // cavabı lövhədən işarələ
  await p.click('.ink-modal [data-a="1"]');
  console.log('ink answer:', await p.$$eval('.ink-modal .ink-a', (x) => x.map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join('')), '| form:', await p.$eval('#st fieldset', (f) => f.querySelector('input:checked')?.value));
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
