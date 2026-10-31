const { chromium }=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'../..');
const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7);
const DB={classes:[],students:[],questions:[],tests:[],submissions:[],ai_usage:[],
 teacher_access:[{user_id:'u1',approved:true,is_admin:false}],
 payment_assistants:[{user_id:'helper',teacher_id:'u1',email:'qesem@example.test',display_name:'Qəşəm',active:true}],assistant_payment_log:[],
 assistant_students:[{id:'s1',name:'Əli <b>Həsənov</b>',class_name:'Riyaziyyat',monthly_fee:200,pay_day:5,next_month:month+'-01',remaining:150,lessons:[{date:month+'-01',status:'came',topic:'Tənliklər'}]}]};
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
 await p.reload();await p.waitForSelector('[data-assistant-pay]');
 assert.deepEqual(await p.locator('nav .item').allTextContents(),['Dərslər']);assert.equal(await p.locator('#assistantRows h2 b').count(),0);
 for(const hash of ['bank','settings','students','teachers']){await p.goto('http://app.test/#/'+hash);await p.waitForSelector('[data-assistant-pay]');assert.deepEqual(await p.locator('nav .item').allTextContents(),['Dərslər']);}
 await p.locator('summary').click();assert.match(await p.locator('#assistantRows').innerText(),/Gəldi.*Tənliklər/);
 for(const width of [390,768]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 console.log('restricted routes and responsive lessons ok');
 await p.locator('[data-assistant-pay]').click();await p.waitForSelector('text=Ödəniş qeydə alındı.');assert.equal(await p.locator('[data-assistant-pay]').count(),0);
 const log=await p.evaluate(()=>JSON.parse(localStorage.getItem('mockdb')).assistant_payment_log);assert.equal(log.length,1);assert.equal(log[0].actor_name,'Qəşəm');assert.equal(log[0].amount,150);
 console.log('payment confirmed and audit saved ok');
 await p.evaluate(()=>localStorage.setItem('mocksession',JSON.stringify({access_token:'tok',user:{id:'u1',email:'saleh@example.test'}})));
 await p.goto('http://app.test/#/settings');await p.reload();await p.waitForSelector('#assistantGrant');
 assert.equal(await p.locator('#assistantGrant [name=name]').inputValue(),'Qəşəm');
 await p.locator('[data-toggle-assistant]').click();await p.waitForSelector('[data-toggle-assistant]:has-text("Aktivləşdir")');
 await p.evaluate(()=>localStorage.setItem('mocksession',JSON.stringify({access_token:'tok',user:{id:'helper',email:'qesem@example.test'}})));
 await p.reload();await p.waitForSelector('text=Giriş icazən bağlanıb.');assert.equal(await p.locator('[data-assistant-pay]').count(),0);
 console.log('owner revokes access and helper blocked ok');
 assert.deepEqual(errors,[]);console.log('NO ERRORS');await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
