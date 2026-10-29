process.env.ANTHROPIC_API_KEY='a'; process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_ANON_KEY='a'; process.env.OPENAI_API_KEY='o';
const mod = await import(new URL('../../api/ai.js', import.meta.url).href + '?' + Date.now());
let replies=[]; const sent=[];
const svg=(k)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="${k}" cy="50" r="10"/></svg>`;
globalThis.fetch = async (url, opt) => {
  if (url.includes('/auth/')) return { ok: true, json: async () => ({ id: 'u' }) };
  if (url.includes('/rpc/ai_gate')) return { ok: false, status: 404, text: async () => 'PGRST202' };
  if (url.includes('/rest/v1/')) return { ok: true, text: async()=>'' };
  const b=JSON.parse(opt.body); sent.push(b); const r=replies.shift();
  const text = typeof r==='function' ? r(b) : r;
  if (url.includes('openai')) return { ok:true, json: async()=>({output_text:text,usage:{}}) };
  return { ok:true, json: async()=>({content:[{type:'text',text}],usage:{}}) };
};
const call = (b) => new Promise(r => mod.default({ method:'POST', headers:{authorization:'Bearer t'}, body:b }, { status(c){this.c=c;return this}, json(d){r([this.c,d])} }));
const img='data:image/jpeg;base64,QUJD';
// analyze
replies=[JSON.stringify({text:'Soru işaretinin yerine hangi şekil gelir? [Şekil: 5 kadr]',analysis:{section:'sayisal',family:'Şekil dizisi',rule_hidden:true,options_are_figures:true,figure_required:true,complete:false,uncertain:['3-cü kadr bulanıq'],preserve:['kadrlı ardıcıllıq','qayda gizli']}})];
let [c,d]=await call({action:'tryos_analyze',model:'opus',image:img,text:'',topic:'',section:'sayisal'});
console.log('analyze', c, d.analysis.family, d.analysis.complete, d.analysis.uncertain, '| sent img:', JSON.stringify(sent[0].messages[0].content[0]).includes('QUJD'), '| model:', sent[0].model);
const analysis=d.analysis;
// generate: one valid, one with 4 option figures, one missing main figure
sent.length=0;
replies=[JSON.stringify({questions:[
 {sample:0,body:'Soru işaretinin yerine hangi şekil gelir?',figure:svg(1),options:['A','B','C','D','E'],option_figures:[svg(1),svg(2),svg(3),svg(4),svg(5)],correct_index:2,solution:'s'},
 {sample:0,body:'x',figure:svg(1),options:['A','B','C','D','E'],option_figures:[svg(1),svg(2),svg(3),svg(4)],correct_index:1},
 {sample:0,body:'y',figure:'',options:['A','B','C','D','E'],option_figures:[svg(1),svg(2),svg(3),svg(4),svg(5)],correct_index:1},
 {sample:0,body:'z',figure:svg(1),options:['A','B','C','D','E'],option_figures:[svg(1),svg(1),svg(3),svg(4),svg(5)],correct_index:1}]})];
[c,d]=await call({action:'tryos_from_examples',model:'gpt-sol',mode:'benzer',perSample:2,samples:[{text:'t',image:img,topic:'Şekil dizisi',section:'sayisal',analysis}],avoid:['old q'],feedback:'qayda açıqlandı'});
const p=sent[0].instructions?sent[0]:null; const inp=JSON.stringify(sent[0].input);
console.log('gen', c, 'kept', d.questions.length, '| rejected:', JSON.stringify(d.rejected.map(r=>r.reason)));
console.log('prompt has: mode', inp.includes('Rejim: BƏNZƏR'), '| analysis', inp.includes('Qayda şagirddən gizlidir'), '| avoid', inp.includes('old q'), '| feedback', inp.includes('qayda açıqlandı'), '| image', inp.includes('QUJD'), '| no-dup-line(benzer,2)', inp.includes('sadəcə ədəd dəyişdirilmiş surəti'));
replies=[JSON.stringify({questions:[{sample:0,body:'q',figure:svg(1),options:['A','B','C','D','E'],option_figures:[svg(1),svg(2),svg(3),svg(4),svg(5)],correct_index:0}]})]; sent.length=0;
await call({action:'tryos_from_examples',model:'opus',mode:'izomorf',perSample:2,samples:[{text:'t',analysis}]});
console.log('izomorf omits dup rule:', !JSON.stringify(sent[0].messages).includes('sadəcə ədəd dəyişdirilmiş surəti'));
// verify: blind disagrees; fit ok
sent.length=0;
replies=[ (b)=>JSON.stringify(b.system[0].text.includes('redaktor')?{mode_ok:true,family_ok:true,skill_ok:true,difficulty:'eyni',rule_revealed:false,key_matches_solution:true,text_figure_consistent:true,issues:[]}:{index:1,unique:true,sufficient:true,consistent:true,issues:[]}),
          (b)=>JSON.stringify(b.system[0].text.includes('redaktor')?{mode_ok:true,family_ok:true,skill_ok:true,difficulty:'eyni',rule_revealed:false,key_matches_solution:true,text_figure_consistent:true,issues:[]}:{index:1,unique:true,sufficient:true,consistent:true,issues:[]}) ];
[c,d]=await call({action:'verify',model:'opus',mode:'benzer',sample:{text:'t',image:img,analysis},questions:[{body:'q',options:['A','B','C','D','E'],answer:'C',figure:svg(1),option_figures:[],render:img,solution:'s'}]});
console.log('verify disagree ->', d.results[0].ok, '|', d.results[0].correct.issues[0], '| fit ok', d.results[0].fit.ok, '| verify sent images:', sent.map(s=>(JSON.stringify(s.messages).match(/QUJD/g)||[]).length).join(','));
// verify: agree but rule revealed
replies=[ (b)=>JSON.stringify(b.system[0].text.includes('redaktor')?{mode_ok:true,family_ok:true,skill_ok:true,difficulty:'aşağı',rule_revealed:true,key_matches_solution:true,text_figure_consistent:true,issues:[]}:{index:2,unique:true,sufficient:true,consistent:true,issues:[]}),
          (b)=>JSON.stringify(b.system[0].text.includes('redaktor')?{mode_ok:true,family_ok:true,skill_ok:true,difficulty:'aşağı',rule_revealed:true,key_matches_solution:true,text_figure_consistent:true,issues:[]}:{index:2,unique:true,sufficient:true,consistent:true,issues:[]}) ];
[c,d]=await call({action:'verify',model:'opus',mode:'benzer',sample:{text:'t',analysis},questions:[{body:'q',options:['A','B','C','D','E'],answer:'C',figure:svg(1),render:img,solution:'s'}]});
console.log('verify fit fail ->', d.results[0].ok, '| correct', d.results[0].correct.ok, '| fit', JSON.stringify(d.results[0].fit.issues));
// verify: figure but no render
replies=[JSON.stringify({index:2,unique:true,sufficient:true,consistent:true,issues:[]}), JSON.stringify({key_matches_solution:true,text_figure_consistent:true,issues:[]})];
[c,d]=await call({action:'verify',model:'opus',questions:[{body:'q',options:['A','B','C','D','E'],answer:'C',figure:svg(1),solution:'s'}]});
console.log('no render ->', d.results[0].ok, JSON.stringify(d.results[0].correct.issues));
