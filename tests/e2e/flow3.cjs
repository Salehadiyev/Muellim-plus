const { chromium } = require(process.env.PW || 'playwright'); 
const path = require('path'); const fs = require('fs');
const FX = path.join(__dirname, '..', 'fixtures'); const T = path.join(__dirname, '..', 'out'); fs.mkdirSync(T, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), '..');
 const errors=[]; const calls=[];
const sv=(inner)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`;
const shape=(k)=>sv(`<rect x="10" y="10" width="100" height="100" fill="none" stroke="#111" stroke-width="3"/><circle cx="${20+k*18}" cy="${20+k*15}" r="12" fill="#1f5fbf"/>`);
const blank=sv('<rect x="10" y="10" width="100" height="100" fill="none" stroke="#fff"/>');
const main=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440"><rect x="10" y="10" width="180" height="180" fill="none" stroke="#111" stroke-width="2"/><text x="300" y="100" font-size="60">?</text><circle cx="100" cy="100" r="30" fill="#e8780c"/></svg>`;
let genN=0;
const mkQ=(sample,variant)=>{ genN++; const id=genN;
  const q={sample,body:`Soru işaretinin yerine hangi şekil gelir? #${id}`,figure:main,options:['A','B','C','D','E'],option_figures:[0,1,2,3,4].map(shape),correct_index:2,solution:'çözüm',topic:'Şekil dizisi',subtype:'dizi',difficulty:'orta',section:'sayisal',exam:'tryos',qtype:'mcq',answer:'C'};
  if(variant==='dup') q.option_figures[3]=shape(0);
  if(variant==='blank') q.figure=blank;
  if(variant==='disagree') q.body+=' DISAGREE';
  return q; };
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1100,height:1400}});
 await ctx.route('**/*', async r=>{ const u=new URL(r.request().url());
  if(u.hostname==='cdn.jsdelivr.net'){ if(u.pathname.includes('pdf.worker')) return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(G+'/pdfjs-dist/build/pdf.worker.min.mjs')});
    if(u.pathname.includes('pdfjs-dist')) return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(G+'/pdfjs-dist/build/pdf.min.mjs')});
    if(u.pathname.includes('katex')) return r.fulfill({contentType:u.pathname.endsWith('css')?'text/css':'text/javascript',body:''});
    return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(FX,'mock-supabase.js'))}); }
  if(u.hostname!=='app.test') return r.abort();
  if(u.pathname==='/api/config') return r.fulfill({json:{supabaseUrl:'x',supabaseAnonKey:'k',models:[{key:'opus',label:'Claude Opus 5.5',ready:true}]}});
  if(u.pathname==='/api/ai'){ const body=JSON.parse(r.request().postData()); calls.push(body);
    if(body.action==='extract'&&body.split) return r.fulfill({json:{questions:[{text:'Soru 64',topic:'Şekil dizisi',section:'sayisal',box:[5,5,40,30]},{text:'Soru 101',topic:'Döndürme',section:'sayisal',box:[50,5,40,30]},{text:'Soru 105',topic:'X',section:'sayisal',box:[5,50,40,30]},{text:'Soru 109',topic:'Y',section:'sayisal',box:null}]}});
    if(body.action==='tryos_analyze'){ await new Promise(z=>setTimeout(z,100)); const t=body.text||'';
      const a={section:'sayisal',topic:body.topic||'Şekil dizisi',family:'Şekil dizisi — soru işaretinin yerine hangi şekil gelir',visual:'5 kadr + ?',skill:'qayda kəşfi',rule:'r',student_task:'?',rule_hidden:true,options_are_figures:true,figure_required:true,difficulty:'orta',preserve:['kadrlı ardıcıllıq'],variable:['elementlər'],uncertain:[],complete:true,conflict:''};
      if(t.includes('101')) a.uncertain=['3-cü kadr bulanıq'];
      if(t.includes('105')) a.complete=false;
      return r.fulfill({json:{text:t||'Kəsik sualı',analysis:a}}); }
    if(body.action==='tryos_from_examples'){ await new Promise(z=>setTimeout(z,120)); const s=body.samples[0]; const out=[];
      if(process.env.SHORT){ window_short=(globalThis.window_short||0)+1; globalThis.window_short=window_short;
        if(window_short<=4) return r.fulfill({json:{questions:[mkQ(0,'')].slice(0, body.perSample>1?1:0),rejected:[{sample:0,reason:'variant şəkilləri natamamdır (4/5)'}]}}); }
      for(let k=0;k<body.perSample;k++){ let v='';
        if(s.text==='Soru 64' && genN===0) v='dup';               // ilk sual eyni variantlarla → yenidən yarat
        if(s.text.includes('Kəsik') && k===0 && !body.feedback) v='disagree';
        if(s.text.includes('Kəsik') && body.feedback) v='blank';    // yenidən cəhd də pis → qaralama
        out.push(mkQ(0,v)); }
      return r.fulfill({json:{questions:out,rejected:[]}}); }
    if(body.action==='verify'){ const q=body.questions[0]; const dis=q.body.includes('DISAGREE');
      return r.fulfill({json:{results:[{ok:!dis,correct:{ok:!dis,index:dis?1:2,issues:dis?['kor həll B variantını tapdı, açar C']:[]},fit:{ok:true,issues:[]},index:dis?1:2,expected:2,issue:''}]}}); }
  }
  const f=path.join(ROOT,u.pathname==='/'?'index.html':u.pathname); if(!fs.existsSync(f)) return r.fulfill({status:404,body:''});
  r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)}); });
 const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('ERR_FAILED'))errors.push(m.text())}); p.on('dialog',d=>d.accept());
 await p.goto('http://app.test/'); await p.evaluate(()=>localStorage.clear()); await p.reload();
 await p.fill('input[name=email]','a@b.az'); await p.fill('input[name=password]','secret1'); await p.click('button[type=submit]');
 await p.waitForSelector('text=Açıq testlər'); await p.click('nav >> text=Suallar'); await p.click('.sub-seg >> text=AI ilə yarat'); await p.waitForSelector('#exPicker');
 await p.setInputFiles('#exPicker input[type=file]', path.join(FX,'book.pdf')); await p.waitForSelector('#exPicker [data-page]',{timeout:20000});
 // 1) bütün səhifə
 await p.click('[data-add-page]'); await p.waitForFunction(()=>document.querySelectorAll('.sample').length===3);
 // 2) tək kəsik
 const bb=await (await p.$('#exPicker canvas')).boundingBox(); await p.mouse.move(bb.x+30,bb.y+60); await p.mouse.down(); await p.mouse.move(bb.x+400,bb.y+300,{steps:4}); await p.mouse.up();
 await p.waitForFunction(()=>document.querySelectorAll('.sample').length===4 && !document.querySelector('.sample.reading'),{timeout:15000});
 const statuses=await p.$$eval('.sample',x=>x.map(e=>e.className.replace('sample ','')));
 console.log('T2 split: samples', statuses.join(','), '| toast about missing box:', (await p.textContent('#toast')).includes('yeri tapılmadı') || 'checked-earlier');
 const an=calls.filter(c=>c.action==='tryos_analyze'); console.log('   analyze calls with image:', an.filter(c=>c.image&&c.image.length>1000).length,'/',an.length, '| topic+section passed:', an.every(c=>'topic' in c && 'section' in c));
 console.log('   run btn (ready+confirmed only):', (await p.textContent('#runEx')).trim());
 if(process.env.SHORT){ await p.click('.sample >> nth=1 >> [data-rm]'); await p.click('.sample >> nth=0 >> [data-rm]'); await p.click('.sample >> nth=0 >> [data-rm]'); }
 await p.click('[data-confirm]').catch(()=>{}); console.log('   after confirming uncertain:', (await p.textContent('#runEx')).trim());
 // 6) 5 sual
 await p.selectOption('#perSample','5'); await p.click('[data-mode=benzer]');
 console.log('   btn with 5:', (await p.textContent('#runEx')).trim());
 await p.click('#runEx'); await p.waitForFunction(()=>!document.querySelector('#runEx').disabled,{timeout:60000});
 const gen=calls.filter(c=>c.action==='tryos_from_examples');
 console.log('T6 generation calls:', gen.length, '| chunk sizes:', gen.filter(c=>!c.feedback).map(c=>c.perSample).join(','), '| all with image:', gen.every(c=>c.samples[0].image && c.samples[0].image.length>1000), '| analysis sent:', gen.every(c=>c.samples[0].analysis && c.samples[0].analysis.family), '| mode:', [...new Set(gen.map(c=>c.mode))].join());
 const heads=await p.$$eval('#exResults .mini-head .tag',x=>x.map(e=>e.textContent)); console.log('   per group:', heads.join(' '), '|', (await p.textContent('#exResults h2')));
 const ver=calls.filter(c=>c.action==='verify'); console.log('T4 verify calls:', ver.length, '| all have render PNG:', ver.every(c=>c.questions[0].render&&c.questions[0].render.startsWith('data:image/png')), '| all have sample image:', ver.every(c=>c.sample&&c.sample.image), '| mode sent:', ver.every(c=>c.mode==='benzer'));
 const retries=gen.filter(c=>c.feedback); console.log('T5/T4 retries:', retries.length, '| feedback samples:', retries.map(c=>c.feedback.slice(0,60)).join(' || '));
 const summary=await p.textContent('#exResults p.small'); console.log('   summary:', summary.replace(/\s+/g,' '));
 const drafts=await p.$$eval('#exResults .mini-q',x=>x.filter(e=>e.textContent.includes('qaralama')).map(e=>e.querySelector('.check').checked)); console.log('   drafts checked by default?:', JSON.stringify(drafts));
 const passedTxt=await p.$$eval('#exResults .mini-q',x=>x.filter(e=>e.textContent.includes('DISAGREE')).map(e=>e.textContent.includes('✓'))); console.log('   disagree marked ✓?:', JSON.stringify(passedTxt));
 await p.click('#exResults [data-open] >> nth=0'); await p.waitForSelector('#qDialog[open]'); console.log('   dialog badge:', (await p.textContent('#qDialog .q .row')).replace(/\s+/g,' ').slice(0,160)); await p.click('#qDialog [data-close]');
 await p.screenshot({path:path.join(T,'flow2.png'),fullPage:true});
 if(process.env.SHORT){ console.log('SHORT heads:', heads.join(' '), '| fill btn:', await p.$$eval('[data-fill]',x=>x.length)); if(await p.$('[data-fill]')){ await p.click('[data-fill]'); await p.waitForTimeout(300); await p.waitForFunction(()=>!document.querySelector('#runEx').disabled,{timeout:30000}); console.log('after fill:', await p.textContent('#exResults h2')); } process.exit(0); }
 // save → db fields
 await p.click('#exResults .mini-q:has-text("qaralama") .check'); await p.click('#saveSel'); await p.waitForTimeout(800); console.log('toast after save:', await p.textContent('#toast'));
 const db=await p.evaluate(()=>JSON.parse(localStorage.getItem('mockdb')).questions.map(q=>[q.ai_status,q.verified,!!q.figure,q.option_figures.length,q.verify_note||'']));
 console.log('draft saved:', JSON.stringify(db.filter(r=>r[0]==='draft')));
 console.log('save rows:', JSON.stringify(db.slice(0,4)), '... total', db.length);
 await p.click('nav >> text=Suallar'); await p.waitForSelector('#list .q'); await p.click('[data-approve] >> nth=0'); await p.waitForTimeout(200);
 console.log('bank approve badge:', await p.isVisible('text=✔ Müəllim təsdiqləyib'));
 await p.selectOption('#fStatus','approved'); console.log('   approved filter count:', await p.$$eval('#list .q',x=>x.length));
 console.log(errors.length?'ERRORS '+errors.join(' | '):'NO ERRORS'); await b.close(); })().catch(e=>{console.error('FAIL',e.message.split('\n')[0]); console.log(errors); process.exit(1)});
