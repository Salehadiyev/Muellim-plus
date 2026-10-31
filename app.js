import { paymentAssistantView, paymentAssistantSettings } from './payment-assistant.js';
import { mountStudentSolver } from './student-solver.js';
let cleanupStudentSolver = null;
import { mountStudentHub, rememberStudent } from './student-hub.js';
// Math Saleh Hoca · əsas tətbiq (heç bir quraşdırma tələb etmir)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $app = document.getElementById('app');
let sb = null;
let session = null;
let aiModels = []; // /api/config-dan: hansı modellər qoşulub
let pendingTestIds = []; // sual bankından testə keçəndə seçilən suallar
let access = null;       // ai_gate(): təsdiq, admin, limitlər (008); undefined = hələ yüklənməyib
let pendingPrint = null;  // PDF üçün seçilən suallar { questions, title, back }

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

const NET_ERR = /Failed to fetch|Load failed|NetworkError|network error|fetch failed/i;
function fail(err) {
  console.error(err);
  const msg = err?.message || String(err || '') || 'Xəta baş verdi';
  if (NET_ERR.test(msg)) return toast('İnternet bağlantısı yoxdur və ya zəifdir. Bir az sonra yenidən yoxlayın.', true);
  toast(msg, true);
  if (!err?.expected) reportError(err);
}

// ---- Səhv jurnalı (009): gözlənilməz səhvlər bazaya yazılır, admin Ayarlar-da görür ----
const reported = new Set();
function reportError(err, source) {
  try {
    if (!sb) return;
    const message = String(err?.message || err || '').slice(0, 1000);
    if (!message || NET_ERR.test(message) || reported.has(message) || reported.size >= 8) return;
    reported.add(message);
    const page = location.hash.split('/').slice(0, 2).join('/'); // kod/ID-lər jurnala düşməsin
    sb.from('app_errors').insert({
      source: source || (/^#\/(s|t)\b/.test(location.hash) ? 'student' : 'client'),
      message, stack: String(err?.stack || '').slice(0, 4000) || null,
      url: (location.pathname + page).slice(0, 500), agent: navigator.userAgent.slice(0, 300)
    }).then(() => {}, () => {});
  } catch (_) { /* jurnal yazılmasa da tətbiq işləsin */ }
}
window.addEventListener('error', (e) => { if (e.error || e.message) reportError(e.error || { message: e.message }); });
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

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

function currentModel() {
  let m = '';
  try { m = localStorage.getItem('mp_model') || ''; } catch (_) { /* yaddaş yoxdur */ }
  const ok = aiModels.find((x) => x.key === m && x.ready);
  return ok ? m : (aiModels.find((x) => x.ready)?.key || 'opus');
}

function modelPicker() {
  const cur = currentModel();
  return `<label class="model-pick">Model
    <select data-model>${(aiModels.length ? aiModels : [{ key: 'opus', label: 'Claude Opus 5.5', note: '', ready: true }]).map((m) =>
      `<option value="${m.key}" ${m.key === cur ? 'selected' : ''} ${m.ready ? '' : 'disabled'}>${esc(m.label)} · ${esc(m.ready ? m.note : 'açar qoşulmayıb')}</option>`).join('')}</select></label>`;
}

function bindModelPicker(root = document) {
  $$('[data-model]', root).forEach((sel) => sel.onchange = () => {
    try { localStorage.setItem('mp_model', sel.value); } catch (_) { /* boş */ }
    $$('[data-model]').forEach((o) => { o.value = sel.value; });
    toast('Model: ' + sel.options[sel.selectedIndex].text.split(' · ')[0]);
  });
}

async function callAI(action, payload) {
  const r = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (session?.access_token || '') },
    body: JSON.stringify({ action, model: currentModel(), ...payload })
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    const e = new Error('Sessiyanın vaxtı bitib. Yenidən daxil olun.');
    e.expected = true;
    sb.auth.signOut().catch(() => {});
    throw e;
  }
  if (!r.ok) {
    const e = new Error(data.error || (r.status === 504 ? 'AI 5 dəqiqə ərzində cavab vermədi. Yenidən yoxlayın.' : 'AI xətası (' + r.status + ')'));
    e.expected = [400, 401, 403, 429].includes(r.status); // limit, təsdiq, giriş — səhv deyil
    throw e;
  }
  if (data._helper) lastHelper = data._helper;
  return data;
}
let lastHelper = '';
const HELPER_NAME = { sonnet: 'Claude Sonnet', 'gemini-flash': 'Gemini', 'gpt-sol': 'GPT Sol', opus: 'Claude Opus' };

// Baza yenilənməyibsə aydın xəta
const needSql = (err, file) => (/column .* does not exist|schema cache|function .* does not exist|Could not find/i.test(err?.message || '')
  ? new Error(`Baza yenilənməyib: Supabase SQL Editor-də supabase/${file} faylını işə salın.`) : err);

async function copyText(text, msg = 'Link kopyalandı') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch (_) { window.prompt('Kopyalayın:', text); }
}

// iPad/telefonda paylaşma pəncərəsi (WhatsApp və s.), olmasa kopyalayır
async function shareText(text, msg) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  copyText(text, msg);
}

const appBase = () => location.origin + location.pathname;
const studentLink = (code) => appBase() + '#/s/' + code;

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

// AI-ın çəkdiyi SVG-ni təhlükəsiz hala gətirir (skript, xarici link, hadisə atributları silinir)
const SVG_ALLOWED = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan',
  'defs', 'marker', 'title', 'desc', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'use', 'symbol']);
// qeyd: nodeName SVG-də kiçik/böyük hərflə gələ bilər (clipPath), müqayisə kiçik hərflə aparılır
const svgCache = new Map();
const svgRemovals = new Map(); // mənbə SVG → təmizləmədə silinən element sayı
function safeSvg(src) {
  const raw = String(src || '').trim();
  if (!raw.startsWith('<svg')) return '';
  if (svgCache.has(raw)) return svgCache.get(raw);
  let out = '';
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror')) {
      let removed = 0;
      const walk = (el) => {
        for (const child of Array.from(el.children)) {
          if (!SVG_ALLOWED.has(child.nodeName.toLowerCase())) { child.remove(); removed++; continue; }
          walk(child);
        }
        for (const a of Array.from(el.attributes)) {
          const n = a.name.toLowerCase();
          if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !a.value.trim().startsWith('#'))) el.removeAttribute(a.name);
        }
      };
      walk(root);
      svgRemovals.set(raw, removed);
      root.removeAttribute('width'); root.removeAttribute('height');
      root.setAttribute('role', 'img');
      out = new XMLSerializer().serializeToString(root);
    }
  } catch (_) { out = ''; }
  svgCache.set(raw, out);
  return out;
}

const hasOptionFigures = (q) => Array.isArray(q.option_figures) && q.option_figures.filter(Boolean).length === (q.options || []).length && q.options.length > 0;

function optionsHtml(q, { showAnswer = true } = {}) {
  if (!(q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length)) return '';
  const figs = hasOptionFigures(q);
  return `<ul class="opts${figs ? ' fig-opts' : ''}">${q.options.map((o, i) => `<li class="${showAnswer && o === q.answer ? 'correct' : ''}">
    <span class="opt-l">${'ABCDEF'[i]})</span>${figs ? `<span class="opt-fig">${safeSvg(q.option_figures[i])}</span>` : `<span>${esc(o)}</span>`}</li>`).join('')}</ul>`;
}

function questionHtml(q, { selectable = false, checked = false, showAnswer = true, actions = '' } = {}) {
  const opts = q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length
    ? optionsHtml(q, { showAnswer })
    : (showAnswer ? `<div class="small"><strong>Cavab:</strong> ${esc(q.answer)}</div>` : '');
  const fig = q.figure ? `<div class="q-fig">${safeSvg(q.figure)}</div>` : '';
  const notes = [q.verify_note, q.fit_note].filter(Boolean).join('; ');
  const st = q.ai_status || (q.verified === true ? 'passed' : q.verified === false ? 'review' : '');
  const ver = (st === 'passed' ? '<span class="tag ai" title="Düzgünlük və nümunəyə uyğunluq yoxlamasından keçib">✓ AI yoxlamasından keçib</span>'
    : st === 'checking' ? '<span class="tag">yoxlanılır…</span>'
    : st === 'review' ? `<span class="tag amber">⚠ Yoxlama tələb edir${notes ? ': ' + esc(notes) : ''}</span>`
    : st === 'draft' ? `<span class="tag red">Qaralama · yoxlama tələb edir${notes ? ': ' + esc(notes) : ''}</span>` : '')
    + (q.teacher_approved ? ' <span class="tag ai">✔ Müəllim təsdiqləyib</span>' : '');
  const meta = [
    q.source ? `<span class="tag ${q.source === 'ai' ? 'ai' : q.source === 'book' ? 'book' : ''}">${esc(SOURCE_LABEL[q.source] || q.source)}</span>` : '',
    q.topic ? `<span class="tag">${esc(q.topic)}</span>` : '',
    q.grade ? `<span class="tag">${esc(gradeLabel(q.grade))}</span>` : '',
    q.difficulty ? `<span class="tag amber">${esc(q.difficulty)}</span>` : '',
    q.exam === 'tryos' ? '<span class="tag book">TR-YÖS</span>' : '',
    q.model ? `<span class="tag">${esc((aiModels.find((m) => m.key === q.model) || {}).label || q.model)}</span>` : '',
    q.subtype ? `<span class="tag">${esc(q.subtype)}</span>` : '',
    q.qtype === 'open' ? '<span class="tag">açıq sual</span>' : '',
    ver
  ].join(' ');
  return `<div class="q">
    ${selectable ? `<input type="checkbox" class="check" data-id="${esc(q.id ?? '')}" ${checked ? 'checked' : ''} aria-label="Sualı seç">` : ''}
    <div class="q-body">
      <div class="row">${meta}</div>
      <div class="q-text">${esc(q.body)}</div>
      ${fig}
      ${opts}
      ${showAnswer && q.solution ? `<details class="sol"><summary>Həlli göstər</summary><div>${esc(q.solution)}</div></details>` : ''}
      ${actions ? `<div class="row">${actions}</div>` : ''}
    </div>
  </div>`;
}

// ================= Başlanğıc və marşrutlar =================

let recoveryMode = false; // e-poçtdakı "şifrəni bərpa et" linki ilə gəlib
async function boot() {
  recoveryMode = /type=recovery/.test(location.hash);
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('config');
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    aiModels = Array.isArray(cfg.models) ? cfg.models : [];
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
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; return newPasswordView(); }
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !wasIn)) { access = null; route(); }
  });
  window.addEventListener('hashchange', route);
  if (recoveryMode) { history.replaceState(null, '', location.pathname); if (session) return newPasswordView(); }
  route();
}

// Şifrə bərpası: e-poçtdakı linkdən gələndə yeni şifrə
function newPasswordView() {
  $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="newPw">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><h1>Yeni şifrə</h1></div>
    <label class="field">Yeni şifrə<span class="hint">Ən azı 8 simvol</span><input type="password" name="p1" required minlength="8" autocomplete="new-password"></label>
    <label class="field">Təkrar<input type="password" name="p2" required minlength="8" autocomplete="new-password"></label>
    <button class="btn primary block" type="submit">Şifrəni dəyiş</button>
  </form></div>`;
  $('#newPw').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) return toast('Şifrələr eyni deyil', true);
    busy($('button', e.target), async () => {
      const { error } = await sb.auth.updateUser({ password: f.get('p1') });
      if (error) throw error;
      recoveryMode = false;
      toast('Şifrə dəyişdirildi');
      access = null;
      go('#/');
      route();
    }).catch(fail);
  };
}

function route() {
  if (cleanupStudentSolver) { cleanupStudentSolver(); cleanupStudentSolver = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [page, id] = parts;
  if (page === 't' && id) return studentTest(id);
  if (page === 's') return studentPortal(id, parts[2], parts[3]);
  if (page === 'privacy') return privacyView();
  if (!session) { access = null; return loginView(); }
  if (!access) {
    loadAccess().then(route).catch(() => { $app.innerHTML='<div class="center-screen"><p role="alert">Giriş icazəsi yoxlanmadı. Səhifəni yeniləyin.</p></div>'; });
    $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
    return;
  }
  if (access.role === 'payment_assistant') return paymentAssistantView($app,sb,access).catch(fail);
  if (!access.approved) return pendingView();
  if (page === 'print') return printView();

  if (page === 'book' || page === 'questions') return go(page === 'book' ? '#/pdf' : '#/bank');
  const views = {
    '': dashboard, classes: classesView, class: classView, lessons: lessonsView, students: studentsView, materials: materialsView, bank: bankView, pdf: pdfView,
    ai: aiView, tests: testsView, newtest: newTestView, auto: autoView, test: testResultsView, student: studentWorkView, analysis: classAnalysisView,
    settings: settingsView, ...(access.is_admin ? { teachers: teachersView } : {})
  };
  const view = views[page] || dashboard;
  const NAV = { class: 'classes', student: 'students', analysis: 'classes', bank: 'questions', pdf: 'questions', ai: 'questions', test: 'tests', newtest: 'tests', auto: 'tests', teachers: 'settings' };
  const navKey = NAV[page] || (views[page] ? page : '');
  shell(navKey);
  window.scrollTo(0, 0);
  view(id).then(() => {
    if (['bank', 'pdf', 'ai'].includes(page) && document.getElementById('view')) $('#view').insertAdjacentHTML('afterbegin', qSubnav(page));
  }).catch(fail);
}

function shell(active) {
  const items = [['', 'Ana səhifə'], ['students', 'Tələbələr'], ['classes', 'Qruplar'], ['questions', 'Suallar'], ['tests', 'Testlər'], ['materials', 'Materiallar'], ['lessons', 'Dərslər']];
  const email = session?.user?.email || '';
  $app.innerHTML = `<div class="shell">
    <nav class="nav" aria-label="Əsas menyu">
      <a class="brand" href="#/"><span class="brand-mark">SH</span><span class="brand-name">Math Saleh Hoca</span></a>
      ${items.map(([k, label]) => `<a class="item ${k === active ? 'active' : ''}" href="#/${k}">${label}${k === 'students' ? '<span class="nav-count" id="navStCount"></span>' : ''}</a>`).join('')}
      <div class="spacer"></div>
      <a class="item ${active === 'settings' ? 'active' : ''}" href="#/settings">Ayarlar</a>
      <div class="who"><span>${esc(email)}</span><button type="button" class="btn small" id="logout">Çıxış</button></div>
    </nav>
    <main class="main" id="view"><div class="spinner" aria-label="Yüklənir"></div></main>
  </div>`;
  $('#logout').onclick = async () => { await sb.auth.signOut(); go('#/'); };
  // menyuda ümumi tələbə sayı
  Promise.resolve(sb.from('students').select('id', { count: 'exact', head: true })).then((r) => { const el = document.getElementById('navStCount'); if (el && r && typeof r.count === 'number') el.textContent = r.count; }, () => {});
}

const view = () => document.getElementById('view');

// ================= Giriş =================

function forgotView() {
  $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="forgotForm">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><h1>Şifrə bərpası</h1></div>
    <p class="muted">E-poçtunuzu yazın, şifrəni yeniləmək üçün link göndərəcəyik.</p>
    <label class="field">E-poçt<input type="email" name="email" required autocomplete="email"></label>
    <button class="btn primary block" type="submit">Link göndər</button>
    <button class="btn block" type="button" id="back">‹ Girişə qayıt</button>
  </form></div>`;
  $('#back').onclick = loginView;
  $('#forgotForm').onsubmit = (e) => {
    e.preventDefault();
    const email = String(new FormData(e.target).get('email') || '').trim();
    busy($('button[type=submit]', e.target), async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appBase() });
      if (error && !/rate|limit/i.test(error.message)) throw error;
      // e-poçtun qeydiyyatda olub-olmadığını açıqlamırıq
      $('#forgotForm').innerHTML = `<div class="row"><span class="brand-mark" style="color:#fff">SH</span><h1>Poçtu yoxlayın</h1></div>
        <p>Bu ünvanla hesab varsa, bir neçə dəqiqəyə şifrə bərpası linki gələcək. Spam qovluğuna da baxın.</p>
        ${error ? '<p class="notice">Çox tez-tez sorğu göndərildi. Bir saat sonra yenidən yoxlayın.</p>' : ''}
        <button class="btn block" type="button" id="back2">‹ Girişə qayıt</button>`;
      $('#back2').onclick = loginView;
    }).catch(fail);
  };
}

// Yalnız giriş: platforma müəllimin özü üçündür (yeni qeydiyyat yoxdur; tələbələr şəxsi linklə girir)
function loginView() {
  $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="auth">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><h1 class="brand-title">Math Saleh Hoca</h1></div>
    <p class="muted">Hesabınıza daxil olun.</p>
    <label class="field">E-poçt<input type="email" name="email" required autocomplete="email"></label>
    <label class="field">Şifrə<input type="password" name="password" required minlength="6" autocomplete="current-password"></label>
    <button class="btn primary block" type="submit">Daxil ol</button>
    <button class="btn block" type="button" id="forgot" style="border:0;background:none;color:var(--accent)">Şifrəni unutmusunuz?</button>
    <p class="small muted" style="text-align:center;margin:0">Tələbəsiniz? Müəlliminizin göndərdiyi şəxsi linki açın.</p>
    <p class="small muted" style="text-align:center;margin:0"><a href="#/privacy">Məxfilik siyasəti</a></p>
  </form></div>`;
  $('#forgot').onclick = forgotView;
  $('#auth').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy($('button[type=submit]', e.target), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-poçt və ya şifrə yanlışdır' : error.message);
    }).catch(fail);
  };
}

// ================= Giriş icazəsi və limitlər (008) =================
async function loadAccess() {
  const helper=await sb.rpc('payment_assistant_access');
  if(helper.data?.role==='payment_assistant'){access=helper.data;return;}
  if(helper.error&&!/PGRST202|function|404/i.test((helper.error.code||'')+' '+(helper.error.message||'')))throw helper.error;
  const { data, error } = await sb.rpc('ai_gate');
  if (error) {
    // baza yenilənməyibsə (funksiya yoxdur) əvvəlki kimi işləsin
    if (/function|could not find|PGRST202|404/i.test((error.message || '') + (error.code || ''))) { access = { approved: true, missing: true }; return; }
    throw error;
  }
  access = data || { approved: false };
}

const usd = (v) => '$' + Number(v || 0).toFixed(2);
function limitLine() {
  if (!access || access.missing || access.daily_limit === undefined) return '';
  const d = Number(access.today) / Number(access.daily_limit || 1), m = Number(access.month) / Number(access.monthly_limit || 1);
  const warn = d >= 0.8 || m >= 0.8;
  return `<p class="${warn ? 'notice' : 'muted small'}" style="margin:0">AI xərci — bu gün: <strong>${usd(access.today)}</strong> / ${usd(access.daily_limit)} · bu ay: <strong>${usd(access.month)}</strong> / ${usd(access.monthly_limit)}${warn ? ' · limitə yaxınsınız' : ''}</p>`;
}

function pendingView() {
  const email = session?.user?.email || '';
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><h1>Təsdiq gözlənilir</h1></div>
    <p>Hesabınız (<strong>${esc(email)}</strong>) yaradıldı, amma hələ təsdiqlənməyib.</p>
    <p class="muted">Platformanın admini hesabınızı təsdiq edəndən sonra daxil ola biləcəksiniz. Təsdiqdən sonra bu səhifəni yeniləyin.</p>
    <div class="row"><button class="btn primary" id="recheck">Yenidən yoxla</button><button class="btn" id="logout2">Çıxış</button></div>
  </div></div>`;
  $('#recheck').onclick = () => { access = null; route(); };
  $('#logout2').onclick = async () => { await sb.auth.signOut(); };
}

// Admin: müəllimlərin təsdiqi və limitləri
async function teachersView() {
  const { data, error } = await sb.rpc('admin_teachers');
  if (error) throw error;
  const list = data || [];
  const pending = list.filter((t) => !t.approved);
  const row = (t) => `<tr data-uid="${t.user_id}">
      <td><strong>${esc(t.email || '—')}</strong>${t.is_admin ? ' <span class="tag book">admin</span>' : ''}<div class="small muted">${fmtDate(t.created_at)} · ${t.questions} sual · ${t.students} tələbə</div></td>
      <td><label class="row small" style="gap:6px"><input type="checkbox" data-f="approved" ${t.approved ? 'checked' : ''} ${t.is_admin ? 'disabled' : ''} style="width:22px;height:22px"> ${t.approved ? 'təsdiqlənib' : 'gözləyir'}</label></td>
      <td><input type="number" data-f="daily_limit_usd" min="0" step="0.5" value="${Number(t.daily_limit)}" style="width:84px;min-height:40px"></td>
      <td><input type="number" data-f="monthly_limit_usd" min="0" step="1" value="${Number(t.monthly_limit)}" style="width:84px;min-height:40px"></td>
      <td><strong>${usd(t.month)}</strong></td>
      <td><button class="btn small primary" data-save>Saxla</button></td></tr>`;
  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/settings">Ayarlar</a> /</div><h1>Müəllimlər</h1><p class="muted">Yeni qeydiyyatdan keçən müəllim siz təsdiqləyənə qədər platformadan istifadə edə bilmir. AI xərci gündəlik və aylıq limitlə məhdudlaşır.</p></div></div>
    ${pending.length ? `<p class="notice">${pending.length} müəllim təsdiq gözləyir.</p>` : ''}
    <section class="card stack">
      <div class="table-wrap"><table><thead><tr><th>Müəllim</th><th>Giriş</th><th>Gündəlik $</th><th>Aylıq $</th><th>Bu ay</th><th></th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody></table></div>
      <p class="small muted">Limitlər Bakı vaxtı ilə hesablanır: gündəlik limit hər gecə, aylıq limit ayın 1-də sıfırlanır. Limit dolanda müəllim AI-dan istifadə edə bilmir, qalan funksiyalar işləyir.</p>
    </section>`;
  $$('[data-save]').forEach((b) => b.onclick = () => {
    const tr = b.closest('tr');
    const val = (f) => $(`[data-f="${f}"]`, tr);
    const upd = {
      daily_limit_usd: Math.max(0, Number(val('daily_limit_usd').value) || 0),
      monthly_limit_usd: Math.max(0, Number(val('monthly_limit_usd').value) || 0)
    };
    if (!val('approved').disabled) upd.approved = val('approved').checked;
    busy(b, async () => {
      const { error: err } = await sb.from('teacher_access').update(upd).eq('user_id', tr.dataset.uid);
      if (err) throw err;
      toast('Yadda saxlandı');
      if (tr.dataset.uid === session.user.id) access = null;
      route();
    }).catch(fail);
  });
}

// ================= Panel =================

// AI sayğacı: hər model üzrə yaradılan, banka düşən, boşa gedən sual və xərc
async function renderUsage(period = 'month') {
  const box = $('#usageCard');
  if (!box) return;
  let q = sb.from('ai_usage').select('model, for_model, role, cost_usd, questions, created_at').order('created_at', { ascending: false }).limit(20000);
  let qq = sb.from('questions').select('model, created_at').not('model', 'is', null).limit(20000);
  if (period === 'month') {
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
    q = q.gte('created_at', from.toISOString());
    qq = qq.gte('created_at', from.toISOString());
  }
  const [{ data: usage, error }, { data: saved }] = await Promise.all([q, qq]);
  if (error) {
    box.innerHTML = `<h2>AI sayğacı</h2><p class="notice">Sayğac üçün bazanı yeniləmək lazımdır: Supabase SQL Editor-də <b>supabase/003_usage.sql</b> faylını işə salın.</p>`;
    return;
  }
  const label = (k) => (aiModels.find((m) => m.key === k) || {}).label || k;
  const rows = {};
  const get = (k) => (rows[k] = rows[k] || { made: 0, saved: 0, mainCost: 0, helperCost: 0 });
  (usage || []).forEach((u) => {
    const k = u.role === 'helper' ? (u.for_model || u.model) : u.model;
    const r = get(k);
    if (u.role === 'helper') r.helperCost += +u.cost_usd; else r.mainCost += +u.cost_usd;
    r.made += u.questions || 0;
  });
  (saved || []).forEach((x) => { get(x.model).saved++; });
  const keys = Object.keys(rows).sort((a, b) => (rows[b].mainCost + rows[b].helperCost) - (rows[a].mainCost + rows[a].helperCost));
  const money = (v) => '$' + v.toFixed(v < 1 ? 3 : 2);
  const tot = keys.reduce((t, k) => ({ made: t.made + rows[k].made, saved: t.saved + rows[k].saved, cost: t.cost + rows[k].mainCost + rows[k].helperCost }), { made: 0, saved: 0, cost: 0 });
  box.innerHTML = `<div class="row between"><h2>AI sayğacı</h2>
      <div class="tabs" role="tablist" aria-label="Dövr">
        <button type="button" role="tab" data-period="month" aria-selected="${period === 'month'}">Bu ay</button>
        <button type="button" role="tab" data-period="all" aria-selected="${period === 'all'}">Hamısı</button></div></div>
    ${keys.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Model</th><th>Yaradılıb</th><th>Banka</th><th>Boşa</th><th>Xərc</th><th>1 sual</th></tr></thead>
      <tbody>${keys.map((k) => { const r = rows[k]; const cost = r.mainCost + r.helperCost; const waste = Math.max(0, r.made - r.saved);
        return `<tr><td><strong>${esc(label(k))}</strong></td><td>${r.made}</td><td>${r.saved}</td><td>${waste}</td>
          <td title="Yaratma: ${money(r.mainCost)} · Oxuma və yoxlama: ${money(r.helperCost)}"><strong>${money(cost)}</strong></td>
          <td class="muted">${r.made ? money(cost / r.made) : '—'}</td></tr>`; }).join('')}
      <tr><td><strong>Cəmi</strong></td><td><strong>${tot.made}</strong></td><td><strong>${tot.saved}</strong></td><td><strong>${Math.max(0, tot.made - tot.saved)}</strong></td><td><strong>${money(tot.cost)}</strong></td><td class="muted">${tot.made ? money(tot.cost / tot.made) : '—'}</td></tr>
      </tbody></table></div>
      <p class="muted small">Xərc təxminidir: tokenlərə və rəsmi qiymətlərə görə hesablanır. Oxuma və ikinci yoxlama xərci seçdiyiniz modelin üstünə yazılır. Dəqiq məbləği provayderin öz panelində görə bilərsiniz.</p>`
    : '<div class="empty">Hələ qeyd yoxdur. Sayğac bundan sonra yaradılan suallardan başlayır.</div>'}`;
  $$('[data-period]', box).forEach((b) => b.onclick = () => renderUsage(b.dataset.period));
}

const AZ_MONTHS_FULL = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const AZ_DAYS = ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];
const todayAz = () => { const d = new Date(); return `${d.getDate()} ${AZ_MONTHS_FULL[d.getMonth()]}, ${AZ_DAYS[d.getDay()]}`; };

async function dashboard() {
  await loadAccess().catch(() => {}); // xərc xəbərdarlığı təzə olsun
  const name = session.user.user_metadata?.full_name || '';
  const [{ data: tests }, { data: subs }, { data: studs }, { count: qCount }] = await Promise.all([
    sb.from('tests').select('*, classes(name)').eq('is_open', true).order('created_at', { ascending: false }).limit(20),
    sb.from('submissions').select('test_id, student_id, student_name, score, total, created_at, tests(title)').order('created_at', { ascending: false }).limit(300),
    sb.from('students').select('id, class_id'),
    sb.from('questions').select('id', { count: 'exact', head: true })
  ]);
  const perClass = {};
  (studs || []).forEach((x) => { perClass[x.class_id] = (perClass[x.class_id] || 0) + 1; });
  const sentBy = {};
  (subs || []).forEach((x) => { sentBy[x.test_id] = (sentBy[x.test_id] || 0) + 1; });
  const recent = (subs || []).slice(0, 6);
  const warn = access && access.daily_limit !== undefined && (Number(access.today) >= 0.8 * Number(access.daily_limit) || Number(access.month) >= 0.8 * Number(access.monthly_limit));
  const pc = (r) => r.total ? Math.round(r.score / r.total * 100) : null;
  const weekAgo = Date.now() - 7 * 864e5;
  const week = (subs || []).filter((r) => new Date(r.created_at).getTime() >= weekAgo);
  const wAvg = week.filter((r) => r.total).length ? Math.round(week.filter((r) => r.total).reduce((x, r) => x + r.score / r.total, 0) / week.filter((r) => r.total).length * 100) : null;
  const seenWeak = new Set();
  const weak = (subs || []).filter((r) => new Date(r.created_at).getTime() >= weekAgo && pc(r) !== null && pc(r) < 50)
    .filter((r) => { const k = r.student_id || r.student_name; if (seenWeak.has(k)) return false; seenWeak.add(k); return true; }).slice(0, 4);
  const AV = ['#0E7490', '#6D5BD0', '#C2410C', '#1D7A4E', '#B42318', '#0369A1', '#A16207', '#7E22CE'];
  const avatar = (n) => { const t = String(n || '?').trim(); let h = 0; for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const ini = t.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('az');
    return `<span class="avatar" style="background:${AV[h % AV.length]}" aria-hidden="true">${esc(ini)}</span>`; };
  view().innerHTML = `
    <section class="hero">
      <div class="hero-txt"><div class="hero-date">${todayAz()}</div>
        <h1>Salam${name ? ', ' + esc(name) : ''} 👋</h1>
        <p>${tests?.length ? `<strong>${tests.length}</strong> açıq test var` : 'Açıq test yoxdur'}${week.length ? ` · bu həftə <strong>${week.length}</strong> iş gəlib` : ''}.</p></div>
      <div class="hero-stats">
        <div><span>${qCount ?? 0}</span><small>sual bankda</small></div>
        <div><span>${(studs || []).length}</span><small>tələbə</small></div>
        <div><span>${wAvg === null ? '—' : wAvg + '%'}</span><small>həftənin ortası</small></div>
      </div>
    </section>
    ${warn ? limitLine() : ''}
    <section class="big-actions">
      <a class="card big-action ba-teal" href="#/pdf"><span class="icon-box">${icons.cut}</span><strong>Sual yarat</strong><span class="muted small">Kitabdan, PDF-dən və ya AI ilə · bankda ${qCount ?? 0} sual</span></a>
      <a class="card big-action ba-violet" href="#/newtest"><span class="icon-box">${icons.test}</span><strong>Test yarat</strong><span class="muted small">Sualları seç, qrupa göndər</span></a>
      <a class="card big-action ba-orange" href="#/classes"><span class="icon-box">${icons.users}</span><strong>Qruplar və nəticələr</strong><span class="muted small">Tələbələr, analiz, hesabat</span></a>
    </section>
    ${weak.length ? `<section class="card stack attn"><h2><span class="attn-dot" aria-hidden="true"></span>Diqqət: bu həftə zəif nəticə</h2>
      ${weak.map((r) => `<a class="drow" href="${r.student_id ? '#/student/' + r.student_id : '#/test/' + r.test_id}">${avatar(r.student_name)}
        <span class="d-main"><strong>${esc(r.student_name)}</strong><span class="small muted">${esc(r.tests?.title || '')}</span></span>${pctChip(pc(r))}<span class="muted">›</span></a>`).join('')}
    </section>` : ''}
    <div class="dash-cols">
    <section class="card stack"><h2>Açıq testlər</h2>
      ${tests?.length ? tests.map((t) => {
        const total = t.student_id ? 1 : (t.class_id ? perClass[t.class_id] || 0 : 0);
        const done = sentBy[t.id] || 0;
        const p = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        return `<a class="drow" href="#/test/${t.id}"><span class="d-main"><strong>${esc(t.title)}</strong><span class="small muted">${esc(t.classes?.name || 'qrupsuz')}${t.due_at ? ' · son tarix ' + esc(fmtDue(t.due_at)) : ''}</span>
          ${total ? `<span class="d-bar" aria-hidden="true"><span style="width:${p}%"></span></span>` : ''}</span>
          <span class="small ${total && done >= total ? 'd-done' : ''}">${total ? `${done} / ${total} yazıb` : `${done} iş`}</span><span class="muted">›</span></a>`;
      }).join('') : '<div class="empty">Açıq test yoxdur. <a href="#/newtest">Test yaradın</a>.</div>'}
    </section>
    <section class="card stack"><h2>Son nəticələr</h2>
      ${recent.length ? recent.map((r) => `<a class="drow" href="#/test/${r.test_id}">${avatar(r.student_name)}
          <span class="d-main"><strong>${esc(r.student_name)}</strong><span class="small muted">${esc(r.tests?.title || '')} · ${fmtDate(r.created_at)}</span></span>
          <span class="d-score"><strong>${r.score}/${r.total}</strong>${pctChip(pc(r))}</span></a>`).join('')
        : '<div class="empty">Hələ nəticə yoxdur.</div>'}
    </section>
    </div>`;
  const root = view();
  const {data:messages} = await sb.from('student_questions').select('id,student_id,body,reply,created_at').order('created_at',{ascending:false}).limit(100);
  if(root===view() && messages?.some(m=>!m.reply)) root.insertAdjacentHTML('beforeend', `<section class="card stack"><h2>Tələbələrdən suallar</h2>${messages.filter(m=>!m.reply).map(m=>`<a class="drow" href="#/student/${esc(m.student_id)}"><span><strong>${esc((studs||[]).find(s=>s.id===m.student_id)?.full_name||'Tələbə')}</strong><br>${esc(m.body.slice(0,120))}</span><span class="tag amber">Cavabla</span></a>`).join('')}</section>`);
}

// Ayarlar: AI xərci və limit, müəllimlər (admin), hesab
async function settingsView() {
  await loadAccess().catch(() => {});
  view().innerHTML = `
    <div class="page-head"><div><h1>Ayarlar</h1></div></div>
    <section class="card stack" id="paymentAssistantSettings"></section>
    <section class="card stack"><h2>AI xərci</h2>${limitLine() || '<p class="muted small">Limitlər üçün bazada 008 yeniləməsi lazımdır.</p>'}</section>
    <section class="card stack" id="usageCard"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">AI sayğacı yüklənir…</span></div></section>
    ${access?.is_admin ? `<section class="card stack" id="errCard"><h2>Səhvlər</h2><p class="muted small">Yüklənir…</p></section>` : ''}
    <section class="card stack"><h2>Ehtiyat nüsxə</h2>
      <p class="muted small">Bütün qruplarınız, tələbələriniz, suallarınız, testləriniz və nəticələriniz bir fayl kimi (JSON) yüklənir. Ayda bir dəfə yükləyib saxlamağınız tövsiyə olunur.</p>
      <div><button class="btn primary" id="exportBtn">Məlumatlarımı yüklə</button></div></section>
    <section class="card stack"><h2>Hesab</h2><p>${esc(session?.user?.email || '')}</p>
      <div class="row"><button class="btn" id="logout3">Çıxış</button><a class="btn" href="#/privacy">Məxfilik siyasəti</a></div></section>`;
  $('#exportBtn').onclick = () => busy($('#exportBtn'), exportMyData).catch(fail);
  $('#logout3').onclick = async () => { await sb.auth.signOut(); go('#/'); };
  paymentAssistantSettings($('#paymentAssistantSettings'),sb).catch(()=>{});
  renderUsage().catch(fail);
  if (access?.is_admin) renderErrors().catch(() => { const c = $('#errCard'); if (c) c.hidden = true; });
}

// Ehtiyat nüsxə: müəllimin bütün məlumatı (RLS yalnız öz məlumatını qaytarır), 1000-lik hissələrlə
async function fetchAll(table, cols = '*') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order('created_at').range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function exportMyData() {
  const [classes, students, questions, tests, submissions] = await Promise.all(
    ['classes', 'students', 'questions', 'tests', 'submissions'].map((t) => fetchAll(t)));
  const dump = { app: 'Math Saleh Hoca', version: 1, exported_at: new Date().toISOString(), teacher: session?.user?.email || '',
    counts: { classes: classes.length, students: students.length, questions: questions.length, tests: tests.length, submissions: submissions.length },
    classes, students, questions, tests, submissions };
  const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `muellim-plus-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`Yükləndi: ${questions.length} sual, ${students.length} tələbə, ${submissions.length} nəticə`);
}

// Məxfilik siyasəti (girişsiz açılır)
function privacyView() {
  $app.innerHTML = `<div class="student privacy">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><span class="muted">Math Saleh Hoca</span></div>
    <h1>Məxfilik siyasəti</h1>
    <p class="muted small">Son yenilənmə: 29 oktyabr 2026</p>
    <section class="card stack">
      <h2>Hansı məlumatları saxlayırıq</h2>
      <ul>
        <li><strong>Müəllim:</strong> e-poçt, ad, yaratdığı qruplar, suallar, testlər və AI istifadəsinin xərc qeydləri.</li>
        <li><strong>Tələbə:</strong> müəllimin daxil etdiyi ad və soyad, şəxsi giriş kodu, testlərdəki cavablar, ballar və göndərmə vaxtı. Tələbədən e-poçt, telefon və ya şifrə istənilmir.</li>
        <li><strong>Texniki:</strong> səhv baş verəndə səhvin mətni, səhifənin ünvanı (şəxsi kodlar olmadan) və brauzer növü.</li>
      </ul>
      <h2>Nə üçün istifadə edirik</h2>
      <p>Yalnız platformanın işləməsi üçün: testlərin keçirilməsi, balların hesablanması, müəllimə nəticə və analizlərin göstərilməsi, səhvlərin düzəldilməsi. Məlumat satılmır və reklam üçün istifadə edilmir.</p>
      <h2>Kim görür</h2>
      <p>Hər müəllim yalnız öz qruplarının və tələbələrinin məlumatını görür. Tələbə yalnız öz testlərini və nəticələrini görür. Müəllimin icazə verdiyi ödəniş köməkçisi yalnız tələbə adı, qrup, dərs davamiyyəti və aylıq ödənişləri görə bilər. Köməkçinin ödəniş qeydləri ad və vaxtla saxlanır. Bu qaydalar verilənlər bazasında tətbiq olunur.</p>
      <h2>Süni intellekt</h2>
      <p>Müəllim sual yaradanda və ya yoxlayanda sualın mətni və şəkli AI xidmətlərinə (Anthropic, OpenAI, Google) göndərilir. Tələbə adları və cavabları AI-a göndərilmir.</p>
      <h2>Harada saxlanılır</h2>
      <p>Məlumat Supabase (Avropa serveri) bazasında, sayt isə Vercel-də yerləşir. Bağlantılar şifrələnir (HTTPS).</p>
      <h2>Saxlama müddəti və silmə</h2>
      <p>Məlumat müəllim hesabı aktiv olduğu müddətdə saxlanılır. Müəllim qrupu, tələbəni, testi və nəticəni istənilən vaxt silə bilər. Tələbə və ya valideyn məlumatların silinməsini müəllimdən istəyə bilər. Hesabın tam silinməsi üçün platformanın admininə müraciət edin. Səhv qeydləri 30 gündən sonra avtomatik silinir.</p>
      <h2>Uşaqlar</h2>
      <p>tələbə məlumatlarını müəllim daxil edir və onların istifadəsinə görə məktəb və müəllim məsuliyyət daşıyır. Müəllim tələbələrin ad-soyadından başqa şəxsi məlumat daxil etməməlidir.</p>
    </section>
    <button class="btn block" type="button" id="pvBack">‹ Geri</button>
  </div>`;
  $('#pvBack').onclick = () => { if (history.length > 1) history.back(); else go('#/'); };
}

// Admin: son səhvlər (eyni mesajlar qruplaşdırılır)
async function renderErrors() {
  const box = $('#errCard');
  if (!box) return;
  const { data, error } = await sb.from('app_errors').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) { box.innerHTML = '<h2>Səhvlər</h2><p class="muted small">Səhv jurnalı üçün bazaya 009 yeniləməsi lazımdır.</p>'; return; }
  const groups = {};
  (data || []).forEach((e) => {
    const k = e.source + '|' + e.message;
    const g = groups[k] = groups[k] || { ...e, n: 0, last: e.created_at };
    g.n++;
  });
  const list = Object.values(groups).sort((a, b) => (a.last < b.last ? 1 : -1));
  const SRC = { client: 'müəllim', student: 'tələbə', server: 'server' };
  box.innerHTML = `<div class="row between"><h2>Səhvlər</h2>${list.length ? '<button class="btn small" id="errClear">Hamısını sil</button>' : ''}</div>
    ${list.length ? `<p class="muted small">Son 30 gün. Eyni səhv bir sətirdə, sayı ilə. Yeni çıxanları mənə (və ya proqramçıya) göstərin.</p>
      <div class="table-wrap"><table><thead><tr><th>Səhv</th><th>Harada</th><th>Say</th><th>Son dəfə</th></tr></thead><tbody>
      ${list.slice(0, 40).map((e) => `<tr><td><details><summary>${esc(e.message.slice(0, 140))}</summary><pre class="small" style="white-space:pre-wrap">${esc(e.stack || '')}
${esc(e.url || '')}
${esc(e.agent || '')}</pre></details></td>
        <td><span class="tag">${SRC[e.source] || e.source}</span></td><td>${e.n}</td><td class="small muted">${fmtDate(e.last)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Səhv qeydə alınmayıb.</div>'}`;
  const c = $('#errClear', box);
  if (c) c.onclick = () => busy(c, async () => {
    const { error: err } = await sb.from('app_errors').delete().not('id', 'is', null);
    if (err) throw err;
    renderErrors();
  }).catch(fail);
}

// ================= Qruplar =================

const pctCls = (p) => p === null ? '' : p >= 75 ? 'hi' : p >= 50 ? 'mid' : 'low';
const pctChip = (p) => p === null ? '<span class="pchip">—</span>' : `<span class="pchip ${pctCls(p)}">${p}%</span>`;

// Tələbələri qrupa köçür; onlara xüsusi (fərdi) testlər də yeni qrupa keçir ki, itməsin
async function moveStudents(ids, gid) {
  const { error } = await sb.from('students').update({ class_id: gid }).in('id', ids);
  if (error) throw error;
  await sb.from('tests').update({ class_id: gid }).in('student_id', ids);
}
// Qrupda qalan fərdi testləri (tələbəsi artıq başqa qrupdadırsa) tələbənin indiki qrupuna keçir
async function rehomePersonalTests(classId) {
  const { data: pts } = await sb.from('tests').select('id, student_id').eq('class_id', classId).not('student_id', 'is', null);
  if (!pts || !pts.length) return;
  const { data: sts } = await sb.from('students').select('id, class_id').in('id', [...new Set(pts.map((t) => t.student_id))]);
  const where = Object.fromEntries((sts || []).map((x) => [x.id, x.class_id]));
  for (const t of pts) if (where[t.student_id] && where[t.student_id] !== classId) await sb.from('tests').update({ class_id: where[t.student_id] }).eq('id', t.id);
}
// Qrupun adını dəyiş / qrupu sil (tələbələr silinmir — «Qrupsuz» siyahısına keçir)
async function renameGroup(c) {
  const name = String(prompt('Qrupun yeni adı:', c.name) || '').trim().slice(0, 60);
  if (!name || name === c.name) return false;
  const { error } = await sb.from('classes').update({ name }).eq('id', c.id);
  if (error) throw error;
  toast('Qrupun adı dəyişdirildi');
  route();
  return true;
}
async function deleteGroup(c, nStudents) {
  if (c.name === NO_GROUP && nStudents) { toast('Əvvəlcə bu tələbələri başqa qrupa köçürün (Tələbələr səhifəsində)', true); return false; }
  if (!confirm(`«${c.name}» qrupu silinsin?\n\n${nStudents ? `${nStudents} tələbə silinmir — «${NO_GROUP}» siyahısına keçir, nəticələri qalır. ` : ''}Qrupun testləri və nəticələri qalır (qrupsuz kimi). Qrupa göndərilmiş materiallar silinir.`)) return false;
  if (nStudents) {
    const gid = await ensureNoGroup();
    const { data: inG } = await sb.from('students').select('id').eq('class_id', c.id);
    if (inG && inG.length) await moveStudents(inG.map((x) => x.id), gid);
  }
  await rehomePersonalTests(c.id);
  const { error } = await sb.from('classes').delete().eq('id', c.id);
  if (error) throw error;
  toast(`«${c.name}» silindi`);
  return true;
}

async function classesView() {
  const [{ data, error }, { data: tests }, { data: subs }] = await Promise.all([
    sb.from('classes').select('id, name, grade, created_at, students(count)').order('created_at'),
    sb.from('tests').select('id, class_id, is_open'),
    sb.from('submissions').select('test_id, score, total')
  ]);
  if (error) throw error;
  const testClass = Object.fromEntries((tests || []).map((t) => [t.id, t.class_id]));
  const info = {};
  (data || []).forEach((c) => { info[c.id] = { open: 0, sum: 0, n: 0 }; });
  (tests || []).forEach((t) => { if (t.is_open && info[t.class_id]) info[t.class_id].open++; });
  (subs || []).forEach((x) => { const k = info[testClass[x.test_id]]; if (k && x.total) { k.sum += x.score / x.total; k.n++; } });

  view().innerHTML = `
    <div class="page-head"><div><h1>Qruplar</h1><p class="muted">Qrupu açın: tələbələr, onların linkləri və nəticələri oradadır.</p></div>
      <button class="btn primary" id="showNew">+ Yeni qrup</button></div>
    <form class="card stack" id="newClass" ${data.length ? 'hidden' : ''}><h2>Yeni qrup</h2>
      <div class="form-grid">
        <label class="field">Qrupun adı<input type="text" name="name" placeholder="məs. 11A" required maxlength="60"></label>
        <label class="field">Səviyyə (sinif)<select name="grade">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === 11 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="btn primary" type="submit">Qrup yarat</button>${data.length ? '<button class="btn" type="button" id="hideNew">Ləğv et</button>' : ''}</div>
    </form>
    ${data.length ? `<section class="ccards">${data.map((c) => {
      const k = info[c.id]; const n = c.students?.[0]?.count ?? 0;
      const avg = k.n ? Math.round(k.sum / k.n * 100) : null;
      return `<div class="ccard-wrap"><a class="ccard" href="#/class/${c.id}">
        <span class="cc-top"><span class="cc-name">${esc(c.name)}</span>${pctChip(avg)}</span>
        <span class="small muted">${c.grade ? esc(gradeLabel(c.grade)) : ''}</span>
        <span class="cc-facts"><span><strong>${n}</strong> tələbə</span><span><strong>${k.open}</strong> açıq test</span><span><strong>${k.n}</strong> iş</span></span>
        <span class="cc-go">Qrupu aç ›</span></a>
        <details class="more cc-more"><summary class="btn small" aria-label="${esc(c.name)}: digər">⋯</summary><div class="more-menu">
          <button class="btn small" data-gren="${c.id}">✏️ Adını dəyiş</button>
          <button class="btn small danger" data-gdel="${c.id}">🗑 Sil</button></div></details></div>`; }).join('')}</section>`
      : '<div class="card"><div class="empty">Hələ qrup yoxdur. Yuxarıda ilk qrupu yaradın.</div></div>'}`;
  const byG = Object.fromEntries(data.map((c) => [c.id, c]));
  $$('[data-gren]').forEach((b) => b.onclick = () => renameGroup(byG[b.dataset.gren]).catch(fail));
  $$('[data-gdel]').forEach((b) => b.onclick = () => deleteGroup(byG[b.dataset.gdel], byG[b.dataset.gdel].students?.[0]?.count ?? 0).then((ok) => { if (ok) route(); }).catch(fail));
  $('#showNew').onclick = () => { $('#newClass').hidden = false; $('input[name=name]', $('#newClass')).focus(); };
  $('#hideNew') && ($('#hideNew').onclick = () => { $('#newClass').hidden = true; });
  $('#newClass').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy($('button[type=submit]', e.target), async () => {
      const { data: row, error: err } = await sb.from('classes').insert({ name: f.get('name').trim(), grade: +f.get('grade') }).select().single();
      if (err) throw err;
      go('#/class/' + row.id);
    }).catch(fail);
  };
}

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ABC[b % 31]).join('');

// Qrupun səhv dəftəri (müəllim): kimdə neçə sual, ən çox səhv edilənlər, AI ilə bənzər hazırlamaq
// ================= Dərs cədvəli (qrup) =================
// classes.schedule = { slots: [{ d: 1..7 (1 = bazar ertəsi), s: 'HH:MM', e: 'HH:MM' }], since: 'YYYY-MM-DD' }
const WEEK_DAYS = [[1, 'Bazar ertəsi', 'B.e.'], [2, 'Çərşənbə axşamı', 'Ç.a.'], [3, 'Çərşənbə', 'Ç.'], [4, 'Cümə axşamı', 'C.a.'], [5, 'Cümə', 'C.'], [6, 'Şənbə', 'Ş.'], [7, 'Bazar', 'B.']];
const isoDow = (ymdStr) => (new Date(ymdStr + 'T00:00:00').getDay() || 7);
const schedSlots = (c) => (c && c.schedule && Array.isArray(c.schedule.slots) ? c.schedule.slots : [])
  .filter((x) => x && x.d >= 1 && x.d <= 7 && /^\d\d:\d\d$/.test(x.s || '')).sort((a, b) => a.d - b.d || a.s.localeCompare(b.s));
const slotText = (x, long = false) => `${WEEK_DAYS[x.d - 1][long ? 1 : 2]} ${x.s}${x.e ? '–' + x.e : ''}`;
const schedText = (c) => schedSlots(c).map((x) => slotText(x)).join(' · ');

function schedEditor(box, cls) {
  let edit = false;
  let rows = schedSlots(cls).map((x) => ({ ...x }));
  const draw = () => {
    if (!edit) {
      box.innerHTML = `<span class="exam-ico" aria-hidden="true">🗓️</span><strong class="small">Dərs cədvəli</strong>
        <span class="small ${schedSlots(cls).length ? '' : 'muted'}" style="flex:1">${schedSlots(cls).length ? schedSlots(cls).map((x) => `<span class="sch-chip">${esc(slotText(x, true))}</span>`).join(' ') : 'Yazılmayıb — yazsanız, «Dərslər» bölməsi bu qrupun dərs gününü özü açacaq.'}</span>
        <button class="btn small" id="schEdit">${schedSlots(cls).length ? '✏️ Dəyiş' : '+ Cədvəl yaz'}</button>`;
      $('#schEdit', box).onclick = () => { edit = true; rows = schedSlots(cls).map((x) => ({ ...x })); if (!rows.length) rows.push({ d: 2, s: '16:00', e: '17:00' }); draw(); };
      return;
    }
    box.innerHTML = `<div class="stack" style="width:100%;gap:8px"><strong class="small">🗓️ Dərs cədvəli — həftənin günləri və saatlar</strong>
      ${rows.map((x, i) => `<div class="row sch-edit">
        <select data-sd="${i}" aria-label="Gün" style="min-height:40px;width:auto">${WEEK_DAYS.map(([d, n]) => `<option value="${d}" ${d === x.d ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <input type="time" data-ss="${i}" value="${esc(x.s)}" aria-label="Başlayır" style="min-height:40px;width:auto"> – <input type="time" data-se="${i}" value="${esc(x.e || '')}" aria-label="Bitir" style="min-height:40px;width:auto">
        <button type="button" class="btn small" data-sx="${i}" aria-label="Bu günü sil">✕</button></div>`).join('')}
      <div class="row"><button type="button" class="btn small" id="schAdd">+ Gün əlavə et</button><span style="flex:1"></span>
        <button type="button" class="btn small" id="schCancel">Ləğv et</button><button type="button" class="btn small primary" id="schSave">Yadda saxla</button></div></div>`;
    const sync = () => rows.forEach((x, i) => { x.d = +$(`[data-sd="${i}"]`, box).value; x.s = $(`[data-ss="${i}"]`, box).value; x.e = $(`[data-se="${i}"]`, box).value; });
    $$('[data-sx]', box).forEach((b) => b.onclick = () => { sync(); rows.splice(+b.dataset.sx, 1); draw(); });
    $('#schAdd', box).onclick = () => { sync(); const l = rows[rows.length - 1]; rows.push({ d: l ? Math.min(7, l.d + 1) : 2, s: l?.s || '16:00', e: l?.e || '17:00' }); draw(); };
    $('#schCancel', box).onclick = () => { edit = false; draw(); };
    $('#schSave', box).onclick = () => busy($('#schSave', box), async () => {
      sync();
      const slots = rows.filter((x) => /^\d\d:\d\d$/.test(x.s)).map((x) => ({ d: x.d, s: x.s, e: /^\d\d:\d\d$/.test(x.e) ? x.e : '' }));
      if (slots.some((x) => x.e && x.e <= x.s)) throw new Error('Bitmə saatı başlamadan sonra olmalıdır');
      const schedule = { slots, since: cls.schedule?.since || todayIso() };
      const { error } = await sb.from('classes').update({ schedule }).eq('id', cls.id);
      if (error) throw needSql(error, '018_schedule.sql');
      cls.schedule = schedule; edit = false; draw(); toast('Dərs cədvəli yadda saxlandı');
    }).catch(fail);
  };
  draw();
}

// Bu günün dərsləri və son 14 gündə qeyd olunmamış dərs günləri
function scheduleAgenda(classes, lessons, students) {
  const today = todayIso();
  const now = new Date(); const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dow = isoDow(today);
  const todayList = [];
  const missing = [];
  const stuByClass = {};
  students.forEach((s) => { (stuByClass[s.class_id] = stuByClass[s.class_id] || new Set()).add(s.id); });
  const marked = new Set(lessons.map((l) => l.lesson_date + '|' + l.student_id));
  classes.forEach((c) => {
    const slots = schedSlots(c);
    if (!slots.length || !stuByClass[c.id]) return;
    slots.filter((x) => x.d === dow).forEach((x) => todayList.push({ c, x }));
    const since = c.schedule?.since || today;
    for (let i = 0; i <= 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (ds < since) break;
      slots.filter((x) => x.d === isoDow(ds)).forEach((x) => {
        if (ds === today && (x.e || x.s) > hm) return; // bu günün dərsi hələ bitməyib
        const any = [...stuByClass[c.id]].some((sid) => marked.has(ds + '|' + sid));
        if (!any) missing.push({ c, x, date: ds });
      });
    }
  });
  todayList.sort((a, b) => a.x.s.localeCompare(b.x.s));
  // indi gedən, yoxsa ən yaxın növbəti, yoxsa sonuncu
  const pick = todayList.find((t) => t.x.s <= hm && hm < (t.x.e || '24:00')) || todayList.find((t) => t.x.s > hm) || todayList[todayList.length - 1] || null;
  return { todayList, missing: missing.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10), pick };
}

// ================= Mövzu planı (qrup) =================
// classes.plan = { topics: [{ t: 'Mövzu', done: 'YYYY-MM-DD' | null }] } — ardıcıllıq siyahının sırasıdır.
const topicKey = (t) => String(t || '').toLocaleLowerCase('tr').replace(/[^a-zəğıöşüçâîû0-9]+/gi, '');
const topicMatch = (a, b) => { const x = topicKey(a), y = topicKey(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)))); };
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;

// Qrupun testlərindən mövzu üzrə nəticə: { mövzu: { r, n, st: { tələbə id: { r, n } } } }
async function groupTopicStats(tests) {
  const tids = (tests || []).map((t) => t.id);
  if (!tids.length) return {};
  const { data: subs, error } = await sb.from('submissions').select('test_id, student_id, answers').in('test_id', tids);
  if (error) throw error;
  const qids = [...new Set((tests || []).flatMap((t) => t.question_ids || []))];
  const qs = {};
  for (let i = 0; i < qids.length; i += 200) {
    const { data, error: e2 } = await sb.from('questions').select('id, topic, answer, qtype').in('id', qids.slice(i, i + 200));
    if (e2) throw e2;
    (data || []).forEach((q) => { qs[q.id] = q; });
  }
  const tq = Object.fromEntries((tests || []).map((t) => [t.id, t.question_ids || []]));
  const out = {};
  (subs || []).forEach((x) => (tq[x.test_id] || []).forEach((id) => {
    const q = qs[id];
    if (!q || q.qtype !== 'mcq' || !String(q.topic || '').trim()) return;
    const ok = String((x.answers || {})[id] ?? '').trim().toLowerCase() === String(q.answer || '').trim().toLowerCase();
    const o = out[q.topic] || (out[q.topic] = { r: 0, n: 0, st: {} });
    o.n++; if (ok) o.r++;
    if (x.student_id) { const s = o.st[x.student_id] || (o.st[x.student_id] = { r: 0, n: 0 }); s.n++; if (ok) s.r++; }
  }));
  return out;
}

// Həftəlik plan: qalan mövzular imtahana qədər bölünür, son həftələr zəif mövzuların təkrarı + deneme
function buildWeeks(topics, examDate, weakNames) {
  if (!examDate) return null;
  const today = new Date(new Date().toDateString());
  const days = Math.round((new Date(examDate + 'T00:00:00') - today) / 864e5);
  if (days < 0) return { past: true, weeks: [] };
  const n = Math.max(1, Math.ceil((days + 1) / 7));
  const rev = n >= 6 ? 2 : n >= 3 ? 1 : 0;
  const left = topics.filter((x) => !x.done).map((x) => x.t);
  const study = n - rev;
  const weeks = [];
  const per = study > 0 ? Math.ceil(left.length / study) : 0;
  for (let i = 0; i < n; i++) {
    const a = new Date(today); a.setDate(a.getDate() + i * 7);
    const b = new Date(a); b.setDate(b.getDate() + 6);
    const end = new Date(examDate + 'T00:00:00');
    const label = `${i + 1}-ci həftə · ${shortDay(a)}–${shortDay(b > end ? end : b)}`;
    if (i < study) weeks.push({ label, items: left.slice(Math.round(i * left.length / study), Math.round((i + 1) * left.length / study)), rev: false });
    else weeks.push({ label, items: i === n - 1 ? [...weakNames.slice(0, 3), 'Son deneme'] : [...weakNames, 'Deneme'], rev: true });
  }
  if (study <= 0 && left.length) weeks[0].items.unshift(...left);
  return { past: false, weeks, per, left: left.length };
}

async function classPlan(box, cls, students, tests) {
  const stats = await groupTopicStats(tests);
  const plan = cls.plan && Array.isArray(cls.plan.topics) ? cls.plan : null;
  let topics = plan ? plan.topics.map((x) => ({ t: String(x.t || '').slice(0, 120), done: x.done || null })).filter((x) => x.t)
    : [...TRYOS_TOPICS.matematik, ...TRYOS_TOPICS.sayisal].map((t) => ({ t, done: null }));
  // testlərdə olan, amma siyahıda olmayan mövzular sona əlavə olunur
  Object.keys(stats).forEach((t) => { if (!topics.some((x) => topicMatch(x.t, t))) topics.push({ t, done: null }); });
  const byStu = Object.fromEntries(students.map((s) => [s.id, s.full_name]));
  const statOf = (t) => {
    const keys = Object.keys(stats).filter((k) => topicMatch(k, t));
    if (!keys.length) return null;
    const o = { r: 0, n: 0, st: {} };
    keys.forEach((k) => { const s = stats[k]; o.r += s.r; o.n += s.n; Object.entries(s.st).forEach(([id, v]) => { const z = o.st[id] || (o.st[id] = { r: 0, n: 0 }); z.r += v.r; z.n += v.n; }); });
    return o;
  };
  const save = async () => {
    const { error } = await sb.from('classes').update({ plan: { topics } }).eq('id', cls.id);
    if (error) throw needSql(error, '017_plan.sql');
    cls.plan = { topics };
  };
  const draw = () => {
    const done = topics.filter((x) => x.done).length;
    const rows = topics.map((x) => ({ ...x, s: statOf(x.t) }));
    const weak = rows.filter((x) => x.s && x.s.n >= 5 && x.s.r / x.s.n < 0.5).sort((a, b) => a.s.r / a.s.n - b.s.r / b.s.n);
    const wk = buildWeeks(topics, cls.exam_date, weak.map((x) => x.t));
    const pctDone = topics.length ? Math.round(done / topics.length * 100) : 0;
    box.innerHTML = `
      <div class="row between"><h2>Mövzu planı</h2><span class="small muted">${cls.exam_date ? esc(daysLeftText(cls.exam_date)) : 'İmtahan tarixini yuxarıda yazın — həftəlik plan qurulacaq'}</span></div>
      <div class="plan-prog"><div class="row between small"><span><strong>${done}</strong> / ${topics.length} mövzu keçilib</span><span>${pctDone}%</span></div>
        <div class="pbar"><span style="width:${pctDone}%"></span></div></div>
      ${weak.length ? `<p class="notice small" style="margin:0">Qrup zəifdir: ${weak.slice(0, 5).map((x) => `<strong>${esc(x.t)}</strong> ${Math.round(x.s.r / x.s.n * 100)}%`).join(' · ')}</p>` : ''}
      ${wk ? (wk.past ? '<p class="muted small">İmtahan tarixi keçib.</p>' : `<details class="plan-weeks" open><summary><strong>📅 Həftəlik plan</strong> <span class="small muted">· qalan ${wk.left} mövzu, ${wk.weeks.length} həftə${wk.per ? `, həftədə ~${wk.per}` : ''}</span></summary>
        <ol class="pw-list">${wk.weeks.map((w) => `<li class="${w.rev ? 'rev' : ''}"><span class="pw-l">${esc(w.label)}${w.rev ? ' · təkrar' : ''}</span><span class="pw-i">${w.items.length ? w.items.map(esc).join(' · ') : '<span class="muted">boş həftə — təkrar və ya deneme</span>'}</span></li>`).join('')}</ol></details>`) : ''}
      <div class="plan-list">${rows.map((x, i) => { const p = x.s ? Math.round(x.s.r / x.s.n * 100) : null;
        const ws = x.s ? Object.entries(x.s.st).filter(([id, v]) => byStu[id] && v.n >= 3 && v.r / v.n < 0.5).map(([id, v]) => `${esc(byStu[id])} ${Math.round(v.r / v.n * 100)}%`) : [];
        return `<div class="prow ${x.done ? 'done' : ''}">
          <label class="pr-chk"><input type="checkbox" data-pdone="${i}" ${x.done ? 'checked' : ''} aria-label="${esc(x.t)} keçildi"></label>
          <div class="pr-main"><span class="pr-t">${esc(x.t)}</span>
            <span class="small muted">${x.done ? `keçildi · ${esc(x.done.split('-').reverse().join('.'))}` : 'keçilməyib'}${x.s ? ` · ${x.s.n} cavab` : ''}</span>
            ${ws.length ? `<span class="small pr-weak">zəif: ${ws.join(', ')}</span>` : ''}</div>
          ${pctChip(p)}
          <span class="pr-act"><button type="button" class="btn small" data-pup="${i}" aria-label="Yuxarı" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn small" data-pdn="${i}" aria-label="Aşağı" ${i < rows.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn small" data-pdel="${i}" aria-label="${esc(x.t)} sil">✕</button></span>
        </div>`; }).join('')}</div>
      <form class="row" id="pAdd"><input name="t" maxlength="120" placeholder="Yeni mövzu (məs. Problemler)" aria-label="Yeni mövzu" style="flex:1;min-width:180px;min-height:44px"><button class="btn">+ Əlavə et</button></form>
      <p class="small muted" style="margin:0">Faiz — bu qrupun testlərindəki həmin mövzu sualları üzrə düz cavab payı. «Zəif» — ən azı 3 cavabda 50%-dən aşağı olan tələbələr. Ardıcıllığı ↑↓ ilə dəyiş.</p>`;
    const act = (fn) => async () => { const old = topics.map((x) => ({ ...x })); fn(); draw(); try { await save(); } catch (e) { topics = old; draw(); fail(e); } };
    $$('[data-pdone]', box).forEach((c) => c.onchange = act(() => { const x = topics[+c.dataset.pdone]; x.done = c.checked ? localYmd() : null; }));
    $$('[data-pup]', box).forEach((b) => b.onclick = act(() => { const i = +b.dataset.pup; [topics[i - 1], topics[i]] = [topics[i], topics[i - 1]]; }));
    $$('[data-pdn]', box).forEach((b) => b.onclick = act(() => { const i = +b.dataset.pdn; [topics[i + 1], topics[i]] = [topics[i], topics[i + 1]]; }));
    $$('[data-pdel]', box).forEach((b) => b.onclick = () => { const x = topics[+b.dataset.pdel]; if (confirm(`«${x.t}» plandan silinsin?`)) act(() => { topics.splice(topics.indexOf(x), 1); })(); });
    $('#pAdd', box).onsubmit = (e) => { e.preventDefault(); const t = new FormData(e.target).get('t').trim().slice(0, 120);
      if (!t) return; if (topics.some((x) => topicKey(x.t) === topicKey(t))) return toast('Bu mövzu artıq var', true);
      act(() => topics.push({ t, done: null }))(); };
  };
  draw();
}

async function classMistakes(box, students, notes = []) {
  if (!students.length) { box.innerHTML = '<div class="empty">Qrupda tələbə yoxdur.</div>'; return; }
  const { data: rows, error } = await sb.from('mistakes').select('id, student_id, question_id, status, attempts, due_at').in('student_id', students.map((x) => x.id));
  if (error) {
    if (/mistakes|schema cache|does not exist/i.test(error.message || '')) {
      box.innerHTML = '<p class="notice">Səhv dəftəri üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>010_mistakes.sql</strong> → Run.</p>';
      return;
    }
    throw error;
  }
  const open = rows.filter((r) => r.status === 'open');
  const cleared = rows.length - open.length;
  const per = {};
  rows.forEach((r) => { const k = per[r.student_id] || (per[r.student_id] = { open: 0, cleared: 0 }); k[r.status === 'open' ? 'open' : 'cleared']++; });
  const qCount = {};
  open.forEach((r) => { qCount[r.question_id] = (qCount[r.question_id] || 0) + 1; });
  const qIds = Object.keys(qCount);
  const [qs, { data: sims }] = await Promise.all([
    qIds.length ? fullQuestions(qIds) : [],
    qIds.length ? sb.from('questions').select('id, similar_to, ai_status, verified, teacher_approved').in('similar_to', qIds) : { data: [] }
  ]);
  // hər orijinal üçün: 'ok' (tələbəyə verilə bilən bənzər var) | 'draft' (yalnız təsdiq gözləyən)
  const simState = {};
  (sims || []).forEach((x) => {
    const good = x.teacher_approved || x.ai_status === 'passed' || (!x.ai_status && x.verified === true);
    if (good) simState[x.similar_to] = 'ok'; else if (!simState[x.similar_to]) simState[x.similar_to] = 'draft';
  });
  const top = qs.slice().sort((a, b) => qCount[b.id] - qCount[a.id]);
  const need = top.filter((q) => !simState[q.id] && q.qtype === 'mcq');
  const drafts = top.filter((q) => simState[q.id] === 'draft').length;
  const name = Object.fromEntries(students.map((x) => [x.id, x.full_name]));
  const SIM_LABEL = { ok: ['hi', '✓ bənzəri var'], draft: ['mid', 'bənzəri təsdiq gözləyir'] };
  box.innerHTML = `
    <p class="small muted" style="margin:0">Tələbə testdə səhv etdiyi sual avtomatik dəftərinə düşür. Bir gün sonra öz linkində ona <strong>bənzər sual</strong> çıxır: düz tapsa dəftərdən silinir, səhv etsə 2 gün sonra başqa bənzəri gəlir. Bənzərlər bankdan götürülür: əvvəl AI ilə hazırladığınız (yoxlanmış və ya təsdiqlədiyiniz) bənzərlər, sonra eyni mövzudakı suallar.</p>
    <div class="grid res-stats">
      <div class="card stat"><div class="label">Dəftərdə</div><div class="value">${open.length}</div></div>
      <div class="card stat"><div class="label">Düzəldilib</div><div class="value" style="color:var(--green)">${cleared}</div></div>
      <div class="card stat"><div class="label">Bənzəri yoxdur</div><div class="value">${need.length}</div></div>
    </div>
    ${notes.length ? `<div class="card stack" style="background:#FFFBF5"><strong>Son hazırlama</strong><ul class="warn-list">${notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${need.length ? `<div class="nb-gen"><span><strong>${need.length}</strong> sualın hələ AI ilə hazırlanmış bənzəri yoxdur (indi eyni mövzudan və ya sualın özü verilir).</span>
      <button class="btn primary" id="mkGen">✨ Bənzərləri AI ilə hazırla (${need.length})</button></div><p class="small muted" id="mkProg" role="status" aria-live="polite"></p>` : ''}
    ${drafts ? `<p class="notice"><strong>${drafts}</strong> sualın bənzəri yoxlamadan keçməyib və qaralama kimi saxlanılıb. Aşağıda "bənzəri təsdiq gözləyir" yazılan suala basın, bənzərə baxın: düzgündürsə <strong>✔ Təsdiqlə</strong>, deyilsə <strong>Sil</strong> (sonra yenidən hazırlaya bilərsiniz). Təsdiqlənməyən qaralama tələbəyə verilmir.</p>` : ''}
    <h3>tələbələr</h3>
    ${rows.length ? `<div class="slist">${students.filter((x) => per[x.id]).sort((a, b) => per[b.id].open - per[a.id].open).map((x) => `<div class="srow">
        <a class="s-name" href="#/student/${x.id}"><strong>${esc(x.full_name)}</strong></a>
        <span class="row" style="gap:8px">${per[x.id].open ? `<span class="pchip low">${per[x.id].open} dəftərdə</span>` : ''}${per[x.id].cleared ? `<span class="pchip hi">✓ ${per[x.id].cleared}</span>` : ''}</span></div>`).join('')}</div>`
      : '<div class="empty">Dəftər boşdur: hələ heç kim səhv etməyib (və ya test yazılmayıb).</div>'}
    ${top.length ? `<div class="row between"><h3>Dəftərdəki suallar</h3><span class="small muted">Basın: sual və bənzərləri açılır</span></div><div class="qstat-grid">${top.map((q, i) => { const sl = SIM_LABEL[simState[q.id]] || ['low', 'bənzəri yoxdur']; return `<button type="button" class="qstat" data-mq="${i}">
        <span class="qs-head"><strong>${qCount[q.id]} tələbə</strong><span class="qs-p ${sl[0]}">${sl[1]}</span></span>
        <span class="qs-text">${esc(q.body)}</span></button>`; }).join('')}</div>` : ''}`;
  const refresh = () => classMistakes(box, students).catch(fail);
  const openPair = async (q) => {
    const { data: list, error: e2 } = await sb.from('questions').select('*').eq('similar_to', q.id).order('created_at', { ascending: false });
    if (e2) return fail(e2);
    const who = open.filter((r) => r.question_id === q.id).map((r) => esc(name[r.student_id] || '')).join(', ');
    openDialog('Dəftərdəki sual və bənzərləri', `<p class="small muted">Səhv edənlər: ${who}</p>
      <div class="pair-view"><div><div class="pair-lbl">Orijinal (testdəki sual)</div>${questionHtml(q, { actions: '' })}</div>
      <div><div class="pair-lbl">Bənzərlər${list.length ? ` · ${list.length}` : ''}</div>${list.length ? list.map((x) => questionHtml(x, { actions: `<button class="btn small ${x.teacher_approved ? '' : 'ok'}" data-sapp="${x.id}">${x.teacher_approved ? 'Təsdiqi götür' : '✔ Təsdiqlə'}</button><button class="btn small danger" data-sdel="${x.id}">Sil</button>` })).join('')
        : '<div class="empty">Hələ bənzər yoxdur. "✨ Bənzərləri AI ilə hazırla" düyməsini basın.</div>'}</div></div>`);
    const dlg = document.getElementById('rvDialog');
    $$('[data-sapp]', dlg).forEach((btn) => btn.onclick = async () => {
      const x = list.find((y) => y.id === btn.dataset.sapp);
      const { error: e3 } = await sb.from('questions').update({ teacher_approved: !x.teacher_approved }).eq('id', x.id);
      if (e3) return fail(e3);
      fullCache.delete(x.id);
      toast(x.teacher_approved ? 'Təsdiq götürüldü' : 'Təsdiqləndi — tələbəyə veriləcək');
      await openPair(q); refresh();
    });
    $$('[data-sdel]', dlg).forEach((btn) => btn.onclick = async () => {
      if (!confirm('Bu bənzər sual bankdan silinsin?')) return;
      const { error: e3 } = await sb.from('questions').delete().eq('id', btn.dataset.sdel);
      if (e3) return fail(e3);
      toast('Silindi');
      await openPair(q); refresh();
    });
  };
  $$('[data-mq]', box).forEach((b) => b.onclick = () => openPair(top[+b.dataset.mq]).catch(fail));
  const gen = $('#mkGen', box);
  if (gen) gen.onclick = () => {
    if (!confirm(`${need.length} sual üçün AI bənzər sual hazırlayacaq (hər biri yoxlanılır). Davam edilsin?`)) return;
    busy(gen, async () => {
      let ok = 0, draft = 0, done = 0;
      const report = [];
      const short = (t) => String(t || '').replace(/\s+/g, ' ').slice(0, 50) + (String(t || '').length > 50 ? '…' : '');
      const q = makeQueue(3);
      await Promise.all(need.map((orig) => q(async () => {
        try {
          const img = (await renderQuestionImage(orig)).image;
          const text = orig.body + '\n' + (orig.options || []).map((o, j) => `${'ABCDE'[j]}) ${o}`).join('\n');
          const r = await callAI('tryos_from_examples', { samples: [{ text, image: img, topic: orig.topic || '', section: orig.section || 'matematik' }], mode: 'benzer', perSample: 1 });
          const nq = r.questions?.[0];
          if (!nq) throw new Error('AI sual qaytarmadı' + (r.rejected?.length ? ': ' + r.rejected.map((x) => x.reason).join('; ') : ''));
          const passed = await checkQuestion(nq, { mode: 'benzer', sample: { text, image: img } });
          if (!passed) {
            nq.ai_status = 'draft';
            draft++;
            report.push(`«${short(orig.body)}» — bənzəri yoxlamadan keçmədi, qaralama kimi saxlandı: ${[nq.verify_note, nq.fit_note].filter(Boolean).join('; ') || 'səbəb göstərilməyib'}`);
          } else ok++;
          await saveQuestions([{ ...nq, topic: nq.topic || orig.topic, subtype: orig.subtype || nq.subtype, difficulty: orig.difficulty || nq.difficulty, similar_to: orig.id }], 'ai');
        } catch (err) {
          if (err.expected) throw err;
          report.push(`«${short(orig.body)}» — alınmadı: ${err.message}`);
        }
        done++;
        const pr = $('#mkProg'); if (pr) pr.textContent = `Hazırlanır: ${done} / ${need.length}…`;
      })));
      const failed = need.length - ok - draft;
      toast(`${ok} bənzər hazırdır${draft ? `, ${draft} qaralama (baxıb təsdiqləyin)` : ''}${failed ? `, ${failed} alınmadı` : ''}`, !ok);
      classMistakes(box, students, report).catch(fail);
    }).catch(fail);
  };
}

const daysLeftText = (d) => {
  const n = Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
  return n > 0 ? `İmtahana ${n} gün qaldı` : n === 0 ? 'İmtahan bu gündür!' : 'İmtahan tarixi keçib';
};
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
const noteUrl = (path) => sb.storage.from('notes').getPublicUrl(path).data.publicUrl;
const NOTE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic'];

// Dərs qeydləri (müəllim): qrupa və ya bir tələbəyə mətn + PDF/şəkil
// Qrupsuz tələbələr üçün xüsusi qrup (lazım olanda yaradılır)
const NO_GROUP = 'Qrupsuz';
async function ensureNoGroup() {
  const { data } = await sb.from('classes').select('id, name').eq('name', NO_GROUP);
  if (data && data[0]) return data[0].id;
  const { data: row, error } = await sb.from('classes').insert({ name: NO_GROUP }).select().single();
  if (error) throw error;
  return row.id;
}
const studentMsg2 = (s) => `${s.full_name}, bu sənin şəxsi Math Saleh Hoca linkindir. Testləri buradan yaz, nəticələrini, dərs materiallarını və səhv dəftərini də burada görəcəksən:\n${studentLink(s.access_code)}`;

// Yalnız tanınan YouTube ünvanlarından təhlükəsiz video pəncərəsi yaradır.
function materialVideoUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    const host = u.hostname.toLowerCase();
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else id = (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/) || [])[1] || '';
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return '';
    const result = new URL('https://www.youtube-nocookie.com/embed/' + id);
    result.searchParams.set('playsinline', '1');
    const time = u.searchParams.get('start') || u.searchParams.get('t') || '';
    const m = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const seconds = /^\d+$/.test(time) ? Number(time) : m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
    if (Number.isSafeInteger(seconds) && seconds > 0) result.searchParams.set('start', String(seconds));
    return result.href;
  } catch (_) { return ''; }
}

function materialVideoHtml(raw, title) {
  const src = materialVideoUrl(raw);
  return src ? `<div class="material-video"><iframe src="${esc(src)}" title="${esc(title || 'Dərs videosu')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div><p class="small muted">Video açılmasa, materialın linkindən YouTube-da baxa bilərsiniz.</p>` : '';
}

// Materiallar (dərs qeydləri): mətn, PDF/şəkil, video link; bir neçə qrupa və ya bir tələbəyə
async function notesManager(box, { classes, students, fixedClass = null }) {
  const { data: all, error: err } = await sb.from('lesson_notes').select('*').order('created_at', { ascending: false });
  if (err) {
    if (/lesson_notes|schema cache|does not exist/i.test(err.message || '')) { box.innerHTML = '<p class="notice">Materiallar üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>012_student_insights.sql</strong> → Run.</p>'; return; }
    throw err;
  }
  const stIds = new Set(students.map((x) => x.id));
  const notes = (all || []).filter((n) => !fixedClass || n.class_id === fixedClass.id || (n.student_id && stIds.has(n.student_id)));
  const nameOf = Object.fromEntries(students.map((x) => [x.id, x.full_name]));
  const clsName = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  const allTopics = [...TRYOS_TOPICS.matematik, ...TRYOS_TOPICS.sayisal];
  const hasLinkCol = (all || []).length === 0 || 'link_url' in (all[0] || {});
  box.innerHTML = `
    <div class="row between"><p class="small muted" style="margin:0">Mövzu izahı, PDF, lövhənin şəkli, video dərsin linki — tələbə öz səhifəsində <strong>"Dərs materiallarım"</strong> bölməsində görür.</p>
      <button class="btn primary" id="ntNew">+ Yeni material</button></div>
    <form class="stack nt-form" id="ntForm" hidden>
      <div class="form-grid">
        <label class="field">Başlıq<input type="text" name="title" required maxlength="200" placeholder="məs. Fonksiyonlar — 1-ci dərs"></label>
        <label class="field">Mövzu<span class="hint">istəyə bağlı</span><input type="text" name="topic" list="ntTopics" maxlength="120"><datalist id="ntTopics">${allTopics.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
      </div>
      <fieldset class="nt-to"><legend class="small"><strong>Kimə</strong> — bir və ya bir neçə qrup seçin</legend>
        <div class="chips">${classes.map((c) => `<label class="chip-cb"><input type="checkbox" name="grp" value="${c.id}" ${fixedClass && fixedClass.id === c.id ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
        <label class="field" style="margin-top:8px">və ya yalnız bir tələbəyə<select name="to"><option value="">— seçilməyib —</option>${students.map((x) => `<option value="${x.id}">👤 ${esc(x.full_name)}${clsName[x.class_id] ? ' · ' + esc(clsName[x.class_id]) : ''}</option>`).join('')}</select></label>
      </fieldset>
      <label class="field">Mətn<span class="hint">istəyə bağlı · formul üçün $x^2$</span><textarea name="body" rows="4" maxlength="20000"></textarea></label>
      <div class="form-grid">
        <label class="field">Fayl<span class="hint">PDF və ya şəkil, ən çox 15 MB</span><input type="file" name="file" accept="application/pdf,.pdf,image/*"></label>
        <label class="field">Video / link<span class="hint">YouTube, Google Drive və s.</span><input type="url" name="link" maxlength="500" placeholder="https://youtu.be/…" ${hasLinkCol ? '' : 'disabled title="Bazada 014_materials.sql işə salın"'}></label>
      </div>
      <div class="row"><button class="btn primary" type="submit">Yadda saxla</button><button class="btn" type="button" id="ntCancel">Ləğv et</button></div>
    </form>
    ${notes.length ? `<div class="nt-list">${notes.map((n) => `<article class="nt-item">
        <div class="nt-head"><strong>${esc(n.title)}</strong><span class="small muted">${esc(fmtDue(n.created_at))}</span></div>
        <div class="nt-meta">${n.topic ? `<span class="tag book">${esc(n.topic)}</span>` : ''}<span class="tag">${n.student_id ? '👤 ' + esc(nameOf[n.student_id] || 'tələbə') : '👥 ' + esc(clsName[n.class_id] || 'qrup')}</span>
          ${n.file_path ? `<a class="tag ai" href="${esc(noteUrl(n.file_path))}" target="_blank" rel="noopener">${n.file_type === 'application/pdf' ? '📄' : '🖼'} ${esc(n.file_name || 'fayl')}</a>` : ''}
          ${n.link_url ? `<a class="tag deneme" href="${esc(n.link_url)}" target="_blank" rel="noopener">▶ Video / link</a>` : ''}</div>
        ${n.body ? `<div class="nt-body">${esc(n.body)}</div>` : ''}
        ${materialVideoHtml(n.link_url, n.title)}
        <div><button class="btn small danger" data-ntdel="${n.id}">Sil</button></div></article>`).join('')}</div>`
      : '<div class="empty">Hələ material yoxdur.</div>'}`;
  const form = $('#ntForm', box);
  const again = () => notesManager(box, { classes, students, fixedClass });
  $('#ntNew', box).onclick = () => { form.hidden = false; $('input[name=title]', form).focus(); };
  $('#ntCancel', box).onclick = () => { form.hidden = true; };
  // "qrup(lar) VƏ YA bir tələbə": biri seçiləndə o biri təmizlənir
  form.to.onchange = () => { if (form.to.value) $$('input[name=grp]', form).forEach((c) => { c.checked = false; }); };
  $$('input[name=grp]', form).forEach((c) => c.onchange = () => { if (c.checked) form.to.value = ''; });
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const file = f.get('file');
    const hasFile = file && file.size;
    const link = String(f.get('link') || '').trim();
    const groups = f.getAll('grp');
    const to = f.get('to');
    if (!groups.length && !to) return toast('Qrup və ya tələbə seçin', true);
    if (!String(f.get('body') || '').trim() && !hasFile && !link) return toast('Mətn yazın, fayl və ya link əlavə edin', true);
    if (link && !/^https?:\/\//i.test(link)) return toast('Link https:// ilə başlamalıdır', true);
    if (hasFile && file.size > 15 * 1024 * 1024) return toast('Fayl 15 MB-dan böyükdür', true);
    if (hasFile && !NOTE_TYPES.includes(file.type) && !/\.pdf$/i.test(file.name)) return toast('Yalnız PDF və ya şəkil', true);
    busy($('button[type=submit]', form), async () => {
      let path = null;
      if (hasFile) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
        path = `${session.user.id}/${randomId()}.${ext}`;
        const { error: e1 } = await sb.storage.from('notes').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (e1) throw /bucket|not found|policy|row-level/i.test(e1.message || '') ? new Error('Fayl yüklənmədi: Supabase-də 012_student_insights.sql işə salınıb? (' + e1.message + ')') : e1;
      }
      const base = { title: f.get('title').trim(), topic: String(f.get('topic') || '').trim() || null, body: String(f.get('body') || '').trim() || null,
        file_path: path, file_name: hasFile ? file.name.slice(0, 200) : null, file_type: hasFile ? (file.type || 'application/pdf') : null };
      if (link) base.link_url = link;
      const rows = [...groups.map((g) => ({ ...base, class_id: g, student_id: null })), ...(to ? [{ ...base, class_id: null, student_id: to }] : [])];
      const { error: e2 } = await sb.from('lesson_notes').insert(rows);
      if (e2) { if (path) sb.storage.from('notes').remove([path]).catch(() => {}); throw needSql(e2, link ? '014_materials.sql' : '012_student_insights.sql'); }
      toast(rows.length > 1 ? `Material ${rows.length} yerə göndərildi` : 'Material əlavə olundu');
      await again();
    }).catch(fail);
  };
  $$('[data-ntdel]', box).forEach((btn) => btn.onclick = async () => {
    const n = notes.find((x) => x.id === btn.dataset.ntdel);
    if (!confirm(`«${n.title}» silinsin?`)) return;
    const { error: e3 } = await sb.from('lesson_notes').delete().eq('id', n.id);
    if (e3) return fail(e3);
    if (n.file_path) {
      // eyni fayl başqa qrupa da göndərilibsə, fayl qalır
      const { data: rest } = await sb.from('lesson_notes').select('id').eq('file_path', n.file_path);
      if (!rest || !rest.length) sb.storage.from('notes').remove([n.file_path]).catch(() => {});
    }
    again().catch(fail);
  });
}
async function classNotes(box, cls, students) {
  const { data: classes } = await sb.from('classes').select('id, name').order('name');
  return notesManager(box, { classes: classes || [cls], students, fixedClass: cls });
}

async function materialsView() {
  const [{ data: classes, error }, { data: students }] = await Promise.all([
    sb.from('classes').select('id, name').order('name'),
    sb.from('students').select('id, full_name, class_id').order('full_name')
  ]);
  if (error) throw error;
  view().innerHTML = `<div class="page-head"><div><h1>Materiallar</h1><p class="muted">Dərs PDF-ləri, şəkillər, video dərslər — qrup-qrup və ya tələbəyə.</p></div></div>
    <section class="card stack" id="matBox"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">Yüklənir…</span></div></section>`;
  if (!(classes || []).length) { $('#matBox').innerHTML = '<div class="empty">Əvvəlcə <a href="#/classes">qrup</a> yaradın.</div>'; return; }
  await notesManager($('#matBox'), { classes, students: students || [] });
}

// ================= Tələbələr: hamısı bir siyahıda, qrupa əlavə / köçür =================
async function studentsView() {
  const [{ data: classes, error }, { data: students, error: e2 }] = await Promise.all([
    sb.from('classes').select('id, name').order('name'),
    sb.from('students').select('id, full_name, class_id, access_code, created_at').order('full_name')
  ]);
  if (error || e2) throw error || e2;
  const cls = classes || [];
  const st = students || [];
  let filter = ''; let text = '';
  const count = (id) => st.filter((x) => x.class_id === id).length;
  const groupOpts = (sel, withNew) => cls.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + (withNew ? '<option value="__new">+ Yeni qrup…</option>' : '');
  view().innerHTML = `
    <div class="page-head"><div><h1>Tələbələr</h1><p class="muted">Bütün tələbələriniz. Tələbəni yaradın, sonra qrupa qoyun və ya qruplar arasında köçürün.</p></div>
      <button class="btn primary" id="stNewBtn">+ Tələbə əlavə et</button></div>
    <form class="card stack" id="stNew" ${st.length ? 'hidden' : ''}>
      <h2>Tələbə əlavə et</h2>
      <label class="field">Adlar<span class="hint">Hər sətirdə bir ad. Siyahını Excel və ya qeydlərdən yapışdıra bilərsiniz.</span><textarea name="names" rows="4" placeholder="Əli Həsənov&#10;Nərgiz Quliyeva"></textarea></label>
      <div class="form-grid">
        <label class="field">Qrup<select name="grp"><option value="">${NO_GROUP} (sonra seçərəm)</option>${groupOpts('', true).replace(`<option value="${(cls.find((c) => c.name === NO_GROUP) || {}).id}" >${NO_GROUP}</option>`, '')}</select></label>
        <label class="field" id="newGrpF" hidden>Yeni qrupun adı<input type="text" name="newgrp" maxlength="60" placeholder="məs. B qrupu"></label>
      </div>
      <div class="row"><button class="btn primary" type="submit">Əlavə et</button>${st.length ? '<button class="btn" type="button" id="stCancel">Ləğv et</button>' : ''}</div>
    </form>
    ${st.length ? `<div class="card stack">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <input type="search" id="stFind" placeholder="Axtar: ad" style="flex:1;min-width:180px">
        <div class="chips" id="stChips"><button type="button" class="chip on" data-g="">Hamısı · ${st.length}</button>${cls.filter((c) => count(c.id)).map((c) => `<button type="button" class="chip" data-g="${c.id}">${esc(c.name)} · ${count(c.id)}</button>`).join('')}</div>
      </div>
      <div class="bulk-bar" id="bulkBar" hidden><span><strong id="bulkN">0</strong> tələbə seçilib</span>
        <span class="row" style="gap:8px">Köçür: <select id="bulkTo" style="min-height:40px;width:auto">${groupOpts('', true)}</select><button class="btn small primary" id="bulkGo">Köçür</button><button class="btn small danger" id="bulkDel">🗑 Sil</button></span></div>
      <div class="slist" id="stList"></div></div>` : ''}`;
  const form = $('#stNew');
  $('#stNewBtn').onclick = () => { form.hidden = false; $('textarea', form).focus(); };
  $('#stCancel') && ($('#stCancel').onclick = () => { form.hidden = true; });
  form.grp.onchange = () => { $('#newGrpF').hidden = form.grp.value !== '__new'; };
  const resolveGroup = async (v, newName) => {
    if (v === '__new') {
      const name = String(newName || prompt('Yeni qrupun adı:') || '').trim().slice(0, 60);
      if (!name) throw new Error('Qrupun adını yazın');
      const { data: row, error: e3 } = await sb.from('classes').insert({ name }).select().single();
      if (e3) throw e3;
      return row.id;
    }
    return v || ensureNoGroup();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const names = String(f.get('names') || '').split('\n').map((n) => n.trim()).filter(Boolean).slice(0, 200);
    if (!names.length) return toast('Ən azı bir ad yazın', true);
    busy($('button[type=submit]', form), async () => {
      const gid = await resolveGroup(f.get('grp'), f.get('newgrp'));
      const { error: e4 } = await sb.from('students').insert(names.map((n) => ({ class_id: gid, full_name: n.slice(0, 80) })));
      if (e4) throw e4;
      toast(names.length + ' tələbə əlavə olundu');
      route();
    }).catch(fail);
  };
  if (!st.length) return;
  const sel = new Set();
  const byId = Object.fromEntries(st.map((x) => [x.id, x]));
  const draw = () => {
    const t = text.toLocaleLowerCase('az');
    const list = st.filter((x) => (!filter || x.class_id === filter) && (!t || x.full_name.toLocaleLowerCase('az').includes(t)));
    $('#stList').innerHTML = list.length ? list.map((x) => `<div class="srow st-row">
        <input type="checkbox" class="check" data-sel="${x.id}" ${sel.has(x.id) ? 'checked' : ''} aria-label="${esc(x.full_name)} seç" style="width:22px;height:22px;accent-color:var(--accent)">
        <a class="s-name" href="#/student/${x.id}"><strong>${esc(x.full_name)}</strong>${x.access_code ? `<span class="small muted">kod: <span class="mono">${esc(x.access_code)}</span></span>` : ''}</a>
        <label class="st-grp"><span class="sr">Qrup</span><select data-move="${x.id}">${groupOpts(x.class_id, true)}</select></label>
        <span class="s-act">${x.access_code ? `<button class="btn small primary" data-share="${x.id}">Linki göndər</button>` : ''}
          <details class="more"><summary class="btn small" aria-label="${esc(x.full_name)}: digər">⋯</summary><div class="more-menu">
            <button class="btn small" data-ren="${x.id}">✏️ Adını dəyiş</button>
            ${x.access_code ? `<button class="btn small" data-recode2="${x.id}" title="Köhnə link işləməyəcək">🔗 Yeni link yarat</button>` : ''}
            <button class="btn small danger" data-sdel="${x.id}">🗑 Sil</button></div></details></span></div>`).join('')
      : '<div class="empty">Uyğun tələbə yoxdur.</div>';
    $('#bulkBar').hidden = !sel.size; $('#bulkN').textContent = sel.size;
    $$('[data-sel]').forEach((c) => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); $('#bulkBar').hidden = !sel.size; $('#bulkN').textContent = sel.size; });
    $$('[data-share]').forEach((b) => b.onclick = () => shareText(studentMsg2(byId[b.dataset.share]), 'Link kopyalandı'));
    $$('[data-move]').forEach((s2) => s2.onchange = () => move([s2.dataset.move], s2.value).catch((err) => { fail(err); draw(); }));
    $$('[data-ren]').forEach((b) => b.onclick = async () => {
      const x = byId[b.dataset.ren];
      const name = String(prompt('Yeni ad:', x.full_name) || '').trim().slice(0, 80);
      if (!name || name === x.full_name) return;
      const { error: e6 } = await sb.from('students').update({ full_name: name }).eq('id', x.id);
      if (e6) return fail(e6);
      toast('Ad dəyişdirildi');
      route();
    });
    $$('[data-recode2]').forEach((b) => b.onclick = async () => {
      const x = byId[b.dataset.recode2];
      if (!confirm(`${x.full_name} üçün yeni link yaradılsın? Köhnə link daha işləməyəcək, nəticələr qalacaq.`)) return;
      const { error: e7 } = await sb.from('students').update({ access_code: newCode() }).eq('id', x.id);
      if (e7) return fail(e7);
      toast('Yeni link yaradıldı');
      route();
    });
    $$('[data-sdel]').forEach((b) => b.onclick = () => removeStudents([b.dataset.sdel]).catch(fail));
  };
  const removeStudents = async (ids) => {
    const names = ids.map((i) => byId[i]?.full_name).filter(Boolean);
    const who = names.length === 1 ? names[0] : `${names.length} tələbə`;
    if (!confirm(`${who} silinsin?\n\nGöndərdiyi test nəticələri müəllim tərəfində qalır. Şəxsi linki, səhv dəftəri, ona xüsusi testlər və materiallar, dərs və ödəniş qeydləri silinir. Bunu geri qaytarmaq olmur.`)) return;
    const { error: e8 } = await sb.from('students').delete().in('id', ids);
    if (e8) throw e8;
    toast(names.length === 1 ? `${names[0]} silindi` : `${names.length} tələbə silindi`);
    route();
  };
  const move = async (ids, to) => {
    const gid = await resolveGroup(to);
    await moveStudents(ids, gid);
    toast(`${ids.length} tələbə köçürüldü`);
    route();
  };
  $('#stFind').oninput = (e) => { text = e.target.value; draw(); };
  $$('#stChips [data-g]').forEach((b) => b.onclick = () => { filter = b.dataset.g; $$('#stChips .chip').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  $('#bulkGo').onclick = () => busy($('#bulkGo'), () => move([...sel], $('#bulkTo').value)).catch(fail);
  $('#bulkDel').onclick = () => removeStudents([...sel]).catch(fail);
  draw();
}

async function classView(id) {
  const [{ data: cls, error }, { data: students }, { data: tests }] = await Promise.all([
    sb.from('classes').select('*').eq('id', id).single(),
    sb.from('students').select('*').eq('class_id', id).order('full_name'),
    sb.from('tests').select('id, title, is_open, created_at, student_id, question_ids').eq('class_id', id).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  const tids = (tests || []).map((t) => t.id);
  const { data: subs } = tids.length ? await sb.from('submissions').select('test_id, student_id, student_name, score, total').in('test_id', tids) : { data: [] };
  const per = {}; const perTest = {}; let sum = 0; let cnt = 0;
  (subs || []).forEach((x) => {
    perTest[x.test_id] = (perTest[x.test_id] || 0) + 1;
    if (!x.total) return;
    sum += x.score / x.total; cnt++;
    if (x.student_id) { const k = per[x.student_id] || (per[x.student_id] = { sum: 0, n: 0 }); k.sum += x.score / x.total; k.n++; }
  });
  const avgOf = (sid) => per[sid] ? Math.round(per[sid].sum / per[sid].n * 100) : null;
  const classAvg = cnt ? Math.round(sum / cnt * 100) : null;
  const openTests = (tests || []).filter((t) => t.is_open).length;
  const hasCodes = students.length > 0 && students.every((s) => s.access_code);
  const needsSql = students.length > 0 && !hasCodes;
  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/classes">Qruplar</a> /</div><h1>${esc(cls.name)}</h1>
        <p class="muted">${cls.grade ? esc(gradeLabel(cls.grade)) + ' · ' : ''}${students.length} tələbə</p></div>
      <div class="row"><button class="btn" id="renClass">✏️ Adını dəyiş</button><button class="btn" id="showAdd">+ Tələbə əlavə et</button><a class="btn primary" href="#/analysis/${id}">Analiz</a></div></div>
    <section class="grid res-stats">
      <div class="card stat"><div class="label">Tələbə</div><div class="value">${students.length}</div></div>
      <div class="card stat"><div class="label">Qrupun ortası</div><div class="value">${classAvg === null ? '—' : classAvg + '%'}</div></div>
      <div class="card stat"><div class="label">Açıq test</div><div class="value">${openTests}</div></div>
    </section>
    <div class="exam-row card">
      <span class="exam-ico" aria-hidden="true">🎓</span>
      <label class="row small" style="gap:8px;flex-wrap:wrap">İmtahan tarixi <input type="date" id="examDate" value="${esc(cls.exam_date || '')}" style="min-height:40px;width:auto"></label>
      <button class="btn small" id="saveExam">Saxla</button>
      <span class="small muted" id="examLeft">${cls.exam_date ? daysLeftText(cls.exam_date) : 'Tarixi yazın: tələbələr öz səhifəsində geri sayımı görəcək.'}</span>
    </div>
    <div class="exam-row card" id="schedBox"></div>
    <form id="addStudents" class="card stack" ${students.length ? 'hidden' : ''}>
      <h2>Tələbə əlavə et</h2>
      <label class="field">Adlar<span class="hint">Hər sətirdə bir ad. Siyahını Excel və ya qeydlərdən yapışdıra bilərsiniz.</span>
        <textarea name="names" rows="5" placeholder="Əli Həsənov&#10;Nərgiz Quliyeva"></textarea></label>
      <div class="row"><button class="btn primary" type="submit">Əlavə et</button>${students.length ? '<button class="btn" type="button" id="hideAdd">Ləğv et</button>' : ''}</div>
    </form>
    <div class="seg tseg" role="tablist" aria-label="Qrup bölmələri">
      <button type="button" class="seg-b on" data-ctab="st" role="tab">Tələbələr <span class="seg-c">${students.length}</span></button>
      <button type="button" class="seg-b" data-ctab="ts" role="tab">Testlər <span class="seg-c">${(tests || []).length}</span></button>
      <button type="button" class="seg-b" data-ctab="pl" role="tab">🗺️ Plan</button>
      <button type="button" class="seg-b" data-ctab="mk" role="tab">📒 Səhv dəftəri</button>
      <button type="button" class="seg-b" data-ctab="nt" role="tab">📚 Materiallar</button>
    </div>
    <section class="card stack" data-cpane="st">
      ${needsSql ? '<p class="notice">Şəxsi linklər üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>005_student_links.sql</strong> → Run.</p>' : ''}
      ${students.length ? `<div class="row between"><p class="small muted" style="margin:0">${hasCodes ? 'Hər tələbənin öz linki var: <strong>Linki göndər</strong> basın, mesajda göndərin. Tələbə testləri orada yazır, nəticəsini görür. Ada basanda bütün işləri açılır.' : 'Ada basanda tələbənin bütün işləri açılır.'}</p>
          ${hasCodes ? '<button class="btn small" id="allLinks">Bütün linkləri kopyala</button>' : ''}</div>
        <div class="slist">${students.map((s) => { const a = avgOf(s.id); return `<div class="srow">
          <a class="s-name" href="#/student/${s.id}"><strong>${esc(s.full_name)}</strong>${s.access_code ? `<span class="small muted">kod: <span class="mono">${esc(s.access_code)}</span></span>` : ''}</a>
          <span class="s-res">${pctChip(a)}<span class="small muted">${per[s.id] ? per[s.id].n + ' test' : 'hələ test yox'}</span></span>
          <span class="s-act">
            ${s.access_code ? `<button class="btn small primary" data-share="${s.id}">Linki göndər</button>
            <a class="btn small" href="${esc(studentLink(s.access_code))}" target="_blank" rel="noopener">Bax</a>` : ''}
            <details class="more" data-more="${s.id}"><summary class="btn small" aria-label="${esc(s.full_name)}: digər">⋯</summary><div class="more-menu">
              ${s.access_code ? `<button class="btn small" data-recode="${s.id}" title="Köhnə link işləməyəcək">Yeni link yarat</button>` : ''}
              <button class="btn small danger" data-del="${s.id}" aria-label="${esc(s.full_name)} sil">Siyahıdan sil</button></div></details>
          </span></div>`; }).join('')}</div>`
        : '<div class="empty">Siyahı boşdur. Yuxarıda tələbə adlarını yazın.</div>'}
    </section>
    <section class="card stack" data-cpane="ts" hidden>
      <div class="row between"><h2>Bu qrupun testləri</h2><a class="btn small primary" href="#/newtest">+ Yeni test</a></div>
      ${(tests || []).length ? `<div class="mtlist">${tests.map((t) => { const target = t.student_id ? 1 : students.length; const sent = perTest[t.id] || 0;
        return `<a class="mtrow" href="#/test/${t.id}"><span class="tc-status ${t.is_open ? 'on' : ''}">${t.is_open ? 'Açıq' : 'Bağlı'}</span>
          <span class="mt-title">${esc(t.title)}${t.student_id ? ` <span class="tag book">fərdi: ${esc((students.find((x) => x.id === t.student_id) || {}).full_name || 'tələbə')}</span>` : ''}</span>
          <span class="small muted">${sent} / ${target} göndərib</span><span class="mt-go">›</span></a>`; }).join('')}</div>`
        : '<div class="empty">Hələ test yoxdur.</div>'}
    </section>
    <section class="card stack" data-cpane="nt" hidden id="ntPane"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">Yüklənir…</span></div></section>
    <section class="card stack" data-cpane="pl" hidden id="plPane"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">Yüklənir…</span></div></section>
    <section class="card stack" data-cpane="mk" hidden id="mkPane"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">Yüklənir…</span></div></section>
    <details class="danger-zone"><summary>Qrupu silmək</summary><p class="small muted">Qrup silinir; tələbələr «Qrupsuz» siyahısına keçir, nəticələri və testlər qalır.</p><button class="btn danger" id="delClass">Qrupu sil</button></details>`;
  let mkLoaded = false; let ntLoaded = false; let plLoaded = false;
  schedEditor($('#schedBox'), cls);
  $('#saveExam').onclick = () => busy($('#saveExam'), async () => {
    const v = $('#examDate').value || null;
    const { error: e2 } = await sb.from('classes').update({ exam_date: v }).eq('id', id);
    if (e2) throw needSql(e2, '012_student_insights.sql');
    $('#examLeft').textContent = v ? daysLeftText(v) : 'Tarix silindi.';
    cls.exam_date = v;
    if (plLoaded) classPlan($('#plPane'), cls, students, tests || []).catch(fail);
    toast('Yadda saxlandı');
  }).catch(fail);
  $$('[data-ctab]').forEach((b) => b.onclick = () => {
    $$('[data-ctab]').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-cpane]').forEach((p) => { p.hidden = p.dataset.cpane !== b.dataset.ctab; });
    if (b.dataset.ctab === 'nt' && !ntLoaded) { ntLoaded = true; classNotes($('#ntPane'), cls, students).catch((err) => { $('#ntPane').innerHTML = `<p class="notice">${esc(err.message)}</p>`; }); }
    if (b.dataset.ctab === 'pl' && !plLoaded) { plLoaded = true; classPlan($('#plPane'), cls, students, tests || []).catch((err) => { $('#plPane').innerHTML = `<p class="notice">${esc(err.message)}</p>`; }); }
    if (b.dataset.ctab === 'mk' && !mkLoaded) { mkLoaded = true; classMistakes($('#mkPane'), students).catch((err) => { $('#mkPane').innerHTML = `<p class="notice">${esc(err.message)}</p>`; }); }
  });
  $('#showAdd').onclick = () => { $('#addStudents').hidden = false; $('textarea', $('#addStudents')).focus(); };
  $('#hideAdd') && ($('#hideAdd').onclick = () => { $('#addStudents').hidden = true; });
  const byId = Object.fromEntries(students.map((s) => [s.id, s]));
  const msgFor = (s) => `${s.full_name}, bu sənin şəxsi Math Saleh Hoca linkindir. Testləri buradan yaz, nəticələrini də burada görəcəksən:\n${studentLink(s.access_code)}`;
  $$('[data-share]').forEach((b) => b.onclick = () => shareText(msgFor(byId[b.dataset.share]), 'Link kopyalandı'));
  $('#allLinks') && ($('#allLinks').onclick = () => copyText(
    `${cls.name} · şəxsi linklər\n\n` + students.map((s) => `${s.full_name}: ${studentLink(s.access_code)}`).join('\n'), 'Bütün linklər kopyalandı'));
  $$('[data-recode]').forEach((b) => b.onclick = async () => {
    if (!confirm(`${byId[b.dataset.recode].full_name} üçün yeni link yaradılsın? Köhnə link daha işləməyəcək, nəticələr qalacaq.`)) return;
    const { error: err } = await sb.from('students').update({ access_code: newCode() }).eq('id', b.dataset.recode);
    if (err) return fail(err);
    toast('Yeni link yaradıldı');
    route();
  });
  $('#addStudents').onsubmit = (e) => {
    e.preventDefault();
    const names = new FormData(e.target).get('names').split('\n').map((n) => n.trim()).filter(Boolean).slice(0, 200);
    if (!names.length) return toast('Ən azı bir ad yazın', true);
    busy($('button', e.target), async () => {
      const { error: err } = await sb.from('students').insert(names.map((n) => ({ class_id: id, full_name: n.slice(0, 80) })));
      if (err) throw err;
      toast(names.length + ' tələbə əlavə olundu');
      route();
    }).catch(fail);
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm(`${byId[b.dataset.del].full_name} silinsin? Onun göndərdiyi nəticələr qalacaq.`)) return;
    const { error: err } = await sb.from('students').delete().eq('id', b.dataset.del);
    if (err) return fail(err);
    route();
  });
  $('#delClass').onclick = () => busy($('#delClass'), async () => { if (await deleteGroup(cls, students.length)) go('#/classes'); }).catch(fail);
  $('#renClass').onclick = () => renameGroup(cls).catch(fail);
}

// ================= Sual bankı =================

// ---- Böyük bank üçün: əvvəl yüngül indeks (şəkilsiz), görünən suallar üçün tam sətir ----
const Q_LIGHT = 'id, body, topic, subtype, source, difficulty, exam, qtype, options, answer, ai_status, verified, teacher_approved, created_at';
let hasSimilarCol = true; // 010 işlədilməyibsə similar_to sütunu yoxdur
async function loadQuestionIndex() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let { data, error } = await sb.from('questions').select(Q_LIGHT + (hasSimilarCol ? ', similar_to' : '')).order('created_at', { ascending: false }).range(from, from + 999);
    if (error && hasSimilarCol && /similar_to/.test(error.message || '')) {
      hasSimilarCol = false;
      ({ data, error } = await sb.from('questions').select(Q_LIGHT).order('created_at', { ascending: false }).range(from, from + 999));
    }
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const fullCache = new Map();
async function fullQuestions(ids) {
  const need = ids.filter((id) => !fullCache.has(id));
  for (let i = 0; i < need.length; i += 150) {
    const { data, error } = await sb.from('questions').select('*').in('id', need.slice(i, i + 150));
    if (error) throw error;
    (data || []).forEach((q) => fullCache.set(q.id, q));
  }
  return ids.map((id) => fullCache.get(id)).filter(Boolean);
}
const PAGE = 50;

// Sualların real nəticəsi (013): { id: { attempts, right } }; baza köhnədirsə boş
async function loadQuestionStats() {
  try {
    const { data, error } = await sb.rpc('question_stats');
    if (error || !Array.isArray(data)) return {};
    return Object.fromEntries(data.map((r) => [r.question_id, { attempts: r.attempts, right: r.right_count }]));
  } catch (_) { return {}; }
}
const REAL_MIN = 3; // ən azı neçə cavabdan sonra real çətinlik hesablanır
const realDiff = (st) => (!st || st.attempts < REAL_MIN ? null : st.right / st.attempts >= 0.7 ? 'asan' : st.right / st.attempts >= 0.4 ? 'orta' : 'çətin');
const statLine = (st) => (st && st.attempts ? `📊 ${Math.round(st.right / st.attempts * 100)}% düz · ${st.attempts} cavab` : '');

// Bankdakı kiçik kart: toxunanda böyüyür
function bankTile(q, n, checked, qs) {
  const st = q.teacher_approved ? ['ok', '✔ Təsdiqlənib']
    : (q.ai_status === 'passed' || (!q.ai_status && q.verified === true)) ? ['wait', 'Təsdiq gözləyir']
    : (q.ai_status === 'review' || q.ai_status === 'draft' || (!q.ai_status && q.verified === false)) ? ['bad', 'Yoxlama lazımdır'] : null;
  const opts = q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length && !hasOptionFigures(q)
    ? `<span class="qt-opts">${q.options.slice(0, 6).map((o, i) => `<span>${'ABCDEF'[i]}) ${esc(String(o).slice(0, 40))}</span>`).join('')}</span>` : '';
  const fig = q.figure ? `<span class="qt-fig">${safeSvg(q.figure)}</span>` : hasOptionFigures(q) ? '<span class="qt-figtag">şəkilli variantlar</span>' : '';
  return `<div class="qtile${checked ? ' picked' : ''}">
    <button type="button" class="qt-open" data-open="${esc(q.id)}" aria-label="Sual ${n} — böyüt">
      <span class="qt-head"><span class="qt-n">#${n}</span>${st ? `<span class="qt-st ${st[0]}">${st[1]}</span>` : ''}</span>
      <span class="qt-text">${esc(q.body)}</span>
      ${fig}${opts}
      ${qs && qs.attempts ? `<span class="qt-stat">${statLine(qs)}${realDiff(qs) && realDiff(qs) !== q.difficulty ? ` · <strong>real: ${realDiff(qs)}</strong>` : ''}</span>` : ''}
      <span class="qt-meta">${q.similar_to ? '<span class="qt-sim" title="Səhv dəftəri üçün bənzər">↔ bənzər</span>' : ''}${q.topic ? `<span class="qt-topic">${esc(q.topic)}</span>` : ''}${q.difficulty ? `<span>${esc(q.difficulty)}</span>` : ''}${q.exam === 'tryos' ? '<span>TR-YÖS</span>' : ''}</span>
    </button>
    <label class="qt-check"><input type="checkbox" class="check" data-id="${esc(q.id)}" ${checked ? 'checked' : ''} aria-label="Sual ${n} seç"></label>
  </div>`;
}

async function bankView() {
  const [data, stats] = await Promise.all([loadQuestionIndex(), loadQuestionStats()]);
  let filter = { text: '', source: '', difficulty: '', exam: '', status: '', real: '' };
  let visible = [];
  let shown = PAGE;
  const selected = new Set();

  view().innerHTML = `
    <div class="page-head"><div><h1>Sual bankı</h1><p class="muted">${data.length} sual. Suala basın — böyüyəcək. Küncdəki qutu ilə seçin.</p></div>
      <div class="row"><button class="btn" id="toggleManual">+ Əl ilə sual</button><button class="btn" id="selAll">Görünənləri seç</button><button class="btn" id="selNone" hidden>Seçimi təmizlə</button><button class="btn danger" id="delSel" hidden>🗑 Sil (0)</button><button class="btn" id="makePdf" disabled>PDF (0)</button><button class="btn primary" id="makeTest" disabled>Seçilənlərdən test (0)</button></div></div>
    <form class="card stack" id="manual" hidden></form>
    <div class="card stack">
      <div class="form-grid bank-filters">
        <label class="field search">Axtar<input type="search" id="fText" placeholder="mətn və ya mövzu"></label>
        <label class="field">Mənbə<select id="fSource"><option value="">Hamısı</option><option value="ai">AI</option><option value="book">Kitabdan</option><option value="manual">Əl ilə</option><option value="similar">Səhv dəftəri bənzərləri</option></select></label>
        <label class="field">Çətinlik<select id="fDiff"><option value="">Hamısı</option>${DIFF.map((d) => `<option>${d}</option>`).join('')}</select></label>
        <label class="field">Format<select id="fExam"><option value="">Hamısı</option><option value="tryos">TR-YÖS</option><option value="general">Ümumi</option></select></label>
        <label class="field">Status<select id="fStatus"><option value="">Hamısı</option><option value="approved">Müəllim təsdiqləyib</option><option value="passed">AI keçib, təsdiq gözləyir</option><option value="review">Yoxlama tələb edir / qaralama</option></select></label>
        <label class="field">Real çətinlik<select id="fReal"><option value="">Hamısı</option><option value="asan">asan (70%+ düz)</option><option value="orta">orta (40–70%)</option><option value="çətin">çətin (40%-dən az)</option><option value="none">hələ az cavab</option></select></label>
      </div>
      <div id="realBox"></div>
      <p class="small muted" id="shownInfo"></p>
      <div id="list"></div>
      <div id="more"></div>
    </div>`;

  let renderSeq = 0;
  const renderList = async () => {
    const seq = ++renderSeq;
    const t = filter.text.toLocaleLowerCase('az');
    const rows = data.filter((q) => (!filter.source || (filter.source === 'similar' ? !!q.similar_to : q.source === filter.source)) && (!filter.difficulty || q.difficulty === filter.difficulty)
      && (!filter.exam || (q.exam || 'general') === filter.exam)
      && (!filter.status || (filter.status === 'approved' ? q.teacher_approved : filter.status === 'passed' ? (!q.teacher_approved && (q.ai_status === 'passed' || (!q.ai_status && q.verified === true))) : (!q.teacher_approved && (q.ai_status === 'review' || q.ai_status === 'draft' || (!q.ai_status && q.verified === false)))))
      && (!filter.real || (filter.real === 'none' ? !realDiff(stats[q.id]) : realDiff(stats[q.id]) === filter.real))
      && (!t || (q.body + ' ' + (q.topic || '') + ' ' + (q.subtype || '')).toLocaleLowerCase('az').includes(t)));
    visible = rows;
    const page = rows.slice(0, shown);
    let full;
    try { full = await fullQuestions(page.map((q) => q.id)); } catch (err) { return fail(err); }
    if (seq !== renderSeq || !$('#shownInfo')) return; // daha yeni axtarış başlayıb və ya səhifə dəyişib
    const byId = Object.fromEntries(full.map((q) => [q.id, { ...q, teacher_approved: data.find((d) => d.id === q.id)?.teacher_approved }]));
    $('#shownInfo').textContent = rows.length > page.length ? `${rows.length} uyğun sualdan ${page.length} göstərilir` : (rows.length && rows.length !== data.length ? `${rows.length} uyğun sual` : '');
    $('#list').innerHTML = rows.length
      ? `<div class="qgrid">${page.map((q, i) => bankTile(byId[q.id] || q, i + 1, selected.has(q.id), stats[q.id])).join('')}</div>`
      : `<div class="empty">${data.length ? 'Uyğun sual tapılmadı.' : 'Bank boşdur. <a href="#/pdf">Kitabdan</a> və ya <a href="#/ai">AI ilə</a> sual əlavə edin.'}</div>`;
    $('#more').innerHTML = rows.length > page.length ? `<button class="btn block" id="moreBtn">Daha çox göstər (${rows.length - page.length} qalıb)</button>` : '';
    if ($('#moreBtn')) $('#moreBtn').onclick = () => { shown += PAGE; renderList(); };
    $$('#list .check').forEach((c) => c.onchange = () => { c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id); c.closest('.qtile').classList.toggle('picked', c.checked); updateBtn(); });
    $$('#list [data-open]').forEach((b) => b.onclick = () => openBankQ(b.dataset.open).catch(fail));
  };
  // Böyük pəncərə: bir sual, əvvəlki/sonrakı, təsdiq, seçim, silmə
  const openBankQ = async (id) => {
    const idx = visible.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const [full] = await fullQuestions([id]);
    const meta = data.find((x) => x.id === id);
    const q = { ...(full || meta), teacher_approved: meta.teacher_approved };
    let dlg = document.getElementById('bankDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'bankDlg';
      dlg.className = 'q-dialog';
      $app.appendChild(dlg);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
    dlg.onclose = () => renderList();
    const sel = selected.has(id);
    dlg.innerHTML = `<div class="q-dialog-in">
      <div class="row between"><h2>Sual ${idx + 1} / ${visible.length}</h2><button type="button" class="btn small" data-close aria-label="Bağla">✕ Bağla</button></div>
      ${!q.teacher_approved && (q.ai_status === 'draft' || q.ai_status === 'review') ? '<p class="notice">AI yoxlaması keçməyib. Sualı, cavabı və həlli özünüz yoxlayın; düzgündürsə təsdiqləyin.</p>' : ''}
      ${stats[id]?.attempts ? `<p class="small"><strong>${statLine(stats[id])}</strong>${realDiff(stats[id]) ? ` · real çətinlik: <strong>${realDiff(stats[id])}</strong>` : ` · real çətinlik üçün ən azı ${REAL_MIN} cavab lazımdır`}</p>` : ''}
      <div class="dlg-q">${questionHtml(q)}</div>
      <div class="dlg-foot">
        <div class="row"><button type="button" class="btn" data-nav="-1" ${visible.length < 2 ? 'disabled' : ''}>‹ Əvvəlki</button><button type="button" class="btn" data-nav="1" ${visible.length < 2 ? 'disabled' : ''}>Sonrakı ›</button></div>
        <div class="row"><button type="button" class="btn danger" data-del>Sil</button>
          <button type="button" class="btn ${q.teacher_approved ? '' : 'ok'}" data-approve>${q.teacher_approved ? 'Təsdiqi götür' : '✔ Təsdiqlə'}</button>
          <button type="button" class="btn primary" data-pick>${sel ? '✓ Seçilib' : 'Seç'}</button></div>
      </div></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    $$('[data-nav]', dlg).forEach((b) => b.onclick = () => openBankQ(visible[(idx + +b.dataset.nav + visible.length) % visible.length].id).catch(fail));
    $('[data-pick]', dlg).onclick = () => { sel ? selected.delete(id) : selected.add(id); updateBtn(); openBankQ(id).catch(fail); };
    $('[data-approve]', dlg).onclick = async () => {
      const { error: err } = await sb.from('questions').update({ teacher_approved: !meta.teacher_approved }).eq('id', id);
      if (err) return fail(/column|schema cache/i.test(err.message || '') ? new Error('Baza yenilənməyib: supabase/004_status.sql faylını işə salın.') : err);
      meta.teacher_approved = !meta.teacher_approved;
      toast(meta.teacher_approved ? 'Təsdiqləndi' : 'Təsdiq götürüldü');
      openBankQ(id).catch(fail);
    };
    $('[data-del]', dlg).onclick = async () => {
      if (!confirm('Sual silinsin?')) return;
      const { error: err } = await sb.from('questions').delete().eq('id', id);
      if (err) return fail(err);
      data.splice(data.findIndex((x) => x.id === id), 1);
      selected.delete(id);
      updateBtn(); dlg.close();
    };
    if (!dlg.open) dlg.showModal();
  };
  const updateBtn = () => {
    const b = $('#makeTest'); b.disabled = !selected.size; b.textContent = `Seçilənlərdən test (${selected.size})`;
    const pdf = $('#makePdf'); pdf.disabled = !selected.size; pdf.textContent = `PDF (${selected.size})`;
    const del = $('#delSel'); del.hidden = !selected.size; del.textContent = `🗑 Sil (${selected.size})`;
    $('#selNone').hidden = !selected.size;
  };
  const refilter = () => { shown = PAGE; renderList(); };
  $('#fText').oninput = (e) => { filter.text = e.target.value; refilter(); };
  $('#fSource').onchange = (e) => { filter.source = e.target.value; refilter(); };
  $('#fDiff').onchange = (e) => { filter.difficulty = e.target.value; refilter(); };
  $('#makeTest').onclick = () => { pendingTestIds = [...selected]; go('#/newtest'); };
  $('#fExam').onchange = (e) => { filter.exam = e.target.value; refilter(); };
  $('#fStatus').onchange = (e) => { filter.status = e.target.value; refilter(); };
  $('#fReal').onchange = (e) => { filter.real = e.target.value; refilter(); };
  // AI-ın qoyduğu çətinlik real nəticədən fərqlidirsə, bir düymə ilə yenilə
  const drawReal = () => {
    const diff = data.filter((q) => realDiff(stats[q.id]) && realDiff(stats[q.id]) !== q.difficulty);
    const withData = data.filter((q) => realDiff(stats[q.id])).length;
    $('#realBox').innerHTML = withData ? `<div class="real-box"><span>📊 <strong>${withData}</strong> sualın real nəticəsi var (tələbələrin cavablarından)${diff.length ? `; <strong>${diff.length}</strong> sualda çətinlik real nəticədən fərqlidir.` : ' — hamısının çətinliyi düzgündür.'}</span>
      ${diff.length ? `<button type="button" class="btn small primary" id="realFix">Çətinliyi real nəticəyə görə yenilə (${diff.length})</button>` : ''}</div>` : '';
    const btn = $('#realFix');
    if (btn) btn.onclick = () => busy(btn, async () => {
      for (const d of DIFF) {
        const ids = diff.filter((q) => realDiff(stats[q.id]) === d).map((q) => q.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await sb.from('questions').update({ difficulty: d }).in('id', ids.slice(i, i + 200));
          if (error) throw error;
        }
      }
      diff.forEach((q) => { q.difficulty = realDiff(stats[q.id]); fullCache.delete(q.id); });
      toast(diff.length + ' sualın çətinliyi yeniləndi');
      drawReal(); renderList();
    }).catch(fail);
  };
  drawReal();
  $('#selAll').onclick = () => { visible.forEach((q) => selected.add(q.id)); updateBtn(); renderList(); };
  $('#selNone').onclick = () => { selected.clear(); updateBtn(); renderList(); };
  $('#delSel').onclick = () => busy($('#delSel'), async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const { data: ts } = await sb.from('tests').select('id, question_ids');
    const inTests = ids.filter((id) => (ts || []).some((t) => (t.question_ids || []).includes(id))).length;
    if (!confirm(`${ids.length} sual bankdan silinsin?${inTests ? `\n\n${inTests} sual testlərdə istifadə olunur — həmin testlərdən də çıxacaq (nəticələr qalır).` : ''}\nBunu geri qaytarmaq olmur.`)) return;
    for (let i = 0; i < ids.length; i += 200) {
      const { error: err } = await sb.from('questions').delete().in('id', ids.slice(i, i + 200));
      if (err) throw err;
    }
    const gone = new Set(ids);
    for (let i = data.length - 1; i >= 0; i--) if (gone.has(data[i].id)) data.splice(i, 1);
    ids.forEach((id) => fullCache.delete(id));
    selected.clear();
    toast(ids.length + ' sual silindi');
    updateBtn(); renderList();
    const h = $('.page-head p'); if (h) h.textContent = `${data.length} sual. Suala basın — böyüyəcək. Küncdəki qutu ilə seçin.`;
  }).catch(fail);
  $('#makePdf').onclick = () => busy($('#makePdf'), async () => {
    // görünən sıra saxlanılır (köhnədən yeniyə)
    const ids = data.filter((q) => selected.has(q.id)).map((q) => q.id).reverse();
    pendingPrint = { questions: await fullQuestions(ids), title: '', back: '#/bank' };
    go('#/print');
  }).catch(fail);
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
  const t0 = Date.now();
  const rows = list.map((q, i) => {
    const row = {
      created_at: new Date(t0 + i).toISOString(), // sıra qorunsun
      body: q.body, qtype: q.qtype, options: q.options || [], answer: q.answer, solution: q.solution || null,
      topic: q.topic || null, grade: q.grade || null, difficulty: DIFF.includes(q.difficulty) ? q.difficulty : 'orta', source
    };
    // Yeni sahələr yalnız lazım olanda göndərilir (köhnə baza ilə də işləsin)
    if (q.exam && q.exam !== 'general') row.exam = q.exam;
    if (q.figure) row.figure = q.figure;
    if (hasOptionFigures(q)) row.option_figures = q.option_figures;
    if (q.section) row.section = q.section;
    if (q.subtype) row.subtype = q.subtype;
    if (q.model) row.model = q.model;
    if (q.similar_to) row.similar_to = q.similar_to;
    if (q.ai_status && q.ai_status !== 'checking') {
      row.ai_status = q.ai_status === 'passed' ? 'passed' : q.ai_status === 'draft' ? 'draft' : 'review';
      row.verified = row.ai_status === 'passed';
      row.verify_note = q.verify_note || null;
      row.fit_ok = typeof q.fit_ok === 'boolean' ? q.fit_ok : null;
      row.fit_note = q.fit_note || null;
    } else if (typeof q.verified === 'boolean') { row.verified = q.verified; row.verify_note = q.verify_note || null; }
    if (q.teacher_approved) row.teacher_approved = true;
    return row;
  });
  // Toplu yazılışda bütün sətirlər eyni sütunlara malik olmalıdır, çatışmayanlar standart dəyərlə doldurulur
  const DEFAULTS = { exam: 'general', figure: null, option_figures: [], section: null, subtype: null, model: null, verified: null, verify_note: null, ai_status: null, fit_ok: null, fit_note: null, teacher_approved: false };
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  rows.forEach((r) => keys.forEach((k) => { if (!(k in r)) r[k] = k in DEFAULTS ? DEFAULTS[k] : null; }));
  const { data: saved, error } = await sb.from('questions').insert(rows).select('id');
  if (error) {
    if (/column .* does not exist|schema cache/i.test(error.message || '')) {
      throw new Error('Baza yenilənməyib: Supabase SQL Editor-də supabase/004_status.sql faylını işə salın.');
    }
    throw error;
  }
  return (saved || []).map((r) => r.id);
}

// ================= Şəkil / PDF seçici (kəsmə ilə) =================
// root içinə "Şəkil və ya PDF seç" düyməsi, PDF səhifə keçidi və barmaqla çərçivə çəkmə qurur.
function createPicker(root, { hint = '', label = 'Şəkil və ya PDF seç', actions, onCrop } = {}) {
  const st = { img: null, scale: 1, sel: null, pdf: null, page: 1 };
  const uid = 'p' + Math.random().toString(36).slice(2, 8);
  root.innerHTML = `<label class="btn primary" style="align-self:flex-start">${label}<input type="file" accept="image/*,application/pdf,.pdf" class="sr" id="${uid}-file"></label>
    <div id="${uid}-area" class="muted small">${esc(hint)}</div>`;
  const area = () => document.getElementById(uid + '-area');

  const api = {
    hasImage: () => !!st.img,
    hasSelection: () => !!st.sel,
    // box: [x, y, en, hündürlük] faizlə (AI-ın tapdığı sual yeri)
    dataUrlBox(box, maxSide = 1100) {
      const pad = 3;
      const x = Math.max(0, box[0] - pad), y = Math.max(0, box[1] - pad);
      const w = Math.min(100 - x, box[2] + pad * 2), h = Math.min(100 - y, box[3] + pad * 2);
      const W = st.img.width, H = st.img.height;
      return api.cropUrl(x / 100 * W, y / 100 * H, w / 100 * W, h / 100 * H, maxSide);
    },
    cropUrl(sx, sy, sw, sh, maxSide = 1600) {
      const out = Math.min(1, maxSide / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * out)); c.height = Math.max(1, Math.round(sh * out));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(st.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.86);
    },
    dataUrl(maxSide = 1600) {
      const s = st.sel;
      const sx = s ? s.x / st.scale : 0, sy = s ? s.y / st.scale : 0;
      const sw = s ? s.w / st.scale : st.img.width, sh = s ? s.h / st.scale : st.img.height;
      if (maxSide !== 1600) return api.cropUrl(sx, sy, sw, sh, maxSide);
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
    st.pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
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
    const nav = st.pdf ? `<div class="row" style="flex-wrap:nowrap">
        <button type="button" class="btn small" data-nav="-1" aria-label="Əvvəlki səhifə" ${st.page <= 1 ? 'disabled' : ''}>‹</button>
        <label class="row small" style="gap:6px">Səhifə <input type="number" data-page min="1" max="${st.pdf.numPages}" value="${st.page}" style="width:84px;min-height:36px;padding:4px 8px"> / ${st.pdf.numPages}</label>
        <button type="button" class="btn small" data-nav="1" aria-label="Növbəti səhifə" ${st.page >= st.pdf.numPages ? 'disabled' : ''}>›</button>
      </div>` : '';
    area().innerHTML = `<div class="picker-bar">${nav}<div class="row" data-actions>${onCrop ? '' : '<button type="button" class="btn" data-clear>Çərçivəni sil</button>'}</div></div>
      <div class="crop-wrap"><canvas width="${Math.round(st.img.width * scale)}" height="${Math.round(st.img.height * scale)}"></canvas><div class="crop-box" id="${uid}-box"></div></div>`;
    const cv = $('canvas', area());
    cv.getContext('2d').drawImage(st.img, 0, 0, cv.width, cv.height);
    bindCrop(cv);
    const clr = $('[data-clear]', area());
    if (clr) clr.onclick = () => api.clearSelection();
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
      else if (onCrop) onCrop(api);
      start = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  return api;
}

// ================= AI ilə sual =================

const TRYOS_TOPICS = {
  matematik: ['Sayılar', 'Rasyonel sayılar', 'Birbirine bağlı değişkenler ve denklemler', 'Üslü sayılar', 'Köklü sayılar',
    'Basit eşitsizlikler', 'Mutlak değer', 'Çarpanlara ayırma', 'Oran-orantı', 'Faktöriyel', 'Kümeler ve Venn şemaları',
    'Fonksiyonlar', 'Polinomlar'],
  sayisal: ['Sayı ve sembol tablolarında eksik değer', 'Satır-sütun ve bölgeler arası ilişkiler', 'Terazi, eşitlik ve şekil değerleri',
    'İşlem makineleri ve giriş-çıkış şemaları', 'Kurala dayalı özel işlemler', 'Sayı yerleştirme ve koşullu dizilişler',
    'Şekil dizileri ve matris tamamlama', 'Döndürme, yansıma, konum değiştirme', 'Parça-bütün, birleştirme ve kesme',
    'Kâğıt katlama ve kesme', 'Denklem eşleştirme']
};

// Nümunələr və nəticələr səhifədən çıxanda da yaddaşda qalsın (bu sessiya ərzində)
const tyState = { tab: 'examples', samples: [], groups: [], mode: 'benzer', per: 1, notes: '', running: false };
let sampleSeq = 0;

// Kiçik iş növbəsi: eyni anda ən çox n AI sorğusu
function makeQueue(n) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= n || !waiting.length) return;
    active++;
    const { fn, ok, ko } = waiting.shift();
    fn().then(ok, ko).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((ok, ko) => { waiting.push({ fn, ok, ko }); next(); });
}
const extractQueue = makeQueue(3);

async function aiView() {
  view().innerHTML = `
    <div class="page-head"><div><h1>AI ilə sual yarat</h1><p class="muted">Nümunə suallardan, mövzudan və ya məktəb proqramından.</p></div>${modelPicker()}</div>
    <div class="tabs" role="tablist" aria-label="Rejim">
      <button type="button" role="tab" data-tab="examples">Nümunədən yarat</button>
      <button type="button" role="tab" data-tab="topic">Mövzudan yarat</button>
      <button type="button" role="tab" data-tab="general">Məktəb (ümumi)</button>
      <button type="button" role="tab" data-tab="rewrite">✍️ Yaz və çevir</button>
    </div>
    <div id="tabExamples" class="stack"></div>
    <div id="tabBody" class="stack" hidden></div>`;
  let examplesBuilt = false;
  const setTab = (t) => {
    tyState.tab = t;
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $('#tabExamples').hidden = t !== 'examples';
    $('#tabBody').hidden = t === 'examples';
    if (t === 'examples') { if (!examplesBuilt) { examplesTab(); examplesBuilt = true; } }
    else if (t === 'topic') topicTab();
    else if (t === 'rewrite') rewriteTab();
    else generalTab();
    bindModelPicker(view());
  };
  $$('[data-tab]').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  bindModelPicker(view());
  setTab(tyState.tab);
}

// ---------------- 1. Nümunədən yarat ----------------
const MAX_PER_SAMPLE = 5;   // hər nümunəyə ən çox neçə yeni sual
const CHUNK = 2;            // bir sorğuda ən çox neçə sual (uzun SVG-lər kəsilməsin)
const AUTO_RETRY = 1;       // yoxlamadan keçməyən sual üçün avtomatik yenidən yaratma cəhdi
let qSeq = 0;

function examplesTab() {
  $('#tabExamples').innerHTML = `
    <section class="card stack">
      <div class="step-h"><span class="step-n">1</span><div><h2>Nümunə sualları seçin</h2>
        <p class="muted small">PDF və ya şəkil açın. Sualın üstündən barmaqla çərçivə çəkin, <b>barmağı qaldıran kimi əlavə olunur</b>. Ya da <b>Səhifədəki bütün suallar</b> basın. Çərçivəyə sualın şərti, bütün kadrları və bütün variantları daxil olsun.</p></div></div>
      <div id="exPicker" class="stack" style="gap:10px"></div>
    </section>
    <section class="card stack" id="samplesCard"></section>
    <section class="card stack">
      <div class="step-h"><span class="step-n">3</span><div><h2>Necə yaradılsın?</h2></div></div>
      <div class="pills" role="radiogroup" aria-label="Yaratma rejimi">
        <button type="button" class="pill-opt" role="radio" data-mode="izomorf"><strong>İzomorf</strong><span>Eyni quruluş və həll; yalnız rəqəmlər, simvollar, başlanğıc vəziyyət dəyişir</span></button>
        <button type="button" class="pill-opt" role="radio" data-mode="benzer"><strong>Bənzər</strong><span>Eyni sual ailəsi və təqdimat; yeni düzülüş və parametrlər</span></button>
        <button type="button" class="pill-opt" role="radio" data-mode="ferqli"><strong>Fərqli quruluş</strong><span>Eyni əsas bacarıq, yeni quruluş</span></button>
      </div>
      <div class="form-grid">
        <label class="field">Hər nümunəyə<select id="perSample">${Array.from({ length: MAX_PER_SAMPLE }, (_, i) => `<option value="${i + 1}">${i + 1} yeni sual</option>`).join('')}</select></label>
        <label class="field">Əlavə istək<span class="hint">istəyə bağlı</span><input type="text" id="exNotes" maxlength="800" placeholder="məs. variantlar tam ədəd olsun"></label>
      </div>
      <div class="run-row">${modelPicker()}<button class="btn primary" id="runEx"></button><span id="exProgress" class="muted small" role="status" aria-live="polite"></span></div>
    </section>
    <section id="exResults"></section>`;

  const syncMode = () => $$('[data-mode]').forEach((o) => o.setAttribute('aria-checked', String(o.dataset.mode === tyState.mode)));
  $$('[data-mode]').forEach((b) => b.onclick = () => { tyState.mode = b.dataset.mode; syncMode(); });
  syncMode();
  $('#perSample').value = String(tyState.per);
  $('#perSample').onchange = (e) => { tyState.per = +e.target.value; updateRunBtn(); };
  $('#exNotes').value = tyState.notes;
  $('#exNotes').oninput = (e) => { tyState.notes = e.target.value; };

  createPicker($('#exPicker'), {
    hint: 'PDF açıldıqdan sonra səhifələr arasında ‹ › ilə keçin.',
    onCrop: (picker) => {
      addSample({ image: picker.dataUrl(1600), origin: 'kəsik' });
      const boxEl = $('#exPicker .crop-box.on');
      if (boxEl) boxEl.classList.add('added');
      setTimeout(() => picker.clearSelection(), 450);
      toast('Nümunə ' + tyState.samples.length + ' əlavə olundu');
    },
    actions: (row, picker) => {
      row.insertAdjacentHTML('afterbegin', `<button type="button" class="btn" data-add-page>Səhifədəki bütün suallar</button>
        <span class="tag" data-count>${tyState.samples.length} seçilib</span>`);
      $('[data-add-page]', row).onclick = (e) => busy(e.currentTarget, async () => {
        picker.clearSelection();
        const data = await callAI('extract', { image: picker.dataUrl(), split: true });
        let noBox = 0;
        data.questions.forEach((q) => {
          // Hər sual üçün orijinal səhifədən ayrıca, yüksək keyfiyyətli kəsik
          if (!q.box) { noBox++; return; }
          addSample({ image: picker.dataUrlBox(q.box, 1600), text: q.text, topic: q.topic, section: q.section, origin: 'səhifə' });
        });
        toast(`${data.questions.length - noBox} sual əlavə olundu` + (noBox ? ` · ${noBox} sualın yeri tapılmadı — onları əl ilə çərçivəyə alın` : ''), noBox > 0);
      }).catch(fail);
    }
  });

  renderSamples();
  renderGroups();
  updateRunBtn();
  $('#runEx').onclick = (e) => busy(e.currentTarget, runExamples).catch((err) => { tyState.running = false; progress('', 'exProgress'); updateRunBtn(); fail(err); });
}

// Şəklin ölçüsünü öyrən (oxunaqlılıq yoxlaması üçün)
function imageSize(src) {
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => ok({ w: 0, h: 0 });
    im.src = src;
  });
}

// Nümunə statusları: reading → ready | uncertain (müəllim təsdiqi lazımdır) | incomplete (yenidən kəsmək lazımdır) | error
function addSample({ image, text = '', topic = '', section = '', origin = '' }) {
  const smp = { id: ++sampleSeq, image, text, topic, section, origin, status: 'reading', error: '', analysis: null, warnings: [], confirmed: false };
  tyState.samples.push(smp);
  extractQueue(async () => {
    const size = image ? await imageSize(image) : { w: 0, h: 0 };
    const d = await callAI('tryos_analyze', { image, text, topic, section });
    smp.text = d.text || text;
    smp.analysis = d.analysis;
    smp.topic = topic || d.analysis.topic;
    smp.section = section || d.analysis.section;
    const a = d.analysis;
    smp.warnings = [];
    if (image && Math.min(size.w, size.h) < 160) smp.warnings.push('kəsik çox kiçikdir — böyüdüb yenidən seçin');
    if (a.conflict) smp.warnings.push('ziddiyyət: ' + a.conflict);
    (a.uncertain || []).forEach((u) => smp.warnings.push('qeyri-müəyyən: ' + u));
    if (topic && a.topic && topic.toLocaleLowerCase('tr') !== a.topic.toLocaleLowerCase('tr')) smp.warnings.push(`etiket "${topic}", şəkilə görə "${a.topic}"`);
    smp.status = !a.complete ? 'incomplete' : smp.warnings.length ? 'uncertain' : 'ready';
  }).catch((err) => { smp.status = 'error'; smp.error = err.message; })
    .finally(() => { if ($('#samplesCard')) { renderSamples(); updateRunBtn(); } });
  renderSamples();
  updateRunBtn();
}

const usableSample = (s) => s.status === 'ready' || (s.status === 'uncertain' && s.confirmed);

function renderSamples() {
  const cnt = $('#exPicker [data-count]');
  if (cnt) cnt.textContent = tyState.samples.length + ' seçilib';
  const card = $('#samplesCard');
  if (!card) return;
  const list = tyState.samples;
  const reading = list.filter((s) => s.status === 'reading').length;
  const label = { ready: ['ai', 'hazır'], reading: ['', 'analiz…'], error: ['red', 'oxunmadı'], incomplete: ['red', 'natamam kəsik'], uncertain: ['amber', 'qeyri-müəyyən'] };
  card.innerHTML = `<div class="step-h"><span class="step-n">2</span><div><h2>Seçilən nümunələr (${list.length})</h2>
      <p class="muted small">${list.length ? (reading ? `${reading} nümunə analiz olunur…` : 'Analizə baxmaq üçün “Analiz”-i açın.') : 'Hələ nümunə yoxdur.'}</p></div>
      ${list.length ? '<button type="button" class="btn small danger" id="clearSamples" style="margin-left:auto">Hamısını sil</button>' : ''}</div>
    ${list.length ? `<div class="sample-grid">${list.map((s, i) => { const [cls, txt] = label[s.status] || ['', s.status]; const a = s.analysis; return `<div class="sample ${s.status}">
        <div class="sample-top"><b>${i + 1}</b>
          <span class="tag ${cls}">${s.status === 'uncertain' && s.confirmed ? 'təsdiqləndi' : txt}</span>
          <button type="button" class="btn small" data-rm="${s.id}" aria-label="Nümunə ${i + 1}-i sil">✕</button></div>
        ${s.image ? `<img src="${s.image}" alt="Nümunə ${i + 1}">` : '<p class="small" style="color:var(--red)">Şəkil yoxdur</p>'}
        ${a ? `<div class="small"><b>${esc(a.family || '—')}</b></div>` : ''}
        ${s.status === 'incomplete' ? '<p class="small" style="color:var(--red)">Kəsik natamamdır: şərt, kadrlar və ya variantlar çatışmır. Bu nümunəni silin və sualı tam çərçivəyə alın.</p>' : ''}
        ${s.warnings.length ? `<ul class="small warn-list">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${s.status === 'uncertain' && !s.confirmed ? `<button type="button" class="btn small" data-confirm="${s.id}">Yoxladım, istifadə et</button>` : ''}
        ${a ? `<details><summary>Analiz</summary><div class="small analysis">
          <div><b>Bölmə / mövzu:</b> ${esc(a.section)} · ${esc(s.topic || a.topic)}</div>
          <div><b>Vizual:</b> ${esc(a.visual)}</div><div><b>Qayda:</b> ${esc(a.rule)}</div>
          <div><b>Tələb:</b> ${esc(a.student_task)}</div>
          <div><b>Qorunmalı:</b> ${esc((a.preserve || []).join('; '))}</div>
          <div><b>Dəyişə bilər:</b> ${esc((a.variable || []).join('; '))}</div></div></details>` : ''}
        ${s.text && s.status !== 'reading' ? `<details><summary>Mətn</summary><textarea data-txt="${s.id}" rows="4">${esc(s.text)}</textarea></details>` : ''}
        ${s.status === 'error' ? `<p class="small" style="color:var(--red)">${esc(s.error)}</p><button type="button" class="btn small" data-retry="${s.id}">Yenidən analiz et</button>` : ''}
      </div>`; }).join('')}</div>` : ''}`;
  $$('[data-rm]', card).forEach((b) => b.onclick = () => {
    tyState.samples = tyState.samples.filter((s) => s.id !== +b.dataset.rm);
    renderSamples(); updateRunBtn();
  });
  $$('[data-confirm]', card).forEach((b) => b.onclick = () => {
    const s = tyState.samples.find((x) => x.id === +b.dataset.confirm);
    if (s) s.confirmed = true;
    renderSamples(); updateRunBtn();
  });
  $$('[data-txt]', card).forEach((t) => t.oninput = () => { const s = tyState.samples.find((x) => x.id === +t.dataset.txt); if (s) s.text = t.value; });
  $$('[data-retry]', card).forEach((b) => b.onclick = () => {
    const s = tyState.samples.find((x) => x.id === +b.dataset.retry);
    tyState.samples = tyState.samples.filter((x) => x !== s);
    addSample({ image: s.image, text: s.text, topic: s.topic, section: s.section, origin: s.origin });
  });
  const clr = $('#clearSamples', card);
  if (clr) clr.onclick = () => { if (confirm('Bütün nümunələr silinsin?')) { tyState.samples = []; renderSamples(); updateRunBtn(); } };
}

function updateRunBtn() {
  const b = $('#runEx');
  if (!b || tyState.running) return;
  const ready = tyState.samples.filter(usableSample).length;
  b.disabled = !ready;
  b.innerHTML = `${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} ${ready ? ready * tyState.per + ' sual yarat' : 'Sual yarat'}`;
}

const progress = (t, id = 'progress') => { const el = document.getElementById(id); if (el) el.textContent = t || ''; };

// ---------- Yekun görüntünün çəkilməsi (yoxlayıcı istifadəçinin gördüyünü görsün) ----------
function svgSize(svg) {
  const m = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  return m ? { w: +m[3] || 300, h: +m[4] || 200 } : { w: 300, h: 200 };
}

function svgToCanvas(svg, targetW) {
  return new Promise((ok) => {
    const safe = safeSvg(svg);
    if (!safe) return ok(null);
    const { w, h } = svgSize(safe);
    const scale = targetW / w;
    const sized = safe.replace(/^<svg/, `<svg width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"`);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      try { ctx.drawImage(im, 0, 0, c.width, c.height); ok(c); } catch (_) { ok(null); }
    };
    im.onerror = () => ok(null);
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
  });
}

function inkRatio(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) ink++;
  return ink / (d.length / 16);
}

function thumb(c) {
  const t = document.createElement('canvas'); t.width = 32; t.height = 32;
  const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 32, 32); x.drawImage(c, 0, 0, 32, 32);
  const d = x.getImageData(0, 0, 32, 32).data; const g = [];
  for (let i = 0; i < d.length; i += 4) g.push((d[i] + d[i + 1] + d[i + 2]) / 3);
  return g;
}

// Qaytarır: { image (PNG data URL və ya null), problems: [bloklayan], notes: [xəbərdarlıq] }
async function renderQuestionImage(q) {
  const problems = [], notes = [];
  const figs = Array.isArray(q.option_figures) ? q.option_figures.filter(Boolean) : [];
  if (!q.figure && !figs.length) return { image: null, problems, notes };
  const main = q.figure ? await svgToCanvas(q.figure, 900) : null;
  if (q.figure) {
    if (!main) problems.push('əsas şəkil göstərilə bilmir');
    else if (inkRatio(main) < 0.003) problems.push('əsas şəkil boş görünür');
    if (svgRemovals.get(String(q.figure).trim())) notes.push('əsas şəkildən göstərilə bilməyən elementlər silindi');
  }
  const opts = await Promise.all(figs.map((f) => svgToCanvas(f, 200)));
  if (figs.length) {
    const nOpt = (q.options || []).length || 5;
    if (figs.length !== nOpt) problems.push(`variant şəkilləri natamamdır (${figs.length}/${nOpt})`);
    opts.forEach((c, i) => {
      if (!c) problems.push(`variant ${'ABCDE'[i]} göstərilə bilmir`);
      else if (inkRatio(c) < 0.003) problems.push(`variant ${'ABCDE'[i]} boş görünür`);
      if (svgRemovals.get(String(figs[i]).trim())) notes.push(`variant ${'ABCDE'[i]} şəklindən elementlər silindi`);
    });
    const th = opts.map((c) => (c ? thumb(c) : null));
    for (let i = 0; i < th.length; i++) for (let j = i + 1; j < th.length; j++) {
      if (!th[i] || !th[j]) continue;
      let diff = 0; for (let k = 0; k < th[i].length; k++) diff += Math.abs(th[i][k] - th[j][k]);
      if (diff / th[i].length < 2) problems.push(`variant ${'ABCDE'[i]} və ${'ABCDE'[j]} eyni görünür`);
    }
  }
  // Kompozit: yuxarıda əsas şəkil, altında A–E variantları (tələbənin gördüyü kimi)
  const W = 1000, pad = 20, optW = 200, labelH = 30;
  const mainH = main ? main.height : 0;
  const optH = opts.length ? Math.max(...opts.map((c) => (c ? c.height : 0))) + labelH : 0;
  const out = document.createElement('canvas');
  out.width = W; out.height = pad + mainH + (main && opts.length ? pad : 0) + optH + pad;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  if (main) ctx.drawImage(main, (W - main.width) / 2, pad);
  let y = pad + mainH + (main ? pad : 0);
  ctx.fillStyle = '#111'; ctx.font = 'bold 22px Arial, sans-serif';
  opts.forEach((c, i) => {
    const x = i * optW;
    ctx.fillText('ABCDE'[i] + ')', x + 6, y + 22);
    if (c) ctx.drawImage(c, x, y + labelH);
  });
  let image = null;
  try { image = out.toDataURL('image/png'); } catch (_) { problems.push('şəkil görüntüsü hazırlana bilmədi'); }
  return { image, problems, notes };
}

// Sualı yoxla: yekun görüntü + iki ayrı AI yoxlaması. Statuslar: checking → passed | review
async function checkQuestion(q, ctx = {}) {
  q.ai_status = 'checking';
  const r = await renderQuestionImage(q);
  q.render_notes = [...(q.render_issues || []), ...r.notes];
  if (r.problems.length) {
    q.correct_ok = false; q.fit_ok = null;
    q.verify_note = r.problems.join('; ');
    q.fit_note = '';
    q.ai_status = 'review';
    return false;
  }
  try {
    const payload = { body: q.body, options: q.options, answer: q.answer, solution: q.solution, figure: q.figure, option_figures: q.option_figures, render: r.image };
    const v = await callAI('verify', { mode: ctx.mode, sample: ctx.sample || null, questions: [payload] });
    const res = v.results[0];
    const correct = res.correct || { ok: res.ok, issues: res.issue ? [res.issue] : [] };
    q.correct_ok = correct.ok;
    q.fit_ok = res.fit ? res.fit.ok : null;
    q.verify_note = correct.ok ? '' : (correct.issues || []).join('; ');
    q.fit_note = res.fit && !res.fit.ok ? res.fit.issues.join('; ') : '';
    if (q.render_notes.length) q.fit_note = [q.fit_note, ...q.render_notes].filter(Boolean).join('; ');
    q.ai_status = res.ok ? 'passed' : 'review';
  } catch (err) {
    q.correct_ok = null; q.fit_ok = null;
    q.verify_note = 'yoxlama alınmadı: ' + err.message;
    q.ai_status = 'review';
  }
  q.verified = q.ai_status === 'passed';
  return q.ai_status === 'passed';
}

// Mövzudan yaratma üçün (nümunə yoxdur): yalnız düzgünlük
async function verifyQuestions(qs, onChange) {
  qs.forEach((q) => { q.ai_status = 'checking'; });
  onChange();
  await Promise.all(qs.map((q) => checkQuestion(q).then(() => { if (q.ai_status !== 'passed') q.ai_status = 'draft'; onChange(); })));
}

const sampleForApi = (s) => ({ text: s.text, image: s.image, topic: s.topic, section: s.section, analysis: s.analysis });

async function runExamples() {
  const samples = tyState.samples.filter(usableSample);
  if (!samples.length) return;
  const skipped = tyState.samples.length - samples.length;
  if (skipped && !confirm(`${skipped} nümunə istifadə olunmayacaq (analiz bitməyib, natamam və ya təsdiqlənməyib). Davam edilsin?`)) return;
  tyState.running = true;
  updateRunBtn();
  const N = tyState.per;
  const mode = tyState.mode;
  tyState.groups = samples.map((s) => ({ sample: s, expected: N, questions: [], state: 'waiting', errors: [] }));
  renderGroups();

  const q = makeQueue(4);
  let warm = null;
  const runJob = (fn) => {
    if (!warm) { warm = q(fn); return warm; }
    return warm.catch(() => {}).then(() => q(fn));
  };
  const avoidOf = (g) => g.questions.map((x) => x.body.replace(/\s+/g, ' ').slice(0, 180));

  // Bir sorğu: g üçün count sual (≤ CHUNK)
  const generate = async (g, count, feedback = '') => {
    const data = await callAI('tryos_from_examples', {
      samples: [sampleForApi(g.sample)], mode, perSample: count, notes: tyState.notes, avoid: avoidOf(g), feedback
    });
    (data.rejected || []).forEach((r) => g.errors.push('rədd edildi: ' + r.reason));
    return data.questions.slice(0, count).map((x) => ({ ...x, _uid: ++qSeq, attempts: 0 }));
  };

  // Yoxla; keçməsə, məhdud sayda yenidən yarat; yenə keçməsə qaralama
  const settle = async (g, item) => {
    renderGroups();
    let cur = item;
    let ok = await checkQuestion(cur, { mode, sample: sampleForApi(g.sample) });
    renderGroups();
    while (!ok && cur.attempts < AUTO_RETRY) {
      const fb = [cur.verify_note, cur.fit_note].filter(Boolean).join('; ');
      let repl = null;
      try { repl = (await generate(g, 1, fb))[0]; } catch (err) { g.errors.push(err.message); }
      if (!repl) break;
      repl.attempts = cur.attempts + 1;
      const idx = g.questions.indexOf(cur);
      if (idx >= 0) g.questions[idx] = repl; else g.questions.push(repl);
      cur = repl;
      renderGroups();
      ok = await checkQuestion(cur, { mode, sample: sampleForApi(g.sample) });
      renderGroups();
    }
    if (!ok) cur.ai_status = 'draft';
  };

  const fill = async (g) => {
    g.state = 'working';
    renderGroups();
    let need = g.expected - g.questions.length;
    const chunks = [];
    while (need > 0) { chunks.push(Math.min(CHUNK, need)); need -= CHUNK; }
    const settles = [];
    await Promise.all(chunks.map((count) => runJob(async () => {
      try {
        const got = await generate(g, count);
        got.forEach((x) => { if (g.questions.length < g.expected) { g.questions.push(x); settles.push(settle(g, x)); } });
        if (got.length < count) g.errors.push(`${count} sual istənildi, ${got.length} yararlı gəldi`);
      } catch (err) {
        g.errors.push(err.message);
      }
      renderGroups();
    })));
    await Promise.all(settles);
  };

  let done = 0;
  const total = tyState.groups.length;
  progress(`Yaradılır: 0 / ${total} nümunə…`, 'exProgress');
  await Promise.all(tyState.groups.map(async (g) => {
    await fill(g);
    // bir dəfə avtomatik tamamlama (dublikatsız: avoid siyahısı ilə)
    if (g.questions.length < g.expected) await fill(g);
    g.state = g.questions.length >= g.expected ? 'done' : g.questions.length ? 'partial' : 'error';
    done++;
    progress(`Yaradılır: ${done} / ${total} nümunə…`, 'exProgress');
    renderGroups();
  }));
  progress('', 'exProgress');
  tyState.running = false;
  updateRunBtn();
  renderGroups();
  const got = tyState.groups.reduce((t, g) => t + g.questions.length, 0);
  const want = tyState.groups.reduce((t, g) => t + g.expected, 0);
  if (got < want) toast(`${want} sualdan ${got}-i alındı. Çatışmayanları nümunə kartında tamamlaya bilərsiniz.`, true);

  // Çatışmayanları sonradan tamamlamaq üçün
  tyState.fillMissing = async (gi) => {
    const g = tyState.groups[gi];
    if (!g || tyState.running) return;
    tyState.running = true; updateRunBtn();
    g.errors = [];
    await fill(g);
    g.state = g.questions.length >= g.expected ? 'done' : g.questions.length ? 'partial' : 'error';
    tyState.running = false; updateRunBtn(); renderGroups();
  };
}

const STATUS_BADGE = {
  passed: ['ai', '✓', 'AI yoxlamasından keçib'],
  checking: ['', '…', 'yoxlanılır'],
  review: ['amber', '⚠', 'yoxlama tələb edir'],
  draft: ['red', 'qaralama', 'qaralama — yoxlama tələb edir']
};
const defaultChecked = (q) => q.ai_status === 'passed';

function renderGroups() {
  const box = $('#exResults');
  if (!box) return;
  const groups = tyState.groups;
  if (!groups.length) { box.innerHTML = ''; return; }
  tyState.sel = tyState.sel || {}; // yalnız müəllimin özünün dəyişdirdiyi seçimlər yadda saxlanılır
  const all = groups.flatMap((g) => g.questions);
  const cnt = (s) => all.filter((q) => q.ai_status === s).length;
  const want = groups.reduce((t, g) => t + g.expected, 0);
  box.innerHTML = `<div class="card stack">
    <div class="row between"><h2>Nəticə: ${all.length} / ${want} sual</h2>
      <div class="row"><button class="btn" id="pdfSel">PDF</button><button class="btn primary" id="saveSel">Seçilənləri banka əlavə et</button></div></div>
    <p class="small">✓ AI yoxlamasından keçib: <b>${cnt('passed')}</b> · ⚠ yoxlanılır / tələb edir: <b>${cnt('checking') + cnt('review')}</b> · qaralama: <b>${cnt('draft')}</b>${all.length < want && !tyState.running ? ` · <span style="color:var(--red)">çatışmır: <b>${want - all.length}</b></span>` : ''}</p>
    ${cnt('draft') ? '<p class="notice">Qaralamalar avtomatik seçilmir. Onları açıb yoxlayın; banka qaralama statusu ilə düşür və müəllim təsdiqi gözləyir.</p>' : ''}
    <p class="muted small">Karta toxunun: nümunə və yeni sual böyük pəncərədə açılacaq.</p>
    <div class="mini-grid">${groups.map((g, gi) => `<div class="mini">
      <div class="mini-head"><b>${gi + 1}</b><span class="tag">${g.questions.length} / ${g.expected}</span>
        ${g.state === 'waiting' ? '<span class="muted small">növbədə…</span>'
          : g.state === 'working' ? '<span class="row muted small" style="gap:6px"><span class="spinner sm" aria-hidden="true"></span> yaradılır…</span>' : ''}
        ${(g.state === 'partial' || g.state === 'error') && !tyState.running ? `<button type="button" class="btn small" data-fill="${gi}">Çatışmayanları yarat</button>` : ''}</div>
      ${g.errors.length && g.state !== 'working' ? `<details class="small"><summary style="color:var(--red)">Problemlər (${g.errors.length})</summary><ul>${g.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
      ${g.questions.map((q) => { const key = String(q._uid); return miniQ(q, key, key in tyState.sel ? tyState.sel[key] : defaultChecked(q)); }).join('')}
    </div>`).join('')}</div>
  </div>`;
  bindMini(box, (key) => {
    for (const g of groups) {
      const q = g.questions.find((x) => String(x._uid) === key);
      if (q) return { q, sample: g.sample, onApprove: q.ai_status === 'checking' ? null : (on) => { if (on) tyState.sel[key] = true; renderGroups(); } };
    }
    return {};
  });
  $$('[data-fill]', box).forEach((b) => b.onclick = () => tyState.fillMissing && tyState.fillMissing(+b.dataset.fill));
  $$('#exResults .check').forEach((c) => c.onchange = () => { tyState.sel[c.dataset.id] = c.checked; });
  const chosen = () => {
    const keys = new Set($$('#exResults .check').filter((c) => c.checked).map((c) => c.dataset.id));
    return all.filter((q) => keys.has(String(q._uid)));
  };
  $('#saveSel', box).onclick = (e) => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    if (list.some((q) => q.ai_status === 'checking')) return toast('Bəzi suallar hələ yoxlanılır, bir az gözləyin', true);
    busy(e.currentTarget, async () => {
      await saveQuestions(list, 'ai');
      const saved = new Set(list);
      tyState.groups.forEach((g) => {
        const before = g.questions.length;
        g.questions = g.questions.filter((q) => !saved.has(q));
        g.expected = Math.max(g.questions.length, g.expected - (before - g.questions.length));
      });
      tyState.groups = tyState.groups.filter((g) => g.questions.length || (g.state !== 'done' && g.state !== 'partial'));
      renderGroups();
      toast(list.length + ' sual banka əlavə olundu' + (tyState.groups.length ? '' : ' · siyahı boşaldı'));
    }).catch(fail);
  };
  $('#pdfSel', box).onclick = () => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    pendingPrint = { questions: list, title: '', back: '#/ai' };
    go('#/print');
  };
}

// Kiçik kart: qısa önizləmə + seçim qutusu; toxunanda pəncərə açılır
function miniQ(q, key, checked) {
  const letter = 'ABCDE'[(q.options || []).indexOf(q.answer)] || '—';
  const st = STATUS_BADGE[q.ai_status] || (q.verified === true ? STATUS_BADGE.passed : q.verified === false ? STATUS_BADGE.review : null);
  const ver = (st ? `<span class="tag ${st[0]}" title="${esc(st[2])}">${esc(st[1])}</span>` : '')
    + (q.teacher_approved ? '<span class="tag ai">✔ təsdiqlədiniz</span>' : '');
  const why = (q.ai_status === 'draft' || q.ai_status === 'review') && !q.teacher_approved
    ? [q.verify_note, q.fit_note].filter(Boolean).join('; ') : '';
  return `<div class="mini-q">
    <input type="checkbox" class="check" data-id="${esc(key)}" ${checked ? 'checked' : ''} aria-label="Sualı seç">
    <button type="button" class="mini-open" data-open="${esc(key)}">
      <span class="mini-text">${esc(q.body)}</span>
      <span class="mini-meta">${q.figure || hasOptionFigures(q) ? '<span class="tag">şəkil</span>' : ''}<span class="tag">${esc(q.difficulty || '')}</span><span class="tag ai">Cavab: ${letter}</span>${ver}</span>
      ${why ? `<span class="mini-why">Səbəb: ${esc(why)}</span>` : ''}
    </button>
  </div>`;
}

function bindMini(root, getItem) {
  $$('[data-open]', root).forEach((b) => b.onclick = () => {
    const { q, sample } = getItem(b.dataset.open);
    if (!q) return;
    let dlg = document.getElementById('qDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'qDialog';
      dlg.className = 'q-dialog';
      $app.appendChild(dlg);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
    const item = getItem(b.dataset.open);
    const canApprove = typeof item.onApprove === 'function';
    dlg.innerHTML = `<div class="q-dialog-in">
      <div class="row between"><h2>Sual</h2><div class="row">
        ${canApprove ? `<button type="button" class="btn small ${q.teacher_approved ? '' : 'primary'}" data-approve>${q.teacher_approved ? 'Təsdiqi götür' : '✔ Təsdiqlə — yoxladım, düzgündür'}</button>` : ''}
        <button type="button" class="btn small" data-close aria-label="Bağla">✕ Bağla</button></div></div>
      ${canApprove && !q.teacher_approved && (q.ai_status === 'draft' || q.ai_status === 'review') ? '<p class="notice">AI yoxlaması keçməyib. Sualı, cavabı və həlli özünüz yoxlayın; düzgündürsə təsdiqləyin.</p>' : ''}
      <div class="${sample ? 'dlg-pair' : ''}">
        ${sample ? `<div class="dlg-src"><div class="muted small">Nümunə</div>${sample.image ? `<img src="${sample.image}" alt="Nümunə">` : `<div class="small pre">${esc(sample.text)}</div>`}</div>` : ''}
        <div>${sample ? '<div class="muted small">Yeni sual</div>' : ''}${questionHtml(sample || !q.source ? { ...q, source: 'ai' } : q)}</div>
      </div></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    const ap = $('[data-approve]', dlg);
    if (ap) ap.onclick = () => { q.teacher_approved = !q.teacher_approved; dlg.close(); item.onApprove(q.teacher_approved); };
    dlg.showModal();
  });
}

// ---------------- 2. Mövzudan yarat ----------------
function topicTab() {
  $('#tabBody').innerHTML = `
    <form class="card stack" id="gen">
      <div class="form-grid">
        <label class="field">Bölmə<select name="section" id="tySection">
          <option value="matematik">Temel Matematik</option><option value="sayisal">Sayısal Yetenek (mantık)</option><option value="deneme">Deneme (karışık)</option></select></label>
        <label class="field">Mövzu<select name="tyTopic" id="tyTopic"></select></label>
        <label class="field">Çətinlik<select name="tyDifficulty">
          <option value="qarisiq">Qarışıq (asan → orta-çətin)</option><option value="asan">Asan</option><option value="orta">Orta</option><option value="cetin">Orta-çətin</option></select></label>
        <label class="field">Sual sayı<select name="tyCount">${[3, 5, 10, 15, 20, 30, 40].map((n) => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="field">Əlavə istək<span class="hint">istəyə bağlı</span><input type="text" name="notes" maxlength="800" placeholder="məs. qrafikli suallar çox olsun"></label>
      <div class="run-row">${modelPicker()}<button class="btn primary" type="submit">${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} Sualları yarat</button>
        <span id="progress" class="muted small" role="status" aria-live="polite"></span></div>
    </form>
    <section id="results"></section>`;
  const fillTopics = () => {
    const sec = $('#tySection').value;
    const list = sec === 'deneme' ? [] : TRYOS_TOPICS[sec];
    $('#tyTopic').innerHTML = `<option value="">${sec === 'deneme' ? 'Bütün mövzular (karışık)' : 'Bölmənin bütün mövzuları'}</option>` + list.map((t) => `<option>${esc(t)}</option>`).join('');
    $('#tyTopic').disabled = sec === 'deneme';
  };
  fillTopics();
  $('#tySection').onchange = fillTopics;

  let results = [];
  const render = (label) => simpleResults(results, label);
  $('#gen').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button[type=submit]', e.target), async () => {
      const base = { section: f.section, topic: f.tyTopic || '', difficulty: f.tyDifficulty, notes: f.notes };
      progress('Tip planı hazırlanır…');
      const { plan, notes } = await callAI('tryos_plan', { ...base, count: +f.tyCount || 10 });
      if (notes) toast(notes);
      results = [];
      const batches = [];
      for (let i = 0; i < plan.length; i += 3) batches.push(plan.slice(i, i + 3));
      let done = 0;
      const verifs = [];
      const q = makeQueue(3);
      await Promise.all(batches.map((items) => q(async () => {
        try {
          const avoid = results.map((x) => x.body.replace(/\s+/g, ' ').slice(0, 140));
          const data = await callAI('tryos_generate', { ...base, items, avoid });
          results.push(...data.questions);
          verifs.push(verifyQuestions(data.questions, () => render()));
        } catch (err) { console.error(err); toast('Bir partiya alınmadı: ' + err.message, true); }
        done += items.length;
        progress(`Suallar yaradılır: ${Math.min(done, plan.length)} / ${plan.length}…`);
        render(`${results.length} sual hazırdır, davam edir…`);
      })));
      progress('Yoxlama tamamlanır…');
      await Promise.all(verifs);
      progress('');
      render();
      if (!results.length) throw new Error('Sual yaradılmadı, yenidən yoxlayın');
    }).catch((err) => { progress(''); fail(err); });
  };
}

function simpleResults(results, doneLabel) {
  const box = $('#results');
  if (!box) return;
  if (!results.length) { box.innerHTML = ''; return; }
  const unchecked = new Set($$('#results .check').filter((c) => !c.checked).map((c) => c.dataset.id));
  const bad = results.filter((q) => q.verified === false).length;
  box.innerHTML = `<div class="card stack">
    <div class="row between"><h2>${doneLabel || results.length + ' sual hazırdır'}</h2>
      <div class="row"><button class="btn" id="pdfSel">PDF</button><button class="btn primary" id="saveSel">Seçilənləri banka əlavə et</button></div></div>
    ${bad ? `<p class="notice">${bad} sualda ikinci yoxlama fərqli cavab tapdı və ya problem gördü (⚠).</p>` : ''}
    <div class="mini-grid">${results.map((q, i) => `<div class="mini">${miniQ(q, String(i), !unchecked.has(String(i)))}</div>`).join('')}</div>
  </div>`;
  bindMini(box, (key) => ({ q: results[+key] }));
  const chosen = () => $$('#results .check').filter((c) => c.checked).map((c) => results[+c.dataset.id]);
  $('#saveSel', box).onclick = (e) => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    busy(e.currentTarget, async () => {
      await saveQuestions(list, 'ai');
      const saved = new Set(list);
      const rest = results.filter((q) => !saved.has(q));
      results.length = 0;
      results.push(...rest);
      simpleResults(results);
      toast(list.length + ' sual banka əlavə olundu');
    }).catch(fail);
  };
  $('#pdfSel', box).onclick = () => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    pendingPrint = { questions: list, title: '', back: '#/ai' };
    go('#/print');
  };
}

// ---------------- 4. Yaz və çevir: sualı yaz (və ya şəkildən oxut), dəyişiklik səviyyəsini seç ----------------
const REWRITE_LEVELS = [
  ['yungul', 'Yüngül', 'Eyni sual: adlar və rəqəmlər dəyişir'],
  ['orta', 'Orta', 'Yeni kontekst, eyni quruluş və çətinlik'],
  ['tam', 'Tam yeni', 'Eyni bilik və çətinlik, fərqli qurulma']
];
const rwState = { text: '', level: 'orta', qtype: 'mcq', grade: 11, difficulty: 'orta', topic: '' };
function rewriteTab() {
  $('#tabBody').innerHTML = `
    <form class="card stack" id="rw">
      <p class="muted small">Sualı yazın və ya yapışdırın (kitabdan, öz qeydlərinizdən). Dəyişiklik səviyyəsini seçin — AI eyni bacarığı yoxlayan <strong>yeni</strong> sual yazır, cavabı yenidən hesablayır və ikinci dəfə yoxlayır.</p>
      <label class="field">Sual<span class="hint no-math">Formul üçün $x^2$, $\\frac{2}{3}$ · variantları da yaza bilərsiniz</span><textarea name="text" rows="5" maxlength="3000" required placeholder="məs. f(2x + 1) = 3x − 4 olarsa, f(5) neçədir?  A) 2  B) 3  C) 5  D) 7  E) 8">${esc(rwState.text)}</textarea></label>
      <div class="row"><label class="btn small" style="cursor:pointer">📷 Şəkildən oxu<input type="file" accept="image/*" class="sr" id="rwImg"></label><span class="small muted" id="rwOcr"></span></div>
      <div><div class="small" style="font-weight:600;margin-bottom:6px">Nə qədər dəyişsin?</div>
        <div class="pills" role="radiogroup" aria-label="Dəyişiklik səviyyəsi">${REWRITE_LEVELS.map(([k, n, d]) => `<button type="button" class="pill-opt" role="radio" aria-checked="${rwState.level === k}" data-level="${k}"><strong>${n}</strong><span>${d}</span></button>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field">Sual növü<select name="qtype"><option value="mcq" ${rwState.qtype === 'mcq' ? 'selected' : ''}>Çoxseçimli (A–E)</option><option value="open" ${rwState.qtype === 'open' ? 'selected' : ''}>Açıq sual</option></select></label>
        <label class="field">Çətinlik<select name="difficulty">${DIFF.map((d) => `<option ${d === rwState.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field">Mövzu<span class="hint">istəyə bağlı</span><input type="text" name="topic" maxlength="200" value="${esc(rwState.topic)}" list="rwTopics"><datalist id="rwTopics">${[...TRYOS_TOPICS.matematik, ...TRYOS_TOPICS.sayisal].map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
        <label class="field">Neçə sual<select name="count">${[1, 2, 3, 5, 8, 10].map((n) => `<option ${n === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="run-row">${modelPicker()}<button class="btn primary" type="submit">${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} Yeni sual yarat</button>
        <span id="progress" class="muted small" role="status" aria-live="polite"></span></div>
    </form>
    <section id="results"></section>`;
  const form = $('#rw');
  $$('[data-level]', form).forEach((b) => b.onclick = () => { rwState.level = b.dataset.level; $$('[data-level]', form).forEach((o) => o.setAttribute('aria-checked', String(o === b))); });
  form.text.oninput = () => { rwState.text = form.text.value; };
  $('#rwImg').onchange = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      $('#rwOcr').textContent = 'Şəkil oxunur…';
      callAI('extract', { image: c.toDataURL('image/jpeg', 0.88) }).then((d) => {
        form.text.value = rwState.text = d.text;
        if (d.topic && !form.topic.value) form.topic.value = d.topic;
        if (DIFF.includes(d.difficulty)) form.difficulty.value = d.difficulty;
        $('#rwOcr').textContent = '✓ Oxundu — yoxlayın, səhv varsa düzəldin';
      }).catch((err) => { $('#rwOcr').textContent = ''; fail(err); });
    };
    img.onerror = () => toast('Şəkil açılmadı', true);
    img.src = URL.createObjectURL(file);
  };
  let results = [];
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    Object.assign(rwState, { text: f.text, qtype: f.qtype, difficulty: f.difficulty, topic: f.topic });
    if (!String(f.text || '').trim()) return toast('Sualı yazın', true);
    const n = +f.count || 1;
    busy($('button[type=submit]', form), async () => {
      results = [];
      const base = { text: f.text, level: rwState.level, qtype: f.qtype, difficulty: f.difficulty, topic: f.topic, grade: rwState.grade };
      const q = makeQueue(3);
      let done = 0;
      progress(`Yaradılır: 0 / ${n}…`);
      // hər sorğu bir sual; bir neçə sual istənəndə təkrarlanmasın deyə əvvəlkilər bildirilir
      await Promise.all(Array.from({ length: n }, (_, i) => q(async () => {
        try {
          const extra = (n > 1 ? `\n(Bu, ${n} variantdan ${i + 1}-cisidir: digər variantlardan fərqli kontekst, adlar və rəqəmlər seç.)` : '')
            + (results.length ? '\nArtıq yaradılıb (bunları təkrarlama): ' + results.map((x) => x.body.replace(/\s+/g, ' ').slice(0, 120)).join(' | ') : '');
          const d = await callAI('transform', { ...base, text: base.text + extra });
          const nq = { ...d.question, _changes: d.changes || [] };
          results.push(nq);
          simpleResults(results, `${results.length} / ${n} sual hazırdır, yoxlanılır…`);
          await checkQuestion(nq);
          if (nq.ai_status !== 'passed') nq.ai_status = 'draft';
        } catch (err) { if (err.expected) throw err; toast('Bir sual alınmadı: ' + err.message, true); }
        done++;
        progress(`Yaradılır: ${done} / ${n}…`);
      })));
      progress('');
      simpleResults(results);
      if (!results.length) throw new Error('Sual yaradılmadı, yenidən yoxlayın');
      const lvl = REWRITE_LEVELS.find((l) => l[0] === rwState.level)[1];
      const box = $('#results .card');
      if (box) box.insertAdjacentHTML('afterbegin', `<p class="small muted" style="margin:0">Dəyişiklik səviyyəsi: <strong>${esc(lvl)}</strong>${results[0]?._changes?.length ? ` · nə dəyişdi: ${esc(results[0]._changes.join('; '))}` : ''}</p>`);
      $('#results').scrollIntoView({ behavior: 'smooth' });
    }).catch((err) => { progress(''); fail(err); });
  };
}

// ---------------- 3. Məktəb (ümumi) ----------------
function generalTab() {
  $('#tabBody').innerHTML = `
    <form class="card stack" id="gen">
      <p class="muted small">Azərbaycan dilində, məktəb sinifləri üçün suallar.</p>
      <label class="field">Mövzu<input type="text" name="topic" maxlength="200" required placeholder="məs. Tənliklər sistemi, əvəzetmə üsulu"></label>
      <div class="form-grid">
        <label class="field">Sinif<select name="grade">${Array.from({ length: 12 }, (_, i) => `<option ${i + 1 === 7 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <label class="field">Çətinlik<select name="difficulty">${DIFF.map((d) => `<option ${d === 'orta' ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field">Sual sayı<select name="count">${[3, 5, 8, 10].map((n) => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field">Növ<select name="qtype"><option value="mcq">Çoxseçimli</option><option value="open">Açıq sual</option></select></label>
      </div>
      <label class="field">Nümunə sual<span class="hint">istəyə bağlı · yapışdırın, AI ona bənzər suallar yaradacaq</span><textarea name="example" rows="3" maxlength="6000"></textarea></label>
      <label class="field">Əlavə istək<span class="hint">istəyə bağlı</span><input type="text" name="notes" maxlength="500"></label>
      <div><button class="btn primary" type="submit">${icons.spark.replace('aria-hidden', 'width="18" height="18" stroke="#fff" aria-hidden')} Sualları yarat</button></div>
    </form>
    <section id="results"></section>`;
  $('#gen').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.mode = 'benzer';
    busy($('button[type=submit]', e.target), async () => {
      const data = await callAI('generate', f);
      simpleResults(data.questions);
      $('#results').scrollIntoView({ behavior: 'smooth' });
    }).catch(fail);
  };
}

// ================= Kitabdan / PDF-dən sual (banka) =================

async function pdfView() {
  view().innerHTML = `
    <div class="page-head"><div><h1>Kitabdan / PDF-dən sual</h1>
      <p class="muted">PDF və ya şəkil aç, sualı barmaqla çərçivəyə al. Aşağıda seçim çıxacaq: təmiz orijinalını çıxart və ya AI ilə bənzərini yarat.</p></div>${modelPicker()}</div>
    <section class="card stack"><div id="pdfPicker" class="stack"></div><div id="pdfOut"></div></section>
    <div class="sticky-bar" id="pdfBar" hidden>
      <span><strong id="pdfCount">0</strong> sual seçilib</span>
      <span class="row"><button class="btn" id="pdfToTest">Testə əlavə et</button><button class="btn primary" id="pdfSave">Banka əlavə et</button></span>
    </div>`;
  bindModelPicker(view());
  const pdf = pdfQuestions($('#pdfPicker'), $('#pdfOut'));
  const update = () => {
    const n = pdf.selected().length;
    $('#pdfCount').textContent = n;
    $('#pdfBar').hidden = !pdf.count();
    $('#pdfSave').disabled = !n || pdf.busy();
    $('#pdfToTest').disabled = !n || pdf.busy();
  };
  view().addEventListener('pdfchange', update);
  const save = async () => {
    const list = pdf.selected();
    const ids = [];
    for (const src of ['book', 'ai']) {
      const part = list.filter((q) => q._source === src);
      if (part.length) ids.push(...await saveQuestions(part, src));
    }
    pdf.remove(list);
    return ids;
  };
  $('#pdfSave').onclick = () => busy($('#pdfSave'), async () => { const ids = await save(); toast(ids.length + ' sual banka əlavə olundu'); update(); }).catch(fail);
  $('#pdfToTest').onclick = () => busy($('#pdfToTest'), async () => { pendingTestIds = await save(); go('#/newtest'); }).catch(fail);
  update();
}

// Suallar bölməsinin daxili menyusu (bank / kitab / AI)
const Q_TABS = [['bank', 'Sual bankı'], ['pdf', 'Kitabdan / PDF'], ['ai', 'AI ilə yarat']];
const qSubnav = (active) => `<nav class="seg sub-seg" aria-label="Suallar">${Q_TABS.map(([k, l]) => `<a class="seg-b ${k === active ? 'on' : ''}" href="#/${k}">${l}</a>`).join('')}</nav>`;

// ================= Testlər =================

const testLink = (id) => appBase() + '#/t/' + id;

// ================= Avtomatik test: kitabdan seçmə və ya AI ilə, çətinlik bölgüsü ilə =================
const DIFFS = [['asan', 'Asan'], ['orta', 'Orta'], ['çətin', 'Çətin']];
const autoState = { running: false, status: '', results: [], notes: [], title: '', topic: '' };
let pendingTestTitle = '';

function cropCanvasBox(canvas, box, maxSide = 1100) {
  const pad = 3;
  const x = Math.max(0, box[0] - pad), y = Math.max(0, box[1] - pad);
  const w = Math.min(100 - x, box[2] + pad * 2), h = Math.min(100 - y, box[3] + pad * 2);
  const sx = x / 100 * canvas.width, sy = y / 100 * canvas.height, sw = w / 100 * canvas.width, sh = h / 100 * canvas.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

async function renderPdfPage(pdf, n, width = 1400) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, width / base.width) });
  const c = document.createElement('canvas');
  c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
  return c;
}

// AI ilə dəqiq bölgü: { asan, orta, 'çətin' } → yoxlanmış suallar
async function autoGenerate(topic, mix, onStatus) {
  const section = TRYOS_TOPICS.sayisal.includes(topic) ? 'sayisal' : 'matematik';
  const base = { section, topic, difficulty: 'qarisiq', notes: '' };
  const total = mix.asan + mix.orta + mix['çətin'];
  onStatus(`AI tip planı qurur (${total} sual)…`);
  const { plan } = await callAI('tryos_plan', { ...base, mix: { asan: mix.asan, orta: mix.orta, cetin: mix['çətin'] } });
  const out = [];
  const batches = [];
  for (let i = 0; i < plan.length; i += 3) batches.push(plan.slice(i, i + 3));
  const q = makeQueue(3);
  let done = 0;
  await Promise.all(batches.map((items) => q(async () => {
    try {
      const data = await callAI('tryos_generate', { ...base, items, avoid: out.map((x) => x.body.replace(/\s+/g, ' ').slice(0, 140)) });
      const got = data.questions.map((x, i) => ({ ...x, difficulty: (items[i] || items[0]).difficulty, _source: 'ai' }));
      out.push(...got);
      autoState.results.push(...got);
      renderAuto();
      done += items.length;
      onStatus(`AI sualları yazır: ${Math.min(done, total)} / ${total}, yoxlanılır…`);
      await Promise.all(got.map((x) => checkQuestion(x).then(() => { if (x.ai_status !== 'passed') x.ai_status = 'draft'; renderAuto(); })));
    } catch (err) {
      if (err.expected) throw err;
      autoState.notes.push('Bir partiya alınmadı: ' + err.message);
    }
  })));
  return out;
}

// Kitabdakı bir sual → təmiz orijinal və ya bənzər (yoxlama + bir dəfə təkrar cəhd)
async function autoFromBook(image, mode, diff) {
  const d = await callAI('tryos_analyze', { image, text: '' });
  const a = { ...d.analysis, difficulty: diff };
  if (!a.complete) throw Object.assign(new Error('sual kəsikdə natamamdır'), { skip: true });
  const sample = { text: d.text, image, topic: a.topic, section: a.section, analysis: a };
  const make = mode === 'original'
    ? async (feedback = '') => (await callAI('clean_copy', { image, text: d.text, analysis: a, feedback })).questions[0]
    : async (feedback = '') => {
      const r = await callAI('tryos_from_examples', { samples: [sample], mode: 'benzer', perSample: 1, feedback });
      if (!r.questions?.length) throw new Error('AI bənzər sual qaytarmadı');
      return r.questions[0];
    };
  let q = await make();
  let ok = await checkQuestion(q, { mode, sample });
  if (!ok) {
    try {
      const q2 = await make([q.verify_note, q.fit_note].filter(Boolean).join('; '));
      ok = await checkQuestion(q2, { mode, sample });
      q = q2;
    } catch (err) { if (err.expected) throw err; }
  }
  if (!ok) q.ai_status = 'draft';
  return { ...q, difficulty: diff, _source: mode === 'original' ? 'book' : 'ai', _sample: sample };
}

async function autoView() {
  const allTopics = [...TRYOS_TOPICS.matematik, ...TRYOS_TOPICS.sayisal];
  let pdf = null; let src = 'book';
  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/tests">Testlər</a> /</div><h1>Avtomatik test</h1>
      <p class="muted">Nə lazım olduğunu yazın: sistem sualları kitabdan özü seçsin və ya AI ilə yaratsın. Sonda PDF yükləyin və ya test edin.</p></div></div>
    <form id="autoForm" class="stack">
      <section class="card stack"><h2><span class="step-n">1</span> Nə lazımdır?</h2>
        <label class="field">Mövzu<span class="hint">siyahıdan seçin və ya öz sözünüzlə yazın</span><input type="text" name="topic" list="autoTopics" required maxlength="120" placeholder="məs. Fonksiyonlar" value="${esc(autoState.topic)}">
          <datalist id="autoTopics">${allTopics.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
        <div class="mix">${DIFFS.map(([k, l], i) => `<label class="mix-b mix-${i}"><span>${l}</span><input type="number" name="n${i}" min="0" max="20" value="5" inputmode="numeric" aria-label="${l} sual sayı"></label>`).join('')}
          <div class="mix-total">Cəmi <strong id="mixTotal">15</strong> sual</div></div>
      </section>
      <section class="card stack"><h2><span class="step-n">2</span> Haradan?</h2>
        <div class="seg" role="tablist" aria-label="Mənbə">
          <button type="button" class="seg-b on" data-src="book" role="tab">📖 Kitabdan (PDF)</button>
          <button type="button" class="seg-b" data-src="ai" role="tab">✨ AI yaratsın</button>
          <button type="button" class="seg-b" data-src="bank" role="tab">🗂 Bankdan</button></div>
        <div data-srcpane="book" class="stack">
          <label class="btn" style="align-self:flex-start">📄 PDF kitabı seç<input type="file" accept="application/pdf,.pdf" class="sr" id="autoPdf"></label>
          <div id="pdfInfo" class="small muted">Kitab seçilməyib.</div>
          <div class="form-grid" id="pageRange" hidden>
            <label class="field">Səhifədən<input type="number" name="from" min="1" value="1" inputmode="numeric"></label>
            <label class="field">Səhifəyə<input type="number" name="to" min="1" value="1" inputmode="numeric"></label></div>
          <p class="hint">Bir dəfəyə ən çox 40 səhifəyə baxılır. Mövzunun olduğu fəsli yazsanız daha tez və ucuz olar: hər səhifə 1 AI sorğusudur, lazım olan qədər sual tapılan kimi axtarış dayanır.</p>
          <div class="choice-row" role="radiogroup" aria-label="Tapılan suallar necə verilsin">
            <label class="choice"><input type="radio" name="out" value="original" checked><span><strong>Orijinal</strong><small>kitabdakı sual təmiz yazılır, şəkillər yenidən çəkilir</small></span></label>
            <label class="choice"><input type="radio" name="out" value="benzer"><span><strong>AI ilə bənzər</strong><small>hər sualdan eyni tipdə yeni sual</small></span></label></div>
          <label class="row small" style="gap:8px"><input type="checkbox" name="fill" checked style="width:20px;height:20px"> Kitabda çatmasa, qalanını AI ilə tamamla</label>
        </div>
        <div data-srcpane="bank" class="stack" hidden><p class="small muted">Sual bankınızdakı həmin mövzudan seçilir. Tələbələr bir sualı ən azı ${REAL_MIN} dəfə cavablayıbsa, onun <strong>real çətinliyi</strong> (neçə faizinin düz tapdığı) götürülür, yoxdursa sualın öz çətinliyi. AI işlənmir, dərhal hazır olur.</p>
          <label class="row small" style="gap:8px"><input type="checkbox" name="fillBank" checked style="width:20px;height:20px"> Bankda çatmasa, qalanını AI ilə yarat</label></div>
        <div data-srcpane="ai" class="stack" hidden><p class="small muted">AI mövzu üzrə müxtəlif tiplərdən plan qurur, sualları yazır və hər birini ayrıca yoxlayır. Bölgü dəqiq saxlanılır.</p></div>
        <div class="run-row">${modelPicker()}<button class="btn primary" type="submit" id="autoRun">⚡ Başla</button></div>
      </section>
    </form>
    <section id="autoOut" class="stack"></section>`;
  bindModelPicker($('#autoForm'));
  const form = $('#autoForm');
  const need = () => Object.fromEntries(DIFFS.map(([k], i) => [k, Math.max(0, Math.min(20, parseInt(form['n' + i].value, 10) || 0))]));
  const sumNeed = () => Object.values(need()).reduce((a, b) => a + b, 0);
  form.addEventListener('input', (e) => { if (/^n\d$/.test(e.target.name)) $('#mixTotal').textContent = sumNeed(); });
  $$('[data-src]').forEach((b) => b.onclick = () => {
    src = b.dataset.src;
    $$('[data-src]').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-srcpane]').forEach((p) => { p.hidden = p.dataset.srcpane !== src; });
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.type === 'number') e.preventDefault(); });
  $('#autoPdf').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    $('#pdfInfo').innerHTML = '<span class="spinner sm" aria-hidden="true"></span> PDF açılır…';
    try {
      const pdfjs = await import(PDFJS_URL);
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      $('#pdfInfo').innerHTML = `<strong>${esc(file.name)}</strong> · ${pdf.numPages} səhifə`;
      $('#pageRange').hidden = false;
      form.from.max = form.to.max = pdf.numPages;
      form.from.value = 1; form.to.value = Math.min(pdf.numPages, 40);
    } catch (err) { console.error(err); pdf = null; $('#pdfInfo').textContent = 'PDF açılmadı. Başqa fayl yoxlayın.'; }
  };

  const status = (t) => { autoState.status = t; const el = $('#autoStatus'); if (el) el.textContent = t; };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (autoState.running) return toast('Əvvəlki iş hələ gedir', true);
    const topic = form.topic.value.trim();
    const n = need(); const total = sumNeed();
    if (!topic) return toast('Mövzunu yazın', true);
    if (!total) return toast('Ən azı bir sual sayı yazın', true);
    if (total > 40) return toast('Bir dəfəyə ən çox 40 sual', true);
    let from = 1, to = 1;
    if (src === 'book') {
      if (!pdf) return toast('Əvvəlcə PDF kitabı seçin', true);
      from = Math.max(1, Math.min(pdf.numPages, parseInt(form.from.value, 10) || 1));
      to = Math.max(from, Math.min(pdf.numPages, parseInt(form.to.value, 10) || from));
      if (to - from + 1 > 40) return toast('Bir dəfəyə ən çox 40 səhifə seçin', true);
    }
    const mode = form.out.value; const fill = form.fill.checked;
    Object.assign(autoState, { running: true, results: [], notes: [], topic, title: `${topic} · ${total} sual` });
    renderAuto();
    busy($('#autoRun'), async () => {
      try {
        if (src === 'ai') {
          await autoGenerate(topic, n, status);
        } else if (src === 'bank') {
          await runBank(topic, n, form.fillBank.checked);
        } else {
          await runBook({ pdf, topic, n, from, to, mode, fill });
        }
        const order = { asan: 0, orta: 1, 'çətin': 2 };
        autoState.results.sort((a, b) => (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1));
        status('');
        if (!autoState.results.length) throw new Error('Sual alınmadı. Səhifə aralığını və ya mövzunu dəyişib yenidən yoxlayın.');
      } finally { autoState.running = false; renderAuto(); }
    }).catch((err) => { status(''); fail(err); });
  };

  async function runBank(topic, n, fill) {
    status('Bank oxunur…');
    const [idx, stats] = await Promise.all([loadQuestionIndex(), loadQuestionStats()]);
    const tl = topic.toLocaleLowerCase('az');
    const match = (q) => { const t = (q.topic || '').toLocaleLowerCase('az'); return (t && (t.includes(tl) || tl.includes(t))) || (q.subtype || '').toLocaleLowerCase('az').includes(tl); };
    const ok = (q) => q.qtype === 'mcq' && (q.teacher_approved || q.ai_status === 'passed' || (!q.ai_status && q.verified !== false));
    const cand = { asan: [], orta: [], 'çətin': [] };
    idx.filter((q) => ok(q) && match(q)).forEach((q) => { const d = realDiff(stats[q.id]) || (DIFF.includes(q.difficulty) ? q.difficulty : 'orta'); cand[d].push(q); });
    const pick = []; const short = { asan: 0, orta: 0, 'çətin': 0 };
    DIFFS.forEach(([k]) => {
      const arr = cand[k].map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const take = arr.slice(0, n[k]);
      take.forEach((q) => pick.push([k, q]));
      short[k] = n[k] - take.length;
    });
    const full = Object.fromEntries((await fullQuestions(pick.map(([, q]) => q.id))).map((q) => [q.id, q]));
    pick.forEach(([k, q]) => { const f = full[q.id] || q; autoState.results.push({ ...f, difficulty: k, _source: 'bank', _id: q.id, _real: !!realDiff(stats[q.id]) }); });
    const real = pick.filter(([, q]) => realDiff(stats[q.id])).length;
    autoState.notes.push(`Bankdan ${pick.length} sual seçildi${real ? ` (${real}-nin çətinliyi tələbələrin real nəticəsinə görədir)` : ''}.`);
    const miss = DIFFS.filter(([k]) => short[k]).map(([k, l]) => `${l.toLowerCase()} ${short[k]}`).join(', ');
    if (miss) {
      if (fill) { autoState.notes.push(`Bankda çatmadı (${miss}) — qalanı AI ilə yaradıldı.`); await autoGenerate(topic, short, status); }
      else autoState.notes.push(`Bankda çatmadı: ${miss}.`);
    }
  }

  async function runBook({ pdf: doc, topic, n, from, to, mode, fill }) {
    const cand = { asan: [], orta: [], 'çətin': [] };
    const enough = () => DIFFS.every(([k]) => cand[k].length >= n[k] + (n[k] ? 1 : 0)); // bir ehtiyat da tapılsın
    const pages = []; for (let p = from; p <= to; p++) pages.push(p);
    const canvases = new Map();
    let scanned = 0; let stop = null;
    const q = makeQueue(3);
    const found = () => DIFFS.map(([k, l]) => `${l.toLowerCase()} ${cand[k].length}`).join(', ');
    status(`Kitab oxunur: 0 / ${pages.length} səhifə…`);
    await Promise.all(pages.map((pn) => q(async () => {
      if (stop || enough()) return;
      try {
        const c = await renderPdfPage(doc, pn);
        const r = await callAI('extract', { image: c.toDataURL('image/jpeg', 0.85), split: true, want: topic });
        const hits = (r.questions || []).filter((x) => x.match && x.box);
        if (hits.length) canvases.set(pn, c);
        hits.forEach((h) => (cand[h.difficulty] || cand.orta).push({ ...h, page: pn }));
      } catch (err) {
        if (err.expected) { stop = err; return; }
        autoState.notes.push(`Səhifə ${pn} oxunmadı: ${err.message}`);
      }
      scanned++;
      status(`Kitab oxunur: ${scanned} / ${pages.length} səhifə · tapıldı: ${found()}`);
    })));
    if (stop) throw stop;
    DIFFS.forEach(([k]) => cand[k].sort((a, b) => a.page - b.page || a.box[1] - b.box[1]));
    const totalFound = DIFFS.reduce((s, [k]) => s + cand[k].length, 0);
    if (!totalFound) autoState.notes.push(`${from}–${to} səhifələrdə «${topic}» mövzusunda sual tapılmadı.`);

    // Hər bölmə üçün lazım olan qədər: alınmayan sualın yerinə növbətisi götürülür
    const short = { asan: 0, orta: 0, 'çətin': 0 };
    let made = 0; const want = DIFFS.reduce((s, [k]) => s + Math.min(n[k], cand[k].length), 0);
    const q2 = makeQueue(3);
    const fillSlot = async (k) => {
      for (let c = cand[k].shift(); c; c = cand[k].shift()) {
        try {
          const qq = await autoFromBook(cropCanvasBox(canvases.get(c.page), c.box), mode, k);
          qq._page = c.page;
          autoState.results.push(qq);
          made++;
          status(`Suallar hazırlanır: ${made} / ${want} (${mode === 'original' ? 'təmiz orijinal' : 'AI bənzər'}, hər biri yoxlanılır)…`);
          renderAuto();
          return;
        } catch (err) {
          if (err.expected) throw err;
          autoState.notes.push(`Səhifə ${c.page}: ${err.message}${cand[k].length ? ' — növbəti sual götürüldü' : ''}`);
        }
      }
      short[k]++;
    };
    status(`Suallar hazırlanır: 0 / ${want}…`);
    await Promise.all(DIFFS.flatMap(([k]) => Array.from({ length: n[k] }, () => q2(() => fillSlot(k)))));
    canvases.clear();
    const miss = DIFFS.filter(([k]) => short[k]).map(([k, l]) => `${l.toLowerCase()} ${short[k]}`).join(', ');
    if (miss) {
      if (fill) {
        autoState.notes.push(`Kitabda çatmadı (${miss}) — qalanı AI ilə yaradıldı.`);
        await autoGenerate(topic, short, status);
      } else autoState.notes.push(`Kitabda çatmadı: ${miss}.`);
    }
  }

  renderAuto();
}

function renderAuto() {
  const box = $('#autoOut');
  if (!box) return;
  const st = autoState;
  const res = st.results;
  const isSel = (q) => (q._sel === undefined ? q.ai_status !== 'draft' && q.ai_status !== 'checking' : q._sel);
  if (!res.length && !st.running) { box.innerHTML = st.notes.length ? `<div class="card"><ul class="warn-list">${st.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''; return; }
  const groups = DIFFS.map(([k, l], gi) => ({ k, l, gi, items: res.map((q, i) => ({ q, i })).filter((x) => (x.q.difficulty || 'orta') === k) })).filter((g) => g.items.length);
  const nSel = res.filter(isSel).length;
  box.innerHTML = `<div class="card stack">
    <div class="row between"><h2>${st.running ? 'Hazırlanır…' : `${esc(st.title.split(' · ')[0])}: ${res.length} sual hazırdır`}</h2>
      ${st.running ? '' : `<div class="row"><button class="btn" id="aPdf">📄 PDF yüklə</button><button class="btn" id="aSave">Banka saxla</button><button class="btn primary" id="aTest">Test yarat ›</button></div>`}</div>
    ${st.running ? `<p class="row small" role="status" aria-live="polite"><span class="spinner sm" aria-hidden="true"></span><span id="autoStatus">${esc(st.status)}</span></p>` : `<p class="small muted">Seçilən: <strong>${nSel}</strong>. Suala basın: tam açılır. Yoxlamadan keçməyənlər (qaralama) seçilməyib — açıb baxın, düzgündürsə təsdiqləyin.</p>`}
    ${st.notes.length ? `<ul class="warn-list">${st.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${groups.map((g) => `<h3 class="dgroup d${g.gi}">${g.l} · ${g.items.length}</h3>
      <div class="mini-grid">${g.items.map(({ q, i }) => `<div class="mini">${miniQ(q, 'a' + i, isSel(q)).replace('<span class="mini-meta">', `<span class="mini-meta"><span class="tag ${q._source === 'ai' ? 'ai' : 'book'}">${q._source === 'book' ? '📖 s.' + (q._page || '') : q._source === 'bank' ? '🗂 bank' + (q._real ? ' · real' : '') : '✨ AI'}</span>`)}</div>`).join('')}</div>`).join('')}
  </div>`;
  bindMini(box, (key) => { const q = res[+key.slice(1)]; return { q, sample: q?._sample || null, onApprove: (on) => { if (on) q._sel = true; renderAuto(); } }; });
  $$('.check', box).forEach((c) => c.onchange = () => { res[+c.dataset.id.slice(1)]._sel = c.checked; renderAuto(); });
  if (st.running) return;
  const chosen = () => res.filter(isSel);
  const saveAll = async (list) => {
    const todo = list.filter((q) => !q._id);
    for (const srcKey of ['book', 'ai']) {
      const part = todo.filter((q) => (q._source || 'ai') === srcKey);
      if (!part.length) continue;
      const ids = await saveQuestions(part.map((q) => { const { _sample, ...rest } = q; return rest; }), srcKey);
      part.forEach((q, i) => { q._id = ids[i]; });
    }
    return list.map((q) => q._id).filter(Boolean);
  };
  $('#aPdf').onclick = () => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    pendingPrint = { questions: list, title: st.title.split(' · ')[0], back: '#/auto' };
    go('#/print');
  };
  $('#aSave').onclick = (e) => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    busy(e.currentTarget, async () => { const ids = await saveAll(list); toast(ids.length + ' sual bankdadır'); }).catch(fail);
  };
  $('#aTest').onclick = (e) => {
    const list = chosen();
    if (!list.length) return toast('Heç bir sual seçilməyib', true);
    busy(e.currentTarget, async () => {
      pendingTestIds = await saveAll(list);
      pendingTestTitle = st.title.split(' · ')[0];
      go('#/newtest');
    }).catch(fail);
  };
}

async function testsView() {
  const [{ data: tests, error }, { data: subs }, { data: studs }] = await Promise.all([
    sb.from('tests').select('*, classes(name)').order('created_at', { ascending: false }),
    sb.from('submissions').select('test_id'),
    sb.from('students').select('id, full_name, class_id')
  ]);
  if (error) throw error;
  const studName = Object.fromEntries((studs || []).map((x) => [x.id, x.full_name]));
  const classSize = {};
  (studs || []).forEach((x) => { if (x.class_id) classSize[x.class_id] = (classSize[x.class_id] || 0) + 1; });
  const subCount = {};
  (subs || []).forEach((s) => { subCount[s.test_id] = (subCount[s.test_id] || 0) + 1; });
  const nOpen = tests.filter((t) => t.is_open).length;
  let tab = nOpen ? 'open' : 'all';
  const tsel = new Set(); let visibleTests = [];

  const card = (t) => {
    const sent = subCount[t.id] || 0;
    const target = t.student_id ? 1 : t.class_id ? classSize[t.class_id] || 0 : 0;
    const pct = target ? Math.min(100, Math.round(sent / target * 100)) : 0;
    const overdue = t.due_at && new Date(t.due_at) < new Date();
    const chips = [
      `<span>${esc(t.classes?.name || 'Qrupsuz')}</span>`,
      `<span>${t.question_ids.length} sual</span>`,
      t.time_limit_min ? `<span>⏱ ${t.time_limit_min} dəq</span>` : '',
      t.due_at ? `<span class="${overdue ? 'tc-late' : ''}">son: ${esc(fmtDue(t.due_at))}${overdue ? ' · keçib' : ''}</span>` : ''
    ].filter(Boolean).join('');
    return `<article class="tcard${t.is_open ? ' is-open' : ''}${tsel.has(t.id) ? ' picked' : ''}">
      <label class="tc-check"><input type="checkbox" data-tsel="${t.id}" ${tsel.has(t.id) ? 'checked' : ''} aria-label="${esc(t.title)} seç"></label>
      <div class="tc-main">
        <div class="tc-top"><span class="tc-status">${t.is_open ? 'Açıq' : 'Bağlı'}</span>${t.kind === 'deneme' ? '<span class="tag deneme">🎯 Deneme</span>' : ''}<span class="small muted">${esc(fmtDue(t.created_at))}</span></div>
        <a class="tc-title" href="#/test/${t.id}">${esc(t.title)}</a>
        <div class="tc-chips">${chips}${t.student_id ? `<span class="tag book">fərdi: ${esc(studName[t.student_id] || 'tələbə')}</span>` : ''}</div>
        <div class="tc-prog">${target
          ? `<span class="tc-bar" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="small"><strong>${sent} / ${target}</strong> tələbə göndərib</span>`
          : `<span class="small"><strong>${sent}</strong> iş göndərilib</span>`}</div>
      </div>
      <div class="tc-act">
        <a class="btn small primary" href="#/test/${t.id}">Nəticələr ›</a>
        <button class="btn small" data-toggle="${t.id}" data-open="${t.is_open}" title="${t.is_open ? 'Tələbələr artıq yaza bilməyəcək' : 'Tələbələr yenə yaza biləcək'}">${t.is_open ? 'Bağla' : 'Yenidən aç'}</button>
        <button class="btn small danger" data-tdel="${t.id}" aria-label="${esc(t.title)} sil">🗑 Sil</button>
      </div>
    </article>`;
  };

  view().innerHTML = `
    <div class="page-head"><div><h1>Testlər</h1><p class="muted">Qrupa bağlı test tələbələrin şəxsi linkində avtomatik görünür.</p></div>
      <div class="row"><a class="btn" href="#/auto">⚡ Avtomatik test</a><a class="btn primary" href="#/newtest">+ Yeni test</a></div></div>
    ${tests.length ? `<div class="seg tseg" role="tablist" aria-label="Testləri süz">
        <button type="button" class="seg-b" data-f="open" role="tab">Açıq <span class="seg-c">${nOpen}</span></button>
        <button type="button" class="seg-b" data-f="closed" role="tab">Bağlı <span class="seg-c">${tests.length - nOpen}</span></button>
        <button type="button" class="seg-b" data-f="all" role="tab">Hamısı <span class="seg-c">${tests.length}</span></button>
      </div>
      <p class="small muted tl-help"><strong>Açıq</strong> — tələbələr testi öz linkində görür və yaza bilir. <strong>Bağlı</strong> — test yazılmağa bağlanır, yeni cavab qəbul edilmir; yazılmış nəticələr qalır. Cavabları "test bağlananda göstər" olan testdə tələbələr düzgün cavabları bağlayanda görür. İstədiyiniz vaxt <strong>Yenidən aç</strong> edə bilərsiniz.</p>
      <div class="bulk-bar" id="tBulk" hidden><span><strong id="tBulkN">0</strong> test seçilib</span><span class="row" style="gap:8px"><button class="btn small" id="tSelAll">Görünənləri seç</button><button class="btn small" id="tSelNone">Seçimi təmizlə</button><button class="btn small danger" id="tBulkDel">🗑 Seçilənləri sil</button></span></div>
      <div class="tlist" id="tlist"></div>` : `<div class="card"><div class="empty">Hələ test yoxdur. <a href="#/newtest">İlk testi yaradın</a>.</div></div>`}`;
  const delTests = async (ids) => {
    const ts = tests.filter((t) => ids.includes(t.id));
    const subsN = ts.reduce((a, t) => a + (subCount[t.id] || 0), 0);
    const who = ts.length === 1 ? `«${ts[0].title}» testi` : `${ts.length} test`;
    if (!confirm(`${who} silinsin?${subsN ? `\n\n${subsN} göndərilmiş nəticə də silinəcək.` : ''} Suallar bankda qalır.\nBunu geri qaytarmaq olmur.`)) return;
    const { error } = await sb.from('tests').delete().in('id', ids);
    if (error) throw error;
    toast(ts.length === 1 ? 'Test silindi' : `${ts.length} test silindi`);
    route();
  };
  const syncBulk = () => { const bar = $('#tBulk'); if (!bar) return; bar.hidden = !tsel.size; $('#tBulkN').textContent = tsel.size; };
  const draw = () => {
    const list = tests.filter((t) => tab === 'all' || (tab === 'open') === !!t.is_open);
    visibleTests = list;
    $$('[data-f]').forEach((b) => { b.classList.toggle('on', b.dataset.f === tab); b.setAttribute('aria-selected', b.dataset.f === tab); });
    $('#tlist').innerHTML = list.length ? list.map(card).join('') : `<div class="card"><div class="empty">${tab === 'open' ? 'Açıq test yoxdur.' : 'Bağlı test yoxdur.'}</div></div>`;
    $$('[data-toggle]').forEach((b) => b.onclick = async () => {
      const { error: err } = await sb.from('tests').update({ is_open: b.dataset.open !== 'true' }).eq('id', b.dataset.toggle);
      if (err) return fail(err);
      route();
    });
    $$('[data-tdel]').forEach((b) => b.onclick = () => delTests([b.dataset.tdel]).catch(fail));
    $$('[data-tsel]').forEach((c) => c.onchange = () => { c.checked ? tsel.add(c.dataset.tsel) : tsel.delete(c.dataset.tsel); c.closest('.tcard').classList.toggle('picked', c.checked); syncBulk(); });
    syncBulk();
  };
  if (tests.length) {
    $$('[data-f]').forEach((b) => b.onclick = () => { tab = b.dataset.f; draw(); });
    $('#tSelAll').onclick = () => { visibleTests.forEach((t) => tsel.add(t.id)); draw(); };
    $('#tSelNone').onclick = () => { tsel.clear(); draw(); };
    $('#tBulkDel').onclick = () => busy($('#tBulkDel'), () => delTests([...tsel])).catch(fail);
    draw();
  }
}

// Yeni test: 1) əsas məlumat 2) suallar (bankdan və ya PDF-dən) 3) yarat
async function newTestView() {
  const [{ data: classes }, questions] = await Promise.all([
    sb.from('classes').select('id, name').order('name'),
    loadQuestionIndex()
  ]);
  const preset = new Set(pendingTestIds);
  pendingTestIds = [];
  const qs = questions || [];
  const topics = [...new Set(qs.map((q) => q.topic).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'az'));

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/tests">Testlər</a> /</div><h1>Yeni test</h1></div><a class="btn" href="#/auto">⚡ Avtomatik test</a></div>
    <form id="newTest" class="stack">
      <section class="card stack"><h2><span class="step-n">1</span> Əsas məlumat</h2>
        <div class="form-grid">
          <label class="field">Testin adı<input type="text" name="title" required maxlength="120" placeholder="məs. Kümeler · qısa yoxlama"></label>
          <label class="field">Növ<select name="kind"><option value="homework">Test / ev tapşırığı</option><option value="deneme">🎯 Deneme (imtahan sınağı)</option></select><span class="hint">Deneme nəticələri tələbənin səhifəsində ayrıca, irəliləyişlə göstərilir.</span></label>
          <label class="field">Qrup<select name="class_id"><option value="">Qrupsuz — ümumi link</option>${(classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><span class="hint">Qrupsuz testdə tələbə adını özü yazır.</span></label>
          ${(classes || []).length > 1 ? `<div class="field" id="moreGroups" hidden><span>Başqa qruplara da göndər<span class="hint">hər qrup üçün ayrıca test yaranır, nəticələr ayrı-ayrı görünür</span></span>
            <div class="chips">${(classes || []).map((c) => `<label class="chip-cb"><input type="checkbox" name="also" value="${c.id}"><span>${esc(c.name)}</span></label>`).join('')}</div></div>` : ''}
          <label class="field">Tələbəyə düzgün cavablar və həll<select name="review_mode">${Object.entries(REVIEW_MODES).map(([k, v]) => `<option value="${k}" ${k === 'after_submit' ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <span class="hint">"Bağlananda" seçsəniz, test açıq olanda cavablar başqalarına ötürülməz.</span></label>
        </div>
        <details class="more-opts"><summary>Vaxt, son tarix, qarışdırma</summary>
          <div class="form-grid" style="margin-top:10px">
            <label class="field">Vaxt limiti (dəqiqə)<input type="number" name="time_limit_min" min="1" max="300" inputmode="numeric" placeholder="limitsiz">
              <span class="hint">Tələbə "Başla" basandan sayılır, bitəndə cavablar avtomatik göndərilir.</span></label>
            <label class="field">Son tarix<input type="datetime-local" name="due_at">
              <span class="hint">Bu vaxtdan sonra cavab qəbul edilmir.</span></label>
            <label class="field row" style="gap:10px;align-items:center;min-height:44px"><input type="checkbox" name="shuffle" style="width:22px;height:22px"> Sualları və variantları hər tələbə üçün qarışdır</label>
          </div>
        </details>
      </section>

      <section class="card stack"><h2><span class="step-n">2</span> Suallar</h2>
        <div class="seg" role="tablist">
          <button type="button" class="seg-b on" data-tab="bank" role="tab">Sual bankından <span class="seg-c" id="cBank">0</span></button>
          <button type="button" class="seg-b" data-tab="pdf" role="tab">Kitabdan / PDF-dən <span class="seg-c" id="cPdf">0</span></button>
        </div>

        <div data-pane="bank" class="stack">
          ${qs.length ? `<div class="row">
              <input type="search" id="tqFind" placeholder="Axtar: mətn və ya mövzu" style="flex:1;min-width:180px">
              ${topics.length ? `<select id="tqTopic" style="min-height:44px;max-width:220px"><option value="">Bütün mövzular</option>${topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select>` : ''}
              <label class="row small" style="gap:6px"><input type="checkbox" id="tqOnly"> Yalnız seçilənlər</label>
            </div>
            <div class="row between"><span class="small muted">Suala basanda tam halı açılır.</span>
              <span class="row"><button type="button" class="btn small" id="tqAll">Görünənləri seç</button><button type="button" class="btn small" id="tqNone">Seçimi sil</button></span></div>
            <div class="mini-grid" id="tqList">
              ${qs.map((q) => `<div class="mini" data-topic="${esc(q.topic || '')}" data-find="${esc(((q.body || '') + ' ' + (q.topic || '') + ' ' + (q.subtype || '')).toLocaleLowerCase('az'))}">${miniQ(q, q.id, preset.has(q.id))}</div>`).join('')}
            </div>` : '<div class="empty">Sual bankı boşdur. "Kitabdan / PDF-dən" bölməsindən sual əlavə edin və ya <a href="#/ai">AI ilə yaradın</a>.</div>'}
        </div>

        <div data-pane="pdf" class="stack" hidden>
          <div class="row between"><p class="muted small" style="margin:0">PDF və ya şəkil aç, sualı barmaqla çərçivəyə al. Aşağıda seçim çıxacaq: təmiz orijinal və ya AI ilə yeni sual.</p>${modelPicker()}</div>
          <div id="tqPicker" class="stack"></div>
          <div id="tqPdf"></div>
        </div>
      </section>

      <div class="sticky-bar">
        <span><strong id="selCount">0</strong> sual seçilib<span class="small muted" id="selSplit"></span></span>
        <button class="btn primary" type="submit">Testi yarat</button>
      </div>
    </form>`;

  const form = $('#newTest');
  if (pendingTestTitle) { $('input[name=title]', form).value = pendingTestTitle; pendingTestTitle = ''; }
  const syncAlso = () => {
    const mg = $('#moreGroups'); if (!mg) return;
    const v = form.class_id.value;
    mg.hidden = !v;
    $$('input[name=also]', mg).forEach((c) => { const self = c.value === v; c.closest('.chip-cb').hidden = self; if (self) c.checked = false; });
  };
  form.class_id.addEventListener('change', syncAlso);
  syncAlso();
  const pdf = pdfQuestions($('#tqPicker'), $('#tqPdf'));
  const countSel = () => {
    const nb = $$('#tqList .check:checked', form).length;
    const np = pdf.selected().length;
    $('#selCount').textContent = nb + np;
    $('#cBank').textContent = nb;
    $('#cPdf').textContent = np;
    $('#selSplit').textContent = nb && np ? ` · bankdan ${nb}, PDF-dən ${np}` : '';
  };
  form.addEventListener('pdfchange', countSel);
  form.addEventListener('change', (e) => { if (e.target.classList.contains('check')) { countSel(); filter(); } });
  $$('[data-tab]').forEach((b) => b.onclick = () => {
    $$('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
  const qById = Object.fromEntries(qs.map((q) => [q.id, q]));
  // sual açılanda tam halı (şəkillərlə) yüklənir
  fullQuestions(qs.slice(0, 60).map((q) => q.id)).then((full) => full.forEach((q) => { qById[q.id] = q; })).catch(() => {});
  bindMini(form, (id) => ({ q: fullCache.get(id) || qById[id] }));
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b && !fullCache.has(b.dataset.open) && qById[b.dataset.open]) {
      e.stopPropagation(); // əvvəl tam halı gəlsin, sonra pəncərə açılsın
      fullQuestions([b.dataset.open]).then(() => b.click()).catch(fail);
    }
  }, true);
  const filter = () => {
    if (!$('#tqFind')) return;
    const t = $('#tqFind').value.trim().toLocaleLowerCase('az');
    const tp = $('#tqTopic')?.value || '';
    const only = $('#tqOnly').checked;
    $$('#tqList .mini').forEach((m) => {
      m.hidden = (t && !m.dataset.find.includes(t)) || (tp && m.dataset.topic !== tp) || (only && !$('.check', m).checked);
    });
  };
  if ($('#tqFind')) {
    $('#tqFind').oninput = filter;
    $('#tqFind').onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
    if ($('#tqTopic')) $('#tqTopic').onchange = filter;
    $('#tqOnly').onchange = filter;
    $('#tqAll').onclick = () => { $$('#tqList .mini:not([hidden]) .check').forEach((c) => { c.checked = true; }); countSel(); };
    $('#tqNone').onclick = () => { $$('#tqList .check').forEach((c) => { c.checked = false; }); countSel(); filter(); };
  }
  bindModelPicker(form);
  countSel();

  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (!String(f.get('title') || '').trim()) { $('input[name=title]', form).focus(); return toast('Testin adını yazın', true); }
    if (pdf.busy()) return toast('PDF sualları hələ hazırlanır, bir az gözləyin', true);
    const ids = $$('#tqList .check:checked', form).map((c) => c.dataset.id);
    const extra = pdf.selected();
    if (!ids.length && !extra.length) return toast('Ən azı bir sual seçin', true);
    busy($('button[type=submit]', form), async () => {
      for (const src of ['book', 'ai']) {
        const list = extra.filter((q) => q._source === src);
        if (list.length) ids.push(...await saveQuestions(list, src));
      }
      const rec = { title: f.get('title').trim(), class_id: f.get('class_id') || null, question_ids: ids };
      if (f.get('review_mode') && f.get('review_mode') !== 'never') rec.review_mode = f.get('review_mode');
      const tl = parseInt(f.get('time_limit_min'), 10);
      if (tl > 0) rec.time_limit_min = Math.min(300, tl);
      if (f.get('due_at')) rec.due_at = new Date(f.get('due_at')).toISOString();
      if (f.get('shuffle')) rec.shuffle = true;
      if (f.get('kind') === 'deneme') rec.kind = 'deneme';
      const needs7 = rec.time_limit_min || rec.due_at || rec.shuffle;
      const also = rec.class_id ? f.getAll('also').filter((c) => c && c !== rec.class_id) : [];
      const recs = [rec, ...also.map((c) => ({ ...rec, class_id: c }))];
      const { data: rows, error: err } = await sb.from('tests').insert(recs).select();
      if (err) throw needSql(err, rec.kind ? '012_student_insights.sql' : needs7 ? '007_test_rules.sql' : '006_review.sql');
      const row = (rows || [])[0];
      toast(recs.length > 1 ? `Test ${recs.length} qrupa göndərildi` : 'Test yaradıldı');
      go(recs.length > 1 ? '#/tests' : '#/test/' + row.id);
    }).catch(fail);
  };
}

// ================= Tələbə işinin baxışı (müəllim və tələbə üçün ortaq) =================
const normAns = (v) => String(v ?? '').trim().toLowerCase();
function answerState(q, given) {
  if (given === undefined || given === null || String(given).trim() === '') return 'empty';
  if (q.qtype !== 'mcq') return 'open';
  return normAns(given) === normAns(q.answer) ? 'right' : 'wrong';
}
const STATE_TAG = { right: ['ai', '✓ Düz'], wrong: ['red', '✗ Səhv'], empty: ['', '— Cavab verilməyib'], open: ['amber', 'Açıq sual'] };
const REVIEW_MODES = { never: 'Göstərmə', after_submit: 'Göndərən kimi göstər', after_close: 'Test bağlananda göstər' };

// Bir sual: tələbənin cavabı, düzgün cavab, həll
function reviewQuestionHtml(q, given, i, { you = 'Sənin cavabın' } = {}) {
  const st = answerState(q, given);
  const [cls, txt] = STATE_TAG[st];
  const figs = hasOptionFigures(q);
  const opts = q.qtype === 'mcq' && (q.options || []).length
    ? `<ul class="opts rv-opts${figs ? ' fig-opts' : ''}">${q.options.map((o, j) => {
        const isRight = normAns(o) === normAns(q.answer);
        const isGiven = normAns(o) === normAns(given);
        return `<li class="${isRight ? 'correct' : ''} ${isGiven && !isRight ? 'wrong' : ''}"><span class="opt-l">${'ABCDEF'[j]})</span>${figs ? `<span class="opt-fig">${safeSvg(q.option_figures[j])}</span>` : `<span>${esc(o)}</span>`}${isGiven ? `<span class="rv-mark">← ${esc(you.toLowerCase())}</span>` : ''}</li>`;
      }).join('')}</ul>`
    : `<div class="small"><strong>${esc(you)}:</strong> ${given ? esc(given) : '—'}</div>${q.answer ? `<div class="small"><strong>Gözlənilən cavab:</strong> ${esc(q.answer)}</div>` : ''}`;
  return `<div class="rv-q rv-${st}" data-rq="${esc(q.id)}">
    <div class="row"><strong>${i + 1}.</strong><span class="tag ${cls}">${txt}</span></div>
    <div class="q-text">${esc(q.body)}</div>
    ${q.figure ? `<div class="q-fig">${safeSvg(q.figure)}</div>` : ''}
    ${opts}
    ${q.solution ? `<details class="sol"><summary>Həlli göstər</summary><div>${esc(q.solution)}</div></details>` : ''}
  </div>`;
}

// Kiçik xanalar: hər sual üçün ✓ ✗ —
function cellsHtml(questions, answers) {
  return `<span class="cells">${questions.map((q, i) => {
    const st = answerState(q, answers?.[q.id]);
    return `<span class="cell c-${st}" title="${i + 1}: ${STATE_TAG[st][1]}">${i + 1}</span>`;
  }).join('')}</span>`;
}

function countStates(questions, answers) {
  const c = { right: 0, wrong: 0, empty: 0, open: 0 };
  questions.forEach((q) => { c[answerState(q, answers?.[q.id])]++; });
  return c;
}

function openDialog(title, html) {
  let dlg = document.getElementById('rvDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'rvDialog';
    dlg.className = 'q-dialog';
    $app.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  dlg.innerHTML = `<div class="q-dialog-in">
    <div class="row between"><h2>${title}</h2><button type="button" class="btn small" data-close>✕ Bağla</button></div>${html}</div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  dlg.showModal();
}

// Müəllim üçün: bir tələbənin bir testdəki işi
// Tələbənin sual üzərində yazdığı həlləri pəncərəyə əlavə et (015 yoxdursa heç nə)
async function attachDrawings(dlg, subId) {
  const { data, error } = await sb.from('submission_drawings').select('question_id, image').eq('submission_id', subId);
  if (error || !data || !dlg) return;
  let n = 0;
  data.forEach((d) => {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(d.image)) return;
    const box = dlg.querySelector(`[data-rq="${CSS.escape(d.question_id)}"]`);
    if (!box) return;
    const w = document.createElement('div');
    w.className = 'rv-ink';
    w.innerHTML = '<div class="small"><strong>✏️ Tələbənin həlli</strong> <span class="muted">— basın, böyüsün</span></div>';
    const img = document.createElement('img');
    img.src = d.image; img.alt = 'Tələbənin həlli'; img.loading = 'lazy';
    img.onclick = () => img.classList.toggle('big');
    w.appendChild(img);
    box.appendChild(w);
    n++;
  });
  const p = dlg.querySelector('p.muted');
  if (n && p) p.insertAdjacentHTML('beforeend', ` · <span class="tag deneme">✏️ ${n} sualda həll yazıb</span>`);
}

function submissionDetailHtml(questions, sub) {
  const c = countStates(questions, sub.answers);
  return `<p class="muted">${fmtDate(sub.created_at)} · bal <strong>${sub.score}/${sub.total}</strong> ·
      <span class="tag ai">✓ ${c.right}</span> <span class="tag red">✗ ${c.wrong}</span> <span class="tag">— ${c.empty}</span>${c.open ? ` <span class="tag amber">açıq ${c.open}</span>` : ''}</p>
    <div class="stack">${questions.map((q, i) => reviewQuestionHtml(q, sub.answers?.[q.id], i, { you: 'Tələbənin cavabı' })).join('')}</div>`;
}

// ================= Test üçün PDF-dən sual: təmiz orijinal və ya AI ilə yeni =================
// picker: seçici yeri; out: nəticə kartları. Qaytarır: { busy(), selected() }
const fmtElapsed = (t0) => { const sec = Math.floor((Date.now() - t0) / 1000); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

function pdfQuestions(pickerRoot, out) {
  const jobs = [];
  const run = makeQueue(3);
  let crop = null; // son kəsik: { image }
  const MODE_LABEL = { original: 'Təmiz orijinal', benzer: 'AI · bənzər', ferqli: 'AI · yeni quruluş' };

  const panel = document.createElement('div');
  panel.className = 'crop-choice';
  panel.hidden = true;
  $app.appendChild(panel);
  const closePanel = () => { panel.hidden = true; crop = null; picker.clearSelection(); };
  const showPanel = (step = 'main') => {
    panel.innerHTML = `<img src="${crop.image}" alt="Seçilən sual">
      <div class="stack" style="gap:8px;flex:1;min-width:0">
        ${step === 'main' ? `<strong>Bu sualla nə edək?</strong>
          <div class="row"><button type="button" class="btn primary" data-pick="original">Orijinalı təmiz çıxart</button>
          <button type="button" class="btn primary" data-step="ai">AI ilə yarat</button>
          <button type="button" class="btn" data-cancel>Ləğv et</button></div>`
        : `<strong>AI ilə yarat</strong>
          <div class="row"><label class="row small" style="gap:6px">Say <select data-n style="min-height:40px">${[1, 2, 3].map((n) => `<option>${n}</option>`).join('')}</select></label>
          <button type="button" class="btn primary" data-pick="benzer">Bənzər</button>
          <button type="button" class="btn primary" data-pick="ferqli">Yeni quruluş</button>
          <button type="button" class="btn" data-step="main">‹ Geri</button></div>`}
      </div>`;
    panel.hidden = false;
    $$('[data-step]', panel).forEach((b) => b.onclick = () => showPanel(b.dataset.step));
    const c = $('[data-cancel]', panel); if (c) c.onclick = closePanel;
    $$('[data-pick]', panel).forEach((b) => b.onclick = () => {
      const n = +($('[data-n]', panel)?.value || 1);
      startJob(crop.image, b.dataset.pick, n);
      closePanel();
    });
  };

  // Səhifə nömrəsində Enter testi göndərməsin
  pickerRoot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const picker = createPicker(pickerRoot, {
    label: 'PDF və ya şəkil aç',
    hint: 'Sual çərçivəyə alınanda seçim pəncərəsi aşağıda açılır.',
    onCrop: (api) => { crop = { image: api.dataUrl(1600) }; showPanel(); }
  });

  // Yoxla; keçməsə bir dəfə yenidən cəhd; yenə keçməsə qaralama
  const settle = async (job, q, remake) => {
    let cur = q;
    job.lap?.('yazma');
    job.step = 'yoxlanılır';
    render();
    let ok = await checkQuestion(cur, { mode: job.mode, sample: job.sample });
    job.lap?.('yoxlama');
    render();
    if (!ok) {
      const fb = [cur.verify_note, cur.fit_note].filter(Boolean).join('; ');
      let repl = null;
      job.step = 'yoxlamadan keçmədi, yenidən hazırlanır';
      render();
      try { repl = await remake(fb); } catch (err) { job.errors.push(err.message); }
      if (repl) {
        job.step = 'yenidən yoxlanılır';
        job.questions[job.questions.indexOf(cur)] = repl;
        cur = repl;
        render();
        ok = await checkQuestion(cur, { mode: job.mode, sample: job.sample });
      }
    }
    if (!ok) cur.ai_status = 'draft';
    render();
  };

  const prep = (x, job) => ({ ...x, _uid: ++qSeq, _source: job.mode === 'original' ? 'book' : 'ai', ai_status: 'checking' });

  function startJob(image, mode, n) {
    const job = { id: ++qSeq, model: currentModel(), image, mode, n, state: 'reading', step: 'şəkil oxunur', t0: Date.now(), times: {}, questions: [], errors: [], warnings: [], sample: null, helper: '' };
    let tStep = Date.now();
    const lap = (name) => { job.times[name] = (job.times[name] || 0) + (Date.now() - tStep); tStep = Date.now(); };
    job.lap = lap;
    jobs.push(job);
    render();
    run(async () => {
      const d = await callAI('tryos_analyze', { image, text: '' });
      lap('oxuma');
      job.helper = d._helper || '';
      const a = d.analysis;
      job.sample = { text: d.text, image, topic: a.topic, section: a.section, analysis: a };
      (a.uncertain || []).forEach((u) => job.warnings.push('qeyri-müəyyən: ' + u));
      if (a.conflict) job.warnings.push('ziddiyyət: ' + a.conflict);
      if (!a.complete) { job.state = 'incomplete'; render(); return; }
      job.state = 'working';
      job.step = mode === 'original' ? 'yenidən yazılır, şəkillər çəkilir' : 'suallar yaradılır';
      render();
      if (mode === 'original') {
        const make = async (feedback = '') => {
          const r = await callAI('clean_copy', { image, text: d.text, analysis: a, feedback });
          const q = prep(r.questions[0], job);
          (q.unreadable || []).forEach((u) => job.warnings.push('oxunmadı: ' + u));
          return q;
        };
        const q = await make();
        job.questions.push(q);
        render();
        await settle(job, q, make);
      } else {
        const make = async (count, feedback = '') => {
          const r = await callAI('tryos_from_examples', {
            samples: [job.sample], mode, perSample: count, feedback,
            avoid: job.questions.map((x) => x.body.replace(/\s+/g, ' ').slice(0, 180))
          });
          (r.rejected || []).forEach((x) => job.errors.push('rədd edildi: ' + x.reason));
          return r.questions.slice(0, count).map((x) => prep(x, job));
        };
        const settles = [];
        for (let left = n; left > 0; left -= CHUNK) {
          const got = await make(Math.min(CHUNK, left));
          got.forEach((q) => { job.questions.push(q); settles.push(settle(job, q, async (fb) => (await make(1, fb))[0])); });
          render();
        }
        await Promise.all(settles);
        if (job.questions.length < n) job.errors.push(`${n} sual istənildi, ${job.questions.length} alındı`);
      }
      job.state = 'done';
      job.total = Date.now() - job.t0;
      render();
    }).catch((err) => { job.state = 'error'; job.total = Date.now() - job.t0; job.errors.push(err.message); render(); });
  }

  const allQs = () => jobs.flatMap((j) => j.questions);
  const isSel = (q) => (q._sel === undefined ? defaultChecked(q) || !!q.teacher_approved : q._sel);

  function render() {
    if (!out.isConnected) return;
    if (!jobs.length) { out.innerHTML = ''; return; }
    const stateTag = { reading: ['', 'oxunur…'], working: ['', 'hazırlanır…'], done: ['ai', 'hazır'], error: ['red', 'alınmadı'], incomplete: ['red', 'natamam kəsik'] };
    out.innerHTML = `<div class="stack" style="gap:10px">${jobs.map((j) => {
      const [cls, txt] = stateTag[j.state];
      return `<div class="pdf-job">
        <img src="${j.image}" alt="Kitabdakı sual">
        <div class="stack" style="gap:6px;flex:1;min-width:0">
          <div class="row"><span class="tag book">${MODE_LABEL[j.mode]}${j.mode === 'original' ? '' : ' · ' + j.n}</span><span class="tag ${cls}">${txt}</span>
            ${j.state === 'reading' || j.state === 'working' ? `<span class="small muted" data-elapsed="${j.t0}">${esc(j.step)} · ${fmtElapsed(j.t0)}</span>`
              : j.total ? `<span class="small muted">${fmtElapsed(Date.now() - j.total)}${Object.keys(j.times).length ? ' · ' + Object.entries(j.times).map(([k, v]) => `${k} ${Math.round(v / 1000)}s`).join(', ') : ''}</span>` : ''}
            <button type="button" class="btn small" data-rmjob="${j.id}" style="margin-left:auto">Sil</button></div>
          ${j.helper && j.helper !== 'sonnet' && j.helper !== j.model ? `<p class="small" style="color:#8A5A00">Seçilən model cavab vermədi — köməkçi işləri ehtiyat model (${esc(HELPER_NAME[j.helper] || j.helper)}) görür, daha yavaş ola bilər.</p>` : ''}
          ${j.state === 'incomplete' ? '<p class="small" style="color:var(--red)">Kəsik natamamdır: şərt, şəkil və ya variantlar çatışmır. Sualı tam çərçivəyə alıb yenidən seçin.</p>' : ''}
          ${j.warnings.length ? `<ul class="warn-list">${j.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          ${j.errors.length ? `<p class="small" style="color:var(--red)">${j.errors.map(esc).join('<br>')}</p>` : ''}
          <div class="mini-grid">${j.questions.map((q) => `<div class="mini">${miniQ(q, 'p' + q._uid, isSel(q))}</div>`).join('')}</div>
        </div></div>`;
    }).join('')}</div>`;
    const byKey = Object.fromEntries(jobs.flatMap((j) => j.questions.map((q) => ['p' + q._uid, {
      q, sample: j.sample || { image: j.image },
      onApprove: q.ai_status === 'checking' ? null : (on) => { if (on) q._sel = true; render(); }
    }])));
    bindMini(out, (k) => byKey[k] || {});
    $$('.check', out).forEach((c) => c.onchange = () => { const it = byKey[c.dataset.id]; if (it) it.q._sel = c.checked; out.dispatchEvent(new Event('pdfchange', { bubbles: true })); });
    $$('[data-rmjob]', out).forEach((b) => b.onclick = () => {
      const i = jobs.findIndex((j) => j.id === +b.dataset.rmjob);
      if (i >= 0) jobs.splice(i, 1);
      render();
    });
    out.dispatchEvent(new Event('pdfchange', { bubbles: true }));
  }

  const tick = setInterval(() => {
    if (!out.isConnected) return clearInterval(tick);
    $$('[data-elapsed]', out).forEach((el) => { el.textContent = el.textContent.replace(/· [\d:]+$/, '· ' + fmtElapsed(+el.dataset.elapsed)); });
  }, 1000);
  // səhifədən çıxanda panel qalmasın
  window.addEventListener('hashchange', () => panel.remove(), { once: true });

  return {
    busy: () => jobs.some((j) => j.state === 'reading' || j.state === 'working'),
    selected: () => allQs().filter((q) => q.ai_status !== 'checking' && isSel(q)),
    count: () => jobs.length,
    // saxlanılan sualları siyahıdan çıxar; boş qalan bitmiş işləri də
    remove(list) {
      const set = new Set(list);
      jobs.forEach((j) => { j.questions = j.questions.filter((q) => !set.has(q)); });
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'done' && !jobs[i].questions.length) jobs.splice(i, 1);
      render();
    }
  };
}

// ================= Nəticə analizi =================
// rows: [{ test, sub, questions }] → mövzular üzrə statistika
function topicStats(rows) {
  const m = {};
  rows.forEach(({ sub, questions }) => questions.forEach((q) => {
    if (q.qtype !== 'mcq') return;
    const k = q.topic || 'Mövzusuz';
    m[k] = m[k] || { topic: k, right: 0, total: 0 };
    m[k].total++;
    if (answerState(q, sub.answers?.[q.id]) === 'right') m[k].right++;
  }));
  return Object.values(m).map((x) => ({ ...x, pct: x.total ? Math.round(x.right / x.total * 100) : 0 })).sort((a, b) => a.pct - b.pct);
}
const pctColor = (p) => (p >= 75 ? 'var(--green)' : p >= 50 ? '#B7791F' : 'var(--red)');
function topicBarsHtml(stats, empty = 'Hələ məlumat yoxdur.') {
  if (!stats.length) return `<div class="empty">${empty}</div>`;
  return `<div class="tbars">${stats.map((t) => `<div class="tbar"><span class="tbar-l">${esc(t.topic)}</span>
    <span class="tbar-b"><i style="width:${t.pct}%;background:${pctColor(t.pct)}"></i></span>
    <span class="tbar-v"><strong>${t.pct}%</strong> <span class="muted">${t.right}/${t.total}</span></span></div>`).join('')}</div>`;
}
// Testlər üzrə nəticə: sütunlar (xronoloji)
function trendHtml(points) {
  if (!points.length) return '<div class="empty">Hələ məlumat yoxdur.</div>';
  return `<div class="trend">${points.map((p) => `<div class="trend-c" title="${esc(p.label)}: ${p.pct}%">
      <span class="trend-v">${p.pct}%</span><span class="trend-b"><i style="height:${Math.max(3, p.pct)}%;background:${pctColor(p.pct)}"></i></span>
      <span class="trend-l">${esc(p.label)}</span></div>`).join('')}</div>`;
}
const subPct = (sub) => (sub.total ? Math.round(sub.score / sub.total * 100) : 0);

async function classAnalysisView(classId) {
  const [{ data: cls, error }, { data: students }, { data: tests }] = await Promise.all([
    sb.from('classes').select('*').eq('id', classId).single(),
    sb.from('students').select('id, full_name').eq('class_id', classId).order('full_name'),
    sb.from('tests').select('*').eq('class_id', classId).order('created_at')
  ]);
  if (error) throw error;
  const tIds = (tests || []).map((t) => t.id);
  const { data: subs } = tIds.length ? await sb.from('submissions').select('*').in('test_id', tIds) : { data: [] };
  const qIds = [...new Set((tests || []).flatMap((t) => t.question_ids))];
  const { data: qs } = qIds.length ? await sb.from('questions').select('*').in('id', qIds) : { data: [] };
  const qById = Object.fromEntries((qs || []).map((q) => [q.id, q]));
  const testById = Object.fromEntries((tests || []).map((t) => [t.id, { ...t, questions: t.question_ids.map((x) => qById[x]).filter(Boolean) }]));
  const rows = (subs || []).map((sub) => ({ test: testById[sub.test_id], sub, questions: testById[sub.test_id]?.questions || [] })).filter((r) => r.test);
  const byName = Object.fromEntries((students || []).map((x) => [x.full_name.trim().toLocaleLowerCase('az'), x.id]));
  const sid = (sub) => sub.student_id || byName[sub.student_name.trim().toLocaleLowerCase('az')] || null;

  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + subPct(r.sub), 0) / rows.length) : null;
  const trend = (tests || []).filter((t) => !t.student_id).map((t) => {
    const rs = rows.filter((r) => r.test.id === t.id);
    return rs.length ? { label: t.title, pct: Math.round(rs.reduce((a, r) => a + subPct(r.sub), 0) / rs.length), n: rs.length } : null;
  }).filter(Boolean);
  const topics = topicStats(rows);

  // ən çox səhv edilən suallar
  const qAgg = {};
  rows.forEach(({ sub, questions, test }) => questions.forEach((q) => {
    if (q.qtype !== 'mcq') return;
    const a = qAgg[q.id] = qAgg[q.id] || { q, test, titles: new Set(), n: 0, right: 0, wrong: {}, empty: 0 };
    a.titles.add(test.title);
    a.n++;
    const g = sub.answers?.[q.id];
    const st = answerState(q, g);
    if (st === 'right') a.right++;
    else if (st === 'empty') a.empty++;
    else { const L = 'ABCDEF'[q.options.findIndex((o) => normAns(o) === normAns(g))] || '?'; a.wrong[L] = (a.wrong[L] || 0) + 1; }
  }));
  const hard = Object.values(qAgg).filter((a) => a.n >= 2).map((a) => ({ ...a, pct: Math.round(a.right / a.n * 100) }))
    .sort((x, y) => x.pct - y.pct).slice(0, 8).filter((a) => a.pct < 100);

  const studentRows = (students || []).map((st) => {
    const rs = rows.filter((r) => sid(r.sub) === st.id).sort((a, b) => (a.sub.created_at < b.sub.created_at ? -1 : 1));
    const tp = topicStats(rs).filter((t) => t.total >= 2);
    return { st, n: rs.length, avg: rs.length ? Math.round(rs.reduce((a, r) => a + subPct(r.sub), 0) / rs.length) : null,
      last: rs.slice(-6).map((r) => subPct(r.sub)), weak: tp[0] && tp[0].pct < 60 ? tp[0] : null };
  }).sort((a, b) => (a.avg ?? 101) - (b.avg ?? 101));

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/classes">Qruplar</a> / <a href="#/class/${classId}">${esc(cls.name)}</a> /</div><h1>Analiz · ${esc(cls.name)}</h1></div></div>
    <section class="grid">
      <div class="card stat"><div class="label">Test</div><div class="value">${(tests || []).length}</div></div>
      <div class="card stat"><div class="label">Göndərilən iş</div><div class="value">${rows.length}</div></div>
      <div class="card stat"><div class="label">Qrupun ortası</div><div class="value">${avg === null ? '—' : avg + '%'}</div></div>
    </section>
    <section class="card stack"><h2>Testlər üzrə orta nəticə</h2>${trendHtml(trend)}</section>
    <section class="card stack"><h2>Mövzular <span class="small muted">(zəifdən güclüyə)</span></h2>${topicBarsHtml(topics)}</section>
    <section class="card stack"><h2>Ən çox səhv edilən suallar</h2>
      ${hard.length ? `<div class="stack" style="gap:8px">${hard.map((a, i) => {
        const top = Object.entries(a.wrong).sort((x, y) => y[1] - x[1])[0];
        return `<button type="button" class="hard-q" data-hard="${i}">
          <span class="tag ${a.pct < 50 ? 'red' : 'amber'}">${a.pct}% düz</span>
          <span class="hard-t">${esc(a.q.body.replace(/\s+/g, ' ').slice(0, 120))}</span>
          <span class="small muted">${a.titles.size > 1 ? a.titles.size + ' testdə' : esc(a.test.title)} · ${a.n} cavab${top ? ` · ən çox seçilən səhv: <strong>${top[0]}</strong> (${top[1]})` : ''}${a.empty ? ` · boş: ${a.empty}` : ''}</span></button>`;
      }).join('')}</div>` : '<div class="empty">Hələ kifayət qədər cavab yoxdur.</div>'}
    </section>
    <section class="card stack"><h2>Tələbələr <span class="small muted">(köməyə ehtiyacı olanlar yuxarıda)</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Tələbə</th><th>Test</th><th>Orta</th><th>Son nəticələr</th><th>Zəif mövzu</th></tr></thead><tbody>
      ${studentRows.map((r) => `<tr><td><a href="#/student/${r.st.id}">${esc(r.st.full_name)}</a></td><td>${r.n}</td>
        <td>${r.avg === null ? '—' : `<strong style="color:${pctColor(r.avg)}">${r.avg}%</strong>`}</td>
        <td><span class="spark">${r.last.map((p) => `<i style="height:${Math.max(18, p)}%;background:${pctColor(p)}" title="${p}%"></i>`).join('')}</span></td>
        <td>${r.weak ? `<span class="tag red">${esc(r.weak.topic)} · ${r.weak.pct}%</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;
  $$('[data-hard]').forEach((b) => b.onclick = () => {
    const a = hard[+b.dataset.hard];
    openDialog('Sual · ' + esc(a.test.title), questionHtml(a.q));
  });
}

// Müəllim üçün: bir tələbənin bütün işləri
// ================= Dərs və ödəniş dəftəri (yalnız müəllim) =================
// Ödəniş AYLIQDIR: tələbəyə aylıq məbləğ və ödəniş günü (ayın neçəsi) yazılır. Davamiyyət (gəldi/gəlmədi) pula təsir etmir.
const money = (n) => `${(Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '')} ₼`;
const ymOf = (d) => String(d || '').slice(0, 7);
const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); const n = AZ_MONTHS_FULL[m - 1]; return `${n[0].toLocaleUpperCase('az')}${n.slice(1)} ${y}`; };
const monthName = (ym) => ymLabel(ym).split(' ')[0];
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftYm = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dueDateOf = (ym, day) => { const [y, m] = ym.split('-').map(Number); const dd = Math.min(Math.max(1, day || 1), new Date(y, m, 0).getDate()); return `${ym}-${String(dd).padStart(2, '0')}`; };
let lessonsYm = '';
let lessonsMode = 'attendance';
let lessonsDate = '';
let lessonsCls = null; // null — hələ seçilməyib (bu günün cədvəlinə görə özü seçilir)
let ledgerNeeds016 = false;

async function loadLedger() {
  const cols = 'id, full_name, class_id, lesson_price, pay_day, billing_start, classes(name)';
  let st = await sb.from('students').select(cols).order('full_name');
  if (st.error && /pay_day|billing_start/i.test(st.error.message || '')) { ledgerNeeds016 = true; st = await sb.from('students').select('id, full_name, class_id, lesson_price, classes(name)').order('full_name'); }
  const [ls, ps] = await Promise.all([
    sb.from('lessons').select('*').order('lesson_date', { ascending: false }),
    sb.from('payments').select('*').order('paid_on', { ascending: false })
  ]);
  const err = st.error || ls.error || ps.error;
  if (err) throw /lesson_price|lessons|payments|schema cache|does not exist/i.test(err.message || '')
    ? Object.assign(new Error('need013'), { need013: true }) : err;
  return { students: st.data || [], lessons: ls.data || [], payments: ps.data || [] };
}

// Aylıq hesab: ödəniş günü çatmış hər ay üçün aylıq məbləğ; ödənişlər köhnə aydan başlayaraq bağlanır
function billingOf(x, L, ym) {
  const fee = Number(x.lesson_price || 0);
  const ps = L.payments.filter((p) => p.student_id === x.id);
  const ls = L.lessons.filter((l) => l.student_id === x.id);
  const paid = ps.reduce((a, p) => a + Number(p.amount || 0), 0);
  const today = todayIso(), curYm = today.slice(0, 7);
  const start = ymOf(x.billing_start) || curYm;
  const last = ym > curYm ? ym : curYm;
  const months = [];
  if (fee > 0) for (let m = start; m <= last && months.length < 120; m = shiftYm(m, 1)) months.push({ ym: m, due: dueDateOf(m, x.pay_day) });
  let left = paid;
  months.forEach((m) => { m.paid = Math.min(fee, Math.max(0, left)); left -= fee; m.full = m.paid >= fee - 0.004; m.overdue = !m.full && m.due <= today; });
  const owed = months.filter((m) => m.due <= today).length * fee;
  const mLs = ls.filter((l) => ymOf(l.lesson_date) === ym);
  return { fee, ps, ls, paid, balance: owed - paid, months, sel: months.find((m) => m.ym === ym) || null, next: months.find((m) => !m.full) || null,
    came: mLs.filter((l) => l.status === 'came').length, missed: mLs.filter((l) => l.status === 'missed').length,
    mPaid: ps.filter((p) => ymOf(p.paid_on) === ym).reduce((a, p) => a + Number(p.amount || 0), 0) };
}
function monthChip(g, ym) {
  if (!g.fee) return '<span class="pchip">aylıq məbləğ yazılmayıb</span>';
  const m = g.sel;
  if (!m) return '<span class="pchip">—</span>';
  if (m.full) return `<span class="pchip hi">✓ ${esc(monthName(ym))} ödənilib</span>`;
  if (m.overdue) return `<span class="pchip low">Gecikir · ${money(g.fee - m.paid)}</span>`;
  return `<span class="pchip mid">Gözlənilir · ${esc(fmtDayAz(m.due))}${m.paid > 0 ? ` (${money(m.paid)} ödənilib)` : ''}</span>`;
}
const balanceChip = (b) => (b > 0.004 ? `<span class="pchip low">Borc: ${money(b)}</span>` : b < -0.004 ? `<span class="pchip hi">Avans: ${money(-b)}</span>` : '<span class="pchip">Borc yoxdur</span>');

// Son əməli geri almaq üçün aşağıda çıxan zolaq
function showUndo(msg, fn) {
  let bar = document.getElementById('undoBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'undoBar'; bar.className = 'undo-bar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  bar.innerHTML = `<span>${esc(msg)}</span><button type="button" class="btn small" data-undo>↶ Geri al</button><button type="button" class="btn small" data-dismiss-undo aria-label="Bildirişi bağla">✕</button>`;
  bar.hidden = false;
  $('[data-dismiss-undo]',bar).onclick=()=>{bar.hidden=true;};
  const button=$('[data-undo]',bar);
  button.onclick=async()=>{
    if(button.disabled)return;
    button.disabled=true;
    try { await fn(); if(button.isConnected)bar.hidden=true; toast('Geri alındı'); }
    catch(err){button.disabled=false;fail(err);}
  };
}

async function lessonsView() {
  if (!lessonsYm) lessonsYm = todayIso().slice(0, 7);
  if (!lessonsDate) lessonsDate = todayIso();
  let L;
  try { L = await loadLedger(); } catch (err) {
    if (!err.need013) throw err;
    view().innerHTML = `<div class="page-head"><div><h1>Dərslər</h1></div></div><p class="notice">Dərs və ödəniş dəftəri üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>013_lessons.sql</strong> → Run.</p>`;
    return;
  }
  const ym = lessonsYm;
  const classes = [...new Map(L.students.map((x) => [x.class_id, x.classes?.name || ''])).entries()];
  // qrupların dərs cədvəli (018 yoxdursa — cədvəlsiz işləyir)
  let schedClasses = [];
  { const r = await sb.from('classes').select('id, name, schedule'); if (!r.error) schedClasses = r.data || []; }
  const agenda = () => scheduleAgenda(schedClasses, L.lessons, L.students);
  if (lessonsCls === null) {
    const a = agenda();
    lessonsCls = a.pick && classes.length > 1 ? a.pick.c.id : '';
    if (a.pick) lessonsDate = todayIso();
  }
  let cls = lessonsCls;
  const draw = () => {
    const date = lessonsDate;
    const ag = agenda();
    const selSlots = cls ? schedSlots(schedClasses.find((c) => c.id === cls)).filter((x) => x.d === isoDow(date)) : [];
    const list = L.students.filter((x) => !cls || x.class_id === cls);
    const rows = list.map((x) => ({ x, g: billingOf(x, L, ym), day: L.lessons.find((l) => l.student_id === x.id && l.lesson_date === date) || null }));
    const sum = rows.reduce((a, r) => ({ exp: a.exp + (r.g.sel ? r.g.fee : 0), paid: a.paid + r.g.mPaid, debt: a.debt + Math.max(0, r.g.balance),
      came: a.came + (r.day?.status === 'came' ? 1 : 0), missed: a.missed + (r.day?.status === 'missed' ? 1 : 0) }), { exp: 0, paid: 0, debt: 0, came: 0, missed: 0 });
    view().innerHTML = `
      <div class="lesson-workspace" data-mode="${lessonsMode}">
      <div class="page-head"><div><span class="ls-eyebrow">DƏRS DƏFTƏRİ</span><h1>Dərslər</h1><p class="muted">Davamiyyəti qeyd et, aylıq ödənişləri ayrıca izlə.</p></div></div>
      <div class="ls-tabs" role="group" aria-label="Dərs dəftərinin bölmələri"><button class="btn" data-ls-mode="attendance" aria-pressed="${lessonsMode==='attendance'}">Davamiyyət <span>Kim gəlib, kim gəlməyib?</span></button><button class="btn" data-ls-mode="payments" aria-pressed="${lessonsMode==='payments'}">Ödənişlər <span>Aylıq məbləğ və ödəniş qeydi</span></button></div>
      <div class="ls-guide"><strong>${lessonsMode==='attendance'?'1. Dərs gününü seç → 2. Gəldi / Gəlmədi işarələ':'1. Tələbəni seç → 2. Ödəniş qeyd et → 3. Məbləği təsdiqlə'}</strong><p>${lessonsMode==='attendance'?'Davamiyyət ödəniş hesabını dəyişmir. Səhv qeydi qarşı düymə ilə dəyişə və ya “Qeydi sil” ilə təmizləyə bilərsən.':'Yalnız qəbul etdiyin pulu qeyd et. Aylıq məbləği dəyişmək ödəniş yazmaq demək deyil.'}</p></div>
      ${ledgerNeeds016 ? '<p class="notice">Aylıq ödəniş günü üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>016_monthly.sql</strong> → Run.</p>' : ''}
      <div class="month-bar"><button class="btn small ls-payment-only" data-ym="-1" aria-label="Əvvəlki ay">‹</button><strong class="ls-payment-only">${esc(ymLabel(ym))}</strong><button class="btn small ls-payment-only" data-ym="1" aria-label="Növbəti ay">›</button>
        ${classes.length > 1 ? `<select id="lsClass" aria-label="Qrup" style="min-height:40px;width:auto;margin-left:auto"><option value="">Bütün qruplar</option>${classes.map(([id, n]) => `<option value="${id}" ${id === cls ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}</div>
      <section class="grid ls-stats4 ls-payment-only">
        <div class="card stat"><div class="label">Tələbə</div><div class="value">${list.length}</div></div>
        <div class="card stat"><div class="label">${esc(monthName(ym))}: gözlənilən</div><div class="value" style="font-size:22px">${money(sum.exp)}</div></div>
        <div class="card stat"><div class="label">${esc(monthName(ym))}: qəbul edilən pul</div><div class="value" style="font-size:22px;color:var(--green)">${money(sum.paid)}</div></div>
        <div class="card stat"><div class="label">Ümumi borc</div><div class="value" style="font-size:22px;color:${sum.debt > 0 ? 'var(--red)' : 'var(--green)'}">${money(sum.debt)}</div></div>
      </section>
      ${ag.todayList.length || ag.missing.length ? `<div class="card ls-agenda ls-attendance-only">
        ${ag.todayList.length ? `<div class="row ag-line"><strong class="small">Bu gün:</strong>${ag.todayList.map((t) => `<button type="button" class="btn small ag-b ${t.c.id === cls && date === todayIso() ? 'on' : ''}" data-ag="${t.c.id}|${todayIso()}">${esc(t.c.name)} · ${esc(t.x.s)}${t.x.e ? '–' + esc(t.x.e) : ''}</button>`).join('')}</div>` : ''}
        ${ag.missing.length ? `<div class="row ag-line"><strong class="small" style="color:var(--red)">Qeyd olunmayıb:</strong>${ag.missing.map((t) => `<button type="button" class="btn small ag-b miss ${t.c.id === cls && date === t.date ? 'on' : ''}" data-ag="${t.c.id}|${t.date}">${esc(t.c.name)} · ${esc(WEEK_DAYS[t.x.d - 1][2])} ${esc(fmtDayAz(t.date).replace(/ \d{4}$/, ''))}</button>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card ls-quick ls-attendance-only">
        ${cls ? `<span class="small"><strong>${esc((classes.find(([id]) => id === cls) || [])[1] || '')}</strong>${selSlots.length ? ` · ${esc(WEEK_DAYS[selSlots[0].d - 1][1])} ${esc(selSlots.map((x) => x.s + (x.e ? '–' + x.e : '')).join(', '))}` : schedSlots(schedClasses.find((c) => c.id === cls)).length ? ' · <span style="color:#B45309">bu gün cədvəldə dərs yoxdur</span>' : ''}</span>` : ''}
        <label class="row small" style="gap:8px"><strong>Dərs günü</strong> <input type="date" id="lsDate" value="${date}" style="min-height:40px;width:auto"></label>
        <label class="row small" style="gap:8px;flex:1;min-width:180px">Mövzu <input type="text" id="lsTopic" maxlength="200" placeholder="istəyə bağlı, məs. Fonksiyonlar" style="min-height:40px"></label>
        <span class="small"><strong style="color:var(--green)">✓ ${sum.came}</strong> gəldi · <strong style="color:var(--red)">✗ ${sum.missed}</strong> gəlmədi</span>
        <button class="btn small ok" id="allCame">✓ Qeyd olunmayanlar gəldi</button>
      </div>
      <div class="ls-section-title"><h2>${lessonsMode==='attendance'?'Davamiyyət · '+esc(fmtDayAz(date)):'Aylıq ödənişlər'}</h2><span class="muted small">${lessonsMode==='attendance'?`${sum.came} gəldi · ${sum.missed} gəlmədi · ${list.length-sum.came-sum.missed} qeyd gözləyir`:list.length+' tələbə'}</span></div>
      ${rows.length ? `<section class="card ls-list">${rows.map(({ x, g, day }) => `<div class="ls-row" data-sid="${x.id}">
          <div class="ls-who"><a href="#/student/${x.id}"><strong>${esc(x.full_name)}</strong></a><span class="small muted">${esc(x.classes?.name || '')} · ${esc(monthName(ym))}: ${g.came} dərs${g.missed ? `, ${g.missed} gəlmədi` : ''}</span></div>
          <span class="ls-money ls-payment-only"><label class="ls-price" title="Aylıq məbləğ — qəbul edilən pul deyil">Aylıq ₼<input type="number" min="0" step="1" inputmode="decimal" value="${x.lesson_price ?? ''}" placeholder="aylıq" data-price="${x.id}" aria-label="${esc(x.full_name)}: aylıq ödəniş"></label>
            <label class="ls-day" title="Ödəniş günü">ayın<input type="number" min="1" max="31" inputmode="numeric" value="${x.pay_day ?? ''}" placeholder="1" data-pday="${x.id}" aria-label="${esc(x.full_name)}: ödəniş günü" ${ledgerNeeds016 ? 'disabled' : ''}>-i</label></span>
          <span class="ls-bal ls-payment-only">${monthChip(g, ym)}${g.balance > g.fee + 0.004 ? balanceChip(g.balance) : g.balance < -0.004 ? balanceChip(g.balance) : ''}</span>
          <span class="ls-att ls-attendance-only" role="group" aria-label="${esc(x.full_name)}: ${esc(fmtDayAz(date))}">
            <button class="btn small att ${day?.status === 'came' ? 'on-came' : ''}" data-att="came" data-s="${x.id}" aria-pressed="${day?.status === 'came'}">✓ Gəldi</button>
            <button class="btn small att ${day?.status === 'missed' ? 'on-miss' : ''}" data-att="missed" data-s="${x.id}" aria-pressed="${day?.status === 'missed'}">✗ Gəlmədi</button>${day?`<button class="btn small" data-att="${day.status}" data-clear-att data-s="${x.id}">Qeydi sil</button>`:'<span class="ls-unmarked">Qeyd olunmayıb</span>'}</span>
          <span class="ls-act"><button class="btn small primary ls-payment-only" data-pay="${x.id}">+ Ödəniş qeyd et</button><button class="btn small" data-hist="${x.id}">Tarixçə</button></span>
        </div>`).join('')}</section>` : '<div class="card"><div class="empty">Hələ tələbə yoxdur. <a href="#/students">Tələbələr</a> bölməsindən əlavə edin.</div></div>'}</div>`;
    $$('[data-ls-mode]').forEach(b=>b.onclick=()=>{lessonsMode=b.dataset.lsMode;draw();});
    $$('[data-ym]').forEach((b) => b.onclick = () => { lessonsYm = shiftYm(ym, +b.dataset.ym); route(); });
    $('#lsClass') && ($('#lsClass').onchange = (e) => { cls = lessonsCls = e.target.value; draw(); });
    $$('[data-ag]').forEach((b) => b.onclick = () => { const [c, d] = b.dataset.ag.split('|'); cls = lessonsCls = c; lessonsDate = d;
      if (ymOf(d) !== lessonsYm) { lessonsYm = ymOf(d); route(); } else draw(); });
    $('#lsDate').onchange = (e) => { lessonsDate = e.target.value || todayIso(); if (ymOf(lessonsDate) !== lessonsYm) { lessonsYm = ymOf(lessonsDate); route(); } else draw(); };
    const byId = Object.fromEntries(L.students.map((x) => [x.id, x]));
    const reload = async () => { L = await loadLedger(); draw(); };
    const topic = () => $('#lsTopic').value.trim() || null;
    $$('[data-price]').forEach((inp) => inp.onchange = async () => {
      const x = byId[inp.dataset.price];
      const v = inp.value === '' ? null : Math.max(0, Number(inp.value));
      const upd = { lesson_price: v };
      if (v && !x.billing_start && !ledgerNeeds016) upd.billing_start = todayIso().slice(0, 7) + '-01';
      const { error } = await sb.from('students').update(upd).eq('id', x.id);
      if (error) return fail(error);
      toast('Aylıq məbləğ yadda saxlandı');
      await reload();
    });
    $$('[data-pday]').forEach((inp) => inp.onchange = async () => {
      const v = inp.value === '' ? null : Math.min(31, Math.max(1, parseInt(inp.value, 10) || 1));
      const { error } = await sb.from('students').update({ pay_day: v }).eq('id', inp.dataset.pday);
      if (error) return fail(needSql(error, '016_monthly.sql'));
      toast(v ? `Ödəniş günü: ayın ${v}-i` : 'Ödəniş günü silindi');
      await reload();
    });
    // Davamiyyət ayrıca silinir; təkrar toxunma qeydi dəyişmir. Hər əməl geri alına bilər.
    $$('[data-att]').forEach((b) => b.onclick = () => busy(b, async () => {
      const x = byId[b.dataset.s]; const want = b.dataset.att;
      const cur = L.lessons.find((l) => l.student_id === x.id && l.lesson_date === lessonsDate);
      const label = want === 'came' ? '✓ gəldi' : '✗ gəlmədi';
      if (cur && cur.status === want && !b.hasAttribute('data-clear-att')) return toast('Bu davamiyyət artıq qeyd olunub');
      if (cur && cur.status === want) {
        const { error } = await sb.from('lessons').delete().eq('id', cur.id);
        if (error) throw error;
        const back = { student_id: cur.student_id, lesson_date: cur.lesson_date, status: cur.status, fee: 0, topic: cur.topic };
        showUndo(`${x.full_name}: qeyd silindi`, async () => { const { error: e } = await sb.from('lessons').insert(back); if (e) throw e; await reload(); });
      } else if (cur) {
        const { error } = await sb.from('lessons').update({ status: want }).eq('id', cur.id);
        if (error) throw error;
        const old = cur.status;
        showUndo(`${x.full_name}: ${label}`, async () => { const { error: e } = await sb.from('lessons').update({ status: old }).eq('id', cur.id); if (e) throw e; await reload(); });
      } else {
        const { data: row, error } = await sb.from('lessons').insert({ student_id: x.id, lesson_date: lessonsDate, status: want, fee: 0, topic: topic() }).select().single();
        if (error) throw error;
        showUndo(`${x.full_name}: ${label} (${fmtDayAz(lessonsDate)})`, async () => { const { error: e } = await sb.from('lessons').delete().eq('id', row.id); if (e) throw e; await reload(); });
      }
      await reload();
    }).catch(fail));
    $('#allCame').onclick = () => busy($('#allCame'), async () => {
      const todo = list.filter((x) => !L.lessons.some((l) => l.student_id === x.id && l.lesson_date === lessonsDate));
      if (!todo.length) return toast('Hamısı artıq qeyd olunub');
      const { data: made, error } = await sb.from('lessons').insert(todo.map((x) => ({ student_id: x.id, lesson_date: lessonsDate, status: 'came', fee: 0, topic: topic() }))).select();
      if (error) throw error;
      const ids = (made || []).map((r) => r.id);
      showUndo(`${todo.length} tələbə: ✓ gəldi`, async () => { const { error: e } = await sb.from('lessons').delete().in('id', ids); if (e) throw e; await reload(); });
      await reload();
    }).catch(fail);
    $$('[data-pay]').forEach((b) => b.onclick = () => {
      const x = byId[b.dataset.pay]; const g = billingOf(x, L, ym);
      const next = g.next;
      const def = next ? Math.max(0,g.fee-next.paid) : (g.fee || '');
      openDialog('Ödəniş qeyd et', `<form id="lessonPaymentForm" class="stack"><div class="ls-pay-person"><h3>${esc(x.full_name)}</h3><p>${esc(x.classes?.name||'')} · Aylıq məbləğ: ${money(g.fee)}</p></div><p class="notice">${next?`${esc(ymLabel(next.ym))} üçün qalan: <strong>${money(def)}</strong>.`:'Cari aya qədər borc yoxdur. Daxil edilən məbləğ avans kimi nəzərə alınacaq.'} Ödəniş əvvəlki aylardan başlayaraq hesablanır.</p><label>Qəbul etdiyin məbləğ (₼)<input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${def}"></label><label>Ödənişin alındığı tarix<input name="paid_on" type="date" required value="${todayIso()}"></label><p class="muted small">Bu əməliyyat yalnız ödəniş yazır, davamiyyəti dəyişmir.</p><p id="lessonPaymentError" role="alert"></p><button class="btn primary" type="submit">Ödənişi təsdiqlə</button></form>`);
      const dlg=$('#rvDialog'),form=$('#lessonPaymentForm');
      form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),amount=Number(f.get('amount')),paid_on=String(f.get('paid_on'));
        if(!Number.isFinite(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(paid_on))return;
        const submit=$('button[type=submit]',form);
        busy(submit,async()=>{
          const {data:row,error}=await sb.from('payments').insert({student_id:x.id,amount,paid_on}).select().single();
          if(error)throw error;
          dlg.close();
          showUndo(`${x.full_name}: ${money(amount)} ödəniş yazıldı`,async()=>{const {error:e}=await sb.from('payments').delete().eq('id',row.id);if(e)throw e;await reload();});
          await reload();
        }).catch(err=>{$('#lessonPaymentError',form).textContent=err.message||'Ödəniş yazılmadı. Yenidən yoxlayın.';});
      };
    });
    $$('[data-hist]').forEach((b) => b.onclick = () => openHistory(byId[b.dataset.hist], L, ym, reload));
  };
  draw();
}

function openHistory(x, L, ym, reload) {
  const g = billingOf(x, L, ym);
  const mLs = g.ls.filter((l) => ymOf(l.lesson_date) === ym);
  const report = `${x.full_name} · ${ymLabel(ym)}: ${g.came + g.missed ? `${g.came + g.missed} dərsdən ${g.came}-də iştirak edib${g.missed ? ` (${g.missed} dəfə gəlməyib)` : ''}` : 'dərs qeydi yoxdur'}. `
    + (g.fee ? (g.sel?.full ? `Aylıq ödəniş (${money(g.fee)}) ödənilib.` : g.sel ? `Aylıq ödəniş ${money(g.fee)} — ödəniş günü ${fmtDayAz(g.sel.due)}${g.sel.paid > 0 ? `, ${money(g.sel.paid)} ödənilib` : ''}.` : '') : '')
    + (g.balance > g.fee + 0.004 ? ` Ümumi borc: ${money(g.balance)}.` : '');
  openDialog(esc(x.full_name) + ' · ödəniş və dərslər', `
    <div class="row between"><span>${monthChip(g, ym)} ${balanceChip(g.balance)}</span><button type="button" class="btn small" id="hCopy">Valideyn üçün hesabatı kopyala</button></div>
    <p class="small muted pre">${esc(report)}</p>
    <h3>Aylar</h3>
    ${g.months.length ? `<div class="h-list">${g.months.slice().reverse().map((m) => `<div class="h-row h-month"><span class="h-d">${esc(ymLabel(m.ym))}</span>
        <span class="small muted">ödəniş günü ${esc(fmtDayAz(m.due))}</span><span class="h-m">${money(g.fee)}</span>
        <span>${m.full ? '<span class="pchip hi">✓ ödənilib</span>' : m.overdue ? `<span class="pchip low">gecikir · ${money(g.fee - m.paid)}</span>` : `<span class="pchip mid">gözlənilir${m.paid > 0 ? ` · ${money(m.paid)} ödənilib` : ''}</span>`}</span></div>`).join('')}</div>`
      : '<p class="small muted">Aylıq məbləğ yazılmayıb.</p>'}
    <p class="ls-guide small">Səhv qeydi burada silə bilərsən. Sildikdən sonra “Geri al” ilə bərpa etmək mümkündür. Düzgün ödənişi Ödənişlərdən, davamiyyəti isə uyğun dərs günündən yenidən qeyd et.</p><h3>Ödənişlər</h3>
    ${g.ps.length ? `<div class="h-list">${g.ps.map((p) => `<div class="h-row"><span class="h-d">${esc(fmtDayAz(p.paid_on))}</span><span class="h-k pay">💳 Ödəniş</span><span class="h-t">${esc(p.note || '')}</span><span class="h-m">+${money(p.amount)}</span><button class="btn small danger" data-hdp="${p.id}" aria-label="Sil">Sil</button></div>`).join('')}</div>`
      : '<p class="small muted">Hələ ödəniş yoxdur.</p>'}
    <h3>Dərslər · ${esc(monthName(ym))}</h3>
    ${mLs.length ? `<div class="h-list">${mLs.map((l) => `<div class="h-row"><span class="h-d">${esc(fmtDayAz(l.lesson_date))}</span><span class="h-k ${l.status === 'came' ? 'came' : 'miss'}">${l.status === 'came' ? '✓ Gəldi' : '✗ Gəlmədi'}</span><span class="h-t">${esc(l.topic || '')}</span><span></span><button class="btn small danger" data-hdl="${l.id}" aria-label="Sil">Sil</button></div>`).join('')}</div>`
      : '<p class="small muted">Bu ay dərs qeydi yoxdur.</p>'}`);
  const dlg = document.getElementById('rvDialog');
  $('#hCopy', dlg).onclick = () => copyText(report, 'Hesabat kopyalandı');
  const del = (table, row) => async () => {
    if (!confirm(`${x.full_name}: ${table==='payments'?money(row.amount)+' ödənişi ('+fmtDayAz(row.paid_on)+')':fmtDayAz(row.lesson_date)+' davamiyyət qeydi'} silinsin?`)) return;
    const { error } = await sb.from(table).delete().eq('id', row.id);
    if (error) return fail(error);
    dlg.close();
    const { id, created_at, ...back } = row;
    showUndo('Qeyd silindi', async () => { const { error: e } = await sb.from(table).insert(back); if (e) throw e; await reload(); });
    await reload();
  };
  $$('[data-hdl]', dlg).forEach((b) => b.onclick = del('lessons', g.ls.find((l) => l.id === b.dataset.hdl)));
  $$('[data-hdp]', dlg).forEach((b) => b.onclick = del('payments', g.ps.find((p) => p.id === b.dataset.hdp)));
}

async function studentWorkView(id) {
  const { data: st, error } = await sb.from('students').select('*, classes(name)').eq('id', id).single();
  if (error) throw error;
  const { data: testsAll } = await sb.from('tests').select('*').eq('class_id', st.class_id).order('created_at', { ascending: false });
  const tests = (testsAll || []).filter((t) => !t.student_id || t.student_id === st.id);
  const testIds = (tests || []).map((t) => t.id);
  const { data: subsAll } = testIds.length ? await sb.from('submissions').select('*').in('test_id', testIds) : { data: [] };
  const nm = st.full_name.trim().toLocaleLowerCase('az');
  const mine = (subsAll || []).filter((x) => x.student_id === st.id || (!x.student_id && x.student_name.trim().toLocaleLowerCase('az') === nm));
  const qIds = [...new Set((tests || []).filter((t) => mine.some((m) => m.test_id === t.id)).flatMap((t) => t.question_ids))];
  const { data: qs } = qIds.length ? await sb.from('questions').select('*').in('id', qIds) : { data: [] };
  const qById = Object.fromEntries((qs || []).map((q) => [q.id, q]));
  const rows = (tests || []).map((t) => {
    const sub = mine.filter((m) => m.test_id === t.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
    return { t, sub, questions: t.question_ids.map((q) => qById[q]).filter(Boolean) };
  });
  const done = rows.filter((r) => r.sub);
  const avg = done.length ? Math.round(done.reduce((a, r) => a + (r.sub.total ? r.sub.score / r.sub.total : 0), 0) / done.length * 100) : null;
  const tot = done.reduce((c, r) => { const k = countStates(r.questions, r.sub.answers); Object.keys(c).forEach((x) => { c[x] += k[x]; }); return c; }, { right: 0, wrong: 0, empty: 0, open: 0 });

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/classes">Qruplar</a> / <a href="#/class/${st.class_id}">${esc(st.classes?.name || 'Qrup')}</a> /</div><h1>${esc(st.full_name)}</h1></div>
      ${st.access_code ? `<a class="btn" href="${esc(studentLink(st.access_code))}" target="_blank" rel="noopener">Tələbənin səhifəsi</a>` : ''}</div>
    <section class="grid">
      <div class="card stat"><div class="label">Yazdığı test</div><div class="value">${done.length} / ${rows.length}</div></div>
      <div class="card stat"><div class="label">Orta nəticə</div><div class="value">${avg === null ? '—' : avg + '%'}</div></div>
      <div class="card stat"><div class="label">Suallar</div><div class="value" style="font-size:20px"><span style="color:var(--green)">✓ ${tot.right}</span> · <span style="color:var(--red)">✗ ${tot.wrong}</span> · — ${tot.empty}</div></div>
    </section>
    <div class="split">
      <section class="card stack secret-note"><div class="row between"><h2>🔒 Gizli qeyd</h2><span class="small muted" id="noteState">yalnız siz görürsünüz</span></div>
        <textarea id="tNote" rows="5" maxlength="20000" placeholder="məs. Üslü sayılarda zəifdir · valideynlə danışıldı · növbəti dərsdə Kümeler">${esc(st.teacher_note || '')}</textarea></section>
      <section class="card stack" id="ledgerCard"><h2>💳 Dərslər və ödəniş</h2><p class="muted small">Yüklənir…</p></section>
    </div>
    <div class="split">
      <section class="card stack"><h2>Mövzular</h2>${topicBarsHtml(topicStats(done.map((r) => ({ sub: r.sub, questions: r.questions }))), 'Hələ test yazmayıb.')}</section>
      <section class="card stack"><h2>Nəticələr</h2>${trendHtml([...done].sort((a, b) => (a.sub.created_at < b.sub.created_at ? -1 : 1)).map((r) => ({ label: r.t.title, pct: subPct(r.sub) })))}</section>
    </div>
    <section class="card stack"><h2>Testlər</h2>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Nəticə</th><th>Suallar</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td><a href="#/test/${r.t.id}">${esc(r.t.title)}</a><div class="small muted">${fmtDate(r.t.created_at)}</div></td>
          <td>${r.sub ? `<strong>${r.sub.score}/${r.sub.total}</strong> <span class="small muted">${r.sub.total ? Math.round(r.sub.score / r.sub.total * 100) : 0}%</span>`
            : `<span class="tag ${r.t.is_open ? 'amber' : ''}">${r.t.is_open ? 'hələ yazmayıb' : 'yazmayıb'}</span>`}</td>
          <td>${r.sub ? cellsHtml(r.questions, r.sub.answers) : ''}</td>
          <td>${r.sub ? `<button type="button" class="btn small" data-row="${i}">Ətraflı</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Bu qrupun hələ testi yoxdur.</div>'}
    </section>`;
  // gizli qeyd: yazdıqca avtomatik saxlanılır
  let noteTimer = null;
  $('#tNote').oninput = () => {
    $('#noteState').textContent = 'yazılır…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const { error: e1 } = await sb.from('students').update({ teacher_note: $('#tNote').value.trim() || null }).eq('id', id);
      const el = $('#noteState'); if (!el) return;
      if (e1) { el.textContent = /teacher_note|schema cache/i.test(e1.message || '') ? 'saxlanılmadı: bazada 013_lessons.sql işə salın' : 'saxlanılmadı: ' + e1.message; el.style.color = 'var(--red)'; }
      else { el.textContent = '✓ yadda saxlandı'; el.style.color = 'var(--green)'; }
    }, 700);
  };
  loadLedger().then((L) => {
    const box = $('#ledgerCard'); if (!box) return;
    const me = L.students.find((x) => x.id === id) || st;
    const ym = todayIso().slice(0, 7);
    const g = billingOf(me, L, ym);
    const last = g.ls.slice(0, 3);
    box.innerHTML = `<h2>💳 Ödəniş və dərslər</h2>
      <div class="row between"><span>${monthChip(g, ym)} ${g.balance > g.fee + 0.004 || g.balance < -0.004 ? balanceChip(g.balance) : ''}</span><span class="small muted">aylıq: ${g.fee ? money(g.fee) + (me.pay_day ? `, ayın ${me.pay_day}-i` : '') : '—'}</span></div>
      <p class="small">Bu ay: <strong>${g.came}</strong> dərsə gəlib${g.missed ? `, ${g.missed} dəfə gəlməyib` : ''} · ödənilib ${money(g.mPaid)}</p>
      ${last.length ? `<div class="small muted">Son dərslər: ${last.map((l) => `${esc(fmtDayAz(l.lesson_date))}${l.status === 'missed' ? ' (gəlmədi)' : ' ✓'}${l.topic ? ' — ' + esc(l.topic) : ''}`).join(' · ')}</div>` : ''}
      <a class="btn small" href="#/lessons" style="align-self:flex-start">Dərslər səhifəsi ›</a>`;
  }).catch((err) => { const box = $('#ledgerCard'); if (box) box.innerHTML = err.need013 ? '<h2>💳 Dərslər və ödəniş</h2><p class="notice">Bazada <strong>013_lessons.sql</strong> işə salın.</p>' : `<p class="notice">${esc(err.message)}</p>`; });
  $$('[data-row]').forEach((b) => b.onclick = () => {
    const r = rows[+b.dataset.row];
    openDialog(esc(st.full_name) + ' · ' + esc(r.t.title), submissionDetailHtml(r.questions, r.sub));
    attachDrawings(document.getElementById('rvDialog'), r.sub.id).catch(() => {});
  });
  teacherStudentHub(st).catch(fail);
  practiceSection(st, done);
  reportSection(st, rows);
}

// ================= Valideyn hesabatı =================
function reportSection(st, rows) {
  const box = document.createElement('section');
  box.className = 'card stack';
  view().appendChild(box);
  const teacher = session?.user?.user_metadata?.full_name || '';
  const build = (days) => {
    const to = Date.now();
    const from = days ? to - days * 86400000 : 0;
    const inP = (iso) => new Date(iso).getTime() >= from;
    const period = rows.filter((r) => inP(r.t.created_at) || (r.sub && inP(r.sub.created_at)));
    const done = period.filter((r) => r.sub);
    const avg = done.length ? Math.round(done.reduce((a, r) => a + subPct(r.sub), 0) / done.length) : null;
    const prev = days ? rows.filter((r) => r.sub && new Date(r.sub.created_at).getTime() < from && new Date(r.sub.created_at).getTime() >= from - days * 86400000) : [];
    const prevAvg = prev.length ? Math.round(prev.reduce((a, r) => a + subPct(r.sub), 0) / prev.length) : null;
    const tp = topicStats(done.map((r) => ({ sub: r.sub, questions: r.questions }))).filter((t) => t.total >= 2);
    const strong = tp.filter((t) => t.pct >= 75).sort((a, b) => b.pct - a.pct).slice(0, 2);
    const weak = tp.filter((t) => t.pct < 60).slice(0, 2);
    const fmtD = (ms) => { const d = new Date(ms); return `${d.getDate()} ${AZ_MONTHS[d.getMonth()]}`; };
    const lines = [
      'Hörmətli valideyn,',
      `${st.full_name}${st.classes?.name ? ' (' + st.classes.name + ')' : ''} · ${days ? `${fmtD(from)} – ${fmtD(to)}` : 'bütün dövr'}`,
      '',
      `Yazılan testlər: ${done.length} / ${period.length}`,
      ...period.map((r) => r.sub
        ? `• ${r.t.title} — ${r.sub.score}/${r.sub.total} (${subPct(r.sub)}%)${r.sub.late ? ', gecikmə ilə' : ''}`
        : `• ${r.t.title} — ${r.t.is_open && !(r.t.due_at && new Date(r.t.due_at).getTime() < to) ? 'hələ yazmayıb' : 'yazmayıb'}`)
    ];
    if (avg !== null) lines.push('', `Orta nəticə: ${avg}%${prevAvg !== null ? ` (əvvəlki dövr: ${prevAvg}% ${avg > prevAvg ? '↑' : avg < prevAvg ? '↓' : '='})` : ''}`);
    if (strong.length) lines.push(`Yaxşı bildiyi mövzular: ${strong.map((t) => `${t.topic} (${t.pct}%)`).join(', ')}`);
    if (weak.length) lines.push(`Üzərində işləməli: ${weak.map((t) => `${t.topic} (${t.pct}%)`).join(', ')}`);
    if (!period.length) lines.push('Bu dövrdə test olmayıb.');
    lines.push('', 'Hörmətlə,' + (teacher ? '\n' + teacher : '\nmüəllim'));
    return lines.join('\n');
  };
  box.innerHTML = `<div class="row between"><h2>Valideyn üçün hesabat</h2>
      <select id="rpDays" style="min-height:40px"><option value="7">Son 7 gün</option><option value="30" selected>Son 30 gün</option><option value="0">Bütün dövr</option></select></div>
    <p class="muted small">Mətni dəyişə və ya qeyd əlavə edə bilərsiniz, sonra WhatsApp-a göndərin.</p>
    <textarea id="rpText" rows="12" style="font-size:14px;line-height:1.5"></textarea>
    <div class="row"><button type="button" class="btn primary" id="rpShare">Göndər (WhatsApp və s.)</button><button type="button" class="btn" id="rpCopy">Kopyala</button></div>`;
  const fill = () => { $('#rpText', box).value = build(+$('#rpDays', box).value); };
  $('#rpDays', box).onchange = fill;
  $('#rpShare', box).onclick = () => shareText($('#rpText', box).value, 'Hesabat kopyalandı');
  $('#rpCopy', box).onclick = () => copyText($('#rpText', box).value, 'Hesabat kopyalandı');
  fill();
}

// ================= Fərdi AI tapşırıq =================
// tələbənin səhv / boş buraxdığı suallardan bənzər yeni suallar → yoxlama → təsdiq → yalnız ona test
const sampleFromQ = (q) => ({
  text: q.body + '\n' + (q.options || []).map((o, i) => `${'ABCDE'[i]}) ${o}`).join('\n')
    + (q.figure ? '\n[Şəklin SVG kodu]: ' + String(q.figure).slice(0, 3000) : ''),
  image: null, topic: q.topic || '', section: q.section || 'matematik',
  analysis: { section: q.section || 'matematik', topic: q.topic || '', family: q.subtype || '', visual: '', skill: '', rule: '', student_task: '',
    rule_hidden: false, options_are_figures: hasOptionFigures(q), figure_required: !!q.figure, difficulty: q.difficulty || 'orta',
    preserve: [], variable: [], uncertain: [], complete: true, conflict: '' }
});

function practiceSection(st, done) {
  const missed = [];
  const seen = new Set();
  [...done].sort((a, b) => (a.sub.created_at < b.sub.created_at ? 1 : -1)).forEach((r) => r.questions.forEach((q) => {
    if (q.qtype !== 'mcq' || seen.has(q.id)) return;
    const s2 = answerState(q, r.sub.answers?.[q.id]);
    if (s2 === 'wrong' || s2 === 'empty') { seen.add(q.id); missed.push({ q, state: s2, test: r.t.title }); }
  }));
  const box = document.createElement('section');
  box.className = 'card stack';
  box.id = 'practice';
  view().appendChild(box);
  const state = { items: [], running: false };
  const render = () => {
    const sel = state.items.filter((x) => x.q && x.q.ai_status !== 'checking' && (x.q._sel === undefined ? defaultChecked(x.q) || x.q.teacher_approved : x.q._sel));
    box.innerHTML = `<div class="row between"><h2>Fərdi tapşırıq (AI)</h2>${modelPicker()}</div>
      ${missed.length ? `<p class="muted small">${esc(st.full_name)} ${missed.length} sualda səhv edib və ya boş buraxıb. AI hər biri üçün bənzər yeni sual hazırlayır, yoxlayır; siz təsdiqləyib yalnız bu tələbəyə göndərirsiniz.</p>
        <div class="row"><label class="row small" style="gap:6px">Neçə sual <select id="pN" style="min-height:40px">${[...new Set([3, 5, 8, 10].map((n) => Math.min(n, missed.length)))].map((n) => `<option ${n === Math.min(5, missed.length) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button type="button" class="btn primary" id="pGo" ${state.running ? 'disabled' : ''}>${state.items.length ? 'Yenidən hazırla' : 'Tapşırıq hazırla'}</button></div>`
        : '<div class="empty">Səhv edilmiş sual yoxdur — fərdi tapşırıq lazım deyil.</div>'}
      ${state.items.length ? `<div class="mini-grid">${state.items.map((x, i) => `<div class="mini">
          <div class="mini-head"><span class="tag ${x.src.state === 'wrong' ? 'red' : ''}">${x.src.state === 'wrong' ? 'səhv etmişdi' : 'boş buraxmışdı'}</span><span class="small muted">${esc(x.src.q.topic || '')}</span></div>
          ${x.q ? miniQ(x.q, 'pr' + i, x.q._sel === undefined ? defaultChecked(x.q) || x.q.teacher_approved : x.q._sel)
            : x.error ? `<p class="small" style="color:var(--red)">${esc(x.error)}</p>` : '<p class="small muted">hazırlanır…</p>'}</div>`).join('')}</div>
        <div class="row between"><span class="small muted">Qaralamaları açıb yoxlayın və təsdiqləyin. Seçilən: <strong>${sel.length}</strong></span>
          <button type="button" class="btn primary" id="pSend" ${state.running || !sel.length ? 'disabled' : ''}>Tapşırığı tələbəyə göndər</button></div>` : ''}
      <div id="pDone"></div>`;
    bindModelPicker(box);
    const byKey = Object.fromEntries(state.items.map((x, i) => ['pr' + i, x]));
    bindMini(box, (k) => { const x = byKey[k]; return x && x.q ? { q: x.q, sample: { text: x.src.q.body }, onApprove: x.q.ai_status === 'checking' ? null : (on) => { if (on) x.q._sel = true; render(); } } : {}; });
    $$('.check', box).forEach((c) => c.onchange = () => { const x = byKey[c.dataset.id]; if (x && x.q) x.q._sel = c.checked; render(); });
    const go2 = $('#pGo', box);
    if (go2) go2.onclick = () => run(+$('#pN', box).value);
    const send = $('#pSend', box);
    if (send) send.onclick = () => busy(send, () => sendPractice(sel.map((x) => x))).catch(fail);
  };

  const makeOne = async (src, feedback = '') => {
    const q = src.q;
    if (q.exam === 'tryos') {
      const d = await callAI('tryos_from_examples', { samples: [sampleFromQ(q)], mode: 'benzer', perSample: 1, feedback });
      return { ...d.questions[0], exam: 'tryos' };
    }
    const d = await callAI('transform', { text: sampleFromQ(q).text + (feedback ? '\nƏvvəlki cəhdin problemləri: ' + feedback : ''), level: 'orta', qtype: 'mcq', grade: q.grade || 7, difficulty: q.difficulty || 'orta', topic: q.topic || '' });
    return d.question;
  };

  const run = async (n) => {
    if (state.running) return;
    state.running = true;
    state.items = missed.slice(0, n).map((src) => ({ src, q: null, error: '' }));
    render();
    const queue = makeQueue(3);
    await Promise.all(state.items.map((x) => queue(async () => {
      try {
        const sample = sampleFromQ(x.src.q);
        let q = { ...(await makeOne(x.src)), _uid: ++qSeq, ai_status: 'checking' };
        x.q = q; render();
        let ok = await checkQuestion(q, { mode: 'benzer', sample });
        if (!ok) {
          const fb = [q.verify_note, q.fit_note].filter(Boolean).join('; ');
          try { q = { ...(await makeOne(x.src, fb)), _uid: ++qSeq, ai_status: 'checking' }; x.q = q; render(); ok = await checkQuestion(q, { mode: 'benzer', sample }); } catch (_) { /* köhnəsi qalır */ }
        }
        if (!ok) x.q.ai_status = 'draft';
      } catch (err) { x.error = err.message; }
      render();
    })));
    state.running = false;
    render();
  };

  const sendPractice = async (list) => {
    const qsToSave = list.map((x) => ({ ...x.q, topic: x.q.topic || x.src.q.topic, exam: x.q.exam || x.src.q.exam }));
    const ids = await saveQuestions(qsToSave, 'ai');
    const d = new Date();
    const rec = { title: `Fərdi tapşırıq · ${st.full_name} · ${d.getDate()} ${AZ_MONTHS[d.getMonth()]}`, class_id: st.class_id, student_id: st.id, question_ids: ids, review_mode: 'after_submit' };
    const { data: row, error } = await sb.from('tests').insert(rec).select().single();
    if (error) throw needSql(error, '007_test_rules.sql');
    state.items = [];
    render();
    const msg = `${st.full_name}, sənin üçün səhvlərinə uyğun yeni tapşırıq hazırladım (${ids.length} sual). Buradan yaz:\n${studentLink(st.access_code)}`;
    $('#pDone', box).innerHTML = `<div class="notice info stack">Tapşırıq yaradıldı: <a href="#/test/${row.id}">${esc(row.title)}</a>. O yalnız bu tələbənin səhifəsində görünür; düzgün cavablar göndərəndən sonra açılır.
      ${st.access_code ? '<div><button type="button" class="btn small primary" id="pShare">Tələbəyə xəbər göndər</button></div>' : ''}</div>`;
    const sh = $('#pShare', box);
    if (sh) sh.onclick = () => shareText(msg, 'Mətn kopyalandı');
  };
  render();
}

async function testResultsView(id) {
  const [{ data: test, error }, { data: subs }] = await Promise.all([
    sb.from('tests').select('*, classes(name)').eq('id', id).single(),
    sb.from('submissions').select('*').eq('test_id', id).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  let [{ data: qs }, { data: roster }] = await Promise.all([
    sb.from('questions').select('*').in('id', test.question_ids.length ? test.question_ids : ['00000000-0000-0000-0000-000000000000']),
    test.class_id ? sb.from('students').select('id, full_name, access_code').eq('class_id', test.class_id).order('full_name') : Promise.resolve({ data: [] })
  ]);
  const rosterAll = roster || [];
  if (test.student_id) roster = rosterAll.filter((x) => x.id === test.student_id);
  const rules = [
    test.student_id ? `fərdi test: <strong>${esc((rosterAll.find((x) => x.id === test.student_id) || {}).full_name || 'tələbə')}</strong>` : '',
    test.time_limit_min ? `⏱ ${test.time_limit_min} dəqiqə` : '',
    test.due_at ? `son tarix: ${esc(fmtDue(test.due_at))}` : '',
    test.shuffle ? 'qarışdırılır' : ''
  ].filter(Boolean).join(' · ');
  const sentIds = new Set(subs.map((s) => s.student_id).filter(Boolean));
  const sentNames = new Set(subs.map((s) => s.student_name.trim().toLocaleLowerCase('az')));
  const notSent = (roster || []).filter((st) => !sentIds.has(st.id) && !sentNames.has(st.full_name.trim().toLocaleLowerCase('az')));
  const questions = test.question_ids.map((qid) => (qs || []).find((q) => q.id === qid)).filter(Boolean);
  const avg = subs.length ? Math.round(subs.reduce((a, s) => a + (s.total ? s.score / s.total : 0), 0) / subs.length * 100) : null;
  const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('az');
  const link = location.origin + location.pathname + '#/t/' + id;
  const qStats = questions.map((q, i) => {
    if (q.qtype !== 'mcq' || !subs.length) return { q, i, p: null, open: q.qtype !== 'mcq' };
    const right = subs.filter((s) => norm(s.answers?.[q.id]) === norm(q.answer)).length;
    return { q, i, p: Math.round(right / subs.length * 100) };
  });
  const hardest = qStats.filter((x) => x.p !== null).sort((x, y) => x.p - y.p)[0];

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/tests">Testlər</a> /</div><h1>${esc(test.title)}</h1>
      <p class="muted">${test.kind === 'deneme' ? '🎯 Deneme · ' : ''}${esc(test.classes?.name || 'Qrupsuz')} · ${questions.length} sual · ${test.is_open ? 'açıq' : 'bağlı'}${rules ? ' · ' + rules : ''}</p></div>
      <div class="row"><button class="btn primary" id="copy">Linki kopyala</button><button class="btn" id="pdf">PDF</button><button class="btn danger" id="del">Testi sil</button></div></div>
    <section class="grid res-stats">
      <div class="card stat"><div class="label">Göndərib</div><div class="value">${subs.length}${(roster || []).length ? `<span class="of"> / ${(roster || []).length}</span>` : ''}</div></div>
      <div class="card stat"><div class="label">Orta nəticə</div><div class="value">${avg === null ? '—' : avg + '%'}</div></div>
      <div class="card stat"><div class="label">Ən çətin sual</div><div class="value">${hardest ? '№' + (hardest.i + 1) + ` <span class="of">${hardest.p}% düz</span>` : '—'}</div></div>
    </section>
    ${notSent.length ? `<section class="card stack"><div class="row between"><h2>Hələ göndərməyənlər (${notSent.length})</h2>
        ${notSent.every((st) => st.access_code) && test.is_open ? '<button class="btn small" id="remind">Xatırlatma mətnini kopyala</button>' : ''}</div>
      <div class="missing-list">${notSent.map((st) => `<span class="tag">${esc(st.full_name)}</span>`).join('')}</div></section>` : ''}
    <section class="card stack"><h2>Tələbələr</h2>
      ${subs.length ? `<p class="small muted">Xanalar suallardır: <span class="cell c-right">✓</span> düz, <span class="cell c-wrong">✗</span> səhv, <span class="cell c-empty">—</span> boş. Tələbənin adına basanda işi açılır.</p>
      <div class="table-wrap"><table><thead><tr><th>Tələbə</th><th>Bal</th><th>Suallar</th><th>Vaxt</th></tr></thead><tbody>
        ${subs.map((s) => { const p = s.total ? Math.round(s.score / s.total * 100) : 0; return `<tr><td><button type="button" class="linkish" data-sub="${s.id}">${esc(s.student_name)}</button></td><td><strong>${s.score}/${s.total}</strong> <span class="small muted">${p}%</span>${s.late ? ' <span class="tag amber" title="Vaxt bitəndən sonra göndərilib">gecikib</span>' : ''}</td>
          <td>${cellsHtml(questions, s.answers)}</td><td class="muted small">${fmtDate(s.created_at)}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">Hələ heç kim göndərməyib.</div>'}
    </section>
    <section class="card stack"><div class="row between"><h2>Suallar üzrə</h2><span class="small muted">Suala basın — tam açılacaq</span></div>
      <div class="qstat-grid">${qStats.map((x) => `<button type="button" class="qstat" data-qs="${x.i}">
          <span class="qs-head"><strong>${x.i + 1}</strong>${x.p === null ? (x.open ? '<span class="small muted">açıq sual</span>' : '') : `<span class="qs-p ${x.p < 50 ? 'low' : x.p < 75 ? 'mid' : 'hi'}">${x.p}% düz</span>`}</span>
          ${x.p === null ? '' : `<span class="qs-bar ${x.p < 50 ? 'low' : x.p < 75 ? 'mid' : 'hi'}" aria-hidden="true"><span style="width:${x.p}%"></span></span>`}
          <span class="qs-text">${esc(x.q.body)}</span></button>`).join('')}</div>
    </section>
    <section class="card row between"><label class="row small" style="gap:8px">Tələbəyə düzgün cavabları və həlli
        <select id="rvMode" style="min-height:40px">${Object.entries(REVIEW_MODES).map(([k, v]) => `<option value="${k}" ${k === (test.review_mode || 'never') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <span class="small muted">${test.review_mode === undefined ? 'Bu seçim üçün bazaya 006_review.sql lazımdır.' : 'Tələbə şəxsi linkindən öz işinə baxır.'}</span></section>`;
  $$('[data-qs]').forEach((b) => b.onclick = () => {
    const x = qStats[+b.dataset.qs];
    const answered = subs.filter((s) => norm(s.answers?.[x.q.id]) !== '');
    const dist = x.q.qtype === 'mcq' && subs.length ? `<div class="small muted">Kim nə seçib: ${(x.q.options || []).map((o, j) => {
        const n = subs.filter((s) => norm(s.answers?.[x.q.id]) === norm(o)).length; return n ? `<strong>${'ABCDEF'[j]})</strong> ${n}` : ''; }).filter(Boolean).join(' · ') || '—'}${subs.length - answered.length ? ` · boş ${subs.length - answered.length}` : ''}</div>` : '';
    const openAnswers = x.q.qtype === 'open' && answered.length
      ? `<details class="sol" open><summary>Tələbə cavabları (${answered.length})</summary><div>${answered.map((s) => `<strong>${esc(s.student_name)}:</strong> ${esc(s.answers[x.q.id])}`).join('\n')}</div></details>` : '';
    openDialog(`Sual ${x.i + 1}${x.p === null ? '' : ` · ${x.p}% düz`}`, dist + questionHtml(x.q) + openAnswers);
  });
  $('#copy').onclick = () => copyText(link);
  $$('[data-sub]').forEach((b) => b.onclick = () => {
    const sub = subs.find((x) => x.id === b.dataset.sub);
    if (sub) { openDialog(esc(sub.student_name) + ' · ' + esc(test.title), submissionDetailHtml(questions, sub)); attachDrawings(document.getElementById('rvDialog'), sub.id).catch(() => {}); }
  });
  $('#rvMode').onchange = async (e) => {
    const { error: err } = await sb.from('tests').update({ review_mode: e.target.value }).eq('id', id);
    if (err) return fail(needSql(err, '006_review.sql'));
    toast('Yadda saxlandı');
  };
  $('#remind') && ($('#remind').onclick = () => copyText(`«${test.title}» testini hələ yazmayanlar, öz linkinizdən açın:\n\n`
    + notSent.map((st) => `${st.full_name}: ${studentLink(st.access_code)}`).join('\n'), 'Mətn kopyalandı'));
  $('#pdf').onclick = () => { pendingPrint = { questions, title: test.title, back: '#/test/' + id }; go('#/print'); };
  $('#del').onclick = async () => {
    if (!confirm('Test və bütün nəticələri silinsin?')) return;
    const { error: err } = await sb.from('tests').delete().eq('id', id);
    if (err) return fail(err);
    go('#/tests');
  };
}

// ================= Tələbə test səhifəsi =================

const studentQuestionsHtml = (test) => test.questions.map((q, i) => `<fieldset class="card stack" style="margin:0" data-q="${esc(q.id)}">
      <legend class="sr">Sual ${i + 1}</legend>
      <div class="muted small">Sual ${i + 1} / ${test.questions.length}</div>
      <div class="q-text pre" style="font-size:17px">${esc(q.body)}</div>
      ${q.figure ? `<div class="q-fig">${safeSvg(q.figure)}</div>` : ''}
      ${q.qtype === 'mcq'
        ? `<div class="${hasOptionFigures(q) ? 'fig-choices' : 'stack'}" style="gap:8px">${q.options.map((o, j) => `<label class="opt-choice"><input type="radio" name="q_${q.id}" value="${esc(o)}"><span>${'ABCDEF'[j]})</span>${hasOptionFigures(q) ? `<span class="opt-fig">${safeSvg(q.option_figures[j])}</span>` : `<span>${esc(o)}</span>`}</label>`).join('')}</div>`
        : `<label class="field"><span class="sr">Cavabınız</span><textarea name="q_${q.id}" rows="3" placeholder="Cavabınızı yazın"></textarea></label>`}
    </fieldset>`).join('');

// Cavabları toplayır; boş sual varsa təsdiq istəyir (imtina edilsə null)
function collectAnswers(form, test, auto = false) {
  const f = new FormData(form);
  const answers = {};
  test.questions.forEach((q) => { const v = f.get('q_' + q.id); if (v !== null && String(v).trim() !== '') answers[q.id] = String(v); });
  const missing = test.questions.length - Object.keys(answers).length;
  if (!auto && missing && !confirm(missing + ' suala cavab verilməyib. Yenə də göndərilsin?')) return null;
  return answers;
}

// ---- Qarışdırma (tələbəyə görə sabit), vaxt sayğacı, qaralama ----
function seededRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function shuffled(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function shuffleTest(test, seed) {
  const rnd = seededRandom(seed);
  const questions = shuffled(test.questions, rnd).map((q) => {
    if (q.qtype !== 'mcq' || !(q.options || []).length) return q;
    const idx = shuffled(q.options.map((_, i) => i), rnd);
    return { ...q, options: idx.map((i) => q.options[i]), option_figures: hasOptionFigures(q) ? idx.map((i) => q.option_figures[i]) : q.option_figures };
  });
  return { ...test, questions };
}
const fmtClock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const AZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
const fmtDue = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getDate()} ${AZ_MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Test formu: qaralama yaddaşı, vaxt bitəndə avtomatik göndərmə
// ================= Qaralama: sualın üstündə/yanında qələmlə yazmaq (Apple Pencil, barmaq) =================
// Hər sual üçün xətlər məntiqi ölçüdə saxlanılır (W×H), ekrana sığdırılır. Arxa fon — sualın özünün şəkli.
const INK_COLORS = [['#111827', 'Qara'], ['#1d4ed8', 'Göy'], ['#dc2626', 'Qırmızı'], ['#16a34a', 'Yaşıl']];
let inkPenSeen = false; // bu cihazda Apple Pencil işlədilibsə, barmaq yazmır
const inkBg = new Map(); // sual id → { img, w, h } (sualın şəkli; yalnız yaddaşda)

// Sualın şəkli: ayrıca, sabit enli surətdən çəkilir (səhifə sürüşdürülsə də yerindən oynamır), yüksək keyfiyyətlə
const INK_CAP_W = 720;
async function captureQuestion(el) {
  let box = null;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = `position:fixed;left:0;top:0;width:${INK_CAP_W}px;background:#fff;z-index:-1;pointer-events:none;padding:4px 0`;
    const cl = el.cloneNode(true);
    cl.querySelectorAll('.ink-bar, .ink-thumb').forEach((n) => n.remove());
    cl.querySelectorAll('[name]').forEach((n) => n.removeAttribute('name')); // əsl formadakı seçimlərə toxunmasın
    cl.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    cl.style.margin = '0'; cl.style.border = 'none'; cl.style.boxShadow = 'none'; cl.style.maxWidth = 'none';
    box.appendChild(cl);
    document.body.appendChild(box);
    const h = Math.max(1, box.scrollHeight);
    const scale = Math.max(1.5, Math.min(3, 5000 / h)); // çox uzun sualda yaddaşı aşmasın
    const c = await window.html2canvas(box, { scale, backgroundColor: '#ffffff', logging: false,
      scrollX: -window.scrollX, scrollY: -window.scrollY, windowWidth: Math.max(document.documentElement.clientWidth, INK_CAP_W) });
    return c && c.width > 10 && c.height > 10 ? inkTrim(c) : null;
  } catch (_) { return null; }
  finally { if (box) box.remove(); }
}

// Şəklin ətrafındakı boş (ağ) sahəni kəsir — bəzi cihazlarda şəkil artıq boşluqla çəkilir
function inkTrim(c) {
  try {
    const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const ink = (i) => d[i + 3] > 20 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (ink((y * W + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return c;
    const pad = Math.round(W * 0.02);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad + 2); y1 = Math.min(H, y1 + pad + 2);
    if (x1 - x0 >= W - 4 && y1 - y0 >= H - 4) return c;
    const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0;
    const ctx = o.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  } catch (_) { return c; }
}

// Ehtiyat fon: şəkil çəkilə bilməsə, sualın mətni və variantları sadə yazı ilə
function textQuestionCanvas(q) {
  const W = 1000, pad = 28, lh = 34;
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = '26px Arial, sans-serif';
  const wrap = (t) => { const out = []; String(t || '').replace(/\$+/g, '').split('\n').forEach((para) => { let line = '';
    para.split(/\s+/).forEach((w) => { const tt = line ? line + ' ' + w : w; if (ctx.measureText(tt).width > W - pad * 2 && line) { out.push(line); line = w; } else line = tt; }); out.push(line); }); return out; };
  const lines = [...wrap(q.body), '', ...(q.options || []).map((o, i) => `${'ABCDEF'[i]}) ${String(o).replace(/\$+/g, '')}`)];
  c.width = W; c.height = pad * 2 + lines.length * lh;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, c.height);
  ctx.fillStyle = '#111827'; ctx.font = '26px Arial, sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + 26 + i * lh));
  return c;
}

function drawStrokes(ctx, strokes, k = 1) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c; ctx.lineWidth = s.w * k;
    ctx.beginPath();
    const p = s.p;
    ctx.moveTo(p[0][0] * k, p[0][1] * k);
    if (p.length === 1) ctx.lineTo(p[0][0] * k + 0.1, p[0][1] * k);
    else if (p.length === 2) ctx.lineTo(p[1][0] * k, p[1][1] * k);
    else {
      // hamar xətt: nöqtələr arasından əyri keçir (künc-künc görünməsin)
      for (let i = 1; i < p.length - 1; i++) {
        ctx.quadraticCurveTo(p[i][0] * k, p[i][1] * k, (p[i][0] + p[i + 1][0]) / 2 * k, (p[i][1] + p[i + 1][1]) / 2 * k);
      }
      ctx.lineTo(p[p.length - 1][0] * k, p[p.length - 1][1] * k);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Sualın şəkli + xətlər → JPEG (müəllimə göndərmək üçün)
function inkComposite(data, bg, outW = 1200, quality = 0.8) {
  const k = outW / data.W;
  const out = document.createElement('canvas');
  out.width = outW; out.height = Math.round(data.H * k);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  if (bg) { const r = inkBgRect(data, bg); ctx.drawImage(bg.img, r.x * k, r.y * k, r.w * k, r.h * k); }
  const ink = document.createElement('canvas');
  ink.width = out.width; ink.height = out.height;
  drawStrokes(ink.getContext('2d'), data.s, k);
  ctx.drawImage(ink, 0, 0);
  return out.toDataURL('image/jpeg', quality);
}
// Sualın yeri və ölçüsü (məntiqi vahidlərlə). data.b = { x, y, w } — tələbə yerini/ölçüsünü dəyişibsə.
function inkBgDefault(data, bg) {
  const w = Math.min(data.W * 0.96, (data.H * 0.7) * bg.w / bg.h);
  return { x: (data.W - w) / 2, y: 8, w };
}
function inkBgRect(data, bg) {
  const b = data.b && data.b.w > 0 ? data.b : inkBgDefault(data, bg);
  return { x: b.x, y: b.y, w: b.w, h: b.w * bg.h / bg.w };
}

function openInk(q, fieldset, data, onSave) {
  const radios = fieldset ? [...fieldset.querySelectorAll('input[type=radio]')] : [];
  const dlg = document.createElement('div');
  dlg.className = 'ink-modal';
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Sualın üstündə yaz');
  dlg.innerHTML = `<div class="ink-tools">
      <div class="ink-colors">${INK_COLORS.map(([c, n], i) => `<button type="button" class="ink-c ${i ? '' : 'on'}" data-c="${c}" style="background:${c}" aria-label="${n}"></button>`).join('')}</div>
      <button type="button" class="ink-t" data-w="3" aria-label="Nazik">✎</button><button type="button" class="ink-t on" data-w="6" aria-label="Qalın"><b>✎</b></button>
      <button type="button" class="ink-t" data-er aria-label="Pozan">⌫ pozan</button>
      <button type="button" class="ink-t" data-undo aria-label="Geri al">↶</button>
      <button type="button" class="ink-t" data-clear aria-label="Hamısını sil">🗑</button>
      <span class="ink-grp"><button type="button" class="ink-t" data-move aria-pressed="false" title="Sualı sürüşdür və ölçüsünü dəyiş">✋ Sual</button><button type="button" class="ink-t" data-zout aria-label="Sualı kiçilt">－</button><button type="button" class="ink-t" data-zin aria-label="Sualı böyüt">＋</button></span>
      <span class="ink-sp"></span>
      <button type="button" class="btn primary" data-done>Hazır</button></div>
    <div class="ink-hint small" hidden></div>
    <div class="ink-area"><div class="ink-stage"><canvas class="ink-bgc"></canvas><canvas class="ink-c2"></canvas></div></div>
    ${radios.length ? `<div class="ink-ans" role="group" aria-label="Cavabın"><span class="ink-ans-l">Cavabın:</span>${radios.map((r, j) => `<button type="button" class="ink-a ${r.checked ? 'on' : ''}" data-a="${j}" aria-pressed="${r.checked}">${'ABCDEF'[j]}</button>`).join('')}</div>` : ''}`;
  document.body.appendChild(dlg);
  // cavabı lövhədən də işarələmək olur — aşağıdakı testdəki variant seçilir
  $$('[data-a]', dlg).forEach((btn) => btn.onclick = () => {
    const r = radios[+btn.dataset.a]; if (!r) return;
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
    $$('[data-a]', dlg).forEach((x) => { const on = x === btn; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  });
  document.body.classList.add('ink-open');
  const area = $('.ink-area', dlg), stage = $('.ink-stage', dlg), bgc = $('.ink-bgc', dlg), cv = $('.ink-c2', dlg), hint = $('.ink-hint', dlg);
  let color = INK_COLORS[0][0], width = 6, eraser = false, moveMode = false;
  let k = 1;
  const drawBg = () => {
    const b = bgc.getContext('2d');
    b.fillStyle = '#fff'; b.fillRect(0, 0, bgc.width, bgc.height);
    const bg = inkBg.get(q.id);
    if (!bg) return;
    const r = inkBgRect(data, bg);
    b.imageSmoothingQuality = 'high';
    b.drawImage(bg.img, r.x * k, r.y * k, r.w * k, r.h * k);
    if (moveMode) { b.strokeStyle = '#0E7490'; b.lineWidth = 2; b.setLineDash([10, 6]); b.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k); b.setLineDash([]); }
  };
  const fit = () => {
    const aw = area.clientWidth, ah = area.clientHeight;
    if (!data.W) { data.W = 1000; data.H = Math.round(Math.max(1000, Math.min(2200, 1000 * ah / Math.max(1, aw)))); }
    const sc = Math.min(aw / data.W, ah / data.H);
    const dw = Math.floor(data.W * sc), dh = Math.floor(data.H * sc);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    [bgc, cv].forEach((c) => { c.width = Math.round(dw * dpr); c.height = Math.round(dh * dpr); c.style.width = dw + 'px'; c.style.height = dh + 'px'; });
    stage.style.width = dw + 'px'; stage.style.height = dh + 'px';
    k = (dw * dpr) / data.W;
    drawBg();
    redraw();
    return k;
  };
  const redraw = () => { snap = null; const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); drawStrokes(c, data.s, k); };
  // yazarkən: bitmiş xətlərin surəti + yalnız indiki xətt çəkilir (çox xətt olanda da ləngimir), kadr başına bir dəfə
  let snap = null, raf = 0;
  const takeSnap = () => { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); drawStrokes(c, data.s.filter((x) => x !== cur), k);
    snap = document.createElement('canvas'); snap.width = cv.width; snap.height = cv.height; snap.getContext('2d').drawImage(cv, 0, 0); };
  const drawCur = () => { raf = 0; if (!cur) return; if (!snap) takeSnap(); const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(snap, 0, 0); drawStrokes(c, [cur], k); };
  const queueCur = () => { if (!raf) raf = requestAnimationFrame(drawCur); };
  const posF = (ev) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * data.W, (ev.clientY - r.top) / r.height * data.H]; };
  const pos = (ev) => posF(ev).map((v) => Math.round(v * 10) / 10);

  // --- sualın yeri/ölçüsü ---
  const curB = () => { const bg = inkBg.get(q.id); if (!bg) return null; const r = inkBgRect(data, bg); return { x: r.x, y: r.y, w: r.w, h: r.h }; };
  const setB = (x, y, w) => {
    const bg = inkBg.get(q.id); if (!bg) return;
    w = Math.max(data.W * 0.2, Math.min(data.W * 3, w));
    const h = w * bg.h / bg.w;
    // ən azı bir hissəsi lövhədə qalsın
    x = Math.max(-w + 80, Math.min(data.W - 80, x));
    y = Math.max(-h + 80, Math.min(data.H - 80, y));
    data.b = { x: Math.round(x), y: Math.round(y), w: Math.round(w) };
    drawBg();
  };
  const zoom = (f) => { const b = curB(); if (!b) return; const cx = b.x + b.w / 2, cy = b.y + b.h / 2; const w = b.w * f; setB(cx - w / 2, cy - (b.h * f) / 2, w); onSave(data); };
  const touches = new Map(); // barmaqlar (sualı tənzimləmək üçün)
  let gest = null;
  const startGesture = () => {
    const b = curB(); if (!b) { gest = null; return; }
    const pts = [...touches.values()];
    if (pts.length === 1) gest = { one: true, p0: pts[0], b };
    else { const [a, c] = pts; gest = { one: false, d0: Math.hypot(a[0] - c[0], a[1] - c[1]) || 1, m0: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], b }; }
  };
  const moveGesture = () => {
    if (!gest) return;
    const pts = [...touches.values()];
    if (gest.one && pts.length === 1) { setB(gest.b.x + pts[0][0] - gest.p0[0], gest.b.y + pts[0][1] - gest.p0[1], gest.b.w); return; }
    if (!gest.one && pts.length >= 2) {
      const [a, c] = pts;
      const f = Math.max(0.2, Math.min(5, (Math.hypot(a[0] - c[0], a[1] - c[1]) || 1) / gest.d0));
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      // barmaqların ortası altındakı nöqtə yerində qalır
      const w = gest.b.w * f;
      const real = Math.max(data.W * 0.2, Math.min(data.W * 3, w)) / gest.b.w;
      setB(m[0] - (gest.m0[0] - gest.b.x) * real, m[1] - (gest.m0[1] - gest.b.y) * real, w);
    }
  };
  const showHint = (t) => { hint.textContent = t; hint.hidden = !t; };
  const setMove = (on) => {
    moveMode = on;
    const btn = $('[data-move]', dlg); btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
    cv.style.cursor = on ? 'move' : 'crosshair';
    showHint(on ? 'Sualı barmaqla sürüşdür, iki barmaqla böyüt/kiçilt. Bitirəndə yenə “✋ Sual”-a bas.' : '');
    drawBg();
  };

  let cur = null;
  cv.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (ev.pointerType === 'pen' && !inkPenSeen) {
      inkPenSeen = true;
      // qələm ilk dəfə toxunanda: son anlarda ovucun təsadüfən çəkdiyi xətləri sil
      const now = Date.now(), n = data.s.length;
      data.s = data.s.filter((x) => !(x.t && now - x.t < 2000));
      if (cur && cur.t) cur = null;
      if (data.s.length !== n) { redraw(); onSave(data); }
    }
    // Sualı tənzimləmək: yalnız "✋ Sual" rejimində (ovuc sualı təsadüfən oynatmasın)
    if (moveMode) {
      if (cur) return;
      try { cv.setPointerCapture(ev.pointerId); } catch (_) { /* */ }
      touches.set(ev.pointerId, posF(ev));
      startGesture();
      return;
    }
    if (inkPenSeen && ev.pointerType === 'touch') return; // qələm varsa, barmaq/ovuc yazmır
    if (cur) return; // eyni anda ikinci xətt yox
    try { cv.setPointerCapture(ev.pointerId); } catch (_) { /* */ }
    cur = { c: color, w: eraser ? 28 : width, e: eraser, p: [pos(ev)], id: ev.pointerId };
    if (ev.pointerType === 'touch') cur.t = Date.now();
    snap = null; data.s.push(cur); queueCur();
  });
  cv.addEventListener('pointermove', (ev) => {
    if (touches.has(ev.pointerId)) { touches.set(ev.pointerId, posF(ev)); moveGesture(); return; }
    if (!cur || ev.pointerId !== cur.id) return;
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    evs.forEach((e) => { const p = pos(e); const l = cur.p[cur.p.length - 1]; if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) >= 0.8) cur.p.push(p); });
    queueCur();
  });
  const end = (ev) => {
    if (touches.has(ev.pointerId)) {
      touches.delete(ev.pointerId);
      const had = !!gest;
      if (touches.size && (moveMode || touches.size >= 2)) startGesture(); else gest = null;
      if (had && !touches.size) onSave(data);
      return;
    }
    if (cur && ev.pointerId === cur.id) { if (ev.type !== 'lostpointercapture') { const p = pos(ev); const l = cur.p[cur.p.length - 1]; if (p[0] !== l[0] || p[1] !== l[1]) cur.p.push(p); } delete cur.id; cur = null; redraw(); onSave(data); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('lostpointercapture', end);
  // iOS: lövhədə uzun basma / sürüşdürmə səhifəni seçməsin, böyütməsin, sürüşdürməsin
  ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'dblclick'].forEach((t) => area.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }));
  dlg.addEventListener('contextmenu', (e) => e.preventDefault());
  $$('[data-c]', dlg).forEach((b) => b.onclick = () => { color = b.dataset.c; eraser = false; setMove(false); $$('[data-c]', dlg).forEach((x) => x.classList.toggle('on', x === b)); $('[data-er]', dlg).classList.remove('on'); });
  $$('[data-w]', dlg).forEach((b) => b.onclick = () => { width = +b.dataset.w; eraser = false; setMove(false); $$('[data-w]', dlg).forEach((x) => x.classList.toggle('on', x === b)); $('[data-er]', dlg).classList.remove('on'); });
  $('[data-er]', dlg).onclick = (e) => { eraser = !eraser; setMove(false); e.currentTarget.classList.toggle('on', eraser); };
  $('[data-undo]', dlg).onclick = () => { data.s.pop(); redraw(); onSave(data); };
  $('[data-clear]', dlg).onclick = () => { if (data.s.length && confirm('Bu sualdakı bütün yazılar silinsin?')) { data.s.length = 0; redraw(); onSave(data); } };
  $('[data-move]', dlg).onclick = () => setMove(!moveMode);
  $('[data-zin]', dlg).onclick = () => zoom(1.15);
  $('[data-zout]', dlg).onclick = () => zoom(1 / 1.15);
  const close = () => { window.removeEventListener('resize', onResize); dlg.remove(); document.body.classList.remove('ink-open'); onSave(data, true); };
  $('[data-done]', dlg).onclick = close;
  const onResize = () => { k = fit(); };
  window.addEventListener('resize', onResize);
  // fon: sualın şəkli (bir dəfə çəkilir)
  k = fit();
  if (!inkBg.has(q.id)) {
    showHint('Sual yüklənir…');
    captureQuestion(fieldset).then((c) => { c = c || textQuestionCanvas(q); inkBg.set(q.id, { img: c, w: c.width, h: c.height }); if (dlg.isConnected) { showHint(moveMode ? hint.textContent : ''); fit(); } });
  }
}

// Test formuna qoşulur: hər suala "✏️ Yaz" düyməsi; xətlər yerli yaddaşda; göndərəndə şəkillər hazırlanır
function setupInk(form, test, key) {
  let store = {};
  try { store = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { store = {}; }
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(store)); } catch (_) { /* yaddaş dolubsa — yalnız bu sessiyada qalır */ } };
  const qById = Object.fromEntries(test.questions.map((q) => [q.id, q]));
  const mark = (fs, qid) => {
    const has = (store[qid]?.s || []).length > 0;
    const b = $('.ink-open-btn', fs);
    if (b) b.innerHTML = has ? '✏️ Yazdıqlarım <span class="ink-dot"></span>' : '✏️ Üstündə yaz';
  };
  $$('fieldset[data-q]', form).forEach((fs) => {
    const qid = fs.dataset.q;
    const bar = document.createElement('div');
    bar.className = 'ink-bar';
    bar.innerHTML = '<button type="button" class="btn small ink-open-btn">✏️ Üstündə yaz</button><span class="small muted">qələm və ya barmaqla həll et — müəllimin görəcək</span>';
    fs.insertBefore(bar, fs.children[1] || null);
    mark(fs, qid);
    $('.ink-open-btn', bar).onclick = () => {
      const data = store[qid] || (store[qid] = { W: 0, H: 0, s: [] });
      openInk(qById[qid], fs, data, (d, closed) => { store[qid] = d; persist(); if (closed) mark(fs, qid); });
    };
  });
  return {
    // göndərmək üçün: { sual id: JPEG data URL }
    async export() {
      const out = {};
      for (const [qid, d] of Object.entries(store)) {
        if (!d || !(d.s || []).length || !qById[qid]) continue;
        if (!inkBg.has(qid)) {
          const fs = form.querySelector(`fieldset[data-q="${CSS.escape(qid)}"]`);
          const c = (fs ? await captureQuestion(fs) : null) || textQuestionCanvas(qById[qid]);
          inkBg.set(qid, { img: c, w: c.width, h: c.height });
        }
        let img = '';
        for (const [w, ql] of [[1200, 0.8], [1000, 0.72], [800, 0.7], [650, 0.65]]) { img = inkComposite(d, inkBg.get(qid), w, ql); if (img.length <= 650000) break; }
        if (img.length <= 680000) out[qid] = img;
      }
      return out;
    },
    clear() { try { localStorage.removeItem(key); } catch (_) { /* */ } }
  };
}

function mountTestForm(test, { top = '', nameField = '', draftKey = '', deadline = null, ink = false, onQuestion, onSubmit }) {
  $app.innerHTML = `<form class="student" id="st">
    ${top}
    <h1>${esc(test.title)}</h1>
    ${test.due_at ? `<p class="muted small" style="margin:-8px 0 0">Son tarix: <strong>${esc(fmtDue(test.due_at))}</strong></p>` : ''}
    ${nameField}
    ${deadline ? '<div class="timer" id="timer" role="timer" aria-live="off"></div>' : ''}
    ${studentQuestionsHtml(test)}
    <button class="btn primary block" type="submit" style="min-height:52px;font-size:16px">Cavabları göndər</button>
  </form>`;
  const form = $('#st');
  if (onQuestion) $$('fieldset[data-q]', form).forEach((el, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ask-question'; b.textContent = 'Müəllimə sual';
    b.onclick = () => onQuestion(el.dataset.q, i + 1); el.appendChild(b);
  });
  // qaralama: səhifə yenilənsə cavablar itməsin
  const load = () => { try { return JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch (_) { return {}; } };
  if (draftKey) {
    const d = load();
    Object.entries(d).forEach(([k, v]) => {
      const el = form.querySelector(`[name="${CSS.escape(k)}"]`);
      if (!el) return;
      if (el.type === 'radio') { const r = form.querySelector(`[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`); if (r) r.checked = true; } else el.value = v;
    });
    const save = () => { const o = {}; new FormData(form).forEach((v, k) => { if (String(v).trim()) o[k] = String(v); }); try { localStorage.setItem(draftKey, JSON.stringify(o)); } catch (_) { /* */ } };
    form.addEventListener('change', save);
    form.addEventListener('input', save);
  }
  const inkApi = ink && draftKey ? setupInk(form, test, draftKey + '_ink') : null;
  let sent = false;
  let timer = null;
  const submit = async (auto) => {
    if (sent) return;
    const answers = collectAnswers(form, test, auto);
    if (!answers) return;
    sent = true;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Göndərilir…';
    try {
      let drawings = {};
      if (inkApi) { btn.textContent = 'Həllər hazırlanır…'; try { drawings = await inkApi.export(); } catch (_) { drawings = {}; } btn.textContent = 'Göndərilir…'; }
      await onSubmit(answers, auto, new FormData(form), drawings);
      clearInterval(timer);
      try { if (draftKey) localStorage.removeItem(draftKey); } catch (_) { /* */ }
      if (inkApi) inkApi.clear();
    } catch (err) {
      sent = false;
      btn.disabled = false;
      btn.textContent = 'Cavabları göndər';
      fail(err);
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(false); };
  if (deadline) {
    const tick = () => {
      if (!form.isConnected) return clearInterval(timer);
      const left = deadline - Date.now();
      const el = $('#timer');
      el.textContent = 'Qalan vaxt: ' + fmtClock(left);
      el.classList.toggle('low', left < 60000);
      if (left <= 0) { clearInterval(timer); toast('Vaxt bitdi, cavablar göndərilir'); submit(true); }
    };
    timer = setInterval(tick, 500);
    tick();
  }
}

// Vaxtlı test üçün başlamazdan əvvəl ekran
function startScreen(test, { top = '', nameField = '', onStart }) {
  $app.innerHTML = `<form class="student" id="startForm">
    ${top}
    <h1>${esc(test.title)}</h1>
    <div class="card stack">
      <p><strong>${test.questions.length} sual · ${test.time_limit_min} dəqiqə</strong></p>
      ${test.due_at ? `<p class="muted small">Son tarix: ${esc(fmtDue(test.due_at))}</p>` : ''}
      <p class="notice">"Başla" basandan sonra vaxt gedir və dayanmır. Vaxt bitəndə cavablar avtomatik göndəriləcək.</p>
      ${nameField}
      <button class="btn primary block" type="submit" style="min-height:52px">Başla</button>
    </div>
  </form>`;
  $('#startForm').onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', e.target), () => onStart(new FormData(e.target))).catch(fail); };
}

const studentMsg = (title, text, extra = '') => {
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack"><h1>${title}</h1><p class="muted">${text}</p>${extra}</div></div>`;
};

async function studentTest(id) {
  $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
  const { data: raw, error } = await sb.rpc('get_test_for_student', { p_test_id: id });
  if (error || !raw) return studentMsg('Test açılmadı', 'Test tapılmadı və ya müəllim onu bağlayıb.');
  if (raw.overdue) return studentMsg(esc(raw.title), `Son tarix keçib (${esc(fmtDue(raw.due_at))}). Cavablar artıq qəbul edilmir.`);
  const doneKey = 'mp_done_' + id;
  let done = null;
  try { done = JSON.parse(localStorage.getItem(doneKey) || 'null'); } catch (_) { done = null; }
  if (done) return studentDone(raw, done);

  let seed = '';
  try { seed = sessionStorage.getItem('mp_seed_' + id) || ''; if (!seed) { seed = String(Math.random()); sessionStorage.setItem('mp_seed_' + id, seed); } } catch (_) { seed = String(Math.random()); }
  const test = raw.shuffle ? shuffleTest(raw, seed + id) : raw;
  const students = test.students || [];
  const nameField = `<div class="card stack">${students.length
    ? `<label class="field">Adınızı seçin<select name="name" required><option value="">— seçin —</option>${students.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>`
    : '<label class="field">Ad və soyadınız<input type="text" name="name" required maxlength="80" autocomplete="name"></label>'}</div>`;
  const top = '<div class="row"><span class="brand-mark" style="color:#fff">SH</span><span class="muted">Math Saleh Hoca</span></div>';

  const run = (name, deadline) => mountTestForm(test, {
    top, draftKey: 'mp_draft_' + id, deadline,
    nameField: name ? `<input type="hidden" name="name" value="${esc(name)}"><p class="muted">${esc(name)}</p>` : nameField,
    onSubmit: async (answers, auto, f) => {
      const nm = String(f.get('name') || name || '').trim();
      if (!nm) throw new Error('Adınızı seçin');
      const { data, error: err } = await sb.rpc('submit_test', { p_test_id: id, p_student_name: nm, p_answers: answers });
      if (err) throw new Error(err.message);
      const result = { ...data, name: nm };
      try { localStorage.setItem(doneKey, JSON.stringify(result)); } catch (_) { /* yaddaş bağlıdır */ }
      studentDone(test, result);
    }
  });
  if (!test.time_limit_min) return run('', null);
  // ümumi linkdə vaxt brauzerdə saxlanılır
  let started = 0;
  try { started = +localStorage.getItem('mp_start_' + id) || 0; } catch (_) { /* */ }
  let savedName = '';
  try { savedName = localStorage.getItem('mp_name_' + id) || ''; } catch (_) { /* */ }
  if (started && savedName) return run(savedName, started + test.time_limit_min * 60000);
  startScreen(test, { top, nameField, onStart: async (f) => {
    const nm = String(f.get('name') || '').trim();
    if (!nm) throw new Error('Adınızı seçin');
    const t0 = Date.now();
    try { localStorage.setItem('mp_start_' + id, String(t0)); localStorage.setItem('mp_name_' + id, nm); } catch (_) { /* */ }
    run(nm, t0 + test.time_limit_min * 60000);
  } });
}

function studentDone(test, r, back = '', reviewHref = '', reviewNote = '') {
  const hasOpen = (test.questions || []).some((q) => q.qtype === 'open');
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack" style="text-align:center">
    <h1>${esc(test.title)}</h1>
    <p class="muted">${esc(r.name)}, cavablarınız göndərildi.</p>
    ${r.total ? `<div class="score-big">${r.score}/${r.total}</div><p class="muted">çoxseçimli suallardan düz cavab</p>` : ''}
    ${hasOpen ? '<p class="notice">Açıq sualları müəlliminiz yoxlayacaq.</p>' : ''}
    ${reviewHref ? `<a class="btn primary block" href="${reviewHref}">Səhvlərimə bax</a>` : ''}
    ${reviewNote ? `<p class="muted small">${reviewNote}</p>` : ''}
    ${back ? `<a class="btn ${reviewHref ? '' : 'primary'} block" href="${back}">Testlərimə qayıt</a>` : ''}
  </div></div>`;
}

// ================= Tələbə kabineti (şəxsi link: #/s/KOD) =================

const CODE_KEY = 'mp_student_code';
const pct = (r) => (r.total ? Math.round(r.score / r.total * 100) : 0);

function studentCodeForm(note = '') {
  $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="codeForm">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><span class="muted">Math Saleh Hoca</span></div>
    <h1>tələbə girişi</h1>
    ${note ? `<p class="notice">${note}</p>` : '<p class="muted">Müəlliminizin göndərdiyi linki açın və ya kodu yazın.</p>'}
    <label class="field">Kod<input name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="məs. K7M2QX9A" style="text-transform:uppercase;letter-spacing:2px"></label>
    <button class="btn primary block" type="submit">Daxil ol</button>
  </form></div>`;
  $('#codeForm').onsubmit = (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) go('#/s/' + code);
  };
}

const reviewNoteOf = (mode) => (mode === 'after_close' ? 'Düzgün cavablar və həllər müəllim testi bağlayanda açılacaq.' : '');

// tələbənin səhv dəftəri: bənzər suallar bir-bir; düz → dəftərdən silinir, səhv → 2 gün sonra başqa bənzəri
async function mistakesView(code, home) {
  const { data: mk, error } = await sb.rpc('student_mistakes', { p_code: code });
  if (error || !mk) return studentMsg('Səhv dəftəri', 'Hazırda açmaq olmadı.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
  const items = mk.items || [];
  let i = 0; let right = 0;
  const show = () => {
    if (i >= items.length) {
      $app.innerHTML = `<div class="student"><div class="card stack" style="text-align:center;align-items:center">
        <div style="font-size:48px">${right === items.length ? '🎉' : '💪'}</div>
        <h1>Bu günlük bitdi</h1>
        <p>${items.length} sualdan <strong>${right}</strong>-ni düz tapdın${right ? ' — onlar dəftərdən silindi' : ''}.</p>
        ${items.length - right ? `<p class="muted">Səhv etdiklərinə 2 gün sonra başqa bənzər sual gələcək.</p>` : ''}
        <a class="btn primary block" href="${home}">Testlərimə qayıt</a></div></div>`;
      return;
    }
    const it = items[i]; const q = it.question;
    const figs = hasOptionFigures(q);
    $app.innerHTML = `<div class="student">
      <div class="row between"><a class="muted" href="${home}">‹ Testlərim</a><span class="muted">${esc(mk.name || '')}</span></div>
      <div class="row between"><h1>📒 Səhv dəftəri</h1><span class="tag">${i + 1} / ${items.length}</span></div>
      <div class="nb-steps" aria-hidden="true">${items.map((_, k) => `<span class="${k < i ? 'done' : k === i ? 'cur' : ''}"></span>`).join('')}</div>
      <form class="card stack" id="nbForm">
        ${it.attempts ? `<span class="small muted">Bu mövzuda ${it.attempts + 1}-ci cəhd</span>` : '<span class="small muted">Səhv etdiyin suala bənzər sual</span>'}
        <div class="q-text pre" style="font-size:17px">${esc(q.body)}</div>
        ${q.figure ? `<div class="q-fig">${safeSvg(q.figure)}</div>` : ''}
        <div class="${figs ? 'fig-choices' : 'stack'}" style="gap:8px">${(q.options || []).map((o, j) => `<label class="opt-choice"><input type="radio" name="a" value="${esc(o)}"><span>${'ABCDEF'[j]})</span>${figs ? `<span class="opt-fig">${safeSvg(q.option_figures[j])}</span>` : `<span>${esc(o)}</span>`}</label>`).join('')}</div>
        <div id="nbRes"></div>
        <button class="btn primary block" type="submit" id="nbBtn">Yoxla</button>
      </form></div>`;
    window.scrollTo(0, 0);
    const form = $('#nbForm');
    let answered = false;
    form.onsubmit = (e) => {
      e.preventDefault();
      if (answered) { i++; show(); return; }
      const v = new FormData(form).get('a');
      if (!v) return toast('Variant seçin', true);
      busy($('#nbBtn'), async () => {
        const { data: r, error: err } = await sb.rpc('student_answer_mistake', { p_code: code, p_mistake: it.id, p_answer: v });
        if (err) throw new Error(err.message);
        answered = true;
        if (r.correct) right++;
        $$('input[name=a]', form).forEach((x) => { x.disabled = true; const l = x.closest('.opt-choice');
          if (normAns(x.value) === normAns(r.answer)) l.classList.add('right'); else if (x.checked) l.classList.add('wrong'); });
        $('#nbRes').innerHTML = r.correct
          ? '<p class="nb-ok">✓ Düzdür! Bu sual dəftərdən silindi.</p>'
          : `<div class="nb-bad"><strong>Səhvdir.</strong> Düz cavab: <strong>${esc(r.answer)}</strong>.<br><span class="small">Narahat olma: 2 gün sonra bu mövzudan başqa bir bənzər sual gələcək.</span></div>
            ${r.solution ? `<details class="sol" open><summary>Həlli</summary><div>${esc(r.solution)}</div></details>` : ''}`;
      }).then(() => { if (answered) $('#nbBtn').textContent = i + 1 < items.length ? 'Növbəti sual ›' : 'Bitir'; }).catch((err2) => toast(err2.message, true));
    };
  };
  if (!items.length) return studentMsg('📒 Səhv dəftəri', +mk.open ? `Hələ təkrar vaxtı deyil. Növbəti: ${esc(fmtDue(mk.next_at))}.` : 'Dəftər boşdur — əla! 🎉', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
  show();
}

const fmtDayAz = (d) => { const x = new Date(d + 'T00:00:00'); return isNaN(x) ? '' : `${x.getDate()} ${AZ_MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const pctOf = (r) => (r.total ? Math.round(r.score / r.total * 100) : 0);
const barCls = (p) => (p >= 75 ? 'hi' : p >= 50 ? 'mid' : 'low');

// Tələbə səhifəsi: deneme nəticələri, mövzu analizi, dərs qeydləri (012 yoxdursa heç biri göstərilmir)
function studentInsightsHtml(an, notes, home) {
  const out = [];
  const res = an?.results || [];
  const dn = res.filter((r) => r.kind === 'deneme');
  if (dn.length) {
    const last = dn[dn.length - 1], prev = dn[dn.length - 2];
    const diff = prev ? pctOf(last) - pctOf(prev) : null;
    out.push(`<section class="card stack deneme-card"><div class="row between"><h2>🎯 Deneme nəticələrim</h2>${diff === null ? '' : `<span class="tag ${diff >= 0 ? 'ai' : 'red'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% son denemedə</span>`}</div>
      <div class="spark" aria-label="Deneme irəliləyişi">${dn.slice(-12).map((r) => `<span class="spark-b ${barCls(pctOf(r))}" style="height:${Math.max(6, pctOf(r))}%" title="${esc(r.title)}: ${pctOf(r)}%"></span>`).join('')}</div>
      ${dn.slice().reverse().map((r) => { const wrong = Math.max(0, r.total - r.score - r.empty); return `<div class="dn-row"><span class="d-main"><strong>${esc(r.title)}</strong><span class="small muted">${fmtDate(r.at)}</span></span>
        <span class="dn-cnt"><span class="c-ok">✓ ${r.score}</span><span class="c-bad">✗ ${wrong}</span><span class="c-empty">— ${r.empty}</span></span>${pctChip(pctOf(r))}</div>`; }).join('')}
    </section>`);
  }
  const topics = (an?.topics || []).filter((t) => t.total > 0);
  if (topics.length || res.length >= 2) {
    const tp = topics.map((t) => ({ ...t, p: Math.round(t.right / t.total * 100) }));
    const weak = tp.filter((t) => t.total >= 2 && t.p < 75).sort((a, b) => a.p - b.p).slice(0, 3);
    const noteFor = (topic) => (notes || []).find((n) => n.topic && n.topic.toLocaleLowerCase('az') === topic.toLocaleLowerCase('az'));
    out.push(`<section class="card stack"><h2>📊 Mənim analizim</h2>
      ${res.length >= 2 ? `<div><div class="small muted">Son testlərim</div><div class="spark">${res.slice(-12).map((r) => `<span class="spark-b ${barCls(pctOf(r))}" style="height:${Math.max(6, pctOf(r))}%" title="${esc(r.title)}: ${pctOf(r)}%"></span>`).join('')}</div></div>` : ''}
      ${weak.length ? `<div class="weak-box"><strong>Üzərində işlə:</strong>${weak.map((t) => { const n = noteFor(t.topic); return `<div class="weak-row"><span>${esc(t.topic)} — <strong>${t.p}%</strong></span>${n ? `<a class="small" href="#nt-${n.id}" data-nt="${n.id}">📚 Materiala bax</a>` : ''}</div>`; }).join('')}</div>` : ''}
      ${tp.length ? `<div class="small muted">Mövzular üzrə (cavabları açılmış testlərdən)</div><div class="sbars">${tp.slice().sort((a, b) => b.p - a.p).map((t) => `<div class="sbar"><span class="sbar-l">${esc(t.topic)}</span><span class="sbar-t"><span class="${barCls(t.p)}" style="width:${t.p}%"></span></span><span class="sbar-v">${t.p}% <small>${t.right}/${t.total}</small></span></div>`).join('')}</div>` : ''}
    </section>`);
  }
  if (notes && notes.length) {
    out.push(`<section class="card stack"><h2>📚 Dərs materiallarım</h2>${notes.map((n) => {
      const url = n.file_path ? noteUrl(n.file_path) : '';
      const isImg = /^image\//.test(n.file_type || '');
      return `<details class="nt-item" id="nt-${n.id}"><summary><span class="nt-head"><strong>${esc(n.title)}</strong><span class="small muted">${esc(fmtDue(n.created_at))}</span></span>
          <span class="nt-meta">${n.topic ? `<span class="tag book">${esc(n.topic)}</span>` : ''}${n.personal ? '<span class="tag deneme">sənin üçün</span>' : ''}${n.file_path ? `<span class="tag">${n.file_type === 'application/pdf' ? '📄 PDF' : '🖼 şəkil'}</span>` : ''}${n.link_url ? '<span class="tag deneme">▶ video</span>' : ''}</span></summary>
        ${n.body ? `<div class="nt-body">${esc(n.body)}</div>` : ''}
        ${materialVideoHtml(n.link_url, n.title)}
        ${n.link_url && /^https?:\/\//i.test(n.link_url) ? `<a class="btn primary block" href="${esc(n.link_url)}" target="_blank" rel="noopener">▶ Videoya / linkə bax</a>` : ''}
        ${url ? (isImg ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="nt-img" src="${esc(url)}" alt="${esc(n.file_name || n.title)}" loading="lazy"></a>` : `<a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">📄 ${esc(n.file_name || 'Faylı aç')}</a>`) : ''}
      </details>`; }).join('')}</section>`);
  }
  return out.join('');
}

async function studentPortal(rawCode, testId, sub) {
  let code = String(rawCode || '').trim().toUpperCase();
  if (!code) {
    try { code = localStorage.getItem(CODE_KEY) || ''; } catch (_) { code = ''; }
    if (code) return go('#/s/' + code);
    return studentCodeForm();
  }
  $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
  window.scrollTo(0, 0);
  const home = '#/s/' + code;

  const hubPage = ['home','tasks','lessons','results','notebook'].includes(testId) ? testId : 'home';
  if (hubPage !== 'home' || testId === 'home') testId = null;
  if (testId === 'ask') {
    const {data:me,error}=await sb.rpc('student_portal',{p_code:code});
    if(error||!me)return studentCodeForm('Tələbə linki açılmadı. Yenidən yoxlayın.');
    $app.innerHTML='<div class="student solver-page"></div>';
    const refreshAllowance=async()=>{const {data,error}=await sb.rpc('student_ai_allowance',{p_code:code});if(error||!data)throw new Error(error?.message||'Limit oxunmadı');return data;};
    try { const allowance=await refreshAllowance();cleanupStudentSolver=mountStudentSolver($app.querySelector('.solver-page'),{code,home,allowance,refreshAllowance}); }
    catch (_) { $app.querySelector('.solver-page').innerHTML=`<a class="btn" href="${esc(home)}">‹ Ana səhifə</a><h1>Sualını soruş</h1><p class="notice">Bölmə hazırda açılmır. Müəllim bazada 020_student_solver.sql yeniləməsini yoxlamalıdır.</p>`; }
    return;
  }
  if (testId === 'defter') return mistakesView(code, home);

  if (testId && sub === 'review') {
    const { data: rv, error } = await sb.rpc('student_review', { p_code: code, p_test_id: testId });
    if (error || !rv) return studentMsg('Açılmadı', 'Bu testin nəticəsi tapılmadı.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    if (!rv.allowed) return studentMsg(esc(rv.title), rv.review_mode === 'after_close' ? 'Düzgün cavablar müəllim testi bağlayanda açılacaq.' : 'Müəllim bu test üçün cavabları göstərmir.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    const c = countStates(rv.questions, rv.answers);
    $app.innerHTML = `<div class="student">
      <div class="row between"><a class="muted" href="${home}">‹ Testlərim</a><span class="muted">${esc(rv.name)}</span></div>
      <h1>${esc(rv.title)}</h1>
      <div class="card row" style="gap:10px"><div class="score-big" style="font-size:40px">${rv.score}/${rv.total}</div>
        <span class="tag ai">✓ ${c.right} düz</span><span class="tag red">✗ ${c.wrong} səhv</span><span class="tag">— ${c.empty} boş</span></div>
      ${c.wrong ? `<label class="row small" style="gap:8px"><input type="checkbox" id="onlyWrong"> Yalnız səhv və boş suallar</label>` : ''}
      <div class="stack" id="rvList">${rv.questions.map((q, i) => `<div class="card" data-st="${answerState(q, rv.answers?.[q.id])}">${reviewQuestionHtml(q, rv.answers?.[q.id], i)}</div>`).join('')}</div>
      <a class="btn block" href="${home}">Testlərimə qayıt</a>
    </div>`;
    $$('#rvList > [data-st]').forEach((el, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ask-question'; b.textContent = 'Müəllimə sual'; b.onclick = () => askStudentTeacher(code, {test_id: testId, question_id: rv.questions[i].id, title: rv.title + ' · Sual ' + (i+1)}); el.appendChild(b); });
    const ow = $('#onlyWrong');
    if (ow) ow.onchange = () => $$('#rvList > [data-st]').forEach((el) => { el.hidden = ow.checked && el.dataset.st === 'right'; });
    return;
  }

  if (testId) {
    const { data: test, error } = await sb.rpc('student_get_test', { p_code: code, p_test_id: testId });
    if (error || !test) return studentMsg('Test açılmadı', 'Test tapılmadı.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    if (test.result) return studentDone(test, { ...test.result, name: test.name }, home, test.review ? `${home}/${testId}/review` : '', test.review ? '' : reviewNoteOf(test.review_mode));
    if (test.closed) return studentMsg(esc(test.title), 'Müəllim bu testi bağlayıb.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    if (test.overdue) return studentMsg(esc(test.title), `Son tarix keçib (${esc(fmtDue(test.due_at))}). Cavablar artıq qəbul edilmir.`, `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    const shown = test.shuffle ? shuffleTest(test, String(test.seed) + testId) : test;
    const top = `<div class="row between"><a class="muted" href="${home}">‹ Testlərim</a><span class="muted">${esc(test.name)}</span></div>`;
    rememberStudent(code, 'test', testId);
    const run = (deadline) => mountTestForm(shown, {
      top, deadline, draftKey: 'mp_draft_' + code + '_' + testId, ink: true,
      onQuestion: (question_id, number) => askStudentTeacher(code, { test_id: testId, question_id, title: test.title + ' · Sual ' + number }),
      onSubmit: async (answers, _auto, _fd, drawings) => {
        const { data, error: err } = await sb.rpc('student_submit_test', { p_code: code, p_test_id: testId, p_answers: answers });
        if (err) throw new Error(err.message);
        if (drawings && Object.keys(drawings).length) {
          const { error: e2 } = await sb.rpc('student_save_drawings', { p_code: code, p_test_id: testId, p_drawings: drawings });
          if (e2) toast('Cavablar göndərildi, amma yazdığın həllər göndərilmədi', true);
        }
        const now = test.review_mode === 'after_submit';
        studentDone(shown, { ...data, name: test.name }, home, now ? `${home}/${testId}/review` : '', now ? '' : reviewNoteOf(test.review_mode));
      }
    });
    if (!test.time_limit_min) { run(null); return; }
    // server vaxtı ilə brauzer vaxtı arasındakı fərq
    const deadlineOf = (startedAt, serverNow) => Date.now() + (new Date(startedAt).getTime() + test.time_limit_min * 60000 - new Date(serverNow).getTime());
    if (test.started_at) { run(deadlineOf(test.started_at, test.now)); return; }
    startScreen(shown, { top, onStart: async () => {
      const { data: st, error: err } = await sb.rpc('student_start_test', { p_code: code, p_test_id: testId });
      if (err) throw new Error(/function .* does not exist/i.test(err.message) ? 'Müəllim bazanı yeniləməlidir (007).' : err.message);
      run(deadlineOf(st.started_at, st.now));
    } });
    return;
  }

  const soft = (fn) => Promise.resolve(sb.rpc(fn, { p_code: code })).then((r) => (r && !r.error ? r.data : null), () => null);
  const [{ data: me, error }, mk, an, notes, hub] = await Promise.all([
    sb.rpc('student_portal', { p_code: code }), soft('student_mistakes'), soft('student_analysis'), soft('student_notes'), soft('student_hub')
  ]);
  if (error || !me) {
    try { if (localStorage.getItem(CODE_KEY) === code) localStorage.removeItem(CODE_KEY); } catch (_) { /* */ }
    return studentCodeForm(error ? 'Hazırda açmaq olmadı, bir az sonra yenidən yoxlayın.' : 'Bu link və ya kod etibarsızdır. Müəlliminizdən yeni link istəyin.');
  }
  try { localStorage.setItem(CODE_KEY, code); } catch (_) { /* */ }
  const todo = me.tests.filter((t) => !t.result && t.is_open && !t.overdue);
  const missed = me.tests.filter((t) => !t.result && t.overdue);
  const done = me.tests.filter((t) => t.result);
  const avg = done.length ? Math.round(done.reduce((a, t) => a + pct(t.result), 0) / done.length) : null;
  $app.innerHTML = `<div class="student">
    <div class="row"><span class="brand-mark" style="color:#fff">SH</span><span class="muted">Math Saleh Hoca</span></div>
    <div><h1>Salam, ${esc(me.name)}</h1><p class="muted">${esc(me.class || '')}</p></div>
    ${an?.exam_date ? `<div class="exam-chip">🎓 <span>${esc(daysLeftText(an.exam_date))}</span><small>${esc(fmtDayAz(an.exam_date))}</small></div>` : ''}
    <section class="card stack"><h2>Yazılacaq testlər${todo.length ? ` (${todo.length})` : ''}</h2>
      ${todo.length ? todo.map((t) => `<a class="portal-row" href="${home}/${t.id}">
          <span><strong>${esc(t.title)}</strong>${t.personal ? ' <span class="tag book">sənin üçün</span>' : ''}<span class="small muted"> · ${t.count} sual${t.time_limit_min ? ` · ⏱ ${t.time_limit_min} dəq` : ''}</span>
            ${t.due_at ? `<br><span class="small" style="color:#8A5A00">son tarix: ${esc(fmtDue(t.due_at))}</span>` : ''}</span><span class="btn small primary">Başla</span></a>`).join('')
        : '<div class="empty">Hazırda yazılacaq test yoxdur.</div>'}
      ${missed.length ? `<div class="small muted">Vaxtı keçmiş: ${missed.map((t) => esc(t.title)).join(', ')}</div>` : ''}
    </section>
    ${mk && (+mk.open || +mk.cleared) ? `<section class="card stack notebook">
      <div class="row between"><h2>📒 Səhv dəftərim</h2>${+mk.cleared ? `<span class="tag ai">✓ ${mk.cleared} düzəldilib</span>` : ''}</div>
      ${+mk.due ? `<p>Səhv etdiyin suallara bənzər <strong>${mk.due}</strong> sual səni gözləyir. Düz tapsan, dəftərdən silinəcək.</p>
        <a class="btn primary block" href="${home}/defter">Təkrar et (${mk.due})</a>`
      : +mk.open ? `<p class="muted">Dəftərdə <strong>${mk.open}</strong> sual var. Növbəti təkrar: <strong>${esc(fmtDue(mk.next_at))}</strong>.</p>`
      : '<p class="muted">Dəftər boşdur — bütün səhvlərini düzəltmisən! 🎉</p>'}
    </section>` : ''}
${studentInsightsHtml(an, notes, home)}
    <section class="card stack"><div class="row between"><h2>Nəticələrim</h2>${avg === null ? '' : `<span class="tag ai">orta ${avg}%</span>`}</div>
      ${done.length ? done.map((t) => `<div class="portal-row">
          <span><strong>${esc(t.title)}</strong><span class="small muted"> · ${fmtDate(t.result.created_at)}</span>
            ${t.review ? `<br><a class="small" href="${home}/${t.id}/review">Səhvlərimə bax ›</a>` : t.review_mode === 'after_close' ? '<br><span class="small muted">cavablar test bağlananda açılacaq</span>' : ''}</span>
          <span class="row" style="flex-wrap:nowrap;gap:8px"><span class="bar" style="width:70px"><i style="width:${pct(t.result)}%"></i></span><strong>${t.result.score}/${t.result.total}</strong></span></div>`).join('')
        : '<div class="empty">Hələ test yazmamısınız.</div>'}
    </section>
    <p class="small muted" style="text-align:center"><a href="#/privacy">Məxfilik siyasəti</a></p>
  </div>`;
  if (hub) mountStudentHub($app.querySelector('.student'), { code, home, me, notes: notes || [], hub, mk, an, initial: hubPage,
    onAsk: (context) => askStudentTeacher(code, context),
    onComplete: async (id, value) => {
      const { error } = await sb.rpc('student_material_done', { p_code: code, p_note_id: id, p_completed: value });
      if (error) { toast('Qeyd saxlanılmadı. Yenidən yoxlayın.', true); throw error; }
      toast(value ? 'Tamamlandı kimi qeyd edildi' : 'Qeyd ləğv edildi');
    }
  });
  if (!hub) $app.querySelector('.student').insertAdjacentHTML('afterbegin', `<a class="btn primary" href="${home}/ask">Sualını soruş</a>`);
  // "Dərs qeydinə bax": səhifə daxilində aç (hash marşrutu dəyişməsin)
  $$('[data-nt]').forEach((l) => l.onclick = (e) => {
    e.preventDefault();
    const d = document.getElementById('nt-' + l.dataset.nt);
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
}

function loadScript(src) {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return ok();
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => { el.dataset.loaded = '1'; ok(); };
    el.onerror = () => ko(new Error('Kitabxana yüklənmədi, interneti yoxlayın'));
    document.head.appendChild(el);
  });
}

// ================= PDF (çap) görünüşü =================
// A4, iki sütun, səhifədə 4 və ya 6 sual; sonda cavab açarı. "Həllər" rejimi ayrıca sənəd verir.
function printView() {
  if (!pendingPrint || !pendingPrint.questions?.length) { go('#/bank'); return; }
  const { questions, back } = pendingPrint;
  const turkish = questions.every((q) => q.exam === 'tryos');
  const L = turkish
    ? { key: 'Cevap Anahtarı', sol: 'Çözümler', answer: 'Cevap' }
    : { key: 'Cavab açarı', sol: 'Həllər', answer: 'Cavab' };
  let opts = { perPage: 4, mode: 'questions', title: pendingPrint.title || '' };
  try { opts.perPage = +(localStorage.getItem('mp_per_page') || 4) || 4; } catch (_) { /* yaddaş yoxdur */ }

  const letter = (q) => 'ABCDE'[(q.options || []).indexOf(q.answer)] || '—';

  const pq = (q, n) => `<div class="pq">
      <div class="pq-num">${n}.</div>
      <div class="pq-body">
        <div class="pq-text">${esc(q.body)}</div>
        ${q.figure ? `<div class="pq-fig">${safeSvg(q.figure)}</div>` : ''}
        ${q.qtype === 'mcq' && q.options?.length
          ? (hasOptionFigures(q)
            ? `<div class="pq-figopts">${q.options.map((o, i) => `<div><b>${'ABCDE'[i]})</b>${safeSvg(q.option_figures[i])}</div>`).join('')}</div>`
            : `<ol class="pq-opts">${q.options.map((o, i) => `<li><b>${'ABCDE'[i]})</b> ${esc(o)}</li>`).join('')}</ol>`)
          : ''}
      </div>
    </div>`;

  const header = (page, total) => `${opts.title ? `<div class="sheet-head">${esc(opts.title)}</div>` : ''}<div class="sheet-foot">${page} / ${total}</div>`;

  const render = () => {
    const per = opts.perPage;
    const rows = per / 2;
    let sheets = '';
    if (opts.mode === 'questions') {
      const pages = Math.ceil(questions.length / per);
      const total = pages + 1;
      for (let p = 0; p < pages; p++) {
        const chunk = questions.slice(p * per, p * per + per);
        sheets += `<section class="sheet">${header(p + 1, total)}
          <div class="sheet-grid" style="grid-template-rows:repeat(${rows}, minmax(0, 1fr))">${chunk.map((q, i) => pq(q, p * per + i + 1)).join('')}</div></section>`;
      }
      sheets += `<section class="sheet">${header(total, total)}<div class="sheet-key"><h2>${L.key}</h2>
        <div class="key-grid">${questions.map((q, i) => `<div><span>${i + 1}.</span> <b>${q.qtype === 'mcq' ? letter(q) : esc(q.answer)}</b></div>`).join('')}</div></div></section>`;
    } else {
      sheets = `<section class="sheet sheet-flow">${opts.title ? `<div class="sheet-head">${esc(opts.title)} · ${L.sol}</div>` : `<div class="sheet-head">${L.sol}</div>`}
        <div class="flow-cols">${questions.map((q, i) => `<div class="sol-item"><div class="sol-h">${i + 1}. <span>${L.answer}: <b>${q.qtype === 'mcq' ? letter(q) : esc(q.answer)}</b></span></div>
          <div class="sol-t">${esc(q.solution || '—')}</div></div>`).join('')}</div></section>`;
    }

    $app.innerHTML = `<div class="print-root">
      <div class="print-toolbar">
        <a class="btn" href="${back || '#/bank'}">‹ Geri</a>
        <label class="row small" style="gap:6px">Başlıq <input type="text" id="pTitle" value="${esc(opts.title)}" placeholder="istəyə bağlı" style="width:200px;min-height:40px"></label>
        <label class="row small" style="gap:6px">Səhifədə <select id="pPer" style="width:auto;min-height:40px"><option ${opts.perPage === 4 ? 'selected' : ''}>4</option><option ${opts.perPage === 6 ? 'selected' : ''}>6</option></select> sual</label>
        <div class="pills" style="grid-template-columns:repeat(2, auto);gap:6px" role="radiogroup" aria-label="Sənəd">
          <button type="button" class="pill-opt" style="min-height:40px;padding:6px 12px" role="radio" aria-checked="${opts.mode === 'questions'}" data-pm="questions"><strong>Suallar + açar</strong></button>
          <button type="button" class="pill-opt" style="min-height:40px;padding:6px 12px" role="radio" aria-checked="${opts.mode === 'solutions'}" data-pm="solutions"><strong>${L.sol}</strong></button>
        </div>
        <button class="btn primary" id="pDownload">PDF faylı yüklə</button>
        <button class="btn" id="pPrint">Çap et</button>
        <span class="muted small">${questions.length} sual</span>
      </div>
      <p class="print-hint muted small"><b>PDF faylı yüklə</b> təmiz A4 fayl hazırlayır (ünvan və tarix yazılmır). iPad-də fayl açılanda Paylaş → <b>Fayllara saxla</b>.</p>
      <div class="sheets">${sheets}</div>
    </div>`;

    $('#pTitle').onchange = (e) => { opts.title = e.target.value.trim(); render(); };
    $('#pPer').onchange = (e) => { opts.perPage = +e.target.value; try { localStorage.setItem('mp_per_page', String(opts.perPage)); } catch (_) { /* boş */ } render(); };
    $$('[data-pm]').forEach((b) => b.onclick = () => { opts.mode = b.dataset.pm; render(); });
    $('#pPrint').onclick = () => { fitAll(); setTimeout(() => window.print(), 50); };
    $('#pDownload').onclick = (e) => busy(e.currentTarget, downloadPdf).catch(fail);
    setTimeout(fitAll, 300);
    setTimeout(fitAll, 1200);
  };

  // Hər A4 vərəqi şəkil kimi çəkilir və PDF faylına yığılır (brauzerin çap başlıqları olmadan)
  async function downloadPdf() {
    fitAll();
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
    if (document.fonts?.ready) await document.fonts.ready;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const sheets = $$('.sheet');
    document.body.classList.add('capturing');
    try {
      let first = true;
      for (const sheet of sheets) {
        const canvas = await window.html2canvas(sheet, { scale: 2.5, backgroundColor: '#ffffff', logging: false });
        const pageH = Math.round(canvas.width * 297 / 210);
        for (let y = 0; y < canvas.height - 4; y += pageH) {
          const part = document.createElement('canvas');
          part.width = canvas.width; part.height = Math.min(pageH, canvas.height - y);
          const ctx = part.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height);
          ctx.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
          if (!first) pdf.addPage();
          first = false;
          pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, part.height * 210 / canvas.width);
        }
      }
    } finally {
      document.body.classList.remove('capturing');
    }
    const name = (opts.title || (turkish ? 'tr-yos' : 'suallar')).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'suallar';
    pdf.save(`${name}${opts.mode === 'solutions' ? '-cozumler' : ''}.pdf`);
    toast('PDF hazırdır');
  }

  // Sual xanaya sığmırsa, şrifti və şəkli tədricən kiçildir
  function fitAll() {
    $$('.pq').forEach((box) => {
      let size = 11;
      box.style.fontSize = size + 'pt';
      box.style.setProperty('--fig-max', '62mm');
      let fig = 62;
      let guard = 0;
      while (box.scrollHeight > box.clientHeight + 1 && guard++ < 30) {
        if (fig > 34) { fig -= 4; box.style.setProperty('--fig-max', fig + 'mm'); continue; }
        if (size <= 7.5) break;
        size -= 0.5;
        box.style.fontSize = size + 'pt';
      }
      box.classList.toggle('overflow', box.scrollHeight > box.clientHeight + 1);
    });
  }
  window.addEventListener('beforeprint', fitAll, { once: true });

  render();
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


// Tələbənin material və ya test sualı haqqında müəllimə qeydi.
function askStudentTeacher(code, context) {
  openDialog('Müəllimə sual', `<p>${esc(context.title || '')}</p><form id="studentAsk" class="stack"><label class="field">Nəyi başa düşmədin?<textarea name="body" maxlength="2000" rows="4" required></textarea></label><p class="small muted">Müəllimin cavabı Dərslərim → Müəllimlə suallarım bölməsində görünəcək.</p><button type="submit" class="btn primary">Göndər</button><p class="notice" id="askError" hidden></p></form>`);
  $('#studentAsk').onsubmit = e => { e.preventDefault(); const form = e.currentTarget;
    busy($('button[type=submit]', form), async () => {
      const { error } = await sb.rpc('student_ask', {p_code:code, p_body:new FormData(form).get('body').trim(), p_test_id:context.test_id || null, p_question_id:context.question_id || null, p_note_id:context.note_id || null});
      if (error) { const el = $('#askError'); el.hidden=false; el.textContent=/function|schema cache/i.test(error.message) ? 'Bu imkan üçün müəllim bazanı yeniləməlidir (019_student_hub.sql).' : error.message; return; }
      $('#rvDialog').close(); toast('Sual müəllimə göndərildi');
    }).catch(fail);
  };
}

async function teacherStudentHub(st) {
  const box = document.createElement('section'); box.className='card stack teacher-hub'; view().appendChild(box);
  const [messages, progress, notes] = await Promise.all([
    sb.from('student_questions').select('*').eq('student_id',st.id).order('created_at',{ascending:false}),
    sb.from('material_progress').select('*').eq('student_id',st.id),
    sb.from('lesson_notes').select('*')
  ]);
  if (messages.error || progress.error) { box.innerHTML='<h2>Materiallar və tələbənin sualları</h2><p class="notice">Bu imkan üçün Supabase-də 019_student_hub.sql yeniləməsini işə salın.</p>'; return; }
  const relevant=(notes.data||[]).filter(n=>n.student_id===st.id || (!n.student_id && n.class_id===st.class_id));
  const done=new Set((progress.data||[]).filter(p=>p.completed).map(p=>p.note_id));
  const rows=messages.data||[];
  box.innerHTML=`<h2>Materiallar və tələbənin sualları</h2><p>${relevant.filter(n=>done.has(n.id)).length} / ${relevant.length} material tamamlanıb <span class="small muted">(tələbənin öz qeydi)</span></p>
    ${relevant.map(n=>`<div class="row between"><span>${esc(n.title)}</span><span class="tag ${done.has(n.id)?'ai':''}">${done.has(n.id)?'✓ Tamamlayıb':'Gözləyir'}</span></div>`).join('')}
    <h3>Suallar (${rows.filter(m=>!m.reply).length} cavabsız)</h3>${rows.length?rows.map(m=>`<details class="hub-message" ${m.reply?'':'open'}><summary>${esc(m.body.slice(0,85))} <span class="tag">${m.reply?'Cavablanıb':'Cavab gözləyir'}</span></summary>
    ${m.test_id?`<a href="#/test/${esc(m.test_id)}">Testə bax</a>`:`<p class="small">${esc(relevant.find(n=>n.id===m.note_id)?.title||'Material')}</p>`}<p>${esc(m.body)}</p><div data-question-context="${esc(m.id)}"></div><form data-reply="${esc(m.id)}" class="stack"><label class="field">Cavabınız<textarea name="reply" maxlength="4000" rows="3" required>${esc(m.reply||'')}</textarea></label><button class="btn primary" type="submit">Cavabı saxla</button><span role="status" class="small"></span></form></details>`).join(''):'<p class="muted">Hələ sual göndərilməyib.</p>'}`;
  const ids=[...new Set(rows.map(m=>m.question_id).filter(Boolean))];
  if (ids.length) { const {data:qs}=await sb.from('questions').select('*').in('id',ids); rows.forEach(m=>{const q=(qs||[]).find(q=>q.id===m.question_id);const el=box.querySelector(`[data-question-context="${CSS.escape(m.id)}"]`);if(q&&el)el.innerHTML=questionHtml(q);}); }
  $$('[data-reply]',box).forEach(form=>form.onsubmit=e=>{e.preventDefault();busy($('button',form),async()=>{
    const reply=new FormData(form).get('reply').trim(); if(!reply)throw new Error('Cavab yazın');
    const {data,error}=await sb.from('student_questions').update({reply,replied_at:new Date().toISOString()}).eq('id',form.dataset.reply).select('id');
    if(error)throw error; if(!data?.length)throw new Error('Cavab saxlanılmadı');
    $('span[role=status]',form).textContent='✓ Tələbəyə göndərildi';toast('Cavab saxlanıldı');
  }).catch(fail);});
}
