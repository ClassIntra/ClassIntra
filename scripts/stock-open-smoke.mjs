// stock 打开路径修复后的功能冒烟：打开应用 → 断言各区块就位 → 交互走查 → 截图。
//
// 背景：布局风暴修复（booting 闸 + patchMarketCard 区块替换）改了首载渲染
// 时序，必须确认没有把功能改坏：资产卡/收盘报告/快讯/行情列表都要出现，
// tab 切换（修复后的 patch 路径）和详情页（未改动路径）仍可用。
//
// 用法：node scripts/stock-open-smoke.mjs [user_id]
// 前置：CI 已在 127.0.0.1:9001 运行；server/.env 内有 JWT_SECRET。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9340;
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
const isAdmin = USER_ID === '999999' ? 1 : 0;
const token = jwt.sign(
  { user_id: USER_ID, is_admin: isAdmin, is_class_admin: isAdmin, role: isAdmin ? 'admin' : 'user' },
  SECRET, { expiresIn: '1h' }
);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-stock-smoke-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

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
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try{
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('ci-stock-guide-v1', '1');   // 跳过新手引导，不挡断言
    }catch(e){}
  `
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });
for (let i = 0; i < 120; i++) {
  await sleep(250);
  const ok = await evalJS('!!document.querySelector(".app-icon[data-src-app=\'stock\']")');
  if (ok) break;
}
await sleep(2000);

const icon = await evalJS(`(function(){
  var el = document.querySelector('.app-icon[data-src-app="stock"]');
  if (!el) return 'null';
  var r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`);
if (!icon) { console.error('✗ 桌面上没有 stock 图标'); process.exit(1); }
const pt = JSON.parse(icon);
await evalJS('console.timeStamp("CI_OPEN")');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });

// 等行情列表出现（boot 收尾渲染的标志）
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  ready = await evalJS('!!document.querySelector(".ci-stock .view-market .qrow")');
  if (ready) break;
}
await sleep(1500);   // 让 report/news 区块替换也落定

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!pass) failures++;
};

console.log('\n=== 首屏区块（booting 收尾渲染路径）===');
const first = await evalJS(`JSON.stringify({
  hero: !!document.querySelector('.ci-stock .view-market .hero'),
  heroValue: (document.querySelector('.ci-stock .view-market .hero-value') || {}).textContent || '',
  report: !!document.querySelector('.ci-stock .view-market .report-card'),
  reportTitle: (document.querySelector('.ci-stock .view-market .report-title') || {}).textContent || '',
  news: !!document.querySelector('.ci-stock .view-market .news-strip'),
  newsRows: document.querySelectorAll('.ci-stock .view-market .news-strip .news-row, .ci-stock .view-market .news-strip .card > div').length,
  qrows: document.querySelectorAll('.ci-stock .view-market .qrow').length,
  meta: (document.querySelector('.ci-stock .view-market .market-meta') || {}).textContent || '',
  booting: undefined
})`);
const F = JSON.parse(first);
check('资产卡 .hero', F.hero, F.heroValue);
check('收盘报告 .report-card', F.report, F.reportTitle);
check('市场快讯 .news-strip', F.news);
check('行情列表 .qrow', F.qrows > 0, F.qrows + ' 行');
check('市场概况 .market-meta', /股票池|尚未开盘/.test(F.meta), F.meta.slice(0, 40));

console.log('\n=== 切走再切回（patch 路径：不应整页重建）===');
// 点 nav 上的「委托」再回「行情」：回程走 patchMarketCard（report/news）+ patchQuotes
const navClick = async label => {
  const pos = await evalJS(`(function(){
    var items = document.querySelectorAll('.ci-stock .nav .nav-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].textContent.indexOf(${JSON.stringify(label)}) !== -1) {
        var r = items[i].getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      }
    }
    return 'null';
  })()`);
  if (pos === 'null') return false;
  const p = JSON.parse(pos);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return true;
};
await sleep(500);
const navOk1 = await navClick('委托');
await sleep(1200);
const ordersView = await evalJS('!!document.querySelector(".ci-stock .main .view-orders, .ci-stock .main [class*=order]")');
check('切到委托页', navOk1 && ordersView);
const navOk2 = await navClick('行情');
await sleep(1500);
const backView = await evalJS(`JSON.stringify({
  qrows: document.querySelectorAll('.ci-stock .view-market .qrow').length,
  report: !!document.querySelector('.ci-stock .view-market .report-card'),
  news: !!document.querySelector('.ci-stock .view-market .news-strip')
})`);
const B = JSON.parse(backView);
check('切回行情页：列表在', B.qrows > 0, B.qrows + ' 行');
check('切回行情页：报告卡在（patch 替换成功）', B.report);
check('切回行情页：快讯在（patch 替换成功）', B.news);

console.log('\n=== 详情页（未改动路径，回归确认）===');
const firstRow = await evalJS(`(function(){
  var row = document.querySelector('.ci-stock .view-market .qrow');
  if (!row) return 'null';
  var r = row.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), code: row.getAttribute('data-code') });
})()`);
if (firstRow !== 'null') {
  const rp = JSON.parse(firstRow);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rp.x, y: rp.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rp.x, y: rp.y, button: 'left', clickCount: 1 });
  await sleep(2500);
  const detail = await evalJS(`JSON.stringify({
    view: !!document.querySelector('.ci-stock .main [class*=detail]'),
    price: (document.querySelector('.ci-stock [data-field="dprice"]') || {}).textContent || ''
  })`);
  const D = JSON.parse(detail);
  check('详情页打开', D.view, rp.code + (D.price ? ' · 价 ' + D.price : ''));
  // 返回行情：详情是应用内状态（S.detailCode），必须点应用内「‹ 行情」按钮；
  // history.back() 会退出整个 market 应用回桌面（AppShell 路由语义），查不到元素
  const backPos = await evalJS(`(function(){
    var b = document.querySelector('.ci-stock .back-btn');
    if (!b) return 'null';
    var r = b.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (backPos !== 'null') {
    const bp = JSON.parse(backPos);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bp.x, y: bp.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bp.x, y: bp.y, button: 'left', clickCount: 1 });
    await sleep(1200);
  }
} else {
  check('详情页打开', false, '没有可点的行情行');
}

console.log('\n=== 收尾状态 ===');
const fin = await evalJS(`JSON.stringify({
  hero: !!document.querySelector('.ci-stock .view-market .hero'),
  qrows: document.querySelectorAll('.ci-stock .view-market .qrow').length,
  errors: [].slice.call(document.querySelectorAll('.ci-stock .error-box')).length
})`);
const E = JSON.parse(fin);
check('返回后资产卡仍在', E.hero);
check('返回后列表仍在', E.qrows > 0, E.qrows + ' 行');
check('无错误态 .error-box', E.errors === 0, E.errors ? E.errors + ' 个错误框' : '');

mkdirSync(join(REPO, 'logs', 'perf'), { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
const shotPath = join(REPO, 'logs', 'perf', 'stock-smoke-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.png');
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
console.log('\n截图 → ' + shotPath);

console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
ws.close();
chrome.kill();
process.exit(failures === 0 ? 0 : 1);
