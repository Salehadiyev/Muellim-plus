// Müəllim+ · AI funksiyası (Vercel serverless)
// Lazım olan mühit dəyişənləri (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   — Claude API açarı
//   SUPABASE_URL        — Supabase layihə ünvanı
//   SUPABASE_ANON_KEY   — Supabase "anon public" açarı
//   ANTHROPIC_MODEL     — (istəyə bağlı) model adı

import { AsyncLocalStorage } from 'node:async_hooks';
import { TRYOS_SYSTEM, TRYOS_QUESTION_SHAPE, TRYOS_TOPICS, TRYOS_MODES, TRYOS_ANALYSIS_SHAPE, GEN_MODE_KEYS } from './_tryos.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// Köməkçi işlər (şəkil oxuma, ikinci yoxlama) üçün daha ucuz model
const HELPER_MODEL = process.env.HELPER_MODEL || 'claude-sonnet-5-5';

// Müəllimin seçə biləcəyi modellər. Açarı olmayan provayder brauzerdə boz görünür.
export const MODELS = {
  'opus': { key: 'opus', provider: 'anthropic', id: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  'sonnet': { key: 'sonnet', provider: 'anthropic', id: process.env.SONNET_MODEL || 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  'gemini-flash': { key: 'gemini-flash', provider: 'google', id: process.env.GEMINI_MODEL || 'gemini-flash-latest', label: 'Gemini 3.8 Flash' },
  'gpt-sol': { key: 'gpt-sol', provider: 'openai', id: process.env.OPENAI_MODEL || 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }
};
const PROVIDER_KEY = { anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' };

function resolveModel(key) {
  const m = MODELS[key] || MODELS.opus;
  if (!process.env[PROVIDER_KEY[m.provider]]) throw publicError(`${m.label} üçün API açarı qurulmayıb (Vercel → ${PROVIDER_KEY[m.provider]})`);
  return m;
}

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

    if (!Object.values(PROVIDER_KEY).some((k) => process.env[k])) {
      return res.status(500).json({ error: 'Heç bir AI açarı qurulmayıb' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action;
    body._model = resolveModel(body.model);
    const tag = (out) => {
      // hansı modelin yaratdığı ekranda görünsün
      const key = MODELS[body.model] ? body.model : 'opus';
      (out.questions || []).forEach((q) => { q.model = key; });
      if (out.question) out.question.model = key;
      return out;
    };

    const actions = {
      generate: async () => tag(await generate(body)),
      extract: () => extract(body),
      transform: async () => tag(await transform(body)),
      tryos_plan: () => tryosPlan(body),
      tryos_generate: async () => tag(await tryosGenerate(body)),
      verify: () => verify(body),
      tryos_analyze: () => tryosAnalyze(body),
      tryos_from_examples: async () => tag(await tryosFromExamples(body)),
      clean_copy: () => cleanCopy(body)
    };
    if (!actions[action]) return res.status(400).json({ error: 'Naməlum əməliyyat' });
    const store = { calls: [], genModel: body._model };
    try {
      const out = await usageStore.run(store, actions[action]);
      const made = (out.questions ? out.questions.length : 0) + (out.question ? 1 : 0);
      await saveUsage(req, action, store.calls, made, body._model.key);
      return res.status(200).json(out);
    } catch (err) {
      await saveUsage(req, action, store.calls, 0, body._model.key); // uğursuz sorğunun da xərci yazılsın
      throw err;
    }
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

  const data = await askJSON([{ type: 'text', text: prompt }], { model: b._model });
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = list.map(q => normalizeQuestion(q, { grade, difficulty, qtype, topic })).filter(Boolean);
  if (!questions.length) throw publicError('AI sual qaytarmadı, yenidən yoxlayın');
  return { questions };
}

function imageBlock(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[3] } };
}

// Səhifədəki bütün sualları ayrı-ayrı oxuyur (TR-YÖS nümunələri üçün)
async function extractSplit(b) {
  const img = imageBlock(b.image);
  if (!img) throw publicError('Şəkil oxunmadı');
  const prompt = `Şəkildə imtahan/test səhifəsi var. Oradakı HƏR riyaziyyat və ya məntiq sualını ayrıca götür.
Hər sual üçün:
- "text": sualın tam mətni və variantları (A)… E)), olduğu kimi; riyazi ifadələr LaTeX ilə $...$ arasında; sualın nömrəsini yazma.
- Sualda şəkil, qrafik, cədvəl, ədəd oxu və ya sxem varsa, "text"-in sonunda "[Şekil: ...]" kimi onu dəqiq təsvir et (ədədlər, nöqtələr, oxlar, bölgələr).
- "topic": mövzu (türkcə, məs. "Köklü sayılar"), "section": "matematik" və ya "sayisal".
- "box": sualın şəkildəki yeri, faizlə [x, y, en, hündürlük] (0-100).
Yarımçıq görünən sualı götürmə. Oxunmayan hissəni təxmin etmə.
Bu formada qaytar: {"questions": [{"text": "...", "topic": "...", "section": "matematik", "box": [0, 0, 50, 25]}]}`;
  const data = await askJSON([img, { type: 'text', text: prompt }], { maxTokens: 12000 });
  const questions = (Array.isArray(data.questions) ? data.questions : []).map((q) => ({
    text: String(q.text || '').trim().slice(0, 4000),
    topic: String(q.topic || '').slice(0, 120),
    section: pick(q.section, ['matematik', 'sayisal'], 'matematik'),
    box: Array.isArray(q.box) && q.box.length === 4 && q.box.every((n) => Number.isFinite(+n)) ? q.box.map((n) => Math.max(0, Math.min(100, +n))) : null
  })).filter((q) => q.text);
  if (!questions.length) throw publicError('Səhifədə sual tapılmadı');
  return { questions: questions.slice(0, 20) };
}

// Nümunənin strukturlaşdırılmış analizi: yaratmadan əvvəl (Claude Sonnet, şəkil ilə)
async function tryosAnalyze(b) {
  const img = imageBlock(b.image);
  const text = String(b.text || '').slice(0, 4000).trim();
  if (!img && !text) throw publicError('Nümunə boşdur');
  const content = [];
  if (img) content.push(img);
  content.push({ type: 'text', text: `Bu, müəllimin TR-YÖS nümunə sualıdır${img ? ' (şəkil yuxarıdadır)' : ''}.
${text ? 'Əvvəlcədən oxunmuş mətn (səhv ola bilər, şəkillə tutuşdur):\n"""\n' + text + '\n"""' : ''}
${b.topic ? 'Müəllimin/sistemin mövzu etiketi: ' + String(b.topic).slice(0, 120) : ''}${b.section ? ' · bölmə etiketi: ' + b.section : ''}

1) "text": sualın tam mətnini və variantlarını (A–E) şəkildən olduğu kimi yaz; riyazi ifadələr LaTeX ilə $...$; nömrəni yazma. Şəkil/kadr varsa sonda "[Şekil: ...]" ilə hər kadrı və hər variantı ayrıca, dəqiq təsvir et.
2) Nümunəni analiz et (aşağıdakı forma).
- "complete": şərt, BÜTÜN kadrlar/mərhələlər və BÜTÜN variantlar kəsikdə tam görünürsə true; nəsə kəsilib və ya çatışmırsa false.
- "uncertain": oxunmayan, bulanıq və ya bir neçə cür yozula bilən hissələr. Təxmin etmə, burada yaz.
- "conflict": mətn ilə şəkil, ya da etiket ilə şəkil arasında ziddiyyət varsa yaz.
- "rule_hidden": qaydanı şagird özü kəşf etməlidirsə true.
- "options_are_figures": variantlar şəkildirsə true. "figure_required": sualın əsas şəkli/qrafiki varsa true.
Bu formada qaytar: {"text": "...", "analysis": ${TRYOS_ANALYSIS_SHAPE}}` });
  const data = await askJSON(content, { system: 'Sən TR-YÖS sual analitikisən. Diqqətli ol, uydurma. Yalnız JSON qaytar. Bütün dəyərlər Azərbaycan və ya Türkiyə türkcəsində.', maxTokens: 6000 });
  const a = data.analysis || {};
  const arr = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 240)).filter(Boolean).slice(0, 10);
  const analysis = {
    section: pick(a.section, ['matematik', 'sayisal'], pick(b.section, ['matematik', 'sayisal'], 'matematik')),
    topic: String(a.topic || b.topic || '').slice(0, 120),
    family: String(a.family || '').slice(0, 200),
    visual: String(a.visual || '').slice(0, 600),
    skill: String(a.skill || '').slice(0, 300),
    rule: String(a.rule || '').slice(0, 800),
    student_task: String(a.student_task || '').slice(0, 300),
    rule_hidden: a.rule_hidden === true,
    options_are_figures: a.options_are_figures === true,
    figure_required: a.figure_required === true,
    difficulty: pick(a.difficulty, ['asan', 'orta', 'çətin'], 'orta'),
    preserve: arr(a.preserve),
    variable: arr(a.variable),
    uncertain: arr(a.uncertain),
    complete: a.complete !== false,
    conflict: String(a.conflict || '').slice(0, 300)
  };
  return { text: String(data.text || text).slice(0, 6000), analysis };
}

function analysisText(a) {
  if (!a) return '';
  return `Nümunə analizi:
- Bölmə: ${a.section} · Mövzu: ${a.topic}
- Sual ailəsi: ${a.family}
- Vizual quruluş: ${a.visual}
- Bacarıq: ${a.skill}
- Qayda: ${a.rule}
- Şagirddən tələb: ${a.student_task}
- Qayda şagirddən gizlidir (kəşf edilməlidir): ${a.rule_hidden ? 'BƏLİ — şərtdə açıqlama' : 'xeyr'}
- Variantlar şəkildir: ${a.options_are_figures ? 'BƏLİ — 5 option_figures məcburidir' : 'xeyr'}
- Əsas şəkil: ${a.figure_required ? 'BƏLİ — figure məcburidir' : 'xeyr'}
- Çətinlik: ${a.difficulty}
- Qorunmalı: ${(a.preserve || []).join('; ') || '—'}
- Dəyişdirilə bilər: ${(a.variable || []).join('; ') || '—'}`;
}

// Nümunədən yeni sual(lar). Brauzer hər sorğuda bir nümunə və ən çox 2 sual istəyir.
async function tryosFromExamples(b) {
  const samples = (Array.isArray(b.samples) ? b.samples : []).slice(0, 3);
  if (!samples.length) throw publicError('Nümunə yoxdur');
  const per = clampInt(b.perSample, 1, 3, 1);
  const mode = GEN_MODE_KEYS.includes(b.mode) ? b.mode : 'benzer';
  const notes = String(b.notes || '').slice(0, 800).trim();
  const feedback = String(b.feedback || '').slice(0, 1200).trim();
  const avoid = (Array.isArray(b.avoid) ? b.avoid : []).slice(0, 20).map((t) => '- ' + String(t).slice(0, 200)).join('\n');
  const content = [];
  samples.forEach((smp, i) => {
    content.push({ type: 'text', text: `### Nümunə ${i}
Bölmə: ${smp.section || '—'} · Mövzu: ${smp.topic || '—'}
${String(smp.text || '').slice(0, 4000)}
${analysisText(smp.analysis)}` });
    const img = imageBlock(smp.image);
    if (img) content.push(img);
  });
  content.push({ type: 'text', text: `Yuxarıdakı ${samples.length} nümunənin HƏR BİRİ üçün düz ${per} yeni sual yaz (cəmi ${samples.length * per}).
${TRYOS_MODES[mode]}
Nümunənin bölməsini və mövzusunu saxla. Analizdəki "qorunmalı" bəndlərə tam əməl et.
Analizdə "Variantlar şəkildir: BƏLİ" yazılıbsa, 5 option_figures məcburidir; "Əsas şəkil: BƏLİ" yazılıbsa, figure məcburidir.
${per > 1 && mode !== 'izomorf' ? 'Eyni nümunədən yaranan suallar bir-birinin sadəcə ədəd dəyişdirilmiş surəti olmasın.' : ''}
${avoid ? 'Bu nümunədən artıq yaradılıb (təkrarlama):\n' + avoid : ''}
${feedback ? 'Əvvəlki cəhd yoxlamadan keçmədi. Bu problemləri aradan qaldır:\n' + feedback : ''}
${notes ? 'Müəllimin əlavə istəyi: ' + notes : ''}
Hər sualda "sample" sahəsinə nümunənin nömrəsini (0-dan) yaz.
Bu formada qaytar: {"questions": [ ${TRYOS_QUESTION_SHAPE.replace('{', '{\n  "sample": 0,')} ]}` });
  const data = await askJSON(content, { system: TRYOS_SYSTEM, maxTokens: 20000, model: b._model });
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = [];
  const rejected = [];
  list.forEach((q) => {
    const sample = clampInt(q.sample, 0, samples.length - 1, 0);
    const a = samples[sample].analysis || {};
    const res = normalizeTryos(q, {
      topic: samples[sample].topic || a.topic || '', section: samples[sample].section || a.section || 'matematik', subtype: '', difficulty: a.difficulty || 'orta'
    }, { figureRequired: a.figure_required === true, optionsAreFigures: a.options_are_figures === true });
    if (res.error) rejected.push({ sample, reason: res.error });
    else questions.push({ ...res.q, sample });
  });
  if (!questions.length) throw publicError('AI yararlı sual qaytarmadı' + (rejected.length ? ': ' + rejected.map((r) => r.reason).join('; ') : ''), 502);
  return { questions, rejected };
}

// Kitabdakı sualın təmiz nüsxəsi: dəyişmədən yenidən yazılır, şəkillər SVG ilə yenidən çəkilir
async function cleanCopy(b) {
  const img = imageBlock(b.image);
  if (!img) throw publicError('Sualın şəkli yoxdur');
  const a = b.analysis || {};
  const feedback = String(b.feedback || '').slice(0, 1200).trim();
  const content = [img, { type: 'text', text: `Yuxarıdakı şəkil kitabdan kəsilmiş bir sualdır.
${b.text ? 'Əvvəlcədən oxunmuş mətn (səhv ola bilər, şəkillə tutuşdur):\n"""\n' + String(b.text).slice(0, 4000) + '\n"""' : ''}
${analysisText(a)}

TAPŞIRIQ: yeni sual YARATMA. Bu sualın TƏMİZ NÜSXƏSİNİ hazırla.
${TRYOS_MODES.original}
- Şərti sözbəsöz, kitabın öz dilində yaz (türkcə tələbi və yaratma qaydaları bu tapşırığa aid deyil; yalnız SVG qaydaları qüvvədədir). Sual nömrəsini və variant hərflərini yazma. Riyazi ifadələr LaTeX ilə $...$.
- Variantları eyni sırada ver (4 və ya 5 variant — kitabda neçədirsə).
- Sualda şəkil, qrafik, cədvəl, kadr və ya şəkilli variantlar varsa, onları SVG ilə kitabdakına maksimum yaxın çək (ölçülər, sayılar, istiqamətlər, qaralmış hissələr eyni).
- Cavab şəkildə göstərilibsə onu götür; göstərilməyibsə, sualı özün diqqətlə həll et və düzgün variantı seç. Qısa həll yaz.
- Oxunmayan hissə varsa uydurma: "unreadable" siyahısına yaz.
${feedback ? 'Əvvəlki cəhd yoxlamadan keçmədi. Bu problemləri düzəlt (orijinaldan uzaqlaşmadan):\n' + feedback : ''}
Bu formada qaytar: {"question": ${TRYOS_QUESTION_SHAPE}, "unreadable": []}` }];
  // Təmiz nüsxəni (şəkil çəkmə daxil) köməkçi model hazırlayır: Claude Sonnet, o işləməsə başqa qoşulu model
  const data = await askJSON(content, { system: TRYOS_SYSTEM, maxTokens: 16000 });
  const res = normalizeTryos(data.question, {
    topic: a.topic || '', section: a.section || 'matematik', subtype: '', difficulty: a.difficulty || 'orta'
  }, { figureRequired: a.figure_required === true, optionsAreFigures: a.options_are_figures === true, optionCounts: [4, 5] });
  if (res.error) throw publicError('Təmiz nüsxə alınmadı: ' + res.error, 502);
  const unreadable = (Array.isArray(data.unreadable) ? data.unreadable : []).map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 6);
  return { questions: [{ ...res.q, unreadable, model: usageStore.getStore()?.lastHelper || 'sonnet' }] };
}

async function extract(b) {
  if (b.split) return extractSplit(b);
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec(String(b.image || ''));
  if (!m) throw publicError('Şəkil oxunmadı');
  const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];

  const prompt = `Şəkildə dərslikdən kəsilmiş riyaziyyat tapşırığı var.
1) Tapşırığın mətnini olduğu kimi oxu (nömrəsini yazma). Şəkil, qrafik, cədvəl, ədəd oxu və ya sxem varsa, mətnin sonunda "[Şekil: ...]" kimi dəqiq təsvir et. Riyazi ifadələri LaTeX ilə $...$ arasında yaz. ${b.all ? 'Şəkildə bir neçə tapşırıq varsa, HAMISINI oxu: hər birini variantları ilə birlikdə ayrı abzasda, boş sətirlə ayıraraq yaz.' : 'Şəkildə bir neçə tapşırıq varsa, ən tam görünəni götür.'}
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

  const data = await askJSON([{ type: 'text', text: prompt }], { model: b._model });
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
  const data = await askJSON([{ type: 'text', text: prompt }], { system: TRYOS_SYSTEM, maxTokens: 8000, model: b._model });
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
  const data = await askJSON([{ type: 'text', text: prompt }], { system: TRYOS_SYSTEM, maxTokens: 16000, model: b._model });
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = list.map((q, i) => normalizeTryos(q, items[i] || items[0], { figureRequired: (items[i] || items[0]).visual && (items[i] || items[0]).visual !== 'yok' }).q).filter(Boolean);
  if (!questions.length) throw publicError('AI sual qaytarmadı, yenidən yoxlayın', 502);
  return { questions };
}

// Qaytarır: { q } və ya { error }. req: { figureRequired, optionsAreFigures }
function normalizeTryos(q, item, req = {}) {
  if (!q || typeof q !== 'object' || !q.body) return { error: 'sual mətni yoxdur' };
  const counts = req.optionCounts || [5];
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).slice(0, 5);
  if (!counts.includes(options.length) || options.some((o) => !o)) return { error: counts.join(' və ya ') + ' variant yoxdur' };
  const n = options.length;
  if (new Set(options).size !== n) return { error: 'eyni yazılmış variantlar var' };
  const idx = Number.isInteger(q.correct_index) ? q.correct_index : options.indexOf(String(q.answer || '').trim());
  if (idx < 0 || idx > n - 1) return { error: 'cavab indeksi yanlışdır' };
  const issues = [];
  const fig = cleanSvg(q.figure);
  if (fig.removed) issues.push('əsas şəkildən ' + fig.removed + ' icazəsiz element silindi');
  const rawOpts = Array.isArray(q.option_figures) ? q.option_figures.filter((f) => String(f || '').trim()) : [];
  const optFigs = rawOpts.map((f) => cleanSvg(f));
  const wantsOptFigs = req.optionsAreFigures || rawOpts.length > 0;
  let optionFigures = [];
  if (wantsOptFigs) {
    if (optFigs.length !== n || optFigs.some((f) => !f.svg)) return { error: 'variant şəkilləri natamamdır (' + optFigs.filter((f) => f.svg).length + '/' + n + ')' };
    const norm = optFigs.map((f) => f.svg.replace(/\s+/g, ' ').replace(/\sid="[^"]*"/g, ''));
    if (new Set(norm).size !== n) return { error: 'eyni çəkilmiş variant şəkilləri var' };
    optFigs.forEach((f, i) => { if (f.removed) issues.push('variant ' + 'ABCDE'[i] + ' şəklindən ' + f.removed + ' element silindi'); });
    optionFigures = optFigs.map((f) => f.svg);
  }
  if (req.figureRequired && !fig.svg) return { error: 'əsas şəkil tələb olunur, amma çəkilməyib' };
  return { q: {
    body: String(q.body).trim().slice(0, 4000),
    figure: fig.svg,
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
    grade: null,
    render_issues: issues
  } };
}

// Server tərəfində SVG təmizləmə: { svg, removed } qaytarır (brauzer də ayrıca təmizləyir)
function cleanSvg(svg) {
  let s = String(svg || '').trim();
  if (!/^<svg[\s>]/i.test(s) || s.length > 120000) return { svg: '', removed: 0 };
  let removed = 0;
  const count = (re) => { const m = s.match(re); if (m) removed += m.length; };
  count(/<script[\s\S]*?<\/script>/gi); count(/<foreignObject[\s\S]*?<\/foreignObject>/gi); count(/<(image|iframe|object|embed)[^>]*>/gi);
  count(/<style[\s\S]*?<\/style>/gi);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(image|iframe|object|embed)[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
  return { svg: s, removed };
}

// İki ayrı yoxlama:
//  A) Düzgünlük — cavab açarını görmədən həll edir; şəkilli sualda brauzerdə çəkilmiş YEKUN görüntünü görür.
//  B) Nümunəyə uyğunluq və daxili ardıcıllıq — orijinal nümunəni, analizi, rejimi, açarı və həlli görür.
async function verify(b) {
  const qs = (Array.isArray(b.questions) ? b.questions : []).slice(0, 3);
  if (!qs.length) throw publicError('Yoxlanılacaq sual yoxdur');
  const results = await Promise.all(qs.map((q) => verifyOne(q, b)));
  return { results };
}

async function verifyOne(q, b) {
  const options = (q.options || []).slice(0, 5);
  const expected = options.indexOf(q.answer);
  const render = imageBlock(q.render);
  const hasFigures = Boolean(q.figure) || (Array.isArray(q.option_figures) && q.option_figures.length > 0);

  // A) Düzgünlük (kor həll)
  const aContent = [];
  if (render) aContent.push(render);
  aContent.push({ type: 'text', text: `Sən müstəqil yoxlayıcısan. Aşağıdakı TR-YÖS sualını cavab açarını görmədən özün həll et.
${render ? 'Sualın şəkli (əsas şəkil və A–E variant şəkilləri) yuxarıdakı görüntüdədir — şagirdin gördüyü kimi. Yalnız görüntüyə əsaslan.' : ''}
Sual:
${String(q.body || '').slice(0, 4000)}
Variantlar:
${options.map((o, j) => `${'ABCDE'[j]}) ${o}`).join('\n')}

Yoxla: şərt kifayətdirmi; yalnız bir variant düzgündürmü; mətn, əsas şəkil və variant şəkilləri bir-birinə uyğundurmu; başqa ağlabatan qayda başqa cavab verirmi.
Bu formada qaytar: {"index": 0, "unique": true, "sufficient": true, "consistent": true, "issues": ["Azərbaycan dilində qısa; yoxdursa boş"]}` });
  const taskA = askJSON(aContent, { system: 'Sən diqqətli riyaziyyat və məntiq yoxlayıcısan. Yalnız JSON qaytar.', maxTokens: 6000 });

  // B) Uyğunluq + açar/həll ardıcıllığı
  let taskB = null;
  const smp = b.sample || q.sample_ref || null;
  if (smp || q.solution) {
    const bContent = [];
    const sImg = smp ? imageBlock(smp.image) : null;
    if (sImg) { bContent.push({ type: 'text', text: 'ORİJİNAL NÜMUNƏ:' }); bContent.push(sImg); }
    if (render) { bContent.push({ type: 'text', text: 'YENİ SUAL (yekun görüntü):' }); bContent.push(render); }
    const modeText = TRYOS_MODES[b.mode] || '';
    bContent.push({ type: 'text', text: `${smp ? `Orijinal nümunənin mətni:\n${String(smp.text || '').slice(0, 3000)}\n${analysisText(smp.analysis)}\n${modeText}\n` : ''}
Yeni sual:
${String(q.body || '').slice(0, 4000)}
Variantlar:
${options.map((o, j) => `${'ABCDE'[j]}) ${o}`).join('\n')}
Cavab açarı: ${'ABCDE'[expected] || '?'}
Həll: ${String(q.solution || '').slice(0, 3000)}

Qiymətləndir:
${smp ? `- mode_ok: seçilən rejimə əməl olunubmu?
- family_ok: sual ailəsi və təqdimat növü qorunubmu?
- skill_ok: əsas bacarıq qorunubmu?
- difficulty: "aşağı" | "eyni" | "yuxarı" (nümunəyə görə)
- rule_revealed: şagirdin kəşf etməli olduğu qayda şərtdə səhvən açıqlanıbmı?` : ''}
- key_matches_solution: həll məhz cavab açarındakı varianta gətirirmi?
- text_figure_consistent: mətn və şəkillər bir-birinə uyğundurmu?
Bu formada qaytar: {"mode_ok": true, "family_ok": true, "skill_ok": true, "difficulty": "eyni", "rule_revealed": false, "key_matches_solution": true, "text_figure_consistent": true, "issues": ["Azərbaycan dilində qısa"]}` });
    taskB = askJSON(bContent, { system: 'Sən TR-YÖS redaktorusan: yeni sualın nümunəyə və qaydalara uyğunluğunu yoxlayırsan. Yalnız JSON qaytar.', maxTokens: 4000 });
  }

  const [ra, rb] = await Promise.allSettled([taskA, taskB || Promise.resolve(null)]);
  const A = ra.status === 'fulfilled' ? ra.value : null;
  const B = rb.status === 'fulfilled' ? rb.value : null;
  const strs = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 240)).filter(Boolean).slice(0, 6);

  const index = A && Number.isInteger(A.index) ? A.index : -1;
  const aIssues = A ? strs(A.issues) : ['düzgünlük yoxlaması alınmadı'];
  if (hasFigures && !render) aIssues.push('şəkil görüntüsü göndərilmədi — vizual yoxlama edilmədi');
  if (A && index !== expected) aIssues.unshift(`kor həll ${'ABCDE'[index] || '?'} variantını tapdı, açar ${'ABCDE'[expected] || '?'}`);
  if (A && A.unique === false) aIssues.push('birdən çox variant düzgün ola bilər');
  if (A && A.sufficient === false) aIssues.push('şərt kifayət deyil');
  if (A && A.consistent === false) aIssues.push('mətn və şəkil uyğun deyil');
  const correct = { ok: Boolean(A) && index === expected && A.unique !== false && A.sufficient !== false && A.consistent !== false && !(hasFigures && !render), index, issues: aIssues };

  let fit = null;
  if (taskB) {
    const fIssues = B ? strs(B.issues) : ['uyğunluq yoxlaması alınmadı'];
    const bad = [];
    if (B) {
      if (smp && B.mode_ok === false) bad.push('rejimə əməl olunmayıb');
      if (smp && B.family_ok === false) bad.push('sual ailəsi dəyişib');
      if (smp && B.skill_ok === false) bad.push('başqa bacarıq yoxlanılır');
      if (smp && B.difficulty === 'aşağı') bad.push('çətinlik əsassız azalıb');
      if (smp && B.rule_revealed === true) bad.push('kəşf edilməli qayda şərtdə açıqlanıb');
      if (B.key_matches_solution === false) bad.push('həll cavab açarına uyğun deyil');
      if (B.text_figure_consistent === false) bad.push('mətn və şəkil uyğun deyil');
    }
    fit = { ok: Boolean(B) && !bad.length, issues: [...bad, ...fIssues.filter((x) => !bad.includes(x))].slice(0, 8), difficulty: B ? String(B.difficulty || '') : '' };
  }
  return { ok: correct.ok && (!fit || fit.ok), correct, fit, index, expected, issue: [...correct.issues, ...(fit ? fit.issues : [])].join('; ').slice(0, 600) };
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

const HELPER = { key: 'sonnet', provider: 'anthropic', id: HELPER_MODEL, label: 'Claude Sonnet', helper: true };

// ---------- Xərc uçotu ----------
// Hər sorğunun token istifadəsi bu "yaddaşa" yığılır və sonda bazaya yazılır
const usageStore = new AsyncLocalStorage();

// Qiymətlər: 1 milyon token üçün USD (oktyabr 2026). Dəyişsə, yalnız burada yeniləmək kifayətdir.
function priceOf(key) {
  if (key === 'opus') return { in: 4, out: 20 };
  if (key === 'sonnet') return { in: 2, out: 10 };
  if (key === 'gpt-sol') return { in: 2, out: 10, cached: 0.10 };
  if (key === 'gemini-flash') return new Date() >= new Date('2027-01-01') ? { in: 1.5, out: 7.5 } : { in: 0.75, out: 3.75 };
  return { in: 0, out: 0 };
}

function recordUsage(model, u) {
  const store = usageStore.getStore();
  if (!store || !u) return;
  const p = priceOf(model.key);
  let input = 0, output = 0, cost = 0;
  if (model.provider === 'anthropic') {
    const cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
    input = (u.input_tokens || 0) + cw + cr;
    output = u.output_tokens || 0;
    cost = ((u.input_tokens || 0) * p.in + cw * p.in * 1.25 + cr * p.in * 0.1 + output * p.out) / 1e6;
  } else if (model.provider === 'google') {
    input = u.promptTokenCount || 0;
    output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    cost = (input * p.in + output * p.out) / 1e6;
  } else if (model.provider === 'openai') {
    const cached = u.input_tokens_details?.cached_tokens || 0;
    input = u.input_tokens || 0;
    output = u.output_tokens || 0;
    cost = ((input - cached) * p.in + cached * (p.cached ?? p.in) + output * p.out) / 1e6;
  }
  store.calls.push({ model: model.key, role: model.helper ? 'helper' : 'main', input_tokens: input, output_tokens: output, cost_usd: Math.round(cost * 1e6) / 1e6 });
}

async function saveUsage(req, action, calls, questions, forModel) {
  if (!calls.length) return;
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  let mainMarked = false;
  const rows = calls.map((c) => {
    const row = { action, ...c, for_model: forModel, questions: 0 };
    if (!mainMarked && c.role === 'main' && questions) { row.questions = questions; mainMarked = true; }
    return row;
  });
  try {
    const r = await fetch(url + '/rest/v1/ai_usage', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: req.headers['authorization'], 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!r.ok) console.error('usage save', r.status, (await r.text()).slice(0, 300));
  } catch (err) { console.error('usage save', err); }
}

// content: Anthropic formatında bloklar ({type:'text'} və {type:'image'}); digər provayderlər üçün çevrilir
async function askOnce(model, system, content, maxTokens) {
  let text;
  if (model.provider === 'google') text = await callGemini(model, system, content, maxTokens);
  else if (model.provider === 'openai') text = await callOpenAI(model, system, content, maxTokens);
  else text = await callAnthropic(model, system, content, maxTokens);
  return parseJSON(text);
}

// Köməkçi işlər (oxuma, analiz, yoxlama) üçün modellər sırası:
// əvvəl Claude Sonnet; o işləməsə (balans, açar, xəta) — qoşulu başqa provayder
// (mümkünsə sualı yazan modeldən fərqli, yoxlama müstəqil olsun), ən sonda sualı yazan modelin özü.
function helperChain() {
  const store = usageStore.getStore() || {};
  const gen = store.genModel;
  const has = (m) => Boolean(process.env[PROVIDER_KEY[m.provider]]) && !(store.badProviders || new Set()).has(m.provider);
  const asHelper = (m) => ({ ...m, helper: true });
  const others = [MODELS['gemini-flash'], MODELS['gpt-sol']].filter((m) => m.provider !== gen?.provider);
  const list = [HELPER, ...others, ...(gen && gen.provider !== 'anthropic' ? [gen] : [])].filter(has).map(asHelper);
  const seen = new Set();
  return list.filter((m) => (seen.has(m.provider) ? false : seen.add(m.provider)));
}

async function askJSON(content, { system = SYSTEM, maxTokens = 12000, model = HELPER } = {}) {
  if (!model.helper) return askOnce(model, system, content, maxTokens);
  const chain = helperChain();
  if (!chain.length) throw publicError('Köməkçi model üçün işləyən API açarı yoxdur (Claude balansı bitib və başqa açar qoşulmayıb)', 402);
  const store = usageStore.getStore();
  let last;
  for (const m of chain) {
    try {
      const out = await askOnce(m, system, content, maxTokens);
      if (store) store.lastHelper = m.key;
      return out;
    } catch (err) {
      last = err;
      // balans/açar problemi olan provayder bu sorğuda bir daha sınanmasın
      if ([401, 402, 403].includes(err.status) || /balans|açarı/.test(err.publicMessage || "")) {
        if (store) (store.badProviders = store.badProviders || new Set()).add(m.provider);
      }
    }
  }
  throw last;
}

function aiError(name, status, data) {
  console.error(name + ' error', status, JSON.stringify(data).slice(0, 2000));
  if (status === 401 || status === 403) return publicError(`${name}: API açarı yanlışdır və ya icazə yoxdur`, 502);
  if (status === 429) return publicError(`${name}: çox sorğu və ya balans bitib, bir az sonra yoxlayın`, 429);
  if (status === 404) return publicError(`${name}: model tapılmadı`, 502);
  if (status === 400 && /credit|balance|billing/i.test(JSON.stringify(data))) return publicError(`${name}: balans bitib`, 402);
  const msg = String(data?.error?.message || data?.error?.status || data?.message || '').replace(/\s+/g, ' ').slice(0, 220);
  return publicError(`${name} cavab vermədi (${status}${msg ? ': ' + msg : ''})`, 502);
}

// Müvəqqəti xətalarda (həddən artıq yüklənmə) bir dəfə yenidən cəhd
async function fetchRetry(url, opts) {
  let r = await fetch(url, opts);
  for (let i = 0; i < 2 && [429, 500, 502, 503, 529].includes(r.status); i++) {
    // limitə dəyəndə provayderin dediyi qədər (ən çox 20 saniyə) gözlə və yenidən cəhd et
    const ra = parseFloat(r.headers?.get?.('retry-after') || '');
    const wait = Number.isFinite(ra) ? Math.min(20, Math.max(1, ra)) * 1000 : (r.status === 429 ? 8000 : 2500);
    await new Promise((z) => setTimeout(z, wait));
    r = await fetch(url, opts);
  }
  return r;
}

async function callAnthropic(model, system, content, maxTokens) {
  const r = await fetchRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: maxTokens,
      // uzun qaydalar keşdə saxlanılır: təkrar sorğularda çox ucuz oxunur
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw aiError('Claude', r.status, data);
  recordUsage(model, data.usage);
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

async function callGemini(model, system, content, maxTokens) {
  const parts = content.map((c) => c.type === 'image'
    ? { inlineData: { mimeType: c.source.media_type, data: c.source.data } }
    : { text: c.text });
  const r = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: Math.max(maxTokens, 16000), responseMimeType: 'application/json' }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw aiError('Gemini', r.status, data);
  recordUsage(model, data.usageMetadata);
  const cand = (data.candidates || [])[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw publicError('Gemini boş cavab qaytardı' + (cand?.finishReason ? ' (' + cand.finishReason + ')' : ''), 502);
  return text;
}

async function callOpenAI(model, system, content, maxTokens) {
  const input = [{
    role: 'user',
    content: content.map((c) => c.type === 'image'
      ? { type: 'input_image', image_url: `data:${c.source.media_type};base64,${c.source.data}` }
      : { type: 'input_text', text: c.text })
      .concat([{ type: 'input_text', text: 'Return the answer as a single valid JSON object (json).' }])
  }];
  const r = await fetchRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: model.id,
      instructions: system + '\nCavabı JSON formatında qaytar.',
      input,
      max_output_tokens: Math.max(maxTokens, 16000),
      text: { format: { type: 'json_object' } }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw aiError('OpenAI', r.status, data);
  recordUsage(model, data.usage);
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const text = (data.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  if (!text) throw publicError('OpenAI boş cavab qaytardı', 502);
  return text;
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
