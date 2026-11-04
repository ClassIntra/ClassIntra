// 隧道专用网关：公网（frpc）入口只放行 登录+云盘 API 与轻量上传/下载页
// frpc 两条隧道均指向本网关（127.0.0.1:10111），API 按白名单流式转发到主服务（127.0.0.1:9001）
// 教室局域网仍直连主服务端口，不经过本网关，功能不受影响
var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = parseInt(process.env.TUNNEL_GATEWAY_PORT, 10) || 10111;
var UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT, 10) || 9001;
var UPSTREAM_HOST = '127.0.0.1';

// 公网专属轻量页（独立单文件，零依赖）——隧道内无论访问什么网址都只得到它，
// 杜绝 Vue 大应用（超能岛等页面、字体、主题）经隧道被加载；按 mtime 缓存，改文件即生效
var LITE_PAGE = path.join(__dirname, '../public/cloud-lite.html');
var liteCache = null;
function litePage() {
  try {
    var mtime = fs.statSync(LITE_PAGE).mtimeMs;
    if (!liteCache || liteCache.mtime !== mtime) {
      liteCache = { mtime: mtime, body: fs.readFileSync(LITE_PAGE) };
    }
    return liteCache.body;
  } catch (e) {
    return null;
  }
}

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

  // —— API：白名单流式转发（支持大文件上传与 Range 断点下载），其余 403 ——
  if (url.indexOf('/api/') === 0) {
    if (!isAllowedApi(url)) {
      // 403（而非 401）：401 会触发前端登出逻辑，403 仅静默失败
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 403, message: '公网入口仅开放登录与云盘上传/下载' }));
      return;
    }

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
    return;
  }

  // —— 非 API：隧道内一律只提供轻量页（任何网址都不落 Vue 大应用） ——
  if (req.method === 'GET' || req.method === 'HEAD') {
    var lite = litePage();
    if (lite) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(lite);
    } else {
      // 轻量页文件缺失时的兜底：退回 SPA 的 /cloud-lite
      res.writeHead(302, { Location: '/cloud-lite' });
      res.end();
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code: 404, message: 'Not Found' }));
});

// 无 'upgrade' 监听：WebSocket 升级请求（聊天/实时）到此即被断开
// 侦听失败要说人话：
//   EACCES     = 端口被别的程序占用（Windows 常见）或落在系统保留范围
//   EADDRINUSE = 端口已被占用
// 之前没有 error 处理，异常直接冒泡成「未捕获异常」，PM2 只看到崩溃计数、
// 日志里全是堆栈，没人知道只是端口冲突 —— 曾因此空转 150+ 次重启。
server.on('error', function (err) {
  var code = err && err.code;
  if (code === 'EACCES') {
    console.error('[TunnelGateway] 端口 ' + PORT + ' 侦听被拒绝（EACCES）：' +
      '多半已被其他程序占用，或落在 Windows 保留端口范围内。' +
      '请换一个 TUNNEL_GATEWAY_PORT（并同步改 frpc.ini 的 local_port）。');
  } else if (code === 'EADDRINUSE') {
    console.error('[TunnelGateway] 端口 ' + PORT + ' 已被占用（EADDRINUSE）。');
  } else {
    console.error('[TunnelGateway] 侦听失败:', (err && err.message) || err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('[TunnelGateway] 127.0.0.1:' + PORT + ' -> 127.0.0.1:' + UPSTREAM_PORT + '（白名单: ' + ALLOWED_API_PREFIXES.join(', ') + '，页面: cloud-lite.html）');
});
