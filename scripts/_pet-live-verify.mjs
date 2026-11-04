// 端到端验证：自签 token → 真库真实 HTTP → 断言新后端（深渊/词缀/小卖部/助战）全部生效。
// 用法：node scripts/_pet-live-verify.mjs [user_id]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server', 'package.json'));
const jwt = require('jsonwebtoken');
const http = require('http');

let SECRET = null;
for (const line of readFileSync(join(REPO, 'server', '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const USER_ID = process.argv[2] || '999999';
const token = jwt.sign({ user_id: USER_ID, is_admin: 0, is_class_admin: 0, role: 'user' }, SECRET, { expiresIn: '1h' });

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9001, path, headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(buf) }); } catch (e) { resolve({ code: res.statusCode, body: buf.slice(0, 200) }); } });
    }).on('error', reject);
  });
}
function post(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data || {});
    const req = http.request({ host: '127.0.0.1', port: 9001, path, method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(buf) }); } catch (e) { resolve({ code: res.statusCode, body: buf.slice(0, 200) }); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? ' —— ' + detail : '')); }
};

console.log('== 真库真 HTTP（user_id=' + USER_ID + '）==');
const st = await get('/api/pet/state');
ok('/pet/state 200', st.code === 200, 'code=' + st.code);
if (st.code !== 200) { console.log('该用户未领养桌宠或 token 无效，换一个 user_id 再试'); process.exit(1); }
ok('小卖部货架下发', !!(st.body.data.shop && st.body.data.shop.items.length === 5));
ok('助战字段下发', 'assistant' in st.body.data);

const bp = await get('/api/pet/battle/profile');
ok('/battle/profile 200', bp.code === 200);
const tower = bp.body.data.tower || {};
ok('塔带今日规则', Array.isArray(tower.dailyMods) && tower.dailyMods.length === 2);
if (tower.abyss) {
  ok('深渊已开（用户已通关）', tower.abyss && typeof tower.abyss.depth === 'number');
  console.log('    深度=' + tower.abyss.depth + ' · 下一层=' + tower.abyss.next.name +
    '（' + tower.abyss.next.typeName + ' · 战力 ' + tower.abyss.next.power + ' · +'+ tower.abyss.gain +' 分）');
  // 真打一场深渊：open → settle
  const a = await post('/api/pet/tower/fight', { mode: 'open' });
  ok('深渊 open 成功', a.code === 200 && a.body.data.fightId, 'code=' + a.code);
  if (a.code === 200) {
    console.log('    战报：第 ' + a.body.data.floor + ' 层 · 对手 ' + a.body.data.foe.name +
      '（' + a.body.data.foe.typeName + '）· 我方战力 ' + a.body.data.me.power + ' vs ' + a.body.data.foe.power);
    const s = await post('/api/pet/tower/fight', { mode: 'settle', fightId: a.body.data.fightId });
    ok('深渊 settle 成功', s.code === 200, 'code=' + s.code + ' ' + (s.body.message || ''));
    if (s.code === 200) {
      console.log('    结果：' + (s.body.data.win ? '通过 ✓' : '没过') + ' · ' + s.body.data.rounds + ' 回合 · +' + s.body.data.gain + ' 分');
      if (s.body.data.abyssFloor !== undefined) ok('返回体带 abyssFloor', true);
    }
  }
} else {
  ok('塔未通关（无深渊属正常）', tower.next !== undefined, 'cleared=' + tower.cleared);
  console.log('    当前塔进度：' + tower.cleared + '/' + tower.total + ' · 今日规则：' +
    (tower.dailyMods || []).map(m => m.name).join(' + '));
}
console.log(fail === 0 ? '\n✓ 线上验证通过：' + pass + ' 项' : '\n✗ ' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
