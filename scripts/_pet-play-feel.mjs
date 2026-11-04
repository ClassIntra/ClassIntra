// 桌宠 v0.15.0 真实端到端：性格徽章 / 头顶气泡 / 互动飘字。
//
// 用法：node scripts/_pet-play-feel.mjs [user_id]
// 前置：CI 在 127.0.0.1:9001 运行；server/.env 有 JWT_SECRET。
//
// 为什么要单独一层：接口探针能证明「服务端返回了 personality / mood / crit」，
// 但证明不了「页面把它们画出来了」。这三样恰恰是「玩法好不好玩」的全部可见部分 ——
// 后端算得再对，屏幕上没有那一行飘字，玩家感受到的仍然是「点了一下，数字变了」。
//
// 断言：
//   1. 名字下方有性格徽章，且文案属于服务端的 5 种性格
//   2. 头顶气泡有文字（心情或性格台词）
//   3. 点「摸摸」后出现飘字，格式为「+N」或「大成功 +N」
//   4. 飘字在 1.6 秒内自行消失（不残留、不叠成一片）
//   5. 全程无未捕获异常
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9342;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' },
  SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' → ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

const apiRes = await fetch(BASE + '/api/pet/state', { headers: { Authorization: 'Bearer ' + token } });
const apiJson = await apiRes.json();
const apiPersona = apiJson.data && apiJson.data.personality;
const apiMood = apiJson.data && apiJson.data.mood;
const apiState = (apiJson.data && apiJson.data.state) || {};

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-pet-feel-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', `--window-size=${VW},${VH}`,
  '--disable-lcd-text', '--font-render-hinting=none',
  'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); chrome.kill(); process.exit(1); }

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
const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch (e) {}
    window.__e2eErrors = [];
    window.addEventListener('error', function(e){ window.__e2eErrors.push(String(e.message||e)); });
    window.addEventListener('unhandledrejection', function(e){ window.__e2eErrors.push('rejection: ' + String(e.reason)); });
    // 记录每一次飘字的出现与消失时刻，用来断言「它真的会自己消失」。
    // 用 MutationObserver 而不是轮询：飘字只活 1.5 秒，轮询很容易整段错过。
    window.__floats = [];
    document.addEventListener('DOMContentLoaded', function(){
      var mo = new MutationObserver(function(muts){
        muts.forEach(function(m){
          Array.prototype.forEach.call(m.addedNodes, function(n){
            if (n.classList && n.classList.contains('ci-pet-float')) {
              window.__floats.push({ t: Date.now(), text: n.textContent,
                                     crit: n.classList.contains('is-crit'), gone: false });
            }
          });
          Array.prototype.forEach.call(m.removedNodes, function(n){
            if (n.classList && n.classList.contains('ci-pet-float')) {
              for (var i = window.__floats.length - 1; i >= 0; i--) {
                if (window.__floats[i].text === n.textContent && !window.__floats[i].gone) {
                  window.__floats[i].gone = true; window.__floats[i].goneAt = Date.now(); break;
                }
              }
            }
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
  `
});

console.log('打开', BASE + '/pet ...');
await send('Page.navigate', { url: BASE + '/pet' });

let mounted = false;
for (let i = 0; i < 120; i++) {
  await sleep(300);
  mounted = await evalJS(`!!document.querySelector('.ci-pethome')`);
  if (mounted) break;
}
ok('/pet 页面挂载成功', mounted, mounted ? '' : '30s 内未见 .ci-pethome');

if (mounted) {
  // 等 /pet/state 落位（性格徽章是异步来的，先等徽章出现）
  for (let i = 0; i < 40; i++) {
    if (await evalJS(`!!document.querySelector('.ci-pet-badge--persona')`)) break;
    await sleep(300);
  }

  // ---- 1. 性格徽章 ----
  const badge = await evalJS(`(function(){
    var el = document.querySelector('.ci-pet-badge--persona');
    return el ? el.textContent : null;
  })()`);
  ok('性格徽章渲染出来了', !!badge, badge || '缺失');
  if (badge && apiPersona) {
    ok('徽章文案与接口一致', badge.indexOf(apiPersona.name) >= 0,
      '页面「' + badge + '」 / 接口「' + apiPersona.name + '」');
  }

  // ---- 2. 头顶气泡 ----
  const thought = await evalJS(`(function(){
    var el = document.querySelector('.ci-pet-thought .ci-pet-hero-mood');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { text: el.textContent, w: Math.round(r.width), h: Math.round(r.height),
             vis: r.width > 0 && r.height > 0 };
  })()`);
  ok('头顶气泡有文字且可见', !!(thought && thought.text && thought.vis),
    thought ? ('「' + thought.text.slice(0, 24) + '」 ' + thought.w + '×' + thought.h) : '缺失');
  if (thought && apiMood) {
    // 气泡第一句应该就是心情语：心情是「现在」，回答的正是「它此刻怎么样」
    ok('气泡首句 = 服务端心情语', thought.text.indexOf(apiMood.text.slice(0, 8)) >= 0,
      '气泡「' + thought.text.slice(0, 20) + '」');
  }

  // ---- 3. 点摸摸，抓飘字 ----
  const canPoke = await evalJS(`(function(){
    var btns = document.querySelectorAll('.ci-pet-actions .ci-pet-bigbtn');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].querySelector('.ci-pet-bigbtn-label') || {}).textContent === '摸摸') {
        return { found: true, disabled: !!btns[i].disabled,
                 sub: ((btns[i].querySelector('.ci-pet-bigbtn-sub') || {}).textContent || '') };
      }
    }
    return { found: false };
  })()`);
  ok('找得到「摸摸」按钮', canPoke && canPoke.found, canPoke ? ('副标题「' + canPoke.sub + '」') : '');

  if (canPoke && canPoke.found) {
    await evalJS(`(function(){
      var btns = document.querySelectorAll('.ci-pet-actions .ci-pet-bigbtn');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].querySelector('.ci-pet-bigbtn-label') || {}).textContent === '摸摸') { btns[i].click(); return true; }
      }
      return false;
    })()`);
    // 等飘字出现：请求走 500ms 兜底 → 响应 → renderHome → flashGain
    let floats = [];
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      floats = await evalJS(`window.__floats || []`);
      if (floats && floats.length) break;
    }
    if (floats && floats.length) {
      const f = floats[floats.length - 1];
      ok('点摸摸后出现飘字', true, '「' + f.text + '」' + (f.crit ? '（大成功）' : ''));
      ok('飘字格式正确', /^(大成功 \+)?\d+$/.test(String(f.text).replace(/^\+/, '')),
        '「' + f.text + '」');
      // 等它自己消失
      let gone = false;
      for (let i = 0; i < 15; i++) {
        await sleep(200);
        const arr = await evalJS(`window.__floats || []`);
        const last = arr && arr[arr.length - 1];
        if (last && last.gone) { gone = true; break; }
      }
      ok('飘字会自己消失（不残留）', gone);
    } else {
      // 到上限 / 冷却中时本来就不会有收益，也不该有飘字 —— 这不算失败，
      // 但要检查页面给了提示（否则就是「点了没反应」）。
      const toast = await evalJS(`(function(){
        var t = document.querySelector('.ci-pet-toast');
        return t ? t.textContent : '';
      })()`);
      ok('无飘字时至少有提示（上限/冷却）', !!toast, '提示：' + (toast || '（无）'));
    }
  }

  // ---- 5. 无异常 ----
  const errs = await evalJS(`window.__e2eErrors || []`);
  ok('全程无未捕获异常', !errs.length, errs.length ? errs.slice(0, 3).join(' | ') : '');

  // 留一张图
  await sleep(600);
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = join(tmpdir(), 'ci-pet-ui', 'play-feel.png');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(tmpdir(), 'ci-pet-ui'), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('  📷 ' + out);
  } catch (e) {}
}

console.log('\n===== 结果 =====');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail === 0) console.log('  🎉 全绿');
ws.close();
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
