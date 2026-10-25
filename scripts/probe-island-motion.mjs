// 超能岛（SuperIsland）动效真实浏览器验证探针
//
// 与动效门禁（scripts/motion-verify.js，静态扫令牌/曲线）的分工：
//   motion-verify.js → 验「写法合规」（时长走令牌、无关键字曲线、不动布局属性）
//   本脚本           → 验「真实表现」（通知全链路、FLIP morph、进度条推进、
//                       urgent 呼吸、队列交接、reduced-motion 降级）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（e2e 库副本，探针账号只存在于副本）
// 绝不指向 9001 —— 那会把测试通知弹到真实学生的平板上。
//
// 覆盖：
//   A. 真实 WS 链路：251800 发公共消息 → 251898 收 new_message → low 通知（2s 生命周期）
//   B. FLIP morph：compact→notification 的 WAAPI scale 形变（340ms / cubic-bezier(0.32,0.72,0,1)）
//   C. urgent：伪元素呼吸 island-urgent-breathe + 图标脉冲 + 5s 时长 + 无残留弹跳类
//   D. 队列：双通知连发 → 徽章 pop + 自动交接
//   E. reduced-motion：进度条 animation:none 降级
//
// 用法：node scripts/probe-island-motion.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9342;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;            // 校园平板横屏
const SHOTS = join(tmpdir(), 'ci-e2e', 'shots');

const STUDENT = '251898';             // 仅存在于测试库
const ADMIN = '251800';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

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

// ---------- Chrome + CDP ----------
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-island-probe-profile')}`,
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
// ⚠️ CDP Runtime.evaluate 的浏览器端异常不 reject（静默返回 undefined）——
// 必须自己查 exceptionDetails，否则断言会拿着 undefined 假通过。
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    throw new Error('页面内异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  }
  return r && r.result ? r.result.value : undefined;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = join(SHOTS, name + '.png');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
// headless Chrome 默认 prefers-reduced-motion: reduce（会把所有动画降级成 none，
// 测出动效全是“没有”的假象）。真实平板不设置该偏好，基线显式钉成 no-preference，
// reduced-motion 降级只在 D 组临时开启、用完即还。
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ================= 登录桌面（学生 251898） =================
console.log('\n=== 登录桌面（学生 251898，平板视口 1043×787） ===');
// __WS_PORT__：客户端默认连 10001，隔离实例 WS 在 10099 —— 不注入则浏览器
// 根本收不到 new_message（A 组整条链路断这儿）。
// user 也要注入：wsManager._sendConnectMessage 要求 localStorage 里同时有
// token 和 user.user_id，否则 WS 握手后不发 connect，永远收不到 connected。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    window.__WS_PORT__ = '10099';
    localStorage.setItem('token', ${JSON.stringify(studentTok)});
    localStorage.setItem('user', JSON.stringify({ user_id: '251898' }));
  }catch(e){}`
});
await send('Page.navigate', { url: APP + '/' });

let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(300);
  const st = await evalJS("({ url: location.pathname, hasApp: !!document.querySelector('#app > *'), login: /login/i.test(location.pathname) })");
  if (st && st.hasApp && !st.login) { ready = true; break; }
}
ok(ready, '设备端已进入桌面（非登录页）', await evalJS('location.pathname'));
if (!ready) { console.log('  ⚠️ 后续断言无意义，提前结束'); chrome.kill(); process.exit(1); }

// 等超能岛挂载并拿到 Vue 实例（urgent/队列用例经组件方法注入，渲染链路与真实事件一致）
// ⚠️ 组件根节点是 <transition>（抽象组件），__vue__ 不会落到 .island-wrapper 上，
// 必须从根实例递归 $children 找。
let vmReady = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  vmReady = await evalJS(`(function(){
    var root = document.querySelector('#app') && document.querySelector('#app').__vue__;
    if (!root) return false;
    var found = null;
    (function walk(vm){
      if (found || !vm) return;
      if (vm.$options && vm.$options.name === 'SuperIsland') { found = vm; return; }
      var ch = vm.$children || [];
      for (var i = 0; i < ch.length; i++) walk(ch[i]);
    })(root);
    if (found) { window.__islandVM = found; return true; }
    return false;
  })()`);
  if (vmReady) break;
}
ok(vmReady, '超能岛已挂载（拿到组件实例）');

// 动效基线清理：initMotion 曾在 headless 默认 reduce 下把 [data-no-motion="true"]
// 钉死在 <html> 上（0.001ms 全局降级，且不会自愈）。真实平板没有这个偏好，
// 探针必须显式还原，否则后面测的「动效」全是假死状态。
const motionState = await evalJS(`(function(){
  try { localStorage.removeItem('ci_motion_disabled'); } catch (e) {}
  document.documentElement.removeAttribute('data-no-motion');
  return {
    noMotionAttr: document.documentElement.getAttribute('data-no-motion'),
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    lsFlag: (function(){ try { return localStorage.getItem('ci_motion_disabled'); } catch (e) { return null; } })()
  };
})()`);
ok(!motionState.noMotionAttr && !motionState.reduce && !motionState.lsFlag,
  '动效基线干净（无 data-no-motion / 无 reduce / 无 localStorage 禁令）', motionState);

// 浏览器 WS 前置条件：注意时序 —— 欢迎包里的 users 不含自己，
// 在线人数要靠「别人连进来」的 user_online 事件才 +1。所以必须先让
// Node 端（251800）连上，再查在线人数。为 0 = WS 没连上（端口/凭据问题），
// A 组必然全军覆没，先在这儿 fail fast。
// （真正的连接动作在 A 组开头，这里只做声明占位，连接后立即复查。）
let wsOnline = -1;

const perfLevel = await evalJS("document.documentElement.getAttribute('data-perf')");
ok(perfLevel !== 'low', '性能档位非 low（FLIP 不会被跳过）', perfLevel);

const compactInfo = await evalJS(`(function(){
  var el = document.querySelector('.island');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return { h: Math.round(r.height), w: Math.round(r.width), mode: window.__islandVM.islandMode };
})()`);
ok(compactInfo && compactInfo.mode === 'compact', '初始为收起态', compactInfo);
const COMPACT_H = compactInfo ? compactInfo.h : 0;

// 通用等待助手
async function waitFor(expr, timeoutMs, interval) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJS(expr);
    if (v) return v;
    await sleep(interval || 150);
  }
  return null;
}
async function inject(notif) {
  return evalJS(`window.__islandVM.enqueueNotification(${JSON.stringify(notif)})`);
}
async function waitCompact(timeoutMs) {
  return waitFor(`window.__islandVM.islandMode === 'compact' && !window.__islandVM.notification`, timeoutMs || 9000, 150);
}

// ================= A. 真实 WS 链路：low 优先级通知（2s 生命周期） =================
console.log('\n=== A. 真实 WS 链路 → low 通知（251800 发公共消息，251898 收） ===');
const wsClient = new WebSocket('ws://127.0.0.1:10099/ws?token=' + encodeURIComponent(adminTok));
let wsConnected = false;
wsClient.on('message', (raw) => {
  try { if (JSON.parse(raw).type === 'connected') wsConnected = true; } catch (e) {}
});
// 服务端只在收到 {type:'connect'} 后才回 connected 欢迎包（handleConnect），
// 且 user_id + token 必须在消息体里（URL query 的 token 只是客户端附带）。
wsClient.on('open', () => { wsClient.send(JSON.stringify({ type: 'connect', user_id: ADMIN, token: adminTok })); });
await new Promise((res, rej) => {
  wsClient.on('open', res);
  wsClient.on('error', rej);
  setTimeout(rej, 8000);
}).catch(() => {});
for (let i = 0; i < 40; i++) { if (wsConnected) break; await sleep(200); }
ok(wsConnected, '管理端 WS 已连接（10099）');

// Node 端已连入 → 浏览器应收到 user_online → onlineUserCount ≥ 1
for (let i = 0; i < 20; i++) {
  wsOnline = await evalJS(`window.__islandVM.onlineUserCount || 0`) || 0;
  if (wsOnline >= 1) break;
  await sleep(300);
}
ok(wsOnline >= 1, '浏览器 WS 已连接（收到 user_online，在线人数 ≥1）', wsOnline);
await sleep(400);

const MSG_TEXT = '动效探针消息 ' + Date.now();
wsClient.send(JSON.stringify({ type: 'text', content: MSG_TEXT }));

// 等通知面板出现（.notif-progress 是面板最后一个子元素，出现即面板已挂载）
const appeared = await waitFor(`!!document.querySelector('.notif-progress')`, 5000, 100);
ok(appeared, '收到 new_message → 通知面板已弹出');
// 生命周期锚点必须在「刚出现」就取 —— 取晚了会把探针自身的采样耗时
// （FLIP 轮询 + 两次 scaleX 采样 ≈ 1.2s）算进通知生命周期，误报早退。
const tAppear = Date.now();

if (appeared) {
  const info = await evalJS(`(function(){
    var prog = document.querySelector('.notif-progress');
    var isl = document.querySelector('.island');
    var cs = getComputedStyle(prog);
    // scoped 样式会给 keyframes 名加哈希后缀（notif-progress-shrink-1a2b3c4d），
    // 比对时剥掉后缀只认基准名
    var strip = function(n) { return String(n).replace(/-[0-9a-f]{8}$/, ''); };
    var dur = cs.getPropertyValue('--notif-duration').trim();
    return {
      islandMode: window.__islandVM.islandMode,
      priority: window.__islandVM.notificationPriority,
      animName: strip(cs.animationName),
      animDur: cs.animationDuration,
      customDur: dur,
      progressClass: prog.className,
      islandH: Math.round(isl.getBoundingClientRect().height),
      islandClasses: isl.className,
      title: window.__islandVM.notification && window.__islandVM.notification.title
    };
  })()`);
  ok(info.islandMode === 'notification', '岛体进入 notification 模式', info.islandMode);
  ok(info.priority === 'low', '优先级 = low（公共消息）', info.priority);
  ok(info.animName === 'notif-progress-shrink', '进度条动画名 = notif-progress-shrink（CSS animation 驱动，无 JS tick）', info.animName);
  ok(info.customDur === '2000ms' && info.animDur === '2s', '进度条时长 = 2s（--notif-duration 真相源）', { custom: info.customDur, anim: info.animDur });
  ok(info.progressClass.indexOf('notif-progress--low') !== -1, 'low 配色 class 生效', info.progressClass);
  ok(info.islandH > COMPACT_H + 10, '岛体高度已展开（compact ' + COMPACT_H + ' → notification ' + info.islandH + '）', info.islandH);
  ok(info.islandClasses.indexOf('island-bouncing') === -1, '容器无 island-bouncing（transform 归 FLIP 独占）', info.islandClasses);

  // FLIP morph：WAAPI 动画签名（340ms / cubic-bezier(0.32,0.72,0,1)）。
  // 注意 showNotification 里 isBouncing 持续 500ms，FLIP 会等它结束后再跑。
  // ⚠️ 探针表达式走模板字面量，正则里的 \( \d 会被 Node 吞成 ( d ——
  //    matrix 一律用 slice/split 解析，不写正则。
  let flip = null;
  const tFlip = Date.now();
  while (Date.now() - tFlip < 2500) {
    flip = await evalJS(`(function(){
      var isl = document.querySelector('.island');
      if (!isl) return null;
      var anims = isl.getAnimations ? isl.getAnimations() : [];
      for (var i = 0; i < anims.length; i++) {
        var t = anims[i].effect && anims[i].effect.getTiming ? anims[i].effect.getTiming() : null;
        if (t && t.duration === 340 && String(t.easing).indexOf('cubic-bezier(0.32, 0.72, 0, 1)') !== -1) {
          return { duration: t.duration, easing: t.easing, transform: getComputedStyle(isl).transform, playState: anims[i].playState };
        }
      }
      return null;
    })()`);
    if (flip) break;
    await sleep(60);
  }
  ok(flip && flip.duration === 340, 'FLIP morph 运行中（WAAPI 340ms 展开，可中断）', flip);
  if (flip && String(flip.transform).indexOf('matrix') === 0) {
    // matrix(a, b, c, d, e, f)：岛体 morph 高度方向为主（d = 40/112 ≈ 0.36），
    // 宽度不变（a = 1）—— 任一轴非 1 即证明形变正在进行
    var parts = flip.transform.slice(7).split(',');
    var a = parseFloat(parts[0]);
    var d = parseFloat(parts[3]);
    ok(a < 0.999 || d < 0.999, 'morph 中间态 transform 非单位矩阵（a=' + a + ', d=' + d + '，合成层形变）', flip.transform);
  } else if (flip) {
    ok(false, 'morph 中间态 transform 非单位矩阵', flip.transform);
  }

  // 进度条随时间推进：线性 2s，间隔 ~500ms 采样 scaleX 应明显下降
  const sampleScaleX = () => evalJS(`(function(){
    var prog = document.querySelector('.notif-progress');
    if (!prog) return null;
    var t = getComputedStyle(prog).transform;
    if (t.indexOf('matrix') !== 0) return null;
    return parseFloat(t.slice(7).split(',')[0]);
  })()`);
  const sx1 = await sampleScaleX();
  await sleep(500);
  const sx2 = await sampleScaleX();
  ok(sx1 !== null && sx2 !== null && sx2 < sx1 - 0.1,
    '进度条 scaleX 随时间推进（' + sx1 + ' → ' + sx2 + '，~500ms 下降 >0.1）', { sx1, sx2 });

  // 2s 后自动收起（collapseTimer 与进度条 animation 共用同一时长真相源）
  const gone = await waitFor(`!document.querySelector('.notif-progress') && window.__islandVM.islandMode === 'compact'`, 4000, 100);
  const lifeMs = Date.now() - tAppear;
  ok(gone, 'low 通知 2s 后自动收起（实测 ' + lifeMs + 'ms，含 250ms 退场）', lifeMs);
  ok(lifeMs >= 1900 && lifeMs <= 3600, '生命周期时长在预期区间（1900~3600ms）', lifeMs);
}

// ================= B. urgent：伪元素呼吸 + 图标脉冲 + 5s =================
console.log('\n=== B. urgent 通知（组件方法注入，渲染链路同真实事件） ===');
await waitCompact();
await inject({
  icon: 'fa-solid fa-circle-exclamation',
  title: '群聊已解散',
  text: '动效探针群',
  type: 'group_event',
  category: 'system',
  priority: 'urgent'
});
const tUInject = Date.now();   // 生命周期锚点：注入时刻（含 250ms 退场，预期 ≈5250ms）
const urgentShown = await waitFor(`!!document.querySelector('.island.island-urgent') && !!document.querySelector('.notif-progress--urgent')`, 4000, 100);
ok(urgentShown, 'urgent 通知已展示（island-urgent + notif-progress--urgent）');

if (urgentShown) {
  const u = await evalJS(`(function(){
    var isl = document.querySelector('.island');
    var prog = document.querySelector('.notif-progress');
    var icon = document.querySelector('.notif-icon');
    var after = getComputedStyle(isl, '::after');
    var ics = getComputedStyle(icon);
    var pcs = getComputedStyle(prog);
    var strip = function(n) { return String(n).replace(/-[0-9a-f]{8}$/, ''); };
    return {
      afterAnim: strip(after.animationName),
      afterDur: after.animationDuration,
      afterContent: after.content,
      iconClass: icon.className,
      iconAnim: strip(ics.animationName),
      iconDur: ics.animationDuration,
      iconIter: ics.animationIterationCount,
      customDur: pcs.getPropertyValue('--notif-duration').trim(),
      animDur: pcs.animationDuration,
      islandTransition: getComputedStyle(isl).transitionProperty,
      islandTransitionDur: getComputedStyle(isl).transitionDuration
    };
  })()`);
  ok(u.afterAnim === 'island-urgent-breathe', '岛体伪元素呼吸动画（::after opacity，合成层）', u.afterAnim);
  ok(u.afterDur === '1.6s', '呼吸周期 1.6s', u.afterDur);
  ok(u.iconAnim === 'notif-icon-urgent-pulse' && u.iconDur === '1.2s' && u.iconIter === 'infinite',
    '图标脉冲 notif-icon-urgent-pulse 1.2s infinite（transform/opacity）', { anim: u.iconAnim, dur: u.iconDur, iter: u.iconIter });
  ok(u.customDur === '5000ms' && u.animDur === '5s', 'urgent 时长 5s', { custom: u.customDur, anim: u.animDur });
  ok(String(u.islandTransition).indexOf('box-shadow') === -1 && String(u.islandTransition).indexOf('all') === -1,
    '岛体自身不过渡 box-shadow / all（旧光晕 bug 未复活）', u.islandTransition);

  await shot('island-urgent');

  // 5s 自动收起
  const uGone = await waitFor(`!document.querySelector('.notif-progress') && window.__islandVM.islandMode === 'compact'`, 8000, 100);
  const uLife = Date.now() - tUInject;
  ok(uGone, 'urgent 通知 5s 后自动收起（实测 ' + uLife + 'ms）', uLife);
  ok(uLife >= 4800 && uLife <= 6200, 'urgent 生命周期在预期区间（4800~6200ms）', uLife);
}

// ================= C. 队列：双通知连发 → 徽章 pop + 交接 =================
console.log('\n=== C. 通知队列（连发两条 → 徽章 + 自动交接） ===');
await waitCompact();
await inject({ icon: 'fa-solid fa-comment', title: '队列甲', text: '第一条', type: 'chat', category: 'chat', chatId: 'public', priority: 'normal' });
const firstUp = await waitFor(`!!document.querySelector('.notif-progress')`, 3000, 100);
ok(firstUp, '第一条通知已展示');
await sleep(350); // 越过 notif-queue-pop 入场，确认徽章稳定存在
await inject({ icon: 'fa-solid fa-comment', title: '队列乙', text: '第二条', type: 'chat', category: 'chat', chatId: 'public', priority: 'normal' });
const badge = await waitFor(`(function(){
  var b = document.querySelector('.notif-queue');
  return b ? { text: b.textContent.trim(), anim: getComputedStyle(b).animationName.replace(/-[0-9a-f]{8}$/, '') } : null;
})()`, 2000, 100);
ok(badge && badge.text === '+1', '队列徽章 = +1', badge);
ok(badge && badge.anim === 'notif-queue-pop', '徽章入场动画 notif-queue-pop', badge);

// 第一条 3s 自动收起 + 300ms 队列延迟 → 第二条接棒
const handoff = await waitFor(`window.__islandVM.notification && window.__islandVM.notification.title === '队列乙'`, 6000, 150);
ok(handoff, '第一条消失后第二条自动接棒');
const badgeGone = await evalJS(`!document.querySelector('.notif-queue')`);
ok(badgeGone, '接棒后徽章消失');
await waitCompact();

// ================= D. reduced-motion 降级 =================
console.log('\n=== D. prefers-reduced-motion 降级 ===');
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await inject({ icon: 'fa-solid fa-bell', title: '降级验证', text: 'reduced motion', type: 'system', category: 'system', priority: 'normal' });
const rmShown = await waitFor(`!!document.querySelector('.notif-progress')`, 3000, 100);
ok(rmShown, '降级模式下通知仍可展示（内容不缺席）');
if (rmShown) {
  const rm = await evalJS(`(function(){
    var prog = document.querySelector('.notif-progress');
    var cs = getComputedStyle(prog);
    return { anim: cs.animationName, transform: cs.transform };
  })()`);
  ok(rm.anim === 'none', '进度条动画降级为 none', rm.anim);
  ok(rm.transform === 'matrix(1, 0, 0, 1, 0, 0)', '进度条保持满宽（scaleX(1)，不玩消失）', rm.transform);
}
// 还原基线（不能留 reduce，否则后续用例又全灭）
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await waitCompact();

// ================= 汇总 =================
console.log('\n════════ 超能岛动效探针结果 ════════');
console.log('通过 ' + pass + ' / 失败 ' + fail);
wsClient.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
