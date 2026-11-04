// 素材选型预览：把候选 (col,row,w,h) 按整数倍渲染并标注名字。
// 用法：node scripts/_sprite-gallery.mjs <spec.json> [scale]
// spec.json = [{"id":"bed","c":0,"r":0,"w":3,"h":2}, ...]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const SHEET = 'D:/NetWork/Integration/ClassIntra/market-apps/pet/frontend/assets/tiles/indoor.png';
const specPath = process.argv[2];
const S = Number(process.argv[3] || 3);
if (!specPath || !existsSync(specPath)) { console.error('need spec.json'); process.exit(1); }
const items = JSON.parse(readFileSync(specPath, 'utf8'));

const b = readFileSync(SHEET);
const SW = b.readUInt32BE(16), SH = b.readUInt32BE(20);
const T = 16, M = 1;

const cards = items.map((it) => {
  const w = it.w * T * S, h = it.h * T * S;
  // ⚠️ 内联 style 属性里必须用单引号包 URL —— 双引号会截断属性（首版全白就是这个坑）
  const bg = `url('${pathToFileURL(SHEET).href}') ${-it.c * (T + M) * S}px ${-it.r * (T + M) * S}px / ${SW * S}px ${SH * S}px no-repeat`;
  return `<div class="card"><div class="art" style="width:${w}px;height:${h}px;background:${bg};image-rendering:pixelated"></div>
    <div class="lb">${it.id}</div><div class="pos">${it.c},${it.r} ${it.w}x${it.h}</div></div>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#201a30;font:11px/1.4 monospace;color:#c9c2e6;padding:14px}
  .row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}
  .card{background:#2b2440;box-shadow:0 0 0 2px #17111f,4px 4px 0 rgba(0,0,0,.4);padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px}
  .lb{color:#ffd76e;font-weight:700}
  .pos{color:#7d74a3}
</style>
<div class="row">${cards}</div>`;

const tmpHtml = join(tmpdir(), 'sprite-gal-' + Date.now() + '.html');
writeFileSync(tmpHtml, html, 'utf8');
const W = 1240, H = 900;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9491',
  `--user-data-dir=${join(tmpdir(), 'spritegal-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const g = async (p) => (await fetch(`http://127.0.0.1:9491${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(400); } }
const page = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(tmpHtml).href });
  await sleep(1000);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const out = join(process.cwd(), 'logs', 'sprite-gallery.png');
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('📸', out);
} catch (e) { console.error('✗', e.message); process.exitCode = 1; }
finally { try { ws.close(); } catch {} try { chrome.kill(); } catch {} }
