// 个人主页装扮令牌接口验证（真实 Chrome + 冷缓存）
// ============================================================
// 覆盖三条链路：
//   1. 默认态：没人装扮时主页与改造前一致（--pf-* 别名回退生效）
//   2. 运行时：__profileSkin.apply → 变量写入 → 主页配色跟随 → localStorage 落盘 → 刷新恢复
//   3. 主题切换：theme-engine 的 removeFromElement 会清掉 --ci-*，
//      装扮必须自动重写，否则「换个深色，装扮就没了」
// 用法：node scripts/profile-skin-probe.mjs
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const VIEW = '251800';
const ME = '251801';
const OUT = join(tmpdir(), 'ci-profile-skin');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9405',
  `--user-data-dir=${join(tmpdir(), 'ci-skin-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const get = async (p) => (await fetch(`http://127.0.0.1:9405${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => (await send('Runtime.evaluate', {
  expression: expr, returnByValue: true, awaitPromise: true
})).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
};

// 主页上真正会被装扮影响的四个点
const READ = `(function(){
  var page = document.querySelector('.profile-page');
  var btn = document.querySelector('.profile-btn-primary');
  var tab = document.querySelector('.profile-tab.active');
  var card = document.querySelector('.profile-card');
  var stats = document.querySelector('.profile-stats');
  var cs = getComputedStyle(document.documentElement);
  function bg(el){ return el ? getComputedStyle(el).backgroundColor : null; }
  return {
    vars: {
      accent: cs.getPropertyValue('--ci-profile-accent').trim(),
      radius: cs.getPropertyValue('--ci-profile-radius').trim()
    },
    aliasAccent: cs.getPropertyValue('--pf-accent').trim(),
    btnBg: bg(btn),
    tabColor: tab ? getComputedStyle(tab).color : null,
    cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : null,
    statsBorder: stats ? getComputedStyle(stats).borderTopColor : null,
    stored: localStorage.getItem('ci:profile-skin')
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  // ⚠️ 这段脚本每次导航都会重跑；清 localStorage 必须只做一次，
  //    否则 reload 会把「刚存下的装扮」自己擦掉，看起来像 restore 失效（踩过）。
  source: `try{
  localStorage.setItem('token',${JSON.stringify(token)});
  localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});
  if(!sessionStorage.getItem('ci-skin-probe-init')){
    sessionStorage.setItem('ci-skin-probe-init','1');
    localStorage.removeItem('ci:profile-skin');
  }}catch(e){}`
});

await send('Page.navigate', { url: APP + '/profile/' + VIEW });
await sleep(7000);

console.log('0 接口可用:', await ev('typeof window.__profileSkin === "string" ? "MISS" : typeof (window.__profileSkin||{}).apply'));
const base = await ev(READ);
console.log('1 默认态:', JSON.stringify(base));
await shot('1-default.png');

console.log('2 预设列表:', await ev('JSON.stringify(window.__profileSkin.listPresets().map(function(p){return p.id}))'));
console.log('3 令牌清单:', await ev('JSON.stringify(window.__profileSkin.tokenSpec().map(function(t){return t.key}))'));

const applied = await ev('JSON.stringify(window.__profileSkin.apply("sakura"))');
console.log('4 应用 sakura:', applied);
await sleep(400);
const sakura = await ev(READ);
console.log('5 应用后:', JSON.stringify(sakura));
await shot('2-sakura.png');

// 主题切换必须保住装扮（setTheme 会先 removeFromElement 清掉全部 --ci-*）
await ev('window.__getThemeEngine().setTheme("light")');
await sleep(700);
const afterLight = await ev(READ);
await ev('window.__getThemeEngine().setTheme("dark")');
await sleep(700);
const afterTheme = await ev(READ);
console.log('6 切浅色后:', JSON.stringify({ accent: afterLight.vars.accent, btnBg: afterLight.btnBg }));
console.log('6b 再切深色:', JSON.stringify(afterTheme));
await shot('3-sakura-dark.png');

// 自定义 + 非法键
console.log('7 自定义(含非法键):', await ev(`JSON.stringify(window.__profileSkin.apply({
  accent: '#7C4DFF', radius: '20px', 'not-a-token': '1', 'card-bg': 'url(http://x/y.png)'
}))`));
await sleep(300);
const custom = await ev(READ);
console.log('8 自定义结果:', JSON.stringify({ vars: custom.vars, cardRadius: custom.cardRadius, btnBg: custom.btnBg, stored: custom.stored }));

// 试穿与还原
await ev('window.__profileSkin.preview({ accent: "#111111" })');
await sleep(250);
const previewed = await ev(READ);
await ev('window.__profileSkin.cancelPreview()');
await sleep(250);
const cancelled = await ev(READ);
console.log('9 试穿/还原:', JSON.stringify({
  previewBtnBg: previewed.btnBg,
  afterCancelBtnBg: cancelled.btnBg,
  backToCustom: cancelled.vars.accent
}));

// 刷新恢复：先回到预设再 reload，验证 restore 走的是 id 路径
await ev('window.__profileSkin.apply("mint")');
await sleep(300);
await send('Page.reload');
await sleep(7000);
const restored = await ev(READ);
console.log('10 刷新后:', JSON.stringify(restored));
await shot('4-restored-mint.png');

// 清理
const cleared = await ev('JSON.stringify({ result: window.__profileSkin.clear(), active: window.__profileSkin.getActive() })');
await sleep(300);
const afterClear = await ev(READ);
console.log('11 清空:', cleared);
console.log('12 清空后:', JSON.stringify(afterClear));

// 13/14 元素级作用域：只装饰"当前这个主页"，不动全局（社交装扮语义）
console.log('13 元素级 applyTo:', await ev(`(function(){
  var page = document.querySelector('.profile-page');
  var r = window.__profileSkin.applyTo(page, { accent: '#00A3FF', radius: '4px' });
  return JSON.stringify({ tokens: r.tokens, styleKeys: Object.keys(r.style) });
})()`));
await sleep(300);
console.log('14 元素级结果:', JSON.stringify(await ev(`(function(){
  var page = document.querySelector('.profile-page');
  var btn = document.querySelector('.profile-btn-primary');
  var card = document.querySelector('.profile-card');
  var cs = getComputedStyle(document.documentElement);
  return {
    globalAccent: cs.getPropertyValue('--ci-profile-accent').trim() || '(空)',
    pageAccent: page.style.getPropertyValue('--ci-profile-accent') || '(空)',
    btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
    cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : null
  };
})()`)));
await ev(`window.__profileSkin.applyTo(document.querySelector('.profile-page'), {})`);
await sleep(250);
console.log('15 元素级撤销:', JSON.stringify(await ev(`(function(){
  var page = document.querySelector('.profile-page');
  var btn = document.querySelector('.profile-btn-primary');
  return { pageAccent: page.style.getPropertyValue('--ci-profile-accent') || '(空)',
           btnBg: btn ? getComputedStyle(btn).backgroundColor : null };
})()`)));

await ev('window.__getThemeEngine().setTheme("light")');
ws.close();
chrome.kill();
console.log('DONE ->', OUT);
