// E2E 触摸滚动探针：直接加载真实管理页 /admin（自签管理员 token），
// 在 768×1024 移动视口派发真实触摸手势，量化 .admin-content.scrollTop。
//
// 用法：node e2e-admin-probe.mjs [表格内的 y 偏移]
// 前置：CI 已在 127.0.0.1:9001 运行；server/.env 内有 JWT_SECRET。
//
// 判定：表格中间（命中 td）与内容区边缘（命中 .admin-content）**都能滚** → 修复生效。
//       中间冻结、边缘可滚 → 症状仍在。

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ADMIN_ID = process.argv[3] || '251800';
const VW = 768, VH = 1024;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

// ---- 取密钥（只解析，不打印）----
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: ADMIN_ID, is_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
console.log(`自签管理员 token 完成（user_id=${ADMIN_ID}）`);

// ---- 启动 Chrome ----
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-touch-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--mute-audio',
  `--window-size=${VW},${VH}`, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
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
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
// 关键：在应用启动前把 token 写进 localStorage
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token', ${JSON.stringify(token)});}catch(e){}`
});

console.log('加载', APP + '/admin ...');
await send('Page.navigate', { url: APP + '/admin' });

// 等用户信息到位（tab 出现说明 store.user 已就绪）
for (let i = 0; i < 80; i++) {
  await sleep(250);
  if (await evalJS(`document.querySelectorAll('.admin-tab').length`)) break;
}

// 等表格；兜底：注入 token 时 user 可能晚于 mounted 到位，activeTab 停在空值 →
// 用户管理区永不渲染。此时手动点一次「用户管理」tab 提拉。
let rows = 0;
for (let i = 0; i < 120; i++) {
  await sleep(300);
  rows = await evalJS(`document.querySelectorAll('.data-table tbody tr').length`) || 0;
  if (rows > 3) break;
  if (i > 0 && i % 10 === 0) {
    await evalJS(`(function(){
      var b = Array.from(document.querySelectorAll('.admin-tab')).find(function(x){return x.textContent.trim() === '用户管理'});
      if (b && !document.querySelector('.data-table')) b.click();
      return true;})()`);
  }
}
if (rows <= 3) {
  console.error(`✗ 用户表格未渲染（行数=${rows}）`);
  console.error('  当前 URL:', await evalJS('location.href'));
  console.error('  提示:', await evalJS(`(document.querySelector('.empty-text,.loading-container')||{}).textContent || '(无)'`));
  ws.close(); chrome.kill(); process.exit(1);
}
console.log(`✓ 管理页就绪，用户行数=${rows}`);

// 等开屏动画退场：.al-boot 是 position:fixed / z-index:20000 的全屏层，
// 它不是 .admin-content 的后代 → 手势落在它上面时找不到可滚动祖先，滚动全被吃掉。
// 不等它退场就会得到「中间冻结」的假阴性。
let bootGone = false;
for (let i = 0; i < 150; i++) {
  if (!(await evalJS(`!!document.querySelector('.al-boot')`))) { bootGone = true; break; }
  await sleep(400);
}
console.log(bootGone ? '✓ 开屏动画已退场' : '⚠️ 开屏动画 60s 未退场，本次手势结果不可信');

const geo = await evalJS(`(function(){
  var c = document.querySelector('.admin-content');
  var t = document.querySelector('.data-table');
  var r = t.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight,
           viewport: innerWidth + 'x' + innerHeight,
           contentClientH: c.clientHeight, contentScrollH: c.scrollHeight,
           tableLeft: Math.round(r.left), tableTop: Math.round(r.top),
           tableW: Math.round(r.width), tableH: Math.round(r.height),
           docScrollable: c.scrollHeight > c.clientHeight };
})()`);
console.log('视口/几何:', JSON.stringify(geo));
if (!geo.docScrollable) { console.error('✗ .admin-content 不可滚动，量不到差异'); }

const Y_INSIDE = Math.min(geo.vh - 160, Math.max(geo.tableTop + 140, 340));
const X_CENTER = Math.round(Math.min(geo.vw - 80, geo.tableLeft + geo.tableW / 2));
const X_EDGE = Math.max(6, Math.round(geo.tableLeft / 2) - 2);   // 落在 .admin-content 的左侧内边距里

async function dispatchDrag(x, y, dy, steps = 16) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / steps, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
    await sleep(20);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
}

async function trial(label, x) {
  await evalJS(`document.querySelector('.admin-content').scrollTop = 0`);
  await sleep(250);
  const hit = await evalJS(`(function(){var e=document.elementFromPoint(${x}, ${Y_INSIDE});
    if(!e) return 'null';
    var p=[], n=e;
    while(n && p.length<3){ p.push(n.tagName.toLowerCase() + (n.className && typeof n.className==='string' && n.className.trim() ? '.'+n.className.trim().split(/\\s+/)[0] : '')); n=n.parentElement; }
    return p.join(' < ');})()`);
  const before = await evalJS(`document.querySelector('.admin-content').scrollTop`);
  await dispatchDrag(x, Y_INSIDE, -500);
  const after = await evalJS(`document.querySelector('.admin-content').scrollTop`);
  const moved = Math.round(after - before);
  const ok = moved > 20;
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(12)} (x=${String(x).padStart(3)}) 命中=${hit.padEnd(34)} scrollTop ${before} → ${after}  ${ok ? '滚动了 +' + moved : '冻结'}`);
  return ok;
}

console.log(`\n=== 真实管理页手势测试（手指从 y=${Y_INSIDE} 上滑 500px）===`);
const centerOK = await trial('表格中间', X_CENTER);
const edgeOK = await trial('内容区边缘', X_EDGE);

// 反向对照：运行时把 wrapper 临时改回 contain。若中间重新冻结 → 因果闭环，
// 证明是这一条属性（而非巧合/其它因素）在决定结果。
await evalJS(`(function(){var w=document.querySelector('.data-table-wrapper');
  if(w) w.style.overscrollBehaviorY='contain'; return !!w;})()`);
await sleep(200);
const negOK = await trial('反向对照 contain', X_CENTER);
await evalJS(`(function(){var w=document.querySelector('.data-table-wrapper');
  if(w) w.style.overscrollBehaviorY=''; return true;})()`);

console.log('\n=== 结论 ===');
if (centerOK && edgeOK && !negOK) {
  console.log('✅ 修复生效且因果闭环：修复版中间/边缘均可滚；把 wrapper 临时改回 contain 后，中间立刻重新冻结。');
} else if (!centerOK && edgeOK) {
  console.log('❌ 症状仍在：表格中间冻结、边缘可滚（与用户反馈一致）。');
} else {
  console.log(`⚠️ 结果异常：中间=${centerOK ? '可滚' : '冻结'} 边缘=${edgeOK ? '可滚' : '冻结'} 反向对照=${negOK ? '仍可滚(对照失效)' : '冻结(符合预期)'}`);
}

ws.close(); chrome.kill();
process.exit(0);
