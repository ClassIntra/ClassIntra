// 大字「多行轮播」推进验证（真实 Chromium + CDP）
//
// 为什么单独一个脚本，而不是并进 probe-bigtext-ui.mjs：
//   轮播推进依赖 setInterval 的真实节奏，而 headless 长时运行会节流定时器
//   （页面被判定为隐藏 → 降到分钟级）。UI 探针跑到轮播那一节时页面已运行数分钟，
//   在那里断言「2 秒内必须切一次」必然出现与环境相关的假失败。
//   本脚本用新鲜页面、单一场景，只验这一件事，结果稳定可复现。
//
// 覆盖：
//   1. 轮播索引按 switch_interval 依次推进（0 → 1 → 2 → 0 循环）
//   2. 「轻触关闭后再发一条」的复用场景下轮播照常推进（防止组件复用把定时器弄丢）
//   3. restart 没有被反复触发（否则 lineIndex 会被不断打回 0，表现为"卡住"）
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
const CDP_PORT = 9348;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-carousel-probe')}`, '--no-first-run',
  '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null;
for (let i = 0; i < 40; i++) { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ window.__WS_PORT__='10099'; localStorage.setItem('token', ${JSON.stringify(studentTok)}); localStorage.setItem('user', JSON.stringify({user_id:'${STUDENT}'})); }catch(e){}`
});
await send('Page.navigate', { url: APP + '/' });
for (let i = 0; i < 80; i++) { await sleep(300); if (await evalJS("!!document.querySelector('#app > *')")) break; }
await evalJS("(function(){ try{ document.documentElement.removeAttribute('data-no-motion'); }catch(e){} })()");

async function api(method, path, token, body) {
  const res = await fetch(APP + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const waitOverlay = async (want, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalJS("!!document.querySelector('.big-text-overlay')") === want) return true;
    await sleep(200);
  }
  return false;
};

// 找到舞台实例并给 restart / lineIndex 装计数器
const hookStage = () => evalJS(`(function(){
  var stage = null;
  (function find(vm){
    if(!vm) return;
    if(vm.$options && vm.$options.name === 'BigTextStage'){ stage = vm; return; }
    var ch = vm.$children || [];
    for (var i=0;i<ch.length;i++){ find(ch[i]); if(stage) return; }
  })(document.querySelector('#app').__vue__);
  if(!stage) return 'no-stage';
  window.__st = stage;
  stage.__rc = 0;
  var oR = stage.restart;
  stage.restart = function(){ stage.__rc++; return oR.apply(this, arguments); };
  return 'hooked';
})()`);
const readStage = () => evalJS(`(function(){
  var st = window.__st; if(!st) return null;
  return { idx: st.lineIndex, rc: st.__rc, timer: !!st.carouselTimer,
           lines: (st.lines||[]).length, si: st.c.switch_interval,
           dom: ((document.querySelector('.big-text-line')||{}).textContent || '').trim() };
})()`);

(async () => {
  console.log('\n=== 1. 先发一条静态大字并轻触关掉（复现「覆盖层复用」场景） ===');
  await api('POST', '/api/admin/big-text', adminTok, {
    content: '前一条静态大字', duration: 30, lock_seconds: 0, target_type: 'users', target_ids: [STUDENT]
  });
  ok(await waitOverlay(true, 20000), '静态大字已弹出');
  await evalJS(`(function(){ var el=document.querySelector('.big-text-overlay'); if(el) el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return !!el; })()`);
  ok(await waitOverlay(false, 5000), 'lock=0 时轻触已关闭');
  await sleep(1000);

  console.log('\n=== 2. 再发轮播大字，观察推进 ===');
  await api('POST', '/api/admin/big-text', adminTok, {
    content: '轮播第一条\n轮播第二条\n轮播第三条',
    duration: 40, display_mode: 'carousel', switch_interval: 2,
    target_type: 'users', target_ids: [STUDENT]
  });
  ok(await waitOverlay(true, 20000), '轮播大字已弹出');
  await sleep(400);
  ok(await hookStage() === 'hooked', '已挂载舞台探针');

  const seq = [];
  for (let k = 0; k < 14; k++) {
    const s = await readStage();
    if (s) seq.push(s.idx);
    await sleep(600);
  }
  const uniq = [];
  for (const v of seq) if (uniq[uniq.length - 1] !== v) uniq.push(v);
  console.log('  索引序列:', JSON.stringify(uniq));

  ok(seq.length > 0 && seq[0] === 0, '起始在第一条', seq[0]);
  ok(uniq.indexOf(1) !== -1, '按间隔推进到第二条');
  ok(uniq.indexOf(2) !== -1, '继续推进到第三条');
  ok(uniq.indexOf(0) !== -1 && uniq.indexOf(0) !== uniq.length - 1, '循环回到第一条（无缝轮播）', uniq);

  const last = await readStage();
  ok(last && last.rc === 0, 'restart 未被反复触发（lineIndex 不会被打回 0）', last && last.rc);
  ok(last && last.timer === true, '轮播定时器仍在运行', last && last.timer);
  ok(last && last.lines === 3 && last.si === 2, '轮播配置正确下发（3 条 / 2 秒）', last);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  await chrome.kill();
  process.exit(fail ? 1 : 0);
})();
