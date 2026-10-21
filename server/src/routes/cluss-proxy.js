// Cluss 同源反代（ClassIntra 侧，挂到 /cluss-app 前缀）
//
// 为什么前缀不叫 /cluss：ClassIntra 自己的应用壳路由就是 /cluss
// （apps/cluss/manifest.json 里 route: '/cluss'，history 模式，
//  由 app.get('*') 兜底返回 index.html）。反代若占这个名字，
//  学生点桌面图标打开的应用壳会被反代截走，整个功能直接消失。
//  所以另起一个绝不冲突的前端命名空间。
//
// 反代路径与 Cluss 的对应关系：
//   /cluss-app/            → /              Cluss 首页
//   /cluss-app/api/xxx     → /api/xxx       Cluss 接口
//   /cluss-app/assets/xx   → /assets/xx     构建产物
//   /cluss-app             → 302 /cluss-app/（地址稳定 + 资源相对解析标准形态）
//
// ---- 为什么需要它 ----
// ClassIntra 开 HTTPS 后，「应用壳里 iframe 一个 http://<host>:9003 的 Cluss」
// 会被浏览器按**混合内容**直接拦掉（HTTPS 页面里的 HTTP 子资源一律拒绝，
// iframe 属于 active mixed content，没有任何开关能放行）。
// 于是 Cluss 应用在 HTTPS 下只剩「新窗口打开」这条降级路 —— 学生在壳里
// 点一下就被扔到另一个没有导航的裸页面，回不来。
//
// 解法：让 HTTPS 站点**同源**反代 Cluss。iframe 指向 /cluss-app/，
// 浏览器看到的就是同一个 https://<host>，混合内容问题从根上消失。
//
// ---- 为什么挂在 server 层而不是 app.use ----
// 1. Cluss 的对话/批改/写作全是 SSE 长连接（/api/chat/stream 等）。
//    express 的 compression 中间件会包装 res，流式响应经过它有可能被攒着不发，
//    学生看到的就是「转圈半天不出字」。反代必须绕过所有 express 中间件。
// 2. app.get('*') 的 SPA 兜底在 express 里，若用 app.use 挂在它后面永远轮不到。
//
// 做法是把 https server 的 request 监听拆开：命中 /cluss-app 走反代，其余交给 app。
//
// ---- 与 Cluss 的约定（改任何一边都要同步）----
//   · 反代剥掉 /cluss-app 前缀再转发，所以 Cluss 侧仍以为自己在根路径；
//   · Cluss 前端资源必须用相对路径（vite base './'），否则它会去要
//     /assets/... —— 那是 ClassIntra 自己的资源路径；
//   · Cluss 前端 API 前缀由页面路径推导（utils/base-path.js），
//     于是 /cluss-app/ 下发出的请求正好是 /cluss-app/api/...，又回到这里被剥前缀；
//   · Cluss 的 token cookie 叫 cluss_token，与本系统的 token **不同名**，
//     同域并存不会互相覆盖（这是有意设计，见 Cluss middleware/auth.js 的注释）。

var http = require('http');

// 用 WHATWG URL 而不是 url.parse()：后者已标记弃用（DEP0169），
// 且对畸形 URL 的解析结果与浏览器不一致，代理场景下等于把判断标准交给别人。
// 第二个参数随便给一个合法 base —— 代理只可能收到绝对路径形式的 req.url。
function parseReqUrl(reqUrl) {
  try {
    var u = new URL(String(reqUrl || '/'), 'http://cluss-proxy.internal');
    return { pathname: u.pathname, search: u.search };
  } catch (e) {
    return { pathname: '/', search: '' };
  }
}

var CLUSS_MOUNT = '/cluss-app';
var CLUSS_PORT = parseInt(process.env.CLUSS_PROXY_PORT || '9003', 10);
var CLUSS_HOST = process.env.CLUSS_PROXY_HOST || '127.0.0.1';

// 反代目标不可达时的兜底文案（502）。用 HTML 而不是 JSON：
// 这个响应会被 iframe 直接渲染，学生看到的是人话，不是一串 code。
function sendUnavailable(res, reason) {
  if (res.headersSent) {
    try { res.end(); } catch (e) {}
    return;
  }
  var body = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Cluss 暂不可用</title>' +
    '<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;' +
    'background:#eef1f8;color:#5b6478;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}' +
    '.box{text-align:center;padding:24px;max-width:320px}.t{font-size:16px;color:#2f3542;margin-bottom:8px}' +
    '</style></head><body><div class="box"><div class="t">Cluss 没有启动</div>' +
    '<div>请在本机启动 Cluss 服务（9003 端口）后刷新本页。</div>' +
    '<div style="margin-top:6px;font-size:12px;opacity:.7">' + String(reason || '') + '</div>' +
    '</div></body></html>';
  res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// 判断请求是否落在 /cluss 命名空间下。
// 刻意不做「前缀包含 cluss」这类宽松匹配：/clussnotes 之类的路径必须留给宿主自己。
function isClussPath(reqUrl) {
  var pathname = parseReqUrl(reqUrl).pathname;
  return pathname === CLUSS_MOUNT || pathname.indexOf(CLUSS_MOUNT + '/') === 0;
}

// Set-Cookie 的 Path 收窄：Cluss 用 Path=/ 写 cookie，同域下会被浏览器
// 顺手塞到 ClassIntra 的每个请求上。虽然两边 cookie 不同名、读不到对方的值，
// 但没理由让一个 httpOnly 的学习令牌在整站范围内裸奔——收窄到 /cluss 即可。
function narrowCookiePath(setCookie) {
  if (!setCookie || !setCookie.length) return setCookie;
  return setCookie.map(function(c) {
    if (/;\s*Path=/i.test(c)) {
      return c.replace(/;\s*Path=[^;]*/i, '; Path=' + CLUSS_MOUNT);
    }
    // 没有显式 Path 的（浏览器默认按路径前缀）补一个，行为才可预期
    return c + '; Path=' + CLUSS_MOUNT;
  });
}

function proxyToCluss(req, res) {
  var parsed = parseReqUrl(req.url);
  var pathname = parsed.pathname;

  // /cluss-app（无斜杠）→ 302 到 /cluss-app/。
  // 两个原因：一是地址栏稳定，刷新/分享不会丢；二是 Cluss 的 base 推导
  // 依赖「页面路径的目录部分」，/cluss-app 与 /cluss-app/ 推导结果相同，但带斜杠
  // 才是资源相对解析的标准形态（浏览器对无斜杠目录的相对资源解析会出歧义）。
  if (pathname === CLUSS_MOUNT) {
    res.writeHead(302, { Location: CLUSS_MOUNT + '/' + (parsed.search || '') });
    res.end();
    return;
  }

  var upstreamPath = pathname.slice(CLUSS_MOUNT.length) + (parsed.search || '');
  if (upstreamPath.charAt(0) !== '/') upstreamPath = '/' + upstreamPath;

  var headers = Object.assign({}, req.headers);
  // 不带 Accept-Encoding：让 Cluss 回未压缩内容，我们原样转发。
  // 否则要么双重压缩（内容损坏），要么为 SSE 引入攒帧延迟。
  delete headers['accept-encoding'];
  // host 改成上游地址：Cluss 若按 host 生成任何绝对地址，拿到的也该是它自己
  headers.host = CLUSS_HOST + ':' + CLUSS_PORT;

  var options = {
    host: CLUSS_HOST,
    port: CLUSS_PORT,
    method: req.method,
    path: upstreamPath,
    headers: headers
  };

  var upstreamReq = http.request(options, function(upstreamRes) {
    var outHeaders = Object.assign({}, upstreamRes.headers);

    var cookies = narrowCookiePath(upstreamRes.headers['set-cookie']);
    if (cookies) outHeaders['set-cookie'] = cookies;

    // 上游若给相对 Location（重定向），补回 /cluss 前缀，否则一跳就跳出反代命名空间
    var loc = outHeaders.location;
    if (loc && loc.charAt(0) === '/' && loc.indexOf(CLUSS_MOUNT + '/') !== 0) {
      outHeaders.location = CLUSS_MOUNT + loc;
    }

    res.writeHead(upstreamRes.statusCode || 502, outHeaders);
    upstreamRes.pipe(res);
    upstreamRes.on('error', function() {
      try { res.end(); } catch (e) {}
    });
  });

  upstreamReq.on('error', function(err) {
    console.error('[cluss-proxy] 上游不可达 (' + CLUSS_HOST + ':' + CLUSS_PORT + '):', err.message);
    sendUnavailable(res, err.code || err.message);
  });

  // 客户端中途断开（学生切走 iframe）时同步放弃上游，别让 Cluss 那边
  // 继续为一个没人看的 SSE 烧 token
  res.on('close', function() {
    if (!res.writableEnded) upstreamReq.destroy();
  });

  req.pipe(upstreamReq);
}

// 挂到 https server 的 request 监听上：命中 /cluss 走反代，其余照旧交给 express。
// app 由调用方传入（app-https.js 里的那个 express 实例），模块自身不持引用，
// 免得以后有人把这个文件 require 进别处时悄悄拖进半个 express 应用。
function mount(server, app) {
  server.on('request', function(req, res) {
    if (isClussPath(req.url)) {
      proxyToCluss(req, res);
      return;
    }
    app(req, res);
  });
}

module.exports = { mount: mount, isClussPath: isClussPath };
