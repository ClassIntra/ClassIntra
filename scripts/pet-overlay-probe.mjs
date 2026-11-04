// 桌面悬浮桌宠（overlay）体检：它到底有没有挂载、为什么没出现
// 用法：node scripts/_pet-overlay-check.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 没读到 JWT_SECRET'); process.exit(1); }

// 用真实学生账号形状的 uid 更容易撞到「已领养」的宠物；999999 是管理员兜底
const USER_ID = process.argv[2] || '999999';
const token = jwt.sign({ user_id: USER_ID, is_admin: USER_ID === '999999' ? 1 : 0, role: 'user' }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9341',
  `--user-data-dir=${join(tmpdir(), 'ci-overlay-check-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1080,920', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9341${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
const LOGS = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    LOGS.push('❌ 异常: ' + ((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    LOGS.push('⚠️ console.' + m.params.type + ': ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0] };
  return r.result.value;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('token', ${JSON.stringify(token)});}catch(e){}`
  });
  await send('Page.navigate', { url: APP + '/' });
  await sleep(6000);

  const host = await ev(`(function(){
    var h = document.querySelector('.ci-market-overlay-host');
    if (!h) return { mounted: false };
    var kids = Array.prototype.slice.call(h.children).map(function(c){
      var r = c.getBoundingClientRect();
      var cs = getComputedStyle(c);
      return { cls: c.className, w: Math.round(r.width), h: Math.round(r.height),
               left: Math.round(r.left), top: Math.round(r.top),
               display: cs.display, opacity: cs.opacity, pe: cs.pointerEvents };
    });
    return { mounted: true, z: getComputedStyle(h).zIndex, kids: kids };
  })()`);
  console.log('悬浮层宿主:', JSON.stringify(host, null, 1));

  const dbg = await ev(`window.__ciPetDebug ? JSON.stringify(window.__ciPetDebug()) : 'no-debug-api'`);
  console.log('桌宠自诊断:', dbg);

  const petSelf = await ev(`(function(){
    var p = document.querySelector('.ci-pet');
    if (!p) return 'no .ci-pet element';
    var r = p.getBoundingClientRect();
    var cs = getComputedStyle(p);
    var v = p.querySelector('video');
    return JSON.stringify({
      rect: { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) },
      position: cs.position, zIndex: cs.zIndex, display: cs.display,
      opacity: cs.opacity, visibility: cs.visibility, transform: cs.transform,
      parent: p.parentNode ? p.parentNode.className || p.parentNode.tagName : null,
      video: v ? { src: decodeURIComponent(v.currentSrc || v.src || '').slice(-30), paused: v.paused, ready: v.readyState, vw: v.videoWidth, vh: v.videoHeight, op: getComputedStyle(v).opacity } : null
    });
  })()`);
  console.log('桌宠本体:', petSelf);

  const vids = await ev(`(function(){
    var p = document.querySelector('.ci-pet');
    if (!p) return 'no-pet';
    var vs = Array.prototype.slice.call(p.querySelectorAll('video'));
    return JSON.stringify(vs.map(function(v){
      var cs = getComputedStyle(v);
      var r = v.getBoundingClientRect();
      return { op: cs.opacity, z: cs.zIndex, paused: v.paused, ready: v.readyState,
               w: Math.round(r.width), h: Math.round(r.height),
               src: decodeURIComponent(v.currentSrc || '').split('/').pop(),
               loop: v.loop, muted: v.muted, autoplay: v.autoplay, t: +v.currentTime.toFixed(2) };
    }));
  })()`);
  console.log('视频缓冲:', vids);

  const petEl = await ev(`(function(){
    var h = document.querySelector('.ci-market-overlay-host');
    if (!h) return 'no-host';
    var all = h.querySelectorAll('*');
    return 'count=' + all.length + ' html=' + h.innerHTML.slice(0, 200);
  })()`);
  console.log('悬浮层内容:', petEl);

  // 路由感知：进入 /pet 后悬浮层应当隐藏（页面里已经有一只在场景里了）
  await ev(`(function(){ history.pushState({}, '', '/pet'); window.dispatchEvent(new Event('ci-route-changed')); return 1; })()`);
  await sleep(600);
  const onPet = await ev(`(function(){
    var p = document.querySelector('.ci-pet');
    return p ? (getComputedStyle(p).display + ' / ' + p.style.display) : 'no-pet';
  })()`);
  console.log('在 /pet 上的悬浮层 display:', onPet);

  await ev(`(function(){ history.pushState({}, '', '/'); window.dispatchEvent(new Event('ci-route-changed')); return 1; })()`);
  await sleep(600);
  const onHome = await ev(`(function(){
    var p = document.querySelector('.ci-pet');
    return p ? (getComputedStyle(p).display + ' / ' + p.style.display) : 'no-pet';
  })()`);
  console.log('回到 / 的悬浮层 display:', onHome);

  console.log('--- 控制台/异常 ---');
  console.log(LOGS.length ? LOGS.slice(0, 12).join('\n') : '（无）');
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
