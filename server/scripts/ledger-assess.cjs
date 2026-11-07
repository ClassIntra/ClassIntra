// 学元账本 · 迁移前评估（只读，不写任何库）
// 用法：node server/scripts/ledger-assess.cjs [--db <旧库>]
//
// 输出：账户规模 / 三池金额 / 数据质量 / 交易质量 / 迁移结论。
// 结论只分三档：READY（可直接导） / FIX_FIRST（先修数据） / BLOCKED（不能导）。

var path = require('path');
var Database = require('better-sqlite3');
var units = require('../src/ledger/units');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  var v = process.argv[i + 1];
  if (!v || v.slice(0, 2) === '--') return true;
  return v;
}

var dbPath = path.resolve(arg('db') || path.join(__dirname, '..', 'database', 'classintra.db'));
var db = new Database(dbPath, { readonly: true });

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnsOf(name) {
  return db.prepare('PRAGMA table_info(' + name + ')').all().map(function (c) { return c.name; });
}
function fmtYuan(cent) {
  // 统一口径：1 元 = units.UNITS_PER_YUAN 账本单位（见 ledger/units.js）
  return '¥' + (cent / units.UNITS_PER_YUAN).toFixed(2);
}

console.log('\n=== 学元账本 迁移前评估 ===');
console.log('库:', dbPath);

if (!tableExists('xy_account')) {
  console.error('\n✗ 缺少 xy_account，不是学元库');
  process.exit(2);
}

// ---------- 账户规模 ----------
var users = tableExists('users') ? db.prepare('SELECT COUNT(*) n FROM users').get().n : null;
var accounts = db.prepare([
  'SELECT user_id, balance, cash_balance, grant_balance, practice_balance',
  "FROM xy_account WHERE user_id NOT LIKE '@%'"
].join(' ')).all();

var zero = 0;
var negative = [];
var drift = [];
var huge = [];
var total = { cash: 0, grant: 0, practice: 0 };
var HUGE_CENT = 1000000; // 1000 元等值

accounts.forEach(function (a) {
  var c = Number(a.cash_balance || 0);
  var g = Number(a.grant_balance || 0);
  var p = Number(a.practice_balance || 0);
  var b = Number(a.balance || 0);

  total.cash += c;
  total.grant += g;
  total.practice += p;

  if (c + g + p === 0) zero++;
  if (c < 0 || g < 0 || p < 0) negative.push({ user_id: a.user_id, c: c, g: g, p: p });
  if (b !== c + g) drift.push({ user_id: a.user_id, balance: b, sum: c + g });
  if (c + g > HUGE_CENT) huge.push({ user_id: a.user_id, c: c, g: g });
});

console.log('\n--- 规模 ---');
console.log('users 总数        :', users == null ? '（无 users 表）' : users);
console.log('学元账户（非系统）:', accounts.length);
console.log('零余额账户        :', zero);
console.log('有余额账户        :', accounts.length - zero);

console.log('\n--- 金额（账本单位，1 元 = ' + units.UNITS_PER_YUAN + '）---');
console.log('CASH     :', fmtYuan(total.cash));
console.log('GRANT    :', fmtYuan(total.grant));
console.log('PRACTICE :', fmtYuan(total.practice), '（不可兑付）');
console.log('可兑付敞口:', fmtYuan(total.cash));

// ---------- 数据质量 ----------
console.log('\n--- 数据质量 ---');
console.log('balance ≠ cash+grant :', drift.length);
console.log('出现负余额           :', negative.length);
console.log('单账户 > 1000 元     :', huge.length);

function listSample(title, rows, fmt) {
  if (!rows.length) return;
  console.log('  ' + title + '（最多 5 条）：');
  rows.slice(0, 5).forEach(function (r) { console.log('    ' + fmt(r)); });
  if (rows.length > 5) console.log('    …还有 ' + (rows.length - 5) + ' 条');
}
listSample('余额字段不一致', drift, function (r) {
  return r.user_id + ' balance=' + r.balance + ' 分池和=' + r.sum;
});
listSample('负余额', negative, function (r) {
  return r.user_id + ' cash=' + r.c + ' grant=' + r.g + ' practice=' + r.p;
});
listSample('超大余额', huge, function (r) {
  return r.user_id + ' cash=' + r.c + ' grant=' + r.g;
});

// ---------- 交易质量 ----------
console.log('\n--- 交易 ---');
if (tableExists('xy_tx')) {
  var txCount = db.prepare('SELECT COUNT(*) n FROM xy_tx').get().n;
  var noRef = db.prepare("SELECT COUNT(*) n FROM xy_tx WHERE ref IS NULL OR ref = ''").get().n;
  var range = db.prepare('SELECT MIN(created_at) a, MAX(created_at) b FROM xy_tx').get();
  var kinds = db.prepare('SELECT kind, COUNT(*) n FROM xy_tx GROUP BY kind ORDER BY n DESC LIMIT 8').all();

  console.log('交易总数 :', txCount);
  console.log('无 ref   :', noRef, noRef > 0 ? '（不可幂等重放）' : '');
  console.log('时间范围 :', range.a, '→', range.b);
  console.log('类型分布 :', kinds.map(function (k) { return k.kind + '=' + k.n; }).join('  '));
} else {
  console.log('（无 xy_tx 表）');
}

// ---------- 可兑付敞口的真金支撑 ----------
// 只校验「账内一致」是不够的：账可以自洽却没有任何真金。
// 真实到账 = xy_recharge.yuan_cents（人民币分）× 10（1 元 = 1000 学元分）。
console.log('\n--- 可兑付敞口的真金支撑 ---');
var fundedCent = 0;
var rechargeRows = 0;
if (tableExists('xy_recharge')) {
  var r = db.prepare([
    'SELECT COUNT(*) n, COALESCE(SUM(yuan_cents), 0) y',
    'FROM xy_recharge WHERE COALESCE(revoked_at, 0) = 0'
  ].join(' ')).get();
  rechargeRows = r.n;
  fundedCent = r.y * 10;
  console.log('有效充值笔数     :', r.n);
  console.log('实收人民币       :', '¥' + (r.y / 100).toFixed(2));
  console.log('折算可兑付额度   :', fmtYuan(fundedCent));
} else {
  console.log('（无 xy_recharge 表）');
}

var cover = total.cash === 0 ? 1 : fundedCent / total.cash;
console.log('账上可兑付敞口   :', fmtYuan(total.cash));
console.log('覆盖率           :', (cover * 100).toFixed(1) + '%');
console.log('无真金支撑的缺口 :', fmtYuan(Math.max(0, total.cash - fundedCent)));

if (tableExists('xy_entry') && tableExists('xy_tx')) {
  var cashByKind = db.prepare([
    "SELECT t.kind, COUNT(*) n, SUM(e.delta) s",
    'FROM xy_entry e JOIN xy_tx t ON t.id = e.tx_id',
    "WHERE e.pool = 'cash' GROUP BY t.kind ORDER BY s DESC"
  ].join('\n')).all();
  if (cashByKind.length) {
    console.log('  CASH 池来源：');
    cashByKind.forEach(function (k) {
      console.log('    ' + String(k.kind).padEnd(10) + String(k.n).padStart(5) + ' 笔 ' +
        String(k.s).padStart(12) + ' 分');
    });
  }
}

// ---------- 迁移结论 ----------
console.log('\n--- 结论 ---');
var verdict = 'READY';
var reasons = [];

if (cover < 1) {
  verdict = 'FIX_FIRST';
  reasons.push('可兑付敞口只有 ' + (cover * 100).toFixed(1) + '% 有真金支撑（实收 ¥' +
    (fundedCent / units.UNITS_PER_YUAN).toFixed(2) +
    ' / 敞口 ¥' + (total.cash / units.UNITS_PER_YUAN).toFixed(2) +
    '），直接导入等于在账上承认一笔兑不出来的负债');
}

if (negative.length) {
  verdict = 'FIX_FIRST';
  reasons.push('存在 ' + negative.length + ' 个负余额账户，导入时会被归零，需先确认原因');
}
if (drift.length) {
  if (verdict === 'READY') verdict = 'FIX_FIRST';
  reasons.push(drift.length + ' 个账户 balance ≠ cash+grant，导入按分池口径（不影响金额，但报表会对不上）');
}
if (huge.length) {
  reasons.push(huge.length + ' 个账户超过 1000 元等值，建议人工确认是否历史脏数据');
}

var labels = {
  READY: '✓ 可直接导入（先 dry-run 再 apply）',
  FIX_FIRST: '⚠️ 建议先修数据再导入（见上方清单）',
  BLOCKED: '✗ 不能导入'
};
console.log(labels[verdict]);
reasons.forEach(function (r) { console.log('  · ' + r); });

console.log('\n下一步：');
console.log('  1) node server/scripts/ledger-init.cjs <副本.db>');
console.log('  2) node server/scripts/ledger-opening.cjs --src <旧库> --dst <副本.db> --rate 1   # dry-run');
console.log('  3) node server/scripts/ledger-reconcile.cjs --old <旧库> --new <副本.db>');
console.log('');

db.close();
process.exit(verdict === 'BLOCKED' ? 1 : 0);
