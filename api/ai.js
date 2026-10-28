// Müəllim+ · AI funksiyası (Vercel serverless)
// Lazım olan mühit dəyişənləri (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   — Claude API açarı
//   SUPABASE_URL        — Supabase layihə ünvanı
//   SUPABASE_ANON_KEY   — Supabase "anon public" açarı
//   ANTHROPIC_MODEL     — (istəyə bağlı) model adı

import { TRYOS_SYSTEM, TRYOS_QUESTION_SHAPE, TRYOS_TOPICS } from './_tryos.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

const SYSTEM = `Sən Azərbaycanda orta məktəb riyaziyyat müəllimlərinə kömək edən təcrübəli metodistsən.
Qaydalar:
- Bütün mətni Azərbaycan dilində (latın əlifbası) yaz. Ad, şəhər, əşya və pul vahidi (manat) yerli olsun.
- Bütün riyazi ifadələri LaTeX ilə dollar işarələri arasında yaz: $\\sqrt{49}$, $\\frac{2}{3}$, $x^2$, $\\sqrt[3]{8}$, $2 \\cdot 3$. Sualdakı əsas böyük ifadəni ayrıca sətirdə $$...$$ arasında ver.
- Variantlar da LaTeX ilə olsun (məs. "$\\frac{1}{3}$", "$5$"). Sözlə olan variantı adi mətnlə yaz.
- JSON daxilində hər tərs xətti ikiqat yaz: "\\\\frac", "\\\\sqrt".
- Hər sualı əvvəlcə özün addım-addım həll et, cavabı yoxla, sonra sualı yaz. Rəqəmləri elə seç ki, cavab səliqəli alınsın.
- Çoxseçimli sualda DİM formatında düz 5 variant (A–E) olsun, yalnız biri doğru olsun; yanlış variantlar şagirdlərin tipik səhvlərindən gəlsin.
- Yalnız tələb olunan JSON-u qaytar, başqa heç nə yazma.`;

const QUESTION_SHAPE = `{
  "body": "sualın mətni",
  "solution": "qısa, addım-addım həll",
  "answer": "düzgün cavab (qısa)",
  "qtype": "mcq" və ya "open",
  "options": ["A", "B", "C", "D", "E"], // yalnız mcq üçün, açıq sualda []
  "correct_index": 0,                  // yalnız mcq üçün, doğru variantın indeksi (0-4)
  "topic": "mövzu",
  "difficulty": "asan" | "orta" | "çətin"
}`;

const GEN_MODES = {
  izomorf: `İZOMORF rejim: hər yeni sual nümunə ilə eyni quruluşda olsun: eyni ifadə forması, eyni əməliyyatlar ardıcıllığı, eyni həll addımları.
Yalnız rəqəmlər dəyişsin (mətnli məsələdə ad və əşyalar da dəyişə bilər, cümlələri öz sözlərinlə yaz).
Rəqəmləri elə seç ki, ara nəticələr və cavab səliqəli olsun (məs. köklər tam ədəd çıxsın).`,
  benzer: `BƏNZƏR rejim: eyni bacarığı və təxminən eyni çətinliyi yoxlasın, quruluş nümunəyə yaxın qalsın,
amma hekayə/kontekst, adlar və bütün rəqəmlər yeni olsun. Nümunədəki cümlələri köçürmə.`,
  ferqli: `FƏRQLİ QURULUŞ rejimi: eyni riyazi bilik və təxminən eyni çətinlik yoxlanılsın,
amma sualın forması və qurulması fərqli olsun (məs. tərs məsələ, başqa ifadə növü, müqayisə, tənlik qurma, həyati kontekst). Nümunəni təkrarlama.`
};

const LEVELS = {
  yungul: 'Yüngül dəyişiklik: eyni hekayə tipi qalsın, amma bütün adları, əşyaları və BÜTÜN rəqəmləri dəyiş. Cümlələri öz sözlərinlə yenidən yaz.',
  orta: 'Orta dəyişiklik: tamamilə başqa həyati kontekst seç (məsələn, mağaza yerinə bazar, idman, səyahət), rəqəmləri dəyiş, amma həll üsulu və çətinlik eyni qalsın.',
  tam: 'Tam yeni: eyni riyazi bacarığı və çətinliyi yoxlayan, amma hekayəsi, quruluşu və sual forması fərqli olan tamamilə yeni sual yarat.'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnız POST' });
  }
  try {
    const user = await verifyTeacher(req);
    if (!user) return res.status(401).json({ error: 'Əvvəlcə daxil olun' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY qurulmayıb' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action;

    if (action === 'generate') return res.status(200).json(await generate(body));
    if (action === 'extract') return res.status(200).json(await extract(body));
    if (action === 'transform') return res.status(200).json(await transform(body));
    if (action === 'tryos_plan') return res.status(200).json(await tryosPlan(body));
    if (action === 'tryos_generate') return res.status(200).json(await tryosGenerate(body));
    if (action === 'verify') return res.status(200).json(await verify(body));

    return res.status(400).json({ error: 'Naməlum əməliyyat' });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.publicMessage || 'AI xətası. Bir az sonra yenidən yoxlayın.' });
  }
}

// ---------- Əməliyyatlar ----------

async function generate(b) {
  const count = clampInt(b.count, 1, 10, 5);
  const grade = clampInt(b.grade, 1, 12, 7);
  const difficulty = pick(b.difficulty, ['asan', 'orta', 'çətin'], 'orta');
  const qtype = pick(b.qtype, ['mcq', 'open'], 'mcq');
  const topic = String(b.topic || '').slice(0, 200).trim();
  const extra = String(b.notes || '').slice(0, 500).trim();
  const example = String(b.example || '').slice(0, 6000).trim();
  const mode = GEN_MODES[b.mode] ? b.mode : 'benzer';
  if (!topic && !example) throw publicError('Mövzunu yazın və ya nümunə sual əlavə edin');

  const exampleBlock = example ? `
Müəllim aşağıdakı nümunə sual(lar)ı verib. Mövzu verilməyibsə, mövzunu nümunədən özün müəyyən et.
${GEN_MODES[mode]}
Bir neçə nümunə varsa, yeni sualları nümunələr arasında bərabər payla.
Nümunə:
"""
${example}
"""` : '';

  const prompt = `${grade}. sinif üçün ${topic ? `"${topic}" mövzusunda ` : ''}${count} ədəd riyaziyyat sualı yarat.
Çətinlik: ${difficulty}. Sual növü: ${qtype === 'mcq' ? 'çoxseçimli (5 variant, A–E)' : 'açıq sual'}.
${extra ? 'Müəllimin əlavə istəyi: ' + extra : ''}${exampleBlock}
Suallar bir-birini təkrarlamasın.
Cavabı bu formada qaytar: {"questions": [ ${QUESTION_SHAPE} ]}`;

  const data = await askJSON([{ type: 'text', text: prompt }]);
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = list.map(q => normalizeQuestion(q, { grade, difficulty, qtype, topic })).filter(Boolean);
  if (!questions.length) throw publicError('AI sual qaytarmadı, yenidən yoxlayın');
  return { questions };
}

async function extract(b) {
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec(String(b.image || ''));
  if (!m) throw publicError('Şəkil oxunmadı');
  const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];

  const prompt = `Şəkildə dərslikdən kəsilmiş riyaziyyat tapşırığı var.
1) Tapşırığın mətnini olduğu kimi oxu (nömrəsini yazma). Riyazi ifadələri LaTeX ilə $...$ arasında yaz. ${b.all ? 'Şəkildə bir neçə tapşırıq varsa, HAMISINI oxu: hər birini variantları ilə birlikdə ayrı abzasda, boş sətirlə ayıraraq yaz.' : 'Şəkildə bir neçə tapşırıq varsa, ən tam görünəni götür.'}
2) Mövzunu, təxmini sinfi və çətinliyi müəyyən et.
3) Tapşırığı özün həll et və cavabı yaz.
Bu formada qaytar: {"text": "...", "topic": "...", "grade": 7, "difficulty": "asan|orta|çətin", "answer": "..."}
Şəkildə riyazi tapşırıq yoxdursa: {"text": "", "error": "səbəb"}`;

  const data = await askJSON([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[3] } },
    { type: 'text', text: prompt }
  ]);
  if (!data.text) throw publicError(data.error ? 'Sual tapılmadı: ' + data.error : 'Şəkildə sual tapılmadı');
  return {
    text: String(data.text).slice(0, 6000),
    topic: String(data.topic || '').slice(0, 200),
    grade: clampInt(data.grade, 1, 12, 7),
    difficulty: pick(data.difficulty, ['asan', 'orta', 'çətin'], 'orta'),
    answer: String(data.answer || '').slice(0, 300)
  };
}

async function transform(b) {
  const text = String(b.text || '').slice(0, 3000).trim();
  if (!text) throw publicError('Sualın mətni boşdur');
  const level = LEVELS[b.level] ? b.level : 'orta';
  const qtype = pick(b.qtype, ['mcq', 'open'], 'mcq');
  const grade = clampInt(b.grade, 1, 12, 7);
  const difficulty = pick(b.difficulty, ['asan', 'orta', 'çətin'], 'orta');
  const topic = String(b.topic || '').slice(0, 200);

  const prompt = `Aşağıdakı dərslik tapşırığına əsaslanaraq YENİ, ORİJİNAL sual yarat.
${LEVELS[level]}
Vacib: orijinal mətndən heç bir cümləni və ya ifadə ardıcıllığını köçürmə. Yeni sual eyni riyazi bacarığı və təxminən eyni çətinliyi yoxlamalıdır. Cavabı yenidən hesabla və yoxla.
Sual növü: ${qtype === 'mcq' ? 'çoxseçimli (5 variant, A–E)' : 'açıq sual'}. Sinif: ${grade}.

Orijinal tapşırıq:
"""
${text}
"""

Bu formada qaytar: {"question": ${QUESTION_SHAPE}, "changes": ["nə dəyişdi, 3-4 qısa bənd"]}`;

  const data = await askJSON([{ type: 'text', text: prompt }]);
  const question = normalizeQuestion(data.question, { grade, difficulty, qtype, topic });
  if (!question) throw publicError('AI sual qaytarmadı, yenidən yoxlayın');
  const changes = Array.isArray(data.changes) ? data.changes.slice(0, 6).map(c => String(c).slice(0, 160)) : [];
  return { question, changes };
}

// ---------- TR-YÖS ----------

const DIFF_TR = { asan: 'asan', orta: 'orta', cetin: 'çətin', 'çətin': 'çətin', qarisiq: 'qarışıq' };

function tryosContext(b) {
  const section = pick(b.section, ['matematik', 'sayisal', 'deneme'], 'matematik');
  const topic = String(b.topic || '').slice(0, 200).trim();
  const notes = String(b.notes || '').slice(0, 800).trim();
  const example = String(b.example || '').slice(0, 6000).trim();
  const mode = GEN_MODES[b.mode] ? b.mode : 'benzer';
  const difficulty = DIFF_TR[b.difficulty] || 'qarışıq';
  const sectionText = section === 'matematik'
    ? 'Bölmə: Temel Matematik. Mümkün mövzular: ' + TRYOS_TOPICS.matematik.join(', ') + '.'
    : section === 'sayisal'
      ? 'Bölmə: Sayısal Yetenek (məntiq). Mümkün tip ailələri: ' + TRYOS_TOPICS.sayisal.join(', ') + '.'
      : 'Deneme: Temel Matematik və Sayısal Yetenek mövzularını imtahan axınına uyğun qarışdır; eyni tipi ardıcıl təkrarlama. Riyaziyyat: '
        + TRYOS_TOPICS.matematik.join(', ') + '. Sayısal: ' + TRYOS_TOPICS.sayisal.join(', ') + '.';
  const exampleText = example ? `\nMüəllimin nümunə sual(lar)ı:\n"""\n${example}\n"""\n${GEN_MODES[mode]}` : '';
  return { section, topic, notes, example, mode, difficulty, sectionText, exampleText };
}

async function tryosPlan(b) {
  const count = clampInt(b.count, 1, 40, 10);
  const c = tryosContext(b);
  const prompt = `${c.sectionText}
${c.topic ? 'Müəllimin seçdiyi mövzu: ' + c.topic + '.' : ''}
Çətinlik: ${c.difficulty === 'qarışıq' ? 'qarışıq (asan → orta → çətin inkişafı ilə)' : c.difficulty}.
${c.notes ? 'Müəllimin əlavə istəyi: ' + c.notes : ''}${c.exampleText}

${count} sual üçün DAXİLİ TİP PLANI qur. Hər bənd həqiqətən fərqli tip olsun (quruluş, axtarılan kəmiyyət, təqdimat forması, əsas həll ideyası).
Hələ sualları yazma, yalnız plan.
Bu formada qaytar:
{"plan": [{"subtype": "qısa tip adı (türkcə)", "idea": "sualın əsas ideyası, 1 cümlə", "topic": "mövzu (türkcə)", "section": "matematik|sayisal", "difficulty": "asan|orta|çətin", "visual": "yok|grafik|venn|tablo|şema|şekil"}],
 "notes": "mövzu dar olduğu üçün fərqli tip çatışmırsa, bunu Azərbaycan dilində qısa yaz; əks halda boş"}`;
  const data = await askJSON([{ type: 'text', text: prompt }], { system: TRYOS_SYSTEM, maxTokens: 6000 });
  const plan = (Array.isArray(data.plan) ? data.plan : []).slice(0, count).map((p) => ({
    subtype: String(p.subtype || '').slice(0, 120),
    idea: String(p.idea || '').slice(0, 400),
    topic: String(p.topic || c.topic || '').slice(0, 120),
    section: pick(p.section, ['matematik', 'sayisal'], c.section === 'sayisal' ? 'sayisal' : 'matematik'),
    difficulty: pick(p.difficulty, ['asan', 'orta', 'çətin'], 'orta'),
    visual: String(p.visual || 'yok').slice(0, 20)
  }));
  if (!plan.length) throw publicError('AI plan qaytarmadı, yenidən yoxlayın', 502);
  return { plan, notes: String(data.notes || '').slice(0, 600) };
}

async function tryosGenerate(b) {
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 4);
  if (!items.length) throw publicError('Plan boşdur');
  const c = tryosContext(b);
  const avoid = (Array.isArray(b.avoid) ? b.avoid : []).slice(0, 40).map((t) => '- ' + String(t).slice(0, 160)).join('\n');
  const prompt = `${c.sectionText}${c.exampleText}
${c.notes ? 'Müəllimin əlavə istəyi: ' + c.notes : ''}

Aşağıdakı plan bəndlərinin HƏR BİRİ üçün düz bir sual yaz (sıra ilə, cəmi ${items.length} sual):
${items.map((it, i) => `${i + 1}) [${it.section}] ${it.topic} · ${it.subtype} · çətinlik: ${it.difficulty} · vizual: ${it.visual}\n   İdeya: ${it.idea}`).join('\n')}
${avoid ? '\nBu paketdə artıq yazılmış suallar (bunları və onların ədəd dəyişdirilmiş formalarını təkrarlama):\n' + avoid : ''}

Hər sualı yazmazdan əvvəl özün tam həll et və yoxla. Vizual "yok" deyilsə, "figure" sahəsinə SVG çək.
Bu formada qaytar: {"questions": [ ${TRYOS_QUESTION_SHAPE} ]}`;
  const data = await askJSON([{ type: 'text', text: prompt }], { system: TRYOS_SYSTEM, maxTokens: 16000 });
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = list.map((q, i) => normalizeTryos(q, items[i] || items[0])).filter(Boolean);
  if (!questions.length) throw publicError('AI sual qaytarmadı, yenidən yoxlayın', 502);
  return { questions };
}

function normalizeTryos(q, item) {
  if (!q || typeof q !== 'object' || !q.body) return null;
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).slice(0, 5);
  if (options.length !== 5 || options.some((o) => !o)) return null;
  if (new Set(options).size !== 5) return null;
  const idx = Number.isInteger(q.correct_index) ? q.correct_index : options.indexOf(String(q.answer || '').trim());
  if (idx < 0 || idx > 4) return null;
  let optionFigures = Array.isArray(q.option_figures) ? q.option_figures.map((f) => cleanSvg(f)) : [];
  if (optionFigures.filter(Boolean).length !== 5) optionFigures = [];
  return {
    body: String(q.body).trim().slice(0, 4000),
    figure: cleanSvg(q.figure),
    option_figures: optionFigures,
    qtype: 'mcq',
    options,
    answer: options[idx],
    solution: String(q.solution || '').trim().slice(0, 4000),
    topic: String(q.topic || item.topic || '').slice(0, 200),
    subtype: String(q.subtype || item.subtype || '').slice(0, 120),
    difficulty: pick(q.difficulty, ['asan', 'orta', 'çətin'], item.difficulty || 'orta'),
    section: pick(q.section, ['matematik', 'sayisal'], item.section || 'matematik'),
    exam: 'tryos',
    grade: null
  };
}

// Server tərəfində SVG-ni sadə təmizləmə (brauzer də ayrıca təmizləyir)
function cleanSvg(svg) {
  let s = String(svg || '').trim();
  if (!/^<svg[\s>]/i.test(s) || s.length > 80000) return '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(image|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
  return s;
}

async function verify(b) {
  const qs = (Array.isArray(b.questions) ? b.questions : []).slice(0, 6);
  if (!qs.length) throw publicError('Yoxlanılacaq sual yoxdur');
  const prompt = `Sən müstəqil yoxlayıcısan. Aşağıdakı TR-YÖS üslubunda sualları cavab açarını görmədən özün həll et.
Hər sual üçün: düzgün variantın indeksini (0-4) tap, birdən çox variant düzgün ola bilərsə və ya şərt çatışmırsa/ziddiyyətlidirsə, "issue" sahəsində Azərbaycan dilində qısa yaz.
Şəkil SVG kodu kimi verilib; koordinatları və yazıları oxu.

${qs.map((q, i) => `### Sual ${i + 1}
${String(q.body || '').slice(0, 4000)}
${q.figure ? 'Şəkil (SVG):\n' + String(q.figure).slice(0, 20000) : ''}
Variantlar:
${(q.options || []).map((o, j) => `${'ABCDE'[j]}) ${o}${q.option_figures && q.option_figures[j] ? '\n   (SVG) ' + String(q.option_figures[j]).slice(0, 6000) : ''}`).join('\n')}`).join('\n\n')}

Bu formada qaytar: {"results": [{"index": 0, "issue": ""}]} (sualların sırası ilə).`;
  const data = await askJSON([{ type: 'text', text: prompt }], { system: 'Sən diqqətli riyaziyyat yoxlayıcısan. Yalnız JSON qaytar.', maxTokens: 8000 });
  const results = (Array.isArray(data.results) ? data.results : []).slice(0, qs.length);
  return {
    results: qs.map((q, i) => {
      const r = results[i] || {};
      const expected = (q.options || []).indexOf(q.answer);
      const index = Number.isInteger(r.index) ? r.index : -1;
      const issue = String(r.issue || '').slice(0, 400);
      return { ok: index === expected && !issue, index, expected, issue };
    })
  };
}

// ---------- Köməkçilər ----------

async function verifyTeacher(req) {
  const auth = req.headers['authorization'] || '';
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!auth.startsWith('Bearer ') || !url || !anon) return null;
  const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: anon, Authorization: auth }
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user && user.id ? user : null;
}

async function askJSON(content, { system = SYSTEM, maxTokens = 12000 } = {}) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Anthropic error', r.status, data);
    if (r.status === 401) throw publicError('API açarı yanlışdır', 502);
    if (r.status === 429) throw publicError('Çox sorğu göndərildi, bir dəqiqə gözləyin', 429);
    throw publicError('AI xidməti cavab vermədi', 502);
  }
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return parseJSON(text);
}

function parseJSON(text) {
  let cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  // LaTeX-in tək tərs xətlərini (\sqrt, \underline) etibarlı JSON-a çevir
  const repaired = cleaned.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m, g) => (g ? m : '\\\\'));
  for (const candidate of [cleaned, repaired]) {
    try { return fixLatex(JSON.parse(candidate)); } catch (_) { /* növbəti */ }
  }
  throw publicError('AI cavabı oxunmadı, yenidən yoxlayın', 502);
}

// JSON "\f", "\t", "\b", "\r", "\n" kimi oxuduğu LaTeX əmrlərini bərpa et (\frac, \times, \beta, \right, \neq)
const SVG_KEYS = new Set(['figure', 'option_figures']);
function fixLatex(v, key) {
  if (key && SVG_KEYS.has(key)) return v;
  if (typeof v === 'string') {
    return v
      .replace(/\f/g, '\\f').replace(/\t/g, '\\t').replace(/\x08/g, '\\b').replace(/\r/g, '\\r')
      .replace(/\n(?=(eq|leq|geq|eg|ot|abla|e\b|i\b|u\b|mid|parallel|subseteq|ewline))/g, '\\n');
  }
  if (Array.isArray(v)) return v.map((x) => fixLatex(x));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = fixLatex(v[k], k);
    return o;
  }
  return v;
}

function normalizeQuestion(q, defaults) {
  if (!q || typeof q !== 'object' || !q.body) return null;
  const qtype = pick(q.qtype, ['mcq', 'open'], defaults.qtype);
  let options = [];
  let answer = String(q.answer || '').trim();
  if (qtype === 'mcq') {
    options = (Array.isArray(q.options) ? q.options : []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    if (options.length < 2) return null;
    const idx = Number.isInteger(q.correct_index) ? q.correct_index : options.indexOf(answer);
    if (idx < 0 || idx >= options.length) return null;
    answer = options[idx];
  }
  if (!answer) return null;
  return {
    body: String(q.body).trim().slice(0, 3000),
    qtype,
    options,
    answer: answer.slice(0, 500),
    solution: String(q.solution || '').trim().slice(0, 3000),
    topic: String(q.topic || defaults.topic || '').slice(0, 200),
    grade: defaults.grade,
    difficulty: pick(q.difficulty, ['asan', 'orta', 'çətin'], defaults.difficulty)
  };
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function pick(v, allowed, def) {
  return allowed.includes(v) ? v : def;
}

function publicError(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  e.publicMessage = msg;
  return e;
}
