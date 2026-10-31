const { chromium }=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'../..');
const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7);
const DB={lessons:[],payments:[],classes:[],students:[],questions:[],tests:[],submissions:[],ai_usage:[],
 teacher_access:[{user_id:'u1',approved:true,is_admin:false}],
 payment_assistants:[{user_id:'helper',teacher_id:'u1',email:'qesem@example.test',display_name:'Qəşəm',active:true}],assistant_payment_log:[],
 assistant_students:[{id:'s1',name:'Əli <b>Həsənov</b>',parent_phone:'+994501234567',class_name:'Riyaziyyat',monthly_fee:200,pay_day:5,next_month:month+'-01',remaining:150,lessons:[{date:month+'-01',status:'came',topic:'Tənliklər'}]}]};
(async()=>{
 const b=await chromium.launch(),ctx=await b.newContext({viewport:{width:390,height:844}}),errors=[];
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());
  if(u.hostname==='cdn.jsdelivr.net')return r.fulfill({contentType:'text/javascript',body:u.pathname.includes('supabase')?fs.readFileSync(path.join(ROOT,'tests/fixtures/mock-supabase.js')):''});
  if(u.hostname!=='app.test')return r.abort();
  if(u.pathname==='/api/config')return r.fulfill({json:{supabaseUrl:'x',supabaseAnonKey:'k',models:[]}});
  const f=path.join(ROOT,u.pathname==='/'?'index.html':u.pathname);
  return r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)});
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto('http://app.test/');
 await p.evaluate(d=>{localStorage.setItem('mockdb',JSON.stringify(d));localStorage.setItem('mocksession',JSON.stringify({access_token:'tok',user:{id:'helper',email:'qesem@example.test'}}));},DB);
 await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mockdb'));d.students=[{id:'s1',class_id:'c1',full_name:'Əli',lesson_price:200}];d.classes=[{id:'c1',name:'Riyaziyyat',teacher_id:'u1'}];localStorage.setItem('mockdb',JSON.stringify(d));localStorage.setItem('mocksession',JSON.stringify({access_token:'tok',user:{id:'u1'}}));});
 await p.goto('http://app.test/#/student/s1');await p.reload();await p.waitForSelector('#parentPhoneForm');
 const field=p.locator('[name=parent_phone]'), save=p.locator('#parentPhoneForm button');
 await field.fill('050 123 45 67');await save.click();await p.waitForSelector('text=✓ Nömrə saxlanıldı.');
 assert.equal(await field.inputValue(),'+994501234567');assert.equal(await p.locator('.parent-whatsapp').getAttribute('href'),'https://wa.me/994501234567');
 await p.reload();await p.waitForSelector('#parentPhoneForm');assert.equal(await field.inputValue(),'+994501234567');
 await field.fill('javascript:alert(1)');await save.click();assert.match(await p.locator('#parentPhoneStatus').innerText(),/düzgün/);
 await field.fill('+90 532 123 45 67');await save.click();await p.waitForFunction(()=>document.querySelector('.parent-whatsapp')?.href==='https://wa.me/905321234567');
 await p.goto('http://app.test/#/lessons');await p.waitForSelector('[data-ls-mode="payments"]');await p.locator('[data-ls-mode="payments"]').click();
 assert.equal(await p.locator('.parent-whatsapp').getAttribute('href'),'https://wa.me/905321234567');
 for(const width of [390,768,1024]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await p.goto('http://app.test/#/student/s1');await p.waitForSelector('#parentPhoneForm');await field.fill('');await save.click();await p.waitForSelector('text=✓ Nömrə silindi.');assert.equal(await p.locator('.parent-whatsapp').count(),0);
 console.log('parent phone: save, reload, edit, remove, validation and payment links ok');
 await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mockdb'));d.__missing_columns={students:['parent_phone']};localStorage.setItem('mockdb',JSON.stringify(d));});
 await field.fill('0501234567');await save.click();await p.waitForSelector('text=Saxlanılmadı: bazada 022_parent_phone.sql');
 await p.goto('http://app.test/#/lessons');await p.waitForSelector('[data-sid="s1"]');
 console.log('parent phone: missing migration keeps lessons usable');
 assert.deepEqual(errors,[]);console.log('NO ERRORS');await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
