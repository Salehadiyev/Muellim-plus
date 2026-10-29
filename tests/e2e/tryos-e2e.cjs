const { chromium } = require(process.env.PW || 'playwright'); 
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
const errors=[]; const calls=[];
const venn='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect x="5" y="5" width="290" height="190" fill="none" stroke="#111"/><circle cx="115" cy="100" r="70" fill="none" stroke="#1f5fbf" stroke-width="2"/><circle cx="185" cy="100" r="70" fill="none" stroke="#e8780c" stroke-width="2"/><text x="60" y="40" font-family="Arial" font-size="15">A</text><text x="230" y="40" font-family="Arial" font-size="15">B</text><text x="90" y="105" font-size="15">12</text><text x="145" y="105" font-size="15">x</text><text x="200" y="105" font-size="15">9</text></svg>';
const opt=(k)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><polygon points="30,5 55,55 5,55" transform="rotate(${k*90} 30 30)" fill="none" stroke="#111" stroke-width="2"/></svg>`;
let n=0;
const mkQ=(it,i)=>{ n++; const fig = it.visual!=='yok';
  return { body:`Soru ${n}: $\\sqrt{12}+\\sqrt{27}$ ifadesinin değeri kaçtır? ${'Uzun açıklama metni. '.repeat(n%4===0?8:1)}`, figure: fig?venn:'', options: it.visual==='şekil'?['A','B','C','D','E']:['$5\\sqrt{3}$','$4\\sqrt{3}$','$6\\sqrt{3}$','$3\\sqrt{3}$','$\\sqrt{39}$'],
  option_figures: it.visual==='şekil'?[0,1,2,3,4].map(opt):[], answer: it.visual==='şekil'?'B':'$5\\sqrt{3}$', solution:'$\\sqrt{12}=2\\sqrt3$, $\\sqrt{27}=3\\sqrt3$, toplam $5\\sqrt3$.', topic:it.topic, subtype:it.subtype, difficulty:it.difficulty, section:'matematik', exam:'tryos', qtype:'mcq', grade:null }; };
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1024,height:1366}});
 await ctx.route('**/*', async r=>{ const u=new URL(r.request().url());
  if(u.hostname==='cdn.jsdelivr.net'){ if(u.pathname.includes('html2canvas')||u.pathname.includes('jspdf')) return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(FX,'stubs.js'))});
    if(u.pathname.includes('auto-render')) return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(FX,'fakekatex.js'))});
    if(u.pathname.includes('katex')) return r.fulfill({contentType:u.pathname.endsWith('css')?'text/css':'text/javascript',body:''});
    return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(FX,'mock-supabase.js'))}); }
  if(u.hostname!=='app.test') return r.abort();
  if(u.pathname==='/api/config') return r.fulfill({json:{supabaseUrl:'x',supabaseAnonKey:'k'}});
  if(u.pathname==='/api/ai'){ const body=JSON.parse(r.request().postData()); calls.push(body);
    if(body.action==='tryos_plan') return r.fulfill({json:{plan:Array.from({length:body.count},(_,i)=>({subtype:'Tip '+(i+1),idea:'i',topic:'Köklü sayılar',section:'matematik',difficulty:['asan','orta','çətin'][i%3],visual:i%5===1?'venn':i%5===3?'şekil':'yok'})),notes:''}});
    if(body.action==='tryos_generate'){ await new Promise(z=>setTimeout(z,150)); return r.fulfill({json:{questions:body.items.map(mkQ)}}); }
    if(body.action==='verify') return r.fulfill({json:{results:body.questions.map((q,i)=>({ok:i!==1,index:i!==1?q.options.indexOf(q.answer):3,issue:i===1?'iki doğru cevap olabilir':''}))}});
  }
  const f=path.join(ROOT,u.pathname==='/'?'index.html':u.pathname); if(!fs.existsSync(f)) return r.fulfill({status:404,body:''});
  r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)}); });
 const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('ERR_FAILED'))errors.push(m.text())}); p.on('dialog',d=>d.accept());
 await p.goto('http://app.test/'); await p.evaluate(()=>localStorage.clear()); await p.reload();
 await p.fill('input[name=email]','a@b.az'); await p.fill('input[name=password]','secret1'); await p.click('button[type=submit]');
 await p.waitForSelector('text=Açıq testlər'); await p.click('nav >> text=Suallar'); await p.click('.sub-seg >> text=AI ilə yarat'); await p.click('[data-tab=topic]');
 await p.selectOption('#tyTopic','Köklü sayılar'); await p.selectOption('select[name=tyCount]','10');
 await p.click('#gen button[type=submit]'); await p.waitForFunction(()=>!document.querySelector('#gen button[type=submit]').disabled,{timeout:30000});
 console.log('calls:', calls.map(c=>c.action).join(','));
 const plan=calls.find(c=>c.action==='tryos_plan'); console.log('plan payload:', plan.section, plan.topic, plan.difficulty, plan.count, plan.mode);
 console.log('questions shown:', await p.$$eval('#results .mini-q',x=>x.length), '| figure tags:', await p.$$eval('#results .mini-meta',x=>x.filter(e=>e.textContent.includes('şəkil')).length), '| -:', 0, '| warn badges:', await p.$$eval('#results .tag.red',x=>x.length), '| ok badges:', await p.$$eval('#results .tag.ai',x=>x.filter(e=>e.textContent.includes('✓')).length));
 const gens=calls.filter(c=>c.action==='tryos_generate'); console.log('batches:', gens.map(g=>g.items.length).join('+'), '| avoid sizes:', gens.map(g=>g.avoid.length).join(','));
 await p.screenshot({path:path.join(T,'tryos-results.png'),fullPage:true});
 await p.click('#saveSel'); await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('banka'));
 await p.click('nav >> text=Suallar'); await p.selectOption('#fExam','tryos'); await p.click('#selAll');
 console.log('pdf btn:', await p.textContent('#makePdf'));
 await p.click('#makePdf'); await p.waitForSelector('.sheet'); await p.waitForTimeout(1500);
 console.log('sheets (4/page):', await p.$$eval('.sheet',x=>x.length), '| key title:', await p.textContent('.sheet-key h2'), '| overflow boxes:', await p.$$eval('.pq.overflow',x=>x.length));
 await p.screenshot({path:path.join(T,'print-preview.png'),fullPage:false});
 await p.emulateMedia({media:'print'}); await p.pdf({path:path.join(T,'out4.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true}); await p.emulateMedia({media:'screen'});
 await p.click('#pDownload'); await p.waitForFunction(()=>window.__pdf); console.log('download:', JSON.stringify(await p.evaluate(()=>window.__pdf)), 'captures:', await p.evaluate(()=>window.__cap));
 await p.selectOption('#pPer','6'); await p.waitForTimeout(1500); console.log('sheets (6/page):', await p.$$eval('.sheet',x=>x.length));
 await p.click('[data-pm=solutions]'); await p.waitForTimeout(300); await p.evaluate(()=>{window.__pdf=null}); await p.click('#pDownload'); await p.waitForFunction(()=>window.__pdf); console.log('solutions download:', JSON.stringify(await p.evaluate(()=>window.__pdf))); console.log('solutions items:', await p.$$eval('.sol-item',x=>x.length));
 await p.click('.print-toolbar a'); await p.waitForSelector('#list .q'); await p.click('#selAll');
 // student page shows figures
 await p.click('#makeTest'); await p.waitForSelector('#newTest'); await p.fill('#newTest input[name=title]','YÖS'); await p.click('#newTest button[type=submit]'); await p.waitForSelector('#copy');
 const id=p.url().split('/test/')[1]; const sp=await ctx.newPage(); sp.on('pageerror',e=>errors.push(e.message));
 await sp.goto('http://app.test/#/t/'+id); await sp.waitForSelector('#st'); console.log('student figs:', await sp.$$eval('.q-fig svg',x=>x.length), 'opt figs:', await sp.$$eval('.opt-fig svg',x=>x.length));
 console.log(errors.length?'ERRORS '+errors.join(' | '):'NO ERRORS'); await b.close(); })().catch(e=>{console.error('FAIL',e.message.split('\n')[0]); console.log(errors); process.exit(1)});
