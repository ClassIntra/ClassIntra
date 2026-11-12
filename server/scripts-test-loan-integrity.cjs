// 学元信用 v2.3 · 健全性验收（防刷分 / 额度按自然日成长 / 高水位）
// 用法：node server/scripts-test-loan-integrity.cjs
//
// 这套规则防的是最容易钻的空子：
//   100 学元借出来、立刻还回去，利息 5 学元，就能 +40 分、额度 +500；
//   同一天重复三次，成本 15 学元就能把新号刷到 2000 额度。
// v2.3 起：按时还清 24 小时内只计一次分；额度只按「不同的自然日」成长。
// 高水位只用于规则切换时兜住历史额度，且始终受当前等级 cap 约束。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-loan-integrity-'));
process.env.DB_PATH = path.join(tmpDir, 'integrity.db');
process.env.NODE_ENV = 'test';
process.env.XUEYUAN_LOAN_POOL_YUAN = '10';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
db.exec([
  'CREATE TABLE IF NOT EXISTS users (',
  '  user_id TEXT PRIMARY KEY, net_name TEXT, real_name TEXT,',
  "  password_hash TEXT, status TEXT DEFAULT 'active'",
  ')'
].join('\n'));

var svc = require('./src/ledger/service');
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');
var loan = require('./src/ledger/loan');
var xy = require('./src/services/xueyuan');

svc.ensureReady();

var X = '995931';
ledger.openUser(X);
xy.mint({ to: X, amountCent: 200000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:X', operator: 'test' });

var seq = 0;
function borrowAndRepay(uid, amount) {
  seq++;
  var a = loan.apply(uid, amount, { ref: 'i:' + seq + ':out' });
  return loan.repay(uid, null, { ref: 'i:' + seq + ':repay', full: true });
}
function ageLoan(loanId, days) {
  var iso = new Date(Date.now() - days * 86400000).toISOString();
  db.prepare('UPDATE xy_ledger_loans SET closed_at = ? WHERE id = ?').run(iso, loanId);
  db.prepare('UPDATE xy_ledger_credit_events SET created_at = ? WHERE ref = ?')
    .run(iso, 'score:loan:' + loanId + ':close');
}
function lastEvent(uid) { return loan.summary(uid).score_events[0]; }

console.log('\n=== 0. 初始状态 ===');
var s0 = loan.summary(X);
eq('600 分', s0.profile.score, 600);
eq('额度 500 学元', s0.credit.limit, 500);
eq('按时还款日 0', s0.credit.on_time_days, 0);
eq('冷却 24 小时', loan.SCORE_ON_TIME_COOLDOWN_HOURS, 24);

console.log('\n=== 1. 同一天连借连还：只计一次分、只提一档 ===');
var r1 = borrowAndRepay(X, 10000);
eq('第一笔按时还清 +40', loan.summary(X).profile.score, 640);
eq('第一笔额度升到 1000', loan.summary(X).credit.limit, 1000);
eq('按时还款日 1 天', loan.summary(X).credit.on_time_days, 1);
var r2 = borrowAndRepay(X, 10000);
eq('第二笔同一天不再加分', loan.summary(X).profile.score, 640);
eq('第二笔额度不再涨', loan.summary(X).credit.limit, 1000);
eq('按时还清笔数仍会累计', loan.summary(X).credit.on_time_count, 2);
eq('按时还款日仍 1 天', loan.summary(X).credit.on_time_days, 1);
eq('冷却事件 delta 0', lastEvent(X).delta, 0);
ok('冷却事件写明原因', /24 小时内已计分/.test(lastEvent(X).reason), lastEvent(X).reason);
var r3 = borrowAndRepay(X, 10000);
eq('第三笔仍不加分', loan.summary(X).profile.score, 640);
eq('第三笔仍不提额', loan.summary(X).credit.limit, 1000);

console.log('\n=== 2. 跨自然日：额度按天数成长 ===');
ageLoan(r1.loan.id, 3);
ageLoan(r2.loan.id, 2);
ageLoan(r3.loan.id, 1);
eq('补记 3 个按时还款日', loan.summary(X).credit.on_time_days, 3);
eq('B 级 cap 压住额度 1500', loan.summary(X).credit.limit, 1500);

var r4 = borrowAndRepay(X, 10000);
eq('跨日后恢复加分（680）', loan.summary(X).profile.score, 680);
eq('按时还款日 4 天', loan.summary(X).credit.on_time_days, 4);
eq('B 级额度仍 1500', loan.summary(X).credit.limit, 1500);
var r5 = borrowAndRepay(X, 10000);
eq('同一天第二笔又不加分', loan.summary(X).profile.score, 680);
ageLoan(r4.loan.id, 2);
ageLoan(r5.loan.id, 1);
var r6 = borrowAndRepay(X, 10000);
eq('再跨一天升 A 级（720）', loan.summary(X).profile.score, 720);
eq('升 A 后额度 2000', loan.summary(X).credit.limit, 2000);
eq('额度不会超过单笔上限', loan.summary(X).credit.limit <= loan.MAX_LOAN_CENT / 100, true);

console.log('\n=== 3. 逾期降档：高水位不能兜住信用风险 ===');
ageLoan(r6.loan.id, 1);
seq++;
var lateApply = loan.apply(X, 10000, { ref: 'i:' + seq + ':late' });
var oldDue = new Date(Date.now() - 2 * 86400000).toISOString();
db.prepare('UPDATE xy_ledger_loans SET due_at = ? WHERE id = ?').run(oldDue, lateApply.loan.id);
db.prepare("UPDATE xy_ledger_loan_installments SET due_at = ? WHERE loan_id = ? AND status = 'pending'")
  .run(oldDue, lateApply.loan.id);
loan.repay(X, null, { ref: 'i:' + seq + ':late:repay', full: true });
eq('逾期扣 40 分（680）', loan.summary(X).profile.score, 680);
eq('回退 B 级', loan.summary(X).profile.tier, 'B');
eq('高水位受 B 级 cap 约束降到 1500', loan.summary(X).credit.limit, 1500);

var r8 = borrowAndRepay(X, 10000);
eq('逾期记录不阻断次日的按时加分（720）', loan.summary(X).profile.score, 720);
eq('恢复 A 级', loan.summary(X).profile.tier, 'A');
eq('恢复 A 级额度 2000', loan.summary(X).credit.limit, 2000);

console.log('\n=== 4. 班管降分：额度立即受新等级 cap 约束 ===');
loan.adjustScore(X, -140, { operator: 'admin', reason: '健全性测试降分', ref: 'adj:integrity' });
var sDown = loan.summary(X);
eq('降到 580 分', sDown.profile.score, 580);
eq('回退 C 级', sDown.profile.tier, 'C');
eq('额度立即降到 C 级 cap 1000', sDown.credit.limit, 1000);

console.log('\n=== 5. 账本守恒与 I10 ===');
function assetNet(asset) {
  return db.prepare('SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = ?')
    .get(asset).s;
}
eq('GRANT 全局净额为 0', assetNet('GRANT'), 0);
eq('PRACTICE 全局净额为 0', assetNet('PRACTICE'), 0);
eq('CASH 全局净额为 0', assetNet('CASH'), 0);
eq('真金台账仍等于账面现金', inv.cashOnBookCent(), inv.cashbookLiabilityCent());
var chk = inv.check({});
eq('I1–I10 全绿', chk.ok, true);
ok('自检无异常明细', chk.issues.length === 0, chk.issues);
var audit = loan.audit();
eq('贷款专项自检通过', audit.ok, true);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
