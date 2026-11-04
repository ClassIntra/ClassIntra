// Build 系统 v2.0 真后端冒烟：打 /api/pet/battle/build 系列 + environment 系列。
// 与 _pet-battle-http-smoke 同款模式：临时 uid 写探针宠物，跑完删键。
// 用法：node scripts/_pet-build-http-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const REPO = process.cwd();
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

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ✓ ' + label);
  else { failures++; console.log('  ✗ ' + label + (detail ? ' —— ' + detail : '')); }
}

async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
  return { status: res.status, body: j };
}

const today = new Date().toISOString().slice(0, 10);
const seed = {
  adopted: true, name: '冒烟鱼', bond: 200, bond_today: 0, bond_date: today,
  poked_today: 0, fed_today: 0, design: { type: 'video', character: 'dsh-whale' },
  battle_tactic: 'guard', battle_skills: ['heavy'],
  battle_date: '2000-01-01', battle_today: 0,
  battles: { total: 0, win: 0, lose: 0, points: 0 },
  created_at: new Date().toISOString()
};
db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
  'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
  .run(UID, 'desktop_pet', JSON.stringify(seed));
console.log('已写入探针宠物 uid=' + UID + '（bond 200）\n');

try {
  // 1. profile：新字段全到位
  const prof = await call('GET', '/api/pet/battle/profile');
  check('profile 200（注册表修复生效）', prof.status === 200 && prof.body.code === 200, JSON.stringify(prof.body).slice(0, 160));
  const pd = prof.body.data || {};
  check('profile 带 build/environment/inventory/skillCatalog',
    !!(pd.build && pd.environment && pd.inventory && pd.skillCatalog));
  check('新手包自动发放（钝剑+水晶护符+火焰药水×1）',
    pd.inventory.owned.some((x) => x.id === 'blunt_sword') &&
    pd.inventory.owned.some((x) => x.id === 'crystal_amulet') &&
    (pd.inventory.owned.find((x) => x.id === 'flame_potion') || {}).charges === 1,
    JSON.stringify(pd.inventory).slice(0, 200));
  const envId0 = pd.environment.id;
  console.log('  当前环境：', envId0, '·', pd.environment.name, '· Boss', pd.environment.boss.name, 'power', pd.environment.boss.power);

  // 2. build/update：合法配置（只穿拥有的）
  const upd = await call('POST', '/api/pet/battle/build/update', {
    skills: ['blast', 'lifesteal', 'strength', 'sharp', 'finesse'],
    equipment: { weapon: 'blunt_sword', accessory: 'crystal_amulet', consumable: 'flame_potion' },
    strategy_name: '冒烟测试流'
  });
  check('build/update 200', upd.status === 200 && upd.body.code === 200, JSON.stringify(upd.body).slice(0, 160));
  check('update 后评分高于裸装', upd.body.data.build.power_score > pd.combat.power,
    upd.body.data.build.power_score + ' vs ' + pd.combat.power);
  check('未拥有装备被拒（void_blade）',
    (await call('POST', '/api/pet/battle/build/update', { equipment: { weapon: 'void_blade' } })).status === 400);

  // 3. 分享码 roundtrip
  const share = await call('POST', '/api/pet/battle/build/share', {});
  check('share 200 且 9 位格式', share.status === 200 && /^[0-9a-z]{7}-[0-9a-z]$/.test(share.body.data.share_code),
    JSON.stringify(share.body.data));
  const imp = await call('POST', '/api/pet/battle/build/import', { share_code: share.body.data.share_code });
  check('import 自己的码 200', imp.status === 200 && imp.body.data.import_success === true);
  const bad = await call('POST', '/api/pet/battle/build/import', { share_code: 'zzzzzzz-z' });
  check('垃圾码被拒', bad.status === 400);

  // 4. 环境信息 + Boss 战
  const env = await call('GET', '/api/pet/battle/environment');
  check('environment 200 且 id 与 profile 一致', env.status === 200 && env.body.data.id === envId0);
  const boss = await call('POST', '/api/pet/battle/environment/boss', {});
  check('boss 战 200', boss.status === 200 && typeof boss.body.data.win === 'boolean', JSON.stringify(boss.body).slice(0, 200));
  if (boss.body.data.win) {
    check('周首杀掉落奖励装备', boss.body.data.firstKill === true && !!boss.body.data.drop, JSON.stringify(boss.body.data.drop));
  } else {
    console.log('  （Boss 没打过：首杀掉落逻辑由 selftest [7] 覆盖）');
  }
  const boss2 = await call('POST', '/api/pet/battle/environment/boss', {});
  check('Boss 每日一次', boss2.status === 429, 'status=' + boss2.status);

  // 5. 带新技能的实战（blast tag 进战报）
  const fight = await call('POST', '/api/pet/battle/fight', { oppId: 'spar', tactic: 'assault' });
  check('fight 200', fight.status === 200 && fight.body.code === 200, JSON.stringify(fight.body).slice(0, 160));
  const tags = new Set((fight.body.data.steps || []).flatMap((s) => s.tags || []));
  check('爆发冲击进战报（blast tag）', tags.has('blast'), [...tags].join(','));

  // 6. 逗它玩（v0.31.0 接上前端入口，接口本身从 v0.7 就在）
  //    重点验两件事：分数能换羁绊、每日额度封顶 6。
  const play1 = await call('POST', '/api/pet/play', { score: 100 });
  check('play 200', play1.status === 200 && play1.body.code === 200, JSON.stringify(play1.body).slice(0, 160));
  const d1 = (play1.body.data || {});
  check('play 分数换羁绊（100 分 → +6 封顶）', d1.added === 6 && d1.total === 6, 'added=' + d1.added + ' total=' + d1.total + ' cap=' + d1.cap);
  const play2 = await call('POST', '/api/pet/play', { score: 200 });
  const d2 = (play2.body.data || {});
  check('play 当日额度已满不再加', d2.added === 0, 'added=' + d2.added + ' total=' + d2.total);
  const play3 = await call('POST', '/api/pet/play', { score: 'abc' });
  check('play 非法分数按 0 处理（保底 +0，因为已满）', play3.status === 200 && play3.body.data.added === 0, JSON.stringify(play3.body.data).slice(0, 120));

  // v0.32.0 剧情：条件从「一句手写文案」改成结构化 reqs，前端才能显示差多少。
  // 这里守三件事：章节数、条件结构、以及 progress.dex 必须与图鉴接口同源
  // （线上就因为剧情读 dex_count、图鉴读 dex 数组，把全图鉴玩家判成 0 只）。
  const story = await call('GET', '/api/pet/story');
  const sd = (story.body.data || {});
  check('story 200', story.status === 200 && story.body.code === 200, JSON.stringify(story.body).slice(0, 160));
  check('story 下发 6 章', Array.isArray(sd.chapters) && sd.chapters.length === 6, 'chapters=' + (sd.chapters || []).length);
  check('story 每章都有 reqs 数组', (sd.chapters || []).every((c) => Array.isArray(c.reqs)), JSON.stringify((sd.chapters || []).map((c) => c.id)));
  check('story 未解锁章节不泄漏叙述', (sd.chapters || []).every((c) => c.unlocked || !c.narrative),
    JSON.stringify((sd.chapters || []).filter((c) => !c.unlocked && c.narrative).map((c) => c.id)));
  const dexOwned = (prof.body.data && prof.body.data.dex && prof.body.data.dex.ownedCount);
  check('story progress.dex 与图鉴接口一致', sd.progress && sd.progress.dex === dexOwned,
    'story=' + (sd.progress && sd.progress.dex) + ' dex.ownedCount=' + dexOwned);
  const nextReqs = ((sd.next && sd.next.reqs) || []);
  check('story 下一章条件字段完整', sd.next === null || nextReqs.every((r) => r.key && typeof r.need === 'number' && typeof r.have === 'number' && typeof r.ok === 'boolean'),
    JSON.stringify(nextReqs).slice(0, 200));
  // claimedIdx 已被后端钳到不超过 currentIdx，所以这两种表述等价
  check('story canClaim 与 idx/claimed 自洽', sd.canClaim === (sd.currentIdx > sd.claimedIdx),
    'canClaim=' + sd.canClaim + ' idx=' + sd.currentIdx + ' claimedIdx=' + sd.claimedIdx);

  console.log(failures === 0 ? '\n✓ HTTP 冒烟全部通过' : '\n✗ ' + failures + ' 项失败');
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.prepare('DELETE FROM user_kv_store WHERE user_id = ? AND key = ?').run(UID, 'desktop_pet');
  console.log('（探针宠物键已清理）');
}
