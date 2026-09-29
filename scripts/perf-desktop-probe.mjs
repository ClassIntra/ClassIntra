// 桌面加载性能探针：自签 token 直接进入真实桌面，采集首屏时间线与关键请求次数。
//
// 用法：node scripts/perf-desktop-probe.mjs [user_id]
// 前置：CI 已在 127.0.0.1:9001 运行；server/.env 内有 JWT_SECRET。
//
// 为什么不用「未登录首页」测：未登录只渲染登录页，量不到桌面（桌面才是慢的那一屏）。
//
// 输出：
//   1) 导航里程碑（TTFB / FCP / DOMContentLoaded / load / 桌面首次出现）
//   2) 资源汇总（请求数、传输字节、按类型）
//   3) 关键接口调用次数与耗时 —— 尤其 /api/system/app-control 应只出现 1 次
//      （路由守卫 + App.vue + 桌面曾各拉一次，收敛到 router 缓存后合并为 1 次）
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = process.argv[3] || 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9336;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;   // 校园平板横屏

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const isAdmin = USER_ID === '999999' ? 1 : 0;
const token = jwt.sign(
  { user_id: USER_ID, is_admin: isAdmin, is_class_admin: isAdmin, role: isAdmin ? 'admin' : 'user' },
  SECRET, { expiresIn: '1h' }
);
console.log(`自签 token 完成（user_id=${USER_ID}）`);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-perf-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }
console.log('浏览器:', ver.Browser);

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
// 应用启动前注入：token + 桌面首次出现的打点观察器
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__probe = { desktopAt: null, appMountedAt: null };
    (function(){
      function looksDesktop(){
        return !!(document.querySelector('[class*="desktop"],[class*="dock"],.app-grid'));
      }
      var mo = new MutationObserver(function(){
        if (window.__probe.appMountedAt === null && document.querySelector('#app > *')) {
          window.__probe.appMountedAt = Math.round(performance.now());
        }
        if (window.__probe.desktopAt === null && looksDesktop()) {
          window.__probe.desktopAt = Math.round(performance.now());
        }
      });
      document.addEventListener('DOMContentLoaded', function(){
        mo.observe(document.documentElement, { childList: true, subtree: true });
      });
    })();
  `
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });

let desktopAt = null;
for (let i = 0; i < 120; i++) {
  await sleep(250);
  desktopAt = await evalJS('window.__probe && window.__probe.desktopAt');
  if (desktopAt) break;
}
console.log(desktopAt ? `✓ 桌面渲染出现 @ ${desktopAt}ms` : '⚠️ 30s 内未观察到桌面 DOM（可能停在登录页）');
console.log('  当前 URL:', await evalJS('location.href'));

await sleep(2500);   // 让首屏后的懒加载/接口结算完

const report = await evalJS(`(function(){
  var nav = (performance.getEntriesByType('navigation') || [])[0] || {};
  var res = performance.getEntriesByType('resource') || [];
  var fcp = (performance.getEntriesByName('first-contentful-paint') || [])[0];
  var byType = {}, total = 0, totalDecoded = 0;
  res.forEach(function(r){
    var t = (r.initiatorType || 'other');
    byType[t] = byType[t] || { n: 0, bytes: 0 };
    byType[t].n++;
    byType[t].bytes += (r.transferSize || 0);
    total += (r.transferSize || 0);
    totalDecoded += (r.decodedBodySize || 0);
  });
  var api = res.filter(function(r){ return r.name.indexOf('/api/') !== -1; })
               .map(function(r){ return { p: r.name.replace(location.origin, ''), ms: Math.round(r.duration), at: Math.round(r.startTime) }; })
               .sort(function(a,b){ return a.at - b.at; });
  return {
    ttfb: Math.round(nav.responseStart || 0),
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    fcp: fcp ? Math.round(fcp.startTime) : null,
    appMountedAt: (window.__probe || {}).appMountedAt,
    desktopAt: (window.__probe || {}).desktopAt,
    resCount: res.length,
    totalKB: Math.round(total / 1024),
    decodedKB: Math.round(totalDecoded / 1024),
    byType: byType,
    apiCount: api.length,
    api: api,
    // 传输体积 TOP 资源：定位首屏带宽真正花在哪
    top: res.slice()
            .sort(function(a,b){ return (b.transferSize||0) - (a.transferSize||0); })
            .slice(0, 20)
            .map(function(r){
              var u = r.name.replace(location.origin, '');
              return { p: u.length > 72 ? u.slice(0, 70) + '…' : u, t: r.initiatorType || 'other',
                       kb: Math.round((r.transferSize || 0) / 1024 * 10) / 10,
                       ms: Math.round(r.duration) };
            })
  };
})()`);

const pad = (s, n) => String(s).padEnd(n);
console.log('\n=== 导航里程碑 ===');
console.log('  TTFB              ' + report.ttfb + ' ms');
console.log('  FCP               ' + (report.fcp === null ? '(无)' : report.fcp + ' ms'));
console.log('  #app 已挂载       ' + report.appMountedAt + ' ms');
console.log('  桌面 DOM 出现     ' + report.desktopAt + ' ms');
console.log('  DOMContentLoaded  ' + report.dcl + ' ms');
console.log('  load              ' + report.load + ' ms');

console.log('\n=== 资源 ===');
console.log('  请求数            ' + report.resCount);
console.log('  传输字节          ' + report.totalKB + ' KB（解压后 ' + report.decodedKB + ' KB）');
Object.keys(report.byType).sort((a,b) => report.byType[b].bytes - report.byType[a].bytes).forEach(function(k){
  var v = report.byType[k];
  console.log('    ' + pad(k, 10) + pad(v.n + ' 个', 8) + Math.round(v.bytes / 1024) + ' KB');
});

console.log('\n=== 接口调用（按发生顺序）===');
report.api.forEach(function(a) {
  console.log('  ' + pad(a.at + 'ms', 9) + pad(a.ms + 'ms', 9) + a.p);
});

console.log('\n=== 传输体积 TOP 20（定位首屏带宽去向）===');
report.top.forEach(function(r) {
  console.log('  ' + pad(r.kb + 'KB', 9) + pad(r.t, 10) + pad(r.ms + 'ms', 8) + r.p);
});

const appControl = report.api.filter(function(a){ return a.p.indexOf('system/app-control') !== -1; });
console.log('\n=== 关键结论 ===');
console.log('  /api/system/app-control 调用次数 = ' + appControl.length + (appControl.length === 1 ? ' ✅（已收敛为 1 次）' : (appControl.length === 0 ? '（未调用，可能未进入桌面）' : ' ❌（仍重复）')));
console.log('  首屏接口总数 = ' + report.apiCount);

// 桌面截图：验收图标渲染与整体版式（探针能登录，所以这是真实的桌面首屏）
try {
  const shotDir = join(REPO, 'logs', 'perf');
  mkdirSync(shotDir, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(shotDir, 'desktop-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.png');
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('\n  桌面截图 → ' + shotPath);
} catch (e) {
  console.log('\n  （截图失败：' + e.message + '）');
}

ws.close();
chrome.kill();
