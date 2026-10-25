// 验证：资源仓库地址栏单行不再错位 + md 正常渲染 + txt 正常显示
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-resource-fix');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251801' }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9395',
  `--user-data-dir=${join(tmpdir(), 'ci-resource-fix-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9395${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (n) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, n), Buffer.from(s.data, 'base64'));
};
const waitFor = async (expr, timeout) => {
  for (let t = 0; t < timeout; t += 500) {
    if (await ev(`!!(${expr})`)) return true;
    await sleep(500);
  }
  return false;
};
const clickFile = async (name) => ev(`(function(){ var items=document.querySelectorAll('.file-item'); for(var i=0;i<items.length;i++){ var n=items[i].querySelector('.file-name'); if(n && n.textContent.trim()==='${name}'){ items[i].click(); return true; } } return false; })()`);
const closePreview = async () => {
  await ev(`(function(){ var b=document.querySelector('.preview-actions .fa-xmark'); if(b){ b.parentNode.click(); return true; } return false; })()`);
  await sleep(600);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(TOKEN)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: '251801', net_name: 'probe', is_admin: 0, role: 'officer' }))});
  }catch(e){}`
});

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };

await send('Page.navigate', { url: APP + '/resource' });
check('0 页面就绪', await waitFor(`document.querySelector('.file-grid')`, 25000));
await sleep(1200);

// ---- 1. 地址栏：分隔符与文字横向单行（不再竖叠） ----
const crumb = await ev(`(function(){
  var bar = document.querySelector('.breadcrumb-bar');
  if (!bar) return null;
  var g = bar.querySelector('.breadcrumb-group');
  var sep = bar.querySelector('.breadcrumb-sep');
  var c = bar.querySelector('.breadcrumb-crumb.active') || bar.querySelector('.breadcrumb-crumb');
  if (!g || !sep || !c) return { groups: 0 };
  var sr = sep.getBoundingClientRect(), cr = c.getBoundingClientRect();
  var sepMid = sr.top + sr.height / 2, crumbMid = cr.top + cr.height / 2;
  return {
    barH: Math.round(bar.getBoundingClientRect().height),
    midDelta: Math.round(Math.abs(sepMid - crumbMid)),
    sameRow: Math.abs(sepMid - crumbMid) < 6,
    sepLeftOfCrumb: sr.right <= cr.left + 2
  };
})()`);
check('1a 分隔符与文字同一行', !!crumb && crumb.sameRow === true, JSON.stringify(crumb));
check('1b 分隔符在文字左侧', !!crumb && crumb.sepLeftOfCrumb === true);
check('1c 地址栏高度收敛(≤64px)', !!crumb && crumb.barH <= 64, 'barH=' + (crumb && crumb.barH));

// 进深层目录再验证一次 + 自动滚动
await clickFile('temporary');
await sleep(2000);
const deep = await ev(`(function(){
  var bar = document.querySelector('.breadcrumb-bar');
  var g = bar.querySelector('.breadcrumb-group:last-child');
  var sep = g.querySelector('.breadcrumb-sep'), c = g.querySelector('.breadcrumb-crumb');
  var sr = sep.getBoundingClientRect(), cr = c.getBoundingClientRect();
  var sepMid = sr.top + sr.height / 2, crumbMid = cr.top + cr.height / 2;
  return {
    crumbs: bar.querySelectorAll('.breadcrumb-group').length,
    sameRow: Math.abs(sepMid - crumbMid) < 6,
    lastVisible: cr.right <= window.innerWidth + 2,
    barH: Math.round(bar.getBoundingClientRect().height)
  };
})()`);
check('1d 深层地址栏仍单行', !!deep && deep.sameRow === true, JSON.stringify(deep));
check('1e 当前层可见(自动滚到位)', !!deep && deep.lastVisible === true);
await shot('1-breadcrumb-deep.png');
await clickFile('..返回上级') || await ev(`(function(){ var b=document.querySelector('.breadcrumb-crumb'); if(b) b.click(); return true; })()`);
await sleep(1500);

// ---- 2. md 渲染 ----
check('2a 打开 README.md', await clickFile('README.md'));
check('2b markdown 容器出现', await waitFor(`document.querySelector('.preview-markdown')`, 12000));
const md = await ev(`(function(){
  var el = document.querySelector('.preview-markdown');
  if (!el) return null;
  return {
    htmlLen: el.innerHTML.length,
    hasH1: !!el.querySelector('h1') || !!el.querySelector('h2'),
    hasCode: !!el.querySelector('pre') || !!el.querySelector('code'),
    hasList: !!el.querySelector('ul') || !!el.querySelector('ol') || !!el.querySelector('table'),
    textLen: el.textContent.replace(/\\s+/g, '').length
  };
})()`);
check('2c md 有结构化渲染(标题/代码/列表)', !!md && md.htmlLen > 500 && (md.hasH1 || md.hasList), JSON.stringify(md));
await shot('2-markdown-preview.png');
await closePreview();

// ---- 3. txt 显示 ----
check('3a 打开 a3.txt', await clickFile('a3.txt'));
check('3b 文本容器出现', await waitFor(`document.querySelector('.preview-text')`, 12000));
const txt = await ev(`(function(){
  var el = document.querySelector('.preview-text pre');
  if (!el) return null;
  return { text: el.textContent.trim(), visible: el.getBoundingClientRect().height > 0 };
})()`);
check('3c 文本内容显示', !!txt && txt.text.length > 0 && txt.visible === true, txt ? ('len=' + txt.text.length + ' head=' + txt.text.slice(0, 20)) : 'null');
await shot('3-text-preview.png');
await closePreview();

// ---- 4. KaTeX 数学公式渲染 ----
const KATEX_MD = [
  '# KaTeX 渲染测试',
  '',
  '质能方程 $E = mc^2$ 与欧拉公式 $e^{i\\pi} + 1 = 0$。',
  '',
  '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
  '',
  '转义形式：\\(\\alpha + \\beta = \\gamma\\)',
  '',
  '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
  ''
].join('\n');
const katexPath = REPO.replace(/\//g, '\\') + '\\Resources\\katex-test.md';
writeFileSync(katexPath, KATEX_MD, 'utf8');
await clickFile('..刷新') || await ev(`(function(){ var b=document.querySelector('.breadcrumb-crumb'); if(b) b.click(); return true; })()`);
await waitFor(`document.querySelector('.file-grid')`, 15000);
await sleep(1500);
check('4a 打开 katex-test.md', await clickFile('katex-test.md'));
check('4b markdown 容器出现', await waitFor(`document.querySelector('.preview-markdown')`, 12000));
const k = await ev(`(function(){
  var el = document.querySelector('.preview-markdown');
  if (!el) return null;
  return {
    katexTotal: el.querySelectorAll('.katex').length,
    displayWrappers: el.querySelectorAll('.katex-display-wrapper').length,
    errors: el.querySelectorAll('.latex-error').length,
    rawDoubleDollar: (el.textContent.match(/\\$\\$/g) || []).length
  };
})()`);
check('4c KaTeX 公式已渲染(≥4个，含矩阵)', !!k && k.katexTotal >= 4 && k.displayWrappers >= 2, JSON.stringify(k));
check('4d 无渲染错误、无残留定界符', !!k && k.errors === 0 && k.rawDoubleDollar === 0);
await shot('4-katex-preview.png');
await closePreview();
unlinkSync(katexPath);
console.log('cleanup: katex-test.md 已删除');

await chrome.kill();
console.log(fail === 0 ? '\n=== ALL PASS ===' : '\n=== ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
