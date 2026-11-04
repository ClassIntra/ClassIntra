// 逗它笑小游戏探针：验证 /pet/play 的结算与同天幂等。
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

function reqToken(uid) {
  return jwt.sign({ user_id: uid, is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
}

function adopt(uid) {
  return new Promise(function(res, rej) {
    const token = reqToken(uid);
    const body = JSON.stringify({ adopt: true });
    const u = new URL(BASE + '/api/pet/state');
    const r = http.request(u, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    r.on('response', function(rr) { rr.resume(); rr.on('end', res); });
    r.on('error', rej);
    r.write(body); r.end();
  });
}

function play(uid, score) {
  return new Promise(function(res, rej) {
    const token = reqToken(uid);
    const body = JSON.stringify({ score: score });
    const u = new URL(BASE + '/api/pet/play');
    const r = http.request(u, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    let d = '';
    r.on('response', function(rr) {
      rr.on('data', function(c) { d += c; });
      rr.on('end', function() {
        try { res(JSON.parse(d)); }
        catch (e) { rej(e); }
      });
    });
    r.on('error', rej);
    r.write(body); r.end();
  });
}

function state(uid) {
  return new Promise(function(res, rej) {
    const token = reqToken(uid);
    const u = new URL(BASE + '/api/pet/state');
    const r = http.request(u, { headers: { Authorization: 'Bearer ' + token } });
    let d = '';
    r.on('response', function(rr) {
      rr.on('data', function(c) { d += c; });
      rr.on('end', function() {
        try { res(JSON.parse(d)); }
        catch (e) { rej(e); }
      });
    });
    r.on('error', rej);
    r.end();
  });
}

const UID = '999906';

(async function() {
  await adopt(UID);

  // 1. 第一次玩：应有 added > 0
  const d1 = await play(UID, 120);
  ok('第一次 play 返回 code 200', d1.code === 200, String(d1.code));
  ok('第一次 play 有 added', (d1.data && d1.data.added) > 0, String(d1.data && d1.data.added));
  ok('第一次 play total <= cap', (d1.data && d1.data.total) <= (d1.data && d1.data.cap), JSON.stringify(d1.data));
  ok('第一次 play 返回 mood', !!(d1.data && d1.data.mood), d1.data && d1.data.mood && d1.data.mood.name);
  ok('第一次 play 返回 personality', !!(d1.data && d1.data.personality), d1.data && d1.data.personality && d1.data.personality.name);

  // 2. 同天再玩一次：added 应为 0（幂等）
  const d2 = await play(UID, 200);
  ok('同天再 play added=0', (d2.data && d2.data.added) === 0, String(d2.data && d2.data.added));
  ok('同天再 play total 不变', (d2.data && d2.data.total) === (d1.data && d1.data.total), JSON.stringify(d2.data));

  // 3. bond 真到账
  const s = await state(UID);
  ok('bond 已累加', (s.data && s.data.state && s.data.state.bond) >= (d1.data && d1.data.added), String(s.data && s.data.state && s.data.state.bond));

  // 4. score 超上限被 clamp
  const d3 = await play(UID, 99999);
  ok('超高分同天幂等', (d3.data && d3.data.added) === 0, String(d3.data && d3.data.added));

  console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + '/' + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})();