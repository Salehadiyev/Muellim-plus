// Material videosu: müəllim, tələbə, telefon və xarici linklər.
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const DB = { classes: [{id:'c1',name:'11A',teacher_id:'u1',schedule:{slots:[{d:1,s:'16:00',e:'17:00'}]}}], students:[{id:'s1',class_id:'c1',full_name:'Əli',access_code:'ALI23456'},{id:'s2',class_id:'c1',full_name:'Nərgiz',access_code:'NRG23456'}],
questions:[{id:'q1',teacher_id:'u1',body:'2+2=?',topic:'Sayılar',qtype:'mcq',options:['3','4'],answer:'4'}],tests:[{id:'t1',teacher_id:'u1',class_id:'c1',title:'Sayılar testi',question_ids:['q1'],is_open:true,review_mode:'after_submit',created_at:new Date().toISOString()}], submissions:[],ai_usage:[],mistakes:[],student_questions:[],material_progress:[],student_ai_counts:{},lesson_notes:[{id:'n1',teacher_id:'u1',class_id:'c1',title:'Sayılar dərsi',topic:'Sayılar',body:'İzah',link_url:'https://youtu.be/dQw4w9WgXcQ',created_at:new Date().toISOString()}] };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1300 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url());
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('/katex@')){const rel=u.pathname.split('/dist/')[1];const f=path.join(__dirname,'../node_modules/katex/dist',rel);return route.fulfill({contentType:rel.endsWith('.css')?'text/css':rel.endsWith('.js')?'text/javascript':'font/woff2',body:fs.readFileSync(f)});}
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: u.pathname.includes('supabase') ? fs.readFileSync(path.join(FX, 'mock-supabase.js')) : '' });
    if (u.hostname === 'files.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (u.hostname === 'www.youtube-nocookie.com') return route.fulfill({ contentType: 'text/html', body: '<p>Video test</p>' });
    if (u.hostname !== 'app.test') return route.abort();
    if (u.pathname === '/api/student-solve') return (async()=>{const data=await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mockdb'));d.student_ai_counts.s1=(d.student_ai_counts.s1||0)+1;localStorage.setItem('mockdb',JSON.stringify(d));return d.student_ai_counts.s1;});return route.fulfill({json:{readable:true,question:'$2(x+3)=10$',steps:[{math:'2x+6=10',explanation:'Mötərizəni açaq.'},{math:'2x=4',explanation:'Hər iki tərəfdən 6 çıxaq.'},{math:'x=2',explanation:'Hər iki tərəfi 2-yə bölək.'}],answer:'$x=2$'}});})();
    if (u.pathname === '/api/config') return route.fulfill({ json: { supabaseUrl: 'x', supabaseAnonKey: 'k', models: [] } });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(f) }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const setDb = (d) => p.evaluate((x) => localStorage.setItem('mockdb', JSON.stringify(x)), d);
  await p.goto('http://app.test/'); await setDb(DB);

  const assert=require('node:assert/strict');
  await p.goto('http://app.test/#/s/ALI23456');await p.waitForSelector('.hub-solver-link');await p.click('.hub-solver-link');
  await p.waitForSelector('#solverQuota');assert.match(await p.locator('#solverQuota').textContent(),/daha 3 sual/);
  assert.doesNotMatch(await p.locator('.solver-page').innerText(),/\bSol\b|\bAI\b/);
  const solve=async()=>{await p.setInputFiles('#solverFile',path.join(FX,'page.jpg'));await p.waitForFunction(()=>!document.querySelector('#solverStart').disabled);await p.click('#solverStart');await p.waitForSelector('.solver-step');await p.waitForFunction(()=>!document.querySelector('#solverFile').disabled);};
  await solve();await p.click('#solverPause');assert.equal(await p.locator('.solver-step').count(),1);await p.waitForTimeout(3700);assert.equal(await p.locator('.solver-step').count(),1);
  await p.click('#solverNext');assert.equal(await p.locator('.solver-step').count(),2);await p.click('#solverAll');assert.equal(await p.locator('.solver-step').count(),3);assert.equal(await p.locator('#solverAnswer').isVisible(),true);
  for(const width of [390,768,1024]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await p.waitForSelector('#solverBoard .katex');
  await p.screenshot({path:path.join(T,'student-solver-board.png'),fullPage:true});
  await p.click('#solverReplay');assert.equal(await p.locator('.solver-step').count(),1);
  console.log('board: pause, next, full solution, replay and responsive layout ok');
  await solve();await solve();assert.match(await p.locator('#solverQuota').textContent(),/Bugünkü 3 sualını/);assert.equal(await p.locator('#solverStart').isDisabled(),true);
  await p.reload();await p.waitForSelector('#solverQuota');assert.match(await p.locator('#solverQuota').textContent(),/Bugünkü 3 sualını/);
  await p.goto('http://app.test/#/s/NRG23456/ask');await p.waitForFunction(()=>document.querySelector('#solverQuota')?.textContent.includes('daha 3 sual'));
  console.log('quota: three requests, reload persistence and student isolation ok');
  const d=await db();delete d.student_ai_counts;await setDb(d);await p.reload();await p.waitForSelector('text=Bölmə hazırda açılmır');
  assert.deepEqual(errs,[]);console.log('NO ERRORS');await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
