// 每日登录奖励探针：验证 /api/pet/state 下发 dailyBonus、领奖后 streak 递增、
// 同一天第二次请求不再重复发奖。
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of fs.readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' → ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

async function state(uid) {
  const token = jwt.sign({ user_id: uid, is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
  const u = new URL(BASE + '/api/pet/state');
  const req = http.request(u, { headers: { Authorization: 'Bearer ' + token } });
  return new Promise(function(res, rej) {
    let d = '';
    req.on('response', function(r) {
      r.on('data', function(c) { d += c; });
      r.on('end', function() {
        try { var parsed = JSON.parse(d); res(parsed && parsed.data ? parsed.data : parsed); }
        catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

// 1. 未领养的号：dailyBonus 应为 null
const d0 = await state('999901');
ok('未领养号 dailyBonus 为 null', d0.dailyBonus === null, JSON.stringify(d0.dailyBonus));

// 2. 领养（PUT /state adopt=true）后，/state 应返回 granted=true 且 streak=1
await new Promise((res, rej) => {
  const token = jwt.sign({ user_id: '999902', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
  const body = JSON.stringify({ adopt: true });
  const u = new URL(BASE + '/api/pet/state');
  const req = http.request(u, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  req.on('response', r => { r.resume(); r.on('end', res); });
  req.on('error', rej);
  req.write(body); req.end();
});
const d1 = await state('999902');
ok('新领养号 dailyBonus 存在', !!d1.dailyBonus, JSON.stringify(d1.dailyBonus));
ok('新领养号 streak=1', d1.dailyBonus && d1.dailyBonus.streak === 1, String(d1.dailyBonus && d1.dailyBonus.streak));
ok('新领养号 granted=true', d1.dailyBonus && d1.dailyBonus.granted === true, String(d1.dailyBonus && d1.dailyBonus.granted));
ok('新领养号有 coins 奖励', d1.dailyBonus && d1.dailyBonus.coins >= 3, String(d1.dailyBonus && d1.dailyBonus.coins));
ok('新领养号有 bond 奖励', d1.dailyBonus && d1.dailyBonus.bond >= 2, String(d1.dailyBonus && d1.dailyBonus.bond));
ok('新领养号有 msg 文案', d1.dailyBonus && typeof d1.dailyBonus.msg === 'string' && d1.dailyBonus.msg.length > 0, d1.dailyBonus && d1.dailyBonus.msg);

// 3. 同一天再请求一次：granted=false，streak 不变
const d2 = await state('999902');
ok('同天再请求 granted=false', d2.dailyBonus && d2.dailyBonus.granted === false, String(d2.dailyBonus && d2.dailyBonus.granted));
ok('同天再请求 streak 仍为 1', d2.dailyBonus && d2.dailyBonus.streak === 1, String(d2.dailyBonus && d2.dailyBonus.streak));

// 4. coins 真的加上了
ok('新领养号 coins >= 3（真到账）', (d1.state && d1.state.coins) >= 3, String(d1.state && d1.state.coins));
ok('新领养号 bond >= 2（真到账）', (d1.state && d1.state.bond) >= 2, String(d1.state && d1.state.bond));

// 5. 无领养时 state 里不该有 dailyBonus 外的多余字段污染
ok('/state 仍含 diary 字段', d1.diary !== undefined, typeof d1.diary);
ok('/state 仍含 focus 字段', d1.focus !== undefined, typeof d1.focus);

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + '/' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);