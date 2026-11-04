// 大字「禁止关闭时长」端上行为验证（真实 Chromium + CDP）
//
// 验证点：
//   1. 锁定期内点击/触摸 → 大字不消失
//   2. 锁定期结束后点击 → 大字关闭
//   3. lock=0 时立刻可关
//   4. 锁定期内提示文案显示「锁定中 · Ns 后可关闭」
//
// 目标：隔离实例 http://127.0.0.1:9099（生产库副本）
// ⚠️ 绝不指向 9001 —— 那会把测试大字弹到真实学生平板上。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9344;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const STUDENT = '251898';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const studentTok = jwt.sign({ user_id: STUDENT }, SECRET, { expiresIn: '1h' });
const adminTok = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-lock-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', `--window-size=${VW},${VH}`, 'about:blank'
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
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });

async function api(method, path, token, body) {
  const res = await fetch(APP + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{
      window.__WS_PORT__ = '10099';
      localStorage.setItem('token', ${JSON.stringify(studentTok)});
      localStorage.setItem('user', JSON.stringify({ user_id: '${STUDENT}' }));
    }catch(e){}`
  });
  await send('Page.navigate', { url: APP + '/' });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    const st = await evalJS("({ hasApp: !!document.querySelector('#app > *'), login: /login/i.test(location.pathname) })");
    if (st && st.hasApp && !st.login) { ready = true; break; }
  }
  ok(ready, '设备端已进入桌面');
  if (!ready) { console.log('后续断言无意义，结束'); await chrome.kill(); process.exit(1); }

  const overlayVisible = () => evalJS("!!document.querySelector('.big-text-overlay')");
  const hintText = () => evalJS("(function(){ var h = document.querySelector('.big-text-hint'); return h ? h.textContent.trim() : ''; })()");
  // 真实点击覆盖层中心（走 overlay 自己的 @click）
  const tapOverlay = () => evalJS(`(function(){
    var el = document.querySelector('.big-text-overlay');
    if (!el) return false;
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }));
    return true;
  })()`);

  async function waitOverlay(want, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await overlayVisible() === want) return Date.now() - t0;
      await sleep(200);
    }
    return -1;
  }

  async function sendBigText(cfg) {
    return api('POST', '/api/admin/big-text', adminTok, Object.assign({
      target_type: 'users', target_ids: [STUDENT]
    }, cfg));
  }

  // ===== 1. 锁定 8s / 时长 25s：锁定期内点不掉 =====
  console.log('\n=== 1. lock=8s：锁定期内点击无效 ===');
  await evalJS("(function(){ var e = document.querySelector('.big-text-overlay'); })()");
  let r = await sendBigText({ content: '锁定测试：这条在 8 秒内点不掉', duration: 25, lock_seconds: 8 });
  ok(r.body && r.body.code === 200, '大字下发成功', r.body && r.body.message);
  ok(await waitOverlay(true, 20000) >= 0, '大字已弹出');

  await sleep(1200);
  const hint1 = await hintText();
  ok(/锁定中/.test(hint1), '锁定期内提示显示「锁定中 · Ns 后可关闭」', hint1);

  await tapOverlay();
  await sleep(600);
  ok(await overlayVisible() === true, '锁定期内点击后大字仍在（关不掉）');

  console.log('  等待锁定解除（约 8s）...');
  await sleep(7500);
  const hint2 = await hintText();
  ok(/轻触关闭/.test(hint2), '锁定解除后提示变为「轻触关闭」', hint2);

  await tapOverlay();
  await sleep(800);
  ok(await overlayVisible() === false, '解锁后点击可关闭');

  // ===== 2. lock=0：立刻可关 =====
  console.log('\n=== 2. lock=0：允许立刻关闭 ===');
  r = await sendBigText({ content: '锁定测试：这条可以立刻关掉', duration: 20, lock_seconds: 0 });
  ok(r.body && r.body.code === 200, '大字下发成功');
  ok(await waitOverlay(true, 20000) >= 0, '大字已弹出');
  await sleep(800);
  await tapOverlay();
  await sleep(700);
  ok(await overlayVisible() === false, 'lock=0 时首次点击即可关闭');

  // ===== 3. lock=全程：锁到自动收起前都关不掉 =====
  console.log('\n=== 3. lock=全程（=duration）：多次点击均无效 ===');
  r = await sendBigText({ content: '锁定测试：全程锁死', duration: 8, lock_seconds: 8 });
  ok(r.body && r.body.code === 200, '大字下发成功');
  ok(await waitOverlay(true, 20000) >= 0, '大字已弹出');
  await sleep(800);
  await tapOverlay(); await sleep(400);
  await tapOverlay(); await sleep(400);
  ok(await overlayVisible() === true, '全程锁定下连续点击两次仍未关闭');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  await chrome.kill();
  process.exit(fail ? 1 : 0);
})();
