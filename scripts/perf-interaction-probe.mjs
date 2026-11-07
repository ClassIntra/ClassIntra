// 交互流畅度探针：采集「打开应用 / 返回桌面 / 滑页」期间的掉帧与 longtask。
//
// 背景：perf-desktop-probe.mjs 只量加载里程碑（TTFB/FCP/桌面出现），
// 量不到运行期流畅度。本探针用 rAF 帧间隔采样 + longtask 观察器，
// 在真实交互窗口内算掉帧率，把「流不流畅」变成数字。
//
// 用法：
//   本机结构体检（Chrome headless，能抓结构性卡顿/longtask，
//   但桌面机性能远强于平板，绝对掉帧率偏乐观）：
//     node scripts/perf-interaction-probe.mjs [user_id]
//
//   平板实测（拿到平板后）：
//     1. 平板 Chrome 打开 app 并登录到桌面，开 USB 调试
//     2. adb forward tcp:9222 localabstract:chrome_devtools_remote
//     3. node scripts/perf-interaction-probe.mjs --attach
//     （attach 模式连已有页面，不导航不注入 token，从当前桌面直接测交互）
//
// 已知环境坑（沿用 CDP 探针经验）：
//   - headless 强制 prefers-reduced-motion: reduce → 必须 setEmulatedMedia 覆盖，
//     否则所有过渡动画被跳过，量出来是假流畅
//   - 桌面 Chrome 右滑 = 浏览器历史返回（拦不住）→ 探针只做左滑（下一页）
//
// 输出：logs/perf/interaction-<时间戳>.json + 终端表格。
// 每个交互窗口的指标：帧数 / 平均fps / p95帧间隔 / 最大帧间隔 /
// >32ms帧占比（掉30fps线）/ >50ms / >100ms / longtask 次数与总时长。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] && process.argv[2] !== '--attach' ? process.argv[2] : '999999';
const ATTACH = process.argv.includes('--attach');
const CDP_PORT = ATTACH ? 9222 : 9337;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;   // 校园平板横屏

// ===== 连接 CDP =====
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }

let chrome = null;
if (!ATTACH) {
  // 自签 token（加载探针需要登录态；attach 模式由用户在设备上自己登录）
  const require = createRequire(REPO + '/server/node_modules/');
  const jwt = require('jsonwebtoken');
  let SECRET = null;
  for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
    if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
  }
  if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
  const isAdmin = USER_ID === '999999' ? 1 : 0;
  const token = jwt.sign(
    { user_id: USER_ID, is_admin: isAdmin, is_class_admin: isAdmin, role: isAdmin ? 'admin' : 'user' },
    SECRET, { expiresIn: '1h' }
  );
  globalThis.__CI_TOKEN = token;

  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(tmpdir(), 'ci-interaction-probe-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
  ], { stdio: 'ignore' });
}

let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ CDP 未连上（端口 ' + CDP_PORT + (ATTACH ? '，检查 adb forward' : '') + '）'); process.exit(1); }
console.log('浏览器:', ver.Browser, ATTACH ? '（attach 模式）' : '');

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  // attach 优先挑已登录桌面的标签页；否则第一个普通页面
  page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools') && !t.url.startsWith('chrome://'));
  if (page) break; await sleep(400);
}
if (!page) { console.error('✗ 没有可用页面标签'); process.exit(1); }
console.log('页面:', page.url);

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

// ===== 仿真设置（必须在导航前）=====
await send('Page.enable');
await send('Runtime.enable');
if (!ATTACH) {
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
}
// headless 强制 reduced-motion，必须显式覆盖，否则过渡动画全被跳过（假流畅）
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
});
// 手势是 touch 事件（desktop-gestures.js），需要 touch 仿真才能派发滑动
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// ===== 采样 harness：帧间隔 + longtask + 打点 =====
const HARNESS = `
  (function(){
    var probe = {
      frames: [],            // 相邻 rAF 的间隔 ms
      longTasks: [],         // { at, ms }
      marks: [],             // { name, at, frameIdx }
      _last: null,
      _count: 0,
      mark: function(name){
        this.marks.push({ name: name, at: Math.round(performance.now()), frameIdx: this._count });
      },
      dump: function(){ return { frames: this.frames, longTasks: this.longTasks, marks: this.marks }; }
    };
    function loop(t){
      if (probe._last !== null && probe.frames.length < 120000) {
        probe.frames.push(Math.round((t - probe._last) * 10) / 10);
        probe._count++;
      }
      probe._last = t;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver(function(l){
        l.getEntries().forEach(function(e){
          probe.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
        });
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
    window.__perfProbe = probe;
  })();
`;

if (!ATTACH) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try{ localStorage.setItem('token', ${JSON.stringify(globalThis.__CI_TOKEN)}); }catch(e){}
      ${HARNESS}
    `
  });
  console.log('加载', APP + '/ ...');
  await send('Page.navigate', { url: APP + '/' });
} else {
  // attach：对当前文档直接补一份 harness（本次页面生效，量交互足够）
  await evalJS(HARNESS);
}

// 等桌面出现（attach 模式假设已在桌面，只给 harness 一个起点 mark）
if (!ATTACH) {
  let desktopAt = null;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    desktopAt = await evalJS('!!(document.querySelector("[class*=\'desktop\'],[class*=\'dock\'],.app-grid") && document.querySelector(".app-icon"))');
    if (desktopAt) break;
  }
  if (!desktopAt) { console.error('⚠️ 30s 内未观察到桌面（可能停在登录页），继续按当前页测'); }
  await evalJS('window.__perfProbe && window.__perfProbe.mark("desktop-ready")');
} else {
  await evalJS('window.__perfProbe && window.__perfProbe.mark("attach-start")');
}
await sleep(2500);   // 首屏懒加载/接口结算完，让交互窗口干净

// ===== 交互步骤 =====
// 拿第一个可见图标的中心（跳过编辑态删除按钮等不可见元素）
const icon = await evalJS(`(function(){
  var els = document.querySelectorAll('.app-icon');
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight) {
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
  }
  return 'null';
})()`);
if (!icon) { console.error('✗ 桌面上没有可见图标，无法测打开应用'); process.exit(1); }
const iconPt = JSON.parse(icon);
console.log(`目标图标: (${iconPt.x}, ${iconPt.y})`);

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

// 左滑下一页（右滑在桌面 Chrome 会触发历史返回，不做）
// 桌面手势是 touch 事件：touchStart → 快速 touchMove 序列 → touchEnd
const swipeLeft = async () => {
  const y = Math.round(VH * 0.6);
  const x0 = Math.round(VW * 0.85), x1 = Math.round(VW * 0.12);
  const steps = 8, dur = 120;   // 120ms 快速滑动，接近真实甩动
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(dur / steps);
    const x = Math.round(x0 + (x1 - x0) * (i / steps));
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

// 每步：mark 开始 → 动作 → 静置结算 → mark 结束
const step = async (name, act, settleMs) => {
  await evalJS(`window.__perfProbe.mark("${name}:start")`);
  await act();
  await sleep(settleMs);
  await evalJS(`window.__perfProbe.mark("${name}:end")`);
};

// 顺序讲究：两次打开都放在滑页之前——滑页后图标可能已不在原坐标。
// 暖打开（二次打开）量 keep-alive / 路由预取的收益，冷打开量首装成本。
console.log('\n开始交互序列…');
await step('open-app', () => click(iconPt.x, iconPt.y), 3000);           // 冷打开（本会话第一次）
await step('app-idle', async () => {}, 2000);                            // 应用内静止基线
await step('back-desktop', () => evalJS('history.back()'), 2000);        // 返回桌面
await step('open-app-warm', () => click(iconPt.x, iconPt.y), 3000);      // 二次打开（keep-alive/预热路径）
await step('back-desktop-2', () => evalJS('history.back()'), 2000);      // 再次返回
await step('swipe-page', swipeLeft, 2000);                               // 桌面滑页（放最后，会改变图标位置）

// ===== 汇总 =====
const data = await evalJS('window.__perfProbe.dump()');
if (!data) { console.error('✗ harness 数据拿不到'); process.exit(1); }

function windowStats(fromIdx, toIdx) {
  const frames = data.frames.slice(fromIdx, toIdx);
  if (frames.length < 5) return null;
  const sorted = frames.slice().sort((a, b) => a - b);
  const sum = frames.reduce((s, v) => s + v, 0);
  const pct = th => Math.round(frames.filter(v => v > th).length / frames.length * 1000) / 10;
  const longTasks = data.longTasks.filter(t => t.at >= 0); // longtask 无窗口对齐，整体列出
  return {
    n: frames.length,
    avgFps: Math.round(1000 / (sum / frames.length) * 10) / 10,
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
    over32: pct(32),   // 掉 30fps 线
    over50: pct(50),
    over100: pct(100)  // 明显卡顿帧
  };
}

const marks = data.marks;
const byName = {};
marks.forEach(m => { byName[m.name] = m; });
const stepsOrder = ['open-app', 'app-idle', 'back-desktop', 'open-app-warm', 'back-desktop-2', 'swipe-page'];

console.log('\n=== 各交互窗口帧指标 ===');
console.log('  ' + '窗口'.padEnd(16) + '帧数'.padEnd(6) + 'fps'.padEnd(7) + 'p95'.padEnd(6) + 'max'.padEnd(7) + '>32ms'.padEnd(7) + '>50ms'.padEnd(7) + '>100ms');
const report = { browser: ver.Browser, mode: ATTACH ? 'attach' : 'headless', longTasks: data.longTasks, windows: {}, marks: marks };
for (const s of stepsOrder) {
  const start = byName[s + ':start'];
  const end = byName[s + ':end'];
  if (!start || !end) continue;
  const st = windowStats(start.frameIdx, end.frameIdx);
  if (!st) { console.log('  ' + s.padEnd(16) + '（帧样本不足）'); continue; }
  report.windows[s] = st;
  console.log('  ' + s.padEnd(16) + String(st.n).padEnd(6) + String(st.avgFps).padEnd(7) + String(st.p95).padEnd(6) + String(st.max).padEnd(7) + (st.over32 + '%').padEnd(7) + (st.over50 + '%').padEnd(7) + st.over100 + '%');
}

console.log('\n=== longtask（整场）===');
const lt = data.longTasks || [];
console.log('  次数=' + lt.length + (lt.length ? '，总时长=' + lt.reduce((s, t) => s + t.ms, 0) + 'ms，最长=' + Math.max(...lt.map(t => t.ms)) + 'ms' : ''));
lt.slice(0, 15).forEach(t => console.log('    @' + t.at + 'ms  ' + t.ms + 'ms'));

console.log('\n=== 判读 ===');
const openWin = report.windows['open-app'];
const warmWin = report.windows['open-app-warm'];
if (openWin) console.log('  冷打开 >32ms 帧占比 ' + openWin.over32 + '%（平板真机以 >100ms 帧占比为硬指标，桌面机只看结构性问题）');
if (warmWin) console.log('  暖打开 >32ms 帧占比 ' + warmWin.over32 + '%（与冷打开对比 = keep-alive/预取收益）');
if (lt.length > 20) console.log('  ⚠️ longtask ' + lt.length + ' 次：主线程有整块长任务，优先切片');

const shotDir = join(REPO, 'logs', 'perf');
mkdirSync(shotDir, { recursive: true });
const outPath = join(shotDir, 'interaction-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('\n报告 → ' + outPath);

ws.close();
if (chrome) chrome.kill();
