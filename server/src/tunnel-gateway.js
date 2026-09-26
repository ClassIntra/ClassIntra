// 隧道专用网关：公网（frpc）入口只放行登录与云盘上传/下载，其余 API 一律 403
// frpc 两条隧道均指向本网关（127.0.0.1:9002），网关按白名单转发到主服务（127.0.0.1:9001）
// 教室局域网仍直连主服务端口，不经过本网关，功能不受影响
var http = require('http');

var PORT = parseInt(process.env.TUNNEL_GATEWAY_PORT, 10) || 9002;
var UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT, 10) || 9001;
var UPSTREAM_HOST = '127.0.0.1';

// API 白名单：/api/auth/ 登录、登出、状态检查；/api/cloud/ 云盘文件、上传码、分组
var ALLOWED_API_PREFIXES = ['/api/auth/', '/api/cloud/'];

function isAllowedApi(url) {
  for (var i = 0; i < ALLOWED_API_PREFIXES.length; i++) {
    if (url.indexOf(ALLOWED_API_PREFIXES[i]) === 0) return true;
  }
  return false;
}

var server = http.createServer(function (req, res) {
  var url = req.url || '/';

  if (url.indexOf('/api/') === 0 && !isAllowedApi(url)) {
    // 403（而非 401）：401 会触发前端登出逻辑，403 仅静默失败
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 403, message: '公网入口仅开放登录与云盘上传/下载' }));
    return;
  }

  // 流式转发：支持大文件上传与 Range 断点下载
  var proxied = http.request({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: url,
    headers: req.headers
  }, function (upRes) {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });

  proxied.on('error', function () {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 502, message: '主服务不可用' }));
    } else {
      res.end();
    }
  });

  req.pipe(proxied);
});

// 无 'upgrade' 监听：WebSocket 升级请求（聊天/实时）到此即被断开
server.listen(PORT, '127.0.0.1', function () {
  console.log('[TunnelGateway] 127.0.0.1:' + PORT + ' -> 127.0.0.1:' + UPSTREAM_PORT + '（白名单: ' + ALLOWED_API_PREFIXES.join(', ') + '）');
});
