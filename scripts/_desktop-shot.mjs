// 桌面六态截图审计：默认页 / 编辑态 / 文件夹展开 / 设置面板 / dock-only / 第 1 页
// 用法：node scripts/_desktop-shot.mjs  → 输出 D:/tmp/desktop-shots/*.png
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9343;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const OUT = 'D:/tmp/desktop-shots';
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-shot-profile')}`,
  '--disable-features=HistoricalSwipeNav,OverscrollHistoryNavigation',
  '--no-first-run', '--disable-extensions', '--mute-audio', `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null;
for (let i = 0; i < 40; i++) { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: r.exceptionDetails.text } : r.result.value; };
async function shot(name) {
  await sleep(650);  // 等过渡动画播完
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('✓', name);
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('token', ${JSON.stringify(token)})}catch(e){}` });
await send('Page.navigate', { url: APP + '/' });
for (let i = 0; i < 120; i++) { await sleep(250); if (await evalJS(`!!(document.querySelector('#app')&&document.querySelector('#app').__vue__&&document.querySelector('#app').__vue__.$store.state.desktop.layout)`)) break; }
await sleep(2000);
const store = `document.querySelector('#app').__vue__.$store`;

// 1. 默认第 0 页
await shot('1-default-page0');
// 2. 第 1 页
await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 1)`);
await shot('2-page1');
await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 0)`);
// 3. 编辑态
await evalJS(`${store}.dispatch('desktop/enterEditMode')`);
await shot('3-edit-mode');
await evalJS(`${store}.dispatch('desktop/exitEditMode')`);
// 4. 文件夹展开（临时造）
await evalJS(`${store}.commit('desktop/CREATE_FOLDER', { pageIndex: 0, index: 0, targetAppName: (function(){ var s=${store}.state.desktop.layout.pages[0].slots; for (var i=0;i<s.length;i++){ if(s[i]&&s[i].type==='app') return s[i].name; } return ''; })(), newAppName: (function(){ var s=${store}.state.desktop.layout.pages[0].slots; var a=null,b=null; for (var i=0;i<s.length;i++){ if(s[i]&&s[i].type==='app'){ if(!a)a=s[i].name; else { b=s[i].name; break; } } } return b||''; })(), folderName: '学习', from: null })`);
await sleep(400);
const fid = await evalJS(`(function(){ var f=${store}.state.desktop.layout.folders||{}; var ids=Object.keys(f); for(var i=0;i<ids.length;i++){ if(f[ids[i]].name==='学习') return ids[i]; } return null; })()`);
if (fid) {
  await evalJS(`(function(){ var root=document.querySelector('#app').__vue__; var d=null; (function w(l){ (l||[]).forEach(function(v){ if(!d&&typeof v.launchApp==='function') d=v; if(v.$children) w(v.$children); }); })(root.$children); d.openFolder('${fid}'); })()`);
  await shot('4-folder-open');
  await evalJS(`(function(){ var root=document.querySelector('#app').__vue__; var d=null; (function w(l){ (l||[]).forEach(function(v){ if(!d&&typeof v.launchApp==='function') d=v; if(v.$children) w(v.$children); }); })(root.$children); d.closeFolder(); })()`);
  await evalJS(`${store}.commit('desktop/DELETE_FOLDER', { folderId: '${fid}' })`);
}
// 5. 设置面板
await evalJS(`${store}.commit('desktop/SET_SETTINGS_PANEL', true)`);
await shot('5-settings-panel');
await evalJS(`${store}.commit('desktop/SET_SETTINGS_PANEL', false)`);
// 6. dock-only 模式（临时切，截图后还原）
await evalJS(`${store}.commit('settings/SET_DESKTOP_LAYOUT', 'dock')`);
await shot('6-dock-only');
await evalJS(`${store}.commit('settings/SET_DESKTOP_LAYOUT', 'grid')`);
console.log('输出目录:', OUT);
ws.close(); process.exit(0);
