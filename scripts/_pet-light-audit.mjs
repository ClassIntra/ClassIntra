// 桌宠视觉改版审计：找出「还没换到深色体系」的亮底块，以及「低对比度」的文字。
//
// 为什么需要它：v0.12.0 把卡片统一改成半透明玻璃之后，最容易出的事故不是
// 「某个卡片没改」，而是「外层改了、内层小控件没改」——浅灰按钮浮在玻璃上、
// 或者深字留在暗底上。肉眼逐页翻容易漏，让浏览器自己算更快。
//
// 用法：node scripts/_pet-light-audit.mjs
// 前置：CI 在 127.0.0.1:9001 运行；server/.env 有 JWT_SECRET。
// 输出：/tmp 下四个 tab 的截图 + 控制台两份清单。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9357;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const OUT = join(tmpdir(), 'ci-pet-ui');
mkdirSync(OUT, { recursive: true });

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

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-pet-light-' + Date.now())}`,
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
  source: `try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch (e) {}`
});
await send('Page.navigate', { url: BASE + '/pet' });
await sleep(2600);

const AUDIT = `(function(){
  function parse(str){
    var m = /rgba?\\(([^)]+)\\)/.exec(str || '');
    if (!m) return null;
    var p = m[1].split(',').map(Number);
    return { l: (0.299*p[0] + 0.587*p[1] + 0.114*p[2]) / 255, a: p.length > 3 ? p[3] : 1 };
  }
  // 沿祖先链找第一个不透明背景 —— 半透明玻璃要一路透到夜空底，不能只看自己
  function bgOf(el){
    var n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 30) {
      var c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c.l;
      n = n.parentElement;
    }
    return 0.05;
  }
  var bright = [], lowc = [];
  var all = document.querySelectorAll('.ci-pethome *');
  for (var i = 0; i < all.length; i++) {
    var e = all[i], r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    var cs = getComputedStyle(e);
    var c = parse(cs.backgroundColor);
    // 1) 亮底块：不透明度够 + 亮度高 + 面积够大，才值得看一眼
    if (c && c.a > 0.5 && c.l > 0.55 && r.width * r.height > 700) {
      bright.push({ cls: String(e.className || e.tagName).slice(0, 64),
                    w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor });
    }
    // 2) 低对比文字：只看"自己直接含文本"的叶子节点，避免整段容器重复计数
    var hasText = false;
    for (var k = 0; k < e.childNodes.length; k++) {
      if (e.childNodes[k].nodeType === 3 && e.childNodes[k].nodeValue.trim()) { hasText = true; break; }
    }
    if (!hasText) continue;
    var col = parse(cs.color);
    if (!col || col.a < 0.3) continue;
    var bgL = bgOf(e);
    var diff = Math.abs(col.l - bgL);
    if (diff < 0.24) {
      lowc.push({ cls: String(e.className || e.tagName).slice(0, 48),
                  text: (e.textContent || '').slice(0, 18),
                  color: cs.color, bgL: Math.round(bgL * 100) / 100, diff: Math.round(diff * 100) / 100 });
    }
  }
  function dedupe(arr, key){
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = arr[i][key] + '|' + arr[i].bg + arr[i].color;
      if (seen[k]) continue;
      seen[k] = 1; out.push(arr[i]);
    }
    return out;
  }
  return { bright: dedupe(bright, 'cls').slice(0, 24), lowc: dedupe(lowc, 'cls').slice(0, 24),
           height: document.querySelector('.ci-pethome').scrollHeight,
           probe: (function(){
             var sels = ['.ci-pet-inbox', '.ci-pet-inbox-item', '.ci-pet-inbox-what',
                         '.ci-pet-inbox-who', '.ci-pet-inbox-hit', '.ci-pet-inbox-clear',
                         '.ci-pet-hist-title', '.ci-pet-hist-row', '.ci-pet-ach-title',
                         '.ci-pet-titles', '.ci-pet-foe-name'];
             var out = [];
             for (var i = 0; i < sels.length; i++) {
               var e = document.querySelector(sels[i]);
               if (!e) { continue; }
               var cs = getComputedStyle(e);
               out.push(sels[i] + ' | ' + cs.color + ' on ' + cs.backgroundColor + ' | ' + cs.fontSize);
             }
             return out;
           })(),
           hero: (function(){
             var el = document.querySelector('.ci-pet-hero');
             if (!el) return { exists: false };
             var r = el.getBoundingClientRect();
             var st = el.querySelector('.ci-pet-hero-stage');
             var info = el.querySelector('.ci-pet-hero-info');
             var sr = st ? st.getBoundingClientRect() : null;
             var ir = info ? info.getBoundingClientRect() : null;
             var cs = getComputedStyle(el);
             var scs = st ? getComputedStyle(st) : null;
             return { exists: true, w: Math.round(r.width), h: Math.round(r.height),
                      disp: cs.display, ovf: cs.overflow, minH: cs.minHeight,
                      stage: sr ? { w: Math.round(sr.width), h: Math.round(sr.height),
                                    pos: scs.position, disp: scs.display, hCss: scs.height } : null,
                      info: ir ? { w: Math.round(ir.width), h: Math.round(ir.height) } : null,
                      kids: el.children.length };
           })() };
})()`;

const TABS = ['home', 'battle', 'dex', 'rank'];
const result = {};
for (const t of TABS) {
  await evalJS(`(function(){
    var b = document.querySelector('.ci-pet-tab[data-tab="${t}"]');
    if (b) b.click();
    var h = document.querySelector('.ci-pethome');
    if (h) h.scrollTop = 0;
  })()`);
  await sleep(t === 'home' ? 500 : 1100);
  const a = await evalJS(AUDIT);
  result[t] = a;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `audit-${t}.png`), Buffer.from(shot.data, 'base64'));
  // 整页长图：.ci-pethome 自己是 overflow-y:auto 的滚动容器（视口只有 787 高），
  // 直接 captureBeyondViewport 只会拍到容器外那片空白（实测截出来下面全黑）。
  // 真正可靠的做法是把「视口高度」临时调到内容高度 —— 容器 height:100% 跟着变高，
  // 内容一次性全部布局出来，一次截图就够。宽度不变，响应式断点不会被触发。
  try {
    const bigH = Math.min(Math.ceil(a.height) + 190, 4800);
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: bigH, deviceScaleFactor: 1, mobile: false
    });
    await sleep(420);
    const full = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `audit-${t}-full.png`), Buffer.from(full.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: 1, mobile: false
    });
    await sleep(320);
  } catch (e) { console.log('  (长图截图失败: ' + e.message + ')'); }
}

console.log('==========================================');
for (const t of TABS) {
  const a = result[t];
  console.log(`\n【${t}】内容高 ${a.height}px`);
  console.log('  hero: ' + JSON.stringify(a.hero));
  if (a.probe && a.probe.length) {
    console.log('  取色探针:');
    for (const l of a.probe) console.log('     ' + l);
  }
  if (a.bright.length) {
    console.log('  ⚠️ 仍是亮底（亮度>0.55 且不透明）：');
    for (const b of a.bright) console.log(`     ${b.w}×${b.h}  ${b.bg}  ${b.cls}`);
  } else console.log('  ✅ 无亮底块');

  if (a.lowc.length) {
    console.log('  ⚠️ 低对比文字（|文字亮度-底亮度| < 0.24）：');
    for (const l of a.lowc) console.log(`     ${l.diff}  ${l.color} on ${l.bgL}  「${l.text}」  ${l.cls}`);
  } else console.log('  ✅ 无低对比文字');
}
console.log('\n截图: ' + OUT + '/audit-*.png');

ws.close();
chrome.kill();
await sleep(300);
process.exit(0);
