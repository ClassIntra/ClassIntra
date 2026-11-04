// 补拍：浅色主题下 chess/gomoku 的入场页与房间页（目检导航栏左侧文字区）
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const adminTok = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '2h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9347',
  '--user-data-dir=' + join(tmpdir(), 'ci-nav-light-' + Date.now()),
  '--no-first-run', '--mute-audio', '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch('http://127.0.0.1:9347' + p)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('页面内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}
async function waitFor(expr, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await evalJS(expr)) return true; } catch (e) {} await sleep(250); }
  return false;
}
async function shotTo(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: APP + '/' });
await sleep(2500);
await evalJS(`(function(){
  localStorage.setItem('token', ${JSON.stringify(adminTok)});
  localStorage.setItem('user', JSON.stringify({ user_id: '251800', net_name: '探针管理员', is_admin: 1, role: 'user' }));
  localStorage.setItem('ci:market-source', 'local');
  return true;
})()`);

for (const route of ['/chess', '/gomoku']) {
  await send('Page.navigate', { url: APP + '/market' });
  await waitFor(`!!document.querySelector('.market-page')`, 20000);
  await sleep(1000);
  await evalJS(`(function(){
    var el = document.querySelector('#app');
    var vm = el && el.__vue__ ? el.__vue__ : null;
    if (vm && vm.$store) vm.$store.commit('settings/SET_THEME', 'light');
    return true;
  })()`);
  await sleep(800);
  await send('Page.navigate', { url: APP + route });
  await waitFor(`!!document.querySelector('.app-nav-bar')`, 20000);
  await sleep(3500); // 等启动屏完全退场
  const name = route.slice(1);
  await shotTo('/tmp/ci-nav-probe/' + name + '-light-entry.png');
  console.log('已拍', name, '入场页');
  await evalJS(`(function(){ var b = document.querySelector('[data-action="create"]'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(2200);
  await shotTo('/tmp/ci-nav-probe/' + name + '-light-room.png');
  console.log('已拍', name, '房间页');
}
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(0);
