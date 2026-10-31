const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const money=n=>`${Number(n||0).toFixed(2)} ₼`;
export async function paymentAssistantView(root,sb,access){
  root.innerHTML=`<div class="shell"><nav class="nav" aria-label="Əsas menyu"><span class="brand">Math Saleh Hoca</span><a class="item active" href="#/lessons">Dərslər</a><div class="spacer"></div><div class="who"><span>${esc(access.name)}</span><button class="btn" id="assistantLogout">Çıxış</button></div></nav><main class="main"><h1>Dərslər · ${esc(access.name)}</h1><p class="muted">Aylıq ödənişləri qeyd et. Davamiyyət yalnız baxış üçündür.</p><div id="assistantContent"></div></main></div>`;
  root.querySelector('#assistantLogout').onclick=()=>sb.auth.signOut();
  const host=root.querySelector('#assistantContent');
  if(!access.active){host.innerHTML='<p class="notice" role="alert">Giriş icazən bağlanıb. Müəllimlə əlaqə saxla.</p>';return;}
  let month=today().slice(0,7),filter='';
  async function draw(){
    host.innerHTML='<p role="status">Yüklənir…</p>';
    const {data,error}=await sb.rpc('payment_assistant_ledger',{p_month:month+'-01'});
    if(!host.isConnected)return;
    if(error){host.innerHTML=`<p class="notice" role="alert">${esc(error.message||'Giriş icazəsi yoxdur')}</p>`;return;}
    const students=data?.students||[];
    host.innerHTML=`<div class="card stack"><label class="field">Dərslərin ayı<input id="assistantMonth" type="month" value="${esc(month)}" min="2000-01" max="2100-01"></label><label class="field">Tələbəni axtar<input id="assistantSearch" type="search" value="${esc(filter)}" placeholder="Ad və ya qrup"></label><p class="small muted">Ödənişlər əvvəlki aylardan başlayaraq bağlanır. Yalnız həqiqətən qəbul edilmiş məbləği təsdiqlə.</p><p id="assistantNotice" role="status"></p></div><div id="assistantRows"></div>`;
    const rows=()=>{host.querySelector('#assistantRows').innerHTML=students.filter(s=>(s.name+' '+s.class_name).toLocaleLowerCase('az').includes(filter.toLocaleLowerCase('az'))).map(s=>{
      const canPay=Number(s.monthly_fee)>0&&s.next_month?.slice(0,7)<=today().slice(0,7);
      return `<section class="card stack"><div class="row between"><div><h2>${esc(s.name)}</h2><p class="muted">${esc(s.class_name)}</p></div><span>Aylıq: ${money(s.monthly_fee)}${s.pay_day?` · ayın ${esc(s.pay_day)}-i`:''}</span></div><p>${canPay?`${esc(s.next_month.slice(0,7))} üçün qalan: <strong>${money(s.remaining)}</strong>`:Number(s.monthly_fee)>0?'✓ Cari aya qədər ödənilib':'Aylıq məbləği müəllim təyin etməlidir.'}</p>${canPay?`<button class="btn primary" data-assistant-pay="${esc(s.id)}">${esc(s.next_month.slice(0,7))} — ödənilib işarələ</button>`:''}<details><summary>Davamiyyət · ${esc(month)}</summary>${(s.lessons||[]).length?`<ul>${s.lessons.map(l=>`<li>${esc(l.date)} · ${l.status==='came'?'Gəldi':'Gəlmədi'}${l.topic?' · '+esc(l.topic):''}</li>`).join('')}</ul>`:'<p>Bu ay dərs qeydi yoxdur.</p>'}</details></section>`;
    }).join('')||'<p class="empty">Tələbə tapılmadı.</p>';
    host.querySelectorAll('[data-assistant-pay]').forEach(btn=>btn.onclick=async()=>{
      const s=students.find(x=>x.id===btn.dataset.assistantPay);
      if(!confirm(`${s.name}: ${s.next_month.slice(0,7)} üçün ${money(s.remaining)} qəbul edilib?`))return;
      btn.disabled=true;
      const {error}=await sb.rpc('payment_assistant_mark',{p_student:s.id,p_month:s.next_month,p_expected_amount:Number(s.remaining)});
      if(!host.isConnected)return;
      if(error){host.querySelector('#assistantNotice').textContent=error.message;btn.disabled=false;return;}
      await draw();if(host.isConnected&&host.querySelector('#assistantNotice'))host.querySelector('#assistantNotice').textContent='Ödəniş qeydə alındı.';
    });};rows();
    host.querySelector('#assistantSearch').oninput=e=>{filter=e.target.value;rows();};
    host.querySelector('#assistantMonth').onchange=e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){month=e.target.value;draw();}};
  }
  await draw();
}

export async function paymentAssistantSettings(host,sb){
  if(!host)return;
  const {data,error}=await sb.from('payment_assistants').select('user_id,email,display_name,active').order('created_at');
  if(!host.isConnected)return;
  if(error){host.innerHTML='<h2>Qəşəm üçün məhdud giriş</h2><p class="notice">Aktivləşdirmək üçün bazada 021_payment_assistant.sql yeniləməsi lazımdır.</p>';return;}
  const logs=await sb.from('assistant_payment_log').select('actor_name,student_name,billing_month,amount,created_at').order('created_at',{ascending:false}).limit(20);
  if(!host.isConnected)return;
  host.innerHTML=`<h2>Qəşəm üçün məhdud giriş</h2><p class="muted small">Ayrıca hesab yalnız dərsləri görür və ödənişləri işarələyir. Hesabı əvvəl Supabase → Authentication → Users bölməsində yaradın; müəllim kimi təsdiqləməyin.</p><form id="assistantGrant" class="stack"><label class="field">Ad<input name="name" value="Qəşəm" required maxlength="80"></label><label class="field">Hesabın e-poçtu<input name="email" type="email" required autocomplete="off"></label><button class="btn primary">Giriş ver</button></form><p id="assistantSettingNotice" role="status"></p><div>${(data||[]).map((a,i)=>`<div class="row between"><span>${esc(a.display_name)} · ${esc(a.email)} · ${a.active?'Aktiv':'Bağlı'}</span><button type="button" class="btn" data-toggle-assistant="${i}">${a.active?'Girişi bağla':'Aktivləşdir'}</button></div>`).join('')}</div><details><summary>Son ödəniş qeydləri</summary>${logs.error?'<p>Tarixçə yüklənmədi.</p>':(logs.data||[]).map(l=>`<p>${esc(l.actor_name)} · ${esc(l.student_name)} · ${esc(l.billing_month.slice(0,7))} · ${money(l.amount)} · ${esc(new Date(l.created_at).toLocaleString('az-AZ',{timeZone:'Asia/Baku'}))}</p>`).join('')||'<p>Hələ qeyd yoxdur.</p>'}</details>`;
  async function save(button,args,fn='set_payment_assistant'){button.disabled=true;const {error}=await sb.rpc(fn,args);if(!host.isConnected)return;if(error){host.querySelector('#assistantSettingNotice').textContent=error.message;button.disabled=false;}else await paymentAssistantSettings(host,sb);}
  host.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);save(e.target.querySelector('button'),{p_email:f.get('email').trim(),p_name:f.get('name').trim(),p_active:true});};
  host.querySelectorAll('[data-toggle-assistant]').forEach(b=>b.onclick=()=>{const a=data[Number(b.dataset.toggleAssistant)];save(b,{p_user:a.user_id,p_active:!a.active},'toggle_payment_assistant');});
}
