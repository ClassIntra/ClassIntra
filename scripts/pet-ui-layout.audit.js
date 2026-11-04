(function(){
  var W = document.querySelector('.ci-pet-world').getBoundingClientRect();
  var rows = { back: 448, mid: 512, front: 578, wall: 382 };
  var out = [], bad = [];
  [].forEach.call(document.querySelectorAll('.world-obj'), function(o){
    var r = o.getBoundingClientRect();
    var row = o.getAttribute('data-row');
    var rec = { id: o.getAttribute('data-obj'), row: row,
      l: Math.round(r.left - W.left), r: Math.round(r.right - W.left),
      base: row === 'hang' ? null : Math.round(r.bottom - W.top - 5),
      w: Math.round(r.width) };
    if (rec.base !== null && rows[row] !== undefined) {
      rec.off = rec.base - rows[row];
      if (Math.abs(rec.off) > 2) bad.push(rec.id + ' 偏离地面线 ' + rec.off + 'px');
    }
    if (rec.l < -2 || rec.r > W.width + 2) bad.push(rec.id + ' 出画 (' + rec.l + '~' + rec.r + ')');
    out.push(rec);
  });
  // 同一行的横向重叠
  var byRow = {};
  out.forEach(function(o){ if (o.row !== 'hang' && o.row !== 'sit:desk' && o.row !== 'sit:shelf') (byRow[o.row] = byRow[o.row] || []).push(o); });
  Object.keys(byRow).forEach(function(k){
    var a = byRow[k].sort(function(x,y){return x.l-y.l;});
    for (var i=1;i<a.length;i++) if (a[i].l < a[i-1].r) bad.push('同一行重叠: ' + a[i-1].id + ' × ' + a[i].id + ' (' + (a[i-1].r - a[i].l) + 'px)');
  });
  return JSON.stringify({
    rows: rows,
    objs: out.map(function(o){return o.id + ' [' + o.row + '] l=' + o.l + ' r=' + o.r + ' base=' + o.base + (o.off ? ' off=' + o.off : '');}),
    problems: bad
  }, null, 1);
})()
