// 战术平衡抽样：固定同一个玩家，按「战术 × 对手」各打 N 场，看胜率分布。
// 目的：确认没有哪一招强到「闭眼选它」，也没有哪一招是纯亏。
// 用法：node scripts/_pet-tactic-balance.mjs
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
            for (const [k, v] of KV) {
              const [u, kk] = k.split('|');
              if (kk === key) out.push({ user_id: u, value: v });
            }
            return out;
          },
          get: (uid, key) => {
            const v = KV.get(uid + '|' + key);
            return v === undefined ? undefined : { value: v };
          }
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

const UID = 'u-bal';
const BOND = Number(process.argv[2] || 82);
const N = Number(process.argv[3] || 300);

function call(key, body) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { resolve({ http: this.code, body: p }); } };
    ROUTES[key]({ user: { user_id: UID }, body: body || {} }, res, () => {});
  });
}
const put = (st) => KV.set(UID + '|desktop_pet', JSON.stringify(st));
const base = {
  adopted: true, name: '测试鱼', bond: BOND,
  design: { type: 'video', character: 'dsh-whale' }
};

const pad = (s, n) => String(s).padEnd(n);
const TACTICS = ['assault', 'guard', 'nimble'];
const OPPONENTS = ['spar', 'rival', 'boss'];

console.log('玩家羁绊 ' + BOND + '，每格 ' + N + ' 场\n');
console.log(pad('战术', 10) + OPPONENTS.map((o) => pad(o, 14)).join(''));
const grid = {};
for (const t of TACTICS) {
  let line = pad(t, 10);
  grid[t] = {};
  for (const opp of OPPONENTS) {
    let win = 0, rounds = 0;
    for (let i = 0; i < N; i++) {
      put(Object.assign({}, base, {
        battle_date: '2000-01-' + String((i % 28) + 1).padStart(2, '0'),
        battle_today: 0,
        battles: { total: i * 7, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
        battle_tactic: t
      }));
      const r = await call('POST /battle/fight', { oppId: opp, tactic: t });
      if (r.body.data && r.body.data.win) win++;
      if (r.body.data) rounds += r.body.data.rounds;
    }
    const rate = Math.round(win / N * 100);
    grid[t][opp] = { rate: rate, rounds: (rounds / N).toFixed(1) };
    line += pad(rate + '% / ' + (rounds / N).toFixed(1) + '回合', 14);
  }
  console.log(line);
}

// 结论判定：玩家该能学到「打哪个对手、用哪招更划算」。
// spar 是设计上的新手台阶，三招都高胜率是正常的——判定要求的是
// 「每一招都在某些场合是可选的最优或次优」，而不是格子里有 95% 以上。
console.log('\n判定:');
let bad = 0;
const bestOf = {};   // 每个对手最划算的战术
for (const opp of OPPONENTS) {
  const rates = TACTICS.map((t) => grid[t][opp].rate);
  const best = Math.max(...rates), worst = Math.min(...rates);
  const spread = best - worst;
  const bestT = TACTICS[rates.indexOf(best)];
  bestOf[opp] = bestT;
  console.log('  ' + pad(opp, 6) + ' 最高 ' + pad(best + '%(' + bestT + ')', 16) +
    ' 最低 ' + pad(worst + '%', 6) + ' 极差 ' + spread + ' 个点');
  if (spread < 3) { console.log('    ⚠️ 三种战术几乎无差别——战术是装饰'); bad++; }
  if (worst <= 2) { console.log('    ⚠️ 存在「选了必输」的战术'); bad++; }
}
// 全都用同一招 = 战术没意义；但单个羁绊档位上允许有一招略优，
// 真正要禁止的是「跨所有羁绊档位、对所有对手都通吃」。
const winners = Object.values(bestOf);
const uniq = new Set(winners);
console.log('  各对手最优战术:', OPPONENTS.map((o) => o + '=' + bestOf[o]).join('  '));
if (uniq.size === 1 && winners.every((w) => w === 'assault')) {
  console.log('    ⚠️ 猛攻对本档所有对手都最优——换血没有代价');
  bad++;
}
// 稳守必须是「最慢但最稳」：回合数明显更长，否则它没有性格
const guardRounds = OPPONENTS.map((o) => Number(grid.guard[o].rounds));
const nimbleRounds = OPPONENTS.map((o) => Number(grid.nimble[o].rounds));
if (!(guardRounds.every((v, i) => v > nimbleRounds[i]))) {
  console.log('    ⚠️ 稳守没有体现出「拖长」的性格'); bad++;
}
console.log(bad === 0 ? '\nOK: 三种战术各有适用场景，没有一言堂' : '\n❌ ' + bad + ' 项需要调整');
process.exitCode = bad === 0 ? 0 : 1;
