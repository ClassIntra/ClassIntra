// 对照实验：headless Chrome 的 synthesizeScrollGesture 到底能不能滚一个普通长页面？
// 目的：把「探针测量能力不足」和「产品真有滚动 bug」区分开。
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9411',
  `--user-data-dir=${join(tmpdir(), 'ci-gesture-ctl')}`,
  '--no-first-run', '--disable-extensions',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9411${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const t = (await g('/json/list')).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#eee} .box{height:3000px;background:linear-gradient(#fff,#333)}</style>
</head><body><div class="box">长页面</div></body></html>`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: b64(HTML)
      }).catch(() => {});
    }
    orig(e);
  };
})(ws.onmessage);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*ctl*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:9001/ctl.html' });
await sleep(1200);

const run = async (label, touch) => {
  if (touch) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  }
  await ev('window.scrollTo(0,0)');
  await sleep(300);
  await send('Input.synthesizeScrollGesture', {
    x: 500, y: 520, xDistance: 0, yDistance: -340, speed: 900,
    gestureSourceType: touch ? 'touch' : 'mouse'
  }).catch((e) => console.log('  调用失败:', e.message));
  await sleep(700);
  const y = await ev('Math.round(window.scrollY)');
  console.log(label + ': scrollY=' + y + '  ' + (y > 0 ? '能滚 OK' : '滚不动 FAIL'));
};

console.log('页面 scrollHeight:', await ev('document.documentElement.scrollHeight'));
await run('鼠标手势', false);
await run('触摸手势（未开触摸仿真）', true);

// 再试：开触摸仿真 + mobile 视口
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
await sleep(300);
await run('触摸手势（mobile:true + 触摸仿真）', true);

ws.close(); chrome.kill();
