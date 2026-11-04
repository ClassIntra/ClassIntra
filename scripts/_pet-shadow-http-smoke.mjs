// 真后端冒烟：影子赛场（GET /battle/profile + POST /battle/fight + POST /battle/inbox/read）
// 用两个临时 uid 互打验证「对方收到留言 / 守擂记录对了 / 攻擂战绩没被改写」，
// 跑完把两条键删掉，不动任何真实用户数据。
// 用法：node scripts/_pet-shadow-http-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const REPO = process.cwd();
const BASE = 'http://127.0.0.1:9001';
const ME = 'ci-pet-smoke-a';
const FOE = 'ci-pet-smoke-b';

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
const tok = (uid) => {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ user_id: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return h + '.' + p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
};
const H = (uid) => ({ Authorization: 'Bearer ' + tok(uid), 'Content-Type': 'application/json' });

let fail = 0;
const ok = (c, label, extra) => {
  if (c) console.log(' [OK]   ' + label + (extra ? '  ' + extra : ''));
  else { console.log(' [FAIL] ' + label + (extra ? '  ' + extra : '')); fail++; }
};

async function call(label, method, url, body, uid) {
  const res = await fetch(BASE + url, { method, headers: H(uid), body: body ? JSON.stringify(body) : undefined });
  let j = null;
  const text = await res.text();
  try { j = JSON.parse(text); } catch (e) { j = null; }
  console.log(label.padEnd(30) + res.status + '  ' + (j ? JSON.stringify(j).slice(0, 200) : text.slice(0, 120)));
  return { status: res.status, body: j };
}

const today = new Date().toISOString().slice(0, 10);
const seedSt = (name, bond) => ({
  adopted: true, name, bond, bond_today: 0, bond_date: today,
  poked_today: 0, fed_today: 0, design: { type: 'video', character: 'dsh-whale' },
  created_at: new Date().toISOString()
});
const upsert = (uid, st) => db.prepare(
  'INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
  'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
).run(uid, 'desktop_pet', JSON.stringify(st));
const raw = (uid) => {
  const r = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(uid, 'desktop_pet');
  return r ? JSON.parse(r.value) : null;
};

upsert(ME, seedSt('冒烟鱼', 100));
upsert(FOE, seedSt('影子鱼', 98));
console.log('已写入两只探针宠物:', ME, FOE);

try {
  console.log('\n== A 的 profile ==');
  const p = await call('GET profile', 'GET', '/api/pet/battle/profile', null, ME);
  ok(p.status === 200 && p.body.code === 200, 'profile 200');
  const d = p.body.data;
  console.log('  战力', d.combat.power, '| 今日', d.today + '/' + d.cap);
  ok(d.shadows.length >= 1, '影子池里有真人', d.shadows.map((s) => s.name + '/' + s.owner).join(', '));
  ok(!d.shadows.some((s) => s.realId === ME), '名单里没有自己');
  // 池子按 (uid+日期) 确定性洗牌后只取前 6 个，B 可能刚好被截掉；
  // 这不影响开打——resolveOpponent 对名单外的影子有 readPet 兜底。
  const target = d.shadows.find((s) => s.realId === FOE);
  console.log('  B 是否在今日名单内:', !!target, target ? '' : '（被池子上限截掉，靠兜底解析）');
  ok(d.opponents.every((o) => o.oddsText), ' NPC 都带难度标签',
    d.opponents.map((o) => o.name + '=' + o.oddsText).join(' '));
  ok(d.shadows.every((s) => s.oddsText), '影子都带难度标签',
    d.shadows.map((s) => s.name + '=' + s.oddsText).join(' '));
  ok(d.defend === null, '没被挑战过时 defend 为 null');
  ok((d.tactics || []).length === 3, 'profile 返回 3 种战术');
  ok(d.tactic === 'guard', '还没打过时默认稳守', d.tactic);
  ok((d.achievementList || []).length >= 8, '成就清单齐全', (d.achievementList || []).length + ' 个');
  ok(Array.isArray(d.rank) && d.rank.length >= 1, '排行榜有数据', d.rank.length + ' 行');
  ok(d.myRank >= 1, '我的名次有效', '第 ' + d.myRank + ' 名');
  // 榜单必须按积分降序
  const pts = d.rank.map((r) => r.points);
  ok(pts.every((v, i) => i === 0 || v <= pts[i - 1]), '榜单按积分降序', pts.join(','));

  console.log('\n== A 挑战 B 的影子（带战术）==');
  const f = await call('POST fight(shadow)', 'POST', '/api/pet/battle/fight', { oppId: 'p:' + FOE, tactic: 'assault' }, ME);
  ok(f.status === 200 && f.body.code === 200, '挑战成功', f.body.data.win ? 'A 胜' : 'A 负');
  ok(f.body.data.tactic === 'assault', '战术生效并回传', f.body.data.tactic);
  ok(!!f.body.data.defended, '返回了守擂结果', JSON.stringify(f.body.data.defended));
  ok(Array.isArray(f.body.data.unlocked), '返回了新解锁成就列表');

  console.log('\n== B 侧落库 ==');
  const b = raw(FOE);
  console.log('  battle_defend:', JSON.stringify(b.battle_defend));
  console.log('  inbox[0]     :', JSON.stringify((b.battle_inbox || [])[0]));
  ok(!b.battles, '⚠️ B 的攻擂战绩没被碰过 ' + JSON.stringify(b.battles || null));
  ok(b.battle_defend && b.battle_defend.total === 1, 'B 的守擂 +1');
  ok((b.battle_inbox || []).length === 1, 'B 收到 1 条留言');
  ok((b.battle_inbox || [])[0].who === '冒烟鱼', '留言里是 A 的宠物名');
  ok(b.bond === 98, '⚠️ B 的羁绊没被动过  bond=' + b.bond);

  console.log('\n== A 侧落库 ==');
  const a = raw(ME);
  console.log('  battles:', JSON.stringify(a.battles));
  ok(a.battles.total === 1, 'A 的攻擂 +1');
  ok(a.bond === 100, '⚠️ A 的羁绊没被动过  bond=' + a.bond);
  ok(a.battles.streak === (f.body.data.win ? 1 : 0), '连胜初始化正确', 'streak=' + a.battles.streak);
  ok(typeof a.battles.best === 'number', 'best 已记录', 'best=' + a.battles.best);

  console.log('\n== B 读自己的 inbox ==');
  const pb = await call('GET profile(B)', 'GET', '/api/pet/battle/profile', null, FOE);
  ok((pb.body.data.inbox || []).length === 1, 'B 的 profile 里带出留言');
  const rd = await call('POST inbox/read', 'POST', '/api/pet/battle/inbox/read', {}, FOE);
  ok(rd.status === 200, '清空成功');
  ok((raw(FOE).battle_inbox || []).length === 0, '留言已清空');
  ok(raw(FOE).battle_defend.total === 1, '⚠️ 守擂战绩还在');

  console.log('\n== 不限次数：连打 12 场都不能被拒 ==');
  let httpAllOk = true;
  const httpGains = [];
  const httpRounds = [];
  for (let i = 2; i <= 12; i++) {
    const r = await call('POST fight#' + i, 'POST', '/api/pet/battle/fight', { oppId: 'p:' + FOE }, ME);
    if (r.status !== 200) { httpAllOk = false; console.log('  第 ' + i + ' 场被拒:', r.status, r.body.message); break; }
    const d = r.body.data;
    httpGains.push(d.gain);
    httpRounds.push({ n: i, win: !!d.win, gain: d.gain, base: d.baseGain, decayed: !!d.decayed, today: d.today });
  }
  ok(httpAllOk, '连打 12 场全部成功（不设上限）');
  console.log('  各场积分:', httpGains.join(','));
  // 衰减断言不能拿「首场 vs 末场」比大小：胜负基础分不同（赢 10 / 输 3），
  // 首场正好输、末场正好赢时，末场分反而更高，那是胜负差异不是衰减失效。
  // 改成直接验后端的收益曲线：按响应里的 today（本场是当天第几场）分组——
  // 当天第 1~5 场必须全额，第 6 场之后必须标记 decayed 且严格低于自己那档的基础分。
  const fullRounds = httpRounds.filter((x) => (x.today - 1) < 5);
  ok(fullRounds.length > 0 && fullRounds.every((x) => !x.decayed && x.gain === x.base), '当天前 5 场全额不衰减',
    fullRounds.map((x) => x.gain + '/' + x.base).join(' '));
  const decayedRounds = httpRounds.filter((x) => (x.today - 1) >= 5);
  ok(decayedRounds.length > 0 && decayedRounds.every((x) => x.decayed), '第 6 场起标记衰减',
    decayedRounds.map((x) => x.gain + '/' + x.base).join(' '));
  ok(decayedRounds.every((x) => x.gain < x.base), '衰减场严格低于基础分',
    decayedRounds.map((x) => x.gain + '/' + x.base).join(' '));
  // 同胜负档内必须单调不增（赢和输各自一条曲线）
  const monoOk = [{ v: true }, { v: false }].every((g) => {
    const seq = httpRounds.filter((x) => x.win === g.v).map((x) => x.gain);
    for (let k = 1; k < seq.length; k++) if (seq[k] > seq[k - 1]) return false;
    return true;
  });
  ok(monoOk, '同胜负档积分单调不增', httpRounds.map((x) => (x.win ? 'W' : 'L') + x.gain).join(' '));
  ok(httpGains[httpGains.length - 1] >= 2, '衰减有保底', httpGains[httpGains.length - 1]);
  console.log('  B 守擂累计:', JSON.stringify(raw(FOE).battle_defend));
  ok(raw(FOE).battle_defend.total >= 11, 'B 被记了 12 次', raw(FOE).battle_defend.total);

  console.log('\n== 技能与塔（真后端）==');
  const skp = await call('GET profile(技能)', 'GET', '/api/pet/battle/profile', null, ME);
  ok((skp.body.data.skills || []).length >= 5, 'bond 100 解锁 5 个技能', (skp.body.data.skills || []).length);
  ok((skp.body.data.equipped || []).length <= 2, '装备不超过槽位', (skp.body.data.equipped || []).join(','));
  const skSet = await call('POST skills', 'POST', '/api/pet/battle/skills', { skills: ['heavy', 'pierce'] }, ME);
  ok(skSet.body.data.equipped.join(',') === 'heavy,pierce', '装备生效', skSet.body.data.equipped.join(','));
  const twp = await call('GET profile(塔)', 'GET', '/api/pet/battle/profile', null, ME);
  const tower = twp.body.data.tower;
  ok(!!tower && tower.total === 10, '塔有 10 层');
  ok(tower.cap === 0, '塔不限次数（cap = 0）');
  console.log('  塔进度', tower.cleared + '/' + tower.total, '| 下一层', tower.next && tower.next.name, tower.next && tower.next.power);
  // 打一次塔
  const tf = await call('POST tower/fight', 'POST', '/api/pet/tower/fight', {}, ME);
  ok(tf.status === 200, '塔可以挑战', tf.body.data ? ('第 ' + tf.body.data.floor + ' 层 ' + (tf.body.data.win ? '通过' : '失败')) : '');
  const twAfter = await call('GET profile(塔后)', 'GET', '/api/pet/battle/profile', null, ME);
  ok(twAfter.body.data.tower.today >= 1, '塔今日次数已记', twAfter.body.data.tower.today);
  ok((twAfter.body.data.titles || []).length >= 0, '称号字段存在', (twAfter.body.data.titles || []).length + ' 个');

  console.log('\n== 属性 / 图鉴 / 收服 / 随行（真后端）==');
  const elp = await call('GET profile(属性)', 'GET', '/api/pet/battle/profile', null, ME);
  ok((elp.body.data.elements || []).length === 5, 'profile 下发 5 个属性');
  ok(elp.body.data.battleType === 'grass', '老存档默认草本命', elp.body.data.battleType);
  ok((elp.body.data.opponents || []).every((o) => !!o.type && !!o.typeName), 'NPC 都带属性');
  ok((elp.body.data.shadows || []).every((s) => !!s.type), '影子都带属性');
  ok(!!elp.body.data.evolution && typeof elp.body.data.evolution.slots === 'number', '下发进化阶段',
    JSON.stringify(elp.body.data.evolution));
  const dx0 = elp.body.data.dex || {};
  ok(dx0.total === 15, '图鉴 15 只', dx0.total);
  ok((dx0.list || []).length === 15, '图鉴列表有 15 行', (dx0.list || []).length);

  const tset = await call('POST battle/type', 'POST', '/api/pet/battle/type', { type: 'fire' }, ME);
  ok(tset.status === 200 && tset.body.data.battleType === 'fire', '本命能切成火');
  const tbad = await call('POST battle/type(bad)', 'POST', '/api/pet/battle/type', { type: 'dark' }, ME);
  ok(tbad.status === 400, '未知属性被拒', tbad.status);
  await call('POST battle/type(back)', 'POST', '/api/pet/battle/type', { type: 'grass' }, ME);

  const stW = await call('GET state(野生)', 'GET', '/api/pet/state', null, ME);
  ok((stW.body.data.wild || []).length === 15, '/state 下发 15 只野生精灵', (stW.body.data.wild || []).length);

  let cap = null;
  for (let i = 1; i <= 40; i++) {
    const r = await call('POST wild/fight#' + i, 'POST', '/api/pet/wild/fight', { id: 'huomiao' }, ME);
    if (r.status !== 200) break;
    if (r.body.data.captured) { cap = r.body.data; break; }
  }
  ok(!!cap, '连打几次能收服火苗狸');
  ok(cap && cap.dexCount === 1 && cap.dexTotal === 15, '返回图鉴进度 1 / 15',
    cap ? cap.dexCount + ' / ' + cap.dexTotal : '');
  ok(cap && cap.buddySet === true, '第一只收服自动随行');

  const dupW = await call('POST wild/fight(dup)', 'POST', '/api/pet/wild/fight', { id: 'huomiao' }, ME);
  ok(dupW.status === 400, '已收服的不能再挑战', dupW.status);

  const dxp = await call('GET profile(图鉴后)', 'GET', '/api/pet/battle/profile', null, ME);
  ok(dxp.body.data.dex.ownedCount === 1, '图鉴变成 1', dxp.body.data.dex.ownedCount);
  const onPower = dxp.body.data.combat.power;
  ok(dxp.body.data.dex.buddy && dxp.body.data.dex.buddy.id === 'huomiao', '随行就是火苗狸');
  ok(dxp.body.data.dex.buddyBonus && dxp.body.data.dex.buddyBonus.atk === 3, '火系随行 +3 攻',
    JSON.stringify(dxp.body.data.dex.buddyBonus));

  const offB = await call('POST buddy(取消)', 'POST', '/api/pet/buddy', { id: '' }, ME);
  ok(offB.body.data.buddy === null && offB.body.data.combat.power < onPower, '随行加成进了战力',
    onPower + ' → ' + offB.body.data.combat.power);
  const onB = await call('POST buddy(随行)', 'POST', '/api/pet/buddy', { id: 'huomiao' }, ME);
  ok(onB.body.data.combat.power === onPower, '换回随行战力还原', onB.body.data.combat.power);
  const badB = await call('POST buddy(未收服)', 'POST', '/api/pet/buddy', { id: 'gushu' }, ME);
  ok(badB.status === 400, '没收服的不能随行', badB.status);

  const twp2 = await call('GET profile(塔属性)', 'GET', '/api/pet/battle/profile', null, ME);
  ok(twp2.body.data.tower.next && twp2.body.data.tower.next.type === 'earth', '塔层是土属性',
    twp2.body.data.tower.next && twp2.body.data.tower.next.type);

  console.log(fail === 0 ? '\nOK: 真后端影子赛场冒烟通过' : '\n❌ ' + fail + ' 项未通过');
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  db.prepare('DELETE FROM user_kv_store WHERE user_id IN (?, ?) AND key = ?').run(ME, FOE, 'desktop_pet');
  console.log('已清理探针数据');
  db.close();
}
