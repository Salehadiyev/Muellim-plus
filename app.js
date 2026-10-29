// Müəllim+ · əsas tətbiq (heç bir quraşdırma tələb etmir)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $app = document.getElementById('app');
let sb = null;
let session = null;
let aiModels = []; // /api/config-dan: hansı modellər qoşulub
let pendingTestIds = []; // sual bankından testə keçəndə seçilən suallar
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
  if (!r.ok) throw new Error(data.error || 'AI xətası');
  return data;
}

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

async function boot() {
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
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !wasIn)) route();
  });
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [page, id] = parts;
  if (page === 't' && id) return studentTest(id);
  if (page === 's') return studentPortal(id, parts[2]);
  if (!session) return loginView();
  if (page === 'print') return printView();

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
    ['', 'Panel'], ['classes', 'Siniflər'], ['bank', 'Sual bankı'], ['ai', 'TR-YÖS / AI'],
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
    <section class="card stack" id="usageCard"><div class="row"><span class="spinner sm" aria-hidden="true"></span><span class="muted small">AI sayğacı yüklənir…</span></div></section>
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
  renderUsage().catch(fail);
}

// ================= Siniflər =================

async function classesView() {
  const { data, error } = await sb.from('classes').select('id, name, grade, created_at, students(count)').order('created_at');
  if (error) throw error;
  view().innerHTML = `
    <div class="page-head"><div><h1>Siniflər</h1><p class="muted">Hər sinfə şagird siyahısı əlavə edin. Hər şagird testləri və nəticələrini görmək üçün öz linkini alır.</p></div></div>
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

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ABC[b % 31]).join('');

async function classView(id) {
  const [{ data: cls, error }, { data: students }, { data: tests }] = await Promise.all([
    sb.from('classes').select('*').eq('id', id).single(),
    sb.from('students').select('*').eq('class_id', id).order('full_name'),
    sb.from('tests').select('id, title, is_open, created_at').eq('class_id', id).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  const hasCodes = students.length > 0 && students.every((s) => s.access_code);
  const needsSql = students.length > 0 && !hasCodes;
  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/classes">Siniflər</a> /</div><h1>${esc(cls.name)}</h1></div>
      <button class="btn danger" id="delClass">Sinfi sil</button></div>
    <div class="split">
      <section class="card stack"><div class="row between"><h2>Şagirdlər (${students.length})</h2>
          ${hasCodes ? '<button class="btn small" id="allLinks">Bütün linkləri kopyala</button>' : ''}</div>
        ${needsSql ? '<p class="notice">Şəxsi linklər üçün bazanı yeniləyin: Supabase → SQL Editor → <strong>005_student_links.sql</strong> → Run.</p>'
          : hasCodes ? '<p class="muted small">Hər şagirdin öz linki var. Linklə o, sinfin açıq testlərini yazır və öz nəticələrini görür. Linki yalnız həmin şagirdə göndərin.</p>' : ''}
        ${students.length ? `<div class="table-wrap"><table><tbody>${students.map((s) => `<tr>
            <td>${esc(s.full_name)}${s.access_code ? `<div class="small muted mono">${esc(s.access_code)}</div>` : ''}</td>
            <td style="text-align:right;white-space:nowrap">
              ${s.access_code ? `<a class="btn small" href="${esc(studentLink(s.access_code))}" target="_blank" rel="noopener">Bax</a>
              <button class="btn small primary" data-share="${s.id}">Linki göndər</button>
              <button class="btn small" data-recode="${s.id}" title="Köhnə link işləməyəcək">Yeni link</button>` : ''}
              <button class="btn small danger" data-del="${s.id}" aria-label="${esc(s.full_name)} sil">Sil</button></td></tr>`).join('')}</tbody></table></div>`
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
  const byId = Object.fromEntries(students.map((s) => [s.id, s]));
  const msgFor = (s) => `${s.full_name}, bu sənin şəxsi Müəllim+ linkindir. Testləri buradan yaz, nəticələrini də burada görəcəksən:\n${studentLink(s.access_code)}`;
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
      toast(names.length + ' şagird əlavə olundu');
      route();
    }).catch(fail);
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm(`${byId[b.dataset.del].full_name} silinsin? Onun göndərdiyi nəticələr qalacaq.`)) return;
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
  let filter = { text: '', source: '', difficulty: '', exam: '', status: '' };
  let visible = [];
  const selected = new Set();

  view().innerHTML = `
    <div class="page-head"><div><h1>Sual bankı</h1><p class="muted">${data.length} sual. Seçib test yarada bilərsiniz.</p></div>
      <div class="row"><button class="btn" id="toggleManual">+ Əl ilə sual</button><button class="btn" id="selAll">Görünənləri seç</button><button class="btn" id="makePdf" disabled>PDF (0)</button><button class="btn primary" id="makeTest" disabled>Seçilənlərdən test (0)</button></div></div>
    <form class="card stack" id="manual" hidden></form>
    <div class="card stack">
      <div class="form-grid">
        <label class="field">Axtar<input type="search" id="fText" placeholder="mətn və ya mövzu"></label>
        <label class="field">Mənbə<select id="fSource"><option value="">Hamısı</option><option value="ai">AI</option><option value="book">Kitabdan</option><option value="manual">Əl ilə</option></select></label>
        <label class="field">Çətinlik<select id="fDiff"><option value="">Hamısı</option>${DIFF.map((d) => `<option>${d}</option>`).join('')}</select></label>
        <label class="field">Format<select id="fExam"><option value="">Hamısı</option><option value="tryos">TR-YÖS</option><option value="general">Ümumi</option></select></label>
        <label class="field">Status<select id="fStatus"><option value="">Hamısı</option><option value="approved">Müəllim təsdiqləyib</option><option value="passed">AI keçib, təsdiq gözləyir</option><option value="review">Yoxlama tələb edir / qaralama</option></select></label>
      </div>
      <div id="list"></div>
    </div>`;

  const renderList = () => {
    const t = filter.text.toLocaleLowerCase('az');
    const rows = data.filter((q) => (!filter.source || q.source === filter.source) && (!filter.difficulty || q.difficulty === filter.difficulty)
      && (!filter.exam || (q.exam || 'general') === filter.exam)
      && (!filter.status || (filter.status === 'approved' ? q.teacher_approved : filter.status === 'passed' ? (!q.teacher_approved && (q.ai_status === 'passed' || (!q.ai_status && q.verified === true))) : (!q.teacher_approved && (q.ai_status === 'review' || q.ai_status === 'draft' || (!q.ai_status && q.verified === false)))))
      && (!t || (q.body + ' ' + (q.topic || '') + ' ' + (q.subtype || '')).toLocaleLowerCase('az').includes(t)));
    visible = rows;
    $('#list').innerHTML = rows.length
      ? rows.map((q) => questionHtml(q, { selectable: true, checked: selected.has(q.id), actions: `<button class="btn small" data-approve="${q.id}">${q.teacher_approved ? 'Təsdiqi götür' : '✔ Təsdiqlə'}</button><button class="btn small danger" data-del="${q.id}">Sil</button>` })).join('')
      : `<div class="empty">${data.length ? 'Uyğun sual tapılmadı.' : 'Bank boşdur. <a href="#/ai">AI ilə</a> və ya <a href="#/book">kitabdan</a> sual əlavə edin.'}</div>`;
    $$('#list .check').forEach((c) => c.onchange = () => { c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id); updateBtn(); });
    $$('#list [data-approve]').forEach((b) => b.onclick = async () => {
      const q = data.find((x) => x.id === b.dataset.approve);
      const { error: err } = await sb.from('questions').update({ teacher_approved: !q.teacher_approved }).eq('id', q.id);
      if (err) return fail(/column|schema cache/i.test(err.message || '') ? new Error('Baza yenilənməyib: supabase/004_status.sql faylını işə salın.') : err);
      q.teacher_approved = !q.teacher_approved;
      renderList();
    });
    $$('#list [data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Sual silinsin?')) return;
      const { error: err } = await sb.from('questions').delete().eq('id', b.dataset.del);
      if (err) return fail(err);
      data.splice(data.findIndex((q) => q.id === b.dataset.del), 1);
      selected.delete(b.dataset.del);
      updateBtn(); renderList();
    });
  };
  const updateBtn = () => {
    const b = $('#makeTest'); b.disabled = !selected.size; b.textContent = `Seçilənlərdən test (${selected.size})`;
    const pdf = $('#makePdf'); pdf.disabled = !selected.size; pdf.textContent = `PDF (${selected.size})`;
  };

  $('#fText').oninput = (e) => { filter.text = e.target.value; renderList(); };
  $('#fSource').onchange = (e) => { filter.source = e.target.value; renderList(); };
  $('#fDiff').onchange = (e) => { filter.difficulty = e.target.value; renderList(); };
  $('#makeTest').onclick = () => { pendingTestIds = [...selected]; go('#/tests'); };
  $('#fExam').onchange = (e) => { filter.exam = e.target.value; renderList(); };
  $('#fStatus').onchange = (e) => { filter.status = e.target.value; renderList(); };
  $('#selAll').onclick = () => { visible.forEach((q) => selected.add(q.id)); updateBtn(); renderList(); };
  $('#makePdf').onclick = () => {
    // Bankdakı sıra ilə (ən yenisi yuxarıda) yox, seçilmə sırası ilə də ola bilər; burada görünən sıra saxlanılır
    const qs = data.filter((q) => selected.has(q.id)).reverse();
    pendingPrint = { questions: qs, title: '', back: '#/bank' };
    go('#/print');
  };
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
    if (q.ai_status && q.ai_status !== 'checking') {
      row.ai_status = q.ai_status === 'passed' ? 'passed' : q.ai_status === 'draft' ? 'draft' : 'review';
      row.verified = row.ai_status === 'passed';
      row.verify_note = q.verify_note || null;
      row.fit_ok = typeof q.fit_ok === 'boolean' ? q.fit_ok : null;
      row.fit_note = q.fit_note || null;
    } else if (typeof q.verified === 'boolean') { row.verified = q.verified; row.verify_note = q.verify_note || null; }
    return row;
  });
  // Toplu yazılışda bütün sətirlər eyni sütunlara malik olmalıdır, çatışmayanlar standart dəyərlə doldurulur
  const DEFAULTS = { exam: 'general', figure: null, option_figures: [], section: null, subtype: null, model: null, verified: null, verify_note: null, ai_status: null, fit_ok: null, fit_note: null };
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  rows.forEach((r) => keys.forEach((k) => { if (!(k in r)) r[k] = k in DEFAULTS ? DEFAULTS[k] : null; }));
  const { error } = await sb.from('questions').insert(rows);
  if (error) {
    if (/column .* does not exist|schema cache/i.test(error.message || '')) {
      throw new Error('Baza yenilənməyib: Supabase SQL Editor-də supabase/004_status.sql faylını işə salın.');
    }
    throw error;
  }
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
    <div class="page-head"><div><h1>TR-YÖS sual yaradıcı</h1><p class="muted">Nümunə sualları seçin, hər birinin yanında yeni sual yaradılsın.</p></div>${modelPicker()}</div>
    <div class="tabs" role="tablist" aria-label="Rejim">
      <button type="button" role="tab" data-tab="examples">Nümunədən yarat</button>
      <button type="button" role="tab" data-tab="topic">Mövzudan yarat</button>
      <button type="button" role="tab" data-tab="general">Məktəb (ümumi)</button>
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
    if (figs.length !== 5) problems.push(`variant şəkilləri natamamdır (${figs.length}/5)`);
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
  // Kompozit: yuxarıda əsas şəkil, altında A–E variantları (şagirdin gördüyü kimi)
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
  bindMini(box, (key) => { for (const g of groups) { const q = g.questions.find((x) => String(x._uid) === key); if (q) return { q, sample: g.sample }; } return {}; });
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
  const ver = st ? `<span class="tag ${st[0]}" title="${esc(st[2])}">${esc(st[1])}</span>` : '';
  return `<div class="mini-q">
    <input type="checkbox" class="check" data-id="${esc(key)}" ${checked ? 'checked' : ''} aria-label="Sualı seç">
    <button type="button" class="mini-open" data-open="${esc(key)}">
      <span class="mini-text">${esc(q.body)}</span>
      <span class="mini-meta">${q.figure || hasOptionFigures(q) ? '<span class="tag">şəkil</span>' : ''}<span class="tag">${esc(q.difficulty || '')}</span><span class="tag ai">Cavab: ${letter}</span>${ver}</span>
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
    dlg.innerHTML = `<div class="q-dialog-in">
      <div class="row between"><h2>Sual</h2><button type="button" class="btn small" data-close aria-label="Bağla">✕ Bağla</button></div>
      <div class="${sample ? 'dlg-pair' : ''}">
        ${sample ? `<div class="dlg-src"><div class="muted small">Nümunə</div>${sample.image ? `<img src="${sample.image}" alt="Nümunə">` : `<div class="small pre">${esc(sample.text)}</div>`}</div>` : ''}
        <div>${sample ? '<div class="muted small">Yeni sual</div>' : ''}${questionHtml(sample || !q.source ? { ...q, source: 'ai' } : q)}</div>
      </div></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
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
    <div class="page-head"><div><h1>Testlər</h1><p class="muted">Test yaradın. Sinfə bağlı test şagirdlərin şəxsi linkində avtomatik görünür. Ümumi linki də göndərmək olar.</p></div></div>
    <form class="card stack" id="newTest"><h2>Yeni test</h2>
      <div class="form-grid">
        <label class="field">Testin adı<input type="text" name="title" required maxlength="120" placeholder="məs. Tənliklər · qısa yoxlama"></label>
        <label class="field">Sinif<select name="class_id"><option value="">Sinifsiz (şagird adını özü yazır)</option>${(classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="row between"><strong>Suallar · <span id="selCount">${preset.size}</span> seçilib · bankda ${(questions || []).length}</strong>${questions?.length ? '' : '<a href="#/ai">Əvvəlcə sual yaradın</a>'}</div>
      ${questions?.length ? `<div class="row"><input type="search" id="tqFind" placeholder="Axtar: mətn və ya mövzu" style="flex:1;min-width:180px">
        <button type="button" class="btn small" id="tqAll">Görünənləri seç</button><button type="button" class="btn small" id="tqNone">Seçimi sil</button></div>
        <p class="muted small">Suala basanda tam halı açılır.</p>` : ''}
      <div class="mini-grid" id="tqList">
        ${(questions || []).map((q) => `<div class="mini" data-find="${esc(((q.body || '') + ' ' + (q.topic || '') + ' ' + (q.subtype || '')).toLocaleLowerCase('az'))}">${miniQ(q, q.id, preset.has(q.id))}</div>`).join('') || '<div class="empty">Sual bankı boşdur.</div>'}
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
  const countSel = () => { $('#selCount').textContent = $$('.check:checked', form).length; };
  form.addEventListener('change', (e) => { if (e.target.classList.contains('check')) countSel(); });
  const qById = Object.fromEntries((questions || []).map((q) => [q.id, q]));
  bindMini(form, (id) => ({ q: qById[id] }));
  if ($('#tqFind')) {
    $('#tqFind').oninput = (e) => {
      const t = e.target.value.trim().toLocaleLowerCase('az');
      $$('#tqList .mini').forEach((m) => { m.hidden = !!t && !m.dataset.find.includes(t); });
    };
    $('#tqFind').onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
    $('#tqAll').onclick = () => { $$('#tqList .mini:not([hidden]) .check').forEach((c) => { c.checked = true; }); countSel(); };
    $('#tqNone').onclick = () => { $$('#tqList .check').forEach((c) => { c.checked = false; }); countSel(); };
  }
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
  const [{ data: qs }, { data: roster }] = await Promise.all([
    sb.from('questions').select('*').in('id', test.question_ids.length ? test.question_ids : ['00000000-0000-0000-0000-000000000000']),
    test.class_id ? sb.from('students').select('id, full_name, access_code').eq('class_id', test.class_id).order('full_name') : Promise.resolve({ data: [] })
  ]);
  const sentIds = new Set(subs.map((s) => s.student_id).filter(Boolean));
  const sentNames = new Set(subs.map((s) => s.student_name.trim().toLocaleLowerCase('az')));
  const notSent = (roster || []).filter((st) => !sentIds.has(st.id) && !sentNames.has(st.full_name.trim().toLocaleLowerCase('az')));
  const questions = test.question_ids.map((qid) => (qs || []).find((q) => q.id === qid)).filter(Boolean);
  const avg = subs.length ? Math.round(subs.reduce((a, s) => a + (s.total ? s.score / s.total : 0), 0) / subs.length * 100) : null;
  const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('az');
  const link = location.origin + location.pathname + '#/t/' + id;

  view().innerHTML = `
    <div class="page-head"><div><div class="crumb"><a href="#/tests">Testlər</a> /</div><h1>${esc(test.title)}</h1>
      <p class="muted">${esc(test.classes?.name || 'Sinifsiz')} · ${questions.length} sual · ${test.is_open ? 'açıq' : 'bağlı'}</p></div>
      <div class="row"><button class="btn primary" id="copy">Linki kopyala</button><button class="btn" id="pdf">PDF</button><button class="btn danger" id="del">Testi sil</button></div></div>
    <section class="grid">
      <div class="card stat"><div class="label">Göndərilən iş</div><div class="value">${subs.length}</div></div>
      <div class="card stat"><div class="label">Orta nəticə</div><div class="value">${avg === null ? '—' : avg + '%'}</div></div>
    </section>
    ${notSent.length ? `<section class="card stack"><div class="row between"><h2>Hələ göndərməyənlər (${notSent.length})</h2>
        ${notSent.every((st) => st.access_code) && test.is_open ? '<button class="btn small" id="remind">Xatırlatma mətnini kopyala</button>' : ''}</div>
      <div class="missing-list">${notSent.map((st) => `<span class="tag">${esc(st.full_name)}</span>`).join('')}</div></section>` : ''}
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

// ================= Şagird test səhifəsi =================

const studentQuestionsHtml = (test) => test.questions.map((q, i) => `<fieldset class="card stack" style="margin:0">
      <legend class="sr">Sual ${i + 1}</legend>
      <div class="muted small">Sual ${i + 1} / ${test.questions.length}</div>
      <div class="q-text pre" style="font-size:17px">${esc(q.body)}</div>
      ${q.figure ? `<div class="q-fig">${safeSvg(q.figure)}</div>` : ''}
      ${q.qtype === 'mcq'
        ? `<div class="${hasOptionFigures(q) ? 'fig-choices' : 'stack'}" style="gap:8px">${q.options.map((o, j) => `<label class="opt-choice"><input type="radio" name="q_${q.id}" value="${esc(o)}"><span>${'ABCDEF'[j]})</span>${hasOptionFigures(q) ? `<span class="opt-fig">${safeSvg(q.option_figures[j])}</span>` : `<span>${esc(o)}</span>`}</label>`).join('')}</div>`
        : `<label class="field"><span class="sr">Cavabınız</span><textarea name="q_${q.id}" rows="3" placeholder="Cavabınızı yazın"></textarea></label>`}
    </fieldset>`).join('');

// Cavabları toplayır; boş sual varsa təsdiq istəyir (imtina edilsə null)
function collectAnswers(form, test) {
  const f = new FormData(form);
  const answers = {};
  test.questions.forEach((q) => { const v = f.get('q_' + q.id); if (v !== null && String(v).trim() !== '') answers[q.id] = String(v); });
  const missing = test.questions.length - Object.keys(answers).length;
  if (missing && !confirm(missing + ' suala cavab verilməyib. Yenə də göndərilsin?')) return null;
  return answers;
}

const studentMsg = (title, text, extra = '') => {
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack"><h1>${title}</h1><p class="muted">${text}</p>${extra}</div></div>`;
};

async function studentTest(id) {
  $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
  const { data: test, error } = await sb.rpc('get_test_for_student', { p_test_id: id });
  if (error || !test) return studentMsg('Test açılmadı', 'Test tapılmadı və ya müəllim onu bağlayıb.');
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
    ${studentQuestionsHtml(test)}
    <button class="btn primary block" type="submit" style="min-height:52px;font-size:16px">Cavabları göndər</button>
  </form>`;

  $('#st').onsubmit = (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (!name) return toast('Adınızı seçin', true);
    const answers = collectAnswers(e.target, test);
    if (!answers) return;
    busy($('button[type=submit]', e.target), async () => {
      const { data, error: err } = await sb.rpc('submit_test', { p_test_id: id, p_student_name: name, p_answers: answers });
      if (err) throw new Error(err.message);
      const result = { ...data, name };
      try { localStorage.setItem(doneKey, JSON.stringify(result)); } catch (_) { /* yaddaş bağlıdır */ }
      studentDone(test, result);
    }).catch(fail);
  };
}

function studentDone(test, r, back = '') {
  const hasOpen = (test.questions || []).some((q) => q.qtype === 'open');
  $app.innerHTML = `<div class="center-screen"><div class="card auth-card stack" style="text-align:center">
    <h1>${esc(test.title)}</h1>
    <p class="muted">${esc(r.name)}, cavablarınız göndərildi.</p>
    ${r.total ? `<div class="score-big">${r.score}/${r.total}</div><p class="muted">çoxseçimli suallardan düz cavab</p>` : ''}
    ${hasOpen ? '<p class="notice">Açıq sualları müəlliminiz yoxlayacaq.</p>' : ''}
    ${back ? `<a class="btn primary block" href="${back}">Testlərimə qayıt</a>` : ''}
  </div></div>`;
}

// ================= Şagird kabineti (şəxsi link: #/s/KOD) =================

const CODE_KEY = 'mp_student_code';
const pct = (r) => (r.total ? Math.round(r.score / r.total * 100) : 0);

function studentCodeForm(note = '') {
  $app.innerHTML = `<div class="center-screen"><form class="card auth-card stack" id="codeForm">
    <div class="row"><span class="brand-mark" style="color:#fff">M+</span><span class="muted">Müəllim+</span></div>
    <h1>Şagird girişi</h1>
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

async function studentPortal(rawCode, testId) {
  let code = String(rawCode || '').trim().toUpperCase();
  if (!code) {
    try { code = localStorage.getItem(CODE_KEY) || ''; } catch (_) { code = ''; }
    if (code) return go('#/s/' + code);
    return studentCodeForm();
  }
  $app.innerHTML = '<div class="center-screen"><div class="spinner" aria-label="Yüklənir"></div></div>';
  window.scrollTo(0, 0);
  const home = '#/s/' + code;

  if (testId) {
    const { data: test, error } = await sb.rpc('student_get_test', { p_code: code, p_test_id: testId });
    if (error || !test) return studentMsg('Test açılmadı', 'Test tapılmadı.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    if (test.result) return studentDone(test, { ...test.result, name: test.name }, home);
    if (test.closed) return studentMsg(esc(test.title), 'Müəllim bu testi bağlayıb.', `<a class="btn block" href="${home}">Testlərimə qayıt</a>`);
    $app.innerHTML = `<form class="student" id="st">
      <div class="row between"><a class="muted" href="${home}">‹ Testlərim</a><span class="muted">${esc(test.name)}</span></div>
      <h1>${esc(test.title)}</h1>
      ${studentQuestionsHtml(test)}
      <button class="btn primary block" type="submit" style="min-height:52px;font-size:16px">Cavabları göndər</button>
    </form>`;
    $('#st').onsubmit = (e) => {
      e.preventDefault();
      const answers = collectAnswers(e.target, test);
      if (!answers) return;
      busy($('button[type=submit]', e.target), async () => {
        const { data, error: err } = await sb.rpc('student_submit_test', { p_code: code, p_test_id: testId, p_answers: answers });
        if (err) throw new Error(err.message);
        studentDone(test, { ...data, name: test.name }, home);
      }).catch(fail);
    };
    return;
  }

  const { data: me, error } = await sb.rpc('student_portal', { p_code: code });
  if (error || !me) {
    try { if (localStorage.getItem(CODE_KEY) === code) localStorage.removeItem(CODE_KEY); } catch (_) { /* */ }
    return studentCodeForm(error ? 'Hazırda açmaq olmadı, bir az sonra yenidən yoxlayın.' : 'Bu link və ya kod etibarsızdır. Müəlliminizdən yeni link istəyin.');
  }
  try { localStorage.setItem(CODE_KEY, code); } catch (_) { /* */ }
  const todo = me.tests.filter((t) => !t.result && t.is_open);
  const done = me.tests.filter((t) => t.result);
  const avg = done.length ? Math.round(done.reduce((a, t) => a + pct(t.result), 0) / done.length) : null;
  $app.innerHTML = `<div class="student">
    <div class="row"><span class="brand-mark" style="color:#fff">M+</span><span class="muted">Müəllim+</span></div>
    <div><h1>Salam, ${esc(me.name)}</h1><p class="muted">${esc(me.class || '')}</p></div>
    <section class="card stack"><h2>Yazılacaq testlər${todo.length ? ` (${todo.length})` : ''}</h2>
      ${todo.length ? todo.map((t) => `<a class="portal-row" href="${home}/${t.id}">
          <span><strong>${esc(t.title)}</strong><span class="small muted"> · ${t.count} sual</span></span><span class="btn small primary">Başla</span></a>`).join('')
        : '<div class="empty">Hazırda yazılacaq test yoxdur.</div>'}
    </section>
    <section class="card stack"><div class="row between"><h2>Nəticələrim</h2>${avg === null ? '' : `<span class="tag ai">orta ${avg}%</span>`}</div>
      ${done.length ? done.map((t) => `<div class="portal-row">
          <span><strong>${esc(t.title)}</strong><span class="small muted"> · ${fmtDate(t.result.created_at)}</span></span>
          <span class="row" style="flex-wrap:nowrap;gap:8px"><span class="bar" style="width:70px"><i style="width:${pct(t.result)}%"></i></span><strong>${t.result.score}/${t.result.total}</strong></span></div>`).join('')
        : '<div class="empty">Hələ test yazmamısınız.</div>'}
    </section>
  </div>`;
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
