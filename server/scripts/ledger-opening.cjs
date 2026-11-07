// 学元账本 · 期初导入（S5 工具，默认 dry-run）
// ============================================================
// 只做一件事：把旧 xy_account 的三个池余额，按换算系数转成新账本的三种资产。
//
// 用法：
//   node server/scripts/ledger-opening.cjs --src <旧库> --dst <新库>              # 只统计
//   node server/scripts/ledger-opening.cjs --src <旧库> --dst <新库> --apply      # 写入
//   --rate 10   旧学元 → 新分 的除数（1 元 = 1000 学元 = 100 分 ⇒ 10）
//
// 刻意不做的事：
//   - 不搬交易流水（entries 是旧账的语义，搬过来会把旧口径带进新账）
//   - 不搬脏数据：balance ≠ cash + grant 的账户只告警，按分池余额导入
//   - 不删旧库：旧 xy_* 保持只读归档
//
// 幂等：每人每池一个固定 ref，重跑不会翻倍。

var fs = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  var v = process.argv[i + 1];
  if (!v || v.slice(0, 2) === '--') return true;
  return v;
}

var src = arg('src');
var dst = arg('dst');
var rate = Number(arg('rate', 10));
var apply = process.argv.indexOf('--apply') !== -1;

if (!src || !dst || !isFinite(rate) || rate <= 0) {
  console.log('用法: node server/scripts/ledger-opening.cjs --src <旧库> --dst <新库> [--rate 10] [--apply]');
  process.exit(1);
}

var srcPath = path.resolve(src);
var dstPath = path.resolve(dst);

if (!fs.existsSync(srcPath)) {
  console.error('旧库不存在: ' + srcPath);
  process.exit(1);
}

var oldDb = new Database(srcPath, { readonly: true });
var hasAccount = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_account'").get();
if (!hasAccount) {
  console.error('旧库缺少 xy_account 表，无法导入');
  process.exit(1);
}

console.log('\n=== 学元账本 期初导入 ===');
console.log('源库  :', srcPath);
console.log('目标库:', dstPath);
console.log('换算  : 旧 ' + rate + ' 学元 = 新 1 分');
console.log('模式  :', apply ? '写入（--apply）' : 'dry-run（不写库）');

var rows = oldDb.prepare([
  'SELECT user_id, balance, cash_balance, grant_balance, practice_balance',
  'FROM xy_account WHERE user_id NOT LIKE \'@%\' ORDER BY user_id'
].join(' ')).all();

var plan = [];
var warnings = [];
var sums = { cash: 0, grant: 0, practice: 0 };
var skipped = 0;

rows.forEach(function (r) {
  var rawBalance = Number(r.balance || 0);
  var rawCash = Number(r.cash_balance || 0);
  var rawGrant = Number(r.grant_balance || 0);
  var rawPractice = Number(r.practice_balance || 0);

  if (rawBalance !== rawCash + rawGrant) {
    warnings.push(r.user_id + '：balance(' + rawBalance + ') ≠ cash+grant(' + (rawCash + rawGrant) + ')，按分池余额导入');
  }

  var cash = Math.max(0, Math.round(rawCash / rate));
  var grant = Math.max(0, Math.round(rawGrant / rate));
  var practice = Math.max(0, Math.round(rawPractice / rate));

  if (cash + grant + practice === 0) { skipped++; return; }
  plan.push({ user_id: String(r.user_id), cash: cash, grant: grant, practice: practice });
  sums.cash += cash;
  sums.grant += grant;
  sums.practice += practice;
});

// --funded-only：按「真实充值」截断 CASH，超出部分转成 GRANT。
// 用于历史库里「证券交易洗进充值池」的归位：总额不变，只是可兑付部分回到真金水平。
var fundedOnly = process.argv.indexOf('--funded-only') !== -1;
var convertedCent = 0;

if (fundedOnly) {
  var hasRecharge = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_recharge'").get();
  var fundedMap = {};
  if (hasRecharge) {
    oldDb.prepare([
      'SELECT user_id, COALESCE(SUM(yuan_cents), 0) AS y',
      'FROM xy_recharge WHERE COALESCE(revoked_at, 0) = 0 GROUP BY user_id'
    ].join(' ')).all().forEach(function (r) {
      // yuan_cents 是人民币分；1 元 = 1000 学元分 ⇒ ×10
      fundedMap[String(r.user_id)] = Number(r.y) * 10;
    });
  }
  plan.forEach(function (p) {
    var cap = fundedMap[p.user_id] || 0;
    if (p.cash > cap) {
      var moved = p.cash - cap;
      p.grant += moved;
      p.cash = cap;
      convertedCent += moved;
    }
  });

  sums = { cash: 0, grant: 0, practice: 0 };
  plan.forEach(function (p) {
    sums.cash += p.cash;
    sums.grant += p.grant;
    sums.practice += p.practice;
  });
}

console.log('');
console.log('账户总数 :', rows.length);
console.log('需导入   :', plan.length, '（零余额跳过 ' + skipped + '）');
console.log('CASH     :', (sums.cash / 1000).toFixed(2), '元');
console.log('GRANT    :', (sums.grant / 1000).toFixed(2), '元等值');
console.log('PRACTICE :', (sums.practice / 1000).toFixed(2), '元等值（不可兑付）');
if (fundedOnly) {
  console.log('归位     : CASH→GRANT ' + (convertedCent / 1000).toFixed(2) + ' 元（无真金支撑部分）');
}
if (warnings.length) {
  console.log('\n⚠️ 脏数据 ' + warnings.length + ' 条：');
  warnings.slice(0, 10).forEach(function (w) { console.log('   ' + w); });
  if (warnings.length > 10) console.log('   …还有 ' + (warnings.length - 10) + ' 条');
}

if (!apply) {
  console.log('\ndry-run 结束，未写入。确认无误后加 --apply。\n');
  process.exit(0);
}

process.env.DB_PATH = dstPath;
var db = require('../src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'ledger', 'schema.sql'), 'utf8'));

var svc = require('../src/ledger/service');
svc.ensureReady();
var ledger = require('../src/ledger/ledger');
var cashbook = require('../src/ledger/cashbook');
var clearingId = ledger.systemAccount('clearing').id;

var written = 0;
var skippedDup = 0;

var run = db.transaction(function () {
  plan.forEach(function (p) {
    var u = ledger.openUser(p.user_id);

    if (p.cash > 0) {
      var refCash = 'opening:cash:' + p.user_id;
      var t1 = ledger.post({
        ref: refCash, kind: 'recharge', initiator: 'opening', memo: '期初导入·充值学元',
        entries: [
          { account_id: clearingId, asset: 'CASH', direction: -1, amount_cent: p.cash },
          { account_id: u.id, asset: 'CASH', direction: 1, amount_cent: p.cash }
        ]
      });
      if (t1.duplicate) skippedDup++; else written++;
      cashbook.record({ tx_id: t1.tx_id, type: 'recharge', amount_cent: p.cash, ref: refCash + ':cash', note: '期初导入' });
    }

    if (p.grant > 0) {
      var t2 = ledger.post({
        ref: 'opening:grant:' + p.user_id, kind: 'grant', initiator: 'opening', memo: '期初导入·赠送学元',
        entries: [
          { account_id: clearingId, asset: 'GRANT', direction: -1, amount_cent: p.grant },
          { account_id: u.id, asset: 'GRANT', direction: 1, amount_cent: p.grant }
        ]
      });
      if (t2.duplicate) skippedDup++; else written++;
    }

    if (p.practice > 0) {
      var t3 = ledger.post({
        ref: 'opening:practice:' + p.user_id, kind: 'practice', initiator: 'opening', memo: '期初导入·练习金',
        entries: [
          { account_id: clearingId, asset: 'PRACTICE', direction: -1, amount_cent: p.practice },
          { account_id: u.id, asset: 'PRACTICE', direction: 1, amount_cent: p.practice }
        ]
      });
      if (t3.duplicate) skippedDup++; else written++;
    }
  });
});
run();

var report = svc.invariants.check({ reserveCent: svc.invariants.cashOnBookCent() });
console.log('\n✓ 写入交易:', written, '笔（跳过重复 ' + skippedDup + '）');
console.log('✓ 自检:', report.ok ? '全部通过' : report.issues.length + ' 项异常');
report.issues.slice(0, 10).forEach(function (i) { console.log('   ✗ [' + i.code + '] ' + i.detail); });

// 期初数据不能留在 WAL 里：显式 checkpoint 再退出
try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.error('checkpoint 失败:', e.message); }

console.log('\n提示：旧库已只读归档，请勿删除（审计与回溯需要）。\n');
process.exit(report.ok ? 0 : 1);
