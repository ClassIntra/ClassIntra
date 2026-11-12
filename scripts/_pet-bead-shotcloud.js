(function () {
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function click(el){ if(!el) return; el.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
  function wait(fn,t,cb){var t0=Date.now();(function p(){var v=null;try{v=fn();}catch(e){}if(v)return cb(v);if(Date.now()-t0>t)return cb(null);setTimeout(p,150);})();}
  wait(function(){return q('.world-obj[data-obj="bed"]');},8000,function(bed){
    click(bed);
    wait(function(){return qa('button').filter(function(b){return (b.textContent||'').indexOf('换个样子')>=0;})[0];},5000,function(look){
      click(look);
      wait(function(){return qa('.ci-pet-stylecard button').filter(function(b){return /去画一只|再改改|换回来/.test(b.textContent||'');})[0];},5000,function(en){
        click(en);
        wait(function(){return q('.ci-pet-editcanvas');},6000,function(){
          setTimeout(function(){
            var imp=qa('button').filter(function(b){return /导入图片/.test(b.textContent||'');})[0];
            click(imp);
            wait(function(){return q('.ci-pet-cloudtile');},6000,function(){ document.body.setAttribute('data-shot', 'shotcloud'); });
          },500);
        });
      });
    });
  });
})();
