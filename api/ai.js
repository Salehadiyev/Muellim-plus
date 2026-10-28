// Müəllim+ · AI funksiyası (Vercel serverless)
// Lazım olan mühit dəyişənləri (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   — Claude API açarı
//   SUPABASE_URL        — Supabase layihə ünvanı
//   SUPABASE_ANON_KEY   — Supabase "anon public" açarı
//   ANTHROPIC_MODEL     — (istəyə bağlı) model adı

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
  const example = String(b.example || '').slice(0, 4000).trim();
  if (!topic && !example) throw publicError('Mövzunu yazın və ya nümunə sual əlavə edin');

  const exampleBlock = example ? `
Müəllim aşağıdakı nümunə sual(lar)ı verib. Yeni suallar eyni bacarığı, eyni çətinliyi, eyni üslubu və formatı izləsin,
amma hekayə, adlar və bütün rəqəmlər yeni olsun. Nümunədəki cümlələri köçürmə. Mövzu verilməyibsə, mövzunu nümunədən özün müəyyən et.
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
1) Tapşırığın mətnini olduğu kimi oxu (nömrəsini yazma). Riyazi ifadələri LaTeX ilə $...$ arasında yaz. Şəkildə bir neçə tapşırıq varsa, ən tam görünəni götür.
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
    text: String(data.text).slice(0, 3000),
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

async function askJSON(content) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: SYSTEM,
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
function fixLatex(v) {
  if (typeof v === 'string') {
    return v
      .replace(/\f/g, '\\f').replace(/\t/g, '\\t').replace(/\x08/g, '\\b').replace(/\r/g, '\\r')
      .replace(/\n(?=(eq|leq|geq|eg|ot|abla|e\b|i\b|u\b|mid|parallel|subseteq|ewline))/g, '\\n');
  }
  if (Array.isArray(v)) return v.map(fixLatex);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = fixLatex(v[k]);
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
