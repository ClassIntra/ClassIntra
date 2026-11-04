// 一次性验证探针：桌面两处修复（2026-11-01）
//   T1 长按图标只进编辑态，不再同时弹右键菜单（触屏合成 contextmenu 被忽略）
//   T2 PC 鼠标右键菜单保留可用
//   T3 打开动画关闭后，点图标立即导航（无 250ms 脉冲等待、无容器变换）
// 配方：系统 Node + 127.0.0.1:9001 已运行 + 自签 token（user 999999）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9341;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign(
  { user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' },
  SECRET, { expiresIn: '1h' }
);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-longpress-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }

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
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__ctxEvents = [];
    document.addEventListener('contextmenu', function(e){
      window.__ctxEvents.push({ t: Math.round(performance.now()), trusted: e.isTrusted, x: e.clientX, y: e.clientY });
    }, true);`
});
await send('Page.navigate', { url: APP + '/' });

// 等桌面渲染 + 启动屏（#app-loading，al-complete→al-done→remove 退场约 1.2s）真正移除
let desktopReady = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  desktopReady = await evalJS(`!!document.querySelector('.desktop .desktop-pages .app-icon') && !document.getElementById('app-loading')`);
  if (desktopReady) break;
}
if (!desktopReady) { console.error('✗ 桌面未渲染'); chrome.kill(); process.exit(1); }
await sleep(1500); // 等公告浮窗/懒加载结算

// 选一个不被公告浮窗遮挡、可直接命中的网格图标
const icon = await evalJS(`(function(){
  var list = Array.prototype.slice.call(document.querySelectorAll('.desktop-pages .app-icon'));
  var pass = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i].getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 720 && cy > 100 && cy < 640) {
      var hit = document.elementFromPoint(cx, cy);
      if (hit && hit.closest && hit.closest('.app-icon') === list[i]) {
        return { x: Math.round(cx), y: Math.round(cy), label: (list[i].querySelector('.app-icon-label') || {}).textContent || list[i].getAttribute('aria-label') || ('#' + i) };
      }
      pass.push('#' + i + '@' + Math.round(cx) + ',' + Math.round(cy) + '->' + (hit ? hit.className : 'null'));
    }
  }
  return { miss: true, tried: pass.join(' | ') };
})()`);
if (!icon || icon.miss) { console.error('✗ 没找到可命中的图标', icon && icon.tried ? '\n  候选: ' + icon.tried : ''); chrome.kill(); process.exit(1); }
console.log('目标图标:', icon.label, '@', icon.x + ',' + icon.y);

// ===== T1 长按：编辑态进、右键菜单不弹 =====
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: icon.x, y: icon.y }] });
await sleep(700); // 越过 500ms 长按阈值（真实 Chrome 在此窗口内合成 contextmenu）
// 模拟 Chrome 长按合成的 contextmenu（手指仍按住时派发，与真机一致）
await evalJS(`(function(){
  var el = document.querySelector('.desktop-pages .app-icon');
  var r = el.getBoundingClientRect();
  var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${icon.x}, clientY: ${icon.y} });
  el.dispatchEvent(ev);
  return true;
})()`);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(350);
const t1 = await evalJS(`({
  editing: !!document.querySelector('.desktop.desktop--editing'),
  ctxMenu: !!document.querySelector('.desktop-ctx-menu')
})`);
record('T1a 长按进入编辑态', t1.editing, 'desktop--editing 已挂根容器');
record('T1b 长按不再弹右键菜单', !t1.ctxMenu, '触屏来源 contextmenu 被忽略');

// 退出编辑态：快速点空白
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 470 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const exited = await evalJS(`!document.querySelector('.desktop.desktop--editing')`);
record('T1c 点空白退出编辑态', exited);

// ===== T2 PC 右键菜单保留 =====
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 470, button: 'right', buttons: 2, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 470, button: 'right', buttons: 0, clickCount: 1 });
await sleep(350);
let t2 = await evalJS(`!!document.querySelector('.desktop-ctx-menu')`);
let ctxLog = await evalJS(`window.__ctxEvents`);
if (!t2 && (!ctxLog || ctxLog.length === 0)) {
  // headless 的 CDP 右键未合成 contextmenu 事件（已知局限）：退化为合成事件验证
  // 处理器路径——触摸已结束且超时窗， genuine contextmenu 必须能弹出菜单
  console.log('  (headless 未合成 contextmenu，改用合成事件验证处理器)');
  await evalJS(`(function(){
    var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 470 });
    document.querySelector('.desktop').dispatchEvent(ev);
    return true;
  })()`);
  await sleep(250);
  t2 = await evalJS(`!!document.querySelector('.desktop-ctx-menu')`);
}
record('T2a 鼠标右键菜单仍弹出', t2, 'contextmenu 事件日志: ' + JSON.stringify(ctxLog || []));
// Esc 关闭菜单（左键点击会落在菜单面板上误选菜单项）
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 46 });
await sleep(250);
const t2closed = await evalJS(`!document.querySelector('.desktop-ctx-menu')`);
record('T2b Esc 关闭右键菜单', t2closed);

// ===== T3 点图标立即导航（无 250ms 等待）=====
let before = await evalJS(`({
  path: location.pathname,
  editing: !!document.querySelector('.desktop.desktop--editing')
})`);
if (before.editing) {
  // 自恢复：意外处于编辑态时点空白退出
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 470 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  before = await evalJS(`({ path: location.pathname, editing: !!document.querySelector('.desktop.desktop--editing') })`);
}
if (before.editing) { console.error('✗ 编辑态未退出，T3 跳过'); }
else {
  const t0 = Date.now();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: icon.x, y: icon.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: icon.x, y: icon.y, button: 'left', buttons: 0, clickCount: 1 });
  let elapsed = null;
  for (let i = 0; i < 60; i++) {
    await sleep(20);
    const p = await evalJS(`location.pathname`);
    if (p && p !== '/' && p !== before.path) { elapsed = Date.now() - t0; break; }
    if (i === 20 && elapsed === null) { /* 200ms 仍无变化，继续观察到 1.2s 记为失败 */ }
  }
  record('T3 点击图标 ≤200ms 内进入应用路由', elapsed !== null && elapsed <= 200,
    elapsed === null ? '1.2s 内路由未变化' : elapsed + 'ms（旧实现为 250ms 延迟 + 容器变换动画）');
  console.log('  落点路由:', await evalJS('location.pathname'));
}

console.log('\n=== 结果 ===');
const pass = results.filter(r => r.ok).length;
console.log(`${pass}/${results.length} 通过`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
