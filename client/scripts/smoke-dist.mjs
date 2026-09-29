// smoke-dist.mjs — 构建产物冒烟检查（服务在跑时用）：真实浏览器打开首页，
// 断言启动屏退场、无资源 404、无 console error，并输出截图。
//
// 为什么需要它：dist/assets 会被 prune-dist.js 回收上千个旧文件，
// 「删了不该删的」这类事故只有让真实页面把所有 chunk（含懒加载）拉一遍才验得出来。
//
// 用法：node scripts/smoke-dist.mjs [url] [输出名]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9361;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = REPO + '/logs/smoke';
const URL_ = process.argv[2] || 'http://127.0.0.1:9001/';
const NAME = process.argv[3] || 'dist-smoke';
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-smoke-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--mute-audio',
  '--window-size=1043,787', '--hide-scrollbars', 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }
let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find((t) => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
const assetFailures = [];     // 产物缺失/加载失败 —— 必须为 0
const apiFailures = [];       // 接口 4xx（匿名访问时的 401 等）—— 预期内，不影响判定
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400) (r.url.indexOf('/api/') === -1 ? assetFailures : apiFailures).push(r.status + ' ' + r.url);
  }
  if (m.method === 'Network.loadingFailed') {
    assetFailures.push('LOADFAIL ' + (m.params.errorText || ''));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = (m.params.args || []).map((a) => a.value || a.description || a.type).join(' ');
    // Vue Router 在「未登录 → 跳 /login」时抛出 Navigation cancelled 属正常行为，不计为错误
    if (text.indexOf('Navigation cancelled') !== -1) return;
    consoleErrors.push(text);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });

let bootGone = false;
for (let i = 0; i < 60; i++) {
  if (!(await evalJS(`!!document.querySelector('#app-loading')`))) { bootGone = true; break; }
  await sleep(400);
}
await sleep(1500);

// 挂载断言 + 截图
const mounted = await evalJS(`!!(document.querySelector('#app') && document.querySelector('#app').children.length)`);
const shot = join(OUT, NAME + '.png');
const cap = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(shot, Buffer.from(cap.data, 'base64'));
ws.close(); chrome.kill();

console.log('启动屏退场=' + bootGone);
console.log('#app 已挂载=' + mounted);
console.log('产物失败(' + assetFailures.length + ')：' + (assetFailures.length ? '\n  ' + assetFailures.slice(0, 20).join('\n  ') : '无'));
console.log('接口 4xx（预期内，不计入判定）(' + apiFailures.length + ')：' + (apiFailures.length ? '\n  ' + apiFailures.slice(0, 10).join('\n  ') : '无'));
console.log('console error(' + consoleErrors.length + ')：' + (consoleErrors.length ? '\n  ' + consoleErrors.slice(0, 10).join('\n  ') : '无'));
console.log('截图 → ' + shot);
process.exit(bootGone && mounted && !assetFailures.length && !consoleErrors.length ? 0 : 1);
