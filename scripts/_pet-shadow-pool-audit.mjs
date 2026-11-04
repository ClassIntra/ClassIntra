// 用真库离线核对影子池：对每个真实玩家，看他今天会拿到哪些对手，够不够打。
// 只读，不写任何数据，也不需要服务在跑。
// 用法：node scripts/_pet-shadow-pool-audit.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(join(REPO, 'server/database/classintra.db'));

const ROUTES = {};
const pick = (a) => a[a.length - 1];
const fakeRouter = {
  get: (...a) => { ROUTES['GET ' + a[0]] = pick(a); },
  post: (...a) => { ROUTES['POST ' + a[0]] = pick(a); },
  put: (...a) => { ROUTES['PUT ' + a[0]] = pick(a); }
};

const realDb = {
  prepare(sql) { return db.prepare(sql); }
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'express') return { Router: () => fakeRouter };
  if (/middleware[\\/]auth$/.test(request)) return { requireAuth: (q, s, n) => n() };
  if (/utils[\\/]db$/.test(request)) return realDb;
  return origLoad.apply(this, arguments);
};
require(join(REPO, '..', 'market', 'apps', 'pet', 'backend', 'routes.js'));

function call(uid) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(p) { resolve(p); } };
    ROUTES['GET /battle/profile']({ user: { user_id: uid } }, res, () => {});
  });
}

const rows = db.prepare("SELECT user_id, value FROM user_kv_store WHERE key='desktop_pet'").all();
const people = [];
for (const r of rows) {
  try {
    const s = JSON.parse(r.value);
    if (s.adopted) people.push({ uid: String(r.user_id), name: s.name || '?', bond: s.bond || 0 });
  } catch (e) {}
}
people.sort((a, b) => a.bond - b.bond);
console.log('已领养 ' + people.length + ' 人\n');

let empty = 0, worstRatio = 0, worstWho = '';
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('uid', 9) + pad('宠物', 12) + pad('羁绊', 6) + pad('战力', 6) + '影子数  对手（羁绊/难度）');
for (const p of people) {
  const r = await call(p.uid);
  const d = r.data;
  const mine = d.combat.power;
  const sh = d.shadows || [];
  if (!sh.length) empty++;
  for (const s of sh) {
    const ratio = Math.max(s.power, mine) / Math.min(s.power, mine);
    if (ratio > worstRatio) { worstRatio = ratio; worstWho = p.name + ' 撞 ' + s.name; }
  }
  console.log(
    pad(p.uid, 9) + pad(p.name.slice(0, 10), 12) + pad(p.bond, 6) + pad(mine, 6) +
    pad(sh.length, 8) + (sh.length ? sh.map((s) => s.bond + '/' + s.oddsText).join(' ') : '（空——只能打练习赛）')
  );
}

console.log('\n汇总:');
console.log('  一个人都排不到的：' + empty + ' / ' + people.length);
console.log('  最坏战力差：' + worstRatio.toFixed(2) + ' 倍（' + worstWho + '）');
const avg = people.length ? (people.reduce((s, p) => s + p.bond, 0) / people.length).toFixed(1) : 0;
console.log('  全班平均羁绊：' + avg);
db.close();
