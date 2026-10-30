import { mountWhiteboard } from './solver-board.js';
// Şəkildən Sol həlli: riyazi addımlar lövhədə ardıcıl açılır.
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountStudentSolver(root,{code,home,allowance,refreshAllowance}) {
  let remaining=allowance?.remaining??0;
  let image='', result=null, cleanupBoard=null, controller=null, disposed=false, imageVersion=0;
  const $=s=>root.querySelector(s);
  root.innerHTML=`<div class="row between"><a class="btn small" href="${esc(home)}">‹ Ana səhifə</a></div>
    <header class="solver-heading"><span class="solver-eyebrow">MATH SALEH HOCA</span><h1>Sualını soruş</h1><p class="muted">Həll edə bilmədiyin sualın şəklini yüklə. Həll lövhədə addım-addım açılsın.</p></header>
    <p id="solverQuota" class="notice" role="status"></p><section class="card stack solver-upload"><label class="field">Sualın şəkli<input id="solverFile" type="file" accept="image/*"></label>
    <p class="small muted">Bir şəkildə bir sual olsun; şərt və şəkil tam görünsün.</p>
    <img id="solverPreview" alt="Yüklədiyin sual" hidden>
    <button id="solverStart" class="btn primary block" disabled>Həll et</button>
    <p id="solverStatus" role="status" aria-live="polite"></p><p id="solverError" class="notice" role="alert" hidden></p></section>
    <section id="solverResult" class="stack" hidden>
      <div class="solver-toolbar"><button type="button" class="btn" id="solverPause">Dayandır</button><button type="button" class="btn" id="solverNext">Növbəti addım</button><button type="button" class="btn" id="solverReplay">Yenidən göstər</button><button type="button" class="btn" id="solverAll">Tam həlli göstər</button></div>
      <div class="solver-progress"><label for="solverSeek">Həllin gedişi</label><input id="solverSeek" type="range" min="0" max="100" value="0" step="100" aria-label="Həllin vaxtı"><span id="solverTime"></span></div>
      <div id="solverBoard" class="solver-board"><div class="solver-board-head"><strong>Həll lövhəsi</strong><span id="solverCounter" role="status" aria-live="polite"></span></div><div id="solverQuestion" class="solver-question"></div><div id="solverSteps"></div><div id="solverAnswer" class="solver-answer" hidden></div></div>
      <p class="small muted">Anlaşılmayan addımı müəlliminlə dəqiqləşdir.</p>
    </section>`;
  function quota(){if(disposed)return;$('#solverQuota').textContent=remaining>0?`Bu gün daha ${remaining} sual göndərə bilərsən. Hər göndərilən sual gündəlik saya daxildir.`:'Bugünkü 3 sualını göndərmisən. Bakı vaxtı ilə 00:00-dan sonra yenidən sual göndərə bilərsən.';$('#solverStart').disabled=!image||remaining<=0;}
  quota();
  function error(message){$('#solverError').textContent=message;$('#solverError').hidden=false;}
  function stop(){cleanupBoard?.();cleanupBoard=null;}
  function show(){stop();$('#solverResult').hidden=false;cleanupBoard=mountWhiteboard(root,result,image);}
  // Son həll bu tabda saxlanır; başqa tələbənin linkinə ötürülmür.
  const cacheKey='math-saleh-last-solution-v1';
  function save(){try{sessionStorage.setItem(cacheKey,JSON.stringify({code,image,result,created:Date.now()}));}catch(_){try{sessionStorage.removeItem(cacheKey);}catch(_){}}}
  try {
    const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');
    if(cached?.code===code&&Date.now()-cached.created<86400000&&validResult(cached.result)&&/^data:image\/(jpeg|png|webp);base64,/.test(cached.image)&&cached.image.length<2800000){image=cached.image;result=cached.result;$('#solverPreview').src=image;$('#solverPreview').hidden=false;show();quota();}
    else sessionStorage.removeItem(cacheKey);
  }catch(_){}
  $('#solverFile').onchange=async e=>{
    const version=++imageVersion;const file=e.target.files?.[0];image='';result=null;stop();controller?.abort();
    $('#solverPreview').hidden=true;$('#solverResult').hidden=true;$('#solverStart').disabled=true;$('#solverError').hidden=true;$('#solverStatus').textContent='';
    if(!file)return;
    if(!file.type.startsWith('image/')||file.size>15*1024*1024){error('15 MB-dan kiçik şəkil seçin.');return;}
    const url=URL.createObjectURL(file);
    try{
      $('#solverStatus').textContent='Şəkil hazırlanır…';
      const img=new Image();img.src=url;await img.decode();
      if(disposed||version!==imageVersion)return;
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>50000000)throw new Error('Şəkil çox böyükdür. Sualı ayrıca kəsib yükləyin.');
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      image=c.toDataURL('image/jpeg',0.9);
      if(image.length>2800000)image=c.toDataURL('image/jpeg',0.7);
      if(image.length>2800000)throw new Error('Şəkil böyükdür. Sualın olduğu hissəni kəsib yükləyin.');
      $('#solverPreview').src=image;$('#solverPreview').hidden=false;quota();$('#solverStatus').textContent='Şəkil hazırdır.';
    }catch(err){if(!disposed&&version===imageVersion){error(err.message||'Şəkil açılmadı. JPG və ya ekran görüntüsü yükləyin.');$('#solverStatus').textContent='';}}
    finally{URL.revokeObjectURL(url);}
  };
  $('#solverStart').onclick=async()=>{
    if(!image||controller||remaining<=0)return;
    stop();result=null;$('#solverError').hidden=true;$('#solverResult').hidden=true;$('#solverStart').disabled=true;$('#solverFile').disabled=true;$('#solverStatus').textContent='Sualın həlli hazırlanır…';
    const req=new AbortController();controller=req;const timeout=setTimeout(()=>req.abort(),185000);
    try{
      const response=await fetch('/api/student-solve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,image}),signal:req.signal});
      const data=await response.json().catch(()=>({}));if(disposed)return;
      if(!response.ok)throw new Error(data.error||'Həll alınmadı. Yenidən yoxlayın.');
      if(!data.readable){error(data.notice||'Sual aydın görünmür. Daha aydın şəkil yükləyin.');return;}
      if(!validResult(data))throw new Error('Həll tam gəlmədi. Yenidən yoxlayın.');
      result=data;save();show();$('#solverBoard').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){if(!disposed)error(err.name==='AbortError'?'Həll üçün vaxt bitdi. Yenidən yoxlayın.':err.message);}
    finally{clearTimeout(timeout);if(controller===req)controller=null;if(!disposed){$('#solverFile').disabled=false;$('#solverStatus').textContent=result?'Həll hazırdır.':'';try { const value=await refreshAllowance();if(!disposed)remaining=value.remaining; } catch (_) { if(!disposed)error('Qalan limiti yoxlamaq olmadı. Səhifəni yenilə.');remaining=0; } quota();}}
  };
  return ()=>{disposed=true;stop();controller?.abort();};
}

function validResult(data){return data&&typeof data.question==='string'&&data.question.length<=4000&&typeof data.answer==='string'&&data.answer.length<=2000&&Array.isArray(data.steps)&&data.steps.length>0&&data.steps.length<=12&&data.steps.every(s=>typeof s.math==='string'&&s.math.length<=2000&&typeof s.explanation==='string'&&s.explanation.length<=1200&&(!s.highlights||Array.isArray(s.highlights)));}
