// Şəkildən Sol həlli: riyazi addımlar lövhədə ardıcıl açılır.
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountStudentSolver(root,{code,home,allowance,refreshAllowance}) {
  let remaining=allowance?.remaining??0;
  let image='', result=null, count=0, playing=false, timer=null, controller=null, disposed=false, imageVersion=0;
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
      <div id="solverBoard" class="solver-board"><div class="solver-board-head"><strong>Həll lövhəsi</strong><span id="solverCounter" role="status" aria-live="polite"></span></div><div id="solverQuestion" class="solver-question"></div><div id="solverSteps"></div><div id="solverAnswer" class="solver-answer" hidden></div></div>
      <p class="small muted">Anlaşılmayan addımı müəlliminlə dəqiqləşdir.</p>
    </section>`;
  function quota(){if(disposed)return;$('#solverQuota').textContent=remaining>0?`Bu gün daha ${remaining} sual göndərə bilərsən. Hər göndərilən sual gündəlik saya daxildir.`:'Bugünkü 3 sualını göndərmisən. Bakı vaxtı ilə 00:00-dan sonra yenidən sual göndərə bilərsən.';$('#solverStart').disabled=!image||remaining<=0;}
  quota();
  function error(message){$('#solverError').textContent=message;$('#solverError').hidden=false;}
  function stop(){playing=false;clearTimeout(timer);timer=null;update();}
  function update(){
    if(disposed)return;
    const total=result?.steps?.length||0,finished=count>=total;
    $('#solverCounter').textContent=total?`${count} / ${total} addım`:'';
    $('#solverPause').textContent=playing?'Dayandır':'Davam et';
    $('#solverPause').disabled=finished;
    $('#solverNext').disabled=finished;
  }
  function next(){
    if(disposed||!result||count>=result.steps.length)return;
    const step=result.steps[count++], el=document.createElement('article');el.className='solver-step';
    const math=step.math.trim().replace(/^\$+|\$+$/g,'');
    el.innerHTML=`<div class="solver-step-number">${count}</div><div class="solver-step-content">${math?`<div class="solver-math">$$${esc(math)}$$</div>`:''}<p>${esc(step.explanation)}</p></div>`;
    $('#solverSteps').appendChild(el);
    if(count===result.steps.length){$('#solverAnswer').innerHTML=`<span>SON CAVAB</span><div>${esc(result.answer)}</div>`;$('#solverAnswer').hidden=false;playing=false;}
    update();
  }
  function schedule(){clearTimeout(timer);if(playing&&!disposed)timer=setTimeout(()=>{next();if(playing)schedule();},3500);}
  function replay(){clearTimeout(timer);count=0;$('#solverSteps').replaceChildren();$('#solverAnswer').hidden=true;playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;next();schedule();}
  $('#solverPause').onclick=()=>{if(playing)stop();else{playing=true;update();schedule();}};
  $('#solverNext').onclick=()=>{stop();next();};
  $('#solverAll').onclick=()=>{stop();while(result&&count<result.steps.length)next();};
  $('#solverReplay').onclick=replay;
  const visibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',visibility);
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
      if(!Array.isArray(data.steps)||!data.steps.length||typeof data.question!=='string'||typeof data.answer!=='string'||data.steps.some(s=>typeof s.math!=='string'||typeof s.explanation!=='string'))throw new Error('Həll tam gəlmədi. Yenidən yoxlayın.');
      result=data;$('#solverQuestion').textContent=data.question;$('#solverResult').hidden=false;replay();$('#solverBoard').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){if(!disposed)error(err.name==='AbortError'?'Həll üçün vaxt bitdi. Yenidən yoxlayın.':err.message);}
    finally{clearTimeout(timeout);if(controller===req)controller=null;if(!disposed){$('#solverFile').disabled=false;$('#solverStatus').textContent=result?'Həll hazırdır.':'';try { const value=await refreshAllowance();if(!disposed)remaining=value.remaining; } catch (_) { if(!disposed)error('Qalan limiti yoxlamaq olmadı. Səhifəni yenilə.');remaining=0; } quota();}}
  };
  return ()=>{disposed=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};
}
