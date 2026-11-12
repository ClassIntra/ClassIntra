(function () {
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function click(el){ if(!el) return; el.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
  function wait(fn, t, cb){ var t0=Date.now(); (function p(){ var v=null; try{v=fn();}catch(e){} if(v) return cb(v); if(Date.now()-t0>t) return cb(null); setTimeout(p,150); })(); }
  wait(function(){return q('.world-obj[data-obj="bed"]');},8000,function(bed){
    click(bed);
    wait(function(){ return qa('button').filter(function(b){return (b.textContent||'').indexOf('换个样子')>=0;})[0]; },5000,function(look){
      click(look);
      wait(function(){ return qa('.ci-pet-stylecard button').filter(function(b){return /去画一只|再改改|换回来/.test(b.textContent||'');})[0]; },5000,function(en){
        click(en);
        wait(function(){ return q('.ci-pet-editcanvas'); },6000,function(){
          setTimeout(function(){
            var b64 = qa('.ci-pet-seg-btn').filter(function(b){return b.textContent==='64×64';})[0];
            click(b64);
            setTimeout(function(){
              var zin = qa('.ci-pet-zoombtn').filter(function(b){return b.textContent==='+';})[0];
              click(zin);
              setTimeout(function(){ click(zin); }, 300);
              setTimeout(function(){
                var pan = qa('.ci-pet-toolgrid .ci-pet-btn').filter(function(b){return b.textContent==='抓手';})[0];
                click(pan);
                // 画几颗豆，便于看缩放后的清晰度
                var cv=q('.ci-pet-editcanvas'), r=cv.getBoundingClientRect(), n=64, c=r.width/n;
                var sw=qa('.ci-pet-swatchbox')[4]; if(sw) click(sw);
                for(var i=0;i<12;i++){
                  var x=r.left+(8+i)*c+c/2, y=r.top+(8+i)*c+c/2;
                  cv.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',clientX:x,clientY:y,buttons:1}));
                  cv.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',clientX:x,clientY:y,buttons:0}));
                }
                document.body.setAttribute('data-shot', 'shot64');
              },1200);
            },350);
          },500);
        });
      });
    });
  });
})();
