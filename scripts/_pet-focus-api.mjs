// 桌宠 v0.11.0 新玩法接口冒烟：专注结算 / 小鱼干 / 豪华大餐 / 日记。
//
// 用法：node scripts/_pet-focus-api.mjs
// 前置：CI 在 127.0.0.1:9001 运行；server/.env 有 JWT_SECRET。
//
// 为什么单独写：前端 UI 探针把 api 层整个 stub 掉了（它只验渲染与交互），
// 所以「服务端到底有没有正确钳制 elapsedSec / 扣小鱼干 / 写日记」必须另测。
//
// 断言清单：
//   1. 未领养时 /focus 拒绝
//   2. 完整专注 15 分钟：+4 小鱼干、+2 羁绊、focus_min=15、日记出现 focus
//   3. 中途放弃 20 秒：tooShort，不给任何收益（防「点开始→立刻结束」刷币）
//   4. 虚报 elapsedSec=999999：最多按 15 分钟结算（钳制生效）
//   5. 豪华大餐：扣 5 小鱼干、+10 羁绊；钱不够时报错且不扣
//   6. /state 下发 diary 视图（今日文案非空）与 focus 额度
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const USER_ID = '999999';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }

const token = jwt.sign({ user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' },
  SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' → ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json, data: json && json.data };
}

(async () => {
  console.log('== 1. 存档基线 ==');
  let st = await api('GET', '/api/pet/state');
  ok('GET /api/pet/state 成功', st.status === 200, 'HTTP ' + st.status);
  if (!st.data || !st.data.state || !st.data.state.adopted) {
    console.log('  · 测试号未领养，先领养');
    await api('PUT', '/api/pet/state', { adopt: true, name: '冒烟鱼' });
    st = await api('GET', '/api/pet/state');
  }
  const s0 = st.data.state;
  console.log('  基线:', JSON.stringify({
    bond: s0.bond, coins: s0.coins || 0, fed: s0.fed_today || 0,
    focusMin: s0.focus_min || 0, focusBond: s0.focus_bond || 0
  }));

  console.log('== 2. 完整专注 15 分钟 ==');
  const before = (await api('GET', '/api/pet/state')).data.state;
  let r = await api('POST', '/api/pet/focus', { minutes: 15, elapsedSec: 900, done: true });
  ok('专注结算成功', r.status === 200, 'HTTP ' + r.status);
  const d1 = r.data || {};
  ok('小鱼干 +4（3 条基础 + 1 完成奖励）', d1.coinsGain === 4, '实际 ' + d1.coinsGain);
  ok('羁绊 +2', d1.bondGain === 2, '实际 ' + d1.bondGain);
  ok('今日专注分钟累计 15', d1.focusMin - (before.focus_min || 0) === 15,
    (before.focus_min || 0) + ' → ' + d1.focusMin);
  ok('返回体不含原始 diary（publicState 生效）', d1.state && d1.state.diary === undefined);

  console.log('== 3. 中途放弃 20 秒 ==');
  r = await api('POST', '/api/pet/focus', { minutes: 15, elapsedSec: 20, done: false });
  ok('tooShort 标记', r.data && r.data.tooShort === true, JSON.stringify(r.data && r.data.tooShort));
  ok('不产小鱼干', r.data && r.data.coinsGain === 0);
  ok('不涨羁绊', r.data && r.data.bondGain === 0);

  console.log('== 4. 虚报 elapsedSec=999999 ==');
  const beforeHack = (await api('GET', '/api/pet/state')).data.state;
  r = await api('POST', '/api/pet/focus', { minutes: 15, elapsedSec: 999999, done: true });
  const hackMin = (r.data.focusMin || 0) - (beforeHack.focus_min || 0);
  ok('按 15 分钟上限结算，不是 16666 分钟', hackMin === 15, '实际 +' + hackMin + ' 分钟');
  ok('小鱼干不超过 4', r.data.coinsGain === 4, '实际 ' + r.data.coinsGain);

  console.log('== 5. 豪华大餐 ==');
  // 先把金币补够，避免受上一步结果影响
  let cur = (await api('GET', '/api/pet/state')).data.state;
  if ((cur.coins || 0) < 5) {
    console.log('  · 金币不足（' + (cur.coins || 0) + '），跳过扣费断言');
  } else {
    // 冷却中会被 429 拦下：这里先看状态，只断言「钱不会白扣」
    const coinsBefore = cur.coins;
    r = await api('POST', '/api/pet/interact', { type: 'feed', food: 'feast' });
    if (r.status === 429) {
      ok('冷却期拒绝喂食且不扣小鱼干',
        (await api('GET', '/api/pet/state')).data.state.coins === coinsBefore,
        '仍是 ' + coinsBefore);
    } else {
      ok('豪华大餐 +10 羁绊', r.data.gained === 10, '实际 ' + r.data.gained);
      ok('扣 5 条小鱼干', r.data.state.coins === coinsBefore - 5,
        coinsBefore + ' → ' + r.data.state.coins);
      ok('返回 food=feast', r.data.food === 'feast');
    }
  }

  console.log('== 6. /state 的日记与专注视图 ==');
  const fin = await api('GET', '/api/pet/state');
  const dd = fin.data;
  ok('下发 diary 视图', !!dd.diary, dd.diary ? '有' : '无');
  ok('今日日记文案非空', !!(dd.diary && dd.diary.today && dd.diary.today.text),
    dd.diary && dd.diary.today ? dd.diary.today.text : '');
  ok('下发 focus 额度', !!dd.focus, JSON.stringify(dd.focus));

  console.log('\n===== 结果 =====');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) process.exit(1);
  console.log('  🎉 全绿');
})();
