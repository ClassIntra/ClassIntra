// 媒体加载体验探针：头像/封面的缓存头、二次进入零请求、加载占位与淡入、失败重试
// 用法：node scripts/media-loading-probe.mjs   （默认以 251800 身份：有头像也有封面，PROBE_USER 可覆盖）
// 断言一览：
//   A 响应头：缩放图 ETag+max-age=86400、hash 资产 immutable、If-None-Match→304
//   B 社区列表头像全部加载完成（无破图）
//   C 二次进入：0 次云盘图片请求、0 次 assets 请求（浏览器缓存真正生效）
//   D 「我的」封面：弱网下先显示渐变兜底、加载完成后淡入可见
//   E 头像首次请求失败 → 自动带 &r=1 重试 → 恢复正常显示（不永久回落文字）
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const ME = process.env.PROBE_USER || '251800';
const TARGET = ME; // 探自己的主页（该账号有头像+封面）
const RUN = Date.now().toString(36);
const OUT = join(tmpdir(), 'ci-media-loading-' + RUN);
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let S = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { S = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: ME }, S, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9431',
  `--user-data-dir=${join(tmpdir(), 'ci-media-loading-' + RUN)}`, // 每次全新 profile：轮内冷→热，跨轮不串味
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const get = async (p) => (await fetch(`http://127.0.0.1:9431${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
const net = new Map();          // requestId -> { url, cached }（cached=false 才算真网络请求）
const headersById = new Map();  // requestId -> 合并后的响应头
const DEBUG = !!process.env.PROBE_DEBUG;
let DBG_PHASE = 'boot';
const evLog = new Map();        // requestId -> [事件序列]（仅 DEBUG）
function dbgEv(rid, name) {
  if (!DEBUG) return;
  if (!evLog.has(rid)) evLog.set(rid, []);
  const u = (net.get(rid) || {}).url || '';
  if (!/\/assets\/|cloud\/files/.test(u)) return;
  evLog.get(rid).push(DBG_PHASE + ':' + name);
}
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Network.requestWillBeSent' && /^http/.test(m.params.request.url)) {
    net.set(m.params.requestId, { url: m.params.request.url, cached: undefined });
    dbgEv(m.params.requestId, 'willBeSent');
  }
  if (m.method === 'Network.responseReceived') {
    const p = m.params;
    dbgEv(p.requestId, 'responseReceived' + (p.response.fromDiskCache ? '(disk)' : p.response.fromMemoryCache ? '(mem)' : '(net)'));
    if (headersById.has(p.requestId)) Object.assign(headersById.get(p.requestId), p.response.headers || {});
    else headersById.set(p.requestId, Object.assign({}, p.response.headers || {}));
    // ⚠️ 缓存命中时 Chrome 会用 responseReceived 重播缓存响应（flags 全 false、
    // timing 与首次相同、loadingFinished 的 encodedDataLength=0）。此时绝不能把
    // servedFromCache 已经置上的 cached=true 覆盖回 false，否则缓存命中被误计成
    // 网络请求（C1/C3 假红的真正根因）。
    if (net.has(p.requestId) && net.get(p.requestId).cached === undefined) {
      net.get(p.requestId).cached = !!(p.response.fromDiskCache || p.response.fromMemoryCache);
    }
  }
  if (m.method === 'Network.responseReceivedExtraInfo' && headersById.has(m.params.requestId)) {
    Object.assign(headersById.get(m.params.requestId), m.params.headers || {});
  }
  if (m.method === 'Network.loadingFailed' && net.has(m.params.requestId)) {
    dbgEv(m.params.requestId, 'loadingFailed:' + (m.params.errorText || ''));
    net.get(m.params.requestId).cached = false; // 失败也是真实发出的请求
  }
  // 缓存命中时 Chrome 发的是 requestServedFromCache 而不是 responseReceived，
  // 不处理这条的话缓存命中会停留在 cached=undefined，被误计成网络请求（C1/C3 假红）
  if (m.method === 'Network.requestServedFromCache' && net.has(m.params.requestId)) {
    dbgEv(m.params.requestId, 'servedFromCache');
    net.get(m.params.requestId).cached = true;
  }
  // E 段：拦截头像（w=256）首次请求 → 失败；重试（&r=1）放行
  // .catch 是必须的：Fetch.disable 后仍可能有迟到的 requestPaused，
  // 此时 continueRequest 会 reject，不接就是 unhandled rejection 崩掉整个探针
  if (m.method === 'Fetch.requestPaused') {
    const u = m.params.request.url;
    if (/w=256/.test(u) && !/[?&]r=/.test(u)) {
      send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
    } else {
      send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
    }
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
};
// 真网络请求数（排除 fromCache）
function netCount(match) {
  let n = 0;
  for (const r of net.values()) {
    if (r.cached === false || r.cached === undefined) {
      if (!match || match.test(r.url)) n++;
    }
  }
  return n;
}
function netUrls(match) {
  const out = [];
  for (const r of net.values()) {
    if ((r.cached === false || r.cached === undefined) && (!match || match.test(r.url))) out.push(r.url);
  }
  return out;
}
function clearNet() { net.clear(); }
function headerFor(match) {
  for (const [rid, h] of headersById) {
    const r = net.get(rid);
    if (r && match.test(r.url)) return h;
  }
  return null;
}
// CDP 的 responseReceived 保留服务端原始大小写（Cache-Control 而非 cache-control），取值必须大小写不敏感
function hget(h, name) {
  if (!h) return null;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : null;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});}catch(e){}`
});

// ══ A. 冷启：响应头 + 主页头像/封面可见性 ══
console.log('\n=== A. 冷启 /profile（缓存头 + 可见性）===');
clearNet();
await send('Page.navigate', { url: APP + '/profile/' + TARGET });
let coverA = null;
for (let i = 0; i < 150; i++) {
  coverA = await ev(`(function(){var i=document.querySelector('.profile-cover-img');if(!i)return null;var st=getComputedStyle(i);return {op:st.opacity,nw:i.naturalWidth,src:i.getAttribute('src')||''};})()`);
  if (coverA && coverA.nw > 0 && Number(coverA.op) > 0.9) break;
  await sleep(60);
}
check('A1 主页封面加载完成且不透明（含裁切 transform）', !!(coverA && coverA.nw > 0 && Number(coverA.op) > 0.9), coverA ? `naturalW=${coverA.nw} opacity=${coverA.op}` : 'img 不存在');
await sleep(600);
const avA = await ev(`(function(){var i=document.querySelector('.profile-avatar-slot .user-avatar-img');if(!i)return null;return {src:i.getAttribute('src')||'',complete:i.complete,nw:i.naturalWidth,op:getComputedStyle(i).opacity};})()`);
check('A2 主页头像(96px)走 w=256 档且加载完成', !!(avA && /w=256/.test(avA.src) && avA.complete && avA.nw > 0 && Number(avA.op) > 0.9), avA ? `${avA.src.slice(-24)} naturalW=${avA.nw}` : 'img 不存在');
await shot('a-profile.png');

const hImg = headerFor(/\/api\/cloud\/files\/[0-9a-f]+(?:\.\w+)?\?w=720/);
check('A3 封面缩放响应：ETag + Cache-Control max-age=86400',
  !!(hImg && /max-age=86400/.test(hget(hImg, 'cache-control') || '') && hget(hImg, 'etag')),
  hImg ? `cache-control=${hget(hImg, 'cache-control')} etag=${hget(hImg, 'etag')}` : '未捕获响应');
const hJs = headerFor(/\/assets\/[\w-]+\.js/);
check('A4 hash 资产：Cache-Control 含 immutable',
  !!(hJs && /immutable/.test(hget(hJs, 'cache-control') || '')), hJs ? hget(hJs, 'cache-control') : '未捕获响应');
// A5：拿 A3 的 ETag 直接协商，期望 304
if (hImg && coverA && coverA.src) {
  const etag = hget(hImg, 'etag');
  try {
    const r = await fetch(APP + coverA.src, { headers: { Authorization: 'Bearer ' + token, 'If-None-Match': etag } });
    check('A5 带 If-None-Match 协商返回 304（过期后重下变 304）', r.status === 304, 'status=' + r.status);
  } catch (err) {
    check('A5 带 If-None-Match 协商返回 304', false, String(err.message || err));
  }
}

// ══ B. 社区论坛列表：头像全部加载完成 ══
console.log('\n=== B. 社区论坛列表头像 ===');
clearNet();
await send('Page.navigate', { url: APP + '/community' });
await sleep(5000);
const avs = await ev(`(function(){
  function inView(i){var r=i.getBoundingClientRect();var vh=window.innerHeight||787,vw=window.innerWidth||1043;return r.bottom>0&&r.top<vh&&r.right>0&&r.left<vw;}
  return Array.prototype.map.call(document.querySelectorAll('.user-avatar-img'),function(i){return {src:i.getAttribute('src')||'',complete:i.complete,nw:i.naturalWidth,op:getComputedStyle(i).opacity,inView:inView(i)};});
})()`);
const broken = avs.filter((a) => a.inView && (!a.complete || a.nw <= 0 || Number(a.op) < 0.9));
check('B1 论坛列表头像全部加载完成（无破图/无空白）', avs.length > 0 && broken.length === 0, `共 ${avs.length} 张（视口内 ${avs.filter((a) => a.inView).length}），异常 ${broken.length} 张`);
const w128 = avs.filter((a) => /w=128/.test(a.src)).length;
check('B2 列表小头像走 w=128 轻档', w128 > 0, `w=128 ${w128} 张 / w=256+ ${avs.length - w128} 张`);

// ══ C. 二次进入：浏览器缓存真正生效（0 网络请求）══
console.log('\n=== C. 二次进入（缓存命中）===');
await send('Page.navigate', { url: APP + '/community' });
await sleep(2200);
clearNet();
DBG_PHASE = 'C-profile';
await send('Page.navigate', { url: APP + '/profile/' + TARGET });
let coverC = null;
for (let i = 0; i < 120; i++) {
  coverC = await ev(`(function(){var i=document.querySelector('.profile-cover-img');if(!i)return null;return {op:getComputedStyle(i).opacity,nw:i.naturalWidth};})()`);
  if (coverC && coverC.nw > 0 && Number(coverC.op) > 0.9) break;
  await sleep(50);
}
const imgNetC1 = netCount(/\/api\/cloud\/files\//);
check('C1 二次进入主页：0 次云盘图片请求（封面/头像全走缓存）', imgNetC1 === 0, imgNetC1 + ' 次' + (imgNetC1 ? '：' + netUrls(/\/api\/cloud\/files\//).join(' | ').slice(0, 160) : ''));
check('C2 二次进入主页封面仍可见', !!(coverC && coverC.nw > 0 && Number(coverC.op) > 0.9), coverC ? `naturalW=${coverC.nw}` : 'img 不存在');

await send('Page.navigate', { url: APP + '/community' });
await sleep(3200);
clearNet();
DBG_PHASE = 'C-nav2b';
await send('Page.navigate', { url: APP + '/community' });
await sleep(3200);
// 只匹配 dist 静态资产（/assets/xxx.js|css|woff2…），
// 不能用宽泛的 /\/assets\// —— 那会误中 /api/assets/broadcasts（公告轮询，本就该 no-store）
const ASSET_RE = /\/assets\/[\w.-]+\.[a-z]{2,5}(\?|$)/i;
const jsNetC3 = netCount(ASSET_RE);
check('C3 二次进入社区：0 次 assets 请求（immutable 长缓存生效）', jsNetC3 === 0, jsNetC3 + '次' + (jsNetC3 ? '：' + netUrls(ASSET_RE).join(' | ').slice(0, 160) : ''));
if (DEBUG) {
  console.log('  [debug] C-nav2b 阶段全部 asset 事件：');
  for (const [rid, seq] of evLog) {
    if (!seq.some((s) => s.indexOf('C-nav2b:') === 0)) continue;
    console.log('    ' + seq.filter((s) => s.indexOf('C-nav2b:') === 0).map((s) => s.slice(8)).join(' → ') + '  ' + ((net.get(rid) || {}).url || '').slice(-46));
  }
}

// ══ D. 「我的」封面：弱网下渐变兜底 → 淡入 ══
console.log('\n=== D. 「我的」封面加载序列（250ms RTT + 禁缓存）===');
// ⚠️ CDP 的 throughput 单位是「字节/秒」不是 bit/s：之前写成 1.5*1024*1024/8
// 实际只有 ~192KB/s，1.6MB 封面要 8.5s，循环 6s 根本等不到（D2 假红）。
// 这里模拟「弱 4G」：下行 1.5MB/s + 250ms RTT。
await send('Network.emulateNetworkConditions', { offline: false, latency: 250, downloadThroughput: 1.5 * 1024 * 1024, uploadThroughput: 512 * 1024 });
await send('Network.setCacheDisabled', { cacheDisabled: true });
clearNet();
await send('Page.navigate', { url: APP + '/community' });
// 弱网 + 禁缓存下 bundle 就绪可能远超 2.6s：轮询等侧栏「我的」出现再点
// （此前 D1/D2 误报就是 bundle 还没加载完就点了，侧栏根本不存在）
let clickedMine = false;
for (let i = 0; i < 150; i++) {
  clickedMine = await ev(`(function(){var t=Array.prototype.slice.call(document.querySelectorAll('.sidebar-menu-item')).filter(function(x){return x.innerText.trim()==='我的'})[0];if(!t)return false;t.click();return true;})()`);
  if (clickedMine) break;
  await sleep(100);
}
let sawPlaceholder = false, shotTaken = false, loadedAt = -1;
const tD = Date.now();
for (let i = 0; i < 400; i++) {
  const s = await ev(`(function(){
    var img=document.querySelector('.mine-cover-img');
    if(!img) return {img:false};
    var fb=document.querySelector('.mine-cover-fallback');
    return {img:true, loaded:img.classList.contains('is-loaded'), op:getComputedStyle(img).opacity,
            fbVisible: !!fb && getComputedStyle(fb).display!=='none' && getComputedStyle(fb).visibility!=='hidden'};
  })()`);
  if (s.img && !s.loaded && s.fbVisible && !shotTaken) {
    sawPlaceholder = true;
    await shot('d-cover-placeholder.png');
    shotTaken = true;
  }
  if (s.img && s.loaded && Number(s.op) > 0.9) { loadedAt = Date.now() - tD; break; }
  await sleep(25);
}
check('D1 封面加载中显示渐变兜底（不是纯色干等）', sawPlaceholder);
check('D2 封面加载完成后淡入可见', loadedAt > 0, loadedAt > 0 ? loadedAt + 'ms' : '未就绪');
await shot('d-mine-ready.png');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Network.setCacheDisabled', { cacheDisabled: false });

// ══ E. 头像首次请求失败 → 自动重试 ══
console.log('\n=== E. 头像失败重试（Fetch 拦截首个 w=256 请求）===');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Fetch.enable', { patterns: [{ urlPattern: '*cloud/files*', requestStage: 'Request' }] });
clearNet();
await send('Page.navigate', { url: APP + '/profile/' + TARGET });
let avE = null, sawRetry = false;
for (let i = 0; i < 240; i++) {
  avE = await ev(`(function(){var i=document.querySelector('.profile-avatar-slot .user-avatar-img');if(!i)return null;return {src:i.getAttribute('src')||'',complete:i.complete,nw:i.naturalWidth,op:getComputedStyle(i).opacity};})()`);
  if (avE && /[?&]r=1/.test(avE.src)) sawRetry = true;
  if (sawRetry && avE && avE.complete && avE.nw > 0 && Number(avE.op) > 0.9) break;
  await sleep(50);
}
check('E1 首次失败后自动换 &r=1 重试', sawRetry, avE ? avE.src.slice(-28) : 'img 不存在');
check('E2 重试后头像恢复正常显示（未永久回落文字头像）', !!(sawRetry && avE && avE.complete && avE.nw > 0 && Number(avE.op) > 0.9), avE ? `naturalW=${avE.nw} opacity=${avE.op}` : '');
await send('Fetch.disable');
await send('Network.setCacheDisabled', { cacheDisabled: false });

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
if (fail) process.exitCode = 1;
ws.close();
chrome.kill();
console.log('截图 ->', OUT);
