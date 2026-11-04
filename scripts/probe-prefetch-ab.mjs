// 预取收益 A/B 探针：同一个慢网+6x CPU 条件下，开/关预取各点一次「音乐」图标，
// 量「点击 → 应用根 DOM 出现」的耗时，并核对 chunk 是否已被提前拉取。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9357;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-prefetch-ab-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 2 * 1024 * 1024 / 8, uploadThroughput: 512 * 1024 / 8 });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });

async function runOnce(disablePrefetch) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{ localStorage.setItem('token', ${JSON.stringify(token)});
      ${disablePrefetch ? "localStorage.setItem('ci_prefetch','off');" : "localStorage.removeItem('ci_prefetch');"}
    }catch(e){}`
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
  for (let i = 0; i < 120; i++) { await sleep(250); if (await evalJS(`!!document.querySelector('.desktop-pages .app-icon') && !document.getElementById('app-loading')`)) break; }
  // 等预取窗口（2.6s 启动 + 4 块 × 0.9s 间隔）
  await sleep(disablePrefetch ? 2500 : 7000);

  const prefetched = await evalJS(`performance.getEntriesByType('resource').filter(function(r){ return /\\/assets\\/(Music|Community|Chat|Calendar)-/.test(r.name); }).map(function(r){ return r.name.split('/').pop(); })`);
  const icon = await evalJS(`(function(){
    var img = document.querySelector('.desktop-pages .app-icon img[src*="Music" i]');
    var host = img && img.closest('.app-icon');
    if (!host) return null;
    var r = host.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var hit = document.elementFromPoint(cx, cy);
    if (hit && hit.closest('.app-icon') === host) return { x: Math.round(cx), y: Math.round(cy) };
    return null;
  })()`);
  if (!icon) return { ok: false, prefetched: prefetched };
  const t0 = Date.now();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: icon.x, y: icon.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: icon.x, y: icon.y, button: 'left', buttons: 0, clickCount: 1 });
  let elapsed = null;
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    const p = await evalJS(`location.pathname`);
    if (p && p !== '/') { elapsed = Date.now() - t0; break; }
  }
  let firstPaint = null;
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    if (await evalJS(`!!document.querySelector('.music-page, .community-page, .weather-page')`)) { firstPaint = Date.now() - t0; break; }
  }
  return { ok: true, routeMs: elapsed, paintMs: firstPaint, prefetched: prefetched };
}

const off = await runOnce(true);
console.log('关闭预取:', JSON.stringify(off));
const on = await runOnce(false);
console.log('开启预取:', JSON.stringify(on));
if (off.paintMs && on.paintMs) {
  console.log(`\n应用首屏可用: ${off.paintMs}ms → ${on.paintMs}ms（省 ${off.paintMs - on.paintMs}ms，${Math.round((1 - on.paintMs / off.paintMs) * 100)}%）`);
}
chrome.kill(); process.exit(0);
