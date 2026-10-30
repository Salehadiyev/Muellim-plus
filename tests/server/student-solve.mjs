import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test';process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_ANON_KEY='anon';process.env.OPENAI_MODEL='configured-sol';
const {default:handler}=await import('../../api/student-solve.js');
const valid={code:'ALI23456',image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,1]).toString('base64'),model:'opus'};
const solved={readable:true,question:'$2x=8$',steps:[{math:'x=4',explanation:'Hər tərəfi 2-yə bölürük.'}],answer:'$4$',notice:''};
let output=solved, mode='',calls=[],finishes=[];
globalThis.fetch=async(url,opt)=>{
 const body=JSON.parse(opt.body);calls.push({url,body});
 if(url.includes('student_ai_reserve')){
  if(mode==='denied')return {ok:false,status:400,json:async()=>({message:'Tələbə linki etibarsızdır'})};
  if(mode==='limit')return {ok:false,status:400,json:async()=>({message:'Gündəlik 3 sual limitin dolub'})};
  if(mode==='missing')return {ok:false,status:404,json:async()=>({code:'PGRST202'})};
  return {ok:true,json:async()=>({ticket:'private-ticket',remaining:2})};
 }
 if(url.includes('student_ai_finish')){finishes.push(body);return {ok:true,json:async()=>null};}
 return {ok:true,json:async()=>({status:mode==='incomplete'?'incomplete':'completed',output_text:mode==='badjson'?'bad':JSON.stringify(output),usage:{input_tokens:100,output_tokens:200,input_tokens_details:{cached_tokens:50}}})};
};
const call=async b=>{let status=0,value;await handler({method:'POST',body:b},{setHeader(){},status(n){status=n;return this;},json(v){value=v;}});return {status,value};};
let r=await call(valid);assert.equal(r.status,200);assert.equal(r.value.model,undefined);assert.equal(r.value.steps.length,1);assert(!JSON.stringify(r.value).includes('private-ticket'));
const modelCall=calls.find(x=>x.url.includes('openai'));assert.equal(modelCall.body.model,'configured-sol');assert.equal(modelCall.body.store,false);assert.equal(modelCall.body.text.format.strict,true);assert(!JSON.stringify(modelCall.body).includes('ALI23456'));assert.equal(finishes.length,1);
console.log('Sol only, structured steps, private ticket and usage ok');
for(const [m,status] of [['denied',403],['limit',429],['missing',503]]){mode=m;calls=[];r=await call(valid);assert.equal(r.status,status);assert(!calls.some(x=>x.url.includes('openai')));}
console.log('invalid code, daily limit and missing migration block AI');
mode='';output={readable:false,notice:'Şəkil oxunmur',question:'',steps:[],answer:''};r=await call(valid);assert.equal(r.status,200);assert.equal(r.value.readable,false);assert.equal(r.value.steps,undefined);
output={...solved,steps:[]};assert.equal((await call(valid)).status,502);
output=solved;mode='incomplete';assert.equal((await call(valid)).status,502);mode='badjson';assert.equal((await call(valid)).status,502);
mode='';calls=[];assert.equal((await call({...valid,image:'data:image/jpeg;base64,QUJD'})).status,400);assert.equal(calls.length,0);
console.log('unreadable image, incomplete solution and invalid image handled');
