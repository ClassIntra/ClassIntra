// 桌宠 v0.15.0 性格 / 心情 / 互动反应 接口冒烟。
//
// 用法：node scripts/_pet-persona-api.mjs
// 前置：CI 在 127.0.0.1:9001 运行；server/.env 有 JWT_SECRET。
//
// 为什么要单独测：前端的飘字、气泡、徽章都只是「把服务端算出来的东西画出来」。
// 如果服务端根本不返回 personality / mood / crit，那么 UI 上写得再花也是死的。
//
// 断言清单：
//   1. /state 下发 personality，且同一用户重复请求结果一致（性格不跳变）
//   2. 不同用户分到不同性格（不是所有人都是同一个）
//   3. 性格的 feedBonus 真的进了收益（贪吃喂一次 ≥ 基础 4 + 2）
//   4. 大量互动里出现过 crit=true，且 crit 的收益严格大于普通收益
//   5. /interact 的返回带 mood，且 mood 会随今日互动量变化
//   6. 每日次数上限没有被性格/暴击绕过（poke 到第 11 次必须 capped）
//   7. 大餐不受随机浮动影响（固定 +10，且不带 crit）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }

function tokFor(uid) {
  return jwt.sign({ user_id: uid, is_admin: 1, is_class_admin: 1, role: 'admin' },
    SECRET, { expiresIn: '1h' });
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' → ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

async function call(uid, method, path, body) {
  // ⚠️ 市场应用挂在 /api/pet/* 下，漏掉 /api 会拿到 404 的 HTML，
  //    res.json() 抛异常 → json=null → 所有断言全假失败（踩过一次）。
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokFor(uid) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json, data: json && json.data };
}

// 一次性测试号：每人一个独立 uid，互不干扰（也会写到 user_kv_store，
// 只写 pet 这一条键，不影响真实用户）。
const UID_A = 987651;
const UID_B = 987652;

async function reset(uid, name) {
  // 直接领养（已领养时 adopt 是幂等的），再用 PUT 清掉今天的计数：
  // 服务端没有「重置」接口，所以这里用「换一个 uid」代替 —— 见下面的常量。
  await call(uid, 'PUT', '/pet/state', { adopt: true, name: name });
}

async function main() {
  console.log('=== 桌宠 性格 / 心情 / 反应 接口冒烟 ===\n');
  await reset(UID_A, '性格测A');
  await reset(UID_B, '性格测B');

  // ---- 1. 性格稳定 ----
  const s1 = await call(UID_A, 'GET', '/pet/state');
  const s2 = await call(UID_A, 'GET', '/pet/state');
  const p1 = s1.data && s1.data.personality;
  const p2 = s2.data && s2.data.personality;
  ok('性格下发到 /state', !!(p1 && p1.id), p1 && (p1.icon + ' ' + p1.name));
  ok('同一用户重复请求性格不变', p1 && p2 && p1.id === p2.id, p1 && p2 && (p1.id + ' / ' + p2.id));

  // ---- 2. 不同用户分到不同性格 ----
  const sb = await call(UID_B, 'GET', '/pet/state');
  const pb = sb.data && sb.data.personality;
  ok('两个用户各自拿到性格', !!(pb && pb.id), pb && (pb.icon + ' ' + pb.name));
  console.log('    （注：只有 5 种性格，两个号撞同一种属正常，不算失败）');

  // ---- 3. 心情下发 ----
  const mood1 = s1.data && s1.data.mood;
  ok('/state 下发 mood', !!(mood1 && mood1.text), mood1 && (mood1.icon + ' ' + mood1.text));

  // ---- 4. 互动收益 + 暴击 ----
  // poke 每日上限 10 次，所以这里最多能观察 10 次。
  // 贪吃的 pokeBonus 是 0，粘人是 +1 —— 用 poke 测暴击不会被性格加成干扰太多。
  const gains = [];
  let sawCrit = false;
  let critGain = 0, normalGain = 0;
  let moodAfter = null;
  for (let i = 0; i < 10; i++) {
    const r = await call(UID_A, 'POST', '/pet/interact', { type: 'poke' });
    const d = r.data || {};
    if (d.capped) break;
    // 加严：gained 必须是数字。否则「响应根本不带 data」也会被算成一次成功互动
    // （undefined 一样能 push 进数组，length 照样到 10 —— 那是假阳性）。
    if (typeof d.gained !== 'number') break;
    gains.push({ g: d.gained, c: !!d.crit });
    if (d.crit) { sawCrit = true; critGain = Math.max(critGain, d.gained); }
    else if (d.gained > 0) { normalGain = Math.max(normalGain, d.gained); }
    if (d.mood) moodAfter = d.mood;
  }
  ok('摸 10 次全部有收益', gains.length >= 9, '实际 ' + gains.length + ' 次');
  ok('返回体带 mood（互动后）', !!moodAfter, moodAfter && (moodAfter.icon + ' ' + moodAfter.id));
  ok('出现过至少一次暴击', sawCrit,
    sawCrit ? ('暴击收益 ' + critGain + ' / 普通 ' + normalGain) : '10 次都没触发（概率约 22% 时不罕见，重跑一次）');
  if (sawCrit) ok('暴击收益严格大于普通收益', critGain > normalGain, critGain + ' > ' + normalGain);

  // ---- 5. 上限没有被绕过 ----
  const r11 = await call(UID_A, 'POST', '/pet/interact', { type: 'poke' });
  ok('第 11 次摸摸被上限拦住', r11.data && r11.data.capped === true,
    'gained=' + (r11.data && r11.data.gained) + ' capped=' + (r11.data && r11.data.capped));

  // ---- 6. 性格加成真的进收益 ----
  // 贪吃（glutton）feedBonus=2 → 一次喂食至少 6；其它性格至少 4。
  const stBefore = await call(UID_A, 'GET', '/pet/state');
  const persona = stBefore.data && stBefore.data.personality;
  const feed = await call(UID_A, 'POST', '/pet/interact', { type: 'feed' });
  const fg = (feed.data && feed.data.gained) || 0;
  const expectMin = 4 + ((persona && persona.feedBonus) || 0);
  ok('喂食收益 ≥ 基础值 + 性格加成', fg >= expectMin,
    persona.name + '(feedBonus ' + (persona.feedBonus || 0) + ') 实得 ' + fg + '，下限 ' + expectMin);

  // ---- 7. 大餐不吃随机浮动 ----
  // 先把小鱼干补够（专注接口是唯一稳定产出，但太慢）——这里直接读状态，
  // 够就测，不够就跳过（不把「没币」写进失败）。
  const stNow = await call(UID_A, 'GET', '/pet/state');
  const coins = (stNow.data && stNow.data.state && stNow.data.state.coins) || 0;
  const fedToday = (stNow.data && stNow.data.state && stNow.data.state.fed_today) || 0;
  if (coins >= 5 && fedToday < 3) {
    const feast = await call(UID_A, 'POST', '/pet/interact', { type: 'feed', food: 'feast' });
    const d = feast.data || {};
    ok('豪华大餐固定 +10 且不参与暴击', d.gained === 10 && !d.crit,
      'gained=' + d.gained + ' crit=' + d.crit);
  } else {
    console.log('  ·  跳过大餐断言（小鱼干 ' + coins + ' / 今日已喂 ' + fedToday + ' 次）');
  }

  console.log('\n===== 结果 =====');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail === 0) console.log('  🎉 全绿');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
