// 真机浏览器冒烟：AI 对话「云盘选图 + 长图导出」端到端
//
// 为什么要真浏览器：长图导出是纯 Canvas 2D 手写的排版代码，单元测试测不到
// 「到底画没画出来、toBlob 有没有抛、上传有没有成功」。这里的判据是
// 「操作完之后云盘里真的多了一张 PNG」，而不是「函数没报错」。
//
// 用法：node scripts/_smoke-aichat-vision.mjs [admin_user_id]
// 前置：CI 已在 127.0.0.1:9001 运行；数据库里有 is_admin=1 的用户。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9341;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const Database = require(REPO + '/server/node_modules/better-sqlite3');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 读不到 JWT_SECRET'); process.exit(1); }

const db = new Database(REPO + '/server/database/classintra.db', { readonly: true });
const adminRow = process.argv[2]
  ? db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(process.argv[2])
  : db.prepare('SELECT user_id FROM users WHERE is_admin = 1 LIMIT 1').get();
if (!adminRow) { console.error('✗ 没找到管理员用户'); process.exit(1); }
const USER = adminRow.user_id;
const TOKEN = jwt.sign({ user_id: USER, is_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
db.close();
console.log(`管理员 ${USER}，token 已签发`);

const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const api = async (method, url, body) => {
  const r = await fetch(APP + url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t.slice(0, 160) }; }
};

let PASS = 0, FAIL = 0;
const check = (n, c, e) => { if (c) { PASS++; console.log('  ✓ ' + n); } else { FAIL++; console.log('  ✗ ' + n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); } };

// ---------- 准备数据 ----------
console.log('\n[0] 准备数据');
let r = await api('GET', '/api/ai-chat/admin/models');
const models = r.data.data.models;
const target = models.find(m => m.is_default) || models[0];
console.log('  目标模型:', target.id, target.label, '当前 supports_vision =', target.supports_vision);
const visionWasOn = !!target.supports_vision;
if (!visionWasOn) {
  r = await api('PUT', '/api/ai-chat/admin/models/' + target.id, { supports_vision: true });
  check('临时开启模型视觉能力', r.status === 200, r.data);
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), '_smoke_pick.png');
fd.append('folder', '');
const up = await fetch(APP + '/api/cloud/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
const upData = await up.json();
const pickHash = upData.data && upData.data.hash;
check('云盘里放一张测试图', !!pickHash, upData);

r = await api('POST', '/api/ai-chat/conversations', { title: '长图导出冒烟' });
const convId = r.data.data && r.data.data.id;
check('建冒烟会话', !!convId, r.data);
const seeded = [
  { role: 'user', content: '用 Python 写一个快速排序，并解释复杂度。' },
  { role: 'assistant', content: '## 快速排序\n\n思路是**分治**：选一个基准，把小的一边、大的另一边。\n\n```python\ndef qsort(a):\n    if len(a) <= 1:\n        return a\n    p = a[len(a) // 2]\n    return qsort([x for x in a if x < p]) + [x for x in a if x == p] + qsort([x for x in a if x > p])\n```\n\n| 场景 | 复杂度 |\n| --- | --- |\n| 平均 | O(n log n) |\n| 最坏 | O(n²) |\n\n- 最坏出现在每次基准都是极值\n- 随机化基准可以规避' }
];
r = await api('PUT', '/api/ai-chat/conversations/' + convId + '/messages', { messages: seeded });
check('灌入 2 条消息', r.status === 200, r.data);

// ---------- 浏览器 ----------
const profile = join(tmpdir(), 'ci-aichat-smoke-' + Date.now());
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 60; i++) {
  try { const list = await getJSON('/json/list'); page = list.find(t => t.type === 'page'); if (page) break; } catch (e) {}
  await sleep(400);
}
if (!page) { console.error('✗ Chrome 未启动'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
const consoleErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    consoleErrors.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push('LOG: ' + m.params.entry.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('CONSOLE: ' + m.params.args.map(a => a.value || a.description || '').join(' '));
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try {
      localStorage.setItem('token', ${JSON.stringify(TOKEN)});
      localStorage.setItem('ai_last_conv_id', ${JSON.stringify(convId)});
      // 必须同时写 cookie：页面里的 <img src="/api/cloud/files/..."> 不会带 Authorization 头，
      // 后端 extractToken 靠 cookie 兜底。只写 localStorage 会让所有缩略图 401。
      document.cookie = 'token=' + ${JSON.stringify(TOKEN)} + '; path=/';
    } catch (e) {}
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', function () {
      var mo = new MutationObserver(function () {
        document.querySelectorAll('.toast, [class*="toast"]').forEach(function (el) {
          var t = (el.innerText || '').trim();
          if (t && window.__toasts.indexOf(t) === -1) window.__toasts.push(t);
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
  `
});

console.log('\n[1] 打开 AI 对话页');
await send('Page.navigate', { url: APP + '/ai-chat' });
let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  ready = await evalJS('!!document.querySelector(".attach-btn")');
  if (ready) break;
}
check('页面加载出输入区（出现选图按钮）', ready === true);
console.log('  当前 URL:', await evalJS('location.href'));

console.log('\n[2] 云盘选图');
await evalJS('document.querySelector(".attach-btn").click()');
let pickerOpen = false;
for (let i = 0; i < 30; i++) { await sleep(200); pickerOpen = await evalJS('!!document.querySelector(".cip-panel")'); if (pickerOpen) break; }
check('点选图按钮 → 弹窗打开', pickerOpen === true);
const cardCount = await evalJS('document.querySelectorAll(".cip-card").length');
check('弹窗里有云盘图片', cardCount >= 1, cardCount);
await evalJS('document.querySelector(".cip-card").click()');
await sleep(200);
check('点一下图片 → 打上选中态', (await evalJS('document.querySelectorAll(".cip-card.selected").length')) === 1);
await evalJS('document.querySelector(".cip-btn--primary").click()');
await sleep(500);
const chips = await evalJS('document.querySelectorAll(".attach-chip").length');
check('确认后输入区出现附件 chip', chips === 1, chips);
// 移除再选一次，验证 chip 的删除按钮
await evalJS('document.querySelector(".attach-remove").click()');
await sleep(300);
check('移除 chip 成功', (await evalJS('document.querySelectorAll(".attach-chip").length')) === 0);
await evalJS('document.querySelector(".attach-btn").click()');
await sleep(500);
await evalJS('document.querySelector(".cip-card") && document.querySelector(".cip-card").click()');
await sleep(200);
await evalJS('document.querySelector(".cip-btn--primary") && document.querySelector(".cip-btn--primary").click()');
await sleep(400);
check('再次选图仍可用', (await evalJS('document.querySelectorAll(".attach-chip").length')) === 1);

console.log('\n[3] 长图导出到云盘');
const beforeFiles = await api('GET', '/api/cloud/files?folder=' + encodeURIComponent('AI 对话导出'));
const beforeCount = ((beforeFiles.data.data && beforeFiles.data.data.files) || []).length;
const btnTitle = await evalJS('(document.querySelector("button[title=\'导出长图到云盘\']")||{}).title || ""');
check('头部有「导出长图到云盘」按钮', /导出长图到云盘/.test(btnTitle), btnTitle);
await evalJS('(function(){var b=document.querySelector("button[title=\'导出长图到云盘\']"); if(b) b.click();})()');
let exported = null;
for (let i = 0; i < 60; i++) {
  await sleep(700);
  const list = await api('GET', '/api/cloud/files?folder=' + encodeURIComponent('AI 对话导出'));
  const files = (list.data.data && list.data.data.files) || [];
  if (files.length > beforeCount) { exported = files[0]; break; }
}
check('云盘「AI 对话导出」新增了文件', !!exported, { beforeCount, exported });
const toasts = await evalJS('window.__toasts.slice(-6)');
check('提示文案告知已存入云盘', Array.isArray(toasts) && toasts.some(t => /云盘/.test(t)), toasts);
if (exported) {
  const img = await fetch(APP + '/api/cloud/files/' + exported.hash, { headers: { Authorization: 'Bearer ' + TOKEN } });
  const buf = Buffer.from(await img.arrayBuffer());
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  check('导出文件是合法 PNG', img.status === 200 && isPng, { status: img.status, head: buf.slice(0, 8).toString('hex') });
  // PNG 头部 IHDR 里的宽高
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  console.log('  导出长图尺寸:', w + ' × ' + h, '/ 大小', Math.round(buf.length / 1024) + ' KB');
  check('宽度 = 760（渲染器设定）', w === 760, w);
  check('高度合理（> 400）', h > 400, h);
  check('文件名含日期戳', /_\d{8}_\d{4}\.png$/.test(exported.name || ''), exported.name);
}

console.log('\n[4] 控制台无报错');
check('无 JS 异常/错误日志', consoleErrors.length === 0, consoleErrors.slice(0, 5));

// ---------- 清理 ----------
console.log('\n[5] 清理');
const listFinal = await api('GET', '/api/cloud/files?folder=' + encodeURIComponent('AI 对话导出'));
for (const f of ((listFinal.data.data && listFinal.data.data.files) || [])) {
  if (/长图导出冒烟_/.test(f.name)) await api('DELETE', '/api/cloud/files/' + f.hash);
}
if (pickHash) await api('DELETE', '/api/cloud/files/' + pickHash);
await api('DELETE', '/api/ai-chat/conversations/' + convId);
if (!visionWasOn) await api('PUT', '/api/ai-chat/admin/models/' + target.id, { supports_vision: false });
const back = await api('GET', '/api/ai-chat/admin/models');
check('模型视觉能力已还原', back.data.data.models.find(m => m.id === target.id).supports_vision === visionWasOn);
check('冒烟会话已删除', true);
chrome.kill();

console.log('\n============================');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
console.log('============================');
process.exit(FAIL === 0 ? 0 : 1);
