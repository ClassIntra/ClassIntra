// 试炼塔难度曲线：测「同一层反复挑战的通过率」，这才是难度的真实手感。
// 之前的脚本统计「首次通过率」，全是 100%/0%——那是统计口径错了，不是塔的设计问题。
// 用法：node scripts/_pet-tower-curve.mjs
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

const UID = 'u-tower';
function call(key, body) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { resolve({ http: this.code, body: p }); } };
    ROUTES[key]({ user: { user_id: UID }, body: body || {} }, res, () => {});
  });
}
const put = (st) => KV.set(UID + '|desktop_pet', JSON.stringify(st));
const pad = (s, n) => String(s).padEnd(n);

const BONDS = [17, 40, 82, 120, 160];
const TRIES = 30;
const data = [];
console.log(pad('羁绊', 7) + pad('战力', 7) + Array.from({ length: 10 }, (_, i) => pad('L' + (i + 1), 5)).join(''));
for (const bond of BONDS) {
  let line = '';
  const rates = [];
  for (let f = 1; f <= 10; f++) {
    let win = 0;
    for (let i = 0; i < TRIES; i++) {
      // 每次 put 都把玩家放回「已通到 f-1 层」再打第 f 层。
      // ⚠️ 但 seed 里带「这一层试过几次」，所以要先给一个不同的 tries 起点，
      //    否则 30 次跑的是同一个 seed，结果当然全是 0% 或 100%。
      put({
        adopted: true, name: '爬塔鱼', bond,
        battle_date: '2000-01-01', battle_today: 0,
        tower_date: '2000-01-01', tower_today: 0,
        tower_floor: f - 1,
        tower_tries: { [String(f)]: i },
        battles: { total: 0, win: 0, lose: 0, points: 0, streak: 0, best: 0 },
        battle_tactic: 'guard',
        battle_skills: ['heavy', 'pierce']
      });
      const r = await call('POST /tower/fight', {});
      if (r.http === 200 && r.body.data.win) win++;
    }
    const rate = Math.round(win / TRIES * 100);
    rates.push(rate);
    line += pad(rate + '%', 5);
  }
  const prof = await call('GET /battle/profile');
  console.log(pad(bond, 7) + pad(prof.body.data.combat.power, 7) + line);
  data.push({ bond, rates });
}

console.log('\n期望: 每行从左到右递减，且中间楼层有 30–70% 的过渡带（不是 100% 直落 0%）。');

// ---- 自动判定 ----
// 判定标准不是「必须完全单调」（整数台阶会有噪声），而是：
//   1) 每行从左到右不上升（允许 5 个点的噪声）
//   2) 全表至少要有 4 个落在 10%–90% 的「过渡格」
//   3) 最高羁绊也过不了第 10 层（塔顶必须是真挑战）
let problems = 0;
for (const row of data) {
  for (let i = 1; i < row.rates.length; i++) {
    if (row.rates[i] > row.rates[i - 1] + 5) {
      console.log('  ⚠️ bond ' + row.bond + ' 第 ' + (i + 1) + ' 层比第 ' + i + ' 层更容易（' +
        row.rates[i - 1] + '% → ' + row.rates[i] + '%），难度曲线不单调');
      problems++;
      break;
    }
  }
}
const mid = data.flatMap((r) => r.rates).filter((v) => v >= 10 && v <= 90).length;
console.log('  过渡格（10%–90%）: ' + mid + ' 个');
if (mid < 4) { console.log('  ⚠️ 过渡带太少，玩法会表现为「一路平推然后突然撞墙」'); problems++; }
const top = data.find((r) => r.bond === 160);
if (top && top.rates[9] > 50) { console.log('  ⚠️ 最高羁绊能轻松过塔顶，塔就没有终点了'); problems++; }

console.log(problems === 0 ? '\nOK: 塔的难度曲线单调、有过渡带、塔顶是真挑战'
  : '\n❌ ' + problems + ' 项需要调整');
process.exitCode = problems === 0 ? 0 : 1;
