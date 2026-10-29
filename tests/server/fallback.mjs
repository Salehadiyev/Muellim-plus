process.env.ANTHROPIC_API_KEY='a'; process.env.OPENAI_API_KEY='o'; process.env.GEMINI_API_KEY='g'; process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_ANON_KEY='a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
const hits=[]; let anthropicBroke=true; const usage=[];
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) { usage.push(...JSON.parse(opt.body)); return { ok: true, text: async()=>'' }; }
  const prov = url.includes('anthropic') ? 'anthropic' : url.includes('openai') ? 'openai' : 'google'; hits.push(prov);
  const out = JSON.stringify({ text:'t', analysis:{ complete:true, topic:'X' } });
  if (prov==='anthropic' && anthropicBroke) return { ok:false, status:400, headers:{get:()=>null}, json: async()=>({error:{message:'Your credit balance is too low'}}) };
  if (prov==='openai') return { ok:true, json: async()=>({output_text: out, usage:{}}) };
  if (prov==='google') return { ok:true, json: async()=>({candidates:[{content:{parts:[{text:out}]}}], usageMetadata:{}}) };
  return { ok:true, json: async()=>({content:[{type:'text',text:out}],usage:{}}) };
};
const call = (b) => new Promise(r => mod.default({ method:'POST', headers:{authorization:'Bearer t'}, body:b }, { status(c){this.c=c;return this}, json(d){r([this.c,d])} }));
let [c,d] = await call({action:'tryos_analyze', model:'gpt-sol', image:'data:image/jpeg;base64,QUJD'});
console.log('Sol chosen, Claude broke →', c, d.analysis?.topic, '| tried:', hits.join('>'), '| usage rows:', usage.map(u=>u.model+'/'+u.role).join(','));
hits.length=0; usage.length=0; anthropicBroke=false;
[c,d] = await call({action:'tryos_analyze', model:'gpt-sol', image:'data:image/jpeg;base64,QUJD'});
console.log('Claude ok →', c, '| tried:', hits.join('>'));
hits.length=0; anthropicBroke=true; delete process.env.GEMINI_API_KEY; delete process.env.OPENAI_API_KEY;
[c,d] = await call({action:'tryos_analyze', model:'opus', image:'data:image/jpeg;base64,QUJD'});
console.log('only Claude, broke →', c, d.error);
