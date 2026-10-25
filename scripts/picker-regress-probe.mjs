// 回归：Chat / Community 的云盘选图仍是「全部类型」原样
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9387',
  `--user-data-dir=${join(tmpdir(), 'ci-picker-regress')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9387${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(token)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe', is_admin: 0, role: 'officer' }))});
  }catch(e){}`
});

await send('Page.navigate', { url: APP + '/chat' });
await sleep(6500);
await ev(`(function(){ try{ var a=document.querySelector('#app').__vue__; var o=a&&a.$refs&&a.$refs.bigTextOverlay; if(o&&o.hide)o.hide(); }catch(e){} })()`);

// 打开任一私聊会话，点云盘按钮
const opened = await ev(`(function(){
  var c=document.querySelector('.chat-item'); if(c) c.click(); return !!c;
})()`);
await sleep(2500);
const clicked = await ev(`(function(){
  var b=document.querySelector('.cloud-toggle'); if(b) b.click(); return !!b;
})()`);
await sleep(2000);

console.log('聊天页选图:', JSON.stringify(await ev(`(function(){
  var sheet=document.querySelector('.cloud-picker-sheet');
  if(!sheet) return { open:false, openedChat: ${opened}, clickedCloud: ${clicked} };
  var tabs=Array.prototype.slice.call(document.querySelectorAll('.picker-tab')).map(function(t){return t.innerText.trim()});
  return {
    open:true,
    title: document.querySelector('.picker-header span') ? document.querySelector('.picker-header span').innerText : null,
    tabs: tabs,
    hasFullscreen: !!document.querySelector('.picker-fullscreen-btn'),
    items: document.querySelectorAll('.picker-item').length,
    hasCurrentBadge: !!document.querySelector('.picker-current'),
    anchoredBottom: Math.abs(sheet.getBoundingClientRect().bottom - window.innerHeight) < 2
  };
})()`)));

ws.close(); chrome.kill();
