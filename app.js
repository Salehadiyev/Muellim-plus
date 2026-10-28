// Müəllim+ · əsas tətbiq (heç bir quraşdırma tələb etmir)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $app = document.getElementById('app');
let sb = null;
let session = null;
let pendingTestIds = []; // sual bankından testə keçəndə seçilən suallar

// ================= Köməkçilər =================

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 3200);
}

function fail(err) {
  console.error(err);
  toast(err?.message || 'Xəta baş verdi', true);
}

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner sm" aria-hidden="true"></span> Gözləyin…';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}

async function callAI(action, payload) {
  const r = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (session?.access_token || '') },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'AI xətası');
  return data;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Link kopyalandı'); }
  catch (_) { window.prompt('Linki kopyalayın:', text); }
}

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const DIFF = ['asan', 'orta', 'çətin'];
const GRADE_SUFFIX = { 1: 'ci', 2: 'ci', 3: 'cü', 4: 'cü', 5: 'ci', 6: 'cı', 7: 'ci', 8: 'ci', 9: 'cu', 10: 'cu', 11: 'ci', 12: 'ci' };
const gradeLabel = (n) => `${n}-${GRADE_SUFFIX[n] || 'ci'} sinif`;
const SOURCE_LABEL = { ai: 'AI', book: 'Kitabdan → orijinal', manual: 'Əl ilə' };

const icons = {
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',
  cut: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>',
  test: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .7 3.2 2.5 3.6 5.2"/></svg>'
};

function questionHtml(q, { selectable = false, checked = false, showAnswer = true, actions = '' } = {}) {
  const opts = q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length
    ? `<ul class="opts">${q.options.map((o, i) => `<li class="${showAnswer && o === q.answer ? 'correct' : ''}">${'ABCDEF'[i]}) ${esc(o)}</li>`).join('')}</ul>`
    : (showAnswer ? `<div class="small"><strong>Cavab:</strong> ${esc(q.answer)}</div>` : '');
  const meta = [
    q.source ? `<span class="tag ${q.source === 'ai' ? 'ai' : q.source === 'book' ? 'book' : ''}">${esc(SOURCE_LABEL[q.source] || q.source)}</span>` : '',
    q.topic ? `<span class="tag">${esc(q.topic)}</span>` : '',
    q.grade ? `<span class="tag">${esc(gradeLabel(q.grade))}</span>` : '',
    q.difficulty ? `<span class="tag amber">${esc(q.difficulty)}</span>` : '',
    q.qtype === 'open' ? '<span class="tag">açıq sual</span>' : ''
  ].join(' ');
  return `<div class="q">
    ${selectable ? `<input type="checkbox" class="check" data-id="${esc(q.id ?? '')}" ${checked ? 'checked' : ''} aria-label="Sualı seç">` : ''}
    <div class="q-body">
      <div class="row">${meta}</div>
      <div class="q-text">${esc(q.body)}</div>
      ${opts}
      ${showAnswer && q.solution ? `<details class="sol"><summary>Həlli göstər</summary><div>${esc(q.solution)}</div></details>` : ''}
      ${actions ? `<div class="row">${actions}</div>` : ''}
    </div>
  </div>`;
}

// ================= Başlanğıc və marşrutlar =================

async function boot() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('config');
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (_) {
    $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack">
      <h1>Quraşdırma bitməyib</h1>
      <p class="muted">Vercel-də SUPABASE_URL və SUPABASE_ANON_KEY dəyişənlərini əlavə edin, sonra saytı yenidən yerləşdirin (Redeploy).</p>
    </div></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((event, s) => {
    const wasIn = !!session;
    session = s;
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !wasIn)) route();
  });
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [page, id] = parts;
  if (page === 't' && id) return studentTest(id);
  if (!session) return loginView();

  const views = {
    '': dashboard, classes: classesView, class: classView, bank: bankView,
    ai: aiView, book: bookView, tests: testsView, test: testResultsView
  };
  const view = views[page] || dashboard;
  const navKey = page === 'class' ? 'classes' : page === 'test' ? 'tests' : (views[page] ? page : '');
  shell(navKey);
  window.scrollTo(0, 0);
  view(id).catch(fail);
}

function shell(active) {
  const items = [
    ['', 'Panel'], ['classes', 'Siniflər'], ['bank', 'Sual bankı'], ['ai', 'AI ilə sual'],
    ['book', 'Kitabdan sual'], ['tests', 'Testlər']
  ];
  const email = session?.user?.email || '';
  $app.innerHTML = `<div class="shell">
    <nav class="nav" aria-label="Əsas menyu">
      <a class="brand" href="#/"><span class="brand-mark">M+</span><span class="brand-name">Müəllim+</span></a>
      ${items.map(([k, label]) => `<a class="item ${k === active ? 'active' : ''}" href="#/${k}">${label}</a>`).join('')}
      <div class="spacer"></div>
      <div class="who"><span>${esc(email)}</span><button type="button" class="btn small" id="logout">Çıxış</button></div>
    </nav>
    <main class="main" id="view"><div class="spinner" aria-label="Yüklənir"></div></main>
  </div>`;
  $('#logout').onclick = async () => { await sb.auth.signOut(); go('#/'); };
}

const view = () => document.getElementById('view');

// ================= Giriş =================

function loginView() {
  let mode = 'login';
  const render = () => {
    $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="auth">
      <div class="row"><span class="brand-mark" style="color:#fff">M+</span><h1>Müəllim+</h1></div>
      <p class="muted">${mode === 'login' ? 'Hesabınıza daxil olun.' : 'Müəllim hesabı yaradın.'}</p>
      ${mode === 'signup' ? '<label class="field">Adınız<input type="text" name="name" required autocomplete="name"></label>' : ''}
      <label class="field">E-poçt<input type="email" name="email" required autocomplete="email"></label>
      <label class="field">Şifrə<span class="hint">Ən azı 6 simvol</span><input type="password" name="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
      <button class="btn primary block" type="submit">${mode === 'login' ? 'Daxil ol' : 'Qeydiyyatdan keç'}</button>
      <button class="btn block" type="button" id="switch">${mode === 'login' ? 'Hesabım yoxdur, qeydiyyat' : 'Hesabım var, daxil ol'}</button>
    </form></div>`;
    $('#switch').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; render(); };
    $('#auth').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = $('button[type=submit]', e.target);
      busy(btn, async () => {
        const email = f.get('email').trim();
        const password = f.get('password');
        if (mode === 'login') {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-poçt və ya şifrə yanlışdır' : error.message);
        } else {
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: f.get('name') } } });
          if (error) throw error;
          if (!data.session) toast('Təsdiq məktubu göndərildi. E-poçtunuzu yoxlayın.');
        }
      }).catch(fail);
    };
  };
  render();
}

// ================= Panel =================

async function dashboard() {
  const name = session.user.user_metadata?.full_name || '';
  const [c, s, q, sub, recent] = await Promise.all([
    sb.from('classes').select('id', { count: 'exact', head: true }),
    sb.from('students').select('id', { count: 'exact', head: true }),
    sb.from('questions').select('id', { count: 'exact', head: true }),
    sb.from('submissions').select('id', { count: 'exact', head: true }),
    sb.from('submissions').select('student_name, score, total, created_at, tests(title)').order('created_at', { ascending: false }).limit(6)
  ]);
  const stat = (label, v) => `<div class="card stat"><div class="label">${label}</div><div class="value">${v ?? 0}</div></div>`;
  view().innerHTML = `
    <div class="page-head"><div>
      <div class="crumb">${new Date().toLocaleDateString('az-AZ', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>Salam${name ? ', ' + esc(name) : ''}</h1>
    </div><a class="btn primary" href="#/tests">+ Yeni test</a></div>
    <section class="grid" aria-label="Göstəricilər">
      ${stat('Siniflər', c.count)}${stat('Şagirdlər', s.count)}${stat('Sual bankı', q.count)}${stat('Test nəticələri', sub.count)}
    </section>
    <section class="stack"><h2>Sürətli başla</h2><div class="grid">
      <a class="card action-card" href="#/ai"><span class="icon-box">${icons.spark}</span><h3>AI ilə sual yarat</h3><p class="muted small">Mövzu, sinif və çətinliyi seç, suallar həlli ilə hazır olsun.</p></a>
      <a class="card action-card accent" href="#/book"><span class="icon-box" style="background:var(--accent)">${icons.cut.replace('aria-hidden', 'style="stroke:#fff" aria-hidden')}</span><h3>Kitabdan sual kəs</h3><p class="muted small">Səhifənin şəklini çək, sualı seç, AI onu orijinal suala çevirsin.</p></a>
      <a class="card action-card" href="#/tests"><span class="icon-box">${icons.test}</span><h3>Test yığ</h3><p class="muted small">Sual bankından seç, linki şagirdlərə göndər.</p></a>
      <a class="card action-card" href="#/classes"><span class="icon-box">${icons.users}</span><h3>Siniflər</h3><p class="muted small">Sinif yarat, şagird siyahısını əlavə et.</p></a>
    </div></section>
    <section class="card stack"><h2>Son nəticələr</h2>
      ${recent.data?.length ? `<div class="table-wrap"><table><thead><tr><th>Şagird</th><th>Test</th><th>Bal</th><th>Vaxt</th></tr></thead><tbody>
        ${recent.data.map((r) => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.tests?.title)}</td><td><strong>${r.score}/${r.total}</strong></td><td class="muted">${fmtDate(r.created_at)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Hələ nəticə yoxdur. Test yaradıb linki şagirdlərə göndərin.</div>'}
    </section>`;
}

// ================= Siniflər =================

async function classesView() {
  const { data, error } = await sb.from('classes').select('id, name, grade, created_at, students(count)').order('created_at');
  if (error) throw error;
  view().innerHTML = `
    <div class="page-head"><div><h1>Siniflər</h1><p class="muted">Hər sinfə şagird siyahısı əlavə edin, testlərdə adlar seçim kimi çıxacaq.</p></div></div>
    <form class="card stack" id="newClass"><h2>Yeni sinif</h2>
      <div class="form-grid">
        <label class="field">Sinfin adı<input type="text" name="name" placeholder="məs. 7A" required maxlength="60"></label>
        <label class="field">Sinif<select name="grade">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === 7 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      </div>
      <div><button class="btn primary" type="submit">Sinif yarat</button></div>
    </form>
    <section class="grid">
      ${data.length ? data.map((c) => `<a class="card action-card" href="#/class/${c.id}">
        <h3>${esc(c.name)}</h3><p class="muted small">${c.grade ? gradeLabel(c.grade) + ' · ' : ''}${c.students?.[0]?.count ?? 0} şagird</p></a>`).join('')
      : '<div class="empty">Hələ sinif yoxdur.</div>'}
    </section>`;
  $('#newClass').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy($('button', e.target), async () => {
      const { data: row, error: err } = await sb.from('classes').insert({ name: f.get('name').trim(), grade: +f.get('grade') }).select().single();
      if (err) throw err;
      go('#/class/' + row.id);
    }).catch(fail);
  };
}

async function classView(id) {
  const [{ data: cls, error }, { data: students }, { data: tests }] = await Promise.all([
    sb.from('classes').select('*').eq('id', id).single(),
    sb.from('students').select('*').eq('class_id', id).order('full_name'),
    sb.from('tests').select('id, title, is_open, created_at').eq('class_id', id).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/classes">Siniflər</a> /</div><h1>${esc(cls.name)}</h1></div>
      <button class="btn danger" id="delClass">Sinfi sil</button></div>
    <div class="split">
      <section class="card stack"><h2>Şagirdlər (${students.length})</h2>
        ${students.length ? `<div class="table-wrap"><table><tbody>${students.map((s) => `<tr><td>${esc(s.full_name)}</td><td style="text-align:right"><button class="btn small danger" data-del="${s.id}" aria-label="${esc(s.full_name)} sil">Sil</button></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Siyahı boşdur.</div>'}
        <form id="addStudents" class="stack">
          <label class="field">Şagird əlavə et<span class="hint">Hər sətirdə bir ad. Siyahını Excel və ya qeydlərdən yapışdıra bilərsiniz.</span>
            <textarea name="names" rows="5" placeholder="Əli Həsənov&#10;Nərgiz Quliyeva"></textarea></label>
          <div><button class="btn primary" type="submit">Əlavə et</button></div>
        </form>
      </section>
      <section class="card stack"><div class="row between"><h2>Bu sinfin testləri</h2><a class="btn small" href="#/tests">+ Test</a></div>
        ${tests?.length ? tests.map((t) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid #EEF1F5"><a href="#/test/${t.id}">${esc(t.title)}</a><span class="tag ${t.is_open ? 'ai' : ''}">${t.is_open ? 'açıq' : 'bağlı'}</span></div>`).join('')
          : '<div class="empty">Hələ test yoxdur.</div>'}
      </section>
    </div>`;
  $('#addStudents').onsubmit = (e) => {
    e.preventDefault();
    const names = new FormData(e.target).get('names').split('\n').map((n) => n.trim()).filter(Boolean).slice(0, 200);
    if (!names.length) return toast('Ən azı bir ad yazın', true);
    busy($('button', e.target), async () => {
      const { error: err } = await sb.from('students').insert(names.map((n) => ({ class_id: id, full_name: n.slice(0, 80) })));
      if (err) throw err;
      toast(names.length + ' şagird əlavə olundu');
      route();
    }).catch(fail);
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    const { error: err } = await sb.from('students').delete().eq('id', b.dataset.del);
    if (err) return fail(err);
    route();
  });
  $('#delClass').onclick = async () => {
    if (!confirm('Sinif və şagird siyahısı silinsin? Testlər qalacaq.')) return;
    const { error: err } = await sb.from('classes').delete().eq('id', id);
    if (err) return fail(err);
    go('#/classes');
  };
}

// ================= Sual bankı =================

async function bankView() {
  const { data, error } = await sb.from('questions').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  let filter = { text: '', source: '', difficulty: '' };
  const selected = new Set();

  view().innerHTML = `
    <div class="page-head"><div><h1>Sual bankı</h1><p class="muted">${data.length} sual. Seçib test yarada bilərsiniz.</p></div>
      <div class="row"><button class="btn" id="toggleManual">+ Əl ilə sual</button><button class="btn primary" id="makeTest" disabled>Seçilənlərdən test (0)</button></div></div>
    <form class="card stack" id="manual" hidden></form>
    <div class="card stack">
      <div class="form-grid">
        <label class="field">Axtar<input type="search" id="fText" placeholder="mətn və ya mövzu"></label>
        <label class="field">Mənbə<select id="fSource"><option value="">Hamısı</option><option value="ai">AI</option><option value="book">Kitabdan</option><option value="manual">Əl ilə</option></select></label>
        <label class="field">Çətinlik<select id="fDiff"><option value="">Hamısı</option>${DIFF.map((d) => `<option>${d}</option>`).join('')}</select></label>
      </div>
      <div id="list"></div>
    </div>`;

  const renderList = () => {
    const t = filter.text.toLocaleLowerCase('az');
    const rows = data.filter((q) => (!filter.source || q.source === filter.source) && (!filter.difficulty || q.difficulty === filter.difficulty)
      && (!t || (q.body + ' ' + (q.topic || '')).toLocaleLowerCase('az').includes(t)));
    $('#list').innerHTML = rows.length
      ? rows.map((q) => questionHtml(q, { selectable: true, checked: selected.has(q.id), actions: `<button class="btn small danger" data-del="${q.id}">Sil</button>` })).join('')
      : `<div class="empty">${data.length ? 'Uyğun sual tapılmadı.' : 'Bank boşdur. <a href="#/ai">AI ilə</a> və ya <a href="#/book">kitabdan</a> sual əlavə edin.'}</div>`;
    $$('#list .check').forEach((c) => c.onchange = () => { c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id); updateBtn(); });
    $$('#list [data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Sual silinsin?')) return;
      const { error: err } = await sb.from('questions').delete().eq('id', b.dataset.del);
      if (err) return fail(err);
      data.splice(data.findIndex((q) => q.id === b.dataset.del), 1);
      selected.delete(b.dataset.del);
      updateBtn(); renderList();
    });
  };
  const updateBtn = () => { const b = $('#makeTest'); b.disabled = !selected.size; b.textContent = `Seçilənlərdən test (${selected.size})`; };

  $('#fText').oninput = (e) => { filter.text = e.target.value; renderList(); };
  $('#fSource').onchange = (e) => { filter.source = e.target.value; renderList(); };
  $('#fDiff').onchange = (e) => { filter.difficulty = e.target.value; renderList(); };
  $('#makeTest').onclick = () => { pendingTestIds = [...selected]; go('#/tests'); };
  $('#toggleManual').onclick = () => { const m = $('#manual'); m.hidden = !m.hidden; if (!m.hidden) manualForm(m); };
  renderList();
}

function manualForm(form) {
  form.innerHTML = `<h2>Əl ilə sual</h2>
    <label class="field">Sual<span class="hint no-math">Formul üçün dollar işarəsi: $\\sqrt{49}$, $\\frac{2}{3}$, $x^2$</span><textarea name="body" rows="3" required></textarea></label>
    <div class="form-grid">
      <label class="field">Növ<select name="qtype"><option value="mcq">Çoxseçimli</option><option value="open">Açıq sual</option></select></label>
      <label class="field">Mövzu<input type="text" name="topic"></label>
      <label class="field">Sinif<input type="number" name="grade" min="1" max="12" value="7"></label>
      <label class="field">Çətinlik<select name="difficulty">${DIFF.map((d) => `<option ${d === 'orta' ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    </div>
    <fieldset id="mcqFields" style="border:0;padding:0;margin:0" class="stack">
      <legend class="small muted" style="margin-bottom:8px">Variantlar · doğru olanı işarələyin</legend>
      ${[0, 1, 2, 3, 4].map((i) => `<div class="row" style="flex-wrap:nowrap"><input type="radio" name="correct" value="${i}" ${i === 0 ? 'checked' : ''} aria-label="${'ABCDE'[i]} doğrudur" style="width:22px;height:22px;accent-color:var(--accent)"><input type="text" name="opt${i}" placeholder="${'ABCDE'[i]} variantı" aria-label="${'ABCDE'[i]} variantı"></div>`).join('')}
    </fieldset>
    <label class="field" id="openAnswer" hidden>Cavab<input type="text" name="answer"></label>
    <label class="field">Həll<span class="hint">istəyə bağlı</span><textarea name="solution" rows="2"></textarea></label>
    <div><button class="btn primary" type="submit">Banka əlavə et</button></div>`;
  const sync = () => { const open = form.qtype.value === 'open'; $('#mcqFields', form).hidden = open; $('#openAnswer', form).hidden = !open; };
  form.qtype.onchange = sync;
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const qtype = f.get('qtype');
    const options = qtype === 'mcq' ? [0, 1, 2, 3, 4].map((i) => f.get('opt' + i).trim()) : [];
    const answer = qtype === 'mcq' ? options[+f.get('correct')] : f.get('answer').trim();
    if (qtype === 'mcq' && options.filter(Boolean).length < 2) return toast('Ən azı 2 variant yazın', true);
    if (!answer) return toast('Doğru cavabı göstərin', true);
    busy($('button[type=submit]', form), async () => {
      const { error } = await sb.from('questions').insert({
        body: f.get('body').trim(), qtype, options: options.filter(Boolean), answer,
        solution: f.get('solution').trim() || null, topic: f.get('topic').trim() || null,
        grade: +f.get('grade') || null, difficulty: f.get('difficulty'), source: 'manual'
      });
      if (error) throw error;
      toast('Sual əlavə olundu');
      route();
    }).catch(fail);
  };
}

async function saveQuestions(list, source) {
  const rows = list.map((q) => ({
    body: q.body, qtype: q.qtype, options: q.options || [], answer: q.answer, solution: q.solution || null,
    topic: q.topic || null, grade: q.grade || null, difficulty: DIFF.includes(q.difficulty) ? q.difficulty : 'orta', source
  }));
  const { error } = await sb.from('questions').insert(rows);
  if (error) throw error;
}

// ================= Şəkil / PDF seçici (kəsmə ilə) =================
// root içinə "Şəkil və ya PDF seç" düyməsi, PDF səhifə keçidi və barmaqla çərçivə çəkmə qurur.
function createPicker(root, { hint = '', label = 'Şəkil və ya PDF seç', actions } = {}) {
  const st = { img: null, scale: 1, sel: null, pdf: null, page: 1 };
  const uid = 'p' + Math.random().toString(36).slice(2, 8);
  root.innerHTML = `<label class="btn primary" style="align-self:flex-start">${label}<input type="file" accept="image/*,application/pdf,.pdf" class="sr" id="${uid}-file"></label>
    <div id="${uid}-area" class="muted small">${esc(hint)}</div>`;
  const area = () => document.getElementById(uid + '-area');

  const api = {
    hasImage: () => !!st.img,
    dataUrl() {
      const s = st.sel;
      const sx = s ? s.x / st.scale : 0, sy = s ? s.y / st.scale : 0;
      const sw = s ? s.w / st.scale : st.img.width, sh = s ? s.h / st.scale : st.img.height;
      const out = Math.min(1, 1600 / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * out)); c.height = Math.max(1, Math.round(sh * out));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(st.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.88);
    },
    clearSelection() { st.sel = null; const b = document.getElementById(uid + '-box'); if (b) b.className = 'crop-box'; }
  };

  document.getElementById(uid + '-file').onchange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      loadPdf(file).catch((err) => { console.error(err); toast('PDF açılmadı. Başqa fayl yoxlayın.', true); });
      return;
    }
    st.pdf = null;
    const img = new Image();
    img.onload = () => { st.img = img; st.sel = null; draw(); };
    img.onerror = () => toast('Şəkil açılmadı. JPG və ya PNG seçin.', true);
    img.src = URL.createObjectURL(file);
  };

  async function loadPdf(file) {
    area().innerHTML = '<div class="row"><span class="spinner sm" aria-hidden="true"></span> PDF açılır…</div>';
    const pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    st.pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    st.page = 1;
    await showPage();
  }

  async function showPage() {
    const page = await st.pdf.getPage(st.page);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
    const c = document.createElement('canvas');
    c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
    st.img = c; st.sel = null;
    draw();
  }

  function draw() {
    const scale = Math.min(1, 1400 / Math.max(st.img.width, st.img.height));
    st.scale = scale;
    const nav = st.pdf ? `<div class="row">
        <button type="button" class="btn small" data-nav="-1" aria-label="Əvvəlki səhifə" ${st.page <= 1 ? 'disabled' : ''}>‹</button>
        <label class="row small" style="gap:6px">Səhifə <input type="number" data-page min="1" max="${st.pdf.numPages}" value="${st.page}" style="width:84px;min-height:36px;padding:4px 8px"> / ${st.pdf.numPages}</label>
        <button type="button" class="btn small" data-nav="1" aria-label="Növbəti səhifə" ${st.page >= st.pdf.numPages ? 'disabled' : ''}>›</button>
      </div>` : '';
    area().innerHTML = nav + `<div class="crop-wrap"><canvas width="${Math.round(st.img.width * scale)}" height="${Math.round(st.img.height * scale)}"></canvas><div class="crop-box" id="${uid}-box"></div></div>
      <div class="row" data-actions><button type="button" class="btn" data-clear>Çərçivəni sil</button></div>`;
    const cv = $('canvas', area());
    cv.getContext('2d').drawImage(st.img, 0, 0, cv.width, cv.height);
    bindCrop(cv);
    $('[data-clear]', area()).onclick = () => api.clearSelection();
    if (st.pdf) {
      const goPage = (n) => {
        const p = Math.max(1, Math.min(st.pdf.numPages, n | 0));
        if (p === st.page) return;
        st.page = p;
        showPage().catch(fail);
      };
      $$('[data-nav]', area()).forEach((b) => b.onclick = () => goPage(st.page + +b.dataset.nav));
      $('[data-page]', area()).onchange = (e) => goPage(+e.target.value);
    }
    if (actions) actions($('[data-actions]', area()), api);
  }

  function bindCrop(cv) {
    const box = document.getElementById(uid + '-box');
    let start = null;
    const pos = (ev) => {
      const r = cv.getBoundingClientRect();
      const k = cv.width / r.width;
      return { x: Math.max(0, Math.min(cv.width, (ev.clientX - r.left) * k)), y: Math.max(0, Math.min(cv.height, (ev.clientY - r.top) * k)), k };
    };
    const show = (a, b) => {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      st.sel = { x, y, w, h };
      Object.assign(box.style, { left: x / a.k + 'px', top: y / a.k + 'px', width: w / a.k + 'px', height: h / a.k + 'px' });
      box.className = 'crop-box on';
    };
    cv.addEventListener('pointerdown', (ev) => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); start = pos(ev); });
    cv.addEventListener('pointermove', (ev) => { if (start) show(start, pos(ev)); });
    const end = (ev) => {
      if (!start) return;
      const p = pos(ev);
      if (Math.abs(p.x - start.x) < 12 || Math.abs(p.y - start.y) < 12) api.clearSelection();
      start = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  return api;
}

// ================= AI ilə sual =================

async function aiView() {
  let results = [];
  view().innerHTML = `
    <div class="page-head"><div><h1>AI ilə sual yarat</h1><p class="muted">Suallar həlli ilə gəlir. Banka əlavə etməzdən əvvəl yoxlayın.</p></div></div>
    <form class="card stack" id="gen">
      <label class="field">Mövzu<span class="hint">nə qədər dəqiq yazsanız, o qədər yaxşı</span><input type="text" name="topic" maxlength="200" placeholder="məs. Tənliklər sistemi, əvəzetmə üsulu"></label>
      <fieldset class="stack" style="border:1px solid var(--line);border-radius:12px;padding:14px;margin:0;gap:12px">
        <legend style="font-weight:700;padding:0 6px">Nümunə suallar <span class="muted small" style="font-weight:400">· istəyə bağlı</span></legend>
        <div id="exPicker" class="stack" style="gap:10px"></div>
        <label class="field">Nümunə mətni<span class="hint">şəkildən oxunan suallar bura düşür; özünüz də yaza və ya düzəldə bilərsiniz</span><textarea name="example" id="exText" rows="5" maxlength="6000" placeholder="məs. Mağazada 3 dəftər və 2 qələm 11 manata satılır. Dəftər qələmdən 2 manat bahadır. Dəftər neçə manatdır?"></textarea></label>
        <div class="stack" style="gap:8px">
          <strong style="font-size:14px">Necə yaradılsın?</strong>
          <div class="pills" role="radiogroup" aria-label="Yaratma rejimi">
            <button type="button" class="pill-opt" role="radio" aria-checked="false" data-mode="izomorf"><strong>İzomorf</strong><span>Eyni quruluş, yalnız rəqəmlər dəyişir</span></button>
            <button type="button" class="pill-opt" role="radio" aria-checked="true" data-mode="benzer"><strong>Bənzər</strong><span>Eyni bacarıq, yeni kontekst və rəqəmlər</span></button>
            <button type="button" class="pill-opt" role="radio" aria-checked="false" data-mode="ferqli"><strong>Fərqli quruluş</strong><span>Eyni bilik, başqa formada sual</span></button>
          </div>
        </div>
      </fieldset>
      <div class="form-grid">
        <label class="field">Sinif<select name="grade">${Array.from({ length: 12 }, (_, i) => `<option ${i + 1 === 7 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <label class="field">Çətinlik<select name="difficulty">${DIFF.map((d) => `<option ${d === 'orta' ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field">Sual sayı<select name="count">${[3, 5, 8, 10].map((n) => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field">Növ<select name="qtype"><option value="mcq">Çoxseçimli</option><option value="open">Açıq sual</option></select></label>
      </div>
      <label class="field">Əlavə istək<span class="hint">istəyə bağlı, məs. "həyati məsələlər olsun"</span><input type="text" name="notes" maxlength="500"></label>
      <div><button class="btn primary" type="submit">${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} Sualları yarat</button></div>
    </form>
    <section id="results"></section>`;

  const renderResults = () => {
    if (!results.length) { $('#results').innerHTML = ''; return; }
    $('#results').innerHTML = `<div class="card stack">
      <div class="row between"><h2>${results.length} sual hazırdır</h2><button class="btn primary" id="saveSel">Seçilənləri banka əlavə et</button></div>
      <div>${results.map((q, i) => questionHtml({ ...q, id: i, source: 'ai' }, { selectable: true, checked: true })).join('')}</div>
    </div>`;
    $('#saveSel').onclick = (e) => {
      const chosen = $$('#results .check').filter((c) => c.checked).map((c) => results[+c.dataset.id]);
      if (!chosen.length) return toast('Heç bir sual seçilməyib', true);
      busy(e.currentTarget, async () => {
        await saveQuestions(chosen, 'ai');
        toast(chosen.length + ' sual banka əlavə olundu');
        results = []; renderResults();
      }).catch(fail);
    };
  };

  let mode = 'benzer';
  $$('[data-mode]').forEach((b) => b.onclick = () => {
    mode = b.dataset.mode;
    $$('[data-mode]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
  });

  createPicker($('#exPicker'), {
    hint: 'Dərslikdən, testdən və ya ekran şəklindən nümunə götürün: sualın (və ya bir neçə sualın) üstündən çərçivə çəkin, sonra “Nümunəyə əlavə et” basın. Bir neçə dəfə əlavə edə bilərsiniz.',
    actions: (row, picker) => {
      row.insertAdjacentHTML('afterbegin', '<button type="button" class="btn primary" data-add-example>Nümunəyə əlavə et</button>');
      $('[data-add-example]', row).onclick = (e) => busy(e.currentTarget, async () => {
        const data = await callAI('extract', { image: picker.dataUrl(), all: true });
        const ta = $('#exText');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + data.text.trim();
        const form = $('#gen');
        if (!form.topic.value.trim() && data.topic) form.topic.value = data.topic;
        if (data.grade) form.grade.value = String(data.grade);
        picker.clearSelection();
        toast('Nümunə əlavə olundu');
      }).catch(fail);
    }
  });

  $('#gen').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.mode = mode;
    if (!String(f.topic || '').trim() && !String(f.example || '').trim()) return toast('Mövzu yazın və ya nümunə sual əlavə edin', true);
    busy($('button[type=submit]', e.target), async () => {
      const data = await callAI('generate', f);
      results = data.questions;
      renderResults();
      $('#results').scrollIntoView({ behavior: 'smooth' });
    }).catch(fail);
  };
}

// ================= Kitabdan sual =================

async function bookView() {
  const state = { extracted: null, level: 'orta', result: null };
  const LEVELS = [
    ['yungul', 'Yüngül', 'Adlar və rəqəmlər dəyişir'],
    ['orta', 'Orta', 'Yeni kontekst, eyni quruluş'],
    ['tam', 'Tam yeni', 'Eyni bilik, fərqli qurulma']
  ];

  view().innerHTML = `
    <div class="page-head"><div><h1>Kitabdan sual kəs</h1><p class="muted">Səhifənin şəklini çəkin və ya dərsliyin PDF-ini seçin, sualı barmaqla çərçivəyə alın, AI onu orijinal suala çevirsin.</p></div></div>
    <p class="notice info">Kitabın şəkli saxlanılmır. Banka yalnız AI-ın yaratdığı yeni sual yazılır.</p>
    <div class="split">
      <section class="card stack">
        <h2>1. Səhifə</h2>
        <div id="bookPicker" class="stack"></div>
      </section>
      <section class="stack" id="right">
        <div class="card stack" id="step2"><h2>2. Tanınmış mətn</h2><div class="empty">Əvvəlcə şəkil seçin və “Sualı oxu” düyməsini basın.</div></div>
      </section>
    </div>`;

  createPicker($('#bookPicker'), {
    hint: 'Şəkil seçildikdən sonra sualın üstündən barmağınızı çəkərək çərçivə çəkin. Çərçivə çəkməsəniz, bütün səhifə oxunur.',
    actions: (row, picker) => {
      row.insertAdjacentHTML('afterbegin', '<button class="btn primary" id="read">Sualı oxu</button>');
      $('#read').onclick = (e) => busy(e.currentTarget, () => readQuestion(picker)).catch(fail);
    }
  });

  async function readQuestion(picker) {
    const data = await callAI('extract', { image: picker.dataUrl() });
    state.extracted = data;
    state.result = null;
    renderStep2();
    if (window.innerWidth < 900) $('#step2').scrollIntoView({ behavior: 'smooth' });
  }

  function renderStep2() {
    const x = state.extracted;
    $('#step2').innerHTML = `<h2>2. Tanınmış mətn</h2>
      <label class="field">Yoxlayın, səhv varsa düzəldin<textarea id="ocr" rows="4">${esc(x.text)}</textarea></label>
      <div class="row">
        ${x.topic ? `<span class="tag">Mövzu: ${esc(x.topic)}</span>` : ''}
        <span class="tag">Sinif: ${esc(x.grade)}</span><span class="tag amber">${esc(x.difficulty)}</span>
        ${x.answer ? `<span class="tag ai">Orijinalın cavabı: ${esc(x.answer)}</span>` : ''}
      </div>
      <h2 style="margin-top:6px">3. Nə qədər dəyişsin?</h2>
      <div class="pills" role="radiogroup" aria-label="Dəyişiklik dərəcəsi">
        ${LEVELS.map(([k, n, d]) => `<button type="button" class="pill-opt" role="radio" aria-checked="${state.level === k}" data-level="${k}"><strong>${n}</strong><span>${d}</span></button>`).join('')}
      </div>
      <label class="field">Sual növü<select id="qtype"><option value="mcq">Çoxseçimli</option><option value="open">Açıq sual</option></select></label>
      <button class="btn primary" id="convert">${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} Orijinala çevir</button>
      <div id="result"></div>
      <div class="stack" style="border-top:1px solid var(--line);padding-top:14px;gap:10px">
        <h2>Və ya: bu nümunəyə bənzər suallar</h2>
        <p class="muted small">Eyni bacarığı yoxlayan, amma tamamilə yeni bir neçə sual yaradılır.</p>
        <div class="row">
          <label class="row small" style="gap:6px">Say <select id="simCount" style="width:auto">${[3, 5, 8, 10].map((n) => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button class="btn" id="similar">Bənzər suallar yarat</button>
        </div>
        <div id="simResults"></div>
      </div>`;
    $$('[data-level]').forEach((b) => b.onclick = () => {
      state.level = b.dataset.level;
      $$('[data-level]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    });
    $('#convert').onclick = (e) => busy(e.currentTarget, convert).catch(fail);
    $('#similar').onclick = (e) => busy(e.currentTarget, similar).catch(fail);
  }

  async function similar() {
    const x = state.extracted;
    const data = await callAI('generate', {
      example: $('#ocr').value, topic: x.topic, grade: x.grade, difficulty: x.difficulty,
      qtype: $('#qtype').value, count: $('#simCount').value
    });
    const list = data.questions;
    $('#simResults').innerHTML = `<div class="card stack">
      <div class="row between"><h3>${list.length} bənzər sual</h3><button class="btn dark" id="saveSim">Seçilənləri banka əlavə et</button></div>
      <div>${list.map((q, i) => questionHtml({ ...q, id: i, source: 'book' }, { selectable: true, checked: true })).join('')}</div>
    </div>`;
    $('#saveSim').onclick = (e) => {
      const btn = e.currentTarget;
      const chosen = $$('#simResults .check').filter((c) => c.checked).map((c) => list[+c.dataset.id]);
      if (!chosen.length) return toast('Heç bir sual seçilməyib', true);
      busy(btn, () => saveQuestions(chosen, 'book')).then(() => {
        toast(chosen.length + ' sual banka əlavə olundu');
        btn.textContent = 'Əlavə olundu ✓';
        btn.disabled = true;
      }).catch(fail);
    };
  }

  async function convert() {
    const x = state.extracted;
    const data = await callAI('transform', {
      text: $('#ocr').value, level: state.level, qtype: $('#qtype').value,
      grade: x.grade, difficulty: x.difficulty, topic: x.topic
    });
    state.result = data;
    const q = { ...data.question, source: 'book' };
    $('#result').innerHTML = `<div class="card accent stack">
      <div class="row between"><h3 style="color:var(--accent)">Yeni orijinal sual</h3><span class="tag book">${esc(LEVELS.find((l) => l[0] === state.level)[1])}</span></div>
      ${questionHtml(q)}
      ${data.changes?.length ? `<div class="small"><strong>Nə dəyişdi:</strong><ul style="margin:6px 0 0;padding-left:20px">${data.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      <div class="row"><button class="btn dark" id="saveBook">Sual bankına əlavə et</button><button class="btn" id="again">Yenidən yarat</button></div>
    </div>`;
    $('#saveBook').onclick = (e) => {
      const btn = e.currentTarget;
      busy(btn, () => saveQuestions([data.question], 'book')).then(() => {
        toast('Sual banka əlavə olundu');
        btn.textContent = 'Əlavə olundu ✓';
        btn.disabled = true;
      }).catch(fail);
    };
    $('#again').onclick = (e) => busy(e.currentTarget, convert).catch(fail);
  }
}

// ================= Testlər =================

async function testsView() {
  const [{ data: tests, error }, { data: classes }, { data: questions }, { data: subs }] = await Promise.all([
    sb.from('tests').select('id, title, is_open, class_id, question_ids, created_at, classes(name)').order('created_at', { ascending: false }),
    sb.from('classes').select('id, name').order('name'),
    sb.from('questions').select('*').order('created_at', { ascending: false }).limit(500),
    sb.from('submissions').select('test_id')
  ]);
  if (error) throw error;
  const subCount = {};
  (subs || []).forEach((s) => { subCount[s.test_id] = (subCount[s.test_id] || 0) + 1; });
  const preset = new Set(pendingTestIds);
  pendingTestIds = [];
  const link = (id) => location.origin + location.pathname + '#/t/' + id;

  view().innerHTML = `
    <div class="page-head"><div><h1>Testlər</h1><p class="muted">Test yaradın və linki şagirdlərə göndərin. Şagirdlər qeydiyyatsız açır.</p></div></div>
    <form class="card stack" id="newTest"><h2>Yeni test</h2>
      <div class="form-grid">
        <label class="field">Testin adı<input type="text" name="title" required maxlength="120" placeholder="məs. Tənliklər · qısa yoxlama"></label>
        <label class="field">Sinif<select name="class_id"><option value="">Sinifsiz (şagird adını özü yazır)</option>${(classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="row between"><strong>Suallar · <span id="selCount">${preset.size}</span> seçilib</strong>${questions?.length ? '' : '<a href="#/ai">Əvvəlcə sual yaradın</a>'}</div>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:0 14px">
        ${(questions || []).map((q) => questionHtml(q, { selectable: true, checked: preset.has(q.id), showAnswer: false })).join('') || '<div class="empty" style="margin:14px 0">Sual bankı boşdur.</div>'}
      </div>
      <div><button class="btn primary" type="submit">Testi yarat</button></div>
    </form>
    <section class="card stack"><h2>Mövcud testlər</h2>
      ${tests.length ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Sinif</th><th>Sual</th><th>Nəticə</th><th>Status</th><th></th></tr></thead><tbody>
        ${tests.map((t) => `<tr>
          <td><a href="#/test/${t.id}"><strong>${esc(t.title)}</strong></a><div class="small muted">${fmtDate(t.created_at)}</div></td>
          <td>${esc(t.classes?.name || '—')}</td><td>${t.question_ids.length}</td><td>${subCount[t.id] || 0}</td>
          <td><button class="btn small" data-toggle="${t.id}" data-open="${t.is_open}">${t.is_open ? 'Açıq · bağla' : 'Bağlı · aç'}</button></td>
          <td><button class="btn small primary" data-copy="${t.id}">Linki kopyala</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Hələ test yoxdur.</div>'}
    </section>`;

  const form = $('#newTest');
  form.addEventListener('change', (e) => { if (e.target.classList.contains('check')) $('#selCount').textContent = $$('.check:checked', form).length; });
  form.onsubmit = (e) => {
    e.preventDefault();
    const ids = $$('.check:checked', form).map((c) => c.dataset.id);
    if (!ids.length) return toast('Ən azı bir sual seçin', true);
    const f = new FormData(form);
    busy($('button[type=submit]', form), async () => {
      const { data: row, error: err } = await sb.from('tests').insert({ title: f.get('title').trim(), class_id: f.get('class_id') || null, question_ids: ids }).select().single();
      if (err) throw err;
      await copyText(link(row.id));
      route();
    }).catch(fail);
  };
  $$('[data-copy]').forEach((b) => b.onclick = () => copyText(link(b.dataset.copy)));
  $$('[data-toggle]').forEach((b) => b.onclick = async () => {
    const { error: err } = await sb.from('tests').update({ is_open: b.dataset.open !== 'true' }).eq('id', b.dataset.toggle);
    if (err) return fail(err);
    route();
  });
}

async function testResultsView(id) {
  const [{ data: test, error }, { data: subs }] = await Promise.all([
    sb.from('tests').select('*, classes(name)').eq('id', id).single(),
    sb.from('submissions').select('*').eq('test_id', id).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  const { data: qs } = await sb.from('questions').select('*').in('id', test.question_ids.length ? test.question_ids : ['00000000-0000-0000-0000-000000000000']);
  const questions = test.question_ids.map((qid) => (qs || []).find((q) => q.id === qid)).filter(Boolean);
  const avg = subs.length ? Math.round(subs.reduce((a, s) => a + (s.total ? s.score / s.total : 0), 0) / subs.length * 100) : null;
  const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('az');
  const link = location.origin + location.pathname + '#/t/' + id;

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/tests">Testlər</a> /</div><h1>${esc(test.title)}</h1>
      <p class="muted">${esc(test.classes?.name || 'Sinifsiz')} · ${questions.length} sual · ${test.is_open ? 'açıq' : 'bağlı'}</p></div>
      <div class="row"><button class="btn primary" id="copy">Linki kopyala</button><button class="btn danger" id="del">Testi sil</button></div></div>
    <section class="grid">
      <div class="card stat"><div class="label">Göndərilən iş</div><div class="value">${subs.length}</div></div>
      <div class="card stat"><div class="label">Orta nəticə</div><div class="value">${avg === null ? '—' : avg + '%'}</div></div>
    </section>
    <section class="card stack"><h2>Şagirdlər</h2>
      ${subs.length ? `<div class="table-wrap"><table><thead><tr><th>Şagird</th><th>Bal</th><th>Faiz</th><th>Vaxt</th></tr></thead><tbody>
        ${subs.map((s) => { const p = s.total ? Math.round(s.score / s.total * 100) : 0; return `<tr><td>${esc(s.student_name)}</td><td><strong>${s.score}/${s.total}</strong></td>
          <td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${p}%"></i></div><span>${p}%</span></div></td><td class="muted">${fmtDate(s.created_at)}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">Hələ heç kim göndərməyib.</div>'}
    </section>
    <section class="card stack"><h2>Suallar üzrə</h2>
      ${questions.map((q, i) => {
        const answered = subs.filter((s) => norm(s.answers?.[q.id]) !== '');
        let stat = '';
        if (q.qtype === 'mcq') {
          const right = subs.filter((s) => norm(s.answers?.[q.id]) === norm(q.answer)).length;
          const p = subs.length ? Math.round(right / subs.length * 100) : 0;
          stat = subs.length ? `<span class="tag ${p < 50 ? 'red' : 'ai'}">${p}% düz cavab</span>` : '';
        }
        const openAnswers = q.qtype === 'open' && answered.length
          ? `<details class="sol"><summary>Şagird cavabları (${answered.length})</summary><div>${answered.map((s) => `<strong>${esc(s.student_name)}:</strong> ${esc(s.answers[q.id])}`).join('\n')}</div></details>` : '';
        return `<div><div class="row"><strong>${i + 1}.</strong>${stat}</div>${questionHtml(q)}${openAnswers}</div>`;
      }).join('')}
    </section>`;
  $('#copy').onclick = () => copyText(link);
  $('#del').onclick = async () => {
    if (!confirm('Test və bütün nəticələri silinsin?')) return;
    const { error: err } = await sb.from('tests').delete().eq('id', id);
    if (err) return fail(err);
    go('#/tests');
  };
}

// ================= Şagird test səhifəsi =================

async function studentTest(id) {
  $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
  const { data: test, error } = await sb.rpc('get_test_for_student', { p_test_id: id });
  if (error || !test) {
    $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack"><h1>Test açılmadı</h1><p class="muted">Test tapılmadı və ya müəllim onu bağlayıb.</p></div></div>`;
    return;
  }
  const doneKey = 'mp_done_' + id;
  let done = null;
  try { done = JSON.parse(localStorage.getItem(doneKey) || 'null'); } catch (_) { done = null; }
  if (done) return studentDone(test, done);

  const students = test.students || [];
  $app.innerHTML = `<form class="student" id="st">
    <div class="row"><span class="brand-mark" style="color:#fff">M+</span><span class="muted">Müəllim+</span></div>
    <h1>${esc(test.title)}</h1>
    <div class="card stack">
      ${students.length
        ? `<label class="field">Adınızı seçin<select name="name" required><option value="">— seçin —</option>${students.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>`
        : '<label class="field">Ad və soyadınız<input type="text" name="name" required maxlength="80" autocomplete="name"></label>'}
    </div>
    ${test.questions.map((q, i) => `<fieldset class="card stack" style="margin:0">
      <legend class="sr">Sual ${i + 1}</legend>
      <div class="muted small">Sual ${i + 1} / ${test.questions.length}</div>
      <div class="q-text pre" style="font-size:17px">${esc(q.body)}</div>
      ${q.qtype === 'mcq'
        ? `<div class="stack" style="gap:8px">${q.options.map((o, j) => `<label class="opt-choice"><input type="radio" name="q_${q.id}" value="${esc(o)}"><span>${'ABCDEF'[j]}) ${esc(o)}</span></label>`).join('')}</div>`
        : `<label class="field"><span class="sr">Cavabınız</span><textarea name="q_${q.id}" rows="3" placeholder="Cavabınızı yazın"></textarea></label>`}
    </fieldset>`).join('')}
    <button class="btn primary block" type="submit" style="min-height:52px;font-size:16px">Cavabları göndər</button>
  </form>`;

  $('#st').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    if (!name) return toast('Adınızı seçin', true);
    const answers = {};
    test.questions.forEach((q) => { const v = f.get('q_' + q.id); if (v !== null && String(v).trim() !== '') answers[q.id] = String(v); });
    const missing = test.questions.length - Object.keys(answers).length;
    if (missing && !confirm(missing + ' suala cavab verilməyib. Yenə də göndərilsin?')) return;
    busy($('button[type=submit]', e.target), async () => {
      const { data, error: err } = await sb.rpc('submit_test', { p_test_id: id, p_student_name: name, p_answers: answers });
      if (err) throw new Error(err.message);
      const result = { ...data, name };
      try { localStorage.setItem(doneKey, JSON.stringify(result)); } catch (_) { /* yaddaş bağlıdır */ }
      studentDone(test, result);
    }).catch(fail);
  };
}

function studentDone(test, r) {
  const hasOpen = test.questions.some((q) => q.qtype === 'open');
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack" style="text-align:center">
    <h1>${esc(test.title)}</h1>
    <p class="muted">${esc(r.name)}, cavablarınız göndərildi.</p>
    ${r.total ? `<div class="score-big">${r.score}/${r.total}</div><p class="muted">çoxseçimli suallardan düz cavab</p>` : ''}
    ${hasOpen ? '<p class="notice">Açıq sualları müəlliminiz yoxlayacaq.</p>' : ''}
  </div></div>`;
}

// ================= Riyazi formullar (KaTeX) =================
// Ekrandakı $...$ və $$...$$ ifadələrini kitabdakı kimi formula çevirir.
function startMath() {
  let scheduled = false;
  const render = () => {
    scheduled = false;
    if (!window.renderMathInElement) { setTimeout(render, 200); return; }
    observer.disconnect();
    try {
      window.renderMathInElement($app, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false,
        ignoredClasses: ['no-math'],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'input', 'select']
      });
    } catch (err) { console.error(err); }
    observer.observe($app, { childList: true, subtree: true, characterData: true });
  };
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(render); }
  });
  observer.observe($app, { childList: true, subtree: true, characterData: true });
  render();
}

startMath();
boot();
