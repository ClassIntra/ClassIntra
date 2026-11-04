// 桌面卡顿归因探针（2026-11-02）
// 用 6x CPU 节流模拟安卓9/Chrome80 平板，对桌面首屏做四场景 A/B/C/D 采样：
//   A 基线              B 强制 data-perf="low"（玻璃全平）
//   C 抑制桌宠 overlay   D B+C
// 指标：rAF FPS / 长任务总时长 / 活跃动画数 / 生效毛玻璃元素数 / 视频播放数 / iframe 数
// 用法：node scripts/perf-desktop-audit.mjs [user_id]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9347;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const THROTTLE = 6;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 没读到 JWT_SECRET'); process.exit(1); }
const isAdmin = USER_ID === '999999' ? 1 : 0;
const token = jwt.sign({ user_id: USER_ID, is_admin: isAdmin, is_class_admin: isAdmin, role: isAdmin ? 'admin' : 'user' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-perf-audit-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__audit = { longTasks: [] };
    try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__audit.longTasks.push(Math.round(e.duration)); }); }).observe({ entryTypes: ['longtask'] }); } catch(e) {}`
});
await send('Page.navigate', { url: APP + '/' });

// 等桌面 + 启动屏离场
for (let i = 0; i < 100; i++) {
  await sleep(300);
  const ok = await evalJS(`!!document.querySelector('.desktop .desktop-pages .app-icon') && !document.getElementById('app-loading')`);
  if (ok) break;
}
await sleep(2500); // 结算首屏懒加载
await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

// 采样函数：3s 内 rAF 帧数 + 长任务 + 结构统计
async function sample(label) {
  const out = await evalJS(`new Promise(function(resolve){
    var frames = 0, start = performance.now();
    window.__audit.longTasks.length = 0;
    function tick(){ frames++; if (performance.now() - start < 3000) requestAnimationFrame(tick); else collect(); }
    function collect(){
      var lt = window.__audit.longTasks.slice();
      requestAnimationFrame(function(){
        var glass = 0, anims = (document.getAnimations ? document.getAnimations().length : -1);
        var all = document.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var cs = getComputedStyle(all[i]);
          var bf = cs.webkitBackdropFilter || cs.backdropFilter;
          if (bf && bf !== 'none') glass++;
        }
        var vids = Array.prototype.filter.call(document.querySelectorAll('video'), function(v){ return !v.paused; }).length;
        resolve({
          fps: Math.round(frames / 3),
          longTotal: lt.reduce(function(a,b){ return a + b; }, 0),
          longMax: lt.length ? Math.max.apply(null, lt) : 0,
          longCount: lt.length,
          anims: anims, glass: glass,
          videosPlaying: vids,
          iframes: document.querySelectorAll('iframe').length
        });
      });
    }
    requestAnimationFrame(tick);
  })`);
  console.log(`  ${label}`, JSON.stringify(out));
  return out;
}

console.log('\n=== 场景采样（CPU 6x 节流，每场景 3s）===');
const A = await sample('A 基线').then(v => v);
await evalJS(`document.documentElement.setAttribute('data-perf','low'); true`);
await sleep(600);
const B = await sample('B 低配降级');
await evalJS(`document.documentElement.removeAttribute('data-perf'); document.body.classList.add('ci-pet-suppressed'); true`);
await sleep(600);
const C = await sample('C 抑制桌宠');
await evalJS(`document.documentElement.setAttribute('data-perf','low'); true`);
await sleep(600);
const D = await sample('D 降级+抑制桌宠');

console.log('\n=== 归因 ===');
console.log(`  毛玻璃: ${A.glass} 处生效；低配降级后 ${B.glass} 处`);
console.log(`  活跃动画: ${A.anims}（降级后 ${B.anims}）`);
console.log(`  播放中的 video: ${A.videosPlaying}（抑制桌宠后 ${C.videosPlaying}）`);
console.log(`  FPS: 基线 ${A.fps} → 仅降级 ${B.fps} → 仅抑制桌宠 ${C.fps} → 两者 ${D.fps}`);
console.log(`  长任务总耗时: 基线 ${A.longTotal}ms → 仅降级 ${B.longTotal}ms → 仅抑制桌宠 ${C.longTotal}ms → 两者 ${D.longTotal}ms`);
console.log(`  iframe 数: ${A.iframes}`);

chrome.kill();
process.exit(0);
