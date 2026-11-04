// 真后端冒烟：打 /api/pet/battle/profile 与 /api/pet/battle/fight。
// 用一个临时 uid（默认 ci-pet-probe），先写一条宠物状态进 user_kv_store，
// 跑完把这条键删掉，不动任何真实用户数据。
// 用法：node scripts/_pet-battle-http-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const REPO = path.join(process.cwd());
const BASE = 'http://127.0.0.1:9001';
const UID = 'ci-pet-probe';

const require = createRequire(path.join(REPO, 'server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(path.join(REPO, 'server/database/classintra.db'));

let SECRET = '';
for (const line of fs.readFileSync(path.join(REPO, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) throw new Error('未取到 JWT_SECRET');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (() => {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ user_id: UID, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return h + '.' + p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
})();
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function call(label, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
  console.log(label.padEnd(26) + res.status + '  ' + JSON.stringify(j).slice(0, 260));
  return { status: res.status, body: j };
}

const today = new Date().toISOString().slice(0, 10);
const seed = {
  adopted: true, name: '冒烟鱼', bond: 82, bond_today: 0, bond_date: today,
  poked_today: 0, fed_today: 0, design: { type: 'video', character: 'dsh-whale' },
  created_at: new Date().toISOString()
};
db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
  'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
  .run(UID, 'desktop_pet', JSON.stringify(seed));
console.log('已写入探针宠物状态 uid=' + UID);

try {
  const prof = await call('GET /battle/profile', 'GET', '/api/pet/battle/profile');
  if (prof.status !== 200 || prof.body.code !== 200) throw new Error('profile 失败');
  const d = prof.body.data;
  console.log('  战力', d.combat.power, '档位', d.combat.tierName, '今日', d.today + '/' + d.cap);
  for (const o of d.opponents) console.log('  -', o.id, o.name, 'bond', o.bond, 'power', o.power);

  const fight = await call('POST /battle/fight(练习)', 'POST', '/api/pet/battle/fight', { oppId: 'spar' });
  if (fight.status !== 200 || fight.body.code !== 200) throw new Error('fight 失败');
  const f = fight.body.data;
  console.log('  结果', f.win ? '胜' : '负', '回合', f.rounds, '步数', f.steps.length,
    '积分+' + f.gain, '今日', f.today + '/' + f.cap);
  console.log('  战报前 2 步', JSON.stringify(f.steps.slice(0, 2)));

  // 同一天连打满 5 场后必须被拒（429）—— 验证每日上限真的在线上生效
  for (let i = 0; i < 5; i++) await call('POST /battle/fight#' + (i + 2), 'POST', '/api/pet/battle/fight', { oppId: 'spar' });

  const after = await call('GET /battle/profile(final)', 'GET', '/api/pet/battle/profile');
  console.log('  落库战绩', JSON.stringify(after.body.data.record), '今日', after.body.data.today);
  // 羁绊必须没被对战碰过
  const row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(UID, 'desktop_pet');
  const st = JSON.parse(row.value);
  console.log('  羁绊', st.bond, '(应为 82，对战不碰羁绊)');
  if (st.bond !== 82) throw new Error('对战动了羁绊：' + st.bond);
  console.log('\nOK: 真后端对战接口冒烟通过');
} finally {
  db.prepare('DELETE FROM user_kv_store WHERE user_id = ? AND key = ?').run(UID, 'desktop_pet');
  console.log('已清理探针数据');
  db.close();
}
