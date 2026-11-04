// 生成「带坐标的图集对照表」：把 PNG 图集铺成带行列号的网格并截图。
// 用途：准确挑出 (col,row) 坐标 —— 靠肉眼猜格子位置一定会错。
// 用法：node scripts/_tilesheet-map.mjs <png 绝对路径> [tile=16] [margin=1] [scale=4]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const png = process.argv[2];
const TILE = Number(process.argv[3] || 16);
const MARG = Number(process.argv[4] || 1);
const SCALE = Number(process.argv[5] || 4);
if (!png || !existsSync(png)) { console.error('need png path'); process.exit(1); }

// 读 PNG 头拿尺寸
function pngSize(p) {
  const b = readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const { w, h } = pngSize(png);
const cols = Math.floor((w + MARG) / (TILE + MARG));
const rows = Math.floor((h + MARG) / (TILE + MARG));
console.log(`${basename(png)}  ${w}x${h}  →  ${cols} col × ${rows} row (tile ${TILE}, margin ${MARG})`);

const cell = (TILE + MARG) * SCALE;
const padL = 46, padT = 34;
const W = cols * cell + padL + 10;
const H = rows * cell + padT + 10;

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#0f1020;font:12px/1 monospace;color:#cfd6ff}
  #wrap{position:relative;width:${W}px;height:${H}px}
  #sheet{position:absolute;left:${padL}px;top:${padT}px;
    width:${w * SCALE}px;height:${h * SCALE}px;
    background:url("${pathToFileURL(png).href}") 0 0/${w * SCALE}px ${h * SCALE}px no-repeat;
    image-rendering:pixelated}
  .c,.r{position:absolute;color:#8f9bd8;font-weight:700}
  .c{top:6px;text-align:center;width:${cell}px}
  .r{left:6px;text-align:right;width:34px;line-height:${cell}px}
  .g{position:absolute;box-shadow:inset 0 0 0 1px rgba(120,160,255,.16)}
  .hl{position:absolute;box-shadow:inset 0 0 0 2px #ffd76e}
</style>
<div id="wrap">
  <div id="sheet"></div>
</div>
<script>
  const cols=${cols}, rows=${rows}, TILE=${TILE}, MARG=${MARG}, S=${SCALE};
  const cell=(${TILE}+${MARG})*S, padL=${padL}, padT=${padT};
  const wrap=document.getElementById('wrap');
  for(let c=0;c<cols;c++){
    if(c%2) continue;
    const d=document.createElement('div'); d.className='c';
    d.style.left=(padL+c*cell)+'px'; d.textContent=c; wrap.appendChild(d);
  }
  for(let r=0;r<rows;r++){
    if(r%2) continue;
    const d=document.createElement('div'); d.className='r';
    d.style.top=(padT+r*cell)+'px'; d.textContent=r; wrap.appendChild(d);
  }
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const d=document.createElement('div'); d.className='g';
    d.style.cssText='left:'+(padL+c*cell)+'px;top:'+(padT+r*cell)+'px;width:'+(TILE*S)+'px;height:'+(TILE*S)+'px';
    wrap.appendChild(d);
  }
</script>`;

const tmpHtml = join(tmpdir(), 'tilemap-' + Date.now() + '.html');
writeFileSync(tmpHtml, html, 'utf8');

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9488',
  `--user-data-dir=${join(tmpdir(), 'tilemap-prof-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  `--window-size=${Math.min(W, 3000)},${Math.min(H, 3000)}`, 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9488${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(400); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Math.min(W, 3000), height: Math.min(H, 3000), deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(tmpHtml).href });
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const out = join(process.cwd(), 'logs', 'tilesheet-' + basename(png, '.png') + '.png');
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('📸', out);
} catch (e) { console.error('✗', e.message); process.exitCode = 1; }
finally { try { ws.close(); } catch {} try { chrome.kill(); } catch {} }
