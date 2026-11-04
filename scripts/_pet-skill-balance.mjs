// 技能强度抽样：对比「不带技能 / 只带某一个技能 / 带满两个」的胜率，
// 确认技能是有意义的强化，但没有强到「不带就没法玩」。
// 用法：node scripts/_pet-skill-balance.mjs [bond] [N]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server/package.json'));

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
require(join(REPO, '..', 'market', 'apps', 'pet', 'backend', 'routes.js'));

const UID = 'u-skill';
const BOND = Number(process.argv[2] || 82);
const N = Number(process.argv[3] || 300);
const TACTIC = process.argv[4] || 'guard';

function call(key, body) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { resolve({ http: this.code, body: p }); } };
    ROUTES[key]({ user: { user_id: UID }, body: body || {} }, res, () => {});
  });
}
const put = (st) => KV.set(UID + '|desktop_pet', JSON.stringify(st));
const base = { adopted: true, name: '测试鱼', bond: BOND, design: { type: 'video', character: 'dsh-whale' } };
const pad = (s, n) => String(s).padEnd(n);

// 每一行 = 一种技能组合，跑三个对手
const COMBOS = [
  { label: '（不带）', skills: [] },
  { label: '千钧一击', skills: ['heavy'] },
  { label: '鲸吞',     skills: ['lifesteal'] },
  { label: '泡泡护盾', skills: ['shield'] },
  { label: '连打',     skills: ['combo'] },
  { label: '破甲',     skills: ['pierce'] },
  { label: '千钧+连打', skills: ['heavy', 'combo'] },
  { label: '鲸吞+护盾', skills: ['lifesteal', 'shield'] }
];
const OPPONENTS = ['spar', 'rival', 'boss'];

console.log('玩家羁绊 ' + BOND + '，战术 ' + TACTIC + '，每格 ' + N + ' 场\n');
console.log(pad('技能', 16) + OPPONENTS.map((o) => pad(o, 10)).join('') + '平均');
const rates = {};
for (const c of COMBOS) {
  let line = pad(c.label, 16);
  let sum = 0;
  rates[c.label] = {};
  for (const opp of OPPONENTS) {
    let win = 0;
    for (let i = 0; i < N; i++) {
      put(Object.assign({}, base, {
        battle_date: '2000-01-' + String((i % 28) + 1).padStart(2, '0'),
        battle_today: 0,
        battles: { total: i * 3, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
        battle_tactic: TACTIC,
        battle_skills: c.skills
      }));
      const r = await call('POST /battle/fight', { oppId: opp, tactic: TACTIC, skills: c.skills });
      if (r.body.data && r.body.data.win) win++;
    }
    const rate = Math.round(win / N * 100);
    rates[c.label][opp] = rate;
    sum += rate;
    line += pad(rate + '%', 10);
  }
  console.log(line + Math.round(sum / OPPONENTS.length) + '%');
}

console.log('\n判定:');
let bad = 0;
const bare = rates['（不带）'];
for (const opp of OPPONENTS) {
  const withSkill = COMBOS.slice(1).map((c) => rates[c.label][opp]);
  const best = Math.max(...withSkill);
  const gain = best - bare[opp];
  console.log('  ' + pad(opp, 6) + ' 不带 ' + pad(bare[opp] + '%', 5) + ' 最佳技能 ' + pad(best + '%', 5) + ' 提升 ' + gain + ' 个点');
  if (gain < 3) { console.log('    ⚠️ 技能对这个对手几乎没用'); bad++; }
  // 通吃判定：允许某个单技能在某档位领先（那是它的定位），
  // 禁止的是「带满两个技能就无脑赢」——所以只看双技能组合的上限。
  const pairBest = COMBOS.filter((c) => c.skills.length === 2)
    .reduce((mx, c) => Math.max(mx, rates[c.label][opp]), 0);
  if (opp === 'boss' && pairBest >= 88) {
    console.log('    ⚠️ 双技能组合能通吃 boss（' + pairBest + '%）'); bad++;
  }
}
console.log(bad === 0 ? '\nOK: 技能有明确增益，但没有一键通关' : '\n❌ ' + bad + ' 项需要调整');
process.exitCode = bad === 0 ? 0 : 1;
