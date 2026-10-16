// 真机浏览器冒烟：多任务并发（两个会话同时生成，互不打断）
//
// 为什么必须有这一层：并发重构动了 doSendMessage / finishStream / stopGeneration 的骨架，
// 路由级测试根本测不到「切会话时 rAF 句柄、abortController、镜像字段是否串台」。
// 用本地 mock 上游（不烧真钱），让两个会话各生成 1.5 秒，中途切过去发第二条。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9351;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MOCK_PORT = 19240;
const MODEL_ID = 'probe-stream';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const Database = require(REPO + '/server/node_modules/better-sqlite3');
const db = new Database(REPO + '/server/database/classintra.db', { readonly: true });
const adminRow = db.prepare('SELECT user_id FROM users WHERE is_admin = 1 LIMIT 1').get();
const USER = adminRow.user_id;
db.close();
const TOKEN = jwt.sign({ user_id: USER, is_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const api = async (m, u, b) => {
  const r = await fetch(APP + u, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t.slice(0, 100) }; }
};

let PASS = 0, FAIL = 0;
const check = (n, c, e) => { if (c) { PASS++; console.log('  ✓ ' + n); } else { FAIL++; console.log('  ✗ ' + n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); } };

// ---------- mock 上游：按 conversation_id 回不同的内容，1.5s 流完 ----------
const replies = {};   // convId → 已流出的字符数（用于断言）
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    // 上游请求体里没有 conversation_id（那是本站内部概念），用最后一条用户消息区分是哪个会话
    let tag = 'unknown';
    try {
      const j = JSON.parse(body);
      const last = (j.messages || []).filter(m => m.role === 'user').pop();
      const q = (last && (typeof last.content === 'string' ? last.content : '')) || '';
      if (q.indexOf('A的问题') >= 0) tag = 'convA';
      else if (q.indexOf('B的问题') >= 0) tag = 'convB';
    } catch (e) {}
    if (process.env.MOCK_DEBUG) console.log('  [mock] tag =', tag);
    const text = '回复-' + tag + '-结束';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let i = 0;
    const timer = setInterval(() => {
      if (i >= text.length) {
        clearInterval(timer);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text[i] } }] }) + '\n\n');
      i++;
    }, 260);
  });
});

console.log('\n[0] 准备数据（mock 上游 + 临时模型 + 两个会话）');
await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
let r = await api('POST', '/api/ai-chat/admin/models', {
  id: MODEL_ID, label: '并发探针', api_url: 'http://127.0.0.1:' + MOCK_PORT + '/v1',
  api_key: 'sk-mock', model: 'mock-model', color: '#6366f1', api_style: 'openai',
  is_free: true, enabled: true, sort_order: 1
});
check('建临时模型', r.status === 200, r.data);
r = await api('PUT', '/api/ai-chat/settings', { model: MODEL_ID });
check('切到临时模型', r.status === 200, r.data);
const prevSettings = r.data.data || {};
r = await api('POST', '/api/ai-chat/conversations', { title: '并发A' });
const convA = r.data.data.id;
r = await api('POST', '/api/ai-chat/conversations', { title: '并发B' });
const convB = r.data.data.id;
check('建两个会话', !!convA && !!convB, { convA, convB });

// ---------- 浏览器 ----------
const profile = join(tmpdir(), 'ci-aichat-par-' + Date.now());
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 60; i++) { try { page = (await getJSON('/json/list')).find(t => t.type === 'page'); if (page) break; } catch (e) {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
const consoleErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('ERR ' + m.params.args.map(a => a.value || a.description || '').join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('LOG ' + m.params.entry.text);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('ai_last_conv_id', ${JSON.stringify(convA)});
    document.cookie = 'token=' + ${JSON.stringify(TOKEN)} + '; path=/';
  }catch(e){}`
});

// 直接拿组件实例驱动（headless 下点侧栏/输入事件时机太脆），但走的仍是真实代码路径：
// selectConversation / sendMessage / streamStates / isStreaming 都是产品里的同一份实现。
console.log('\n[1] 打开 AI 对话');
await send('Page.navigate', { url: APP + '/ai-chat' });
let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  ready = await evalJS('(function(){function f(c){if(!c)return null;if(c.streamStates)return c;var ch=c.$children||[];for(var i=0;i<ch.length;i++){var r=f(ch[i]);if(r)return r;}return null;}var c=f(document.querySelector("#app") && document.querySelector("#app").__vue__);if(c){window.__aic=c;return true;}return false;})()');
  if (ready) break;
}
check('页面就绪且找到组件', ready === true);

const streamingIds = () => evalJS('Object.keys(window.__aic.streamStates)');

let comp = null;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  comp = await evalJS('(window.__aic && window.__aic.conversations.length > 0) ? { convId: window.__aic.currentConvId, convs: window.__aic.conversations.length } : null');
  if (comp) break;
}
check('找到 AIChat 组件且会话列表已加载', !!comp && !!comp.convId && comp.convs > 0, comp);
check('初始会话是 A', comp && comp.convId === convA, comp);

console.log('\n[2] 会话 A 开始生成，随即切到 B 再发一条');
await evalJS('window.__aic.inputText = "A的问题"; window.__aic.sendMessage()');
let aStarted = false;
for (let i = 0; i < 40; i++) { await sleep(200); if ((await streamingIds()).indexOf(convA) >= 0) { aStarted = true; break; } }
check('A 进入生成中（streamStates 里有 A）', aStarted === true, await streamingIds());
check('此刻 isStreaming = true（当前就是 A）', (await evalJS('window.__aic.isStreaming')) === true);

// 切到 B：绝不能打断 A（这是多任务的核心断言）
await evalJS('window.__aic.selectConversation(' + JSON.stringify(convB) + ')');
await sleep(700);
check('已切到 B', (await evalJS('window.__aic.currentConvId')) === convB);
check('切走后 isStreaming = false（B 自己没在生成）', (await evalJS('window.__aic.isStreaming')) === false);
check('A 仍在后台生成（没被打断）', (await streamingIds()).indexOf(convA) >= 0, await streamingIds());
const bgChip = await evalJS('document.querySelectorAll(".bg-stream-chip").length');
check('头部出现「后台生成」标记', bgChip === 1, bgChip);
const aBadge = await evalJS('(function(){var b=false;document.querySelectorAll(".conv-streaming").forEach(function(){b=true});return b})()');
check('侧栏 A 有转圈标记', aBadge === true);

await evalJS('window.__aic.inputText = "B的问题"; window.__aic.sendMessage()');
let bStarted = false;
for (let i = 0; i < 40; i++) { await sleep(200); if ((await streamingIds()).indexOf(convB) >= 0) { bStarted = true; break; } }
check('B 也进入生成中', bStarted === true, await streamingIds());
check('两个会话同时在生成', (await streamingIds()).length === 2, await streamingIds());

console.log('\n[3] 等两条流都跑完，验证内容没有串台');
let bothDone = false;
for (let i = 0; i < 80; i++) { await sleep(500); if ((await streamingIds()).length === 0) { bothDone = true; break; } }
check('两条流都自然结束', bothDone === true, await streamingIds());
const msgs = await evalJS(`(function(){
  function pick(id){
    var c = window.__aic.conversations.filter(function(x){return x.id===id})[0];
    if(!c) return null;
    var ai = c.messages.filter(function(m){return m.role==='assistant'});
    return ai.length ? ai[ai.length-1].content : '';
  }
  return { a: pick(${JSON.stringify(convA)}), b: pick(${JSON.stringify(convB)}) };
})()`);
check('A 的回复完整且是 A 自己的（切走也没被打断）', msgs && msgs.a === '回复-convA-结束', msgs && msgs.a);
check('B 的回复完整且是 B 自己的（无串台）', msgs && msgs.b === '回复-convB-结束', msgs && msgs.b);

console.log('\n[4] 控制台无报错');
check('无 JS 异常/错误日志', consoleErrors.length === 0, consoleErrors.slice(0, 4));

console.log('\n[5] 清理');
await api('DELETE', '/api/ai-chat/conversations/' + convA);
await api('DELETE', '/api/ai-chat/conversations/' + convB);
await api('DELETE', '/api/ai-chat/admin/models/' + MODEL_ID);
await api('PUT', '/api/ai-chat/settings', { model: prevSettings.model || '' });
const models = await api('GET', '/api/ai-chat/admin/models');
check('临时模型已删', !models.data.data.models.some(m => m.id === MODEL_ID));
chrome.kill();
mock.close();

console.log('\n============================');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
console.log('============================');
process.exit(FAIL === 0 ? 0 : 1);
