// 受控实验：CDP 派发真实触摸手势，对比「表格中间」vs「内容区边缘」的纵向滚动
// 变体 contain / auto / nowrapper —— 单变量对照
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = 'D:/tmp/scroll-exp';
const HTTP_PORT = 8177;
const CDP_PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 768, VH = 1024;          // 复刻平板竖屏逻辑视口
const START_Y = 700;                // 手势起点（表格体内）
const X_CENTER = 380;               // 表格中间
const X_EDGE = 14;                  // .admin-content 的 32px 内边距里（wrapper 之外）
const DRAG_DY = -500;               // 手指上滑 → 内容向下滚

// ---------- 静态服务器 ----------
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/repro.html' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(DIR + '/repro.html'));
  } else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));

// ---------- 启动 Chrome ----------
const profile = DIR + '/profile';
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--mute-audio',
  `--window-size=${VW},${VH}`,
  `http://127.0.0.1:${HTTP_PORT}/repro.html?v=contain`
], { stdio: 'ignore' });

async function getJSON(path) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
  return r.json();
}
let ver = null;
for (let i = 0; i < 60; i++) {
  try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); }
}
if (!ver) { console.error('Chrome 未起来'); process.exit(1); }
console.log('浏览器:', ver.Browser);

let page = null;
for (let i = 0; i < 60; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page' && t.url.includes('repro.html'));
  if (page) break;
  await sleep(500);
}
if (!page) { console.error('未找到页面 target'); process.exit(1); }

// ---------- CDP 客户端 ----------
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: VW, height: VH, deviceScaleFactor: 2, mobile: true
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

async function goto(variant) {
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/repro.html?v=${variant}` });
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    if (await evalJS('document.readyState === "complete" && document.querySelectorAll("#tbody tr").length === 60')) break;
  }
  await evalJS('document.getElementById("content").scrollTop = 0');
  await sleep(200);
}

async function drag(x, y, dy, steps = 14) {
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }]
  });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y + dy * i / steps, id: 1, radiusX: 6, radiusY: 6, force: 1 }]
    });
    await sleep(16);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

// 一次试验：返回 { hit, start, end, moved }
async function trial(variant, label, x) {
  await goto(variant);
  const hit = await evalJS(`(function(){var e=document.elementFromPoint(${x},${START_Y});
    return e ? (e.tagName.toLowerCase() + (e.id?("#"+e.id):"") + (e.className && typeof e.className==="string" ? "."+e.className.split(" ")[0] : "")) : "null";})()`);
  const start = await evalJS('document.getElementById("content").scrollTop');
  await drag(x, START_Y, DRAG_DY);
  const end = await evalJS('document.getElementById("content").scrollTop');
  const moved = Math.round(end - start);
  console.log(`  [${variant.padEnd(9)}] ${label.padEnd(10)} 起点命中=${String(hit).padEnd(22)} scrollTop ${start} → ${end}  ${moved > 20 ? '✅ 滚动了(+' + moved + ')' : '❌ 没动'}`);
  return { variant, label, hit, moved };
}

console.log('\n=== 实验：平板竖屏 768×1024，手指从 y=700 上滑 500px ===');
const results = [];
for (const v of ['contain', 'wraponly', 'auto', 'nowrapper']) {
  results.push(await trial(v, '表格中间', X_CENTER));
  results.push(await trial(v, '内容区边缘', X_EDGE));
}

console.log('\n=== 汇总 ===');
for (const v of ['contain', 'wraponly', 'auto', 'nowrapper']) {
  const c = results.find(r => r.variant === v && r.label === '表格中间');
  const e = results.find(r => r.variant === v && r.label === '内容区边缘');
  console.log(`${v.padEnd(9)} 中间=${c.moved > 20 ? '可滚' : '冻结'}(${c.moved})   边缘=${e.moved > 20 ? '可滚' : '冻结'}(${e.moved})`);
}

ws.close(); chrome.kill(); server.close();
process.exit(0);
