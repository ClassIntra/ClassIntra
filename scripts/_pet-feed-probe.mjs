// 喂饭数值不涨的实测探针：直接打真实 /api/market/app/pet/* 接口
// 目的：确认 20 分钟冷却 / 每日 3 次上限 / 前端 4 小时衰减三者如何互相打架
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/server/package.json');
const jwt = require('jsonwebtoken');

const REPO = process.cwd();
const APP = 'http://127.0.0.1:9001';
const UID = '251800'; // 8i=2508xx / 18i=2518xx，按当前库选

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 未读到 JWT_SECRET'); process.exit(1); }
const TOK = jwt.sign({ user_id: UID }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' };

const call = async (method, path, body) => {
  const r = await fetch(APP + path, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch { j = { raw: await r.text().catch(() => '') }; }
  return { http: r.status, j };
};

// market 应用挂载前缀：先探测真实路径
console.log('== 探测路由前缀 ==');
const prefixes = [
  '/api/market/app/pet',
  '/api/apps/pet',
  '/api/pet',
  '/api/market/pet'
];
let BASE = null;
for (const p of prefixes) {
  const { http, j } = await call('GET', p + '/state');
  console.log(`  ${p}/state → HTTP ${http} code=${j && j.code}`);
  if (http === 200 && j && j.code === 200) { BASE = p; break; }
}
if (!BASE) { console.error('✗ 未找到可用的 pet 路由前缀'); process.exit(1); }
console.log('  采用前缀:', BASE);

const show = (label, r) => {
  const d = (r.j && r.j.data) || {};
  const s = d.state || {};
  console.log(`  ${label}: HTTP ${r.http} code=${r.j && r.j.code} ` +
    `bond=${s.bond} fed_today=${s.fed_today} gained=${d.gained} capped=${d.capped}` +
    (r.j && r.j.message ? ` msg="${r.j.message}"` : ''));
};

console.log('\n== 当前状态 ==');
let st = await call('GET', BASE + '/state');
let s0 = (st.j && st.j.data && st.j.data.state) || {};
console.log('  adopted =', s0.adopted, '· bond =', s0.bond, '· fed_today =', s0.fed_today,
  '· last_fed_at =', s0.last_fed_at);
// 前端饱食度公式：1 - (now - last_fed)/4h
const fed = s0.last_fed_at
  ? Math.round(Math.max(0, Math.min(1, 1 - (Date.now() - new Date(s0.last_fed_at).getTime()) / (4 * 3600e3))) * 100)
  : 0;
console.log('  前端算出的饱食度 =', fed + '%  → UI 是否显示"饿"：', fed <= 10 ? '是' : '否');

if (!s0.adopted) {
  console.log('\n  未领养，先领养一只');
  const r = await call('POST', BASE + '/adopt', { name: '大肥鱼' });
  console.log('  adopt →', JSON.stringify(r.j).slice(0, 200));
  st = await call('GET', BASE + '/state');
}

console.log('\n== 连续喂 4 次（验证 20 分钟冷却 + 每日 3 次上限）==');
for (let i = 1; i <= 4; i++) {
  const r = await call('POST', BASE + '/interact', { type: 'feed' });
  show(`第 ${i} 次`, r);
}

console.log('\n== 连续摸 12 次（验证 poke 每日 10 次上限）==');
for (let i = 1; i <= 12; i++) {
  const r = await call('POST', BASE + '/interact', { type: 'poke' });
  const d = (r.j && r.j.data) || {};
  if (i % 3 === 0 || i > 10) {
    console.log(`  第 ${i} 次: HTTP ${r.http} gained=${d.gained} capped=${d.capped} bond=${d.state && d.state.bond}`);
  }
}

console.log('\n== 最终状态 ==');
st = await call('GET', BASE + '/state');
const sf = (st.j && st.j.data && st.j.data.state) || {};
console.log('  bond =', sf.bond, '· poked_today =', sf.poked_today, '· fed_today =', sf.fed_today);
const fed2 = sf.last_fed_at
  ? Math.round(Math.max(0, Math.min(1, 1 - (Date.now() - new Date(sf.last_fed_at).getTime()) / (4 * 3600e3))) * 100)
  : 0;
console.log('  前端饱食度 =', fed2 + '%');
console.log('\n判定：若"饱食度显示饿"但 feed 返回 429 → 冷却与衰减不同步，UI 说饿而喂不进去');
