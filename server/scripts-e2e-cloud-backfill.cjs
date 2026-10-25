/**
 * 云盘读路径「按需回源」端到端实测
 *
 * 拓扑：隔离 CI 实例（9099，全新 DB + 独立 Resources，RELAY_SERVERS 清空防污染生产中继）
 *       + stub peer（9123，复刻 /api/cloud/peer-fetch 契约：X-Relay-Secret 校验、
 *         X-File-Hash/X-File-Name/X-File-Mime/Content-Length、?w= 缩放、慢速响应）
 * 隔离实例经 PEER_MEDIA_BASES 指向 stub（与 app.js botMediaFallback 同名同语义）。
 *
 * 覆盖：
 *   T1 回源成功：404 窗口的文件从 peer 拉到 → 200 + X-Backfilled + 字节一致
 *   T2 落盘落库：cloud_files 补记（owner __relay__）+ shared/ 物理文件在位
 *   T3 二次请求：本地命中，无 X-Backfilled，stub 零新增命中
 *   T4 全缺失：并发 3 连 404 且 stub 只被打 1 次（single-flight）；负缓存期内再打仍是 1
 *   T5 哈希不符：拒绝落盘（无记录无文件），stub 1 次
 *   T6 并发回源：5 并发同一 hash → 全部 200 且字节正确，stub 只 1 次（single-flight）
 *   T7 缩略图回源：?w=48 只回源几 KB 缩略图（不再拉原图），宽 48 且字节远小于原图
 *   T8 缩略图缓存：二次 ?w=48 走内存缓存，stub 零新增；随后原图请求再走原图回源
 *   T9 大图缩略图：原图数 MB 时，?w=64 依然只回传几十 KB（慢链路上的关键收益）
 *   T10 不阻塞读请求：回源慢于宽限期 → 先 404（前端兜底），后台继续拉，随后落盘
 *   T11 实例日志：[CloudSync] 按需回源成功/未命中/缩略图回源成功 均如实记录
 *
 * 用法（系统 Node，cwd=server/）：node scripts-e2e-cloud-backfill.cjs
 */

var path = require('path');
var fs = require('fs');
var http = require('http');
var crypto = require('crypto');
var spawnSync = require('child_process').spawnSync;
var spawn = require('child_process').spawn;
var Database = require('better-sqlite3');
var sharp = require('sharp');

var SERVER_DIR = __dirname;
var TMP = path.join(process.env.TEMP || 'C:\\Users\\iflytek\\AppData\\Local\\Temp', 'ci-backfill-' + Date.now());
var DB_PATH = path.join(TMP, 'probe.db');
var RES_DIR = path.join(TMP, 'res');
var CI_PORT = 9099;
var STUB_PORT = 9123;
var RELAY_SECRET = 'probe-relay-secret';
var BASE = 'http://127.0.0.1:' + CI_PORT;
var STUB_BASE = 'http://127.0.0.1:' + STUB_PORT;
var NODE = 'C:\\Program Files\\nodejs\\node.exe';
var GRACE_MS = 800;   // 宽限期（远小于 stub 慢速用例的 3000ms，便于确定性地验证「不阻塞」）

var jwtUtil = require(path.join(SERVER_DIR, 'src', 'utils', 'jwt'));

var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ---------- stub peer（复刻生产 peer-fetch 契约，含 ?w= 缩放与可控延迟）----------
var stubFiles = {};   // hash → { body, name, mime, delay }
var stubHits = {};    // hash → count（总命中）
var stubHitsW = {};   // hash_w<w> → count（按缩放档位细分）
var stubServer = http.createServer(function(req, res) {
  var u = new URL(req.url, 'http://stub');
  var m = u.pathname.match(/^\/api\/cloud\/peer-fetch\/([a-f0-9]{64})$/);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"code":404}'); return; }
  var hash = m[1];
  if ((req.headers['x-relay-secret'] || '') !== RELAY_SECRET) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 403, message: '禁止访问' }));
    return;
  }
  var w = parseInt(u.searchParams.get('w'), 10) || 0;
  stubHits[hash] = (stubHits[hash] || 0) + 1;
  if (w > 0) {
    var key = hash + '_w' + w;
    stubHitsW[key] = (stubHitsW[key] || 0) + 1;
  }
  var f = stubFiles[hash];
  if (!f) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 404, message: '文件不存在' }));
    return;
  }
  // 慢速回源：拉宽 single-flight 并发窗口 / 模拟慢链路（T10）
  setTimeout(function() {
    var body = f.body;
    var resized = '';
    var send = function() {
      res.writeHead(200, {
        'Content-Type': f.mime,
        'Content-Length': body.length,
        'X-File-Hash': hash,
        'X-File-Name': encodeURIComponent(f.name),
        'X-File-Mime': f.mime,
        'X-File-Resized': resized
      });
      res.end(body);
    };
    if (w > 0 && f.mime.indexOf('image/') === 0) {
      sharp(body).metadata().then(function(meta) {
        if (!meta || !meta.width || meta.width <= w) { send(); return; }
        return sharp(body).resize({ width: w, withoutEnlargement: true }).toBuffer().then(function(b) {
          body = b; resized = '1'; send();
        });
      }).catch(function() { send(); });
      return;
    }
    send();
  }, f.delay || 120);
});

// ---------- 夹具 ----------
// 内容寻址：hash 必须是「所发内容」的 sha256（与生产一致），否则哈希校验必然拒绝。
// H4 是唯一例外——它模拟「传输损坏/错文件」：hash 与所发内容不符，应被拒绝。
var TOKEN = jwtUtil.generateToken({ user_id: '251800', net_name: 'probe' });
var bodyA = crypto.randomBytes(65536);
var bodyB = crypto.randomBytes(32768);
var H1 = crypto.createHash('sha256').update(bodyA).digest('hex');              // 回源成功主用例
var H3 = crypto.createHash('sha256').update(bodyB).digest('hex');              // 并发用例
var H2 = crypto.createHash('sha256').update('missing-' + Date.now()).digest('hex'); // 全缺失
var H4 = crypto.createHash('sha256').update('corrupt-' + Date.now()).digest('hex'); // 哈希不符（stub 发随机字节）
var H5 = null; // PNG（sharp 生成后算哈希）
var H6 = null; // 大图 PNG（验证缩略图省流量）
var H7 = null; // 慢速用例（延迟 > 宽限期，验证不阻塞）

async function getFile(urlPath, opts) {
  var t0 = Date.now();
  var r = await fetch(BASE + urlPath, Object.assign({ headers: { Authorization: 'Bearer ' + TOKEN } }, opts || {}));
  var buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, body: buf, ms: Date.now() - t0 };
}

async function waitReady(timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      var r = await fetch(BASE + '/api/cloud/files/' + '0'.repeat(64));
      if (r.status === 401) return true; // 认证中间件已就位 = HTTP + 路由已挂载
    } catch (e) { /* 未起 */ }
    await sleep(300);
  }
  return false;
}

(async function main() {
  fs.mkdirSync(TMP, { recursive: true });

  // 端口占用预检
  var busy = spawnSync('powershell', ['-NoProfile', '-Command',
    '(Test-NetConnection -ComputerName 127.0.0.1 -Port ' + CI_PORT + ').TcpTestSucceeded; ' +
    '(Test-NetConnection -ComputerName 127.0.0.1 -Port ' + STUB_PORT + ').TcpTestSucceeded'],
    { encoding: 'utf8' });
  if (/True/.test(busy.stdout || '')) {
    console.error('端口 ' + CI_PORT + '/' + STUB_PORT + ' 被占用， abort');
    process.exit(2);
  }

  // 图片夹具
  var png = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#c0392b' } }).png().toBuffer();
  H5 = crypto.createHash('sha256').update(png).digest('hex');
  // 大图：噪声 PNG（压缩不动，确保原图达到 MB 级，缩略图才显得出差距）
  var bigPng = await sharp({ create: { width: 1600, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
  H6 = crypto.createHash('sha256').update(bigPng).digest('hex');
  var slowBody = crypto.randomBytes(4096);
  H7 = crypto.createHash('sha256').update(slowBody).digest('hex');

  stubFiles[H1] = { body: bodyA, name: 'backfill-a.bin', mime: 'application/octet-stream' };
  stubFiles[H3] = { body: bodyB, name: 'backfill-b.bin', mime: 'application/octet-stream' };
  stubFiles[H4] = { body: crypto.randomBytes(2048), name: 'corrupt.bin', mime: 'application/octet-stream' }; // 内容与 H4 不符
  stubFiles[H5] = { body: png, name: 'probe-image.png', mime: 'image/png' };
  stubFiles[H6] = { body: bigPng, name: 'big-image.png', mime: 'image/png' };
  stubFiles[H7] = { body: slowBody, name: 'slow.bin', mime: 'application/octet-stream', delay: 3000 };

  await new Promise(function(r) { stubServer.listen(STUB_PORT, '127.0.0.1', r); });
  console.log('stub peer 已启动: ' + STUB_BASE + '（宽限期 ' + GRACE_MS + 'ms，慢速用例延迟 3000ms）');

  // ---------- 隔离 CI 实例 ----------
  var ciLog = fs.createWriteStream(path.join(TMP, 'ci.log'));
  var child = spawn(NODE, ['src/app.js'], {
    cwd: SERVER_DIR,
    env: Object.assign({}, process.env, {
      PORT: String(CI_PORT),
      WS_PORT: '10099',
      RELAY_PORT: '10098',
      RELAY_SERVERS: '',               // 清空：不向生产中继发起连接，杜绝污染
      RELAY_SECRET: RELAY_SECRET,
      DB_PATH: DB_PATH,
      RESOURCES_DIR: RES_DIR,
      PEER_MEDIA_BASES: STUB_BASE,     // 与 app.js botMediaFallback 同名同语义
      PEER_BACKFILL_GRACE_MS: String(GRACE_MS),
      PYTHONPATH: '',
      NODE_OPTIONS: '',
      CODEBUDDY_SAFE_DELETE_ENABLED: '0'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function(d) { ciLog.write(d); });
  child.stderr.on('data', function(d) { ciLog.write(d); });
  child.on('exit', function(code) { ciLog.write('\n[probe] CI exited code=' + code + '\n'); });

  var ready = await waitReady(60000);
  ok(ready, '隔离实例 9099 就绪');
  if (!ready) {
    console.error('CI 未就绪，日志: ' + path.join(TMP, 'ci.log'));
    process.exit(2);
  }

  // ---------- T1 回源成功 ----------
  section('T1 回源成功（404 窗口 → peer 拉取 → 本地服务）');
  var r1 = await getFile('/api/cloud/files/' + H1);
  ok(r1.status === 200, '首请求 200', r1.status);
  ok(r1.headers.get('x-backfilled') === '1', 'X-Backfilled=1（本次经回源）', r1.headers.get('x-backfilled'));
  ok(r1.body.equals(stubFiles[H1].body), '响应字节与源一致', { got: r1.body.length, want: stubFiles[H1].body.length });

  // ---------- T2 落盘落库 ----------
  section('T2 落盘 + 补记 cloud_files');
  var db = new Database(DB_PATH, { readonly: true });
  var row = db.prepare('SELECT hash, owner_user_id, original_name, size, mime_type, storage_path, deleted FROM cloud_files WHERE hash = ?').get(H1);
  db.close();
  ok(!!row, 'cloud_files 已补记', row);
  ok(row && row.owner_user_id === '__relay__', 'owner=__relay__（与 preFetchCloudFiles 一致）', row && row.owner_user_id);
  var diskPath = path.join(RES_DIR, 'cloud', 'shared', H1.substring(0, 2), H1 + '.bin');
  ok(fs.existsSync(diskPath), 'shared/ 物理文件在位: ' + H1.substring(0, 2) + '/' + H1 + '.bin');
  ok(fs.statSync(diskPath).size === 65536, '磁盘文件大小 65536');

  // ---------- T3 二次请求本地命中 ----------
  section('T3 二次请求本地命中（stub 零新增命中）');
  var r3 = await getFile('/api/cloud/files/' + H1);
  ok(r3.status === 200 && r3.body.equals(stubFiles[H1].body), '二次请求 200 且字节一致');
  ok(!r3.headers.get('x-backfilled'), '无 X-Backfilled（本地路径）', r3.headers.get('x-backfilled'));
  ok(stubHits[H1] === 1, 'stub 对 H1 仍只 1 次命中', stubHits[H1]);

  // ---------- T4 全缺失 + single-flight + 负缓存 ----------
  section('T4 全缺失：3 并发 404，stub 只 1 次；负缓存期内再打仍 1 次');
  var r4s = await Promise.all([1, 2, 3].map(function() { return getFile('/api/cloud/files/' + H2); }));
  ok(r4s.every(function(r) { return r.status === 404; }), '3 并发全部 404', r4s.map(function(r) { return r.status; }));
  ok(stubHits[H2] === 1, 'single-flight：stub 对 H2 只 1 次命中', stubHits[H2]);
  await sleep(300);
  var r4b = await getFile('/api/cloud/files/' + H2);
  ok(r4b.status === 404, '负缓存期内再请求 404');
  ok(stubHits[H2] === 1, '负缓存生效：stub 对 H2 仍只 1 次命中', stubHits[H2]);

  // ---------- T5 哈希不符 ----------
  section('T5 哈希不符：拒绝落盘');
  var r5 = await getFile('/api/cloud/files/' + H4);
  ok(r5.status === 404, '哈希不符 → 404', r5.status);
  ok(stubHits[H4] === 1, 'stub 对 H4 1 次命中', stubHits[H4]);
  var db5 = new Database(DB_PATH, { readonly: true });
  var row5 = db5.prepare('SELECT hash FROM cloud_files WHERE hash = ?').get(H4);
  db5.close();
  ok(!row5, '未补记 cloud_files');
  ok(!fs.existsSync(path.join(RES_DIR, 'cloud', 'shared', H4.substring(0, 2))), '未落盘（无该前缀目录或目录内无文件）');

  // ---------- T6 并发回源 single-flight ----------
  section('T6 5 并发同一 hash：全部 200，stub 只 1 次');
  var r6s = await Promise.all([1, 2, 3, 4, 5].map(function() { return getFile('/api/cloud/files/' + H3); }));
  ok(r6s.every(function(r) { return r.status === 200 && r.body.equals(stubFiles[H3].body); }), '5 并发全部 200 且字节正确', r6s.map(function(r) { return r.status; }));
  ok(stubHits[H3] === 1, 'single-flight：stub 对 H3 只 1 次命中', stubHits[H3]);

  // ---------- T7 缩略图回源（慢链路上的关键路径）----------
  section('T7 ?w=48 只回源缩略图（不拉原图）');
  var r7 = await getFile('/api/cloud/files/' + H5 + '.png?w=48');
  ok(r7.status === 200, '缩略图请求 200', r7.status);
  ok((r7.headers.get('content-type') || '').indexOf('image/png') === 0, 'content-type=image/png', r7.headers.get('content-type'));
  ok(r7.headers.get('x-backfilled') === '1', 'X-Backfilled=1（经回源）', r7.headers.get('x-backfilled'));
  var meta7 = await sharp(r7.body).metadata().catch(function() { return null; });
  ok(meta7 && meta7.width === 48, '缩放后宽 48', meta7 && meta7.width);
  ok(r7.body.length < png.length, '回传字节 < 原图（省流量）', { thumb: r7.body.length, orig: png.length });
  ok(stubHitsW[H5 + '_w48'] === 1, 'stub 收到带 w=48 的请求 1 次', stubHitsW[H5 + '_w48']);

  // ---------- T8 缩略图内存缓存 + 原图再走原图回源 ----------
  section('T8 缩略图二次命中缓存；原图请求另走原图回源');
  var r8 = await getFile('/api/cloud/files/' + H5 + '.png?w=48');
  ok(r8.status === 200 && r8.body.equals(r7.body), '二次 ?w=48 字节一致');
  ok(!r8.headers.get('x-backfilled'), '无 X-Backfilled（走内存缓存）', r8.headers.get('x-backfilled'));
  ok(stubHitsW[H5 + '_w48'] === 1, 'stub 对 w=48 仍只 1 次（缓存生效）', stubHitsW[H5 + '_w48']);
  var r8b = await getFile('/api/cloud/files/' + H5 + '.png');
  ok(r8b.status === 200 && r8b.body.equals(png), '原图请求 200 且字节一致（原图回源）');
  ok(r8b.headers.get('x-backfilled') === '1', '原图 X-Backfilled=1', r8b.headers.get('x-backfilled'));
  ok(!fs.existsSync(path.join(RES_DIR, 'cloud', 'thumbs')), '缩略图未写进磁盘（不污染内容寻址区）');

  // ---------- T9 大图：缩略图省下 99%+ 流量 ----------
  section('T9 大图 ?w=64：只回传几十 KB（原图 ' + (bigPng.length / 1048576).toFixed(2) + 'MB）');
  var r9 = await getFile('/api/cloud/files/' + H6 + '.png?w=64');
  ok(r9.status === 200, '大图缩略图 200', r9.status);
  var meta9 = await sharp(r9.body).metadata().catch(function() { return null; });
  ok(meta9 && meta9.width === 64, '缩放后宽 64', meta9 && meta9.width);
  ok(r9.body.length < 200 * 1024, '回传 < 200KB（原图 ' + bigPng.length + 'B）', r9.body.length);
  ok(r9.headers.get('x-backfilled') === '1', 'X-Backfilled=1', r9.headers.get('x-backfilled'));

  // ---------- T10 慢回源不阻塞读请求 ----------
  section('T10 回源慢于宽限期：先 404 兜底，后台继续拉，随后落盘');
  var r10 = await getFile('/api/cloud/files/' + H7);
  ok(r10.status === 404, '慢回源 → 先 404（前端文字兜底）', r10.status);
  ok(r10.ms < 3000, '响应时间 ' + r10.ms + 'ms 未等到回源结束（3000ms）', r10.ms);
  await sleep(3200);   // 等后台回源跑完
  var db10 = new Database(DB_PATH, { readonly: true });
  var row10 = db10.prepare('SELECT hash, owner_user_id FROM cloud_files WHERE hash = ?').get(H7);
  db10.close();
  ok(!!row10, '后台回源仍完成落库（不浪费已建连接）', row10);
  var r10b = await getFile('/api/cloud/files/' + H7);
  ok(r10b.status === 200 && r10b.body.equals(slowBody), '落盘后再次请求本地命中 200 且字节一致', r10b.status);

  // ---------- T11 日志 ----------
  section('T11 实例日志');
  var log = fs.readFileSync(path.join(TMP, 'ci.log'), 'utf8');
  ok((log.match(/按需回源成功/g) || []).length >= 3, '日志含 ≥3 次「按需回源成功」', (log.match(/按需回源成功/g) || []).length);
  ok((log.match(/缩略图回源成功/g) || []).length >= 2, '日志含 ≥2 次「缩略图回源成功」', (log.match(/缩略图回源成功/g) || []).length);
  ok(/按需回源未命中.*hash mismatch/.test(log), '日志含哈希不符未命中');
  ok(/按需回源未命中.*HTTP 404/.test(log), '日志含全缺失未命中');

  // ---------- 收尾 ----------
  console.log('\n========================================');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('日志: ' + path.join(TMP, 'ci.log'));
  console.log('========================================');
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
  try { stubServer.close(); } catch (e) {}
  process.exit(fail > 0 ? 1 : 0);
})().catch(function(e) {
  console.error('探针异常:', e);
  process.exit(2);
});
