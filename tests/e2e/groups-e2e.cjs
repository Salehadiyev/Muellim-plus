// Tələbələr səhifəsi + qruplar (yarat, qrupa qoy, köçür, qrup silinəndə Qrupsuz), materiallar (bir neçə qrupa, video link), test bir neçə qrupa
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const DB = { classes: [{ id: 'c1', name: '11A', teacher_id: 'u1' }],
  students: [{ id: 's1', class_id: 'c1', full_name: 'Əli Həsənov', access_code: 'ALI23456' }, { id: 's2', class_id: 'c1', full_name: 'Nərgiz Quliyeva', access_code: 'NRG23456' }],
  questions: [{ id: 'q1', teacher_id: 'u1', body: 'Bank sualı', qtype: 'mcq', options: ['1', '2', '3', '4', '5'], answer: '2', option_figures: [], ai_status: 'passed', created_at: new Date().toISOString() }],
  tests: [{ id: 'pt1', teacher_id: 'u1', class_id: 'c1', student_id: 's1', title: 'Əli üçün', question_ids: ['q1'], is_open: true, created_at: new Date().toISOString() }], submissions: [], ai_usage: [], mistakes: [], lesson_notes: [], lessons: [], payments: [] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1200 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  let promptAnswer = null; p.on('dialog', (d) => (d.type() === 'prompt' && promptAnswer !== null ? d.accept(promptAnswer) : d.accept()));
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const gname = (d, sid) => (d.classes.find((c) => c.id === d.students.find((s) => s.id === sid || s.full_name === sid)?.class_id) || {}).name;
  await p.goto('http://app.test/'); await p.evaluate((d) => { localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocksession', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.az' } })); }, DB);
  await p.goto('http://app.test/#/'); await p.reload(); await p.waitForSelector('nav');
  console.log('nav:', (await p.$$eval('nav a.item', (x) => x.map((e) => e.textContent.trim()))).join(' | '));
  await p.click('nav >> text=Tələbələr'); await p.waitForSelector('#stList .st-row');
  // yeni qrupla 2 tələbə
  await p.click('#stNewBtn'); await p.fill('#stNew textarea', 'Rəşad Məmmədov\nAysel Kərimova'); await p.selectOption('#stNew select[name=grp]', '__new');
  await p.fill('#stNew input[name=newgrp]', 'B qrupu'); await p.click('#stNew button[type=submit]'); await p.waitForSelector('text=2 tələbə əlavə olundu');
  let d = await db(); console.log('new group:', gname(d, 'Rəşad Məmmədov'), gname(d, 'Aysel Kərimova'));
  // qrupsuz tələbə
  await p.waitForSelector('#stNewBtn'); await p.click('#stNewBtn'); await p.fill('#stNew textarea', 'Tural Hüseynov'); await p.click('#stNew button[type=submit]'); await p.waitForSelector('text=1 tələbə əlavə olundu');
  d = await db(); console.log('no group:', gname(d, 'Tural Hüseynov'), '| groups:', d.classes.map((c) => c.name).join(','));
  await p.waitForSelector('#stList .st-row');
  console.log('chips:', (await p.$$eval('#stChips .chip', (x) => x.map((e) => e.textContent.trim()))).join(' | '));
  // toplu köçür: Əli + Nərgiz → B qrupu
  const bId = d.classes.find((c) => c.name === 'B qrupu').id;
  await p.check('[data-sel=s1]'); await p.check('[data-sel=s2]'); await p.selectOption('#bulkTo', bId); await p.click('#bulkGo'); await p.waitForSelector('text=2 tələbə köçürüldü');
  d = await db(); console.log('bulk moved:', gname(d, 's1'), gname(d, 's2'));
  console.log('personal test follows:', (d.classes.find((c) => c.id === d.tests.find((t) => t.id === 'pt1').class_id) || {}).name);
  await p.waitForSelector('#stList .st-row');
  await p.selectOption('[data-move=s1]', 'c1'); await p.waitForSelector('text=1 tələbə köçürüldü');
  d = await db(); console.log('row moved:', gname(d, 's1'));
  await p.screenshot({ path: path.join(T, 'gr1-students.png'), fullPage: true });
  // B qrupunu sil → tələbələr Qrupsuz
  await p.goto('http://app.test/#/class/' + bId); await p.waitForSelector('.danger-zone'); await p.click('.danger-zone summary'); await p.click('#delClass'); await p.waitForSelector('.ccards');
  d = await db(); console.log('after delete:', d.classes.map((c) => c.name).join(','), '| moved to:', ['s2', 'Rəşad Məmmədov', 'Aysel Kərimova'].map((x) => gname(d, x)).join(','), '| students kept:', d.students.length);
  // materiallar: iki qrupa video link
  await p.click('nav >> text=Materiallar'); await p.waitForSelector('#ntNew'); await p.click('#ntNew');
  await p.fill('#ntForm input[name=title]', 'Video: Fonksiyonlar'); await p.fill('#ntForm input[name=link]', 'https://youtu.be/xyz');
  const noG = d.classes.find((c) => c.name === 'Qrupsuz').id;
  await p.check(`#ntForm input[name=grp][value=c1]`); await p.check(`#ntForm input[name=grp][value="${noG}"]`);
  await p.click('#ntForm button[type=submit]'); await p.waitForSelector('text=Material 2 yerə göndərildi');
  d = await db(); console.log('notes:', d.lesson_notes.map((n) => (d.classes.find((c) => c.id === n.class_id) || {}).name + ':' + n.link_url).join(','));
  await p.screenshot({ path: path.join(T, 'gr2-materials.png'), fullPage: true });
  // test iki qrupa
  await p.goto('http://app.test/#/newtest'); await p.waitForSelector('#newTest'); await p.fill('#newTest input[name=title]', 'Ortaq test'); await p.selectOption('#newTest select[name=class_id]', 'c1');
  await p.check(`#moreGroups input[name=also][value="${noG}"]`); await p.check('#tqList .check'); await p.click('#newTest button[type=submit]'); await p.waitForSelector('text=Test 2 qrupa göndərildi');
  d = await db(); console.log('tests:', d.tests.filter((t) => !t.student_id).map((t) => t.title + '@' + (d.classes.find((c) => c.id === t.class_id) || {}).name).join(','));
  // tələbə: video düyməsi
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto('http://app.test/#/s/ALI23456'); await p.waitForSelector('details.nt-item'); await p.click('details.nt-item summary');
  console.log('student video:', await p.$eval('details.nt-item a.btn', (e) => e.textContent.trim() + ' → ' + e.href), '| todo:', await p.$$eval('a.portal-row', (x) => x.length));
  await p.screenshot({ path: path.join(T, 'gr3-student.png'), fullPage: true });
  // adını dəyiş, tək sil, toplu sil
  await p.setViewportSize({ width: 1024, height: 1200 });
  d = await db(); const tural = d.students.find((x) => x.full_name === 'Tural Hüseynov').id, aysel = d.students.find((x) => x.full_name === 'Aysel Kərimova').id, resad = d.students.find((x) => x.full_name === 'Rəşad Məmmədov').id;
  await p.goto('http://app.test/#/students'); await p.waitForSelector('#stList .st-row');
  promptAnswer = 'Tural Hüseynli'; await p.click(`.st-row:has([data-ren="${tural}"]) .more summary`); await p.click(`[data-ren="${tural}"]`); await p.waitForSelector('text=Ad dəyişdirildi');
  await p.waitForSelector('#stList .st-row'); await p.click(`.st-row:has([data-sdel="${aysel}"]) .more summary`); await p.click(`[data-sdel="${aysel}"]`); await p.waitForSelector('text=Aysel Kərimova silindi');
  await p.waitForSelector('#stList .st-row'); await p.check(`[data-sel="${resad}"]`); await p.check(`[data-sel="${tural}"]`); await p.click('#bulkDel'); await p.waitForSelector('text=2 tələbə silindi');
  d = await db(); console.log('after edit/delete:', d.students.map((x) => x.full_name).sort().join(','));
  // qrup kartı: ⋯ → adını dəyiş, sil (Qrupsuz boş deyil → silinmir)
  await p.goto('http://app.test/#/classes'); await p.waitForSelector('.ccard-wrap');
  promptAnswer = '11A qrupu'; await p.click('.ccard-wrap:has([data-gren=c1]) .cc-more summary'); await p.click('[data-gren=c1]'); await p.waitForSelector('text=Qrupun adı dəyişdirildi');
  await p.waitForSelector('.ccard-wrap'); await p.click('.ccard-wrap:has([data-gren=c1]) .cc-more summary'); await p.click('[data-gdel=c1]'); await p.waitForSelector('text=«11A qrupu» silindi');
  d = await db(); console.log('card rename+delete:', d.classes.map((c) => c.name).join(','), '| Əli now:', gname(d, 's1'), '| personal test:', (d.classes.find((c) => c.id === d.tests.find((t) => t.id === 'pt1')?.class_id) || {}).name);
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO ERRORS'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
