// 图集局部放大：只渲染指定格子范围，每格都标号，用于精确挑 tile。
// 用法：node scripts/_tilezoom.mjs <png> <c0> <r0> <c1> <r1> [tile] [margin] [scale] [outTag]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const [png, c0s, r0s, c1s, r1s] = process.argv.slice(2);
const TILE = Number(process.argv[7] || 16);
const MARG = Number(process.argv[8] || 1);
const SCALE = Number(process.argv[9] || 9);
const TAG = process.argv[10] || 'zoom';
if (!png || !existsSync(png)) { console.error('need png'); process.exit(1); }
const c0 = +c0s, r0 = +r0s, c1 = +c1s, r1 = +r1s;
// 图集实际尺寸（从 PNG 头读，别写死）
const _b = readFileSync(png);
const SW = _b.readUInt32BE(16), SH = _b.readUInt32BE(20);
const cols = c1 - c0 + 1, rows = r1 - r0 + 1;

const cell = (TILE + MARG) * SCALE;
const padL = 30, padT = 26;
const W = cols * cell + padL + 8, H = rows * cell + padT + 8;

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#101326;font:11px/1 monospace;color:#cfd6ff}
  #wrap{position:relative;width:${W}px;height:${H}px}
  #v{position:absolute;left:${padL}px;top:${padT}px;width:${cols * cell}px;height:${rows * cell}px;overflow:hidden}
  #s{position:absolute;left:${-c0 * cell}px;top:${-r0 * cell}px;
     width:${SW * SCALE}px;height:${SH * SCALE}px;
     background:url("${pathToFileURL(png).href}") 0 0/${SW * SCALE}px ${SH * SCALE}px no-repeat;
     image-rendering:pixelated}
  .c,.r{position:absolute;color:#ffd76e;font-weight:700}
  .c{top:4px;text-align:center;width:${cell}px}
  .r{left:0;text-align:right;width:24px;line-height:${cell}px}
  .g{position:absolute;box-shadow:inset 0 0 0 1px rgba(120,160,255,.25)}
</style>
<div id="wrap"><div id="v"><div id="s"></div></div></div>
<script>
  const wrap=document.getElementById('wrap'), v=document.getElementById('v');
  const cell=${cell}, padL=${padL}, padT=${padT}, T=${TILE*SCALE}, c0=${c0}, r0=${r0};
  for(let c=0;c<${cols};c++){
    const d=document.createElement('div'); d.className='c';
    d.style.left=(padL+c*cell)+'px'; d.textContent=c0+c; wrap.appendChild(d);
  }
  for(let r=0;r<${rows};r++){
    const d=document.createElement('div'); d.className='r';
    d.style.top=(padT+r*cell)+'px'; d.textContent=r0+r; wrap.appendChild(d);
  }
  for(let r=0;r<${rows};r++)for(let c=0;c<${cols};c++){
    const d=document.createElement('div'); d.className='g';
    d.style.cssText='left:'+(c*cell)+'px;top:'+(r*cell)+'px;width:'+T+'px;height:'+T+'px';
    v.appendChild(d);
  }
</script>`;
const tmpHtml = join(tmpdir(), 'tilezoom-' + Date.now() + '.html');
writeFileSync(tmpHtml, html, 'utf8');

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9489',
  `--user-data-dir=${join(tmpdir(), 'tilezoom-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  `--window-size=${Math.min(W, 2800)},${Math.min(H, 2800)}`, 'about:blank'], { stdio: 'ignore' });
const g = async (p) => (await fetch(`http://127.0.0.1:9489${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(400); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Math.min(W, 2800), height: Math.min(H, 2800), deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(tmpHtml).href });
  await sleep(1000);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const out = join(process.cwd(), 'logs', 'zoom-' + TAG + '.png');
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('📸', out);
} catch (e) { console.error('✗', e.message); process.exitCode = 1; }
finally { try { ws.close(); } catch {} try { chrome.kill(); } catch {} }
