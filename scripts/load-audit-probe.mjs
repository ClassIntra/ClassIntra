// 加载审计：请求数 / 首屏就绪耗时 / 二次进入是否命中缓存 / 弱网下的骨架屏
// 用法：node scripts/load-audit-probe.mjs [--throttle]
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const ME = process.env.PROBE_USER || '251801';
const OUT = join(tmpdir(), 'ci-load-audit');
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
  '--headless=new', '--remote-debugging-port=9423',
  `--user-data-dir=${join(tmpdir(), 'ci-load-audit-v2')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const get = async (p) => (await fetch(`http://127.0.0.1:9423${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
let reqs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Network.requestWillBeSent' && /\/api\//.test(m.params.request.url)) {
    reqs.push({ url: m.params.request.url.replace(APP, ''), start: m.params.timestamp, id: m.params.requestId });
  }
  if (m.method === 'Network.loadingFinished') {
    const r = reqs.find((x) => x.id === m.params.requestId);
    if (r) r.end = m.params.timestamp;
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

function dump(label) {
  const list = reqs.filter((r) => r.end).map((r) => ({ url: r.url, ms: Math.round((r.end - r.start) * 1000) }));
  console.log(label, '| API 请求数:', list.length, '| 累计耗时:', list.reduce((a, b) => a + b.ms, 0) + 'ms');
  list.sort((a, b) => b.ms - a.ms).forEach((r) => console.log('   ', String(r.ms).padStart(5) + 'ms', r.url.slice(0, 86)));
  reqs = [];
}

const clickMine = () => ev(`(function(){
  var t = Array.prototype.slice.call(document.querySelectorAll('.sidebar-menu-item')).filter(function(x){return x.innerText.trim()==='我的'})[0];
  if (t) t.click();
})()`);
const clickTab = (name) => ev(`(function(){
  var t = Array.prototype.slice.call(document.querySelectorAll('.sidebar-menu-item')).filter(function(x){return x.innerText.trim()==='${name}'})[0];
  if (t) t.click();
})()`);
// 名片"就绪"= 已有真实数字（骨架阶段没有 .mine-stat-v）
const waitMineReady = async (limit) => {
  const t0 = Date.now();
  for (let i = 0; i < (limit || 80); i++) {
    if (await ev(`!!document.querySelector('.mine-stat-v')`)) return Date.now() - t0;
    await sleep(60);
  }
  return -1;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});}catch(e){}`
});

// ── A. 首次进入「我的」（无缓存）
await send('Page.navigate', { url: APP + '/community' });
await sleep(6500);
reqs = [];
await clickMine();
const readyA = await waitMineReady();
await sleep(800);
console.log('\n=== A. 首次进入「我的」（冷）===');
console.log('名片就绪:', readyA + 'ms');
dump('A');

// ── B. 切走再切回（应命中 10s 缓存 → 0 请求）
await clickTab('论坛');
await sleep(1200);
reqs = [];
const tB = Date.now();
await clickMine();
const readyB = await waitMineReady(20);
await sleep(900);
console.log('\n=== B. 二次切回（10s 内）===');
console.log('名片就绪:', readyB + 'ms（缓存在手，首帧即有数字）');
dump('B');

// ── C. 个人主页（先热一次再冷开，看缓存效果）
reqs = [];
await send('Page.navigate', { url: APP + '/profile/251800' });
let nameC = null;
for (let i = 0; i < 120; i++) {
  nameC = await ev(`(document.querySelector('.profile-name') || {}).innerText || null`);
  if (nameC) break;
  await sleep(60);
}
console.log('\n=== C. 个人主页首次 ===');
console.log('名字:', nameC);
dump('C1');

reqs = [];
await send('Page.navigate', { url: APP + '/community' });
await sleep(2500);
await send('Page.navigate', { url: APP + '/profile/251800' });
const tC2 = Date.now();
let nameSeen = null;
for (let i = 0; i < 60; i++) {
  nameSeen = await ev(`(document.querySelector('.profile-name') || {}).innerText || null`);
  if (nameSeen) break;
  await sleep(50);
}
console.log('\n=== D. 个人主页再次进入（SWR 缓存）===');
console.log('名字出现:', (Date.now() - tC2) + 'ms |', nameSeen);
await sleep(1200);
dump('D');

// ── E. 弱网模拟：300ms RTT 下首次进入「我的」，抓骨架屏
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 300, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 512 * 1024 / 8
});
reqs = [];
await send('Page.navigate', { url: APP + '/community' });
await sleep(9000);
reqs = [];
await clickMine();
// 逐帧采样：骨架出现过没有 / 数字什么时候到位（300ms RTT 下骨架是可见的）
let sawSkeleton = false;
let firstStatsAt = -1;
const tE = Date.now();
for (let i = 0; i < 40; i++) {
  const s = await ev(`(function(){
    return { sk: !!document.querySelector('.mine-hero--sk'),
             v: (document.querySelector('.mine-stat-v') || {}).innerText || null };
  })()`);
  if (s.sk && !sawSkeleton) {
    sawSkeleton = true;
    await shot('e-skeleton-300ms.png');
  }
  if (s.v && firstStatsAt < 0) { firstStatsAt = Date.now() - tE; break; }
  await sleep(50);
}
console.log('\n=== E. 300ms 弱网首次进入 ===');
console.log('骨架屏出现:', sawSkeleton, '| 数字到位:', firstStatsAt + 'ms');
dump('E');
await shot('e-ready.png');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

ws.close();
chrome.kill();
console.log('\nDONE ->', OUT);
