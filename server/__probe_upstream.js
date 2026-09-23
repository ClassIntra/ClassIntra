// 临时诊断：实测 upstream 各模块在异常/边界参数下的响应
var http = require('http');
function get(p) {
  return new Promise(function (resolve) {
    http.get('http://wjysrv.moyuzj.cn:29996' + p, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () {
        console.log('== ' + p.slice(0, 80) + ' -> HTTP ' + res.statusCode);
        console.log(b.slice(0, 200));
        resolve();
      });
    }).on('error', function (e) { console.log('== ' + p + ' -> ERR ' + e.message); resolve(); });
  });
}
(async function () {
  var ts = '&timestamp=' + Date.now();
  await get('/comment/music?id=37877892&limit=2' + ts);
  await get('/lyric?id=37877892' + ts);
  await get('/song/detail?ids=37877892' + ts);
  await get('/likelist?uid=0' + ts);
  await get('/search?keywords=&timestamp=' + Date.now());
  await get('/toplist' + ts);
})();
