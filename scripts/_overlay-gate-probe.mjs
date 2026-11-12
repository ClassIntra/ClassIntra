/**
 * 悬浮层门禁探针：登录页 / 封禁页 不应出现任何悬浮层（桌宠）。
 * 用 CDP 真浏览器跑三种身份：未登录 → 正常登录 → 被封禁。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/package.json');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });
const USER_OK = JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 1, role: 'admin' });
const USER_BANNED = JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 0, role: 'student', status: 'disabled' });

const PORT = 9413;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + join(tmpdir(), 'ci-overlay-gate'),
  '--no-first-run', '--disable-extensions', '--mute-audio', '--window-size=1024,768', 'about:blank'
], { stdio: 'ignore' });

const get = async (p) => (await fetch('http://127.0.0.1:' + PORT + p)).json();
for (let i = 0; i < 80; i++) { try { await get('/json/version'); break; } catch { await sleep(400); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  ✓ ' + l + (x ? '  ' + x : '')); } else { fail++; console.log('  ✗ ' + l + (x ? '  ' + x : '')); } };

const probe = async (label) => {
  const r = await ev(`(function(){
    var hosts = Array.prototype.slice.call(document.querySelectorAll('.ci-market-overlay-host'));
    var vis = hosts.filter(function(h){ return getComputedStyle(h).display !== 'none'; });
    var petRoots = Array.prototype.slice.call(document.querySelectorAll('.ci-pet'));
    var petVisible = petRoots.filter(function(p){
      var s = getComputedStyle(p);
      return s.display !== 'none' && s.visibility !== 'hidden' && p.getBoundingClientRect().width > 0;
    }).length;
    return JSON.stringify({ route: location.pathname, hosts: hosts.length, visibleHosts: vis.length,
      petRoots: petRoots.length, petVisible: petVisible });
  })()`);
  console.log('  [' + label + ']', r);
  return JSON.parse(r);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });

  // 1) 未登录 → /login
  await send('Page.navigate', { url: APP + '/login' });
  await sleep(500);
  await ev(`(function(){ try{ localStorage.clear(); }catch(e){} return 1; })()`);
  await send('Page.navigate', { url: APP + '/login' });
  await sleep(6000);
  let a = await probe('未登录 /login');
  ok(a.route === '/login', '停在登录页', a.route);
  ok(a.petVisible === 0 && a.visibleHosts === 0, '登录页不显示桌宠', 'visibleHosts=' + a.visibleHosts + ' pet=' + a.petVisible);

  // 2) 正常登录 → 桌面
  await ev(`(function(){
    localStorage.setItem('token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('user', ${JSON.stringify(USER_OK)});
    return 1;
  })()`);
  await send('Page.navigate', { url: APP + '/' });
  await sleep(9000);
  let b = await probe('已登录 /');
  ok(b.route === '/', '回到桌面', b.route);
  ok(b.petVisible > 0, '登录后桌宠恢复显示', 'pet=' + b.petVisible);

  // 2.4) 性能细节：合成层提示 / 是否挂在宿主容器内 / 位移用 translate3d
  {
    const perf = await ev(`(function(){
      var pet = document.querySelector('.ci-pet');
      var host = document.querySelector('.ci-market-overlay-host');
      if (!pet) return null;
      var cs = getComputedStyle(pet);
      return JSON.stringify({ willChange: cs.willChange, insideHost: !!(host && host.contains(pet)),
        transform: pet.style.transform || '' });
    })()`);
    console.log('  渲染细节:', perf);
    const P2 = perf ? JSON.parse(perf) : null;
    ok(!!P2 && String(P2.willChange).indexOf('transform') >= 0, '桌宠已提升为合成层（will-change）', P2 ? P2.willChange : '');
    ok(!!P2 && P2.insideHost, '桌宠挂在宿主容器内（门禁可生效）');
    ok(!!P2 && /translate3d/.test(P2.transform), '位移走 translate3d', P2 ? P2.transform : '');
  }

  // 2.45) 真拖拽：弹簧跟手改造后必须仍然能拖动
  {
    const before = await ev(`document.querySelector('.ci-pet').style.transform`);
    const r = await ev(`(function(){
      var b = document.querySelector('.ci-pet').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
    })()`);
    const C = JSON.parse(r);
    // 往「空间更大的一侧」拖：贴在左边缘时继续往左拖会被 clamp 住，看起来像拖不动
    const dir = C.x < 320 ? 1 : -1;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: C.x, y: C.y, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: C.x + dir * i * 12, y: C.y - i * 6, button: 'left', buttons: 1 });
      await sleep(20);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: C.x + dir * 72, y: C.y - 36, button: 'left', buttons: 0 });
    await sleep(700);
    const after = await ev(`document.querySelector('.ci-pet').style.transform`);
    const moved = before !== after;
    ok(moved, '拖拽仍然跟手（位置变化）', String(after).slice(0, 40));
  }

  // 2.48) 真实触摸长按 → 菜单必须出现、在手指附近、且可点
  {
    const r = await ev(`(function(){
      var b = document.querySelector('.ci-pet').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
    })()`);
    const C2 = JSON.parse(r);
    // ⚠️ 不打开触摸模拟，Input.dispatchTouchEvent 会被直接丢弃（表现为「长按没反应」）
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await ev(`window.__errs = []; window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); }); 1`);
    await ev(`(function(){
      window.__hits = [];
      var pet = document.querySelector('.ci-pet');
      ['pointerdown','pointerup','pointercancel','pointermove','contextmenu'].forEach(function(t){
        pet.addEventListener(t, function(e){
          window.__hits.push(t + ':' + (e.pointerType || '') + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY));
        }, true);
      });
      return 1;
    })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: C2.x, y: C2.y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] });
    await sleep(900);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    let dbg = await ev(`(function(){ try { return JSON.stringify(window.__ciPetDebug && window.__ciPetDebug()); } catch(e){ return 'err'; } })()`);
    console.log('  桌宠调试态:', dbg);
    if (!(await ev(`!!document.querySelector('.ci-pet-menu')`))) {
      // 兜底再试一次（部分环境第一次触摸会被吞）
      console.log('  · 首次长按未出菜单，重试一次');
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: C2.x, y: C2.y, radiusX: 6, radiusY: 6, force: 1, id: 2 }] });
      await sleep(1000);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(300);
    }
    const m = await ev(`(function(){
      var menu = document.querySelector('.ci-pet-menu');
      if (!menu) return null;
      var mr = menu.getBoundingClientRect();
      var btns = menu.querySelectorAll('button');
      var first = btns[0] ? btns[0].getBoundingClientRect() : null;
      var top = first ? document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2) : null;
      return JSON.stringify({ items: btns.length, w: Math.round(mr.width), h: Math.round(mr.height),
        left: Math.round(mr.left), top: Math.round(mr.top),
        pointer: getComputedStyle(menu).pointerEvents,
        hitInside: !!(top && (top === menu || menu.contains(top))) });
    })()`);
    console.log('  长按菜单:', m, 'errs=', await ev('JSON.stringify(window.__errs || [])'));
    // 留一张证据截图（菜单在手指上方、完整可见）
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync('logs/pet-ui', { recursive: true });
      writeFileSync('logs/pet-ui/pet-menu.png', Buffer.from(shot.data, 'base64'));
      console.log('  📸 logs/pet-ui/pet-menu.png');
    } catch (e) {}
    console.log('  指针事件:', await ev('JSON.stringify((window.__hits || []).slice(0, 12))'));
    console.log('  长按回调:', await ev('JSON.stringify(window.__lpDbg || null)'), 'lpErr=', await ev('String(window.__lpErr || "")'));
    console.log('  菜单落点:', await ev('JSON.stringify(window.__menuDbg || null)'));
    console.log('  关闭栈:', await ev('JSON.stringify((window.__hideCalls || []).slice(0,3))'));
    const M = m ? JSON.parse(m) : null;
    ok(!!M, '触摸长按能打开菜单');
    ok(!!M && M.items >= 5, '菜单项齐全', M ? M.items + ' 项' : '');
    ok(!!M && M.w > 80 && M.h > 120, '菜单有实际尺寸（不再是裸按钮）', M ? M.w + 'x' + M.h : '');
    // 触摸时菜单刻意弹在手指**上方**（避开指尖遮挡，也避开抬手幽灵点击），
    // 所以断言的是「水平对齐 + 完整在视口内 + 不压住手指」，而不是距离阈值
    const okX = !!M && Math.abs((M.left + M.w / 2) - C2.x) <= 90;
    const okInView = !!M && M.left >= 0 && M.top >= 0 && M.left + M.w <= 1024 && M.top + M.h <= 768;
    const coversFinger = !!M && C2.x >= M.left && C2.x <= M.left + M.w && C2.y >= M.top && C2.y <= M.top + M.h;
    ok(okX && okInView && !coversFinger, '菜单弹在手指上方且完整可见',
      M ? ('menu@' + M.left + ',' + M.top + ' ' + M.w + 'x' + M.h + ' finger@' + C2.x + ',' + C2.y) : '');
    ok(!!M && M.pointer === 'auto' && M.hitInside, '菜单可点（pointer-events:auto）');
    const extra = await ev(`JSON.stringify({
      seps: document.querySelectorAll('.ci-pet-menu-sep').length,
      bubble: !!document.querySelector('.ci-pet-bubble.ci-pet-bubble--show')
    })`);
    const EX = JSON.parse(extra);
    ok(EX.seps >= 1, '菜单有分组分隔线', EX.seps + ' 条');
    ok(!EX.bubble, '开菜单时气泡已收起');
    // 点第一项 → 菜单应关闭（先等过长按守卫窗口）
    if (M) {
      await sleep(500);
      await ev(`(function(){ var b=document.querySelector('.ci-pet-menu button'); if(b) b.click(); return 1; })()`);
      await sleep(300);
      const closed = await ev(`!document.querySelector('.ci-pet-menu')`);
      ok(closed, '点菜单项后菜单关闭');
    }
  }

  // 2.49) 鼠标右键（桌面用户）同样能开菜单
  {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const r = await ev(`(function(){
      var b = document.querySelector('.ci-pet').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
    })()`);
    const R2 = JSON.parse(r);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: R2.x, y: R2.y, button: 'right', clickCount: 1, buttons: 2 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: R2.x, y: R2.y, button: 'right', buttons: 0 });
    await sleep(300);
    const n = await ev(`document.querySelectorAll('.ci-pet-menu button').length`);
    ok(n >= 5, '鼠标右键也能打开菜单', n + ' 项');
    await ev(`(function(){ var m=document.querySelector('.ci-pet-menu'); if(m) m.parentNode.removeChild(m); return 1; })()`);
  }

  // 2.5) 挂进宿主容器后，交互不能丢（容器是 pointer-events:none）
  {
    const hit = await ev(`(function(){
      var pet = document.querySelector('.ci-pet');
      if (!pet) return null;
      var r = pet.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var top = document.elementFromPoint(cx, cy);
      var style = getComputedStyle(pet);
      return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height),
        pointer: style.pointerEvents,
        hitInside: !!(top && (top === pet || pet.contains(top))) });
    })()`);
    console.log('  交互命中:', hit);
    const H = hit ? JSON.parse(hit) : null;
    ok(!!H && H.w > 0 && H.h > 0, '桌宠仍在视口内且尺寸正常', H ? H.w + 'x' + H.h : 'null');
    ok(!!H && H.pointer === 'auto', '桌宠自身 pointer-events 仍为 auto', H ? H.pointer : '');
    ok(!!H && H.hitInside, '点击能命中桌宠（容器 pointer-events:none 没吞掉交互）');
  }

  // 3) 封禁态：真实封禁账号不好造，用同一入口（App 的 syncOverlayGate）验证整条链路
  const hooked = await ev(`typeof window.__ciOverlayGate === 'function'`);
  ok(hooked, '门禁钩子可用（App 已挂载）');
  if (hooked) {
    await ev(`window.__ciOverlayGate({ name: 'Banned' })`);
    await sleep(300);
    let c = await probe('模拟封禁态');
    ok(c.petVisible === 0 && c.visibleHosts === 0, '封禁态隐藏桌宠', 'visibleHosts=' + c.visibleHosts + ' pet=' + c.petVisible);
    await ev(`window.__ciOverlayGate({ name: 'Desktop', path: '/' })`);
    await sleep(300);
    let d = await probe('恢复桌面');
    ok(d.petVisible > 0, '恢复后桌宠回来', 'pet=' + d.petVisible);
  }

  console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项（通过 ' + pass + '）' : '✓ 全部通过：' + pass + ' 项'));
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('探针异常：', e && e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (e) {}
}
