// Tələbə kabinetinin naviqasiyası; cavab açarları bu modula verilmir.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
export function rememberStudent(code, kind, id) {
  try { localStorage.setItem('mp_continue_' + code, JSON.stringify({kind,id})); } catch (_) { /* özəl rejim */ }
}
export function nextStudentLesson(schedule, now = new Date()) {
  // Qrup saatları Bakı vaxtıdır; cihaz başqa saat qurşağında olsa da nəticə eynidir.
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const start = new Date(today + 'T00:00:00+04:00');
  const slots = Array.isArray(schedule?.slots) ? schedule.slots : [];
  for (let offset=0; offset<14; offset++) {
    const day = new Date(+start + offset*864e5);
    const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(day);
    if (schedule?.since && date < schedule.since) continue;
    const dow = new Date(date+'T12:00:00Z').getUTCDay() || 7;
    for (const slot of slots.filter(s=>+s.d===dow && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.s) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.e)).sort((a,b)=>a.s.localeCompare(b.s))) {
      if (new Date(date+'T'+slot.e+':00+04:00') <= now) continue;
      const weekdays=['','Bazar ertəsi','Çərşənbə axşamı','Çərşənbə','Cümə axşamı','Cümə','Şənbə','Bazar'];
      const months=['yan','fev','mar','apr','may','iyn','iyl','avq','sen','okt','noy','dek'];
      return weekdays[dow]+' · '+Number(date.slice(8))+' '+months[Number(date.slice(5,7))-1]+' · '+slot.s+'–'+slot.e+' (Bakı)';
    }
  }
  return '';
}
export function mountStudentHub(root, {code, home, me, notes, hub, mk, an, initial='home', onComplete, onAsk}) {
  root.classList.add('student-hub');
  const sections = [...root.querySelectorAll(':scope > section')];
  const tasks = sections.find(s=>s.querySelector('h2')?.textContent.startsWith('Yazılacaq'));
  const notebook = sections.find(s=>s.classList.contains('notebook'));
  const materials = sections.find(s=>s.querySelector('h2')?.textContent.includes('Dərs materiallarım'));
  const results = sections.filter(s=>s!==tasks && s!==notebook && s!==materials);
  const pages = {};
  for (const key of ['home','tasks','lessons','results','notebook']) {
    const el = document.createElement('div'); el.className='hub-page stack'; el.dataset.hubPage=key; el.id='hub-'+key;
    pages[key]=el; root.appendChild(el);
  }
  if (tasks) pages.tasks.appendChild(tasks);
  if (notebook) pages.notebook.appendChild(notebook);
  else pages.notebook.innerHTML='<section class="card stack"><h2>Səhv dəftərim</h2><p class="muted">Hazırda təkrar üçün sual yoxdur. Testlərdən sonra müəllimin açdığı təkrarlar burada görünəcək.</p></section>';
  results.forEach(s=>pages.results.appendChild(s));
  const pending=me.tests.filter(t=>!t.result && t.is_open && !t.overdue);
  const started=t=>Boolean(t.started_at || Object.keys(read('mp_draft_'+code+'_'+t.id)||{}).length);
  if (tasks) {
    tasks.querySelector('h2').textContent='Tapşırıqlarım';
    tasks.querySelectorAll('a.portal-row').forEach(row=> {
      const t=pending.find(t=>row.getAttribute('href')===home+'/'+t.id);
      if (t) { row.dataset.taskState=started(t)?'started':'waiting'; row.querySelector('.btn').textContent=started(t)?'Davam et':'Başla'; }
    });
    const filters=document.createElement('div'); filters.className='hub-filters';
    filters.innerHTML=[['all','Hamısı'],['waiting','Gözləyən'],['started','Başladığım'],['done','Tamamladığım']].map(([k,l])=>`<button type="button" class="btn small" data-task-filter="${k}" aria-pressed="${k==='all'}">${l}</button>`).join('');
    tasks.querySelector('h2').after(filters);
    const done=me.tests.filter(t=>t.result);
    tasks.insertAdjacentHTML('beforeend',done.map(t=>`<a class="portal-row" data-task-state="done" href="${home}/${esc(t.id)}${t.review?'/review':''}"><span><strong>${esc(t.title)}</strong><span class="small muted"> · Tamamlanıb</span></span><span>${t.result.score}/${t.result.total}</span></a>`).join('')+'<p class="empty" data-filter-empty hidden>Bu bölmədə tapşırıq yoxdur.</p>');
    filters.onclick=e=> { const b=e.target.closest('[data-task-filter]'); if(!b)return; const f=b.dataset.taskFilter;
      filters.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
      const rows=[...tasks.querySelectorAll('[data-task-state]')]; rows.forEach(r=>r.hidden=f!=='all'&&r.dataset.taskState!==f);
      tasks.querySelector('[data-filter-empty]').hidden=rows.some(r=>!r.hidden);
    };
  }
  const completion=new Map((hub.progress||[]).map(p=>[p.note_id,p.completed]));
  if (materials) {
    materials.querySelector('h2').textContent='Dərslərim';
    const groups=new Map();
    for (const n of notes) {
      const detail=document.getElementById('nt-'+n.id); if(!detail)continue;
      const topic=n.topic?.trim()||'Digər materiallar';
      if(!groups.has(topic)) {const group=document.createElement('section');group.className='hub-topic stack';group.innerHTML=`<h3>${esc(topic)}</h3>`;groups.set(topic,group);materials.appendChild(group);}
      groups.get(topic).appendChild(detail);
      const row=document.createElement('div');row.className='hub-material-actions';
      row.innerHTML=`<button type="button" class="btn" data-complete="${esc(n.id)}" aria-pressed="${!!completion.get(n.id)}">${completion.get(n.id)?'✓ Tamamladım':'Tamamladım'}</button><button type="button" class="btn" data-ask-note="${esc(n.id)}">Müəllimə sual</button><span class="small muted">Bu, sənin öz qeydin olacaq.</span>`;
      detail.appendChild(row);
      const related=(hub.related||[]).filter(r=>r.note_id===n.id).map(r=>pending.find(t=>t.id===r.test_id)).filter(Boolean);
      if(related.length) detail.insertAdjacentHTML('beforeend',`<div class="stack hub-related"><strong>İndi sualları həll et</strong>${related.map(t=>`<a class="btn primary" href="${home}/${esc(t.id)}">${esc(t.title)} · ${t.count} sual</a>`).join('')}</div>`);
      detail.addEventListener('toggle',()=> {if(detail.open)rememberStudent(code,'note',n.id);});
      row.querySelector('[data-ask-note]').onclick=()=>onAsk({note_id:n.id,title:n.title});
      row.querySelector('[data-complete]').onclick=async e=> {const b=e.currentTarget; b.disabled=true;
        try {const value=!completion.get(n.id);await onComplete(n.id,value);completion.set(n.id,value);b.textContent=value?'✓ Tamamladım':'Tamamladım';b.setAttribute('aria-pressed',String(value));updateProgress();}
        catch (_) { /* xəta çağıran tərəfdə göstərilir */ } finally {b.disabled=false;}
      };
    }
    pages.lessons.appendChild(materials);
  } else pages.lessons.innerHTML='<section class="card"><h2>Dərslərim</h2><p class="muted">Müəllimin paylaşdığı video və materiallar burada görünəcək.</p></section>';
  const upcoming=[...pending].sort((a,b)=>(a.due_at?Date.parse(a.due_at):Infinity)-(b.due_at?Date.parse(b.due_at):Infinity))[0];
  const last=read('mp_continue_'+code);
  const resumeTest=(last?.kind==='test'&&pending.find(t=>t.id===last.id))||pending.find(started);
  const resumeNote=last?.kind==='note'&&(notes||[]).find(n=>n.id===last.id);
  const next=nextStudentLesson(hub.schedule);
  pages.home.innerHTML=`<section class="hub-hero"><span class="hub-eyebrow">BU GÜNÜN PLANI</span><h2>${pending.length?'Kiçik addımlarla irəli':'Öyrəndiklərini möhkəmləndir'}</h2><p>${pending.length?`${pending.length} tapşırığın səni gözləyir.`:'Dərslərinə bax, səhvlərini təkrar et.'}</p>${resumeNote?`<button class="btn primary" data-resume-note="${esc(resumeNote.id)}">Davam et · ${esc(resumeNote.title)}</button>`:resumeTest?`<a class="btn primary" href="${home}/${esc(resumeTest.id)}">Davam et · ${esc(resumeTest.title)}</a>`:upcoming?`<a class="btn primary" href="${home}/${esc(upcoming.id)}">Başla · ${esc(upcoming.title)}</a>`:'<button class="btn primary" data-open-page="lessons">Dərslərimə bax</button>'}</section>
  <div class="hub-summary"><section class="card"><span class="small muted">Növbəti dərs</span><h3>${esc(next||'Dərs cədvəli hələ əlavə edilməyib')}</h3></section><section class="card"><span class="small muted">Yaxın tapşırıq</span><h3>${esc(upcoming?.title||'Gözləyən tapşırıq yoxdur')}</h3>${upcoming?.due_at?`<p>${esc(new Date(upcoming.due_at).toLocaleString('az-AZ',{timeZone:'Asia/Baku'}))} · Bakı</p>`:''}</section></div>
  <section class="card stack"><div class="row between"><h2>Dərs irəliləyişim</h2><strong id="hubProgress"></strong></div><progress id="hubProgressBar" max="${Math.max(notes.length,1)}" value="0" aria-label="Tamamlanan materiallar"></progress><button class="btn" data-open-page="lessons">Dərslərimə keç</button></section>
  <section class="card stack"><h2>Təkrar vaxtı</h2><p>${+mk?.due?`${mk.due} sual təkrar üçün hazırdır.`:'Hazırda vaxtı çatan təkrar yoxdur.'} ${+mk?.cleared?`${mk.cleared} səhv düzəldilib.`:''}</p><button class="btn" data-open-page="notebook">Səhv dəftərim</button></section>`;
  pages.home.insertAdjacentHTML('afterbegin', `<a class="hub-solver-link card" href="${home}/ask"><span><strong>Sualını soruş</strong><span>Şəkli yüklə, həllə lövhədə bax</span></span><span class="tag ai">Sol →</span></a>`);
  function updateProgress(){const count=notes.filter(n=>completion.get(n.id)).length;root.querySelector('#hubProgress').textContent=`${count} / ${notes.length}`;root.querySelector('#hubProgressBar').value=count;}
  updateProgress();
  const inbox=document.createElement('section');inbox.className='card stack hub-messages';
  inbox.innerHTML=`<h2>Müəllimlə suallarım</h2>${hub.messages?.length?hub.messages.map(m=>`<details class="hub-message"><summary>${esc(m.body.slice(0,85))}<span class="tag ${m.reply?'ai':''}">${m.reply?'Cavab gəlib':'Cavab gözləyir'}</span></summary><p>${esc(m.body)}</p>${m.reply?`<div class="hub-reply"><strong>Müəllimin cavabı</strong><p>${esc(m.reply)}</p></div>`:''}</details>`).join(''):'<p class="muted">Material və ya test sualının yanındakı “Müəllimə sual” düyməsindən yaza bilərsən.</p>'}`;
  pages.lessons.appendChild(inbox);
  const replies=(hub.messages||[]).filter(m=>m.reply).length;
  if(replies)pages.home.insertAdjacentHTML('beforeend',`<button class="btn" data-open-page="lessons">Müəllimdən ${replies} cavab · Suallarıma bax</button>`);
  const privacy=root.querySelector('a[href="#/privacy"]')?.closest('p'); if(privacy)root.appendChild(privacy);
  const nav=document.createElement('nav');nav.className='hub-nav';nav.setAttribute('aria-label','Tələbə bölmələri');
  nav.innerHTML=[['home','⌂','Ana səhifə'],['tasks','✓','Tapşırıqlar'],['lessons','▤','Dərslərim'],['results','↗','Nəticələr'],['notebook','↺','Səhv dəftəri']].map(([k,i,l])=>`<button type="button" data-hub-tab="${k}" aria-controls="hub-${k}"><span aria-hidden="true">${i}</span>${l}</button>`).join('');root.appendChild(nav);
  function show(key,scroll=true){if(!pages[key])key='home';Object.entries(pages).forEach(([k,p])=>p.hidden=k!==key);nav.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-current',b.dataset.hubTab===key?'page':'false');});history.replaceState(null,'',home+(key==='home'?'':'/'+key));if(scroll)window.scrollTo(0,0);}
  root.addEventListener('click',e=> {const b=e.target.closest('[data-hub-tab],[data-open-page]');if(b)show(b.dataset.hubTab||b.dataset.openPage);const n=e.target.closest('[data-resume-note],[data-nt]');if(n){e.preventDefault();show('lessons',false);const d=document.getElementById('nt-'+(n.dataset.resumeNote||n.dataset.nt));if(d){d.open=true;d.scrollIntoView({block:'start',behavior:'smooth'});}}});
  show(initial,false);
}
