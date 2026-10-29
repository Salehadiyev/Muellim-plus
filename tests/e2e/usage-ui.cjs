const { chromium } = require(process.env.PW || 'playwright'); 
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const errors=[];
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1024,height:1300}});
 await ctx.route('**/*', async r=>{ const u=new URL(r.request().url());
  if(u.hostname==='cdn.jsdelivr.net'){ if(u.pathname.includes('katex')) return r.fulfill({contentType:'text/javascript',body:''}); return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(FX,'mock-supabase.js'))}); }
  if(u.hostname!=='app.test') return r.abort();
  if(u.pathname==='/api/config') return r.fulfill({json:{supabaseUrl:'x',supabaseAnonKey:'k',models:[{key:'opus',label:'Claude Opus 5.5',ready:true},{key:'gemini-flash',label:'Gemini Flash (ən son)',ready:true},{key:'gpt-sol',label:'GPT-6.1 Sol',ready:true}]}});
  const f=path.join(ROOT,u.pathname==='/'?'index.html':u.pathname); if(!fs.existsSync(f)) return r.fulfill({status:404,body:''});
  r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)}); });
 const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://app.test/'); await p.evaluate(()=>{ const now=new Date().toISOString(), old='2026-09-01T00:00:00Z';
   localStorage.setItem('mockdb', JSON.stringify({classes:[],students:[],tests:[],submissions:[],
    ai_usage:[{model:'opus',role:'main',cost_usd:0.3,questions:3,created_at:now},{model:'sonnet',for_model:'opus',role:'helper',cost_usd:0.05,questions:0,created_at:now},
      {model:'gemini-flash',role:'main',cost_usd:0.06,questions:3,created_at:now},{model:'sonnet',for_model:'gemini-flash',role:'helper',cost_usd:0.04,questions:0,created_at:now},
      {model:'opus',role:'main',cost_usd:1,questions:10,created_at:old}],
    questions:[{id:'a',model:'opus',created_at:now,body:'x'},{id:'b',model:'opus',created_at:now,body:'x'},{id:'c',model:'gemini-flash',created_at:now,body:'x'},{id:'d',created_at:now,body:'y'}]}));
   localStorage.setItem('mocksession', JSON.stringify({access_token:'tok',user:{id:'u1',email:'a@b.az',user_metadata:{}}})); });
 await p.goto('http://app.test/#/settings'); await p.reload(); await p.waitForSelector('#usageCard table');
 const rows=async()=>p.$$eval('#usageCard tbody tr',x=>x.map(r=>[...r.cells].map(c=>c.textContent.trim()).join(' | ')));
 console.log('month:\n '+(await rows()).join('\n '));
 await p.click('[data-period=all]'); await p.waitForTimeout(300); console.log('all:\n '+(await rows()).join('\n '));
 await p.screenshot({path:path.join(T,'usage.png'),clip:{x:0,y:0,width:1024,height:700}});
 console.log(errors.length?'ERRORS '+errors:'NO ERRORS'); await b.close(); })().catch(e=>{console.error('FAIL',e.message.split('\n')[0]); process.exit(1)});
