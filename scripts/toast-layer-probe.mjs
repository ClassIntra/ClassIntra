// 全局通知条（.global-toast）落位回归探针
//
// 背景（2026-10-23）：通知条在横屏平板上 100% 被灵动岛盖住 —— 两个原因叠加：
//   ① global.scss 的「landscape tablet」媒体查询把 top 钉成 16px，正好压在岛
//      （top 12 + 高 40 = 12~52px）身上；
//   ② toast 当时 z-index 9999 < 灵动岛 10000，于是被整块盖死。
// 修法：top 统一 64px（与 App.vue 一致），层级改用 --z-toast(99997)。
//
// 用法：node scripts/toast-layer-probe.mjs
// 通过标准：toastTopCss === '64px'，且 rect 不与 .island 竖向重叠。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const OUT = join(tmpdir(), 'ci-toast-final'); mkdirSync(OUT, { recursive: true });
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9352', `--user-data-dir=${join(tmpdir(), 'ci-toast-f-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const getJSON = async (p) => (await fetch(`http://127.0.0.1:9352${p}`)).json();
for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null;
for (let i = 0; i < 40; i++) { page = (await getJSON('/json/list')).find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}` });

await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
await sleep(4500);
const probe = `(function(){
  var app = document.querySelector('#app').__vue__;
  app.$store.commit('toast/SHOW_TOAST', { message: '落位测试', type: 'success' });
  var el = document.querySelector('.global-toast');
  var island = document.querySelector('.island') || document.querySelector('.island-wrapper');
  return {
    islandTop: island ? Math.round(island.getBoundingClientRect().top) : null,
    islandH: island ? Math.round(island.getBoundingClientRect().height) : null,
    toastTopCss: getComputedStyle(el).top,
    toastTransform: getComputedStyle(el).transform,
    toastRectTop: Math.round(el.getBoundingClientRect().top),
    toastRectBottom: Math.round(el.getBoundingClientRect().bottom),
    overlapIsland: island ? !(el.getBoundingClientRect().bottom < island.getBoundingClientRect().top || el.getBoundingClientRect().top > island.getBoundingClientRect().bottom) : null
  };
})()`;
for (const wait of [0, 400, 1200, 2000]) {
  if (wait) await sleep(wait);
  console.log('t+' + wait + 'ms:', JSON.stringify(await evalJS(probe)));
}
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'final.png'), Buffer.from(s.data, 'base64'));
console.log('shot:', join(OUT, 'final.png'));
ws.close(); chrome.kill();
