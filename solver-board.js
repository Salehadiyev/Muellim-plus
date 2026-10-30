import { createInk } from './solver-ink.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NS='http://www.w3.org/2000/svg';
export function mountWhiteboard(root,result,image){
  const $=s=>root.querySelector(s),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed=0,playing=false,raf=0,last=0,disposed=false,lastStage=-2;
  const durationFor=s=>Math.min(12000,Math.max(4500,(s.math.length+s.explanation.length)*65));
  const intro=Math.min(7000,Math.max(2500,result.question.length*35));
  let end=intro;const cues=result.steps.map(step=>{const start=end;end+=durationFor(step);return {start,end};});const duration=end+2200;
  $('#solverBoard').innerHTML=`<div class="solver-board-head"><strong>Həll lövhəsi</strong><span id="solverCounter" role="status"></span></div>
    <div id="solverQuestion" class="solver-question">${esc(result.question)}</div>
    <div class="solver-workspace"><figure class="solver-figure"><div class="solver-image-wrap"><img id="solverSource" alt="Sualın qrafiki və şərti"><svg id="solverMarks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg></div><figcaption>Sualın şəkli</figcaption></figure>
    <div class="solver-writing"><div id="solverSteps"></div><div id="solverAnswer" class="solver-answer" hidden><span>SON CAVAB</span><div>${esc(result.answer)}</div></div></div></div>`;
  $('#solverSource').src=image;
  const entries=result.steps.map((step,index)=>{
    const el=document.createElement('article');el.className='solver-step';el.hidden=true;
    el.innerHTML=`<span class="solver-step-number">${index+1}</span><div class="solver-step-content"><div class="solver-math"></div><p>${esc(step.explanation)}</p></div>`;
    const math=el.querySelector('.solver-math'),latex=step.math.trim().replace(/^\$+|\$+$/g,'');
    const ink=latex?createInk(math,latex):null;
    if(!ink)math.textContent=latex?`$$${latex}$$`:'';
    $('#solverSteps').append(el);
    return {el,math,ink,explanation:el.querySelector('p'),step};
  });
  const seek=$('#solverSeek');seek.max=String(duration);
  const time=ms=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
  function marks(index,p){
    const host=$('#solverMarks');
    if(index!==lastStage){host.replaceChildren();
      const list=result.steps[index]?.highlights||[];
      for(const mark of list.slice(0,6)){
        if(![mark.x,mark.y,mark.width,mark.height].every(Number.isFinite)||mark.x<0||mark.y<0||mark.width<=0||mark.height<=0||mark.x+mark.width>100||mark.y+mark.height>100)continue;
        const el=document.createElementNS(NS,'ellipse');el.setAttribute('cx',mark.x+mark.width/2);el.setAttribute('cy',mark.y+mark.height/2);el.setAttribute('rx',mark.width/2);el.setAttribute('ry',mark.height/2);el.setAttribute('pathLength','100');el.setAttribute('fill','none');el.setAttribute('stroke',['#d97706','#176bbb','#dc3636'][host.childElementCount%3]);el.setAttribute('stroke-width','2.5');el.setAttribute('vector-effect','non-scaling-stroke');el.style.strokeDasharray='100';
        const title=document.createElementNS(NS,'title');title.textContent=mark.label||'İzah olunan hissə';el.append(title);host.append(el);
      }
    }
    for(const el of host.children)el.style.strokeDashoffset=String(100*(1-Math.min(1,p*3)));
  }
  function render(){
    if(disposed)return;
    let current=-1;
    entries.forEach((entry,i)=>{const cue=cues[i],visible=elapsed>=cue.start;entry.el.hidden=!visible;if(!visible)return;current=i;
      const p=Math.max(0,Math.min(1,(elapsed-cue.start)/(cue.end-cue.start)));
      const inkProgress=Math.min(1,p/.65);entry.ink?.setProgress(inkProgress);
      if(!entry.ink)entry.math.style.clipPath=`inset(0 ${100*(1-inkProgress)}% 0 0)`;
      entry.explanation.style.opacity=p>.35?'1':'0';entry.el.classList.toggle('is-writing',p<.65);entry.el.classList.toggle('is-current',elapsed<cue.end);
    });
    $('#solverQuestion').style.clipPath=`inset(0 ${100*(1-Math.min(1,elapsed/(intro*.7)))}% 0 0)`;
    $('#solverAnswer').hidden=elapsed<end;
    $('#solverCounter').textContent=elapsed<intro?'Sualı lövhəyə köçürürük':`${Math.min(entries.length,current+1)} / ${entries.length} addım`;
    marks(current,current<0?0:Math.max(0,(elapsed-cues[current].start)/(cues[current].end-cues[current].start)));
    lastStage=current;seek.value=String(Math.round(elapsed));seek.setAttribute('aria-valuetext',`${time(elapsed)} / ${time(duration)}`);
    $('#solverTime').textContent=`${time(elapsed)} / ${time(duration)}`;
    $('#solverPause').textContent=playing?'Dayandır':'Davam et';$('#solverPause').disabled=elapsed>=duration;$('#solverNext').disabled=elapsed>=duration;
  }
  function frame(now){if(!playing||disposed)return;elapsed=Math.min(duration,elapsed+(now-last));last=now;if(elapsed>=duration)playing=false;render();if(playing)raf=requestAnimationFrame(frame);}
  function pause(){playing=false;cancelAnimationFrame(raf);render();}
  function play(){if(elapsed>=duration)return;playing=true;last=performance.now();render();raf=requestAnimationFrame(frame);}
  $('#solverPause').onclick=()=>playing?pause():play();
  $('#solverNext').onclick=()=>{pause();const next=cues.find(c=>c.end>elapsed+1);elapsed=next?next.end:duration;render();};
  $('#solverAll').onclick=()=>{pause();elapsed=duration;render();};
  $('#solverReplay').onclick=()=>{pause();elapsed=reduced?duration:0;render();if(!reduced)play();};
  seek.oninput=()=>{const value=Number(seek.value);pause();elapsed=value;render();};
  const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);
  // Hərəkəti azalt seçilibsə, cavab dərhal və tam görünür.
  if(reduced)elapsed=duration;render();if(!reduced)play();
  return ()=>{disposed=true;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibility);};
}
