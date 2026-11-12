// 学元账本 · 学元贷款（只借 GRANT）验收
// 用法：node server/scripts-test-ledger-loan.cjs
//
// 这条通道最容易出错的不是「借了不还」，而是六件事：
//   1) 把贷款做成 CASH —— 凭空发真钱，I2 立刻破；
//   2) 逾期靠定时改状态 —— 多一个必须准点跑的任务，漏跑就永远不逾期；
//   3) 利息算在账外 —— 学生看到的应还和账本里扣的对不上；
//   4) 逾期还清也提额 —— 惩罚规则形同虚设；
//   5) 全班贷款无上限 —— 把赠金供给无限放大；
//   6) 核销不留痕 —— 坏账无法追、学生还能立刻再借。
// 本测试按真实资金路径跑，并逐项核对宽限期、额度池、核销冷静期与 I10。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-loan-'));
process.env.DB_PATH = path.join(tmpDir, 'loan.db');
process.env.NODE_ENV = 'test';
// 额度池压到 2000 学元，才能用少量用户测出「池满拒绝」。默认是 100000 学元。
process.env.XUEYUAN_LOAN_POOL_YUAN = '2';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    var hit = !re || re.test(e.message);
    if (hit) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}

var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
// 贷款班管列表会 LEFT JOIN users 取姓名；测试库只有 ledger schema，补一张最小表。
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

var A = '992911';   // 主路径：借 500 → 逾期还清（不提额）→ 再借按时还清（提额）
var B = '992912';   // 幂等 / 跨用户申请号 / 转账收款
var C = '992913';   // 额度阶梯 + 额度池
var D = '992914';   // 余额不足 + 核销
var USERS = {};
USERS[A] = '同学甲'; USERS[B] = '同学乙'; USERS[C] = '同学丙'; USERS[D] = '同学丁';
[A, B, C, D].forEach(function (u) {
  ledger.openUser(u);
  db.prepare("INSERT OR IGNORE INTO users (user_id, net_name, real_name, password_hash) VALUES (?, ?, ?, 'x')")
    .run(u, USERS[u], USERS[u]);
});

function grant(u) { return svc.balanceOf(u).GRANT; }
function cash(u) { return svc.balanceOf(u).CASH; }
function assetNet(asset) {
  return db.prepare('SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = ?')
    .get(asset).s;
}
function clearingGrant() {
  var c = ledger.systemAccount('clearing');
  return ledger.balanceOf(c.id, 'GRANT');
}
function makeOverdue(loanId) {
  // 2 天前到期：超过默认 24 小时宽限，确定处于逾期态。
  // v2 的逾期判断看分期账单，所以贷款与未结清分期都要拨回去。
  var due = new Date(Date.now() - 2 * 86400000).toISOString();
  db.prepare('UPDATE xy_ledger_loans SET due_at = ? WHERE id = ?').run(due, loanId);
  db.prepare("UPDATE xy_ledger_loan_installments SET due_at = ? WHERE loan_id = ? AND status = 'pending'")
    .run(due, loanId);
}

console.log('\n=== 0. 准备金与规则常量 ===');
xy.mint({ to: A, amountCent: 100000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:A', operator: 'test' });
svc.recharge({ to: A, amount_cent: 20000, ref: 'r:A:1' });
xy.mint({ to: B, amountCent: 100000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:B', operator: 'test' });
xy.mint({ to: C, amountCent: 1000000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:C', operator: 'test' });
xy.mint({ to: D, amountCent: 100000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:D', operator: 'test' });
eq('A 赠金 1000 学元', grant(A), 100000);
eq('A 真金 20000 单位（只用于隔离断言）', cash(A), 20000);
eq('贷款最小额 100 学元', loan.MIN_LOAN_CENT, 10000);
eq('贷款最大额 2000 学元', loan.MAX_LOAN_CENT, 200000);
eq('基础额度 500 学元', loan.BASE_LIMIT_CENT, 50000);
eq('利息 5%', loan.INTEREST_PERCENT, 5);
eq('期限 7 天', loan.TERM_DAYS, 7);
eq('宽限 24 小时', loan.GRACE_HOURS, 24);
eq('额度池 2000 学元（测试环境）', loan.POOL_CAP_CENT, 200000);
eq('核销冷静期 7 天', loan.WRITE_OFF_COOLDOWN_DAYS, 7);

console.log('\n=== 1. 初始额度 ===');
var s0 = loan.summary(A);
eq('额度 500 学元', s0.credit.limit, 500);
eq('已用 0', s0.credit.used, 0);
eq('可借 500 学元', s0.credit.available, 500);
eq('可以借', s0.can_borrow, true);
eq('当前没有借款', s0.active, null);
eq('历史为空', s0.loans.length, 0);
eq('按时还清 0 笔', s0.credit.on_time_count, 0);
eq('逾期还清 0 笔', s0.credit.late_count, 0);
eq('额度池上限 2000', s0.pool.cap, 2000);
eq('额度池已用 0', s0.pool.used, 0);
eq('额度池可用 2000', s0.pool.available, 2000);

console.log('\n=== 2. 放款：只加 GRANT，不动 CASH ===');
var clearing0 = clearingGrant();
var res1 = loan.apply(A, 50000, { ref: 'loan:A:1' });
eq('申请成功', res1.duplicate, false);
eq('本金 500 学元', res1.loan.principal, 500);
eq('利息 25 学元', res1.loan.interest, 25);
eq('应还 525 学元', res1.loan.total, 525);
eq('余额增加 500 学元', grant(A), 150000);
eq('真金一分没动', cash(A), 20000);
eq('到期日在 7 天后', Math.round((Date.parse(res1.loan.due_at) - Date.parse(res1.loan.opened_at)) / 86400000), 7);
eq('状态 active', res1.loan.status, 'active');
eq('clearing 多发行 500 学元', clearingGrant(), clearing0 - 50000);
var outTx = db.prepare('SELECT * FROM xy_ledger_transactions WHERE ref = ?').get('loan:loan:A:1:out');
ok('放款流水已落库', !!outTx);
eq('放款 kind=loan_out', outTx.kind, 'loan_out');
eq('贷款表已回填 out_tx_id', db.prepare('SELECT out_tx_id FROM xy_ledger_loans WHERE id = ?').get(res1.loan.id).out_tx_id, outTx.id);
eq('离到期还早，首页不提醒', loan.alert(A), null);

var s1 = loan.summary(A);
eq('已用额度 500', s1.credit.used, 500);
eq('可借归零', s1.credit.available, 0);
eq('不能再借', s1.can_borrow, false);
eq('不能借原因', s1.reason, '已有一笔贷款未还清');
eq('当前借款可见', s1.active.id, res1.loan.id);
eq('额度池已用 500', s1.pool.used, 500);
eq('额度池可用 1500', s1.pool.available, 1500);

console.log('\n=== 3. 幂等与并发约束 ===');
var gBefore = grant(A);
var dup1 = loan.apply(A, 50000, { ref: 'loan:A:1' });
eq('同申请号重放标记 duplicate', dup1.duplicate, true);
eq('同申请号重放不重复加钱', grant(A), gBefore);
eq('同申请号只产生一笔贷款', db.prepare('SELECT COUNT(*) AS n FROM xy_ledger_loans WHERE user_id = ?').get(A).n, 1);
throws('已有未还清贷款不能再借', function () {
  loan.apply(A, 10000, { ref: 'loan:A:2' });
}, /已有一笔贷款未还清/);
throws('别人的申请号不能复用', function () {
  loan.apply(B, 10000, { ref: 'loan:A:1' });
}, /重复的申请号/);

console.log('\n=== 4. 金额边界 ===');
throws('低于最小额被拒', function () { loan.apply(B, 1, { ref: 'loan:B:small' }); }, /不能少于/);
throws('高于最大额被拒', function () { loan.apply(B, 200001, { ref: 'loan:B:big' }); }, /不能超过/);
throws('非整数单位被拒', function () { loan.apply(B, 10000.5, { ref: 'loan:B:frac' }); }, /不合法/);
throws('0 元被拒', function () { loan.apply(B, 0, { ref: 'loan:B:zero' }); }, /不合法/);
eq('失败后 B 余额未变', grant(B), 100000);
eq('失败后 B 没有贷款', loan.summary(B).loans.length, 0);

console.log('\n=== 5. 部分还款：先还利息 ===');
var repay1 = loan.repay(A, 2500, { ref: 'loanrepay:A:1' });
eq('已还 25 学元', repay1.repaid, 25);
eq('全部抵扣利息', repay1.allocation.interest_cent, 2500);
eq('本金未动', repay1.allocation.principal_cent, 0);
eq('剩余利息 0', repay1.loan.remaining_interest, 0);
eq('剩余本金 500', repay1.loan.remaining_principal, 500);
eq('仍在还款中', repay1.loan.status, 'active');
eq('还利息后余额 1475 学元（1000 自有 + 475 借来的）', grant(A), 147500);
eq('真金仍未动', cash(A), 20000);
eq('clearing 只多出 25 学元利息', clearingGrant(), clearing0 - 50000 + 2500);

var repayDup = loan.repay(A, 2500, { ref: 'loanrepay:A:1' });
eq('还款 ref 幂等', repayDup.duplicate, true);
eq('幂等重放不重复扣款', grant(A), 147500);
eq('幂等重放不重复记还款', db.prepare("SELECT COUNT(*) AS n FROM xy_ledger_loan_repays WHERE ref = ?").get('loanrepay:A:1').n, 1);

console.log('\n=== 6. 逾期与宽限期：只冻结新借款 ===');
makeOverdue(res1.loan.id);
var sOver = loan.summary(A);
eq('逾期可见', sOver.overdue, true);
ok('逾期天数 >= 1', sOver.active.overdue_days >= 1, sOver.active.overdue_days);
eq('已过宽限期，不在宽限态', sOver.active.in_grace, false);
eq('逾期不能借', sOver.can_borrow, false);
eq('逾期原因', sOver.reason, '有一笔贷款已逾期，先还清再借');
var alertOver = loan.alert(A);
ok('首页提醒能看到逾期', !!(alertOver && alertOver.overdue), alertOver);
eq('提醒待还 500 学元', alertOver && alertOver.remaining, 500);
throws('逾期申请新贷款被明确拒绝', function () {
  loan.apply(A, 10000, { ref: 'loan:A:overdue' });
}, /逾期/);
var stOver = loan.stats();
eq('管理端统计能看到 1 笔逾期', stOver.overdue, 1);
eq('管理端统计未还本金 500', stOver.principal_outstanding, 500);
eq('管理端统计未还利息 0', stOver.interest_outstanding, 0);
var repayAfterDue = loan.repay(A, 1000, { ref: 'loanrepay:A:afterdue' });
ok('逾期后仍可还款（剩余本金 490 学元）', repayAfterDue.loan.remaining_principal === 490, repayAfterDue.loan.remaining_principal);
ok('逾期中首页提醒仍在', !!(loan.alert(A) && loan.alert(A).overdue));

console.log('\n=== 7. 逾期还清不提额；按时还清才提额 ===');
var fullLate = loan.repay(A, null, { ref: 'loanrepay:A:late-full', full: true });
eq('一键还清剩余 490 学元', fullLate.repaid, 490);
eq('状态 repaid', fullLate.loan.status, 'repaid');
eq('标记为逾期还清', fullLate.loan.late, true);
eq('不是按时还清', fullLate.loan.on_time, false);
ok('关闭时间已写', !!fullLate.loan.closed_at);
eq('逾期还清后余额 975 学元', grant(A), 97500);
var sAfterLate = loan.summary(A);
eq('逾期还清不提额（仍 500）', sAfterLate.credit.limit, 500);
eq('按时还清 0 笔', sAfterLate.credit.on_time_count, 0);
eq('逾期还清 1 笔', sAfterLate.credit.late_count, 1);
eq('可以再借', sAfterLate.can_borrow, true);
eq('历史状态 repaid', sAfterLate.loans[0].status, 'repaid');
eq('历史标记 late', sAfterLate.loans[0].late, true);
eq('还清后首页提醒消失', loan.alert(A), null);
var detail1 = loan.detail(res1.loan.id, A);
eq('第一笔明细有 3 次还款', detail1.repayments.length, 3);
eq('第一笔明细第一行是利息 25', detail1.repayments[0].interest, 25);
eq('第一笔明细第二行本金 10', detail1.repayments[1].principal, 10);
eq('第一笔明细第三行本金 490', detail1.repayments[2].principal, 490);
throws('不能看别人的贷款明细', function () { loan.detail(res1.loan.id, B); }, /不存在/);

// 再借一笔，按时还清：这一笔才应该提额
var resOn = loan.apply(A, 50000, { ref: 'loan:A:on-time' });
eq('按时周期借款成功', resOn.loan.principal, 500);
var fullOn = loan.repay(A, null, { ref: 'loanrepay:A:on-time-full', full: true });
eq('按时还清', fullOn.loan.on_time, true);
eq('按时还清不标 late', fullOn.loan.late, false);
eq('按时还清后余额 950 学元（利息成本 50）', grant(A), 95000);
var sAfterOn = loan.summary(A);
eq('按时还清后额度升到 1000', sAfterOn.credit.limit, 1000);
eq('按时还清 1 笔', sAfterOn.credit.on_time_count, 1);
eq('逾期还清仍 1 笔', sAfterOn.credit.late_count, 1);

console.log('\n=== 8. 额度阶梯与封顶 ===');
// v2.3 起额度按「按时还款的自然日」成长：测试里把每笔还清往前挪一天，模拟跨日。
var ladderDay = 0;
function borrowAndRepay(uid, amount, tag) {
  var r = loan.apply(uid, amount, { ref: 'ladder:' + tag + ':out' });
  var rep = loan.repay(uid, null, { ref: 'ladder:' + tag + ':repay', full: true });
  ladderDay++;
  var iso = new Date(Date.now() - ladderDay * 86400000).toISOString();
  db.prepare('UPDATE xy_ledger_loans SET closed_at = ? WHERE id = ?').run(iso, rep.loan.id);
  db.prepare('UPDATE xy_ledger_credit_events SET created_at = ? WHERE ref = ?')
    .run(iso, 'score:loan:' + rep.loan.id + ':close');
  return r;
}
borrowAndRepay(C, 50000, '1');
eq('C 还清 1 笔后额度 1000', loan.summary(C).credit.limit, 1000);
borrowAndRepay(C, 100000, '2');
eq('C 还清 2 笔后额度 1500', loan.summary(C).credit.limit, 1500);
borrowAndRepay(C, 150000, '3');
eq('C 还清 3 笔后额度 2000', loan.summary(C).credit.limit, 2000);
borrowAndRepay(C, 200000, '4');
eq('C 还清 4 笔后额度仍封顶 2000', loan.summary(C).credit.limit, 2000);
throws('超过当前额度被拒', function () {
  loan.apply(C, 200001, { ref: 'ladder:cap' });
}, /不能超过|超过可借额度/);

console.log('\n=== 9. 全班额度池 ===');
var dl = loan.apply(D, 50000, { ref: 'loan:D:1' });
eq('D 借到 500 学元', grant(D), 150000);
eq('额度池已用 500', loan.stats().pool_used, 500);
throws('池子不够时拒绝（2000 + 500 > 2000）', function () {
  loan.apply(C, 200000, { ref: 'pool:too-big' });
}, /额度池/);
var poolFit = loan.apply(C, 150000, { ref: 'pool:fit' });
eq('刚好填满池子可以借', poolFit.loan.principal, 1500);
loan.repay(C, null, { ref: 'pool:fit:repay', full: true });
eq('还清后池子回到 500', loan.stats().pool_used, 500);

console.log('\n=== 10. 余额不足：账本层兜底 ===');
xy.transfer({ from: D, to: B, amountCent: 150000, asset: 'GRANT', ref: 't:D:drain' });
eq('D 余额清零', grant(D), 0);
throws('没钱还款被账本拒绝', function () {
  loan.repay(D, 10000, { ref: 'loanrepay:D:1' });
}, /余额不足/);
eq('失败还款不改贷款状态', db.prepare('SELECT status FROM xy_ledger_loans WHERE id = ?').get(dl.loan.id).status, 'active');

console.log('\n=== 11. 账实一致、统计与班管列表 ===');
eq('GRANT 全局净额为 0', assetNet('GRANT'), 0);
eq('CASH 全局净额为 0', assetNet('CASH'), 0);
eq('真金台账仍等于账面现金', inv.cashOnBookCent(), inv.cashbookLiabilityCent());
var chk = inv.check({});
eq('I1–I10 全绿', chk.ok, true);
ok('自检无异常明细', chk.issues.length === 0, chk.issues);
var audit = loan.audit();
eq('贷款专项自检通过', audit.ok, true);
eq('贷款专项自检无异常', audit.issues.length, 0);

var st = loan.stats();
eq('贷款总数 8', st.total, 8);
eq('还款中 1 笔', st.active, 1);
eq('已还清 7 笔', st.repaid, 7);
eq('按时还清 6 笔', st.on_time_repaid, 6);
eq('逾期还清 1 笔', st.late_repaid, 1);
eq('核销 0 笔', st.written_off, 0);
eq('未还本金 500', st.principal_outstanding, 500);
eq('额度池已用 500', st.pool_used, 500);
eq('额度池可用 1500', st.pool_available, 1500);

var adminActive = loan.adminList({ status: 'active' });
eq('班管列表：1 笔还款中', adminActive.length, 1);
eq('班管列表带学生姓名', adminActive[0].user_name, USERS[D]);
eq('班管列表能看到额度池', loan.stats().pool_cap, 2000);

console.log('\n=== 12. 班管核销：坏账释放额度池、学生进入冷静期 ===');
var wr = loan.writeOff(dl.loan.id, { operator: '992999', reason: '测试核销' });
eq('核销成功', wr.duplicate, false);
eq('状态 written_off', wr.loan.status, 'written_off');
ok('核销时间已写', !!wr.loan.write_off_at);
eq('记录了操作原因', wr.loan.write_off_reason, '测试核销');
eq('核销幂等', loan.writeOff(dl.loan.id, { operator: '992999', reason: '重复' }).duplicate, true);
var stAfterWrite = loan.stats();
eq('还款中归零', stAfterWrite.active, 0);
eq('核销 1 笔', stAfterWrite.written_off, 1);
eq('核销本金 500 记入坏账', stAfterWrite.written_off_principal, 500);
eq('未还本金归零', stAfterWrite.principal_outstanding, 0);
eq('额度池释放', stAfterWrite.pool_used, 0);
eq('额度池恢复 2000', stAfterWrite.pool_available, 2000);

var sD = loan.summary(D);
eq('D 当前借款清空', sD.active, null);
eq('D 处于核销冷静期，不能借', sD.can_borrow, false);
ok('D 看到核销原因', /核销/.test(sD.reason), sD.reason);
eq('D 的额度仍为基础 500', sD.credit.limit, 500);
throws('核销冷静期内再借被拒', function () {
  loan.apply(D, 10000, { ref: 'loan:D:after-writeoff' });
}, /核销/);
var wrList = loan.adminList({ status: 'written_off' });
eq('班管可查核销记录', wrList.length, 1);
eq('核销记录带姓名', wrList[0].user_name, USERS[D]);
eq('核销记录带原因', wrList[0].write_off_reason, '测试核销');
var detailD = loan.detail(dl.loan.id, D);
eq('核销贷款明细可查', detailD.loan.status, 'written_off');
eq('核销贷款没有还款记录', detailD.repayments.length, 0);

var chk2 = inv.check({});
eq('核销后 I1–I10 仍全绿', chk2.ok, true);
var audit2 = loan.audit();
eq('核销后贷款自检通过', audit2.ok, true);
eq('核销后自检无异常', audit2.issues.length, 0);

console.log('\n=== 13. 服务门面导出 ===');
ok('service.loan 已挂载', !!svc.loan && typeof svc.loan.apply === 'function');
ok('门面与内核同一实现', svc.loan.apply === loan.apply);
ok('新导出：核销/明细/提醒/班管列表', typeof loan.writeOff === 'function' &&
  typeof loan.detail === 'function' && typeof loan.alert === 'function' &&
  typeof loan.adminList === 'function');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
