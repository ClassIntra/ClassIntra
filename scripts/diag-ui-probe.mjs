// 最小诊断：加载隔离实例首页，打印浏览器控制台错误与未捕获异常
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9342;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-diag-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('Chrome 未启动'); process.exit(1); }

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
const events = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method) {
    events.push(m);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');

// 关注资源加载失败（404/500 的 JS chunk 会解释「表单不渲染」）
const failedResources = [];
const seenRes = new Map();

await send('Page.navigate', { url: APP + '/' });
await sleep(9000);

const state = await send('Runtime.evaluate', {
  expression: `(function(){
    return {
      url: location.pathname,
      appHtml: (document.querySelector('#app')||{}).innerHTML ? document.querySelector('#app').innerHTML.slice(0, 200) : 'NO #app',
      bodyText: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 200),
      scripts: [].slice.call(document.scripts).map(function(s){ return s.src; }).filter(Boolean).length
    };
  })()`, returnByValue: true
});
console.log('页面状态:', JSON.stringify(state.result.value, null, 2));

// 等管理页：直接推路由
await send('Runtime.evaluate', {
  expression: `(function(){
    var root = document.querySelector('#app') && document.querySelector('#app').__vue__;
    if (root && root.$router) root.$router.push('/admin');
    return 'pushed';
  })()`, returnByValue: true
});
await sleep(6000);

const state2 = await send('Runtime.evaluate', {
  expression: `(function(){
    return {
      path: location.pathname,
      hasTabs: !!document.querySelector('.admin-tabs'),
      hasForm: !!document.querySelector('.admin-section .broadcast-form'),
      bodyText: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 300)
    };
  })()`, returnByValue: true
});
console.log('/admin 状态:', JSON.stringify(state2.result.value, null, 2));

console.log('\n===== 控制台/异常事件 =====');
for (const m of events) {
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
    console.log('[' + m.params.type + '] ' + String(text).slice(0, 500));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('[EXCEPTION] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error') console.log('[LOG:' + e.level + '] ' + String(e.text).slice(0, 300) + ' ' + (e.url || ''));
  } else if (m.method === 'Network.loadingFailed') {
    failedResources.push(m.params);
  } else if (m.method === 'Network.responseReceived') {
    seenRes.set(m.params.requestId, m.params.response);
  }
}
if (failedResources.length) {
  console.log('\n===== 加载失败的资源 =====');
  for (const f of failedResources) console.log(JSON.stringify(f));
}

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(0);
