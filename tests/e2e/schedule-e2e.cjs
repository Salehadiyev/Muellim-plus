// Qrupun dərs cədvəli: qrup səhifəsində yazılır; «Dərslər» bu günün dərsini özü seçir, qeyd olunmamış dərs günlərini göstərir; 018 olmadan yumşaq xəta
const { chromium } = require(process.env.PW || 'playwright');
const assert=require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const sch = (slots) => ({ slots, since: '2026-10-27' });
const DB = { classes: [
    { id: 'c1', name: 'Mat 2-6', teacher_id: 'u1', schedule: sch([{ d: 2, s: '16:00', e: '17:00' }, { d: 6, s: '11:00', e: '12:00' }]) },
    { id: 'c2', name: 'Cerrahpaşa', teacher_id: 'u1', schedule: sch([{ d: 2, s: '18:00', e: '19:00' }, { d: 6, s: '10:00', e: '11:00' }]) },
    { id: 'c3', name: 'Matematik yeni', teacher_id: 'u1' }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli', access_code: 'A2345678' }, { id: 's2', class_id: 'c1', full_name: 'Bəxtiyar', access_code: 'B2345678' },
    { id: 's3', class_id: 'c2', full_name: 'Cavid', access_code: 'C2345678' }, { id: 's4', class_id: 'c3', full_name: 'Dilarə', access_code: 'D2345678' }],
  questions: [], tests: [], submissions: [], ai_usage: [], mistakes: [], lesson_notes: [], payments: [],
  lessons: [{ id: 'l1', teacher_id: 'u1', student_id: 's1', lesson_date: '2026-10-31', status: 'came', fee: 0, created_at: '2026-10-31T08:00:00Z' }] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1200 }, timezoneId: 'Asia/Baku' });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.clock.setFixedTime(new Date('2026-11-03T16:30:00+04:00')); // çərşənbə axşamı, 16:30
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/lessons'); await p.reload(); await p.waitForSelector('.ls-agenda');
  const chips = (sel) => p.$$eval(sel, (x) => x.map((e) => e.textContent.trim() + (e.classList.contains('on') ? '*' : '')).join(' | '));
  const names = () => p.$$eval('.ls-row .ls-who strong', (x) => x.map((e) => e.textContent).join(','));
  console.log('today:', await chips('.ag-line:first-child .ag-b'));
  console.log('missing:', await chips('.ag-b.miss'));
  console.log('auto:', await p.$eval('#lsClass', (s) => s.selectedOptions[0].textContent), '|', await p.$eval('#lsDate', (i) => i.value), '|', await names(), '|', (await p.textContent('.ls-quick > span.small')).trim());
  // B gəlmədi, Əli gəldi
  await p.click('.ls-row[data-sid="s2"] [data-att="missed"]'); await p.waitForSelector('.ls-row[data-sid="s2"] .on-miss');
  await p.click('.ls-row[data-sid="s1"] [data-att="came"]'); await p.waitForSelector('.ls-row[data-sid="s1"] .on-came');
  // keçmiş dərs: Mat 2-6 · 27 oktyabr
  await p.click('[data-ag="c1|2026-10-27"]'); await p.waitForFunction(() => document.querySelector('#lsDate').value === '2026-10-27');
  console.log('past:', await p.$eval('#lsClass', (s) => s.selectedOptions[0].textContent), (await p.textContent('.ls-quick > span.small')).trim());
  await p.click('#allCame'); await p.waitForFunction(() => document.querySelectorAll('.ag-b.miss').length === 3);
  console.log('missing after:', await chips('.ag-b.miss'));
  const d = await db(); console.log('saved:', d.lessons.map((l) => `${l.student_id}:${l.lesson_date}:${l.status}`).sort().join(','));
  assert.match(await p.locator('.ls-date-card[data-lesson-date="2026-10-31"]').innerText(),/1\/2 qeyd edilib/);
  await p.click('.ls-date-nav [data-lesson-date="2026-10-31"]');await p.waitForFunction(()=>document.querySelector('#lsDate').value==='2026-10-31');
  await p.click('.ls-date-nav [data-lesson-date="2026-11-03"]');await p.waitForFunction(()=>document.querySelector('#lsDate').value==='2026-11-03');
  assert.match(await p.locator('.ls-date-card[data-lesson-date="2026-11-03"]').innerText(),/Tam qeyd edilib/);
  await p.clock.setFixedTime(new Date('2026-11-04T12:00:00+04:00'));
  await p.selectOption('#lsClass','c2');await p.waitForFunction(()=>document.querySelector('#lsDate').value==='2026-11-03');
  assert.equal(await names(),'Cavid');
  await p.selectOption('#lsClass','c3');await p.waitForFunction(()=>document.querySelector('#lsDate').value==='2026-11-04');assert.match(await p.locator('#view').innerText(),/Bu qrupun dərs cədvəli yazılmayıb/);
  await p.selectOption('#lsClass','c1');await p.waitForFunction(()=>document.querySelector('#lsDate').value==='2026-11-03');
  await p.fill('#lsDate','2026-11-04');await p.dispatchEvent('#lsDate','change');assert.match(await p.locator('.ls-schedule').innerText(),/cədvəldən kənardır/);
  assert.equal((await db()).lessons.length,d.lessons.length);
  for(const width of [390,768,1024]){await p.setViewportSize({width,height:1200});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  console.log('schedule cards: partial, complete, month crossing, group switch, extra date and responsive ok');
  await p.screenshot({ path: path.join(T, 'sched1-lessons.png'), fullPage: true });
  // qrup səhifəsində cədvəl yaz: 3-cü və 5-ci gün 14:00–15:00
  await p.goto('http://app.test/#/class/c3'); await p.waitForSelector('#schEdit'); await p.click('#schEdit');
  await p.selectOption('[data-sd="0"]', '3'); await p.fill('[data-ss="0"]', '14:00'); await p.fill('[data-se="0"]', '15:00');
  await p.click('#schAdd'); await p.selectOption('[data-sd="1"]', '5'); await p.click('#schSave'); await p.waitForSelector('#schEdit');
  console.log('group sched:', (await p.textContent('#schedBox')).replace(/\s+/g, ' ').trim(), '| db:', JSON.stringify((await db()).classes[2].schedule.slots));
  await p.click('#schEdit'); await p.fill('[data-se="0"]', '13:00'); await p.click('#schSave'); await p.waitForTimeout(200);
  console.log('bad time:', (await p.textContent('#toast')).trim());
  await p.screenshot({ path: path.join(T, 'sched2-group.png') });
  // 018 olmadan
  await p.evaluate(() => { const x = JSON.parse(localStorage.getItem('mockdb')); x.__missing_columns = { classes: ['schedule'] }; localStorage.setItem('mockdb', JSON.stringify(x)); });
  await p.goto('http://app.test/#/class/c3'); await p.reload(); await p.waitForSelector('#schEdit'); await p.click('#schEdit'); await p.click('#schSave'); await p.waitForTimeout(300);
  console.log('no 018:', (await p.textContent('#toast')).trim());
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
