// 冷启动 vs 二次进入（同一 profile 连续两次导航，第二次应几乎全 304）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9377;
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
  `--user-data-dir=${join(tmpdir(), 'ci-warm-' + Date.now())}`,
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

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 2 * 1024 * 1024 / 8, uploadThroughput: 512 * 1024 / 8 });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});}catch(e){}
    window.__m={t0:Date.now()};
    (function(){var mo=new MutationObserver(function(){
      if(!window.__m.desktop && document.querySelector('.desktop-pages .app-icon')) window.__m.desktop=Date.now()-window.__m.t0;
    });document.addEventListener('DOMContentLoaded',function(){mo.observe(document.documentElement,{childList:true,subtree:true});});})();`
});

async function load(label) {
  await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
  for (let i = 0; i < 200; i++) { await sleep(300); if (await evalJS('window.__m && window.__m.desktop')) break; }
  await sleep(3000);
  const rep = await evalJS(`(function(){
    var res = performance.getEntriesByType('resource');
    var bytes = res.reduce(function(a,r){ return a + (r.transferSize||0); }, 0);
    var fcp = (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime||0;
    return { totalKB: Math.round(bytes/1024), reqs: res.length, fcp: Math.round(fcp), desktop: window.__m.desktop };
  })()`);
  console.log(`  ${label}: 传输 ${rep.totalKB}KB / ${rep.reqs} 请求 | FCP ${rep.fcp}ms | 桌面 ${rep.desktop}ms`);
  return rep;
}
console.log('慢网 + 6x CPU（同一设备连续两次进入）：');
await load('首次（冷）');
await send('Page.reload', { ignoreCache: false });
await evalJS('window.__m = {t0: Date.now()}; true');
await load('二次（热）');
chrome.kill(); process.exit(0);
