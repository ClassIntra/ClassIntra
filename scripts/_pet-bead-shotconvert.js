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
            var s48 = qa('.ci-pet-seg-btn').filter(function(b){return b.textContent==='48×48';})[0];
            if (s48) click(s48);
            setTimeout(function(){
              // 合成一张「照片感」的图：渐变天空 + 太阳 + 远山 + 人物（肤色/头发/衣服）+ 草地
              var c = document.createElement('canvas');
              c.width = c.height = 240;
              var g = c.getContext('2d');
              var sky = g.createLinearGradient(0, 0, 0, 150);
              sky.addColorStop(0, '#5FB4EA');
              sky.addColorStop(1, '#DDF2FF');
              g.fillStyle = sky; g.fillRect(0, 0, 240, 240);
              g.fillStyle = '#FFD84A';
              g.beginPath(); g.arc(186, 52, 22, 0, Math.PI * 2); g.fill();
              g.fillStyle = 'rgba(255,216,74,0.35)';
              g.beginPath(); g.arc(186, 52, 34, 0, Math.PI * 2); g.fill();
              g.fillStyle = '#4E8B3A';
              g.beginPath(); g.moveTo(0, 150); g.quadraticCurveTo(70, 96, 140, 150); g.lineTo(0, 170); g.fill();
              g.fillStyle = '#3A6B2C';
              g.beginPath(); g.moveTo(120, 160); g.quadraticCurveTo(190, 112, 240, 158); g.lineTo(240, 180); g.lineTo(120, 180); g.fill();
              g.fillStyle = '#6FBF4A'; g.fillRect(0, 168, 240, 72);
              // 人物
              g.fillStyle = '#2B2320';
              g.beginPath(); g.arc(96, 132, 26, Math.PI, 0); g.fill();
              g.fillStyle = '#E8B48A';
              g.beginPath(); g.arc(96, 142, 22, 0, Math.PI * 2); g.fill();
              g.fillStyle = '#2B2320';
              g.fillRect(92, 146, 3, 3); g.fillRect(102, 146, 3, 3);
              g.fillStyle = '#C96A5A';
              g.fillRect(88, 154, 16, 4);
              g.fillStyle = '#2F6FD0';
              g.fillRect(70, 166, 52, 60);
              g.fillStyle = '#E8B48A';
              g.fillRect(60, 172, 10, 34); g.fillRect(122, 172, 10, 34);
              // 轻微噪点，更像照片
              var img = g.getImageData(0, 0, 240, 240);
              for (var i = 0; i < img.data.length; i += 4) {
                var n = (Math.random() - 0.5) * 10;
                img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
              }
              g.putImageData(img, 0, 0);
              var h = window.__ciBeadImport(c.toDataURL(), { dropBg: true, maxColors: 16, enhance: true, dither: false });
              var t0 = Date.now();
              (function w(){
                if ((h && h.done()) || Date.now() - t0 > 5000) {
                  document.body.setAttribute('data-shot', 'convert');
                  return;
                }
                setTimeout(w, 100);
              })();
            }, 400);
          }, 500);
        });
      });
    });
  });
})();
