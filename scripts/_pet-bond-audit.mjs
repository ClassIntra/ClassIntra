// 只读审计：把所有桌宠状态的 bond / 档位 / 档位百分比 / 还差 打出来
// 用途：验证「摸摸 38 -> 37」到底是哪个数字在变（绝对值不可能减，只能是 UI 上的派生量）
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(join(REPO, 'server/database/classintra.db'), { readonly: true });

const TIER = [0, 20, 60, 120, 200];
const NAMES = ['初识', '熟悉', '亲密', '形影不离', '灵魂伙伴'];
const tierOf = (b) => { let t = 0; for (let i = 0; i < TIER.length; i++) if (b >= TIER[i]) t = i; return t; };

const rows = db.prepare("SELECT user_id, value FROM user_kv_store WHERE key = 'desktop_pet'").all();
const out = rows.map((r) => {
  let s = {};
  try { s = JSON.parse(r.value) || {}; } catch (e) { s = {}; }
  const b = s.bond || 0;
  const t = tierOf(b);
  const next = t + 1 < TIER.length ? TIER[t + 1] : null;
  return {
    uid: r.user_id,
    bond: b,
    tier: NAMES[t],
    next,
    left: next === null ? 0 : next - b,
    pct: next === null ? 100 : Math.round((b - TIER[t]) / (next - TIER[t]) * 100),
    poked: s.poked_today || 0,
    fed: s.fed_today || 0,
    today: s.bond_today || 0,
    date: s.bond_date || ''
  };
});
out.sort((a, b) => b.bond - a.bond);

console.log('uid\tbond\ttier\tnext\tleft\tpct\tpoked\tfed\ttoday\tdate');
for (const o of out) {
  console.log([o.uid, o.bond, o.tier, o.next, o.left, o.pct, o.poked, o.fed, o.today, o.date].join('\t'));
}
console.log('\n--- 还差 在 35..40 区间的用户（39/38/37 会被用户读成「羁绊值」）---');
for (const o of out) if (o.left >= 35 && o.left <= 40) console.log(JSON.stringify(o));
console.log('\n--- 档位百分比 在 35..40 区间的用户 ---');
for (const o of out) if (o.pct >= 35 && o.pct <= 40) console.log(JSON.stringify(o));
