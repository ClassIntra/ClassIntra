// 对战页 v2 截图：真后端 + 探针宠物（跑前种子、finally 清理）。
// 拍：竞技场默认视野 / 对战抽屉 / 副本抽屉 / 荣誉抽屉。
// 用法：node scripts/_pet-battle-shot.mjs [输出目录] [宽] [高]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = process.cwd();
const BASE = 'http://127.0.0.1:9001';
const UID = 'ci-pet-probe';
const OUT = process.argv[2] || path.join(process.env.TEMP || '.', 'ci-pet-v2');
const W = Number(process.argv[3] || 900);
const H = Number(process.argv[4] || 1400);
fs.mkdirSync(OUT, { recursive: true });

const require = (await import('node:module')).createRequire(path.join(REPO, 'server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(path.join(REPO, 'server/database/classintra.db'));

let SECRET = '';
for (const line of fs.readFileSync(path.join(REPO, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = (() => {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ user_id: UID, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return h + '.' + p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
})();

const today = new Date().toISOString().slice(0, 10);
const seed = {
  adopted: true, name: '冒烟鱼', bond: 152, coins: 42,
  battle_tactic: 'guard', battle_skills: ['heavy', 'lifesteal', 'sharp', 'finesse'],
  battle_build: { skills: [], equipment: { weapon: 'void_blade', accessory: 'lightning_stone', consumable: 'flame_potion' }, strategy_name: '破甲雷光流' },
  equip_inventory: { owned: ['blunt_sword', 'crystal_amulet', 'void_blade', 'lightning_stone', 'star_hammer', 'wind_charm'], charges: { flame_potion: 2, restore_vial: 1 } },
  _kit2: true,
  battle_date: '2000-01-01', battle_today: 0,
  battles: { total: 12, win: 8, lose: 4, points: 96, streak: 3, best: 5 },
  design: { type: 'video', character: 'dsh-whale' },
  created_at: new Date().toISOString()
};
db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
  'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
  .run(UID, 'desktop_pet', JSON.stringify(seed));
console.log('探针宠物已种子');

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9413',
  `--user-data-dir=${path.join(OUT, 'profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });
const g = async (u) => (await fetch('http://127.0.0.1:9413' + u)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
const ERRORS = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    ERRORS.push(String((x.exception && x.exception.description) || x.text).split('\n')[0]);
  }
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails && r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result && r.result.value;
};
const shot = async (name) => {
  const c = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(c.data, 'base64'));
  console.log('📸', name);
};
const clickCmd = async (label) => ev(`(function(){
  var btns = document.querySelectorAll('.ci-pet-cmdbtn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.indexOf(${JSON.stringify(label)}) >= 0) { btns[i].click(); return true; }
  }
  return false;
})()`);
const closeSheet = async () => ev(`(function(){
  var c = document.querySelector('.ci-pet-sheet-close');
  if (c) c.click();
  return true;
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/login' });
await sleep(2500);
await ev(`localStorage.setItem('token', ${JSON.stringify(TOKEN)}); localStorage.setItem('user', JSON.stringify({ user_id: ${JSON.stringify(UID)} })); 'ok'`);
await send('Page.navigate', { url: BASE + '/pet' });
await sleep(8000);

await ev(`(function(){ var b = document.querySelector('.ci-pet-tab[data-tab="battle"]'); if (b) b.click(); return !!b; })()`);
await sleep(1200);
await shot('now-battle-arena.png');

// 对战抽屉
console.log('对战抽屉:', await clickCmd('对战'));
await sleep(700);
await shot('now-sheet-fight.png');
await closeSheet();
await sleep(400);
// 副本抽屉
console.log('副本抽屉:', await clickCmd('副本'));
await sleep(600);
await shot('now-sheet-env.png');
await closeSheet();
await sleep(300);
// 荣誉抽屉
console.log('荣誉抽屉:', await clickCmd('荣誉'));
await sleep(500);
await shot('now-sheet-honor.png');
await closeSheet();

console.log('errors:', ERRORS.length ? ERRORS.join(' | ') : 'none');
ws.close();
chrome.kill();

db.prepare('DELETE FROM user_kv_store WHERE user_id = ? AND key = ?').run(UID, 'desktop_pet');
console.log('探针宠物已清理；输出目录', OUT);
process.exit(0);
