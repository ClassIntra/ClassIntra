// 拖拽验证探针：合成 Pointer 事件拖动大肥鱼，断言位置变化
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9375',
  `--user-data-dir=${join(tmpdir(), 'ci-drag')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
function join(a, b) { return a.replace(/\/$/, '') + '/' + b.replace(/^\//, ''); }

const g = async (p) => (await fetch(`http://127.0.0.1:9375${p}`)).json();
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(TOKEN)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 1, role: 'admin' }))});
  }catch(e){}`
});
await send('Page.navigate', { url: APP + '/' });
await sleep(8000);

const before = await ev(`(function(){
  var pet = document.querySelector('.ci-pet');
  if (!pet) return null;
  var r = pet.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), pointerEvents: getComputedStyle(pet).pointerEvents };
})()`);
console.log('拖前:', JSON.stringify(before));

// 合成拖拽：pointerdown 在宠物中心 → 10 步 move 到 (-200, -150) → pointerup
const drag = await ev(`(function(){
  var pet = document.querySelector('.ci-pet');
  if (!pet) return 'no-pet';
  var r = pet.getBoundingClientRect();
  var sx = r.x + r.width / 2, sy = r.y + r.height / 2;
  var opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  function fire(type, x, y) {
    pet.dispatchEvent(new PointerEvent(type, Object.assign({}, opts, {
      clientX: x, clientY: y, button: 0, buttons: 1
    })));
  }
  return new Promise(function(resolve) {
    fire('pointerdown', sx, sy);
    var steps = 10, i = 0;
    (function step() {
      if (i >= steps) {
        fire('pointerup', sx - 200, sy - 150);
        setTimeout(function() {
          var r2 = pet.getBoundingClientRect();
          resolve(JSON.stringify({ x: Math.round(r2.x), y: Math.round(r2.y) }));
        }, 300);
        return;
      }
      i++;
      fire('pointermove', sx - 200 * i / steps, sy - 150 * i / steps);
      setTimeout(step, 30);
    })();
  });
})()`);
console.log('拖后:', drag);

if (before && typeof drag === 'string') {
  const after = JSON.parse(drag);
  const moved = Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 50;
  console.log(moved ? 'PASS 拖拽生效（位移 ' + (after.x - before.x) + ',' + (after.y - before.y) + '）' : 'FAIL 拖拽未生效（位移 ' + (after.x - before.x) + ',' + (after.y - before.y) + '）');
}
chrome.kill();
process.exit(0);
