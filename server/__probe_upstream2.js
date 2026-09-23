// 临时诊断：upstream 缺参/坏参时的响应形态
var http = require('http');
function get(p) {
  return new Promise(function (resolve) {
    http.get('http://wjysrv.moyuzj.cn:29996' + p, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () {
        console.log('== ' + p.slice(0, 70) + ' -> HTTP ' + res.statusCode + ' | CT: ' + (res.headers['content-type'] || ''));
        console.log(b.slice(0, 160));
        resolve();
      });
    }).on('error', function (e) { console.log('== ' + p + ' -> ERR ' + e.message); resolve(); });
  });
}
(async function () {
  var ts = '&timestamp=' + Date.now();
  await get('/comment/music?limit=2' + ts);          // 缺 id
  await get('/song/url?timestamp=' + Date.now());    // 缺 id
  await get('/song/detail?timestamp=' + Date.now()); // 缺 ids
  await get('/lyric?timestamp=' + Date.now());       // 缺 id
  await get('/search?keywords=%20%20' + ts);         // 空白关键词
  await get('/like?id=1&like=true' + ts);            // 未登录 like
})();
