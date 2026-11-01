const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Yerli nömrələr Azərbaycan kodu ilə saxlanılır; xarici nömrədə + ölkə kodu lazımdır.
export function normalizeParentPhone(value){
 const raw=String(value??'').trim();if(!raw)return null;
 if(!/^[+\d\s().-]+$/.test(raw))throw new Error('Nömrəni düzgün yaz: 050 123 45 67 və ya +994 50 123 45 67.');
 let n=raw.replace(/[\s().-]/g,'');
 if(n.startsWith('00'))n='+'+n.slice(2);
 if(/^0\d{9}$/.test(n))n='+994'+n.slice(1);
 else if(/^\d{9}$/.test(n))n='+994'+n;
 else if(/^994\d{9}$/.test(n))n='+'+n;
 if(!/^\+[1-9]\d{7,14}$/.test(n)||n.startsWith('+994')&&!/^\+994\d{9}$/.test(n))throw new Error('Nömrəni ölkə kodu ilə tam yaz: +994 50 123 45 67.');
 return n;
}
export function parentWhatsApp(phone){
 let n;try{n=normalizeParentPhone(phone);}catch{return '';}
 return n?`<a class="btn small parent-whatsapp" href="https://wa.me/${n.slice(1)}" target="_blank" rel="noopener noreferrer" aria-label="Valideynə WhatsApp ilə yaz: ${esc(n)}">WhatsApp · ${esc(n)}</a>`:'';
}
export function mountParentContact(host,sb,student){
 if(!host)return;
 host.innerHTML=`<form class="stack" id="parentPhoneForm"><h2>Valideynlə əlaqə</h2><label class="field">Valideynin nömrəsi<input name="parent_phone" type="tel" inputmode="tel" maxlength="32" placeholder="050 123 45 67" value="${esc(student.parent_phone||'')}"></label><p class="muted small">Sən və ödəniş köməkçin görə bilər. Silmək üçün xananı boşaldıb saxla.</p><div class="row"><button class="btn primary" type="submit">Nömrəni saxla</button><span id="parentPhoneLink">${parentWhatsApp(student.parent_phone)}</span></div><p role="status" id="parentPhoneStatus"></p></form>`;
 host.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const btn=host.querySelector('button'),status=host.querySelector('#parentPhoneStatus'),input=host.querySelector('input');
  let phone;try{phone=normalizeParentPhone(input.value);}catch(err){status.textContent=err.message;return;}
  btn.disabled=true;
  try{
   const {data,error}=await sb.from('students').update({parent_phone:phone}).eq('id',student.id).select('id');
   if(error)throw error;if(!data?.length)throw new Error('Saxlanılmadı. Giriş icazəsini yoxla.');
   student.parent_phone=phone;input.value=phone||'';host.querySelector('#parentPhoneLink').innerHTML=parentWhatsApp(phone);status.textContent=phone?'✓ Nömrə saxlanıldı.':'✓ Nömrə silindi.';
  }catch(err){status.textContent=/parent_phone|schema cache/i.test(err.message||'')?'Saxlanılmadı: bazada 022_parent_phone.sql yeniləməsini işə sal.':err.message||'Saxlanılmadı. Yenidən yoxla.';}finally{btn.disabled=false;}
 };
}

// Siyahıdan çıxmadan nömrə əlavə etmək və düzəltmək.
export function mountInlineParentContact(host,sb,student,onSaved){
 const render=()=>{
  host.innerHTML=`<div class="row contact-summary"><span class="contact-link">${parentWhatsApp(student.parent_phone)||'<span class="tag amber">Nömrə yoxdur</span>'}</span><button class="btn small" type="button" data-edit-phone>${student.parent_phone?'Dəyiş':'Nömrə əlavə et'}</button></div><div data-contact-editor></div><p class="small" role="status" data-contact-status></p>`;
  host.querySelector('[data-edit-phone]').onclick=()=>{
   const editor=host.querySelector('[data-contact-editor]');
   editor.innerHTML=`<form class="stack inline-phone-form"><label class="field">${esc(student.full_name)} · valideyn nömrəsi<input type="tel" name="phone" inputmode="tel" maxlength="32" value="${esc(student.parent_phone||'')}" placeholder="050 123 45 67"></label><span class="small muted">Silmək üçün xananı boş saxla.</span><div class="row"><button type="submit" class="btn primary small">Saxla</button><button type="button" class="btn small" data-cancel-phone>Ləğv et</button></div><p role="alert" class="small"></p></form>`;
   const form=editor.querySelector('form'),input=form.querySelector('input'),msg=form.querySelector('[role=alert]');input.focus();
   form.querySelector('[data-cancel-phone]').onclick=()=>editor.replaceChildren();
   form.onsubmit=async e=>{
    e.preventDefault();let phone;try{phone=normalizeParentPhone(input.value);}catch(err){msg.textContent=err.message;return;}
    const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{const {data,error}=await sb.from('students').update({parent_phone:phone}).eq('id',student.id).select('id');if(error)throw error;if(!data?.length)throw new Error('Saxlanılmadı. Giriş icazəsini yoxla.');
     student.parent_phone=phone;render();host.querySelector('[data-contact-status]').textContent=phone?'✓ Saxlanıldı':'✓ Nömrə silindi';onSaved?.();
    }catch(err){msg.textContent=err.code==='42703'||err.code==='PGRST204'?'Nömrə xanası bazada yoxdur. 022_parent_phone.sql yeniləməsi lazımdır.':err.message||'Saxlanılmadı. Yenidən yoxla.';buttons.forEach(b=>b.disabled=false);}
   };
  };
 };render();
}
