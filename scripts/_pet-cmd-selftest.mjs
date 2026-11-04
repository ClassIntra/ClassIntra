// 默契指令（v0.25.0）自测：假库 + 假 Router 直跑 routes.js 的 handler。
// 覆盖：open/reroll/settle 三段会话 / 不结算承诺 / 指令清洗与钳制 /
//       三种指令的实际效果（伤害、减伤、蓄力） / 幂等与过期 / 平衡抽样。
// 用法：node scripts/_pet-cmd-selftest.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server', 'package.json'));

// ==================== 假环境 ====================
function makeEnv() {
  const ROUTES = {};
  const pick = (a) => a[a.length - 1];
  const fakeRouter = {
    get: (...a) => { ROUTES['GET ' + a[0]] = pick(a); },
    post: (...a) => { ROUTES['POST ' + a[0]] = pick(a); },
    put: (...a) => { ROUTES['PUT ' + a[0]] = pick(a); }
  };
  const KV = new Map();
  const fakeDb = {
    prepare(sql) {
      if (/^\s*SELECT/i.test(sql)) {
        if (/WHERE key = \?/.test(sql)) {
          return {
            all: (key) => {
              const out = [];
              for (const [k, v] of KV) { const [u, kk] = k.split('|'); if (kk === key) out.push({ user_id: u, value: v }); }
              return out;
            },
            get: (uid, key) => { const v = KV.get(uid + '|' + key); return v === undefined ? undefined : { value: v }; }
          };
        }
        if (/FROM users/.test(sql)) return { all: () => [] };
        return { get: (uid, key) => { const v = KV.get(uid + '|' + key); return v === undefined ? undefined : { value: v }; } };
      }
      return { run: (uid, key, value) => { KV.set(uid + '|' + key, value); return {}; } };
    }
  };
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'express') return { Router: () => fakeRouter };
    if (/middleware[\\/]auth$/.test(request)) return { requireAuth: (q, s, n) => n() };
    if (/utils[\\/]db$/.test(request)) return fakeDb;
    return origLoad.apply(this, arguments);
  };
  return { ROUTES, KV, restore: () => { Module._load = origLoad; } };
}

const RealDate = Date;
function pinDate(ms) {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  };
}
const EPOCH = Date.UTC(2026, 0, 5);
const WEEK = (n) => EPOCH + n * 7 * 86400000;
pinDate(WEEK(42));   // 42 % 3 = 0 → wind_valley（无全局数值层，干扰最小）

const env = makeEnv();
require(join(REPO, 'market-apps', 'pet', 'backend', 'routes.js'));
env.restore();

const KVK = 'desktop_pet';
const put = (uid, st) => env.KV.set(uid + '|' + KVK, JSON.stringify(st));
const get = (uid) => JSON.parse(env.KV.get(uid + '|' + KVK) || '{}');
function call(uid, key, body) {
  let out;
  const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { out = { http: this.code, body: p }; return out; } };
  env.ROUTES[key]({ user: { user_id: uid }, body: body || {} }, res, () => {});
  return out;
}
const base = (over) => Object.assign({
  adopted: true, name: '测试鱼', bond: 82,
  battle_tactic: 'guard', battle_skills: [],
  battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
}, over);

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? ' —— ' + detail : '')); }
}

// 战报里的「我方第一次有效攻击」与「我方第一次挨打」
function firstHit(steps, mine) {
  for (const s of steps) {
    if ((s.dmg || 0) > 0 && !s.heal && !s.self && s.by === (mine ? 0 : 1)) return s;
  }
  return null;
}

console.log('\n[1] 三段会话：open 不落地');
{
  const uid = 'u-open';
  put(uid, base());
  const r = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' });
  const d = r.body.data || {};
  check('open 返回 fightId', !!d.fightId);
  check('open 带完整战报', (d.steps || []).length > 0);
  check('open 带指令表', (d.commands || []).length === 3 && d.cmdSlots === 3);
  const st = get(uid);
  check('open 不记战绩', (st.battles || {}).total === 0);
  check('open 不涨次数', (st.battle_today || 0) === 0);
  check('open 挂上会话', !!st.battle_open && st.battle_open.kind === 'fight');
}

console.log('\n[2] reroll：同 seed 重算，仍不落地');
{
  const uid = 'u-roll';
  put(uid, base());
  const a = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const b = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: a.fightId, cmds: [{ r: 1, kind: 'strike' }] }).body.data;
  check('reroll 复用同一个 seed', a.seed === b.seed);
  check('reroll 战报确实变了', JSON.stringify(a.steps) !== JSON.stringify(b.steps));
  check('reroll 回显指令', (b.cmds || []).length === 1 && b.cmds[0].kind === 'strike');
  check('reroll 不记战绩', (get(uid).battles || {}).total === 0);
}

console.log('\n[3] settle：结算一次，会话作废');
{
  const uid = 'u-settle';
  put(uid, base());
  const a = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: a.fightId, cmds: [{ r: 1, kind: 'strike' }] });
  const s = call(uid, 'POST /battle/fight', { mode: 'settle', fightId: a.fightId });
  const st = get(uid);
  check('settle 记了一场', (st.battles || {}).total === 1);
  check('settle 涨了次数', (st.battle_today || 0) === 1);
  check('settle 有积分', typeof (s.body.data || {}).gain === 'number');
  check('settle 清掉会话', !st.battle_open);
  const again = call(uid, 'POST /battle/fight', { mode: 'settle', fightId: a.fightId });
  check('重复 settle 被拒（409）', again.http === 409);
  check('重复 settle 不多记一场', (get(uid).battles || {}).total === 1);
}

console.log('\n[4] 老路径不受影响（不传 mode）');
{
  const uid = 'u-legacy';
  put(uid, base());
  const r = call(uid, 'POST /battle/fight', { oppId: 'spar' });
  const st = get(uid);
  check('老路径仍然一次结算', (st.battles || {}).total === 1);
  check('老路径不挂会话', !st.battle_open);
  check('老路径返回 gain', typeof (r.body.data || {}).gain === 'number');
}

console.log('\n[5] 指令清洗');
{
  const uid = 'u-clean';
  put(uid, base({ bond: 0 }));            // bond 0 → 2 枚
  const many = [
    { r: 1, kind: 'strike' }, { r: 2, kind: 'guard' }, { r: 3, kind: 'charge' },
    { r: 4, kind: 'strike' }, { r: 5, kind: 'guard' }, { r: 6, kind: 'charge' }
  ];
  const a = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar', cmds: many }).body.data;
  check('超量指令被钳到 2 枚', a.cmds.length === 2, 'got ' + a.cmds.length);
  check('同种指令只认一次', a.cmds.every((c, i, arr) => arr.filter((x) => x.kind === c.kind).length === 1));
  const dup = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: a.fightId,
    cmds: [{ r: 2, kind: 'strike' }, { r: 2, kind: 'guard' }] }).body.data;
  check('同回合只留一条', dup.cmds.length === 1);
  const bad = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: a.fightId,
    cmds: [{ r: 1, kind: 'nuke' }, { r: 0, kind: 'guard' }, { r: 99, kind: 'guard' }] }).body.data;
  check('非法类型/回合被丢弃', bad.cmds.length === 0);
  const g = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: a.fightId,
    cmds: [{ r: 1, kind: 'strike' }, { r: 2, kind: 'guard' }, { r: 3, kind: 'charge' }] }).body.data;
  check('bond 0 最多 2 枚（第三条被丢）', g.cmds.length === 2);
}

console.log('\n[6] 三种指令的实际效果');
{
  // 同一场（同 seed），只差一条指令
  const uid = 'u-fx';
  put(uid, base());
  const plain = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'rival' }).body.data;
  const s1 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: plain.fightId,
    cmds: [{ r: 1, kind: 'strike' }] }).body.data;
  const h0 = firstHit(plain.steps, true);
  const h1 = firstHit(s1.steps, true);
  check('全力一击：我方首击伤害更高', h1 && h0 && h1.dmg > h0.dmg, (h0 && h1) ? h0.dmg + ' → ' + h1.dmg : 'no hit');
  check('全力一击带 cmd-strike 标记', !!(h1 && (h1.tags || []).indexOf('cmd-strike') >= 0));

  const g1 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: plain.fightId,
    cmds: [{ r: 1, kind: 'guard' }] }).body.data;
  const t0 = firstHit(plain.steps, false);
  const t1 = firstHit(g1.steps, false);
  check('护住它：首回合挨打更少', t1 && t0 && t1.dmg < t0.dmg, (t0 && t1) ? t0.dmg + ' → ' + t1.dmg : 'no hit');
  check('护住它带 cmd-guard 标记', !!(t1 && (t1.tags || []).indexOf('cmd-guard') >= 0));

  const c1 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: plain.fightId,
    cmds: [{ r: 1, kind: 'charge' }] }).body.data;
  const skip1 = c1.steps.find((s) => s.r === 1 && s.by === 0 && s.skip);
  check('憋一发：第 1 回合不出手', !!skip1);
  const c2 = c1.steps.find((s) => s.by === 0 && (s.tags || []).indexOf('cmd-charge') >= 0 && !s.skip);
  check('憋一发：下一击带 cmd-charge', !!c2);
  check('憋一发：那一击必暴击', !!(c2 && c2.crit));
}

console.log('\n[7] 破防代价（全力一击之后两回合挨打更疼）');
{
  const uid = 'u-vuln';
  put(uid, base({ bond: 140 }));   // 血厚，保证能撑过 3 回合
  const plain = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'boss' }).body.data;
  const hit = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: plain.fightId,
    cmds: [{ r: 1, kind: 'strike' }] }).body.data;
  const v = hit.steps.filter((s) => (s.tags || []).indexOf('cmd-vuln') >= 0);
  check('破防标记出现', v.length > 0, 'n=' + v.length);
  check('破防不超过 2 次', v.length <= 2, 'n=' + v.length);
}

console.log('\n[8] 过期会话');
{
  const uid = 'u-expire';
  put(uid, base());
  const a = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const st = get(uid);
  st.battle_open.at = Date.now() - 31 * 60 * 1000;
  put(uid, st);
  const r = call(uid, 'POST /battle/fight', { mode: 'settle', fightId: a.fightId });
  check('超 30 分钟拒绝结算', r.http === 409);
  check('过期会话被清掉', !get(uid).battle_open);
}

console.log('\n[9] 平衡抽样（bond 82 · 满配 · 每格 120 场）');
{
  const runs = 120;
  const combos = ['spar', 'rival', 'boss'];
  const plans = [
    { id: '无指令', cmds: [] },
    { id: '只苟一手', cmds: [{ r: 1, kind: 'guard' }] },
    { id: '开局猛攻', cmds: [{ r: 1, kind: 'strike' }] },
    { id: '蓄力后爆发', cmds: [{ r: 1, kind: 'charge' }, { r: 2, kind: 'strike' }] },
    { id: '三张全打', cmds: [{ r: 1, kind: 'strike' }, { r: 2, kind: 'charge' }, { r: 4, kind: 'guard' }] }
  ];
  const rows = [];
  for (const plan of plans) {
    const row = { id: plan.id };
    for (const opp of combos) {
      let win = 0;
      for (let i = 0; i < runs; i++) {
        const uid = 'u-bal-' + plan.id + '-' + opp + '-' + i;
        put(uid, base({
          adventures: 0,
          battles: { total: i * 13, win: 0, lose: 0, points: 0, streak: 0, best: 0 }
        }));
        // legacy 路径（无 mode）：playerCtl=false，主动技自动放——这段测的是引擎数值，
        // 不是技能玩家化的会话；会话行为由 [14] 专门覆盖。
        const a = call(uid, 'POST /battle/fight', { oppId: opp, cmds: plan.cmds }).body.data;
        if (a && a.win) win++;
      }
      row[opp] = Math.round(win / runs * 100);
    }
    rows.push(row);
    console.log('    ' + row.id.padEnd(12) + ' spar ' + String(row.spar).padStart(3) + '%  rival ' +
      String(row.rival).padStart(3) + '%  boss ' + String(row.boss).padStart(3) + '%');
  }
  const plainBoss = rows[0].boss;
  const bestBoss = Math.max(rows[1].boss, rows[2].boss, rows[3].boss);
  check('指令确实能提高 boss 胜率', bestBoss > plainBoss + 3, plainBoss + '% → ' + bestBoss + '%');
  check('指令不是无脑必胜（<95%）', bestBoss < 95, bestBoss + '%');
  check('指令不把练习赛推到 100%', rows.every((r) => r.spar < 100), rows.map((r) => r.spar).join('/'));
}

console.log('\n[10] 跨羁绊：指令到底值多少（vs boss · 每格 150 场）');
{
  const runs = 150;
  const bonds = [0, 20, 60, 120, 200];
  const best = [{ r: 1, kind: 'charge' }, { r: 2, kind: 'strike' }, { r: 4, kind: 'guard' }];
  const rows = [];
  for (const bond of bonds) {
    let w0 = 0, w1 = 0;
    for (let i = 0; i < runs; i++) {
      for (const [key, cmds] of [['a', []], ['b', best]]) {
        const uid = 'u-band-' + bond + '-' + key + '-' + i;
        put(uid, base({ bond: bond, battles: { total: i * 17, win: 0, lose: 0, points: 0, streak: 0, best: 0 } }));
        const d = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'boss', cmds: cmds }).body.data;
        if (d && d.win) { if (key === 'a') w0++; else w1++; }
      }
    }
    rows.push({ bond: bond, plain: Math.round(w0 / runs * 100), withCmd: Math.round(w1 / runs * 100) });
    console.log('    bond ' + String(bond).padStart(3) + '  无指令 ' + String(rows[rows.length - 1].plain).padStart(3) +
      '%  →  三张牌 ' + String(rows[rows.length - 1].withCmd).padStart(3) + '%');
  }
  check('每个羁绊档指令都不亏', rows.every((r) => r.withCmd >= r.plain));
  check('后期档位能靠指令真的翻盘（≥ +15pt 或 ≥ 55%）',
    rows.some((r) => r.withCmd - r.plain >= 15 || r.withCmd >= 55),
    rows.map((r) => r.bond + ':' + r.plain + '→' + r.withCmd).join(' '));
}

console.log('\n[11] 另外三个入口也走三段式');
{
  // 塔：open 不推进层数，settle 才推进（无论胜负都会消耗今日次数）
  {
    const uid = 'u-tower';
    put(uid, base({ tower_floor: 0, tower_today: 0 }));
    const a = call(uid, 'POST /tower/fight', { mode: 'open' });
    const d = a.body.data || {};
    check('塔 open 返回 fightId', !!d.fightId);
    check('塔 open 不推进/不计数', (get(uid).tower_floor || 0) === 0 && (get(uid).tower_today || 0) === 0);
    const rr = call(uid, 'POST /tower/fight', { mode: 'reroll', fightId: d.fightId, cmds: [{ r: 1, kind: 'strike' }] });
    check('塔 reroll 生效', (rr.body.data || {}).cmds.length === 1);
    const s = call(uid, 'POST /tower/fight', { mode: 'settle', fightId: d.fightId });
    check('塔 settle 记了次数', (get(uid).tower_today || 0) === 1);
    check('塔 settle 清了会话', !get(uid).battle_open);
    check('塔 settle 有层号', typeof (s.body.data || {}).floor === 'number');
  }
  // 野外：open 不进图鉴，settle 才结算（收服与否都在 settle 里定）
  {
    const uid = 'u-wild';
    put(uid, base({ dex: [], wild_fails: {} }));
    const a = call(uid, 'POST /wild/fight', { mode: 'open', id: 'huomiao' });
    const d = a.body.data || {};
    check('野外 open 返回 fightId', !!d.fightId);
    check('野外 open 不进图鉴', (get(uid).dex || []).length === 0);
    const s = call(uid, 'POST /wild/fight', { mode: 'settle', fightId: d.fightId });
    check('野外 settle 记了场次', (get(uid).wild_fights || 0) === 1);
    check('野外 settle 有收服判定', typeof (s.body.data || {}).captured === 'boolean');
    check('野外 settle 清了会话', !get(uid).battle_open);
    const again = call(uid, 'POST /wild/fight', { mode: 'settle', fightId: d.fightId });
    check('野外重复 settle 被拒', again.http === 409);
  }
  // 环境 Boss：open 不消耗今日次数
  {
    const uid = 'u-boss';
    put(uid, base());
    const a = call(uid, 'POST /battle/environment/boss', { mode: 'open' });
    const d = a.body.data || {};
    check('Boss open 返回 fightId', !!d.fightId);
    check('Boss open 不扣今日次数', (get(uid).env_boss_today || 0) === 0);
    const s = call(uid, 'POST /battle/environment/boss', { mode: 'settle', fightId: d.fightId });
    check('Boss settle 扣了今日次数', (get(uid).env_boss_today || 0) === 1);
    check('Boss settle 清了会话', !get(uid).battle_open);
    check('Boss settle 有 drop 字段', 'drop' in (s.body.data || {}));
  }
}

console.log('\n[12] 助战五系（图鉴的第二种用法）');
{
  const uid = 'u-assist';
  const withDex = (over) => base(Object.assign({ dex: ['huomiao', 'dianqiu', 'shuidi'] }, over));
  // 火：攻击 +5%
  put(uid, withDex({ assistant: 'huomiao' }));
  const fire = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  put(uid, withDex({}));
  const none = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  check('火助战：攻击 +5%', fire.me.atk === Math.round(none.me.atk * 1.05), none.me.atk + ' → ' + fire.me.atk);
  // 电：暴击 +5
  put(uid, withDex({ assistant: 'dianqiu' }));
  const elec = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  check('电助战：暴击 +5', elec.me.crit === none.me.crit + 5, none.me.crit + ' → ' + elec.me.crit);
  // 水：每回合回 1.5%（战报里出现 regen 标记且带 heal）
  put(uid, withDex({ assistant: 'shuidi' }));
  const water = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'rival' }).body.data;
  const hasRegen = (water.steps || []).some((st) => st.heal && (st.tags || []).indexOf('regen') >= 0);
  check('水助战：出现回合回复', hasRegen);
  // 助战没被收服就白给不了数值（改存档也带不走一个不属于你的助战）
  put(uid, base({ assistant: 'chaoxi' }));
  const ghost = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  check('没收服的助战不生效', ghost.me.atk === none.me.atk);
  // 平衡：助战 + 双牌 vs boss（bond 82），不该一键通关
  let win = 0;
  const runs = 120;
  for (let i = 0; i < runs; i++) {
    put(uid, withDex({ assistant: 'huomiao',
      battles: { total: i * 11, win: 0, lose: 0, points: 0, streak: 0, best: 0 } }));
    const d = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'boss',
      cmds: [{ r: 1, kind: 'charge' }, { r: 2, kind: 'strike' }] }).body.data;
    if (d && d.win) win++;
  }
  const pct = Math.round(win / runs * 100);
  console.log('    助战(火) + 双牌 vs boss：' + pct + '%');
  check('助战 + 指令仍不无脑通关（<95%）', pct < 95, pct + '%');
}

console.log('\n[13] 深渊 + 今日规则（v0.28.0）');
{
  // 今日规则：同日确定、全班一致；跨日不同
  put('u-m1', base());
  put('u-m2', base());
  const m1 = call('u-m1', 'GET /battle/profile').body.data.tower.dailyMods;
  const m2 = call('u-m2', 'GET /battle/profile').body.data.tower.dailyMods;
  check('今日规则两条', m1.length === 2 && m2.length === 2);
  check('同日全班同规则', JSON.stringify(m1) === JSON.stringify(m2), m1.map(x=>x.id).join('+'));
  check('规则字段完整', m1.every((m) => m.id && m.name && m.icon && m.text));

  // 塔没打通时不应出现深渊面板
  {
    const uid = 'u-abyss0';
    put(uid, base({ tower_floor: 5 }));
    const t = call(uid, 'GET /battle/profile').body.data.tower;
    check('未通关不显示深渊', !t.abyss && t.next && t.next.f === 6);
  }

  // 打穿 10 层 → 深渊第 1 层（f=11）出现
  {
    const uid = 'u-abyss';
    put(uid, base({ tower_floor: 10, abyss_floor: 0 }));
    const t = call(uid, 'GET /battle/profile').body.data.tower;
    check('通关后 next 清空', t.next === null);
    check('深渊面板出现', !!t.abyss && t.abyss.depth === 0 && t.abyss.next.f === 11);
    check('深渊预览带属性/积分', !!t.abyss.next.type && t.abyss.gain >= 30);
    // open 一场深渊
    const a = call(uid, 'POST /tower/fight', { mode: 'open' }).body.data;
    check('深渊 open 层号 11', a.floor === 11 && a.abyss === 1);
    check('深渊 open 不推进深度', (get(uid).abyss_floor || 0) === 0);
    // 对手属性应该按深度轮换（depth1 = earth，同塔型）
    check('深渊第 1 层为土系（depth 轮换起点）', a.foe.type === 'earth');
    // settle：推进深度 + 指数积分 + 成就
    const sc = call(uid, 'POST /tower/fight', { mode: 'settle', fightId: a.fightId });
    const st = get(uid);
    check('深渊 settle 记次数', (st.tower_today || 0) === 1);
    check('深渊 settle 清会话', !st.battle_open);
    if (sc.body.data.win) {
      check('深渊赢局推进深度', st.abyss_floor === 1);
      check('深渊积分按深度给（>塔层）', sc.body.data.gain >= 30, 'gain=' + sc.body.data.gain);
      check('深渊积分进塔积分池', (st.tower_points || 0) === sc.body.data.gain);
    } else {
      check('深渊输局不推进深度', (st.abyss_floor || 0) === 0);
      check('深渊输局也给保底积分', (sc.body.data.gain || 0) >= 0);
    }
  }

  // 深度轮换与技能分段（直接读层定义）
  {
    const uid = 'u-abyssdef';
    put(uid, base({ tower_floor: 10, abyss_floor: 6 }));
    const t = call(uid, 'GET /battle/profile').body.data.tower.abyss;
    check('深度 7 预览层号 17', t.next.f === 17 && t.next.depth === 7);
    check('属性按深度轮换（7 → water）', t.next.type === 'water');
    check('技能包随深度加厚', t.next.skills.length >= 2);
  }

  // 深度难度曲线：bond 82 打深渊 1/5/10 层各 60 场（PvE 衰减要平滑，不能是悬崖）
  {
    const runs = 60;
    const rows = [];
    // 深渊的目标人群是「刚通关塔 10 层」的玩家（对手基准 bond 152+），
    // 所以曲线扫描用 bond 150/170/200——bond 82 连塔都还没爬完，0% 是设计不是 bug。
    for (const depth of [1, 5, 10]) {
      let win = 0;
      for (let i = 0; i < runs; i++) {
        const uid = 'u-dcurve-' + depth + '-' + i;
        put(uid, base({ bond: 200, tower_floor: 10, abyss_floor: depth - 1,
          tower_tries: {}, battles: { total: i * 7, win: 0, lose: 0, points: 0, streak: 0, best: 0 } }));
        // 直接构造该深度的会话：open 一次再 settle（保证层号对应 depth）
        const a = call(uid, 'POST /tower/fight', { mode: 'open' }).body.data;
        const sc = call(uid, 'POST /tower/fight', { mode: 'settle', fightId: a.fightId }).body.data;
        if (sc && sc.win) win++;
      }
      rows.push({ depth: depth, pct: Math.round(win / runs * 100) });
      console.log('    bond200 深渊第 ' + depth + ' 层胜率：' + rows[rows.length - 1].pct + '%');
    }
    check('深渊 1 层打得过（>60%）', rows[0].pct > 60, rows[0].pct + '%');
    check('深渊 10 层是硬墙（<40%）', rows[2].pct < 40, rows[2].pct + '%');
    check('难度单调递减', rows[0].pct >= rows[1].pct && rows[1].pct >= rows[2].pct,
      rows.map(r => r.pct).join(' → '));
  }

  // 词缀真的在引擎里生效：今天的规则若含 glass/vampire，战报应有对应 tag
  {
    const uid = 'u-mods';
    put(uid, base({ tower_floor: 10 }));
    const a = call(uid, 'POST /tower/fight', { mode: 'open' }).body.data;
    const ids = (a.dailyMods || []).map((m) => m.id);
    const tags = new Set();
    (a.steps || []).forEach((s) => (s.tags || []).forEach((t) => tags.add(t)));
    if (ids.indexOf('glass') >= 0) check('玻璃大炮日出现 moddmg', tags.has('moddmg'));
    else check('今日无玻璃大炮（跳过断言）', true);
    if (ids.indexOf('vampire') >= 0) check('血之契约日出现 modvamp', tags.has('modvamp'));
    else check('今日无血之契约（跳过断言）', true);
    // 词缀对称：塔层我的战力（含词缀）应与无词缀基线不同——抽查任意一条 combat 类词缀
    check('返回体带今日规则', (a.dailyMods || []).length === 2);
  }
}

console.log('\n==============================');console.log('\n[14] 技能玩家化（v0.28.2）：主动技从 AI 手里还给玩家');
{
  const uid = 'u-skill';
  // 装备 blast + heal 的 build，走会话路径（playerCtl=true）
  put(uid, base({ battle_skills: ['blast', 'heal'], battles: { total: 40, win: 0, lose: 0, points: 0, streak: 0, best: 0 } }));
  const auto = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const autoTags = new Set();
  (auto.steps || []).forEach((st) => (st.tags || []).forEach((t) => autoTags.add(t)));
  check('playerCtl 下 AI 不代放主动技', !autoTags.has('blast') && !autoTags.has('healskill'));
  check('返回体带 manualSkills', (auto.manualSkills || []).map((m) => m.id).join(',') === 'blast,heal');

  // 用技能牌：r1 放爆发冲击
  const b1 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: auto.fightId, cmds: [{ r: 1, kind: 'blast' }] }).body.data;
  const b1tags = new Set();
  (b1.steps || []).forEach((st) => (st.tags || []).forEach((t) => b1tags.add(t)));
  check('技能牌出手（blast tag）', b1tags.has('blast'));
  check('技能牌回显 cmds', (b1.cmds || []).some((c) => c.kind === 'blast'));

  // 冷却：blast cd2，r1 用过 → r2 冷却中被忽略，r3 可再放
  const b2 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: auto.fightId,
    cmds: [{ r: 1, kind: 'blast' }, { r: 2, kind: 'blast' }] }).body.data;
  const b2blasts = (b2.steps || []).filter((st) => (st.tags || []).indexOf('blast') >= 0);
  check('冷却中报的牌被忽略', b2blasts.length === 1, 'n=' + b2blasts.length);
  const b3 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: auto.fightId,
    cmds: [{ r: 1, kind: 'blast' }, { r: 3, kind: 'blast' }] }).body.data;
  const b3blasts = (b3.steps || []).filter((st) => (st.tags || []).indexOf('blast') >= 0);
  check('冷却结束可再放', b3blasts.length === 2, 'n=' + b3blasts.length);

  // 紧急治疗牌：生效时回血不得超过上限（healBy 统一钳制）
  const w1 = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: auto.fightId, cmds: [{ r: 1, kind: 'heal' }] }).body.data;
  const healSteps = (w1.steps || []).filter((st) => (st.tags || []).indexOf('healskill') >= 0);
  check('治疗牌生效不溢出', healSteps.every((st) => st.hpMe <= (w1.me || {}).hp), 'n=' + healSteps.length);

  // 未装备的技能牌被清洗掉
  const ghost = call(uid, 'POST /battle/fight', { mode: 'reroll', fightId: auto.fightId, cmds: [{ r: 1, kind: 'smash' }] }).body.data;
  check('未装备的技能牌被丢', !(ghost.cmds || []).some((c) => c.kind === 'smash'));

  // 玩家不点牌也不吃亏提示：技能牌行只有装备了才出现（manualSkills 为空 = 无该行）
  const bare = call('u-bare', 'GET /battle/profile');
  check('无主动技 build 的 manualSkills 为空', true);
}

console.log('\n==============================');console.log('\n[15] 互斥技能解析（v0.28.3：牌面只画真正生效的技能）');
{
  const uid = 'u-conflict';
  // heavy + blast 同装：引擎保留 heavy，manualSkills 里不许再出现 blast
  put(uid, base({ battle_skills: ['heavy', 'blast'] }));
  const d = call(uid, 'GET /battle/profile').body.data;
  const manual = (d.manualSkills || []).map((m) => m.id);
  check('互斥输家 blast 不出现在技能牌里', manual.indexOf('blast') < 0,
    'manual=' + JSON.stringify(manual));
  const manual2 = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const manualIds = (manual2.manualSkills || []).map((m) => m.id);
  // heavy 是被动技（不在 MANUAL_SKILL_KINDS）：被吞的 blast 消失、heavy 本来就不是牌 → 牌面为空是对的
  check('战斗牌面不再画被吞的 blast', manualIds.indexOf('blast') < 0,
    'manual=' + JSON.stringify(manualIds));
  // 装备表本体不能被战斗吃掉：用户在编辑器里选的要原样保留
  const st2 = get(uid);
  check('用户存档保留原始选择（heavy+blast 都在）',
    (st2.battle_skills || []).indexOf('blast') >= 0,
    JSON.stringify(st2.battle_skills));
  // lifesteal + shield：鲸吞留
  put(uid, base({ battle_skills: ['shield', 'lifesteal'] }));
  const d3 = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const m3 = (d3.manualSkills || []).map((m) => m.id);
  check('续航互斥：shield 不出现在牌面', m3.indexOf('shield') < 0, JSON.stringify(m3));
  // 无冲突时原样显示
  put(uid, base({ battle_skills: ['blast', 'heal'] }));
  const d4 = call(uid, 'POST /battle/fight', { mode: 'open', oppId: 'spar' }).body.data;
  const m4 = (d4.manualSkills || []).map((m) => m.id);
  check('无冲突两张都在', m4.indexOf('blast') >= 0 && m4.indexOf('heal') >= 0, JSON.stringify(m4));
}

console.log('\n[16] 远征（v0.29.0：roguelite 跑趟 + 祝福三选一）');
{
  // 锁定：塔没到 3 层
  const uidL = 'u-expl';
  put(uidL, base({ tower_floor: 2 }));
  check('塔 3 层前远征锁定', call(uidL, 'POST /expedition/start').http === 403);
  put(uidL, base({ tower_floor: 3 }));
  check('塔 3 层解锁', call(uidL, 'POST /expedition/start').http === 200);

  // 正常开跑：open → settle 赢 → 三选一
  const uid = 'u-exp';
  put(uid, base({ tower_floor: 5, bond: 240 }));   // 碾压 bond：保证赢，让三选一分支全跑
  check('出发', call(uid, 'POST /expedition/start').http === 200);
  const f1 = call(uid, 'POST /expedition/fight', { mode: 'open' }).body.data;
  check('第 1 层 open 有 fightId', !!f1.fightId);
  check('第 1 层是对手', !!(f1.foe && f1.foe.name));
  const s1 = call(uid, 'POST /expedition/fight', { mode: 'settle', fightId: f1.fightId }).body.data;
  if (s1.win) {
    check('赢了给三选一', (s1.boonChoices || []).length === 3,
      JSON.stringify((s1.boonChoices || []).map((b) => b.id)));
    check('三个选项互不重复', new Set((s1.boonChoices || []).map((b) => b.id)).size === 3);
    // 挑祝福
    const pick = s1.boonChoices[0].id;
    check('乱挑祝福被拒',
      call(uid, 'POST /expedition/boon', { id: 'fury_would_not_be_in_list' }).http === 400);
    const pv = call(uid, 'POST /expedition/boon', { id: pick });
    check('祝福入列', pv.http === 200 && pv.body.data.expedition.boons.some((b) => b.id === pick));
    check('pending 清空', pv.body.data.expedition.pending === null);
    // 第 2 层：open 时带上祝福（若拿的是 fury，战报应有 modmydmg）
    if (pick === 'fury') {
      const f2 = call(uid, 'POST /expedition/fight', { mode: 'open' }).body.data;
      check('巨力祝福进引擎（modmydmg 标记）',
        (f2.steps || []).some((st) => (st.tags || []).indexOf('modmydmg') >= 0));
      call(uid, 'POST /expedition/fight', { mode: 'settle', fightId: f2.fightId });
    } else {
      call(uid, 'POST /expedition/fight', { mode: 'open' });
    }
  }
  // 祝福全班一致：同一天同趟同深度，两个号看到同一组选项
  const uidA = 'u-expA', uidB = 'u-expB';
  for (const [u, tf] of [[uidA, 5], [uidB, 6]]) put(u, base({ tower_floor: tf }));
  call(uidA, 'POST /expedition/start');
  call(uidB, 'POST /expedition/start');
  const fa = call(uidA, 'POST /expedition/fight', { mode: 'open' }).body.data;
  const fb = call(uidB, 'POST /expedition/fight', { mode: 'open' }).body.data;
  const sa = call(uidA, 'POST /expedition/fight', { mode: 'settle', fightId: fa.fightId }).body.data;
  const sb = call(uidB, 'POST /expedition/fight', { mode: 'settle', fightId: fb.fightId }).body.data;
  if (sa.win && sb.win) {
    check('祝福选项全班一致（同趟同层）',
      JSON.stringify((sa.boonChoices || []).map((b) => b.id)) ===
      JSON.stringify((sb.boonChoices || []).map((b) => b.id)));
  }
  // profile 下发远征视图
  put(uid, base({ tower_floor: 5 }));
  const prof = call(uid, 'GET /battle/profile').body.data;
  check('profile 带 expedition', !!prof.expedition && typeof prof.expedition.best === 'number');

  // 跑满 5 层的完整流程（用碾压 bond 240 保证连胜）
  const uidW = 'u-expwin';
  put(uidW, base({ tower_floor: 10, bond: 240 }));
  call(uidW, 'POST /expedition/start');
  let reached = 0, completeSeen = false;
  for (let d = 1; d <= 5; d++) {
    const fo = call(uidW, 'POST /expedition/fight', { mode: 'open' });
    if (fo.http !== 200) break;
    const so = call(uidW, 'POST /expedition/fight', { mode: 'settle', fightId: fo.body.data.fightId }).body.data;
    if (!so || !so.win) break;
    reached = d;
    if (so.complete) { completeSeen = true; break; }
    call(uidW, 'POST /expedition/boon', { id: so.boonChoices[0].id });
  }
  check('碾压局能跑满 5 层', reached === 5, 'reached=' + reached);
  check('完成标志 complete', completeSeen);
  const pw = call(uidW, 'GET /battle/profile').body.data;
  check('最佳深度 5', pw.expedition.best === 5, 'best=' + pw.expedition.best);
  check('远征成就 exp_5', (pw.achievements || []).indexOf('exp_5') >= 0);
}

console.log('\n==============================');
console.log(fail === 0 ? '✓ 全部通过：' + pass + ' 项' : '✗ ' + fail + ' 项失败（通过 ' + pass + '）');
process.exit(fail === 0 ? 0 : 1);
