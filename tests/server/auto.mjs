// Avtomatik test üçün server: extract (want → match + çətinlik, boş səhifə səhv deyil) və tryos_plan (mix → dəqiq bölgü)
process.env.ANTHROPIC_API_KEY = 'a'; process.env.SUPABASE_URL = 'https://x'; process.env.SUPABASE_ANON_KEY = 'a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
let next = ''; const prompts = [];
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) return { ok: true, text: async () => '' };
  const b = JSON.parse(opt.body); prompts.push(JSON.stringify(b.messages));
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: next }], usage: {} }) };
};
const call = (b) => new Promise((r) => mod.default({ method: 'POST', headers: { authorization: 'Bearer t' }, body: b }, { status(c) { this.c = c; return this; }, json(d) { r([this.c, d]); } }));
const img = 'data:image/jpeg;base64,QUJD';
next = JSON.stringify({ questions: [{ text: 'a', topic: 'Fonksiyonlar', difficulty: 'çətin', match: true, box: [1, 2, 3, 4] }, { text: 'b', topic: 'Kümeler', difficulty: 'xyz', match: 'yes', box: [1, 2, 3, 4] }] });
let [c, d] = await call({ action: 'extract', split: true, want: 'Fonksiyonlar"`$', image: img });
console.log('extract want:', c, d.questions.map((q) => q.difficulty + '/' + q.match).join(','), '| prompt clean:', prompts.at(-1).includes('\\"Fonksiyonlar\\" mövzusuna') && !prompts.at(-1).includes('Fonksiyonlar\\"`'));
next = JSON.stringify({ questions: [] });
[c, d] = await call({ action: 'extract', split: true, want: 'Fonksiyonlar', image: img }); console.log('empty page with want:', c, d.questions.length);
[c] = await call({ action: 'extract', split: true, image: img }); console.log('empty page without want:', c);
next = JSON.stringify({ plan: [{ subtype: 's1', idea: 'i1', topic: 'F', difficulty: 'çətin' }, { subtype: 's2', idea: 'i2', topic: 'F', difficulty: 'asan' }], notes: '' });
[c, d] = await call({ action: 'tryos_plan', topic: 'Fonksiyonlar', mix: { asan: 2, orta: 1, cetin: 2 } });
console.log('plan mix:', c, d.plan.length, d.plan.map((p) => p.difficulty).join(','), '| prompt:', prompts.at(-1).includes('2 asan, 1 orta, 2 çətin'));
[c] = await call({ action: 'tryos_plan', topic: 'F', mix: { asan: 30, orta: 20, cetin: 0 } }); console.log('plan too many:', c);
