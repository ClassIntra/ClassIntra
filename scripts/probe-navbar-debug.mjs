// 调试：象棋入场页「提示」按钮为何可见
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire('D:/NetWork/Integration/ClassIntra/server/node_modules/');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');
let SECRET = null;
for (const line of readFileSync('D:/NetWork/Integration/ClassIntra/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const tok = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '2h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9348', '--user-data-dir=' + join(tmpdir(), 'ci-nav-dbg-' + Date.now()), '--no-first-run', '--mute-audio', '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
const getJSON = async (p) => (await fetch('http://127.0.0.1:9348' + p)).json();
let ver = null; for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null; for (let i = 0; i < 40; i++) { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i2 = ++id; pend.set(i2, { res, rej }); ws.send(JSON.stringify({ id: i2, method, params })); });
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r && r.result ? r.result.value : undefined; };
const waitFor = async (e, t = 15000) => { const d = Date.now() + t; while (Date.now() < d) { try { if (await evalJS(e)) return true; } catch (e2) {} await sleep(250); } return false; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:9099/' }); await sleep(2500);
await evalJS(`(function(){localStorage.setItem('token', ${JSON.stringify(tok)});localStorage.setItem('user',JSON.stringify({user_id:'251800',net_name:'探针管理员',is_admin:1,role:'user'}));localStorage.setItem('ci:market-source','local');return true;})()`);
await send('Page.navigate', { url: 'http://127.0.0.1:9099/market' });
await waitFor(`!!document.querySelector('.market-page')`, 20000); await sleep(1000);
await send('Page.navigate', { url: 'http://127.0.0.1:9099/chess' });
await waitFor(`!!document.querySelector('.app-nav-bar')`, 20000); await sleep(3500);

const dbg = await evalJS(`(function(){
  var out = {};
  var slot = document.querySelector('[data-role="host-navbar-slot"]');
  out.slotChildren = slot ? Array.from(slot.children).map(function(c){ return c.className + '>' + c.childElementCount; }) : null;
  var hint = document.querySelector('.ci-host-navbar [data-action="hint"]') || document.querySelector('[data-action="hint"]');
  if (!hint) { out.hint = 'not found'; return out; }
  var cs = getComputedStyle(hint);
  out.hint = {
    hiddenProp: hint.hidden,
    hiddenAttr: hint.hasAttribute('hidden'),
    display: cs.display,
    text: hint.textContent,
    parentClass: hint.parentElement ? hint.parentElement.className : null,
    inHost: !!hint.closest('[data-role="host-navbar-slot"]'),
    inRoot: !!hint.closest('.chess-app'),
    rect: (function(r){return {w:Math.round(r.width),h:Math.round(r.height)};})(hint.getBoundingClientRect())
  };
  out.all = Array.from(document.querySelectorAll('.ci-host-navbar [data-action], .chess-app [data-action]')).filter(function(b){return b.closest('.chess-actions');}).map(function(b){
    return b.dataset.action + ':' + (b.hidden ? 'hidden' : 'VISIBLE') + ':' + getComputedStyle(b).display;
  });
  return out;
})()`);
console.log(JSON.stringify(dbg, null, 1));
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(0);
