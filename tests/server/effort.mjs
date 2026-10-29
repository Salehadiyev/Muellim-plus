// Sol: düşünmə səviyyəsi "low" göndərilir; model rədd etsə, ayarsız təkrar
process.env.OPENAI_API_KEY = 'o'; process.env.SUPABASE_URL = 'https://x'; process.env.SUPABASE_ANON_KEY = 'a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
const bodies = []; let reject = false;
const out = JSON.stringify({ text: 't', analysis: { complete: true } });
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) return { ok: true, text: async () => '' };
  const b = JSON.parse(opt.body); bodies.push(b.reasoning?.effort || 'none');
  if (reject && b.reasoning) return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { message: "Unsupported parameter: 'reasoning.effort'" } }) };
  return { ok: true, json: async () => ({ output_text: out, usage: {} }) };
};
const call = (b) => new Promise((r) => mod.default({ method: 'POST', headers: { authorization: 'Bearer t' }, body: b }, { status(c) { this.c = c; return this; }, json(d) { r([this.c, d]); } }));
let [c] = await call({ action: 'tryos_analyze', model: 'gpt-sol', image: 'data:image/jpeg;base64,QUJD' });
console.log('effort sent:', c, bodies.join('>'));
bodies.length = 0; reject = true;
[c] = await call({ action: 'tryos_analyze', model: 'gpt-sol', image: 'data:image/jpeg;base64,QUJD' });
console.log('effort rejected → retry:', c, bodies.join('>'));
