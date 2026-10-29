process.env.ANTHROPIC_API_KEY='a'; process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_ANON_KEY='a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
let gate; let aiCalled = 0;
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return gate();
  if (url.includes('/rest/v1/')) return { ok: true, text: async () => '' };
  aiCalled++; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"text":"t","analysis":{"complete":true}}' }], usage: {} }) };
};
const call = (b) => new Promise(r => mod.default({ method:'POST', headers:{authorization:'Bearer t'}, body:b }, { status(c){this.c=c;return this}, json(d){r([this.c,d])} }));
const body = { action: 'tryos_analyze', model: 'opus', image: 'data:image/jpeg;base64,QUJD' };
const j = (o, st = 200) => () => ({ ok: st < 300, status: st, json: async () => o, text: async () => JSON.stringify(o) });
for (const [name, g] of [
  ['no 008 (404)', j({ code: 'PGRST202', message: 'Could not find the function' }, 404)],
  ['approved, under limit', j({ approved: true, today: 0.5, daily_limit: 2, month: 3, monthly_limit: 20 })],
  ['not approved', j({ approved: false })],
  ['daily limit hit', j({ approved: true, today: 2.01, daily_limit: 2, month: 3, monthly_limit: 20 })],
  ['monthly limit hit', j({ approved: true, today: 0, daily_limit: 2, month: 20, monthly_limit: 20 })],
  ['gate error 500', j({ message: 'boom' }, 500)]]) {
  gate = g; aiCalled = 0; const [c, d] = await call(body);
  console.log(name.padEnd(22), c, '| AI called:', aiCalled, '|', d.error || 'ok');
}
