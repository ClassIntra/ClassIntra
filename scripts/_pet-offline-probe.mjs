// 离线时光探针：验证 /state 下发 offlineRecap、收益真到账、幂等。
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
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const r = http.request(u, opts);
    r.on('response', function(s) {
      let d = '';
      s.on('data', function(c) { d += c; });
      s.on('end', function() {
        try { var parsed = JSON.parse(d); res(parsed && parsed.data ? parsed.data : parsed); }
        catch (e) { rej(e); }
      });
    });
    r.on('error', rej);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

async function adopt(uid) {
  await req('PUT', '/api/pet/state', { adopt: true }, uid);
}

// 1. 刚领养：last_active_at 还没有，gapMin=0，不弹 recap
await adopt('999910');
const d0 = await req('GET', '/api/pet/state', undefined, '999910');
ok('刚领养无 recap', d0.offlineRecap === null, JSON.stringify(d0.offlineRecap));

// 2. 把 last_active_at 拨回 3 小时前 → 应触发 recap
const st0 = d0.state;
st0.last_active_at = Date.now() - 3 * 3600 * 1000;
st0.offline_recap_at = 0;
await req('PUT', '/api/pet/state', st0, '999910');
const d1 = await req('GET', '/api/pet/state', undefined, '999910');
ok('离线 3h 有 recap', !!d1.offlineRecap, JSON.stringify(d1.offlineRecap));
ok('recap gapMin ≈ 180', d1.offlineRecap && Math.abs(d1.offlineRecap.gapMin - 180) <= 2, String(d1.offlineRecap && d1.offlineRecap.gapMin));
ok('recap 有文案', d1.offlineRecap && typeof d1.offlineRecap.msg === 'string' && d1.offlineRecap.msg.length > 0, d1.offlineRecap && d1.offlineRecap.msg);
ok('recap events ≥ 1', d1.offlineRecap && d1.offlineRecap.events.length >= 1, String(d1.offlineRecap && d1.offlineRecap.events.length));
ok('3h = 6 条鱼干', d1.offlineRecap && d1.offlineRecap.coinGain === 6, String(d1.offlineRecap && d1.offlineRecap.coinGain));
ok('3h = 1 羁绊', d1.offlineRecap && d1.offlineRecap.bondGain === 1, String(d1.offlineRecap && d1.offlineRecap.bondGain));
ok('鱼干真到账', (d1.state.coins || 0) >= 6, String(d1.state.coins));
ok('羁绊真到账', (d1.state.bond || 0) >= 1, String(d1.state.bond));

// 3. 立刻再请求一次：应不重复弹（offline_recap_at 已刷新）
const d2 = await req('GET', '/api/pet/state', undefined, '999910');
ok('同 30 分钟内不重复弹', d2.offlineRecap === null, JSON.stringify(d2.offlineRecap));

// 4. 再拨回 10 小时 → 触发第三次，且受 cap 钳制
const st1 = d2.state;
st1.last_active_at = Date.now() - 10 * 3600 * 1000;
await req('PUT', '/api/pet/state', st1, '999910');
const d3 = await req('GET', '/api/pet/state', undefined, '999910');
ok('10h 触发第三次 recap', !!d3.offlineRecap, JSON.stringify(d3.offlineRecap));
ok('cap 钳到 8h', d3.offlineRecap && d3.offlineRecap.gapMin === 480, String(d3.offlineRecap && d3.offlineRecap.gapMin));
ok('cap 鱼干 ≤ 16', d3.offlineRecap && d3.offlineRecap.coinGain <= 16, String(d3.offlineRecap && d3.offlineRecap.coinGain));
ok('cap 羁绊 ≤ 4', d3.offlineRecap && d3.offlineRecap.bondGain <= 4, String(d3.offlineRecap && d3.offlineRecap.bondGain));

// 5. 未领养号：recap 必须是 null，不能污染
const d4 = await req('GET', '/api/pet/state', undefined, '999911');
ok('未领养号 recap 为 null', d4.offlineRecap === null, JSON.stringify(d4.offlineRecap));

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + '/' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);