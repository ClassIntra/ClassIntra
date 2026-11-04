// Build 系统 v2.0 自测：假库 + 假 Router 直跑 routes.js 的 handler。
// 覆盖：注册表完整性 / 旧存档迁移 / build 校验矩阵 / 分享码 roundtrip+篡改+过期 /
//       环境周轮换 / Boss 日限与周首杀 / 野怪掉落 / 新效果冒烟 / 平衡抽样 /
//       基线不漂移（与 market/apps/pet 的 v0.7 引擎同 seed 同输入对比 steps）。
// 用法：node scripts/_pet-build-selftest.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server', 'package.json'));

// ==================== 假环境 ====================
// 每个被测副本一个独立环境（各自的 KV / Router）。Module._load 按 require 顺序
// 绑定到当时的 fakeDb，所以老副本先加载、存完参照结果后再加载新副本。
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

// 把整只 Date 类钉在某一时刻：todayKey / envWeekIndex / 分享码周桶全部随之确定。
// 用完必须 restore，否则后面所有测试的时间都被带走。
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
function unpinDate() { global.Date = RealDate; }
// 2026-01-05（周一）是环境第 0 周；取三个整数周锚点保证轮换确定
const EPOCH = Date.UTC(2026, 0, 5);
const WEEK = (n) => EPOCH + n * 7 * 86400000;

function caller(ROUTES, uid) {
  // handler 末尾的 res.json 大多不带 return，所以用副作用取结果（json 一定同步调用一次）
  return (key, body) => {
    let out;
    const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { out = { http: this.code, body: p }; return out; } };
    ROUTES[key]({ user: { user_id: uid }, body: body || {} }, res, () => {});
    return out;
  };
}
const pet = (over) => Object.assign({
  adopted: true, name: '测试鱼', bond: 82,
  battle_tactic: 'guard', battle_skills: []
}, over);

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? ' —— ' + detail : '')); }
}
// 新引擎的 steps 是 pushStep 后置赋值生成的，JSON 键序与 v0.7 不同——
// 比较前先做键序归一化（内容完全一致，只有键顺序不同）
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === 'object'
    ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {})
    : v);
const fightSig = (data) => JSON.stringify(sortKeys(data.steps)) + '|' + data.win;

// ==================== 1. 基线不漂移 ====================
// 同 seed、同输入（⊆5 基础技能、无装备、无环境效果）下，新引擎与 v0.7 的 steps 必须逐位相等。
// 环境固定钉在 wind_valley 周：它没有全局数值层（灼烧/暴击/治疗），对基线 build 无影响。
console.log('\n[1] 基线不漂移（v0.7 引擎对照）');
pinDate(WEEK(42));   // 42 % 3 = 0 → wind_valley
const BASE_COMBOS = [[], ['heavy'], ['lifesteal'], ['shield'], ['combo'], ['pierce'], ['heavy', 'lifesteal'], ['shield', 'pierce']];
const BASE_OPPS = ['spar', 'rival', 'boss', 'p:u-ref'];
const reference = {};
{
  const envA = makeEnv();
  const call = caller(envA.ROUTES, 'u-base');
  require(join(REPO, '..', 'market', 'apps', 'pet', 'backend', 'routes.js'));
  // 参照影子对手：一个真实存档（非自己）
  envA.KV.set('u-ref|desktop_pet', JSON.stringify(pet({ name: '参照鱼', bond: 82, battle_skills: ['combo'] })));
  for (const combo of BASE_COMBOS) {
    for (const opp of BASE_OPPS) {
      for (let i = 0; i < 3; i++) {
        envA.KV.set('u-base|desktop_pet', JSON.stringify(pet({
          battle_date: '2000-01-01', battle_today: 0,
          battles: { total: i * 7, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
          battle_skills: combo
        })));
        const r = call('POST /battle/fight', { oppId: opp, skills: combo });
        reference[combo.join(',') + '|' + opp + '|' + i] = fightSig(r.body.data);
      }
    }
  }
  envA.restore();
}
{
  const envB = makeEnv();
  const call = caller(envB.ROUTES, 'u-base');
  require(join(REPO, 'market-apps', 'pet', 'backend', 'routes.js'));
  envB.KV.set('u-ref|desktop_pet', JSON.stringify(pet({ name: '参照鱼', bond: 82, battle_skills: ['combo'] })));
  let same = 0, diff = 0, firstDiff = '';
  for (const combo of BASE_COMBOS) {
    for (const opp of BASE_OPPS) {
      for (let i = 0; i < 3; i++) {
        envB.KV.set('u-base|desktop_pet', JSON.stringify(pet({
          battle_date: '2000-01-01', battle_today: 0,
          battles: { total: i * 7, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
          battle_skills: combo
        })));
        const r = call('POST /battle/fight', { oppId: opp, skills: combo });
        const now = fightSig(r.body.data);
        if (now === reference[combo.join(',') + '|' + opp + '|' + i]) same++;
        else { diff++; if (!firstDiff) firstDiff = combo.join(',') + '|' + opp + '|' + i; }
      }
    }
  }
  check('基线 build 的 96 场战斗与 v0.7 逐位一致', diff === 0, '首个差异 ' + firstDiff);
  // 同 seed 复现：同一输入打两遍，结果必须一样
  envB.KV.set('u-base|desktop_pet', JSON.stringify(pet({ battle_date: '2000-01-01', battle_today: 0, battles: { total: 5, win: 0, lose: 0, points: 0 } })));
  const r1 = call('POST /battle/fight', { oppId: 'spar' });
  envB.KV.set('u-base|desktop_pet', JSON.stringify(pet({ battle_date: '2000-01-01', battle_today: 0, battles: { total: 5, win: 0, lose: 0, points: 0 } })));
  const r2 = call('POST /battle/fight', { oppId: 'spar' });
  check('同 seed 战报复现一致', JSON.stringify(r1.body.data.steps) === JSON.stringify(r2.body.data.steps));

  // ==================== 2. 注册表 ====================
  console.log('\n[2] 技能注册表');
  const prof = call('GET /battle/profile').body.data;
  check('profile 不再 500（技能注册表已修复）', !!prof.combat);
  check('技能池 18 个', prof.skillCatalog.length === 18, '实际 ' + prof.skillCatalog.length);
  check('bond 82 解锁全部 tier≤2 技能（tier3 暂无货）', prof.skills.length === 18, '实际 ' + prof.skills.length);
  check('skillCatalog 带解锁门槛', prof.skillCatalog.every((s) => typeof s.unlockBond === 'number'));
  check('profile 带 build/environment/inventory', !!(prof.build && prof.environment && prof.inventory));

  // ==================== 3. 迁移 ====================
  console.log('\n[3] 旧存档迁移');
  envB.KV.set('u-mig|desktop_pet', JSON.stringify(pet({
    battle_tactic: 'assault', battle_skills: ['heavy'], bond: 30
  })));
  const pm = caller(envB.ROUTES, 'u-mig')('GET /battle/profile').body.data;
  check('旧存档自动建 battle_build', !!pm.build);
  check('技能真源仍是 battle_skills（heavy）', pm.build.skills.join(',') === 'heavy');
  check('新手包已发（钝剑+水晶护符）', pm.inventory.owned.some((x) => x.id === 'blunt_sword') && pm.inventory.owned.some((x) => x.id === 'crystal_amulet'));
  check('新手包含火焰药水×1', (pm.inventory.owned.find((x) => x.id === 'flame_potion') || {}).charges === 1);

  // ==================== 4. build/update 校验矩阵 ====================
  console.log('\n[4] build/update 校验');
  const cu = caller(envB.ROUTES, 'u-base');
  const notOwned = cu('POST /battle/build/update', { equipment: { weapon: 'void_blade' } });
  check('未拥有武器被拒', notOwned.http === 400);
  // 造一个「新手包已发但火焰药水用光」的状态：消耗品零库存必须被拒
  envB.KV.set('u-base|desktop_pet', JSON.stringify(pet({
    equip_inventory: { owned: ['blunt_sword', 'crystal_amulet'], charges: { flame_potion: 0 } },
    _kit2: true
  })));
  const noCharge = cu('POST /battle/build/update', { equipment: { consumable: 'flame_potion' } });
  check('消耗品零库存被拒', noCharge.http === 400);
  const locked = cu('POST /battle/build/update', { skills: ['heavy', 'sharp', 'evade'] });
  check('未解锁技能被剔除（bond 82 无 tier2 以上缺口时也应只有已解锁的）',
    locked.body.data.equipped.every((s) => ['heavy', 'sharp', 'evade'].includes(s)) &&
    locked.body.data.equipped.length === 3, JSON.stringify(locked.body.data.equipped));
  const okU = cu('POST /battle/build/update', {
    skills: ['heavy', 'pierce', 'strength'],
    equipment: { weapon: 'blunt_sword', accessory: 'crystal_amulet' },
    strategy_name: '稳中带皮'.repeat(5)
  });
  check('合法 update 成功（策略名截断到 12 字）', okU.http === 200 && okU.body.data.build.strategy_name === '稳中带皮稳中带皮稳中带皮', JSON.stringify(okU.body.data.build));
  check('评分 = 生效后真实战力且高于裸装', okU.body.data.build.power_score > prof.combat.power);
  check('适配度结构完整', typeof okU.body.data.build.fitness.stars === 'number');

  // ==================== 5. 分享码 ====================
  console.log('\n[5] 分享码');
  const shared = cu('POST /battle/build/share', {}).body.data;
  check('分享码格式 SSSSSEE-K', /^[0-9a-z]{7}-[0-9a-z]$/.test(shared.share_code), shared.share_code);
  const other = caller(envB.ROUTES, 'u-other');
  envB.KV.set('u-other|desktop_pet', JSON.stringify(pet({ name: '同学鱼', bond: 8, battle_skills: [] })));
  const imported = other('POST /battle/build/import', { share_code: shared.share_code }).body.data;
  // u-base 的 build：技能 heavy/pierce/strength + 钝剑/水晶护符。
  // bond 8 解不开 pierce（tier1）；钝剑/护符新手包人人有份 → 装备不缺
  check('导入报告未解锁技能', imported.missing.skills.indexOf('pierce') >= 0 && imported.missing.equipment.length === 0,
    JSON.stringify(imported.missing));
  check('导入后 import_success 且只穿拿得到的', imported.import_success === true &&
    JSON.stringify(imported.applied.skills) === JSON.stringify(['heavy', 'strength']), JSON.stringify(imported.applied));
  const tampered = other('POST /battle/build/import', { share_code: shared.share_code.slice(0, 7) + '-' + (shared.share_code[8] === 'a' ? 'b' : 'a') });
  check('篡改校验位被拒', tampered.http === 400);
  unpinDate(); pinDate(WEEK(44));   // 跳两周
  const expired = other('POST /battle/build/import', { share_code: shared.share_code });
  check('跨两周过期被拒', expired.http === 400, JSON.stringify(expired.body));
  pinDate(WEEK(42));
  const freshImport = other('POST /battle/build/import', { share_code: shared.share_code });
  check('当前周内导入仍有效', freshImport.http === 200);

  // ==================== 6. 环境轮换 ====================
  console.log('\n[6] 环境周轮换');
  const envIds = [];
  for (let w = 0; w < 6; w++) {
    pinDate(WEEK(w));
    envIds.push(caller(envB.ROUTES, 'u-base')('GET /battle/environment').body.data.id);
  }
  check('三周轮换且循环', JSON.stringify(envIds) === JSON.stringify(['wind_valley', 'magma_cave', 'moon_altar', 'wind_valley', 'magma_cave', 'moon_altar']), envIds.join(','));
  pinDate(WEEK(42));
  const e1 = caller(envB.ROUTES, 'u-base')('GET /battle/environment').body.data;
  const e2 = caller(envB.ROUTES, 'u-other')('GET /battle/environment').body.data;
  check('同周全班同环境', e1.id === e2.id && e1.week === e2.week);

  // ==================== 7. Boss 战 ====================
  console.log('\n[7] 环境 Boss');
  // 满级 + 爆发续航 Build + 猛攻：对 wind_valley Boss（电系，闪避 18%）应有明显优势
  const strongState = () => pet({
    name: '大佬鱼', bond: 200, battle_tactic: 'assault',
    battle_skills: ['blast', 'lifesteal', 'strength', 'sharp', 'finesse'],
    battle_build: { skills: [], equipment: { weapon: 'blunt_sword', accessory: 'crystal_amulet', consumable: 'flame_potion' }, strategy_name: '' },
    equip_inventory: { owned: ['blunt_sword', 'crystal_amulet'], charges: { flame_potion: 1 } }
  });
  envB.KV.set('u-strong|desktop_pet', JSON.stringify(strongState()));
  const cs = caller(envB.ROUTES, 'u-strong');
  const bw = cs('POST /battle/environment/boss', {});
  check('高bond续航 Build 能赢 Boss', bw.http === 200 && bw.body.data.win === true, JSON.stringify(bw.body).slice(0, 200));
  check('周首杀必掉奖励装备', bw.body.data.firstKill === true && !!bw.body.data.drop, JSON.stringify(bw.body.data.drop));
  check('奖励是当前环境的 rewardItem', !!bw.body.data.drop && bw.body.data.drop.id === e1.reward.id);
  // 不重置存档：env_boss_today 已持久化，第二次必须被日限拦下
  const bw2 = cs('POST /battle/environment/boss', {});
  check('每日一次限制', bw2.http === 429);
  envB.KV.set('u-weak|desktop_pet', JSON.stringify(pet({ name: '萌新鱼', bond: 0, battle_skills: [] })));
  const bl = caller(envB.ROUTES, 'u-weak')('POST /battle/environment/boss', {});
  check('低bond挑战 Boss 也有保底分', bl.http === 200 && bl.body.data.gain > 0);

  // ==================== 8. 新效果冒烟 ====================
  console.log('\n[8] 新技能/装备效果');
  envB.KV.set('u-eff|desktop_pet', JSON.stringify(pet({
    name: '效果鱼', bond: 200,
    battle_skills: ['blast', 'pierce', 'strength'],
    battle_build: { skills: [], equipment: { weapon: 'blunt_sword', accessory: 'crystal_amulet' }, strategy_name: '冒烟' },
    equip_inventory: { owned: ['blunt_sword', 'crystal_amulet', 'electric_lance'], charges: {} },
    battle_date: '2000-01-01', battle_today: 0,
    battles: { total: 0, win: 0, lose: 0, points: 0 }
  })));
  const ce = caller(envB.ROUTES, 'u-eff');
  const effFight = ce('POST /battle/fight', { oppId: 'spar', skills: ['blast', 'pierce', 'strength'] });
  const allTags = new Set(effFight.body.data.steps.flatMap((s) => s.tags || []));
  check('爆发冲击出手（blast tag）', allTags.has('blast'), [...allTags].join(','));
  const effEffects = ce('GET /battle/build', {}).body.data.equippedEffects;
  check('效果摘要包含攻击加成', !!effEffects.atk, JSON.stringify(effEffects));
  envB.KV.set('u-eff2|desktop_pet', JSON.stringify(pet({
    name: '药水鱼', bond: 200, battle_skills: ['heavy'],
    battle_build: { skills: [], equipment: { consumable: 'flame_potion' }, strategy_name: '' },
    equip_inventory: { owned: [], charges: { flame_potion: 2 } },
    battle_date: '2000-01-01', battle_today: 0,
    battles: { total: 0, win: 0, lose: 0, points: 0 }
  })));
  const cf = caller(envB.ROUTES, 'u-eff2');
  cf('POST /battle/fight', { oppId: 'spar' });
  const after = JSON.parse(envB.KV.get('u-eff2|desktop_pet'));
  check('火焰药水打一场扣一次', (after.equip_inventory.charges.flame_potion || 0) === 1, JSON.stringify(after.equip_inventory));

  // ==================== 9. 野怪掉落 ====================
  console.log('\n[9] 野怪掉落');
  envB.KV.set('u-dropper|desktop_pet', JSON.stringify(pet({ name: '掉落鱼', bond: 150, battle_skills: [] })));
  const cd = caller(envB.ROUTES, 'u-dropper');
  let drops = 0, dustCoins = 0;
  for (let i = 0; i < 24; i++) {
    envB.KV.set('u-dropper|desktop_pet', JSON.stringify(pet({
      name: '掉落鱼', bond: 150, battle_skills: [],
      battle_date: '2000-01-01', battle_today: 0,
      battles: { total: i * 3, win: 0, lose: 0, points: 0 },
      // 状态每轮重置会让 wild_tries 永远是 0 → 掉落流永远同一个值。
      // 直接注入第 i 次尝试数，让每场拿到不同的掉落随机流。
      wild_tries: { huomiao: i }
    })));
    const wr = cd('POST /wild/fight', { id: 'huomiao' });
    if (wr.body.data.drop) {
      drops++;
      if (wr.body.data.drop.dust) dustCoins += wr.body.data.drop.dust;
    }
  }
  check('24 场野怪至少掉 3 次（35% 掉率）', drops >= 3, '实际 ' + drops + ' 次');
  check('重复装备分解给小鱼干', dustCoins > 0);

  // ==================== 10. 平衡抽样 ====================
  console.log('\n[10] 平衡抽样（bond 82 · guard · 每格 200 场）');
  const N = 200;
  async function winRate(uid, skills, oppId) {
    let win = 0;
    for (let i = 0; i < N; i++) {
      envB.KV.set(uid + '|desktop_pet', JSON.stringify(pet({
        name: '平衡鱼', bond: 82,
        battle_date: '2000-01-' + String((i % 28) + 1).padStart(2, '0'),
        battle_today: 0,
        battles: { total: i * 3, win: 0, lose: 0, points: 0 },
        battle_skills: skills
      })));
      const r = caller(envB.ROUTES, uid)('POST /battle/fight', { oppId, skills });
      if (r.body.data.win) win++;
    }
    return Math.round(win / N * 100);
  }
  const bare = { spar: await winRate('u-b0', [], 'spar'), rival: await winRate('u-b0', [], 'rival'), boss: await winRate('u-b0', [], 'boss') };
  const news = {};
  for (const sk of ['blast', 'smash', 'heal', 'berserk', 'guard_stance', 'regen', 'evade', 'sharp', 'strength']) {
    news[sk] = {
      spar: await winRate('u-b1', [sk], 'spar'),
      rival: await winRate('u-b1', [sk], 'rival'),
      boss: await winRate('u-b1', [sk], 'boss')
    };
    console.log('    ' + sk.padEnd(13) + ' spar ' + news[sk].spar + '%  rival ' + news[sk].rival + '%  boss ' + news[sk].boss + '%');
  }
  // 裸装基数：spar 本来就好打，增益空间小，只要求不退步；rival/boss 才要求正增益
  check('最佳新技能增益：boss ≥ +5、rival ≥ +1、spar 不退步',
    Math.max(...Object.values(news).map((x) => x.boss)) - bare.boss >= 5 &&
    Math.max(...Object.values(news).map((x) => x.rival)) - bare.rival >= 1 &&
    Math.max(...Object.values(news).map((x) => x.spar)) >= bare.spar,
    'bare ' + JSON.stringify(bare));
  check('单技能不通吃 boss（全部 < 85%）', Object.values(news).every((x) => x.boss < 85));
  // 满配满槽（传说体 + epic 装备）碾压中期 spar boss 是正常的（那是前期内容），
  // 真正的天花板基准是环境副本 Boss（scale 1.15 + 自带技能包）——它不许被一键通关
  let maxWin = 0;
  for (let i = 0; i < N; i++) {
    envB.KV.set('u-max|desktop_pet', JSON.stringify(pet({
      name: '满配鱼', bond: 200,
      battle_skills: ['blast', 'pierce', 'strength', 'lifesteal', 'finesse'],
      battle_build: { skills: [], equipment: { weapon: 'void_blade', accessory: 'lightning_stone', consumable: null }, strategy_name: '满配' },
      equip_inventory: { owned: ['void_blade', 'lightning_stone'], charges: {} },
      battle_date: '2000-01-' + String((i % 28) + 1).padStart(2, '0'),
      battle_today: 0,
      battles: { total: i * 3, win: 0, lose: 0, points: 0 },
      // 每轮重置存档会让 env_boss_tries 恒 0 → 120 场全是同一场战斗的复制品
      env_boss_tries: { wind_valley: i }
    })));
    const r = caller(envB.ROUTES, 'u-max')('POST /battle/environment/boss', {});
    if (r.body.data.win) maxWin++;
  }
  const maxRate = Math.round(maxWin / N * 100);
  console.log('    满配 vs 环境 Boss：' + maxRate + '%');
  check('满配不一键通关环境 Boss（< 93%）', maxRate < 93, maxRate + '%');
  // 但它也得是「能打赢的挑战」：不能低到让人放弃（> 30%）
  check('环境 Boss 可被满配攻克（> 30%）', maxRate > 30, maxRate + '%');

  envB.restore();
}

unpinDate();
console.log('\n==============================');
console.log(fail === 0 ? '✓ 全部通过：' + pass + ' 项' : '✗ ' + fail + ' 项失败（通过 ' + pass + '）');
process.exitCode = fail === 0 ? 0 : 1;
