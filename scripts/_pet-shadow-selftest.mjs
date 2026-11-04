// 影子赛场自测：在内存假库 + 假 Router 上直跑 routes.js 的 handler。
// 覆盖四点：① 影子池能挑出真同学；② 打影子不改写对方攻擂战绩；
//          ③ inbox / 守擂记录落对；④ 自己不会出现在自己的名单里。
// 用法：node scripts/_pet-shadow-selftest.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server/package.json'));

const ROUTES = {};
const pick = (args) => args[args.length - 1];
const fakeRouter = {
  get: (...a) => { ROUTES['GET ' + a[0]] = pick(a); },
  post: (...a) => { ROUTES['POST ' + a[0]] = pick(a); },
  put: (...a) => { ROUTES['PUT ' + a[0]] = pick(a); }
};

const KV = new Map();                       // `${uid}|${key}` -> JSON 串
const USERS = {                             // user_id -> net_name（假 users 表）
  '251801': '今安在', '251802': '桥本环奈', '251803': '老张', '251804': '李四', '251805': '王五'
};
const KV_KEY = 'desktop_pet';

const fakeDb = {
  prepare(sql) {
    const SELECT = /^\s*SELECT/i.test(sql);
    if (SELECT) {
      if (/FROM users/.test(sql)) {
        return {
          all: (...uids) => uids
            .map((u) => (USERS[String(u)] ? { user_id: String(u), net_name: USERS[String(u)] } : null))
            .filter(Boolean)
        };
      }
      if (/WHERE key = \?/.test(sql)) {
        // 全表扫形态：SELECT user_id, value FROM user_kv_store WHERE key = ?
        const keyPos = -1;
        return {
          all: (...args) => {
            const out = [];
            for (const [k, v] of KV) {
              const [u, kk] = k.split('|');
              if (kk === args[keyPos < 0 ? 0 : keyPos]) out.push({ user_id: u, value: v });
            }
            return out;
          },
          get: (uid, key) => { const v = KV.get(uid + '|' + key); return v === undefined ? undefined : { value: v }; }
        };
      }
      return { get: (uid, key) => { const v = KV.get(uid + '|' + key); return v === undefined ? undefined : { value: v }; } };
    }
    return { run: (uid, key, value) => { KV.set(uid + '|' + key, value); return { changes: 1 }; } };
  }
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'express') return { Router: () => fakeRouter };
  if (/middleware[\\/]auth$/.test(request)) return { requireAuth: (req, res, next) => next() };
  if (/utils[\\/]db$/.test(request)) return fakeDb;
  return origLoad.apply(this, arguments);
};

require(join(REPO, '..', 'market', 'apps', 'pet', 'backend', 'routes.js'));
console.log('路由:', Object.keys(ROUTES).sort().join('  '));

let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log(' [OK]   ' + label + (extra ? '  ' + extra : ''));
  else { console.log(' [FAIL] ' + label + (extra ? '  ' + extra : '')); fail++; }
};

function call(key, body, uid) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(p) { resolve({ http: this.code, body: p }); }
    };
    ROUTES[key]({ user: { user_id: uid }, body: body || {} }, res, () => {});
  });
}
const put = (uid, st) => KV.set(uid + '|' + KV_KEY, JSON.stringify(st));
const get = (uid) => JSON.parse(KV.get(uid + '|' + KV_KEY) || '{}');
const pad = (s, n) => String(s).padEnd(n);

const ME = '251800';
put(ME, { adopted: true, name: '欧鲸鲸', bond: 100, design: { type: 'video', character: 'dsh-whale' } });
put('251801', { adopted: true, name: 'DD', bond: 95 });
put('251802', { adopted: true, name: '鱼', bond: 102 });
put('251803', { adopted: true, name: '波刚', bond: 40 });     // 羁绊差太多，应被 ±30% 过滤掉
put('251804', { adopted: true, name: '李四宠', bond: 140 });  // 超出 1.3 倍，同上
put('251805', { adopted: false, name: '影子本来交响曲', bond: 90 }); // 未领养，不该出现

console.log('\n== profile：对手名单 ==');
const prof = await call('GET /battle/profile', null, ME);
const d = prof.body.data;
const ids = (d.shadows || []).map((s) => s.realId);
console.log(d.shadows.map((s) => '  ' + s.name + '(' + s.owner + ') bond=' + s.bond + ' power=' + s.power).join('\n'));
ok(d.shadows.length === 2, '影子池只剩 ±30% 区间内的 2 人', '实为 ' + d.shadows.length);
ok(!(d.shadows || []).some((s) => s.realId === ME), '名单里没有自己');
ok(d.shadows.every((s) => s.owner), '每条影子都带上了主人的昵称');
ok(d.opponents.length === 3, 'NPC 三档仍在');
ok(d.opponents.every((o) => o.oddsText && o.odds), '每个 NPC 都带了难度标签',
  d.opponents.map((o) => o.name + '=' + o.oddsText).join(' '));
ok(d.opponents.every((o) => o.kind === 'npc'), 'NPC 被标记为 npc');
ok(d.shadows.every((s) => s.oddsText && s.kind === 'shadow'), '每条影子也带难度标签',
  d.shadows.map((s) => s.name + '=' + s.oddsText).join(' '));
ok(d.defend === null, '没被挑战过时 defend 为 null');

console.log('\n== 打一场真人影子 ==');
const shadowId = 'p:251801';
const before = await call('GET /battle/profile', null, ME);
ok(before.body.data.today === 0, '开打前今日场次为 0');
const f = await call('POST /battle/fight', { oppId: shadowId }, ME);
ok(f.body.code === 200, '挑战成功', 'win=' + f.body.data.win + ' 回合=' + f.body.data.rounds);
ok(f.body.data.steps.length > 0, '拿到逐回合战报', f.body.data.steps.length + ' 步');
console.log('  对手:', JSON.stringify({ name: f.body.data.opp.name, owner: f.body.data.opp.owner, power: f.body.data.opp.power }));
console.log('  结算:', JSON.stringify(f.body.data.defended));
ok(f.body.data.opp.kind === 'shadow', '对手被标记为 shadow');
ok(f.body.data.opp.owner === '今安在', '对手带出了主人的真名');
ok(f.body.data.defended && typeof f.body.data.defended.held === 'boolean', '返回了守擂结果');

console.log('\n== 对方（251801）的存档 ==');
const theirs = get('251801');
console.log('  battle_defend:', JSON.stringify(theirs.battle_defend));
console.log('  inbox[0]:', JSON.stringify((theirs.battle_inbox || [])[0]));
ok(!theirs.battles, '⚠️ 对方的攻擂战绩完全没被碰过 ' + JSON.stringify(theirs.battles || null));
ok(theirs.battle_defend && theirs.battle_defend.total === 1, '守擂记录 +1');
const expectHeld = !f.body.data.win;
ok(theirs.battle_defend.held === (expectHeld ? 1 : 0), '守擂/失守方向正确', 'held=' + expectHeld);
ok((theirs.battle_inbox || []).length === 1, '收到一条挑战留言');
const msg = (theirs.battle_inbox || [])[0];
ok(msg.who === '欧鲸鲸', '留言写的是挑战者的宠物名', msg.who);
ok(msg.whoOwner === '', '挑战者本人不在假 users 表里，昵称留空');
ok(msg.held === expectHeld, '留言里的胜负与被挑战方视角一致');

console.log('\n== 我自己（251800）的存档 ==');
const mine = get(ME);
console.log('  battles:', JSON.stringify(mine.battles));
ok(mine.battles.total === 1, '我的攻擂场次 +1');
ok(mine.battle_today === 1, '今日场次 +1');
ok(mine.bond === 100, '⚠️ 羁绊没被对战碰过  bond=' + mine.bond);
ok(mine.battles.streak === (f.body.data.win ? 1 : 0), '连胜随胜负初始化正确',
  'streak=' + mine.battles.streak + ' win=' + f.body.data.win);
ok(typeof mine.battles.best === 'number', '记录了最好连胜 best=' + mine.battles.best);

// 次数不限：连打 12 场都必须成功（不该出现 429）
const MANY = 12;
console.log('\n== 不限次数：连打 ' + MANY + ' 场都不能被拒 ==');
let allOk = true;
for (let i = 2; i <= MANY; i++) {
  const r = await call('POST /battle/fight', { oppId: shadowId }, ME);
  if (r.http !== 200) { allOk = false; console.log('  第 ' + i + ' 场被拒:', r.http, r.body.message); break; }
}
ok(allOk, '连打 ' + MANY + ' 场全部成功（不设上限）');
ok(get(ME).battle_today === MANY, '今日场次如实累计', get(ME).battle_today);
console.log('  对方守擂累计:', JSON.stringify(get('251801').battle_defend));
console.log('  对方 inbox 条数:', (get('251801').battle_inbox || []).length, '(上限 20)');

console.log('\n== 积分随场次衰减（不限次数但不会刷出无限分）==');
// ⚠️ battle_date 必须是「今天」：路由开头有 `if (st.battle_date !== today) 归零`，
//    用 2000-01-01 会让 battle_today 被重置成 0，衰减永远测不出来。
const todayKey = new Date().toISOString().slice(0, 10);
const gainOf = [];
for (let i = 0; i < 3; i++) {
  const gamesToday = i === 0 ? 0 : (i === 1 ? 5 : 15);
  put(ME, Object.assign(get(ME), {
    battle_date: todayKey, battle_today: gamesToday,
    battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
  }));
  const r = await call('POST /battle/fight', { oppId: 'rival', skills: [] }, ME);
  gainOf.push({ start: gamesToday + 1, gain: r.body.data.gain, decayed: r.body.data.decayed });
}
console.log('  ' + gainOf.map((g) => '第' + g.start + '场 +' + g.gain + (g.decayed ? '(衰减)' : '')).join('  '));
ok(gainOf[0].gain >= gainOf[1].gain && gainOf[1].gain >= gainOf[2].gain, '积分随场次单调不增',
  gainOf.map((g) => g.gain).join(' > '));
ok(gainOf[0].decayed === false, '前 5 场不衰减');
ok(gainOf[2].gain >= 2, '衰减有保底，不会归零', gainOf[2].gain);

console.log('\n== 清空留言 ==');
const rd = await call('POST /battle/inbox/read', null, '251801');
ok(rd.body.code === 200, 'inbox/read 成功');
ok((get('251801').battle_inbox || []).length === 0, '留言已清空');
ok(get('251801').battle_defend.total >= MANY - 1, '⚠️ 清留言不该清掉守擂战绩', JSON.stringify(get('251801').battle_defend));

console.log('\n== 连胜连败切换 ==');
// 上一段已经把今日 5 场打满，这里先重置当天次数（只改日期标记，不动战绩）
const meReset = get(ME);
meReset.battle_date = '2000-01-01'; meReset.battle_today = 0;
meReset.battles = { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 };
put(ME, meReset);
const streakLog = [];
for (let i = 0; i < 5; i++) {
  const r = await call('POST /battle/fight', { oppId: 'rival' }, ME);
  if (r.http !== 200) break;
  streakLog.push((r.body.data.win ? '胜' : '负') + '→' + r.body.data.record.streak);
}
console.log('  ' + streakLog.join('  '));
const after5 = get(ME).battles;
let expectRun = 0, expectBest = 0;
for (const tag of streakLog) {
  if (tag[0] === '胜') { expectRun++; if (expectRun > expectBest) expectBest = expectRun; }
  else expectRun = 0;
}
ok(after5.streak === expectRun, 'streak 与逐步推算一致', '实际 ' + after5.streak + ' 期望 ' + expectRun);
ok(after5.best === expectBest, 'best 与逐步推算一致', '实际 ' + after5.best + ' 期望 ' + expectBest);
ok(after5.streak === 0 || streakLog[streakLog.length - 1].indexOf('胜') === 0, '末场若负则 streak 必须归零',
  '末场 ' + streakLog[streakLog.length - 1]);

console.log('\n== 新手兜底：自己 bond=8 时不能撞上 140 的宠物 ==');
put('251900', { adopted: true, name: '刚出生', bond: 8 });
const np = await call('GET /battle/profile', null, '251900');
const near = np.body.data.shadows;
console.log('  ' + near.map((s) => s.name + '(bond=' + s.bond + ',' + s.oddsText + ')').join(' '));
ok(near.length > 0, '新手也排得到人（不是空列表）', near.length + ' 个');
// 这份假数据里最接近的宠物是 bond 40（差 32），所以不能断言「差距必须很小」，
// 该断言的是「按距离由近到远给」——真库里有 25 只，这条才决定新手看到谁。
const dists = near.map((s) => Math.abs(s.bond - 8));
ok(dists.every((v, i) => i === 0 || v >= dists[i - 1]), '按羁绊距离由近到远排序', dists.join(','));
ok(!near.some((s) => s.bond > 60), '新手不会直接对上高羁绊宠物',
  near.map((s) => s.bond).join(','));
const myP = np.body.data.combat.power;
const worst = near.length ? Math.max.apply(null, near.map((s) => Math.max(s.power, myP) / Math.min(s.power, myP))) : 0;
ok(worst <= 2.0, '兜底路径的战力差也不超过 2 倍', '最坏 ' + worst.toFixed(2) + ' 倍');

console.log('\n== 战术：同一场换战术，seed 不变但结果可能变 ==');
// seed 不带战术，所以同一天同一场次、同一对手，三种战术拿到的是同一串随机数。
// 这里验证：① 属性真的变了；② 至少有一种战术能赢（否则战术就是摆设）。
put(ME, Object.assign(get(ME), {
  battle_date: '2000-01-01', battle_today: 0,
  battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
}));
const tactRes = {};
for (const t of ['assault', 'guard', 'nimble']) {
  put(ME, Object.assign(get(ME), {
    battle_date: '2000-01-01', battle_today: 0,
    battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
  }));
  const r = await call('POST /battle/fight', { oppId: 'rival', tactic: t, skills: [] }, ME);
  tactRes[t] = r.body.data;
  console.log('  ' + pad(t, 8) + (r.body.data.win ? '胜' : '负') +
    ' 回合' + pad(r.body.data.rounds, 3) +
    ' 我方atk=' + pad(r.body.data.me.atk, 3) +
    'def=' + pad(r.body.data.me.def, 3) +
    'spd=' + pad(r.body.data.me.spd, 3) +
    'crit=' + pad(r.body.data.me.crit, 3) +
    ' seed=' + r.body.data.seed);
}
const seeds = Object.values(tactRes).map((d) => d.seed);
ok(new Set(seeds).size === 1, '⚠️ 三种战术的 seed 完全相同（可比性）', seeds.join(','));
ok(tactRes.assault.me.atk !== tactRes.guard.me.atk, '猛攻与稳守的攻击力不同',
  tactRes.assault.me.atk + ' vs ' + tactRes.guard.me.atk);
ok(tactRes.guard.me.def > tactRes.assault.me.def, '稳守的防御高于猛攻',
  tactRes.guard.me.def + ' vs ' + tactRes.assault.me.def);
ok(tactRes.nimble.me.spd > tactRes.guard.me.spd, '灵巧的速度更高',
  tactRes.nimble.me.spd + ' vs ' + tactRes.guard.me.spd);
ok(tactRes.nimble.me.crit > tactRes.guard.me.crit, '灵巧的暴击更高',
  tactRes.nimble.me.crit + ' vs ' + tactRes.guard.me.crit);
ok(Object.values(tactRes).some((d) => d.win), '至少有一种战术能赢');
ok(Object.values(tactRes).some((d) => !d.win), '也不是换哪个都赢（战术有代价）');

console.log('\n== 战术偏好会记住 ==');
const memo = await call('GET /battle/profile', null, ME);
ok(memo.body.data.tactic === 'nimble', '最后一次选的战术被记住', memo.body.data.tactic);
ok((memo.body.data.tactics || []).length === 3, 'profile 返回 3 种战术');

console.log('\n== 技能：解锁 / 装备 / 生效 ==');
const skProf = await call('GET /battle/profile', null, ME);
const skAll = skProf.body.data.skills || [];
const skEq0 = skProf.body.data.equipped || [];
console.log('  已解锁:', skAll.map((s) => s.name + '(tier' + s.tier + ')').join(' '));
console.log('  默认装备:', skEq0.join(','));
ok(skAll.length >= 3, 'bond 100 至少解锁 3 个技能', skAll.length + ' 个');
ok(skEq0.length <= 2, '默认装备不超过 2 个（有槽位限制）', skEq0.length + ' 个');
// 装备两个指定技能
const eqRes = await call('POST /battle/skills', { skills: ['heavy', 'shield'] }, ME);
ok(eqRes.body.code === 200, '装备接口成功');
ok(eqRes.body.data.equipped.length === 2, '装备了 2 个', eqRes.body.data.equipped.join(','));
// 超过槽位要截断
const eq3 = await call('POST /battle/skills', { skills: ['heavy', 'shield', 'combo', 'pierce'] }, ME);
ok(eq3.body.data.equipped.length <= 2, '超过槽位自动截断', eq3.body.data.equipped.join(','));
// 未解锁的技能不能装（bond 100 时 pierce 的 tier 是 1，应该已解锁；用一个不存在的 id）
const eqBad = await call('POST /battle/skills', { skills: ['nonexistent'] }, ME);
ok(eqBad.body.code === 200 && eqBad.body.data.equipped.indexOf('nonexistent') < 0,
  '不存在的技能被剔除', JSON.stringify(eqBad.body.data.equipped));
// 空数组 = 真的不带技能（不能自动补满）
const eqEmpty = await call('POST /battle/skills', { skills: [] }, ME);
ok(eqEmpty.body.data.equipped.length === 0, '⚠️ 设成空数组就是真的不带技能', JSON.stringify(eqEmpty.body.data.equipped));

console.log('\n== 技能的数值真的生效 ==');
// 同一场、同一战术、同一 seed，带与不带技能的结果/回合应该不同
async function fightOnce(skills) {
  put(ME, Object.assign(get(ME), {
    battle_date: '2000-01-01', battle_today: 0,
    battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
  }));
  const r = await call('POST /battle/fight', { oppId: 'boss', tactic: 'guard', skills }, ME);
  return r.body.data;
}
const noSk = await fightOnce([]);
const withHeavy = await fightOnce(['heavy']);
ok(noSk.seed === withHeavy.seed, '⚠️ 带不带技能 seed 相同（可比）', noSk.seed);
const hasHeavyTag = withHeavy.steps.some((s) => (s.tags || []).indexOf('heavy') >= 0);
ok(hasHeavyTag, '战报里出现「千钧一击」标记');
ok(withHeavy.me.hp === noSk.me.hp, '技能不改血量上限（只改过程）');
const dmgNo = noSk.steps.reduce((s, x) => s + (x.dmg || 0), 0);
const dmgHeavy = withHeavy.steps.reduce((s, x) => s + (x.dmg || 0), 0);
console.log('  总伤害 不带=' + dmgNo + ' 带千钧=' + dmgHeavy);
ok(dmgHeavy !== dmgNo, '千钧一击改变了总伤害');

console.log('\n== 试炼塔 ==');
put(ME, Object.assign(get(ME), {
  tower_floor: 0, tower_today: 0, tower_date: '2000-01-01', tower_tries: {},
  bond: 100
}));
const twProf = await call('GET /battle/profile', null, ME);
const tw = twProf.body.data.tower;
ok(!!tw, 'profile 带出塔信息');
ok(tw.total === 10, '塔共 10 层', tw.total);
ok(tw.cleared === 0, '初始 0 层');
ok(tw.next && tw.next.f === 1, '下一层是第 1 层');
ok(tw.cap === 0, '塔不限次数（cap = 0）', tw.cap);
ok(tw.left === -1, 'left = -1 表示不限', tw.left);
ok(tw.floors.length === 10 && tw.floors[0].name, '10 层都有名字');

// 不限次数：连打 5 次都不能出现 429
let twAllOk = true;
for (let i = 1; i <= 5; i++) {
  const r = await call('POST /tower/fight', {}, ME);
  if (r.http !== 200) { twAllOk = false; console.log('  第 ' + i + ' 次被拒:', r.http, r.body.message); break; }
}
ok(twAllOk, '连打 5 次塔都不被拒（不限次数）');
const twAfter = await call('GET /battle/profile', null, ME);
ok(twAfter.body.data.tower.today >= 1, '今日次数如实记录', twAfter.body.data.tower.today);

// 通关一层后，tower_floor 要推进，且奖励进塔积分（不动练习赛积分）
put(ME, Object.assign(get(ME), {
  tower_floor: 0, tower_today: 0, tower_date: '2000-01-01', tower_tries: {},
  bond: 200,   // 高羁绊保证能过第 1 层
  battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
  tower_points: 0
}));
const twFight = await call('POST /tower/fight', {}, ME);
ok(twFight.body.data.win, '高羁绊能过第 1 层');
ok(twFight.body.data.cleared === true, '返回 cleared=true');
ok(twFight.body.data.towerFloor === 1, '层数推进到 1');
ok(twFight.body.data.towerPoints === 25, '塔积分 +25', twFight.body.data.towerPoints);
const meAfterTw = get(ME);
ok((meAfterTw.battles || {}).points === 0, '⚠️ 爬塔不动练习赛积分', JSON.stringify(meAfterTw.battles));

// 已通关的层不能重打（只能打下一层）
const twAgain = await call('POST /tower/fight', {}, ME);
if (twAgain.http === 200) {
  ok(twAgain.body.data.floor === 2, '再打是第 2 层，不是回头刷第 1 层', 'floor=' + twAgain.body.data.floor);
}

console.log('\n== 称号（由存档推导）==');
put(ME, Object.assign(get(ME), {
  tower_floor: 10, tower_best: 10,
  battles: { total: 20, win: 15, lose: 5, points: 150, streak: 0, best: 6 },
  battle_defend: { total: 8, held: 6, broken: 2, points: 48 }
}));
const tiProf = await call('GET /battle/profile', null, ME);
const titles = (tiProf.body.data.titles || []).map((t) => t.id);
console.log('  ' + (tiProf.body.data.titles || []).map((t) => t.name).join(' / '));
ok(titles.indexOf('champion') >= 0, '通关 10 层 → 塔顶传说');
ok(titles.indexOf('unstoppable') >= 0, '6 连胜 → 势不可挡');
ok(titles.indexOf('warden') >= 0, '守住 6 次 → 守擂人');
ok(titles.indexOf('century') >= 0, '150 分 → 百分战力');
ok(titles.indexOf('veteran') >= 0, '10 层 → 老练斗士');
// 称号不落库，改数值后自动对
put(ME, Object.assign(get(ME), { tower_floor: 0 }));
const tiZero = await call('GET /battle/profile', null, ME);
ok((tiZero.body.data.titles || []).map((t) => t.id).indexOf('champion') < 0,
  '⚠️ 回到 0 层后称号自动消失（不落库，无法造假）');

console.log('\n== 系别系统（v0.8.0）==');
put(ME, Object.assign(get(ME), {
  bond: 82, battle_type: undefined, battle_skills: [],
  battle_date: '2000-01-01', battle_today: 0
}));
const elProf = await call('GET /battle/profile', null, ME);
ok(Array.isArray(elProf.body.data.elements) && elProf.body.data.elements.length === 5,
  'profile 下发 5 个属性', (elProf.body.data.elements || []).length);
ok(elProf.body.data.battleType === 'grass', '老存档默认草本命', elProf.body.data.battleType);
ok(elProf.body.data.typeInfo && elProf.body.data.typeInfo.name === '草', '本命说明对得上');
const oppEl = {};
for (const o of elProf.body.data.opponents) oppEl[o.id] = o;
ok(oppEl.spar.type === 'grass' && oppEl.spar.typeMul === 1, '草打草中性', oppEl.spar.typeMul);
ok(oppEl.rival.type === 'water' && oppEl.rival.typeMul === 1, '草打水中性（不给旧平衡加戏）', oppEl.rival.typeMul);
ok(oppEl.boss.type === 'electric' && oppEl.boss.typeMul === 1, '草打电中性', oppEl.boss.typeMul);
ok((elProf.body.data.opponents || []).every((o) => !!o.typeName), '对手带属性名');
ok((elProf.body.data.shadows || []).every((s) => !!s.type && !!s.typeName), '影子也带属性');

const badType = await call('POST /battle/type', { type: 'dark' }, ME);
ok(badType.http === 400, '未知属性被拒', badType.http + ' ' + badType.body.message);
const toFire = await call('POST /battle/type', { type: 'fire' }, ME);
ok(toFire.http === 200 && toFire.body.data.battleType === 'fire', '本命能改成火');
const fireProf = await call('GET /battle/profile', null, ME);
const fOpp = {};
for (const o of fireProf.body.data.opponents) fOpp[o.id] = o;
ok(fOpp.spar.typeMul === 1.18, '火克草（spar）', fOpp.spar.typeMul);
ok(fOpp.rival.typeMul === 0.86, '火被水克（rival）', fOpp.rival.typeMul);

// 属性倍率真的进了伤害：火打草的战报会出现「效果拔群」，草本命打草则没有
const fireFight = await call('POST /battle/fight', { oppId: 'spar' }, ME);
const fireTags = (fireFight.body.data.steps || []).filter((s) => s.by === 0)
  .reduce((acc, s) => acc.concat(s.tags || []), []);
ok(fireTags.indexOf('weak') >= 0, '火打草的战报带「效果拔群」');
ok(fireFight.body.data.types && fireFight.body.data.types.mulMe === 1.18,
  '战报回传属性倍率', JSON.stringify(fireFight.body.data.types));

put(ME, Object.assign(get(ME), { battle_type: 'grass', battle_date: '2000-01-01', battle_today: 0 }));
const gFight = await call('POST /battle/fight', { oppId: 'spar' }, ME);
const gTags = (gFight.body.data.steps || []).filter((s) => s.by === 0)
  .reduce((acc, s) => acc.concat(s.tags || []), []);
ok(gTags.indexOf('weak') < 0 && gTags.indexOf('resist') < 0, '中性对局不带克制标记');

console.log('\n== 进化（决定技能槽）==');
for (const c of [[59, 2, 0], [60, 2, 1], [119, 2, 1], [120, 3, 2], [200, 3, 3]]) {
  put(ME, Object.assign(get(ME), { bond: c[0], battle_skills: [] }));
  const p = await call('GET /battle/profile', null, ME);
  ok(p.body.data.evolution.stage === c[2], 'bond ' + c[0] + ' → 第 ' + c[2] + ' 阶段',
    JSON.stringify(p.body.data.evolution));
  ok(p.body.data.evolution.slots === c[1] && p.body.data.skillSlots === c[1],
    'bond ' + c[0] + ' → ' + c[1] + ' 个技能槽', p.body.data.skillSlots);
}
put(ME, Object.assign(get(ME), { bond: 120, battle_skills: [] }));
const evoEq3 = await call('POST /battle/skills', { skills: ['heavy', 'shield', 'combo', 'pierce'] }, ME);
ok(evoEq3.http === 200 && (evoEq3.body.data.equipped || []).length === 3, '完全体能装 3 个技能',
  JSON.stringify(evoEq3.body.data.equipped));
put(ME, Object.assign(get(ME), { bond: 100, battle_skills: [] }));
const evoEq2 = await call('POST /battle/skills', { skills: ['heavy', 'shield', 'combo'] }, ME);
ok(evoEq2.http === 200 && (evoEq2.body.data.equipped || []).length === 2, '低羁绊仍然只装 2 个',
  JSON.stringify(evoEq2.body.data.equipped));

console.log('\n== 图鉴 / 野生精灵 / 随行（v0.8.0）==');
put(ME, Object.assign(get(ME), {
  bond: 200, battle_type: 'grass', battle_skills: [],
  dex: [], buddy: undefined, wild_tries: {}, wild_fails: {}, wild_fights: 0,
  battle_date: '2000-01-01', battle_today: 0
}));
const st0 = await call('GET /state', null, ME);
ok((st0.body.data.wild || []).length === 15, '野生精灵 15 只', (st0.body.data.wild || []).length);
ok((st0.body.data.elements || []).length === 5, '/state 也下发属性表');
ok(st0.body.data.evolution && st0.body.data.evolution.slots === 3, '/state 下发进化阶段');
const byType = {};
for (const w of st0.body.data.wild) byType[w.type] = (byType[w.type] || 0) + 1;
ok(Object.keys(byType).length === 5 && Object.keys(byType).every((k) => byType[k] === 3),
  '5 属性 × 3 稀有度', JSON.stringify(byType));

const dex0 = (await call('GET /battle/profile', null, ME)).body.data.dex;
ok(dex0.total === 15 && dex0.ownedCount === 0, '图鉴初始 0 / 15', dex0.ownedCount + ' / ' + dex0.total);
ok(dex0.list.length === 15 && dex0.list.every((w) => !w.owned && typeof w.capture === 'number'),
  '15 只全常驻可挑战（没有每日配额）');
const spotW = dex0.list.filter((w) => w.spotlight)[0];
ok(!!spotW, '每天有一只今日焦点');
const baseOf = { common: 0.62, rare: 0.40, legend: 0.20 };
ok(Math.abs(spotW.capture - (baseOf[spotW.rarity] + 0.1)) < 1e-9,
  '焦点收服率多 10%', spotW.capture);

const unknownW = await call('POST /wild/fight', { id: 'nope' }, ME);
ok(unknownW.http === 400, '未知野生精灵被拒', unknownW.http + ' ' + unknownW.body.message);

let cap = null;
let capTries = 0;
for (let i = 0; i < 25; i++) {
  const r = await call('POST /wild/fight', { id: 'huomiao' }, ME);
  capTries++;
  if (r.http !== 200) { ok(false, '打野生精灵被拒', r.http + ' ' + r.body.message); break; }
  if (i === 0) {
    ok(r.body.data.win === true, '高羁绊能打赢常见野生精灵');
    if (!r.body.data.captured) {
      ok(r.body.data.nextChance > r.body.data.chance, '赢了没抓到 → 下次收服率更高',
        r.body.data.chance + ' → ' + r.body.data.nextChance);
    }
  }
  if (r.body.data.captured) { cap = r.body.data; break; }
}
ok(!!cap, '收服一定能成功（失败递增有上限）', 'tries=' + capTries);
if (cap) {
  ok(cap.dexCount === 1 && cap.dexTotal === 15, '返回图鉴进度 1 / 15',
    cap.dexCount + ' / ' + cap.dexTotal);
  ok(cap.buddySet === true, '第一只收服自动成为随行');
  ok((cap.unlocked || []).some((u) => u.id === 'dex_1'), '解锁「初次收服」成就');
}
const dup = await call('POST /wild/fight', { id: 'huomiao' }, ME);
ok(dup.http === 400, '已收服的不能再挑战', dup.http + ' ' + dup.body.message);

const dex1 = (await call('GET /battle/profile', null, ME)).body.data.dex;
ok(dex1.ownedCount === 1, '图鉴变成 1', dex1.ownedCount);
ok(dex1.buddy && dex1.buddy.id === 'huomiao', '随行就是刚收服的那只');
ok(dex1.buddyBonus && dex1.buddyBonus.atk === 3, '火系随行 +3 攻', JSON.stringify(dex1.buddyBonus));

const withBuddyPower = (await call('GET /battle/profile', null, ME)).body.data.combat.power;
const offBuddy = await call('POST /buddy', { id: '' }, ME);
ok(offBuddy.http === 200 && offBuddy.body.data.buddy === null, '能取消随行');
const offPower = offBuddy.body.data.combat.power;
ok(withBuddyPower > offPower, '随行加成进了战力', withBuddyPower + ' > ' + offPower);
const backBuddy = await call('POST /buddy', { id: 'huomiao' }, ME);
ok(backBuddy.http === 200 && backBuddy.body.data.combat.power === withBuddyPower,
  '换回随行战力还原', backBuddy.body.data.combat.power);
const notOwned = await call('POST /buddy', { id: 'gushu' }, ME);
ok(notOwned.http === 400, '没收服的不能随行', notOwned.http + ' ' + notOwned.body.message);
const noBuddy = await call('POST /buddy', { id: 'huomiao' }, ME);
ok(noBuddy.http === 200, '已收服的选择随行成功');

const towerType = (await call('GET /battle/profile', null, ME)).body.data.tower;
ok(towerType.next && towerType.next.type === 'earth', '塔层是土属性（草本命有优势）',
  towerType.next && towerType.next.type);

console.log('\n== 越权/异常路径（先把今日次数重置，让请求走到对手校验）==');
const meNow = get(ME);
meNow.battle_date = '2000-01-01'; meNow.battle_today = 0;
put(ME, meNow);
const bad = await call('POST /battle/fight', { oppId: 'p:251805' }, ME);   // 未领养
ok(bad.http === 400, '挑战未领养的人被拒', bad.http + ' ' + bad.body.message);
const selfShot = await call('POST /battle/fight', { oppId: 'p:' + ME }, ME);
ok(selfShot.http === 400, '不能挑战自己', selfShot.http + ' ' + selfShot.body.message);
const ghost = await call('POST /battle/fight', { oppId: 'p:999999' }, ME);
ok(ghost.http === 400, '挑战不存在的人被拒', ghost.http + ' ' + ghost.body.message);
const unknown = await call('POST /battle/fight', { oppId: 'spar2' }, ME);
ok(unknown.http === 400, '未知 NPC id 被拒', unknown.http + ' ' + unknown.body.message);
ok(get('251805').battle_inbox === undefined, '被拒的请求没给未领养的人写脏数据');

console.log(fail === 0 ? '\nOK: 影子赛场自测全部通过' : '\n❌ 有 ' + fail + ' 项未通过');
process.exitCode = fail === 0 ? 0 : 1;
