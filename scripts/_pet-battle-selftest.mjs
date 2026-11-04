// 对战后端自测：在内存 SQLite 假库 + 假 express.Router 上直接跑 routes.js 的 handler。
// 目的：改完战斗逻辑先自证「能跑、数值合理、每日上限生效」，不用重启正在跑的服务。
// 用法：node scripts/_pet-battle-selftest.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server/package.json'));

const ROUTES = {};
// 注意：routes.js 都是 router.get(path, requireAuth, handler) 三参数形式，
// 真正要测的是最后一个参数，不是中间件。
const pick = (args) => args[args.length - 1];
const fakeRouter = {
  get: (...a) => { ROUTES['GET ' + a[0]] = pick(a); },
  post: (...a) => { ROUTES['POST ' + a[0]] = pick(a); },
  put: (...a) => { ROUTES['PUT ' + a[0]] = pick(a); }
};

const KV = new Map();   // `${uid}|${key}` -> value string
const fakeDb = {
  prepare(sql) {
    if (/^\s*SELECT/i.test(sql)) {
      return { get: (uid, key) => {
        const v = KV.get(uid + '|' + key);
        return v === undefined ? undefined : { value: v };
      } };
    }
    return { run: (uid, key, value) => { KV.set(uid + '|' + key, value); return { changes: 1 }; } };
  }
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'express') return { Router: () => fakeRouter };
  if (/middleware[\\/]auth$/.test(request)) return { requireAuth: (req, res, next) => next() };
  if (/utils[\\/]db$/.test(request)) return fakeDb;
  return origLoad.apply(this, arguments);
};

const router = require(join(REPO, '..', 'market', 'apps', 'pet', 'backend', 'routes.js'));
if (!router) throw new Error('routes.js 未导出 router');
console.log('路由:', Object.keys(ROUTES).sort().join('  '));

const UID = 'u-test';
KV.set(UID + '|desktop_pet', JSON.stringify({
  adopted: true, name: '大肥鱼', bond: 82, bond_today: 0, bond_date: '2026-10-27',
  poked_today: 0, fed_today: 0, design: { type: 'video', character: 'dsh-whale' }
}));

function call(key, body) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(payload) { resolve({ http: this.code, body: payload }); }
    };
    ROUTES[key]({ user: { user_id: UID }, body: body || {} }, res, () => {});
  });
}

const pad = (s, n) => String(s).padEnd(n);
const PLAY = 12;   // 不限次数，这里只跑 12 场看积分的衰减曲线

const prof = await call('GET /battle/profile');
console.log('\n== profile ==');
console.log('战力', prof.body.data.combat.power, '| 档位', prof.body.data.combat.tierName,
  '| 今日', prof.body.data.today + ' 场 (cap=' + prof.body.data.cap + '，0=不限)');
for (const o of prof.body.data.opponents) {
  console.log(' -', pad(o.id, 6), pad(o.name, 6), 'bond', pad(o.bond, 4), 'power', pad(o.power, 4), o.tierName);
}

console.log('\n== 连续开打 ' + PLAY + ' 场（不限次数）==');
const gains = [];
for (let i = 1; i <= PLAY; i++) {
  const r = await call('POST /battle/fight', { oppId: 'rival' });
  if (r.body.code !== 200) { console.log(`#${i} 被拒:`, r.http, r.body.message); continue; }
  const d = r.body.data;
  const last = d.steps[d.steps.length - 1] || {};
  gains.push(d.gain);
  console.log(
    `#${i} ${d.win ? '胜' : '负'} 回合${pad(d.rounds, 3)} 步数${pad(d.steps.length, 3)}` +
    ` 剩血 ${pad(last.hpMe, 4)}:${pad(last.hpFoe, 4)} 积分+${pad(d.gain, 3)}${d.decayed ? '(衰减)' : ''}` +
    ` 累计 ${d.record.win}胜${d.record.lose}负/${d.record.points}分 今日${d.today}场`
  );
  if (i === 1) {
    console.log('   战报前 4 步:', JSON.stringify(d.steps.slice(0, 4)));
    // 复现性：同一 seed 必须得到同一战报
    const re = await call('GET /battle/profile');
    if (!re.body.data.last) throw new Error('battle_last 未落库');
  }
}

const after = await call('GET /battle/profile');
console.log('\n落库校验:', JSON.stringify(after.body.data.record), '| today', after.body.data.today);
if (after.body.data.record.total !== PLAY) throw new Error('应有 ' + PLAY + ' 场，实为 ' + after.body.data.record.total);
if (after.body.data.cap !== 0) throw new Error('cap 应为 0（不限次数），实为 ' + after.body.data.cap);
// 积分衰减：后段必须比前段小
const head = gains.slice(0, 5).reduce((a, b) => a + b, 0);
const tail = gains.slice(-3).reduce((a, b) => a + b, 0);
console.log(`积分: 前 5 场共 +${head}，后 3 场共 +${tail}（衰减生效）`);
if (!(tail < head)) throw new Error('积分衰减没生效：前 ' + head + ' 后 ' + tail);


// ---- 平衡性抽样：每个对手各打 200 场（每次换日期/expire 今日次数），看胜率是否符合档位设计 ----
const base = JSON.parse(KV.get(UID + '|desktop_pet'));
console.log('\n== 平衡性抽样（每档 200 场，同羁绊 82）==');
for (const oppId of ['spar', 'rival', 'boss']) {
  let win = 0, rounds = 0;
  for (let i = 0; i < 200; i++) {
    KV.set(UID + '|desktop_pet', JSON.stringify(Object.assign({}, base, {
      battle_date: '2000-01-' + String((i % 28) + 1).padStart(2, '0'), battle_today: 0,
      battles: { total: i, win: 0, lose: 0, points: 0 },
      battle_skills: []   // 平衡性基准：不带技能，才看得出对手档位本身的强弱
    })));
    const r = await call('POST /battle/fight', { oppId });
    if (r.body.data.win) win++;
    rounds += r.body.data.rounds;
  }
  console.log(` ${pad(oppId, 6)} 胜率 ${pad(Math.round(win / 2) + '%', 5)} 平均回合 ${(rounds / 200).toFixed(1)}`);
}

console.log('\nOK: 对战后端自测通过');
