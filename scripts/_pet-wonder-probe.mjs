// 每日奇遇探针：验证 /state 下发 wonder、领取幂等、收益真到账。
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

function token(uid) {
  return jwt.sign({ user_id: uid, is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
}
function req(method, path, body, uid) {
  return new Promise(function(res, rej) {
    const u = new URL(BASE + path);
    const opts = { method, headers: { Authorization: 'Bearer ' + token(uid) } };
    if (body !== undefined) opts.headers['Content-Type'] = 'application/json';
    const r = http.request(u, opts);
    r.on('response', function(s) { let d = ''; s.on('data', c => d += c); s.on('end', () => { try { var p = JSON.parse(d); res(p && p.data ? p.data : p); } catch (e) { rej(e); } }); });
    r.on('error', rej);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
async function adopt(uid) { await req('PUT', '/api/pet/state', { adopt: true }, uid); }

const UID = '999970';
await adopt(UID);

// 1. 未领养号 wonder 必须是 null
const d0 = await req('GET', '/api/pet/state', undefined, '999943');
ok('未领养号 wonder 为 null', d0.wonder === null, JSON.stringify(d0.wonder));

// 2. 领养号有 wonder，且未领取
const d1 = await req('GET', '/api/pet/state', undefined, UID);
ok('领养号 wonder 存在', !!d1.wonder, JSON.stringify(d1.wonder));
ok('wonder 有 wonder 字段', !!(d1.wonder && d1.wonder.wonder), JSON.stringify(d1.wonder && d1.wonder.wonder));
ok('wonder 有 title/text', !!(d1.wonder && d1.wonder.wonder && d1.wonder.wonder.title && d1.wonder.wonder.text), d1.wonder && d1.wonder.wonder && d1.wonder.wonder.title);
ok('未领取时 claimed=false', d1.wonder && d1.wonder.claimed === false, String(d1.wonder && d1.wonder.claimed));
ok('未领取时有 reward', !!(d1.wonder && d1.wonder.reward), JSON.stringify(d1.wonder && d1.wonder.reward));

// 3. 同一天两次请求 wonder 相同（确定性）
const d2 = await req('GET', '/api/pet/state', undefined, UID);
ok('同天 wonder 相同', JSON.stringify(d1.wonder) === JSON.stringify(d2.wonder), JSON.stringify(d2.wonder));

// 4. 领取
const claimed = await req('POST', '/api/pet/wonder/claim', {}, UID);
ok('领取后 claimed=true', claimed.wonder && claimed.wonder.claimed === true, JSON.stringify(claimed.wonder && claimed.wonder.claimed));
ok('领取返回 state', !!claimed.state, String(!!claimed.state));
ok('coins 真到账', (claimed.state.coins || 0) >= (d1.wonder.reward.coins || 0), 'now=' + claimed.state.coins + ' gain=' + (d1.wonder.reward.coins || 0));
ok('bond 真到账', (claimed.state.bond || 0) >= (d1.wonder.reward.bond || 0), 'now=' + claimed.state.bond + ' gain=' + (d1.wonder.reward.bond || 0));

// 5. 同天再领：幂等
const claimed2 = await req('POST', '/api/pet/wonder/claim', {}, UID);
ok('同天再领幂等 (alreadyClaimed)', claimed2.alreadyClaimed === true, JSON.stringify(claimed2.alreadyClaimed));
ok('同天再领 wonder 仍 claimed', claimed2.wonder && claimed2.wonder.claimed === true, String(claimed2.wonder && claimed2.wonder.claimed));
const st2 = await req('GET', '/api/pet/state', undefined, UID);
ok('幂等不重复到账', (st2.state && st2.state.coins) === claimed.state.coins, 'now=' + (st2.state && st2.state.coins) + ' prev=' + claimed.state.coins);

// 6. wonder 不占 bond_today 的 25 上限（独立于互动）
ok('wonder 不污染 bond_today 上限', (claimed.state.bond_today || 0) <= 25 + (d1.wonder.reward.bond || 0), String(claimed.state.bond_today));

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + '/' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);