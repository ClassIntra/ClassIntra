// 大字广播 + 管理端 UI 的真实浏览器验证探针
//
// 与接口级 E2E 的分工：
//   scripts-e2e-bigtext.cjs  → 验「服务端语义」（落库/补拉/ACK/幂等/钳制/封禁）
//   本脚本                    → 验「设备端真实表现」（全屏覆盖层是否真的全屏、颜色字号是否生效、
//                              管理端表单是否渲染、预览是否联动）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本，探针账号 251898 只存在于副本里）
// 绝不指向 9001 —— 那会把测试大字弹到真实学生的平板上。
//
// 用法：node scripts/probe-bigtext-ui.mjs
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9341;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;            // 校园平板横屏
const SHOTS = join(tmpdir(), 'ci-e2e', 'shots');

const STUDENT = '251898';             // 仅存在于测试库
const ADMIN = '251800';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 未读到 JWT_SECRET'); process.exit(1); }
const sign = (uid) => jwt.sign({ user_id: uid }, SECRET, { expiresIn: '1h' });
const studentTok = sign(STUDENT);
const adminTok = sign(ADMIN);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

mkdirSync(SHOTS, { recursive: true });

// ---------- Chrome + CDP ----------
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-bigtext-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
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
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = join(SHOTS, name + '.png');
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}

// 只截某个元素（用于把「预览」单独放大看，便于和真机截图目视对比）
async function shotEl(name, selector) {
  const box = await evalJS(`(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return {
      x: Math.floor(r.left + window.scrollX), y: Math.floor(r.top + window.scrollY),
      w: Math.ceil(r.width), h: Math.ceil(r.height)
    };
  })()`);
  if (!box || box.w <= 0 || box.h <= 0) return null;
  await sleep(400);
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 }
  });
  const p = join(SHOTS, name + '.png');
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}

async function api(method, path, token, body) {
  const res = await fetch(APP + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });

(async () => {
  // ================= A. 设备端：收到大字后是否真的全屏 =================
  console.log('\n=== A. 设备端全屏显示（学生 251898） ===');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{ localStorage.setItem('token', ${JSON.stringify(studentTok)}); }catch(e){}`
  });
  await send('Page.navigate', { url: APP + '/' });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    const st = await evalJS("({ url: location.pathname, hasApp: !!document.querySelector('#app > *'), login: /login/i.test(location.pathname) })");
    if (st && st.hasApp && !st.login) { ready = true; break; }
  }
  ok(ready, '设备端已进入桌面（非登录页）', await evalJS('location.pathname'));
  if (!ready) { console.log('  ⚠️ 后续断言无意义，提前结束'); }

  const CONTENT = '全屏大字验证 · 停电通知';
  const sendRes = await api('POST', '/api/admin/big-text', adminTok, {
    content: CONTENT,
    duration: 25,
    bg_color: '#B42318',
    font_color: '#FFF7ED',
    font_family: 'hei',
    font_size: 140,
    font_weight: '900',
    text_align: 'center',
    target_type: 'users',
    target_ids: [STUDENT]
  });
  ok(sendRes.status === 200 && sendRes.body.code === 200, '服务端下发成功', sendRes.body);
  const btId = sendRes.body.data && sendRes.body.data.id;

  let overlay = null;
  const t0 = Date.now();
  let arriveMs = 0;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    overlay = await evalJS(`(function(){
      var el = document.querySelector('.big-text-overlay');
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      // 背景与特效挂在 BigTextStage 上（遮罩只负责铺满与计时）
      var st = el.querySelector('.big-text-stage');
      var scs = st ? getComputedStyle(st) : cs;
      var t = el.querySelector('.big-text-line') || el.querySelector('.big-text-scroll-track');
      var ts = t ? getComputedStyle(t) : null;
      return {
        text: t ? t.textContent.trim() : '',
        w: Math.round(r.width), h: Math.round(r.height),
        vw: innerWidth, vh: innerHeight,
        left: Math.round(r.left), top: Math.round(r.top),
        z: cs.zIndex, pos: cs.position, bg: scs.backgroundColor, disp: cs.display, op: cs.opacity,
        hasStage: !!st,
        font: ts ? (ts.fontSize + ' / ' + ts.fontWeight + ' / ' + ts.color + ' / ' + ts.textAlign) : '',
        sender: (el.querySelector('.big-text-sender') || {}).textContent || '',
        senderFs: (function(){
          var s = el.querySelector('.big-text-sender');
          return s ? getComputedStyle(s).fontSize : '';
        })()
      };
    })()`);
    if (overlay) { arriveMs = Date.now() - t0; break; }
  }

  ok(!!overlay, '大字覆盖层已出现（链路：API → 信箱 → 推送/补拉 → 组件）', overlay);
  console.log('     到达耗时: ' + arriveMs + 'ms（<3s 说明走 WS 实时推送；~15s 说明走轮询兜底）');
  if (overlay) {
    ok(overlay.text === CONTENT, '显示内容与下发一致', overlay.text);
    ok(overlay.w === overlay.vw && overlay.h === overlay.vh, '尺寸铺满视口（真全屏）',
      { got: overlay.w + 'x' + overlay.h, want: overlay.vw + 'x' + overlay.vh });
    ok(overlay.left === 0 && overlay.top === 0, '左上角对齐视口原点', { left: overlay.left, top: overlay.top });
    ok(overlay.pos === 'fixed', 'position: fixed（盖住桌面而非推挤）', overlay.pos);
    ok(parseInt(overlay.z, 10) >= 50000, '层级 ≥ 50000（高于超能岛 10000）', overlay.z);
    ok(/rgb\(180,\s*35,\s*24\)/.test(overlay.bg), '背景色生效 #B42318', overlay.bg);
    // 字号按视口自适应：基准 140（1080p）在 1043 宽平板上等比缩放到 135
    const expectFs = Math.max(24, Math.round(140 * Math.min(1, overlay.vw / 1080)));
    ok(overlay.font.indexOf(expectFs + 'px') !== -1 && /900/.test(overlay.font),
      '字号按视口自适应（基准 140 → 实际 ' + expectFs + 'px）/ 字重 900 生效', overlay.font);
    ok(/center/.test(overlay.font), '居中对齐生效', overlay.font);
    ok(overlay.sender.indexOf('𝙉𝙚𝙫𝙞𝙣𝙤') !== -1, '显示发送者署名', overlay.sender);
    ok(overlay.op === '1', '完全不透明（不是半透明蒙层）', overlay.op);
    // 内容渲染已收敛到共用组件 BigTextStage（管理端预览复用同一个）
    ok(overlay.hasStage, '内容由共用组件 BigTextStage 渲染（与预览同源）', overlay.hasStage);
    // 修复前 .big-text-sender 写的是 0.28em，相对父级 16px 解析只有 4.5px
    ok(parseFloat(overlay.senderFs) >= 20, '署名按主字号推导（不再是 4.5px 的小点）', overlay.senderFs);
  }
  console.log('  截图:', await shot('01-overlay'));

  // ================= B. 撤回：覆盖层应立刻收起 =================
  console.log('\n=== B. 撤回立即收起 ===');
  const recall = await api('POST', `/api/admin/big-text/${btId}/recall`, adminTok);
  ok(recall.status === 200, '撤回接口返回 200', recall.body);
  const tr = Date.now();
  let gone = false;
  let goneMs = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(300);
    gone = await evalJS("!document.querySelector('.big-text-overlay')");
    if (gone) { goneMs = Date.now() - tr; break; }
  }
  ok(gone, '覆盖层已收起（耗时 ' + goneMs + 'ms）', gone);
  console.log('  截图:', await shot('02-recalled'));

  // ================= C. 轻触关闭 + 最短驻留 =================
  console.log('\n=== C. 轻触关闭与最短驻留 ===');
  await api('POST', '/api/admin/big-text', adminTok, {
    content: '轻触关闭验证', duration: 30, target_type: 'users', target_ids: [STUDENT]
  });
  let shown = false;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    shown = await evalJS("!!document.querySelector('.big-text-overlay')");
    if (shown) break;
  }
  ok(shown, '第二条大字已弹出', shown);
  const earlyTap = await evalJS(`(function(){
    var el = document.querySelector('.big-text-overlay');
    if (!el) return 'no-overlay';
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!document.querySelector('.big-text-overlay');
  })()`);
  ok(earlyTap === true, '驻留期内轻触不关闭（防学生一划就没了）', earlyTap);
  const hint = await evalJS("(document.querySelector('.big-text-hint')||{}).textContent || ''");
  ok(/请阅读/.test(hint), '驻留期提示「请阅读」', hint.trim());

  await sleep(6200);   // MIN_DWELL_MS = 5000，必须跨过驻留期再试
  const hintLate = await evalJS("(document.querySelector('.big-text-hint')||{}).textContent || ''");
  ok(/轻触关闭/.test(hintLate), '驻留期后提示切换为「轻触关闭」（computed 必须随时间重算）', hintLate.trim());

  await evalJS(`(function(){
    var el = document.querySelector('.big-text-overlay');
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!el;
  })()`);
  await sleep(700);    // 等淡出过渡结束再判断 DOM
  const closedAfterDwell = await evalJS("!document.querySelector('.big-text-overlay')");
  ok(closedAfterDwell, '驻留期后轻触可关闭', closedAfterDwell);

  // ================= C2. 轮播 / 副内容 / 署名 / 走马灯 / 渐变 =================
  console.log('\n=== C2. 多行轮播 · 副内容 · 署名开关 · 走马灯 · 渐变大字 ===');
  await api('POST', '/api/admin/big-text', adminTok, {
    content: '轮播第一条\n轮播第二条\n轮播第三条',
    sub_content: '副内容：22:00 前完成',
    show_sender: false,
    display_mode: 'carousel',
    switch_interval: 2,
    effect: 'gradient_text',
    text_gradient: { from: '#FFD166', to: '#EF476F', angle: 90 },
    duration: 40,
    target_type: 'users',
    target_ids: [STUDENT]
  });

  let carousel = null;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    carousel = await evalJS(`(function(){
      var el = document.querySelector('.big-text-overlay');
      if (!el) return null;
      var line = el.querySelector('.big-text-line');
      if (!line) return null;
      var sub = el.querySelector('.big-text-sub');
      var cs = getComputedStyle(line);
      return {
        line: line.textContent.trim(),
        lineCount: el.querySelectorAll('.big-text-line').length,
        sub: sub ? sub.textContent.trim() : '',
        hasSender: !!el.querySelector('.big-text-sender'),
        dots: el.querySelectorAll('.bt-dot').length,
        bgImage: cs.backgroundImage || '',
        bgClip: cs.webkitBackgroundClip || cs.backgroundClip || ''
      };
    })()`);
    if (carousel) break;
  }
  ok(!!carousel, '轮播大字已弹出', carousel);
  if (carousel) {
    ok(carousel.line === '轮播第一条', '首帧显示第一条', carousel.line);
    ok(carousel.lineCount === 1, '同一时刻只渲染一帧（不是整段堆叠）', carousel.lineCount);
    ok(carousel.sub === '副内容：22:00 前完成', '副内容已显示', carousel.sub);
    ok(carousel.hasSender === false, 'show_sender=false 时不渲染署名', carousel.hasSender);
    ok(carousel.dots === 3, '轮播页码点数量 = 行数', carousel.dots);
    ok(/gradient/.test(carousel.bgImage) && /text/.test(carousel.bgClip),
      '渐变大字生效（background-clip: text）', { bg: carousel.bgImage.slice(0, 36), clip: carousel.bgClip });
    await sleep(2600);
    const second = await evalJS("(document.querySelector('.big-text-line')||{}).textContent || ''");
    ok(second.trim() === '轮播第二条', '按 2 秒间隔切到第二条', second.trim());
    console.log('  截图:', await shot('04-carousel'));
  }

  await api('POST', '/api/admin/big-text', adminTok, {
    content: '这是一条很长的通知，用来验证单行超长文本会横向滚动显示，而不是被截断或溢出屏幕',
    display_mode: 'scroll',
    scroll_speed: 120,
    show_sender: false,
    duration: 25,
    target_type: 'users',
    target_ids: [STUDENT]
  });
  let scrollState = null;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    scrollState = await evalJS(`(function(){
      var el = document.querySelector('.big-text-overlay');
      if (!el) return null;
      var tr = el.querySelector('.big-text-scroll-track');
      if (!tr) return null;
      var box = el.querySelector('.big-text-scroll');
      var cs = getComputedStyle(tr);
      var segs = tr.querySelectorAll('.bt-seg');
      var first = segs[0] ? segs[0].getBoundingClientRect() : null;
      return {
        text: tr.textContent.trim().slice(0, 16),
        anim: cs.animationName,
        dur: cs.animationDuration,
        inline: tr.getAttribute('style') || '',
        white: cs.whiteSpace,
        overflow: box ? getComputedStyle(box).overflow : '',
        segs: segs.length,
        // 首段左边缘相对视口的 x：> -视口宽度即「文字已在屏幕内」，不是整屏空白
        segLeft: first ? Math.round(first.left) : null,
        segWidth: first ? Math.round(first.width) : null,
        vw: window.innerWidth
      };
    })()`);
    if (scrollState) break;
  }
  ok(!!scrollState, '走马灯层已出现', scrollState);
  if (scrollState) {
    ok(scrollState.anim === 'bt-marquee', '横向滚动动画已挂载', scrollState.anim);
    ok(scrollState.white === 'nowrap', '单行不换行', scrollState.white);
    ok(scrollState.overflow === 'hidden', '超出部分被裁剪（不撑破屏幕）', scrollState.overflow);
    const m = /([\d.]+)s[^;]*bt-marquee/.exec(scrollState.inline) || /bt-marquee\s+([\d.]+)s/.exec(scrollState.inline);
    ok(!!m && parseFloat(m[1]) >= 4, '滚动时长按文本实测宽度计算（非固定值）', scrollState.inline);
    // 无缝循环 = 两段同样的文本并排，位移 -50% 正好等于一段
    ok(scrollState.segs === 2, '无缝循环：文本已复制为两段拼接', 'segs=' + scrollState.segs);
    ok(scrollState.segLeft !== null && scrollState.segLeft > -scrollState.vw,
      '入场即有文字（不再先看到整屏空白）',
      'segLeft=' + scrollState.segLeft + ' vw=' + scrollState.vw);
    ok(scrollState.segWidth > scrollState.vw * 0.9, '长文本实测宽度超出视口（确实需要滚动）',
      scrollState.segWidth + ' > ' + scrollState.vw);
    console.log('  截图:', await shot('05-scroll'));
  }

  // ================= D. 管理端 UI =================
  console.log('\n=== D. 管理端「大字广播」面板 ===');
  // ⚠️ 只换 token 不够：前端用 localStorage 里的 user 决定「哪些应用对当前角色可见」，
  //    只改 token 会仍按上一个学生身份过滤，管控中心图标根本不渲染。所以把 user 一起换掉。
  const adminInfo = await api('GET', '/api/auth/check-status', adminTok);
  const adminUser = adminInfo.body && adminInfo.body.data && adminInfo.body.data.user_info;
  ok(!!adminUser && adminUser.is_admin === 1, '管理员身份校验通过（is_admin=1）', adminUser && adminUser.user_id);
  // ⚠️ 身份必须在**页面启动前**注入：应用清单/路由/桌面图标可见性都在启动阶段
  //    按 localStorage 里的 user 决定，启动后再改只会影响下一次刷新。
  //    addScriptToEvaluateOnNewDocument 会在每次导航前执行，正好模拟「重新登录」。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ localStorage.setItem('token', " + JSON.stringify(adminTok) + ");" +
      " localStorage.setItem('user', " + JSON.stringify(JSON.stringify(adminUser || {})) + "); }catch(e){}"
  });
  await send('Page.navigate', { url: APP + '/' });
  let deskAdmin = false;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    deskAdmin = await evalJS("!!document.querySelector('#app > *') && !/login/i.test(location.pathname)");
    if (deskAdmin) break;
  }
  ok(deskAdmin, '管理端会话已进入桌面', deskAdmin);
  await sleep(2500);   // 等 app-control 拉取完成、应用清单渲染

  // 真实用户路径：点桌面「管控中心」图标；图标不在当前页时退化为 launchApp（同一条代码路径）
  const opened = await evalJS(`(function(){
    var img = document.querySelector('img[alt="管控中心"]');
    if (img) {
      var el = img;
      for (var k = 0; k < 6 && el; k++) {
        if (el.className && String(el.className).indexOf('app-icon') !== -1) break;
        el = el.parentElement;
      }
      (el || img).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'icon-clicked';
    }
    var root = document.querySelector('#app') && document.querySelector('#app').__vue__;
    if (!root) return 'no-root';
    var desk = null;
    (function walk(vm, d) {
      if (!vm || d > 6 || desk) return;
      if (vm.dockApps) { desk = vm; return; }
      var kids = vm.$children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i], d + 1);
    })(root, 0);
    if (!desk) return 'no-desktop-vm';
    var admin = desk.dockApps.filter(function(a){ return a.name === 'admin'; })[0];
    if (!admin) return 'no-admin-app';
    desk.launchApp(admin);
    return 'launchApp';
  })()`);
  ok(opened === 'icon-clicked' || opened === 'launchApp', '已进入管控中心（' + opened + '）', opened);

  const pushAdmin = `(function(){
    var root = document.querySelector('#app') && document.querySelector('#app').__vue__;
    if (!root || !root.$router) return 'no-router';
    root.$router.push('/admin');
    return 'ok';
  })()`;

  let tabs = null;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    tabs = await evalJS(`(function(){
      var btns = [].slice.call(document.querySelectorAll('.admin-tab')).map(function(b){ return b.textContent.trim(); });
      return btns.length ? btns : null;
    })()`);
    if (tabs) break;
    if (i === 20) await evalJS(pushAdmin);   // 路由可能还没注册完，再推一次
  }
  if (!tabs) {
    const diag = await evalJS(`(function(){
      var root = document.querySelector('#app') && document.querySelector('#app').__vue__;
      var out = { path: location.pathname, hasAdminPage: !!document.querySelector('.admin-page') };
      try {
        out.resolved = root.$router.resolve('/admin').route.matched.length;
        out.currentName = root.$route && root.$route.name;
        out.appCount = (root.$store && root.$store.state.apps && (root.$store.state.apps.list || []).length) || 'n/a';
      } catch (e) { out.err = e.message; }
      out.text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160);
      return out;
    })()`);
    console.log('  诊断:', JSON.stringify(diag));
  }
  ok(!!tabs, '管控中心已加载，tab 列表可读', tabs);
  ok(tabs && tabs.indexOf('大字广播') !== -1, '「大字广播」tab 已出现', tabs);

  // 点击 tab
  const clicked = await evalJS(`(function(){
    var b = [].slice.call(document.querySelectorAll('.admin-tab')).filter(function(x){ return x.textContent.trim() === '大字广播'; })[0];
    if (!b) return false;
    b.click();
    return true;
  })()`);
  ok(clicked, '已点击「大字广播」tab', clicked);
  await sleep(1200);

  const panel = await evalJS(`(function(){
    var form = document.querySelector('.admin-section .broadcast-form');
    if (!form) return null;
    var ta = form.querySelector('textarea.broadcast-input');
    var chips = [].slice.call(form.querySelectorAll('.bt-chip')).map(function(c){ return c.textContent.trim(); });
    var titles = [].slice.call(form.querySelectorAll('.bt-label')).map(function(c){ return c.textContent.trim(); });
    return { hasTextarea: !!ta, chips: chips, labels: titles, html: form.innerHTML.length };
  })()`);
  ok(!!panel && panel.hasTextarea, '大字表单已渲染（含内容输入框）', panel);
  ok(panel && panel.labels.some(function (t) { return t.indexOf('显示时长') === 0; }) &&
    panel.labels.some(function (t) { return t.indexOf('显示给谁') === 0; }),
    '字段齐全：时长 / 目标人群 / 外观', panel && panel.labels);
  ok(panel && panel.chips.some(function (c) { return /秒$/.test(c); }), '时长快捷 chip 存在', panel && panel.chips);
  ok(panel && panel.chips.indexOf('全班') !== -1 && panel.chips.indexOf('指定成员') !== -1,
    '目标人群切换 chip 存在', panel && panel.chips);

  // 填入内容，验证预览联动
  const typed = await evalJS(`(function(){
    var ta = document.querySelector('.admin-section .broadcast-form textarea.broadcast-input');
    if (!ta) return null;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '停电检修，22:00 前完成作业');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  })()`);
  ok(typed === '停电检修，22:00 前完成作业', '内容可输入（v-model 生效）', typed);
  await sleep(600);
  // 预览必须由设备端同一个 BigTextStage 渲染，否则「预览与实际不符」
  const preview = await evalJS(`(function(){
    var frame = document.querySelector('.bt-preview-frame');
    if (!frame) return null;
    var stage = frame.querySelector('.big-text-stage');
    var txt = frame.querySelector('.big-text-line');
    var ts = txt ? getComputedStyle(txt) : null;
    var fr = frame.getBoundingClientRect();
    var prog = frame.querySelector('.big-text-progress');
    var hint = frame.querySelector('.big-text-hint');
    return {
      text: (txt ? txt.textContent.trim() : frame.textContent.trim()),
      hasStage: !!stage,
      frameW: Math.round(fr.width),
      frameH: Math.round(fr.height),
      fontPx: ts ? parseFloat(ts.fontSize) : 0,
      bg: stage ? getComputedStyle(stage).backgroundColor : '',
      // chrome（进度条/驻留提示）已并入舞台：预览必须同样画出来，否则「预览与实际不符」
      hasProgress: !!prog,
      hasHint: !!hint,
      hintText: hint ? hint.textContent.trim() : '',
      progressColor: prog ? getComputedStyle(prog).color : ''
    };
  })()`);
  if (preview) {
    ok(preview.text.indexOf('停电检修') !== -1, '预览实时联动', preview.text);
    ok(preview.hasStage, '预览用的是设备端同一个渲染组件（不再各写一套）', preview.hasStage);
    // 字号应跟随预览框宽度等比：form.fontSize=140 基准 1080
    const wantFs = Math.max(1, Math.round(140 * Math.min(1, preview.frameW / 1080)));
    ok(Math.abs(preview.fontPx - wantFs) <= 2,
      '预览字号按框宽等比缩放（' + preview.frameW + 'px 框 → ' + preview.fontPx + 'px，期望 ' + wantFs + 'px）',
      { got: preview.fontPx, want: wantFs });
    // 真机视口 1043×787 ≈ 4:3，预览宽高比必须跟它一致，否则长文本换行会骗人
    const ratio = preview.frameW / preview.frameH;
    const deviceRatio = 1043 / 787;
    ok(Math.abs(ratio - deviceRatio) < 0.03,
      '预览宽高比与真机一致（' + preview.frameW + '×' + preview.frameH + ' ≈ 4:3）',
      { ratio: ratio.toFixed(3), device: deviceRatio.toFixed(3) });
    // 倒计时 chrome 与真机同源：进度条 + 驻留提示都在同一个 BigTextStage 里
    ok(preview.hasProgress && preview.hasHint, '预览包含倒计时进度条与驻留提示（chrome 已并入舞台）',
      { progress: preview.hasProgress, hint: preview.hasHint });
    ok(/（\d+s）/.test(preview.hintText), '驻留提示带剩余秒数（倒计时为响应式驱动）', preview.hintText);
    // chrome 颜色跟随字体色：表单默认字色 #ffffff，深色背景下应解析为白色
    ok(/rgb\(255,\s*255,\s*255\)/.test(preview.progressColor), 'chrome 颜色 = 字体色（白底大字也不会看不见）', preview.progressColor);
  } else {
    console.log('  ⚠️ 未找到预览节点（跳过预览联动断言）');
  }
  console.log('  预览截图:', await shotEl('03b-preview', '.bt-preview-frame'));
  const count = await evalJS("(document.querySelector('.bt-char-count')||{}).textContent||''");
  ok(/\/\s*400/.test(count), '字数计数与服务端上限一致（/400）', count.trim());
  // --- 新增控件是否齐全 ---
  const controls = await evalJS(`(function(){
    var labels = [].slice.call(document.querySelectorAll('.admin-section .bt-label')).map(function(l){ return l.textContent.trim(); });
    var chips = [].slice.call(document.querySelectorAll('.admin-section .bt-chip')).map(function(c){ return c.textContent.trim(); });
    return {
      labels: labels,
      chips: chips,
      hasSender: !!document.querySelector('.admin-section .bt-switch input[type="checkbox"]')
    };
  })()`);
  ok(controls.labels.some(function (t) { return t.indexOf('展示方式') === 0; }), '展示方式字段存在', controls.labels);
  ok(controls.chips.indexOf('多行轮播') !== -1 && controls.chips.indexOf('横向走马灯') !== -1,
    '三种展示模式可选', controls.chips);
  ok(controls.labels.some(function (t) { return t.indexOf('副内容') === 0; }), '副内容字段存在', controls.labels);
  ok(controls.hasSender, '署名开关存在');
  ok(controls.chips.indexOf('渐变大字') !== -1 && controls.chips.indexOf('炫彩流动') !== -1 && controls.chips.indexOf('霓虹发光') !== -1,
    '特效选项齐全', controls.chips);
  ok(controls.labels.some(function (t) { return t.indexOf('策略') === 0; }), '策略字段存在', controls.labels);

  // --- 策略往返：存 → 改回默认 → 套用 → 删除 ---
  const clickText = function (sel, text) {
    return `(function(){
      var nodes = [].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
      var hit = nodes.filter(function(n){ return n.textContent.trim() === ${JSON.stringify(text)}; })[0];
      if (!hit) return 'miss';
      hit.click();
      return 'ok';
    })()`;
  };
  const setInput = function (sel, value) {
    return `(function(){
      var el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'miss';
      var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`;
  };
  const activeChips = `(function(){
    return [].slice.call(document.querySelectorAll('.admin-section .bt-chip.active')).map(function(c){ return c.textContent.trim(); });
  })()`;

  // ---------- 轮播时长缺口：警告 + 一键补时长 ----------
  // ⚠️ 多行内容必须写成 \\n：本文件是模板字符串，\n 会被提前转成真实换行，
  //    浏览器端单引号字符串里出现裸换行会 SyntaxError，而 Runtime.evaluate 的
  //    异常不会 reject Promise（result.value 为 undefined）—— 设置会静默失败。
  await evalJS(`(function(){
    var ta = document.querySelector('.admin-section .broadcast-form textarea.broadcast-input');
    if (!ta) return;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '缺口第一行\\n缺口第二行\\n缺口第三行\\n缺口第四行');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evalJS(clickText('.admin-section .bt-chip', '多行轮播'));
  await evalJS(setInput('.bt-number', '5'));
  await sleep(400);
  const gapState = await evalJS(`(function(){
    var warn = document.querySelector('.admin-section .bt-hint-line .bt-warn');
    var btn = document.querySelector('.admin-section .bt-link-btn');
    return {
      warn: warn ? warn.textContent.trim() : '',
      btn: btn ? btn.textContent.trim() : '',
      dur: (document.querySelector('.admin-section .bt-number') || {}).value || ''
    };
  })()`);
  ok(/只能看完前 1\/4 条/.test(gapState.warn), '轮播时长不足出现缺口警告（5s 只看得了 1/4 条）', gapState.warn);
  ok(/补到 20s/.test(gapState.btn), '一键补时长按钮给出目标值（4 行 × 5s 间隔 = 20s）', gapState.btn);
  await evalJS("(function(){ var b = document.querySelector('.admin-section .bt-link-btn'); if (b) b.click(); })()");
  await sleep(400);
  const afterFix = await evalJS("(document.querySelector('.admin-section .bt-number') || {}).value || ''");
  ok(afterFix === '20', '点击后时长补到 20s', afterFix);
  ok(await evalJS("!document.querySelector('.admin-section .bt-link-btn')"), '补时长后缺口警告消失');
  // 恢复单行内容：后面的确认弹窗断言依赖这段文案
  await evalJS(`(function(){
    var ta = document.querySelector('.admin-section .broadcast-form textarea.broadcast-input');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '停电检修，22:00 前完成作业');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evalJS(clickText('.admin-section .bt-chip', '静态整段'));
  await sleep(300);

  await evalJS(clickText('.admin-section .bt-chip', '多行轮播'));
  await evalJS(clickText('.admin-section .bt-chip', '炫彩流动'));
  await evalJS(setInput('.bt-preset-name', 'E2E界面策略'));
  await sleep(200);
  const saveHit = await evalJS(clickText('.admin-section .bt-preset-name ~ button, .admin-section .bt-chip-row button', '保存策略'));
  ok(saveHit === 'ok', '已点击「保存策略」', saveHit);
  await sleep(1600);

  const savedList = await evalJS("(function(){ return [].slice.call(document.querySelectorAll('.bt-preset-apply')).map(function(b){ return b.textContent.trim(); }); })()");
  ok(savedList.indexOf('E2E界面策略') !== -1, '策略已出现在列表（落库成功）', savedList);

  // 改回静态 + 无特效，再用策略拉回来，证明是「真读库」而不是本地残留
  await evalJS(clickText('.admin-section .bt-chip', '静态整段'));
  await evalJS(clickText('.admin-section .bt-chip', '无'));
  await sleep(300);
  const beforeApply = await evalJS(activeChips);
  ok(beforeApply.indexOf('多行轮播') === -1, '已切回静态（准备套用）', beforeApply);

  await evalJS("(function(){ var b = [].slice.call(document.querySelectorAll('.bt-preset-apply')).filter(function(x){ return x.textContent.trim() === 'E2E界面策略'; })[0]; if (b) b.click(); })()");
  await sleep(600);
  const afterApply = await evalJS(activeChips);
  ok(afterApply.indexOf('多行轮播') !== -1 && afterApply.indexOf('炫彩流动') !== -1,
    '套用策略后展示方式与特效均还原', afterApply);

  await evalJS("(function(){ var b = [].slice.call(document.querySelectorAll('.bt-preset-del'))[0]; if (b) b.click(); })()");
  await sleep(1500);
  const afterDel = await evalJS("(function(){ return [].slice.call(document.querySelectorAll('.bt-preset-apply')).map(function(b){ return b.textContent.trim(); }); })()");
  ok(afterDel.indexOf('E2E界面策略') === -1, '策略已删除（列表不再包含）', afterDel);

  // ---------- 目标人群：全选 / 清空 ----------
  await evalJS(clickText('.admin-section .bt-chip', '指定成员'));
  await sleep(2000);
  const pickChips = await evalJS("(function(){ return [].slice.call(document.querySelectorAll('.admin-section .bt-chip')).map(function(c){ return c.textContent.trim(); }); })()");
  ok(pickChips.some(function (t) { return t.indexOf('全选') === 0; }) && pickChips.indexOf('清空') !== -1,
    '目标人群有全选 / 清空快捷操作', pickChips);
  await evalJS("(function(){ var b = [].slice.call(document.querySelectorAll('.admin-section .bt-chip')).filter(function(x){ return x.textContent.trim().indexOf('全选') === 0; })[0]; if (b) b.click(); })()");
  await sleep(500);
  const selCount = await evalJS("(document.querySelector('.bt-selected-count')||{}).textContent||''");
  ok(/已选\s*[1-9]\d*\s*人/.test(selCount), '全选后已选人数 > 0', selCount.trim());

  // ---------- 发送二次确认：点发送只弹确认，不直接下发 ----------
  const beforeSend = await api('GET', '/api/admin/big-text', adminTok);
  const nBefore = ((beforeSend.body.data && beforeSend.body.data.list) || []).length;
  await evalJS(clickText('.admin-section .bt-actions .btn-primary', '发送大字'));
  await sleep(600);
  const confirmText = await evalJS("(function(){ var m = document.querySelector('.modal-overlay .bt-confirm-preview'); return m ? m.textContent.trim() : ''; })()");
  ok(confirmText.indexOf('停电检修') !== -1, '发送前弹出二次确认（显示待发内容）', confirmText);
  console.log('  确认框截图:', await shot('03c-confirm'));
  const afterOpen = await api('GET', '/api/admin/big-text', adminTok);
  ok(((afterOpen.body.data && afterOpen.body.data.list) || []).length === nBefore,
    '仅弹确认、没有直接下发到设备', nBefore);
  await evalJS(clickText('.modal-actions .btn-cancel', '再改改'));
  await sleep(400);
  ok(await evalJS("!document.querySelector('.modal-overlay .bt-confirm-preview')"), '取消后确认框关闭');

  // ---------- Ctrl+Enter 快捷键：同样必须走二次确认 ----------
  // 曾经的缺陷：快捷键直连 sendBigText，绕过确认就把大字推到了学生设备上
  const hotkeySent = await evalJS(`(function(){
    var ta = document.querySelector('.admin-section .broadcast-form textarea.broadcast-input');
    if (!ta) return 'no-ta';
    var ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    // Vue 2 的 .enter 修饰符按 keyCode 匹配，合成事件必须补上，否则静默不触发
    try { Object.defineProperty(ev, 'keyCode', { value: 13 }); } catch (e) {}
    try { Object.defineProperty(ev, 'which', { value: 13 }); } catch (e) {}
    ta.dispatchEvent(ev);
    return 'ok';
  })()`);
  await sleep(600);
  const confirmByHotkey = await evalJS("!!document.querySelector('.modal-overlay .bt-confirm-preview')");
  ok(hotkeySent === 'ok' && confirmByHotkey, 'Ctrl+Enter 同样只弹二次确认（不绕过确认直接下发）', { hotkeySent, confirmByHotkey });
  const afterHotkey = await api('GET', '/api/admin/big-text', adminTok);
  ok(((afterHotkey.body.data && afterHotkey.body.data.list) || []).length === nBefore,
    '快捷键没有直接下发到设备（历史条数不变）', nBefore);
  await evalJS(clickText('.modal-actions .btn-cancel', '再改改'));
  await sleep(400);
  ok(await evalJS("!document.querySelector('.modal-overlay .bt-confirm-preview')"), '取消后确认框关闭（快捷键路径）');

  console.log('  截图:', await shot('03-admin-panel'));

  // ================= E. 批量封禁弹窗 =================
  console.log('\n=== E. 批量封禁弹窗（时长 / 原因 / 到期说明） ===');
  // 大字面板断言完毕，切到用户管理页验证批量封禁交互（只验 UI，不真正执行封禁）
  await evalJS(`(function(){
    var b = [].slice.call(document.querySelectorAll('.admin-tab')).filter(function(x){ return x.textContent.trim() === '用户管理'; })[0];
    if (b) b.click();
  })()`);
  let usersReady = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    usersReady = await evalJS("!!document.querySelector('.admin-section .data-table tbody tr')");
    if (usersReady) break;
  }
  ok(usersReady, '用户管理表格已渲染', usersReady);
  await evalJS(clickText('.toolbar-right .action-btn', '全选'));
  await sleep(500);
  const banBtnText = await evalJS(`(function(){
    var b = [].slice.call(document.querySelectorAll('.toolbar-right .action-btn')).filter(function(x){ return /^批量封禁/.test(x.textContent.trim()); })[0];
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  })()`);
  ok(!!banBtnText, '全选后出现「批量封禁」按钮并已点击', banBtnText);
  await sleep(600);
  const banModal = await evalJS(`(function(){
    var m = document.querySelector('.modal-overlay');
    if (!m) return null;
    var sel = m.querySelector('select.form-input');
    var ta = m.querySelector('textarea.form-input');
    var desc = m.querySelector('.modal-desc');
    return {
      title: (m.querySelector('.modal-title') || {}).textContent || '',
      hasSelect: !!sel,
      options: sel ? [].slice.call(sel.options).map(function(o){ return o.textContent.trim(); }) : [],
      hasReason: !!ta,
      desc: desc ? desc.textContent.trim() : '',
      selValue: sel ? sel.value : ''
    };
  })()`);
  ok(!!banModal, '批量封禁弹窗已弹出', banModal);
  if (banModal) {
    ok(/批量封禁/.test(banModal.title), '弹窗标题带人数', banModal.title);
    ok(banModal.hasSelect && banModal.options.length >= 5 && banModal.options.indexOf('永久封禁') !== -1,
      '时长下拉选项齐全（含永久与多档限时）', banModal.options);
    ok(banModal.hasReason, '封禁原因输入框存在', banModal.hasReason);
    ok(/永久封禁/.test(banModal.desc), '默认时长=0 时提示「永久封禁，需手动解禁」', banModal.desc);
    // 选一个有限时长：应展示具体到期时间而非永久说明
    await evalJS(`(function(){
      var sel = document.querySelector('.modal-overlay select.form-input');
      if (!sel) return;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '60');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(400);
    const banModal2 = await evalJS(`(function(){
      var m = document.querySelector('.modal-overlay');
      if (!m) return null;
      var desc = m.querySelector('.modal-desc');
      return { desc: desc ? desc.textContent.trim() : '', selValue: (m.querySelector('select.form-input') || {}).value || '' };
    })()`);
    ok(banModal2 && banModal2.selValue === '60' && /自动解封/.test(banModal2.desc),
      '选「1小时」后展示到期时间与自动解封说明', banModal2 && banModal2.desc);
  }
  console.log('  批量封禁弹窗截图:', await shot('06-batch-ban-modal'));
  await evalJS(clickText('.modal-actions .btn-cancel', '取消'));
  await sleep(400);
  ok(await evalJS("!document.querySelector('.modal-overlay')"), '取消后弹窗关闭（未执行任何封禁）');
  await evalJS(clickText('.toolbar-right .action-btn', '取消全选'));
  await sleep(300);

  console.log('\n=================================================');
  console.log(pass + ' 通过 / ' + fail + ' 失败');
  console.log('截图目录:', SHOTS);
  console.log('=================================================');
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('探针异常:', e && e.stack || e);
  try { chrome.kill(); } catch (_) {}
  process.exit(3);
});
