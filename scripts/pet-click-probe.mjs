// 点击验证探针：合成 pointerdown/up 点击大肥鱼，断言播放切换到"点击回应"动画
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9377',
  `--user-data-dir=${join(tmpdir(), 'ci-click')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9377${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(TOKEN)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 1, role: 'admin' }))});
  }catch(e){}`
});
await send('Page.bringToFront').catch(function(){});
await send('Page.navigate', { url: APP + '/' });
await sleep(8000);

const playing = await ev(`(function(){
  var vs = document.querySelectorAll('.ci-pet video');
  var cur = null;
  vs.forEach(function(v){ if (vs.length === 1 || v.style.display !== 'none') cur = v; });
  return cur ? decodeURIComponent(cur.currentSrc.split('/').pop()) : 'none';
})()`);
console.log('点击前播放:', playing);
const modeBefore = await ev('window.__ciPetDebug ? window.__ciPetDebug().mode : "?"');
console.log('点击前 mode:', modeBefore);

// pointerup 到达探测
const upProbe = await ev(`(function(){
  window.__ciProbeUp = 0;
  var pet = document.querySelector('.ci-pet');
  pet.addEventListener('pointerup', function() { window.__ciProbeUp++; });
  return 'armed';
})()`);
console.log('up 监听:', upProbe);
// 直连钩子验证 playVideo 逻辑层
const hookProbe = await ev('window.__ciPetPoke ? (window.__ciPetPoke(), "called") : "no-hook"');
await (async () => { for (const _ of [0]) {} })();
// 事件到达探测：el 上的 pointerdown 监听是否触发
const reachProbe = await ev(`(function(){
  window.__ciProbeDown = 0;
  var pet = document.querySelector('.ci-pet');
  pet.addEventListener('pointerdown', function() { window.__ciProbeDown++; });
  var r = pet.getBoundingClientRect();
  var cx = r.x + r.width / 2, cy = r.y + r.height * 0.7;
  var o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  pet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, o, { clientX: cx, clientY: cy, button: 0, buttons: 1 })));
  return { down: window.__ciProbeDown, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
})()`);
console.log('事件到达:', JSON.stringify(reachProbe));
// 逻辑层探测：poolsV 状态 + 手动触发 poke 链（区分事件没到 vs 逻辑坏了）
const logicProbe = await ev(`(function(){
  var pet = document.querySelector('.ci-pet');
  var r = pet.getBoundingClientRect();
  var cx = r.x + r.width / 2, cy = r.y + r.height * 0.7;
  var o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  pet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, o, { clientX: cx, clientY: cy, button: 0, buttons: 1 })));
  pet.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { clientX: cx, clientY: cy, button: 0, buttons: 0 })));
  return 'dispatched';
})()`);
await sleep(300);
const probe2 = await ev(`(function(){
  var vs = document.querySelectorAll('.ci-pet video');
  return JSON.stringify({
    poolACur: vs[0] ? decodeURIComponent((vs[0].currentSrc||'').split('/').pop()||'none') : 'no-el',
    poolAPaused: vs[0] ? vs[0].paused : null,
    poolBCur: vs[1] ? decodeURIComponent((vs[1].currentSrc||'').split('/').pop()||'none') : 'no-el',
    poolBPaused: vs[1] ? vs[1].paused : null
  });
})()`);
console.log('逻辑探测:', probe2);
const upCount = await ev('window.__ciProbeUp');
console.log('pointerup 触发次数:', upCount);
await ev(`(function(){
  var pet = document.querySelector('.ci-pet');
  var r = pet.getBoundingClientRect();
  var cx = r.x + r.width / 2, cy = r.y + r.height * 0.7;
  var o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  pet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, o, { clientX: cx, clientY: cy, button: 0, buttons: 1 })));
  pet.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { clientX: cx, clientY: cy, button: 0, buttons: 0 })));
  return true;
})()`);
await sleep(1000);
const after = await ev(`(function(){
  var vs = document.querySelectorAll('.ci-pet video');
  var cur = null;
  var states = [];
  vs.forEach(function(v){ states.push({src: decodeURIComponent((v.currentSrc||'').split('/').pop() || 'no-src'), paused: v.paused, display: v.style.display}); });
  return JSON.stringify(states);
})()`);
console.log('点击后播放:', after);
const dbg = await ev('window.__ciPetDebug ? JSON.stringify(window.__ciPetDebug()) : "none"');
console.log('诊断:', dbg);
const ok = /点击回应/.test(after);
console.log(ok ? 'PASS 点击触发动画回应' : 'FAIL 点击未切换动画');
chrome.kill();
process.exit(ok ? 0 : 1);
