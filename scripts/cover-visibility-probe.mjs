// 封面可见性验证：复现「封面有时候加载不出来」的场景并确认修复
// ============================================================
// 旧 bug 链路：overview 静默刷新带回**同一张**封面 → coverNatural 被清零 →
//   img 的 src 没变、不会再触发 load → coverImgStyle 恒为 opacity:0 → 封面"消失"。
// 本探针：设置封面 → 打开主页 → 等图片与 overview 都到位后，
//   检查 opacity / coverNatural / 完成态；再强制二次进入（SWR 命中同一张图）复核。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const ME = '251801';
const OUT = join(tmpdir(), 'ci-cover-fix');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let S = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { S = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: ME }, S, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const HASH = '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9431',
  `--user-data-dir=${join(tmpdir(), 'ci-cover-fix-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const get = async (p) => (await fetch(`http://127.0.0.1:9431${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});}catch(e){}`
});

const READ = `(function(){
  var vm = document.querySelector('.profile-page') ? document.querySelector('.profile-page').__vue__ : null;
  var img = document.querySelector('.profile-cover-img');
  return {
    hasCover: vm ? vm.cover.has_cover : null,
    naturalW: vm ? vm.coverNatural.w : null,
    imgOpacity: img ? getComputedStyle(img).opacity : null,
    imgComplete: img ? img.complete : null,
    imgVisibleH: img ? Math.round(img.getBoundingClientRect().height) : null
  };
})()`;

// 设封面（跑完恢复原状）
const before = await (await fetch(APP + '/api/user/cover/' + ME, { headers: H })).json();
const hadCover = !!(before.data && before.data.has_cover);
await fetch(APP + '/api/user/cover', { method: 'PUT', headers: H, body: JSON.stringify({ hash: HASH, crop: { zoom: 1.4, ox: 0.1, oy: -0.15 } }) });

// 第一次进入：图片可能先于 overview 响应加载完（这正是出 bug 的时序）
await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(6000);
console.log('1 首次进入:', JSON.stringify(await ev(READ)));
await shot('1-first.png');

// 二次进入：SWR 缓存直出 + 静默刷新（同图 → 旧代码在这里把封面弄没）
await send('Page.navigate', { url: APP + '/community' });
await sleep(2500);
await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(5000);
console.log('2 二次进入(SWR 同图):', JSON.stringify(await ev(READ)));
await shot('2-second.png');

// 三次：模拟"改完资料回来"（loadCover 路径，同图重新裁切也不该消失）
await ev(`(function(){
  var vm = document.querySelector('.profile-page').__vue__;
  if (vm) vm.loadCover();
})()`);
await sleep(2500);
console.log('3 loadCover 同图刷新:', JSON.stringify(await ev(READ)));

// 清理
if (!hadCover) {
  await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });
  console.log('（已恢复：原本无封面）');
} else {
  console.log('（该账号原本有封面，保持不动）');
}
ws.close();
chrome.kill();
console.log('DONE ->', OUT);
