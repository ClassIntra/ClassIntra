/**
 * 拼豆真机条件探针（v0.40 诊断用）
 *
 * 与工作台探针的区别：**不使用脚本派发 PointerEvent**，而是用 CDP 的
 * Input.dispatchTouchEvent 走浏览器真实输入管线 —— 触摸、滚动竞争、pointer capture
 * 这些只有真实输入才暴露的问题，脚本里 dispatchEvent 是绕过它们的。
 *
 * 断言：
 *   1) 单击落一颗豆（读像素）
 *   2) 真实触摸拖拽画出连续线（读像素）
 *   3) 落豆延迟（touchStart → 像素可见）
 *   4) 横屏 1024×768 / dpr2 下：画板尺寸、页面是否需要滚动、关键按钮是否在首屏
 *
 * 用法：node scripts/_pet-bead-touch.mjs [width] [height] [--keep]
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const W = parseInt(process.argv[2] || '1024', 10);
const H = parseInt(process.argv[3] || '768', 10);
const require = createRequire(REPO + '/server/package.json');
const jwt = require('jsonwebtoken');

let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9411;
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + join(tmpdir(), 'ci-bead-touch'),
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=' + W + ',' + H, 'about:blank'
], { stdio: 'ignore' });

const get = async (p) => (await fetch('http://127.0.0.1:' + PORT + p)).json();
for (let i = 0; i < 80; i++) { try { await get('/json/version'); break; } catch { await sleep(400); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r.result.value;
};

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
};

async function touch(type, x, y) {
  await send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  });
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  // ⚠️ 这个探针复用 user-data-dir（省启动时间），HTTP 缓存会把上一版 entry.js/style.css
  //    喂进来 —— 改了代码却测到旧行为。一律禁缓存，保证测的是磁盘上的当前版本。
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 }
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{
      localStorage.setItem('token',${JSON.stringify(TOKEN)});
      localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 1, role: 'admin' }))});
    }catch(e){}`
  });
  await send('Page.navigate', { url: APP + '/pet' });
  await sleep(8000);

  // 上一次探针若在编辑器里被中断，会话恢复会直接把编辑器打开 —— 先回首页再测
  const inEditor = await ev(`!!document.querySelector('.ci-pet-editor')`);
  if (inEditor) {
    await ev(`(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('button'))
        .filter(function(x){ return /先不换了/.test(x.textContent || ''); })[0];
      if (b) b.click();
      return 1;
    })()`);
    await sleep(900);
  }

  // ---- 桌宠本体细节（真实账号是 64×64 像素形象）----
  {
    const info = await ev(`(function(){
      var pet = document.querySelector('.world-pet');
      if (!pet) return null;
      var cv = pet.querySelector('.world-pet-cv');
      var dpr = window.devicePixelRatio || 1;
      if (!cv) {
        var v = pet.querySelector('.world-pet-vid');
        return JSON.stringify({ kind: 'video', vid: v ? v.width + 'x' + v.height : 'none' });
      }
      var r = cv.getBoundingClientRect();
      pet.classList.add('is-flip', 'is-walk');
      var walkName = getComputedStyle(cv).animationName;
      pet.classList.remove('is-flip', 'is-walk');
      var idleName = getComputedStyle(cv).animationName;
      return JSON.stringify({ kind: 'pixel', backing: cv.width, css: Math.round(r.width), dpr: dpr,
        animWalkFlip: walkName, animIdle: idleName });
    })()`);
    console.log('  桌宠渲染:', info);
    const I = info ? JSON.parse(info) : null;
    ok(!!I, '找到桌上宠物');
    if (I && I.kind === 'pixel') {
      ok(Math.abs(I.backing / I.dpr - I.css) <= 1, '像素宠物画布与显示 1:1（不被二次缩放）',
        I.backing + '/' + I.dpr + ' vs ' + I.css);
      ok(I.animWalkFlip === 'worldWalkBobFlip', '向左走时朝向不被动画覆盖', I.animWalkFlip);
      ok(I.animIdle === 'worldBreath', '待机有呼吸动画', I.animIdle);
    }
  }

  // ---- 进编辑器：点小窝 → 换个样子 → 去画一只 ----
  // ⚠️ 点家具是「角色先走过去再开抽屉」，有时要 1s+；这里一律轮询而不是固定 sleep。
  async function waitUntil(expr, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await ev(expr);
      if (v) return v;
      await sleep(150);
    }
    return null;
  }
  const entered = await ev(`(function(){
    var bed = document.querySelector('.world-obj[data-obj="bed"]');
    if (!bed) return 'no-bed';
    bed.click();
    return 'ok';
  })()`);
  const look = await waitUntil(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(x){
      return (x.textContent||'').indexOf('换个样子') >= 0; })[0];
    if (!b) return null;
    b.click(); return 'ok';
  })()`, 6000);
  const entry = await waitUntil(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('.ci-pet-stylecard button')).filter(function(x){
      return /去画一只|再改改|换回来/.test(x.textContent||''); })[0];
    if (!b) return null;
    b.click(); return 'ok';
  })()`, 6000);
  await waitUntil(`!!document.querySelector('.ci-pet-editcanvas')`, 6000);
  await sleep(600);
  ok(entered === 'ok' && look === 'ok' && entry === 'ok', '进入拼豆编辑器',
    entered + '/' + look + '/' + entry);

  const geo = await ev(`(function(){
    var cv = document.querySelector('.ci-pet-editcanvas');
    if (!cv) return { err: 'no-canvas' };
    var r = cv.getBoundingClientRect();
    var root = document.querySelector('.ci-pethome');
    var tools = document.querySelector('.ci-pet-tools');
    var done = Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){
      return (b.textContent||'').indexOf('就它了') >= 0; })[0];
    var dr = done ? done.getBoundingClientRect() : null;
    return {
      canvas: Math.round(r.width) + 'x' + Math.round(r.height),
      canvasRect: { left: r.left, top: r.top, w: r.width, h: r.height },
      vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio,
      pageScrollH: root ? root.scrollHeight : 0,
      rootH: root ? root.clientHeight : 0,
      toolsH: tools ? Math.round(tools.getBoundingClientRect().height) : 0,
      doneY: dr ? Math.round(dr.top) : -1,
      needScroll: root ? (root.scrollHeight > root.clientHeight + 4) : false
    };
  })()`);
  // 画板格数不写死：用户可能已经用 48/64 存过作品，这里按真实 data 长度取
  const N = await ev(`(function(){
    var st = window.__ciBeadState ? window.__ciBeadState() : null;
    return st && st.data ? Math.round(Math.sqrt(st.data.length)) : 16;
  })()`);
  console.log('  几何:', JSON.stringify(geo), ' 格数=', N);
  if (geo.err) { ok(false, '画布存在'); throw new Error('no canvas'); }
  ok(true, '画板尺寸', geo.canvas + '  dpr=' + geo.dpr);
  const landscape = W >= 900;
  ok(geo.doneY > 0 && geo.doneY < geo.vh - 20, '「就它了」在首屏内', 'y=' + geo.doneY + ' vh=' + geo.vh);
  if (landscape) {
    ok(!geo.needScroll || geo.pageScrollH - geo.rootH <= 24, '横屏整页不再滚动',
      'scrollH=' + geo.pageScrollH + ' rootH=' + geo.rootH);
  } else {
    // 竖屏本来就是「画板 → 调色盘 → 工具」纵向排布，允许整页滚；
    // 但主操作条必须是吸底的，滚到工具区就能看见。
    const sticky = await ev(`(function(){
      var bar = document.querySelector('.ci-pet-pinbar');
      if (!bar) return 'no-bar';
      return getComputedStyle(bar).position;
    })()`);
    // 竖屏是 fixed（固定在视口底部），横屏是「内容区滚动 + 操作条常驻」
    ok(sticky === 'fixed' || sticky === 'sticky', '竖屏主操作吸底', 'position=' + sticky);
  }

  // ---- 真实触摸：单击 ----
  const cell = geo.canvasRect.w / N;
  const cx = geo.canvasRect.left + 3 * cell + cell / 2;
  const cy = geo.canvasRect.top + 4 * cell + cell / 2;
  await ev(`window.__ciBeadN = ${N};`);
  // 先选 A5 红
  await ev(`(function(){ var s=document.querySelectorAll('.ci-pet-swatchbox')[4]; if(s) s.click(); return 1; })()`);
  await sleep(200);
  const t0 = Date.now();
  await touch('touchStart', cx, cy);
  await touch('touchEnd', cx, cy);
  // 等像素出现（最多 600ms）
  let seen = false, waited = 0;
  while (waited < 600) {
    await sleep(30); waited += 30;
    const px = await ev(`(function(){
      var cv=document.querySelector('.ci-pet-editcanvas');
      var g=cv.getContext('2d');
      var r=cv.getBoundingClientRect(), n=window.__ciBeadN||16, c=r.width/n, k=cv.width/r.width;
      var d=g.getImageData(Math.round((3+0.8)*c*k), Math.round((4+0.5)*c*k),1,1).data;
      return d[0]+','+d[1]+','+d[2];
    })()`);
    const p = px.split(',').map(Number);
    if (p[0] > 180 && p[1] < 130) { seen = true; break; }
  }
  const diag = await ev(`(function(){
    var st = window.__ciBeadState ? window.__ciBeadState() : null;
    var cv = document.querySelector('.ci-pet-editcanvas');
    return JSON.stringify({ color: st && st.color, tool: st && st.tool,
      cell: st && st.data ? st.data.charAt(4 * 16 + 3) : null,
      n: st && st.data ? Math.sqrt(st.data.length) : null,
      paint: st && st.perf });
  })()`);
  console.log('  落豆后诊断:', diag);
  ok(seen, '真实触摸单击 → 画布出现豆子', (Date.now() - t0) + 'ms');

  // 事件计数（诊断真实输入管线里到底来了哪些事件）
  await ev(`(function(){
    window.__dbg = { down:0, move:0, up:0, cancel:0, ids:[], coal:[] };
    var st = document.querySelector('.ci-pet-boardstage');
    ['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(t){
      st.addEventListener(t, function(e){
        window.__dbg[t==='pointerdown'?'down':t==='pointermove'?'move':t==='pointerup'?'up':'cancel']++;
        if (window.__dbg.ids.length < 40) window.__dbg.ids.push(t + '#' + e.pointerId + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY));
        if (e.getCoalescedEvents) { try { window.__dbg.coal.push(e.getCoalescedEvents().length); } catch (err) { window.__dbg.coal.push(-1); } }
      }, true);
    });
    return 1;
  })()`);

  // ---- 真实触摸：拖拽 ----
  const row = Math.min(8, N - 1);
  const y0 = geo.canvasRect.top + row * cell + cell / 2;
  const x0 = geo.canvasRect.left + 1 * cell + cell / 2;
  const x1 = geo.canvasRect.left + Math.min(12, N - 2) * cell + cell / 2;
  await ev(`window.__ciBeadRow = ${row};`);
  await touch('touchStart', x0, y0);
  await sleep(60);
  console.log('  down 后状态:', await ev('JSON.stringify(window.__ciBeadState && window.__ciBeadState())'));
  console.log('  坐标换算:', await ev('JSON.stringify(window.__ciBeadState().probe(' + Math.round(x0) + ',' + Math.round(y0) + '))'));
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', x0 + (x1 - x0) * i / 10, y0);
    await sleep(12);
  }
  console.log('  move 后状态:', await ev('JSON.stringify(window.__ciBeadState && window.__ciBeadState())'));
  await touch('touchEnd', x1, y0);
  await sleep(300);
  const line = await ev(`(function(){
    var cv=document.querySelector('.ci-pet-editcanvas');
    var g=cv.getContext('2d');
    var r=cv.getBoundingClientRect(), n=window.__ciBeadN||16, c=r.width/n, k=cv.width/r.width;
    // 取豆身（+0.8 格），不是格子正中 —— 中心是豆孔，露底板色
    function hit(col){ var d=g.getImageData(Math.round((col+0.8)*c*k), Math.round(((window.__ciBeadRow||8)+0.5)*c*k),1,1).data;
      return d[0]>180 && d[1]<130; }
    return JSON.stringify([hit(1), hit(4), hit(7), hit(11)]);
  })()`);
  ok(JSON.parse(line).every(Boolean), '真实触摸拖拽 → 连续落豆', line);
  const dbg = await ev(`JSON.stringify(window.__dbg)`);
  console.log('  事件:', dbg);

  // ---- 双指捏合：应该放大，且不落豆 ----
  async function two(type, pts) {
    await send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : pts.map(function (p, i) {
        return { x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1, id: i + 1 };
      })
    });
  }
  const before = await ev(`(function(){
    return JSON.stringify({ zoom: (document.querySelector('.ci-pet-zoomlabel')||{}).textContent,
      beads: (window.__ciBeadState().data.match(/[^.]/g)||[]).length });
  })()`);
  const cxm = geo.canvasRect.left + geo.canvasRect.w / 2;
  const cym = geo.canvasRect.top + geo.canvasRect.h / 2;
  await two('touchStart', [{ x: cxm - 30, y: cym }, { x: cxm + 30, y: cym }]);
  for (let i = 1; i <= 8; i++) {
    await two('touchMove', [{ x: cxm - 30 - i * 14, y: cym }, { x: cxm + 30 + i * 14, y: cym }]);
    await sleep(16);
  }
  await two('touchEnd', []);
  await sleep(400);
  const after = await ev(`(function(){
    return JSON.stringify({ zoom: (document.querySelector('.ci-pet-zoomlabel')||{}).textContent,
      beads: (window.__ciBeadState().data.match(/[^.]/g)||[]).length });
  })()`);
  const b1 = JSON.parse(before), b2 = JSON.parse(after);
  console.log('  双指前后:', before, '→', after);
  ok(b2.zoom !== b1.zoom, '双指捏合能放大', b1.zoom + ' → ' + b2.zoom);
  ok(b2.beads === b1.beads, '双指手势不落豆', b1.beads + ' → ' + b2.beads);

  console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项（通过 ' + pass + '）' : '✓ 全部通过：' + pass + ' 项'));
  // 双指测试把画板放大了，先复位到 100% 再做滚动落点（否则目标格在屏幕外）
  await ev(`(function(){ var l = document.querySelector('.ci-pet-zoomlabel'); if (l) l.click(); return 1; })()`);
  await sleep(450);

  // ---- 页面被滚动后再画：落点必须仍然对得上 ----
  const scrolled = await ev(`(function(){
    var r = document.querySelector('.ci-pethome');
    if (!r) return 0;
    var max = r.scrollHeight - r.clientHeight;
    if (max <= 30) return 0;
    r.scrollTop = Math.min(140, max);
    return Math.round(r.scrollTop);
  })()`);
  if (scrolled > 20) {
    await sleep(250);
    const g2 = await ev(`(function(){
      var cv = document.querySelector('.ci-pet-editcanvas');
      var r = cv.getBoundingClientRect();
      return { left:r.left, top:r.top, w:r.width, h:r.height,
               scrollTop: document.querySelector('.ci-pethome').scrollTop };
    })()`);
    const cell2 = g2.w / N;
    const tx = g2.left + 13 * cell2 + cell2 / 2;
    const ty = g2.top + 11 * cell2 + cell2 / 2;
    const beforeData = await ev(`window.__ciBeadState().data.charAt(11*${N}+13)`);
    await touch('touchStart', tx, ty);
    await touch('touchEnd', tx, ty);
    await sleep(250);
    const afterData = await ev(`window.__ciBeadState().data.charAt(11*${N}+13)`);
    console.log('  滚动点击状态:', await ev('JSON.stringify(window.__ciBeadState())'));
    ok(beforeData !== '4' && afterData === '4', '页面滚动后落点仍准确',
      'scrollTop=' + g2.scrollTop + ' 之前=' + beforeData + ' 之后=' + afterData);
    // 直接按画布自身的像素坐标采样（拿实时 rect 换算容易拿到过渡态）
    const pxDbg = await ev(`(function(){
      var cv = document.querySelector('.ci-pet-editcanvas');
      var g = cv.getContext('2d');
      var n = window.__ciBeadN || 16, c = cv.width / n;
      var d = g.getImageData(Math.round((13 + 0.8) * c), Math.round((11 + 0.5) * c), 1, 1).data;
      return JSON.stringify({ rgb: d[0] + ',' + d[1] + ',' + d[2], cw: cv.width, n: n });
    })()`);
    const pq = JSON.parse(pxDbg);
    const q2 = pq.rgb.split(',').map(Number);
    console.log('  滚动像素:', pxDbg);
    ok(q2[0] > 180 && q2[1] < 130, '滚动后画布也真的画上了', 'rgb=' + pq.rgb);
  } else {
    console.log('  · 当前视口页面不可滚动，跳过滚动落点测试');
  }

  // ---- 绘制性能（编辑器内部计时，不是外面轮询）----
  const perf = await ev('JSON.stringify(window.__ciBeadState().perf)');
  console.log('  绘制性能:', perf);
  const pf = JSON.parse(perf);
  ok(pf.paintAvg < 1.5, '单次重绘均值 <1.5ms', 'avg=' + pf.paintAvg + 'ms');
  ok(pf.paintMax < 12, '最慢一次重绘 <12ms', 'max=' + pf.paintMax + 'ms');
  ok(pf.latencyMax < 34, '输入到可见 <34ms（两帧内）', pf.latencyMax + 'ms');

  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('探针异常：', e && e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (e) {}
}
