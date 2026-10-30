import { glyphs } from './solver-glyphs.js';
const NS='http://www.w3.org/2000/svg';
// Sadə düsturlar həqiqi qələm izləri ilə çəkilir. Dəstəklənməyən LaTeX dəyişdirilmir.
export function createInk(host, source) {
  let pos=0, budget=0;
  const text=source.trim().replace(/^\$+|\$+$/g,'').replace(/\\(?:left|right)\b/g,'').replace(/\s+/g,'');
  const shift=(b,x,y,s=1)=>b.paths.map(p=>p.map(([a,c])=>[a*s+x,c*s+y]));
  function group(depth){if(text[pos]==='{'){pos++;return row('}',depth+1);}return atom(depth+1);}
  function atom(depth){
    if(depth>12||++budget>250)throw Error('complex');
    let ch=text[pos++],b;
    if(ch==='\\'){
      const m=text.slice(pos).match(/^[a-zA-Z]+/);if(!m)throw Error('command');pos+=m[0].length;
      if(m[0]==='frac'){
        const a=group(depth),c=group(depth),w=Math.max(a.w,c.w)*.78+.3;
        const ah=(a.bottom-a.top)*.78,ch=(c.bottom-c.top)*.78;
        b={w,top:-ah-.12,bottom:ch+.22,paths:[...shift(a,(w-a.w*.78)/2,-.12-a.bottom*.78,.78),[[.04,0],[w-.04,0]],...shift(c,(w-c.w*.78)/2,.22-c.top*.78,.78)]};
      }else if(m[0]==='sqrt'){
        const a=group(depth),top=Math.min(-.1,a.top-.15);
        b={w:a.w+.75,top,bottom:Math.max(1,a.bottom),paths:[[[0,.5],[.15,.4],[.32,1],[.58,top],[a.w+.73,top]],...shift(a,.7,0)]};
      }else {const map={ge:'≥',geq:'≥',circ:'○',cdot:'.',times:'x'};ch=map[m[0]];if(!ch)throw Error('command');}
    }
    if(!b){if(ch==='{'||ch==='}'||!glyphs[ch])throw Error('glyph');b={w:({'(': .62,')':.62,'1':.82,',':.5,'.':.5}[ch]||.92),top:0,bottom:1.25,paths:glyphs[ch]};}
    while(text[pos]==='^'||text[pos]==='_'){
      const sub=text[pos++]==='_',a=group(depth),y=sub?.85:-.55;
      b={w:b.w+a.w*.55,top:Math.min(b.top,a.top*.55+y),bottom:Math.max(b.bottom,a.bottom*.55+y),paths:[...b.paths,...shift(a,b.w,y,.55)]};
    }
    return b;
  }
  function row(end='',depth=0){
    let b={w:0,top:0,bottom:1.25,paths:[]};
    while(pos<text.length&&text[pos]!==end){const a=text[pos]==='{'?(pos++,row('}',depth+1)):atom(depth);b.paths.push(...shift(a,b.w,0));b.w+=a.w;b.top=Math.min(b.top,a.top);b.bottom=Math.max(b.bottom,a.bottom);}
    if(end&&text[pos++]!==end)throw Error('group');return b;
  }
  let box;try{box=row();if(!box.paths.length||pos!==text.length||box.w>45)return null;}catch(_){return null;}
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`-.1 ${box.top-.1} ${box.w+.2} ${box.bottom-box.top+.2}`);
  svg.setAttribute('aria-label',source);svg.setAttribute('role','img');svg.classList.add('solver-ink');svg.style.width=`${box.w*32}px`;svg.style.height=`${(box.bottom-box.top+.2)*32}px`;
  let total=0;const paths=box.paths.map(points=>{const el=document.createElementNS(NS,'path');el.setAttribute('d',points.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' '));el.setAttribute('fill','none');el.setAttribute('stroke','currentColor');el.setAttribute('stroke-width','.055');el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');const len=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);const start=total;total+=len;el.style.strokeDasharray=`${len} ${len}`;svg.append(el);return {el,len,start};});
  host.replaceChildren(svg);host.classList.add('no-math');
  return {setProgress(p){for(const {el,len,start} of paths)el.style.strokeDashoffset=String(len-Math.max(0,Math.min(len,p*total-start)));}};
}
