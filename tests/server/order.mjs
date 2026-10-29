// Köməkçi model sırası: Claude → seçilən model → digərləri (Gemini sonda); 429-da gözləmədən keçid
process.env.ANTHROPIC_API_KEY = 'a'; process.env.OPENAI_API_KEY = 'o'; process.env.GEMINI_API_KEY = 'g'; process.env.SUPABASE_URL = 'https://x'; process.env.SUPABASE_ANON_KEY = 'a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
const hits = []; let mode = {};
const out = JSON.stringify({ text: 't', analysis: { complete: true, topic: 'X' } });
globalThis.fetch = async (url) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) return { ok: true, text: async () => '' };
  const prov = url.includes('anthropic') ? 'anthropic' : url.includes('openai') ? 'openai' : 'google'; hits.push(prov);
  const st = mode[prov];
  if (st) return { ok: false, status: st, headers: { get: () => null }, json: async () => ({ error: { message: st === 400 ? 'credit balance is too low' : 'rate limit' } }) };
  if (prov === 'openai') return { ok: true, json: async () => ({ output_text: out, usage: {} }) };
  if (prov === 'google') return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: out }] } }], usageMetadata: {} }) };
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: out }], usage: {} }) };
};
const call = (b) => new Promise((r) => mod.default({ method: 'POST', headers: { authorization: 'Bearer t' }, body: b }, { status(c) { this.c = c; return this; }, json(d) { r([this.c, d]); } }));
const body = (model) => ({ action: 'tryos_analyze', model, image: 'data:image/jpeg;base64,QUJD' });
mode = { anthropic: 400 }; hits.length = 0;
let [c, d] = await call(body('gpt-sol')); console.log('Sol chosen, no Claude →', c, d._helper, '| tried:', hits.join('>'));
const t0 = Date.now(); mode = { anthropic: 400, openai: 429 }; hits.length = 0;
[c, d] = await call(body('gpt-sol')); console.log('Sol 429 →', c, d._helper, '| tried:', hits.join('>'), '| fast:', Date.now() - t0 < 2000);
