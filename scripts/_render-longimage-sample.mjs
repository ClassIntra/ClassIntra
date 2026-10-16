// 一次性：在真浏览器里跑一次长图导出，把产物落到 logs/ 供人眼检查排版
// （手写 Canvas 排版只能靠肉眼验收；脚本跑完请删除本文件）
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9347;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const Database = require(REPO + '/server/node_modules/better-sqlite3');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const db = new Database(REPO + '/server/database/classintra.db', { readonly: true });
const USER = db.prepare('SELECT user_id FROM users WHERE is_admin = 1 LIMIT 1').get().user_id;
db.close();
const TOKEN = jwt.sign({ user_id: USER, is_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const api = async (m, u, b) => (await fetch(APP + u, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) })).json();

let r = await api('GET', '/api/ai-chat/admin/models');
const target = r.data.models.find(x => x.is_default) || r.data.models[0];
const wasOn = !!target.supports_vision;
if (!wasOn) await api('PUT', '/api/ai-chat/admin/models/' + target.id, { supports_vision: true });
// 这次要导出，需要「看起来像有图」的用户消息，只造一条纯文本即可
r = await api('POST', '/api/ai-chat/conversations', { title: '长图排版样张' });
const convId = r && r.data && r.data.id;
if (!convId) { console.error('建会话失败:', JSON.stringify(r)); process.exit(1); }
await api('PUT', '/api/ai-chat/conversations/' + convId + '/messages', {
  messages: [
    { role: 'user', content: '把「牛顿第二定律」讲清楚，顺便对比一下三大定律各自解决什么问题。' },
    { role: 'assistant', content: '## 一句话结论\n\n**F = ma**：合外力让物体产生加速度，方向与合外力一致，大小与质量成反比。\n\n## 三大定律各自管什么\n\n| 定律 | 内容 | 解决的问题 |\n| --- | --- | --- |\n| 第一定律 | 不受力时保持静止或匀速直线运动 | 定义「惯性参考系」 |\n| 第二定律 | F = ma | 定量计算运动变化 |\n| 第三定律 | 作用力与反作用力等大反向 | 解释相互作用 |\n\n## 一个能跑的验证\n\n```python\n# 水平面上恒力推动，忽略摩擦\nm, F, t = 2.0, 6.0, 3.0\na = F / m          # 3.0 m/s^2\nv = a * t          # 9.0 m/s\ns = 0.5 * a * t**2 # 13.5 m\nprint(f"{a=} {v=} {s=}")\n```\n\n- **注意**：F 必须是「合外力」，用单个力代替会算错\n- 单位统一用国际单位制，否则 a 的量纲会对不上\n- 超过光速量级时经典力学失效，需要相对论修正' }
  ]
});

const profile = join(tmpdir(), 'ci-longimg-' + Date.now());
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 60; i++) { try { page = (await getJSON('/json/list')).find(t => t.type === 'page'); if (page) break; } catch (e) {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const errs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('ERR ' + m.params.args.map(a => a.value || a.description || '').join(' '));
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('token',${JSON.stringify(TOKEN)});localStorage.setItem('ai_last_conv_id',${JSON.stringify(convId)});}catch(e){} window.__toasts=[]; document.addEventListener('DOMContentLoaded',function(){new MutationObserver(function(){document.querySelectorAll('[class*="toast"]').forEach(function(el){var t=(el.innerText||'').trim(); if(t&&window.__toasts.indexOf(t)===-1)window.__toasts.push(t);});}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});});` });
await send('Page.navigate', { url: APP + '/ai-chat' });
for (let i = 0; i < 80; i++) { await sleep(250); if (await evalJS('!!document.querySelector("button[title=\'导出长图到云盘\']")')) break; }
await evalJS('(function(){var b=document.querySelector("button[title=\'导出长图到云盘\']"); if(b)b.click();})()');
let hash = null;
for (let i = 0; i < 60; i++) {
  await sleep(700);
  const list = await api('GET', '/api/cloud/files?folder=' + encodeURIComponent('AI 对话导出'));
  const f = ((list.data && list.data.files) || []).find(x => /长图排版样张/.test(x.name));
  if (f) { hash = f.hash; break; }
}
if (!hash) {
  console.error('导出失败');
  console.error('  URL:', await evalJS('location.href'));
  console.error('  title:', await evalJS('(document.querySelector(".aichat-title")||{}).innerText'));
  console.error('  消息条数:', await evalJS('document.querySelectorAll(".aichat-msg").length'));
  console.error('  toasts:', JSON.stringify(await evalJS('window.__toasts||[]')));
  console.error('  errors:', JSON.stringify(errs.slice(0, 6)));
  const l = await api('GET', '/api/cloud/files?folder=' + encodeURIComponent('AI 对话导出'));
  console.error('  该分组文件:', JSON.stringify(l.data.files.map(f => f.name)));
  chrome.kill(); process.exit(1);
}
const img = await fetch(APP + '/api/cloud/files/' + hash, { headers: { Authorization: 'Bearer ' + TOKEN } });
const buf = Buffer.from(await img.arrayBuffer());
const out = REPO + '/logs/longimage-sample.png';
writeFileSync(out, buf);
console.log('样张已保存:', out, buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), Math.round(buf.length / 1024) + 'KB');
await api('DELETE', '/api/cloud/files/' + hash);
await api('DELETE', '/api/ai-chat/conversations/' + convId);
if (!wasOn) await api('PUT', '/api/ai-chat/admin/models/' + target.id, { supports_vision: false });
chrome.kill();
process.exit(0);
