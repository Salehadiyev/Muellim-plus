process.env.GEMINI_API_KEY='g'; process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_ANON_KEY='a';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
const bodies=[]; let reject=true;
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) return { ok: true, text: async()=>'' };
  const b=JSON.parse(opt.body); bodies.push(b.generationConfig);
  if (reject && b.generationConfig.thinkingConfig) return { ok:false, status:400, headers:{get:()=>null}, json: async()=>({error:{message:'thinking_level is not supported'}}) };
  return { ok:true, json: async()=>({candidates:[{content:{parts:[{text:JSON.stringify({text:'t',analysis:{complete:true}})}]}}], usageMetadata:{}}) };
};
const call = (b) => new Promise(r => mod.default({ method:'POST', headers:{authorization:'Bearer t'}, body:b }, { status(c){this.c=c;return this}, json(d){r([this.c,d])} }));
let [c,d]=await call({action:'tryos_analyze', model:'gemini-flash', image:'data:image/jpeg;base64,QUJD'});
console.log('gemini rejects thinkingLevel →', c, '| configs:', bodies.map(x=>x.thinkingConfig?'low':'default').join('>'), '| helper:', d._helper);
bodies.length=0; reject=false;
[c,d]=await call({action:'tryos_analyze', model:'gemini-flash', image:'data:image/jpeg;base64,QUJD'});
console.log('gemini accepts →', c, bodies.map(x=>x.thinkingConfig?'low':'default').join('>'));
