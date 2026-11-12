(async function(){
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function click(el){ if(!el) return; el.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  async function until(fn,ms){const t0=Date.now();while(Date.now()-t0<ms){let v=null;try{v=fn();}catch(e){}if(v)return v;await sleep(150);}return null;}
  await until(()=>q('.world-obj[data-obj="bed"]'),8000); click(q('.world-obj[data-obj="bed"]'));
  await until(()=>qa('button').filter(b=>(b.textContent||'').indexOf('换个样子')>=0)[0],5000);
  click(qa('button').filter(b=>(b.textContent||'').indexOf('换个样子')>=0)[0]);
  await until(()=>qa('.ci-pet-stylecard button').filter(b=>/去画一只|再改改|换回来/.test(b.textContent||''))[0],5000);
  click(qa('.ci-pet-stylecard button').filter(b=>/去画一只|再改改|换回来/.test(b.textContent||''))[0]);
  await until(()=>q('.ci-pet-editcanvas'),6000);
  await sleep(700);
  const cur = q('.ci-pet-curcolor');
  const dot = q('.ci-pet-curdot');
  const html = cur ? cur.outerHTML : null;
  const r = dot ? dot.getBoundingClientRect() : null;
  const cs = dot ? getComputedStyle(dot) : null;
  return JSON.stringify({ exists: !!dot, w: r && Math.round(r.width), h: r && Math.round(r.height),
    bg: cs && cs.backgroundColor, display: cs && cs.display, text: (q('.ci-pet-curtxt')||{}).textContent,
    hint: !!q('.ci-pet-emptyhint.is-on'), html: html });
})()
