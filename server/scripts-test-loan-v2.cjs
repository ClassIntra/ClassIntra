// 学元信用体系 v2 · 阶段 1 验收（信用分 / 三产品 / 分期 / 班管控制）
// 用法：node server/scripts-test-loan-v2.cjs
//
// 覆盖：
//   信用分与等级（C/B/A/S、额度上限、利率优惠、记分事件）
//   周转贷（7 天 1 期）、分期贷（2/4 期）、投资贷（借出即转证券）
//   分期账单：按期还款、逐期逾期、逾期还清扣分、按时还清加分
//   班管：限额、调分、拉黑/解禁、延期、核销，全部留审计
//   账本守恒、I1–I10、贷款自检

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-loan-v2-'));
process.env.DB_PATH = path.join(tmpDir, 'loan-v2.db');
process.env.NODE_ENV = 'test';
process.env.XUEYUAN_LOAN_POOL_YUAN = '2';   // 2000 学元额度池，便于验证

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

var A = '993911';   // 信用成长 + 班管控制
var B = '993912';   // 分期 2/4 期
var C = '993913';   // 投资贷
var D = '993914';   // 核销
var USERS = {};
USERS[A] = '信用同学'; USERS[B] = '分期同学'; USERS[C] = '投资同学'; USERS[D] = '核销同学';
[A, B, C, D].forEach(function (u) {
  ledger.openUser(u);
  xy.mint({ to: u, amountCent: 100000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:' + u, operator: 'test' });
  db.prepare("INSERT OR IGNORE INTO users (user_id, net_name, real_name, password_hash) VALUES (?, ?, ?, 'x')")
    .run(u, USERS[u], USERS[u]);
});

function grant(u) { return svc.balanceOf(u).GRANT; }
function practice(u) { return svc.balanceOf(u).PRACTICE; }
function cash(u) { return svc.balanceOf(u).CASH; }
function assetNet(asset) {
  return db.prepare('SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = ?')
    .get(asset).s;
}
function makeOverdue(loanId) {
  var due = new Date(Date.now() - 2 * 86400000).toISOString();
  db.prepare('UPDATE xy_ledger_loans SET due_at = ? WHERE id = ?').run(due, loanId);
  db.prepare("UPDATE xy_ledger_loan_installments SET due_at = ? WHERE loan_id = ? AND status = 'pending'")
    .run(due, loanId);
}
function makeInstallmentOverdue(loanId, seq) {
  var due = new Date(Date.now() - 2 * 86400000).toISOString();
  db.prepare("UPDATE xy_ledger_loan_installments SET due_at = ? WHERE loan_id = ? AND seq = ? AND status = 'pending'")
    .run(due, loanId, seq);
}
function quickOnce(uid, amount, tag) {
  loan.apply(uid, amount, { ref: 'q:' + tag });
  return loan.repay(uid, null, { ref: 'q:' + tag + ':repay', full: true });
}
// 信用成长按「自然日」计数：测试里把已还贷款和它的记分事件往前挪，
// 模拟跨天还款；否则同一天借还会被 24h 计分冷却正确拦下。
function ageLoan(loanId, days) {
  var iso = new Date(Date.now() - days * 86400000).toISOString();
  db.prepare('UPDATE xy_ledger_loans SET closed_at = ? WHERE id = ?').run(iso, loanId);
  db.prepare('UPDATE xy_ledger_credit_events SET created_at = ? WHERE ref = ?')
    .run(iso, 'score:loan:' + loanId + ':close');
}

console.log('\n=== 0. 初始信用档案 ===');
var s0 = loan.summary(A);
eq('新用户信用分 600', s0.profile.score, 600);
eq('等级 B 良好', s0.profile.tier, 'B');
eq('等级名', s0.profile.tier_name, '良好');
eq('额度 500 学元', s0.credit.limit, 500);
eq('可借 500', s0.credit.available, 500);
eq('按时还清 0', s0.credit.on_time_count, 0);
eq('逾期还清 0', s0.credit.late_count, 0);
eq('初始记分事件 1 条', s0.score_events.length, 1);
eq('初始事件 600', s0.score_events[0].score_after, 600);
eq('产品 4 个', s0.products.length, 4);
var pQuick = s0.products.filter(function (x) { return x.id === 'quick'; })[0];
var pInst = s0.products.filter(function (x) { return x.id === 'installment'; })[0];
var pInv = s0.products.filter(function (x) { return x.id === 'invest'; })[0];
var pAdv = s0.products.filter(function (x) { return x.id === 'advance'; })[0];
eq('周转贷 B 级利率 5%', pQuick.rate, 5);
eq('分期贷 B 级利率 6%', pInst.rate, 6);
eq('投资贷 B 级利率 4%', pInv.rate, 4);
eq('津贴预支利率 0%', pAdv.rate, 0);
eq('新产品预支上限被额度压到 500', pAdv.max, 500);
eq('津贴预支强制自动还款', pAdv.auto_repay, true);
eq('分期贷可选 2/4 期', pInst.periods.join(','), '2,4');
eq('额度池 2000', s0.pool.cap, 2000);

console.log('\n=== 1. 周转贷：按时还清 → 提分/提额/升档 ===');
var q1 = quickOnce(A, 50000, 'A1');
ageLoan(q1.loan.id, 3);
eq('首笔利率 5%', q1.loan.rate_percent, 5);
eq('首笔利息 25 学元', q1.loan.interest, 25);
eq('首笔只有 1 期', q1.loan.total_installments, 1);
eq('首笔已还清', q1.loan.status, 'repaid');
var sA1 = loan.summary(A);
eq('按时还清后 640 分', sA1.profile.score, 640);
eq('额度升到 1000', sA1.credit.limit, 1000);
eq('按时还清 1 笔', sA1.credit.on_time_count, 1);
eq('记分事件 +40', sA1.score_events[0].delta, 40);
var q2 = quickOnce(A, 50000, 'A2');
ageLoan(q2.loan.id, 2);
var sA2 = loan.summary(A);
eq('两笔按时 680 分', sA2.profile.score, 680);
eq('额度升到 1500', sA2.credit.limit, 1500);
var q3 = quickOnce(A, 50000, 'A3');
ageLoan(q3.loan.id, 1);
var sA3 = loan.summary(A);
eq('三笔按时 720 分', sA3.profile.score, 720);
eq('升到 A 级', sA3.profile.tier, 'A');
eq('额度升到 2000', sA3.credit.limit, 2000);
var pQuickA = sA3.products.filter(function (x) { return x.id === 'quick'; })[0];
var pInvA = sA3.products.filter(function (x) { return x.id === 'invest'; })[0];
eq('A 级周转贷利率 4%', pQuickA.rate, 4);
eq('A 级投资贷利率 3%', pInvA.rate, 3);
eq('A 余额 925 学元（3×25 利息）', grant(A), 92500);

console.log('\n=== 2. 逾期与宽限：逾期还清扣分、不提额 ===');
var qLate = loan.apply(A, 50000, { ref: 'q:A:late' });
eq('A 级利率 4% / 利息 20', qLate.loan.interest, 20);
makeOverdue(qLate.loan.id);
var sLate = loan.summary(A);
eq('逾期可见', sLate.overdue, true);
eq('逾期不能借', sLate.can_borrow, false);
var al = loan.alert(A);
ok('首页提醒能看到逾期', !!(al && al.overdue), al);
var rLate = loan.repay(A, null, { ref: 'q:A:late:repay', full: true });
eq('逾期还清标记 late', rLate.loan.late, true);
var sAfterLate = loan.summary(A);
eq('逾期扣 40 分（680）', sAfterLate.profile.score, 680);
eq('回退 B 级', sAfterLate.profile.tier, 'B');
eq('逾期还清不提额（1500）', sAfterLate.credit.limit, 1500);
eq('逾期还清 1 笔', sAfterLate.credit.late_count, 1);
eq('逾期记分 -40', sAfterLate.score_events[0].delta, -40);
eq('A 余额 905 学元', grant(A), 90500);

console.log('\n=== 3. 分期贷：2 期账单按期还清 ===');
var i2 = loan.apply(B, 50000, { ref: 'i:B:2', product: 'installment', installments: 2 });
eq('2 期产品', i2.loan.product, 'installment');
eq('2 期账单', i2.loan.total_installments, 2);
eq('2 期总额 530 学元', i2.loan.total, 530);
eq('每期本金 250', i2.loan.schedule[0].principal, 250);
eq('每期利息 15', i2.loan.schedule[0].interest, 15);
var r1 = loan.repay(B, 26500, { ref: 'i:B:2:r1' });
eq('还第 1 期', r1.loan.paid_installments, 1);
eq('第 1 期已结清', r1.loan.schedule[0].status, 'paid');
eq('第 2 期待还', r1.loan.schedule[1].status, 'pending');
eq('剩余 265', r1.loan.remaining, 265);
eq('当前还在还款中', r1.loan.status, 'active');
var r2 = loan.repay(B, null, { ref: 'i:B:2:r2', full: true });
eq('2 期全部还清', r2.loan.status, 'repaid');
eq('2 期按时还清', r2.loan.late, false);
var sB1 = loan.summary(B);
eq('B 按时还清后 640 分', sB1.profile.score, 640);
eq('B 额度升到 1000', sB1.credit.limit, 1000);
eq('B 余额 970 学元', grant(B), 97000);
var detail2 = loan.detail(i2.loan.id, B);
eq('明细有 2 次还款', detail2.repayments.length, 2);
eq('明细账单 2 期', detail2.loan.schedule.length, 2);

console.log('\n=== 4. 分期贷：4 期中某期逾期 → 整笔逾期还清扣分 ===');
var i4 = loan.apply(B, 100000, { ref: 'i:B:4', product: 'installment', installments: 4 });
eq('4 期账单', i4.loan.total_installments, 4);
eq('4 期总额 1060 学元', i4.loan.total, 1060);
eq('4 期每期本金 250', i4.loan.schedule[3].principal, 250);
eq('4 期每期利息 15', i4.loan.schedule[3].interest, 15);
eq('4 期到期日逐期后移', i4.loan.schedule[3].due_at > i4.loan.schedule[0].due_at, true);
makeInstallmentOverdue(i4.loan.id, 2);
var sBOver = loan.summary(B);
eq('某期逾期 → 整笔逾期', sBOver.overdue, true);
ok('逾期天数来自逾期的那期', sBOver.active.overdue_days >= 1, sBOver.active.overdue_days);
var r4 = loan.repay(B, null, { ref: 'i:B:4:repay', full: true });
eq('4 期全部还清', r4.loan.status, 'repaid');
eq('整笔标记逾期', r4.loan.late, true);
eq('第 2 期标记逾期还款', r4.loan.schedule[1].late_paid, true);
var sB2 = loan.summary(B);
eq('B 逾期扣 40 分（600）', sB2.profile.score, 600);
eq('B 额度仍 1000', sB2.credit.limit, 1000);
eq('B 余额 910 学元', grant(B), 91000);

console.log('\n=== 5. 投资贷：借出即转证券 ===');
var invLoan = loan.apply(C, 50000, { ref: 'inv:C:1', product: 'invest' });
eq('投资贷产品', invLoan.loan.product, 'invest');
eq('投资贷利率 4% / 利息 20', invLoan.loan.interest, 20);
eq('投资贷标记 invested', invLoan.loan.invested, true);
eq('本金已进证券 500', practice(C), 50000);
eq('赠送学元未凭空增加（仍 1000）', grant(C), 100000);
eq('投资贷账单 1 期', invLoan.loan.total_installments, 1);
var invRepay = loan.repay(C, null, { ref: 'inv:C:1:repay', full: true });
ageLoan(invRepay.loan.id, 2);
eq('投资贷按时还清', invRepay.loan.status, 'repaid');
var sC = loan.summary(C);
eq('C 按时还清 640 分', sC.profile.score, 640);
eq('C 余额 480 学元（还本息 520）', grant(C), 48000);
eq('证券里仍 500', practice(C), 50000);
eq('真金始终为 0', cash(C), 0);

console.log('\n=== 5.1 津贴预支：0 息 + 强制津贴自动还款 ===');
var pAdvC = loan.summary(C).products.filter(function (x) { return x.id === 'advance'; })[0];
eq('预支上限 600 学元', pAdvC.max, 600);
throws('预支超过 600 被拒', function () {
  loan.apply(C, 60001, { ref: 'adv:C:big', product: 'advance' });
}, /不能超过 600/);
var adv = loan.apply(C, 30000, { ref: 'adv:C:1', product: 'advance' });
eq('预支产品', adv.loan.product, 'advance');
eq('预支利率 0%', adv.loan.rate_percent, 0);
eq('预支利息 0', adv.loan.interest, 0);
eq('预支应还 300', adv.loan.total, 300);
eq('预支强制自动还款', adv.loan.auto_repay, true);
eq('预支标记 forced', adv.loan.auto_repay_forced, true);
eq('预支到账 300', grant(C), 78000);
throws('预支不能关闭自动还款', function () {
  loan.setAutoRepay(C, adv.loan.id, false);
}, /必须用津贴自动还款/);
xy.mint({ to: C, amountCent: 5000, pool: xy.POOL.GRANT, kind: 'daily', ref: 'test:daily:adv:mint' });
var adv1 = loan.autoRepayFromDaily(C, 5000, 'test:daily:adv:1');
ok('津贴到账自动还 50 学元', adv1 && adv1.amount === 50, adv1);
eq('自动还后剩余 250', adv1.loan.remaining, 250);
eq('预支仍还款中', adv1.loan.status, 'active');
eq('预支只从津贴扣，不碰证券', practice(C), 50000);
var adv2 = loan.autoRepayFromDaily(C, 1000000, 'test:daily:adv:2');
ok('当日津贴超过剩余时封顶', adv2 && adv2.amount === 250, adv2);
eq('预支已还清', adv2.loan.status, 'repaid');
eq('预支还清后 680 分', loan.summary(C).profile.score, 680);
eq('预支还清余额 530 学元（含 50 津贴）', grant(C), 53000);

console.log('\n=== 5.2 自动还款开关：可关、可开、没开就不扣 ===');
ageLoan(i2.loan.id, 1);
var autoLoan = loan.apply(B, 50000, { ref: 'q:B:auto', auto_repay: true });
eq('申请时开启自动还款', autoLoan.loan.auto_repay, true);
eq('普通产品不强制', autoLoan.loan.auto_repay_forced, false);
var off = loan.setAutoRepay(B, autoLoan.loan.id, false);
eq('可以关闭', off.auto_repay, false);
var noAuto = loan.autoRepayFromDaily(B, 2500, 'test:daily:B:0');
eq('关闭时津贴不扣款', noAuto, null);
var on = loan.setAutoRepay(B, autoLoan.loan.id, true);
eq('可以重新开启', on.auto_repay, true);
xy.mint({ to: B, amountCent: 2500, pool: xy.POOL.GRANT, kind: 'daily', ref: 'test:daily:B:mint' });
var bDaily = loan.autoRepayFromDaily(B, 2500, 'test:daily:B:1');
ok('开启后津贴扣 25 学元', bDaily && bDaily.amount === 25, bDaily);
eq('先抵利息', bDaily.allocation.interest_cent, 2500);
eq('本金未动', bDaily.allocation.principal_cent, 0);
var bDaily2 = loan.autoRepayFromDaily(B, 1000000, 'test:daily:B:2');
ok('剩余一次扣完（500 学元）', bDaily2 && bDaily2.amount === 500, bDaily2);
eq('自动还清贷款', bDaily2.loan.status, 'repaid');
eq('自动还款留审计', loan.adminCredit(B).audits.filter(function (x) { return x.action === 'auto_repay'; }).length, 2);
eq('B 自动还款后余额 910 学元', grant(B), 91000);
eq('B 自动还款后 640 分', loan.summary(B).profile.score, 640);

console.log('\n=== 6. 班管：限额 / 调分 / 拉黑 / 延期 ===');
var lim = loan.setLimit(A, 100000, { operator: 'admin', reason: '测试限额' });
eq('限额设为 1000 学元', lim.limit_override, 1000);
eq('覆盖后额度 1000', loan.summary(A).credit.limit, 1000);
eq('限额留审计', loan.adminCredit(A).audits[0].action, 'limit');

var adj = loan.adjustScore(A, 30, { operator: 'admin', reason: '测试调分', ref: 'adj:A:1' });
eq('调分后 710', adj.score, 710);
eq('调分留事件', loan.summary(A).score_events[0].delta, 30);
eq('调分留审计', loan.adminCredit(A).audits[0].action, 'score');

var black = loan.setBlacklist(A, new Date(Date.now() + 7 * 86400000).toISOString(), {
  operator: 'admin', reason: '测试拉黑'
});
ok('拉黑有截止时间', !!black.blacklist_until);
eq('拉黑后不能借', loan.summary(A).can_borrow, false);
ok('拉黑原因可见', /暂停/.test(loan.summary(A).reason), loan.summary(A).reason);
throws('拉黑期间申请被拒', function () {
  loan.apply(A, 50000, { ref: 'q:A:blacked' });
}, /暂停/);
loan.setBlacklist(A, null, { operator: 'admin', reason: '测试解禁' });
eq('解禁后恢复', loan.summary(A).blacklisted, false);

var extLoan = loan.apply(A, 50000, { ref: 'q:A:extend' });
var beforeDue = extLoan.loan.next_due_at;
var ext = loan.extend(extLoan.loan.id, 7, { operator: 'admin', reason: '测试延期' });
eq('延期 7 天', ext.days, 7);
ok('到期日推后', ext.loan.next_due_at > beforeDue, ext.loan.next_due_at);
eq('延期留审计', loan.adminCredit(A).audits.filter(function (x) { return x.action === 'extend'; }).length, 1);
var extRepay = loan.repay(A, null, { ref: 'q:A:extend:repay', full: true });
eq('延期后按时还清', extRepay.loan.late, false);
var sAEnd = loan.summary(A);
eq('A 最终 750 分', sAEnd.profile.score, 750);
eq('A 额度仍受覆盖 1000', sAEnd.credit.limit, 1000);
eq('A 按时还清 4 笔', sAEnd.credit.on_time_count, 4);
eq('A 逾期还清 1 笔', sAEnd.credit.late_count, 1);
eq('A 最终余额 885 学元', grant(A), 88500);
ok('A 调分/限额/延期都留审计', loan.adminCredit(A).audits.length >= 4, loan.adminCredit(A).audits.map(function (x) { return x.action; }));

console.log('\n=== 7. 核销与冷静期 ===');
var dLoan = loan.apply(D, 50000, { ref: 'q:D:1' });
var wr = loan.writeOff(dLoan.loan.id, { operator: 'admin', reason: '测试核销' });
eq('核销状态', wr.loan.status, 'written_off');
eq('D 扣 150 分（450）', loan.summary(D).profile.score, 450);
eq('D 回退 C 级', loan.summary(D).profile.tier, 'C');
eq('D 额度仍 500', loan.summary(D).credit.limit, 500);
eq('D 进入冷静期', loan.summary(D).can_borrow, false);
ok('D 看到核销原因', /核销/.test(loan.summary(D).reason), loan.summary(D).reason);
eq('核销留审计', loan.adminCredit(D).audits[0].action, 'write_off');
eq('核销记分 -150', loan.summary(D).score_events[0].delta, -150);
throws('冷静期内再借被拒', function () {
  loan.apply(D, 10000, { ref: 'q:D:again' });
}, /核销/);

console.log('\n=== 8. 统计、班管列表、账本与 I10 ===');
var st = loan.stats();
eq('贷款总数 11', st.total, 11);
eq('还款中 0', st.active, 0);
eq('已还清 10', st.repaid, 10);
eq('按时还清 8', st.on_time_repaid, 8);
eq('逾期还清 2', st.late_repaid, 2);
eq('核销 1', st.written_off, 1);
eq('未还本金 0', st.principal_outstanding, 0);
eq('核销坏账 500', st.written_off_principal, 500);
eq('额度池释放', st.pool_used, 0);
eq('快速贷 7 笔', st.products.quick.n, 7);
eq('分期贷 2 笔', st.products.installment.n, 2);
eq('投资贷 1 笔', st.products.invest.n, 1);
eq('津贴预支 1 笔', st.products.advance.n, 1);
eq('A 级 1 人', st.tiers.A, 1);
eq('B 级 2 人', st.tiers.B, 2);
eq('C 级 1 人', st.tiers.C, 1);

var all = loan.adminList({ status: 'all' });
eq('班管全部 11 笔', all.length, 11);
eq('班管核销 1 笔', loan.adminList({ status: 'written_off' }).length, 1);
eq('班管已还清 10 笔', loan.adminList({ status: 'repaid' }).length, 10);
eq('班管还款中 0 笔', loan.adminList({ status: 'active' }).length, 0);
ok('班管列表带信用分', all[0].score >= 300, all[0].score);
ok('班管列表带姓名', all[0].user_name.length > 0, all[0].user_name);

var detail4 = loan.detail(i4.loan.id, B);
eq('4 期明细 1 次还款', detail4.repayments.length, 1);
eq('4 期明细账单 4 期', detail4.loan.schedule.length, 4);

eq('GRANT 全局净额 0', assetNet('GRANT'), 0);
eq('PRACTICE 全局净额 0', assetNet('PRACTICE'), 0);
eq('CASH 全局净额 0', assetNet('CASH'), 0);
eq('真金敞口未被贷款污染', inv.cashOnBookCent(), inv.cashbookLiabilityCent());
var chk = inv.check({});
eq('I1–I10 全绿', chk.ok, true);
ok('自检无异常', chk.issues.length === 0, chk.issues);
var audit = loan.audit();
eq('贷款专项自检通过', audit.ok, true);
eq('贷款专项自检无异常', audit.issues.length, 0);

console.log('\n=== 9. 导出 ===');
ok('产品/等级导出', Array.isArray(loan.PRODUCTS) && Array.isArray(loan.TIERS));
ok('班管操作导出', typeof loan.setLimit === 'function' && typeof loan.adjustScore === 'function' &&
  typeof loan.setBlacklist === 'function' && typeof loan.extend === 'function' &&
  typeof loan.adminCredit === 'function');
ok('自动还款导出', typeof loan.setAutoRepay === 'function' && typeof loan.autoRepayFromDaily === 'function');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
