// 学元内核自测（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-xueyuan.cjs
//
// 覆盖：开户赠金幂等 / 双资金池隔离 / 线下充值幂等 / 转账（充值优先、赠送补足）/
//       提现申请·撤销·审批（仅充值学元可提现）/ 津贴连签 / 冻结与结算 /
//       复式记账拒绝不平衡 / ref 幂等（含并发重试路径）/ 对账不变量 audit。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-xueyuan-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
// 自测固定 1:100 口径：金额断言不随生产默认汇率（1:1000）漂移
process.env.XUEYUAN_YUAN_RATE = '100';
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
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

console.log('\n=== 建库 ===');
var runner = require('./src/utils/migration-runner');
var r = runner.runAll();
console.log('迁移到 v' + r.currentVersion + '，执行 ' + r.applied + ' 个');

var db = require('./src/utils/db');
var xy = require('./src/services/xueyuan');

// 造 4 个学生账号（xy 表不依赖 users，但排行榜会 join）
var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')");
ins.run('小明', '张三', '251801');
ins.run('小红', '李四', '251802');
ins.run('小刚', '王五', '251803');
ins.run('小美', '赵六', '251804');

var A = '251801', B = '251802', C = '251803', D = '251804';

console.log('\n=== 开户与赠金 ===');
var a1 = xy.ensureAccount(A);
eq('开户成功', a1.created, true);
eq('赠金到账 1000 学元', a1.account.balance, 1000);
eq('赠金进入赠送池', a1.account.grant, 1000);
eq('充值池为 0', a1.account.cash, 0);
eq('欢迎金标记', a1.welcome_granted, true);
var a2 = xy.ensureAccount(A);
eq('重复开户不重建', a2.created, false);
eq('重复开户不重发赠金', a2.account.balance, 1000);
eq('重复调用 welcome_granted=false', a2.welcome_granted, false);
xy.ensureAccount(B);
xy.ensureAccount(C);
xy.ensureAccount(D);

console.log('\n=== 赠送学元不可提现 ===');
throws('纯赠送账户提现被拒', function () { xy.requestWithdraw({ user: D, amountCent: 10000, requestId: 'wd:zero' }); }, /可提现学元不足/);

console.log('\n=== 线下充值（仅班管录入） ===');
// 自测固定 1:100 口径（等价 10 元换 1000 学元），保持下面金额断言稳定；
// 生产默认 1 元 = 1000 学元，换算统一走 yuanRate()，测试口径不影响生产
var recA = xy.recharge({ user: A, yuan: 10, operator: A, requestId: 'rc:a' });
eq('A 充值到账 1000 学元', recA.account.cash, 1000);
var recA2 = xy.recharge({ user: A, yuan: 10, operator: A, requestId: 'rc:a' });
eq('同请求号重复充值不重复入账', recA2.account.cash, 1000);
eq('重复充值标记 duplicate', recA2.duplicate, true);
throws('充值人数值非法', function () { xy.recharge({ user: A, yuan: 0, operator: A }); }, /正整数分/);
throws('充值操作人非法', function () { xy.recharge({ user: A, yuan: 10, operator: '@system:mint' }); }, /操作人非法/);
eq('充值只进充值池', xy.viewAccount(A).grant, 1000);
xy.recharge({ user: B, yuan: 10, operator: A, requestId: 'rc:b' });
xy.recharge({ user: C, yuan: 10, operator: A, requestId: 'rc:c' });

console.log('\n=== 转账（充值优先、赠送补足） ===');
var t = xy.transfer({ from: A, to: B, amountCent: 15000, memo: '还你的笔' });
ok('转账返回 tx_id', t.tx_id > 0);
eq('付款方充值池 850', xy.viewAccount(A).cash, 850);
eq('付款方总余额 1850', xy.viewAccount(A).balance, 1850);
eq('收款方充值池 1150', xy.viewAccount(B).cash, 1150);
eq('付款方赠送池不变', xy.viewAccount(A).grant, 1000);
throws('给自己转账被拒', function () { xy.transfer({ from: A, to: A, amountCent: 100 }); }, /自己/);
throws('超额转账被拒', function () { xy.transfer({ from: A, to: B, amountCent: 6000000 }); }, /不能超过/);
throws('金额为 0 被拒', function () { xy.transfer({ from: A, to: B, amountCent: 0 }); }, /正整数/);
throws('未开户对象被拒', function () { xy.transfer({ from: A, to: '999999', amountCent: 100 }); }, /尚未开通/);

// A 充值池只剩 850，转 500 全部走充值池，赠送池不动
xy.transfer({ from: A, to: B, amountCent: 50000 });
eq('转出 500 后充值池剩 350', xy.viewAccount(A).cash, 350);
eq('充值池够用时不动赠送池', xy.viewAccount(A).grant, 1000);

console.log('\n=== 记账内核 ===');
throws('分录不平衡被拒', function () {
  xy.post({ entries: [{ user_id: A, delta: -100 }, { user_id: B, delta: 50 }], kind: 'transfer' });
}, /不平衡/);
throws('未知 kind 被拒', function () {
  xy.post({ entries: [{ user_id: A, delta: -100 }, { user_id: B, delta: 100 }], kind: 'hack' });
}, /未知的业务类型/);
throws('同一账户重复出现被拒', function () {
  xy.post({ entries: [{ user_id: A, delta: -100 }, { user_id: A, delta: 100 }], kind: 'transfer' });
}, /重复出现/);
throws('浮点金额被拒', function () {
  xy.post({ entries: [{ user_id: A, delta: -10.5 }, { user_id: B, delta: 10.5 }], kind: 'transfer' });
}, /整数分/);

var dupRef = 'test:dup:1';
var d1 = xy.post({ entries: [{ user_id: A, delta: -1000 }, { user_id: B, delta: 1000 }], kind: 'transfer', ref: dupRef });
var d2 = xy.post({ entries: [{ user_id: A, delta: -1000 }, { user_id: B, delta: 1000 }], kind: 'transfer', ref: dupRef });
eq('同 ref 第二次标记 duplicate', d2.duplicate, true);
eq('同 ref 不重复扣款', xy.viewAccount(A).balance, 1340);
eq('两次返回同一 tx_id', d1.tx_id, d2.tx_id);

console.log('\n=== 津贴 ===');
var day = xy.claimDaily(A);
eq('首日津贴 100 学元', day.amount, 100);
eq('streak=1', day.streak, 1);
eq('津贴进入赠送池', xy.viewAccount(A).grant, 1090);
var day2 = xy.claimDaily(A);
eq('当日重复领取标记 duplicate', day2.duplicate, true);
eq('当日重复领取金额 0', day2.amount, 0);
eq('余额只加了一次', xy.viewAccount(A).balance, 1440);

console.log('\n=== 冻结与结算 ===');
var before = xy.getAccount(B).balance;
xy.hold(B, 50000);
eq('冻结后余额不变', xy.getAccount(B).balance, before);
eq('可用额减少', xy.getAccount(B).available, before - 50000);
eq('默认冻结赠送池', xy.viewAccount(B).frozen_grant, 500);
eq('充值池未被冻结', xy.viewAccount(B).frozen_cash, 0);

// 红包/跨班只冻充值池：C 充了 1000，冻结 800 后可用充值只剩 200。
// 新规则下转账会先花剩余充值、再由赠送补足，但不能动被冻结的部分：
// 可用充值 200 + 赠送 1000 = 1200，转 1300 必须失败
xy.hold(C, 80000, { pool: 'cash' });
eq('C 冻结充值池后可用充值 200', xy.viewAccount(C).available_cash, 200);
var splitC = xy.splitPayable(C, 50000);
eq('拆分不吃冻结：可用充值只算 200', splitC.cash, 20000);
eq('拆分差额由赠送补 300', splitC.grant, 30000);
throws('冻结的充值学元不可用', function () { xy.transfer({ from: C, to: A, amountCent: 130000 }); }, /可用学元不足/);
xy.release(C, 80000, { pool: 'cash' });
eq('C 解冻后充值可用恢复', xy.viewAccount(C).available_cash, 1000);

var afterSettle = xy.settleHold({
  user_id: B, holdCent: 50000, costCent: 48000, feeCent: 500,
  ref: 'test:settle:1', app: 'stock', memo: '买入 100 股'
});
eq('结算后余额 = 原余额 - 成交额 480', afterSettle.balance, before - 48000);
eq('结算扣的是赠送池', afterSettle.grant_balance, 53000);
eq('结算不动充值池', afterSettle.cash_balance, 165000);
eq('冻结已清', afterSettle.frozen, 0);

// 费用与成交额分别落在两个系统账户
var feeAcc = xy.getAccount('@system:fee');
ok('费用进入 @system:fee', feeAcc.balance === 500, feeAcc);
var settleAcc = xy.getAccount('@system:settle');
ok('成交额进入 @system:settle', settleAcc.balance === 47500, settleAcc);

console.log('\n=== 提现申请、撤销与审批 ===');
eq('A 可提现额度 = 净充值 350', xy.viewAccount(A).withdrawable, 350);
throws('提现超过单笔上限被拒', function () { xy.requestWithdraw({ user: A, amountCent: 20000000, requestId: 'wd:max' }); }, /不能超过/);
var w1 = xy.requestWithdraw({ user: A, amountCent: 30000, memo: '买书', requestId: 'wd:a1' });
eq('提现冻结充值池', w1.account.frozen_cash, 300);
eq('提现后充值可用 50', w1.account.available_cash, 50);
throws('同时只能有一笔待审批', function () { xy.requestWithdraw({ user: A, amountCent: 10000, requestId: 'wd:a2' }); }, /已有一笔/);
eq('待审批列表 1 笔', xy.listWithdrawals({ status: 'pending' }).length, 1);
var c1 = xy.cancelWithdraw(w1.withdraw.id, { user: A });
eq('撤销后状态 cancelled', c1.withdraw.status, 'cancelled');
eq('撤销后充值可用恢复', c1.account.available_cash, 350);
eq('撤销后冻结清零', c1.account.frozen_cash, 0);

var w2 = xy.requestWithdraw({ user: A, amountCent: 30000, memo: '买书', requestId: 'wd:a3' });
var r2 = xy.reviewWithdraw(w2.withdraw.id, true, { reviewer: A, memo: '已当面支付' });
eq('审批通过状态 paid', r2.withdraw.status, 'paid');
eq('审批后充值池扣 300 剩 50', r2.account.cash, 50);
eq('审批后赠送池不变', r2.account.grant, 1090);
eq('审批后冻结清零', r2.account.frozen_cash, 0);
eq('净充值扣减后可提现 50', r2.account.withdrawable, 50);
throws('超出净充值部分不可提现', function () { xy.requestWithdraw({ user: A, amountCent: 10000, requestId: 'wd:a4' }); }, /可提现学元不足/);
throws('已处理的提现单不可重复审批', function () { xy.reviewWithdraw(w2.withdraw.id, true, { reviewer: A }); }, /已处理/);

console.log('\n=== 投资收益结构性不可提现 ===');
// 此时 A：充值池 50、赠送池 1090，可提现额度被充值池卡在 50
eq('操作前可提现 50', xy.viewAccount(A).withdrawable, 50);
var ct1 = xy.creditTrade(A, 10000, { principalCent: 5000, ref: 'test:trade:1', app: 'stock' });
eq('本金回充值池', xy.viewAccount(A).cash, 100);
eq('收益进赠送池', xy.viewAccount(A).grant, 1140);
eq('卖出后总余额 1240', xy.viewAccount(A).balance, 1240);
ok('两腿各生成一笔分录', ct1.principal_tx.tx_id > 0 && ct1.profit_tx.tx_id > 0, ct1);

var ct2 = xy.creditTrade(A, 10000, { principalCent: 0, ref: 'test:trade:2', app: 'stock' });
eq('纯收益不回充值池', xy.viewAccount(A).cash, 100);
eq('纯收益进赠送池', xy.viewAccount(A).grant, 1240);
eq('纯收益不增加可提现额度', xy.viewAccount(A).withdrawable, 100);
throws('超出可提现部分仍被拒', function () {
  xy.requestWithdraw({ user: A, amountCent: 15000, requestId: 'wd:profit' });
}, /可提现学元不足/);

var ct1b = xy.creditTrade(A, 10000, { principalCent: 5000, ref: 'test:trade:1', app: 'stock' });
ok('同 ref 重放两腿都判重', ct1b.principal_tx.duplicate === true && ct1b.profit_tx.duplicate === true, ct1b);
eq('重放后余额不变', xy.viewAccount(A).balance, 1340);
throws('本金超过回款被拒', function () { xy.creditTrade(A, 10000, { principalCent: 20000 }); }, /本金金额非法/);
throws('回款金额非整数分被拒', function () { xy.creditTrade(A, 10.5, { principalCent: 0 }); }, /正整数分/);

console.log('\n=== 赠送学元可支付（放开后） ===');
// D 只有赠送学元（1000），现在可以转账；收款方同样进赠送池，转手不会变成可提现余额
var aGrant0 = xy.viewAccount(A).grant;
xy.transfer({ from: D, to: A, amountCent: 10000 });
eq('纯赠送账户可转账', xy.viewAccount(D).grant, 900);
eq('收款方进赠送池', xy.viewAccount(A).grant, aGrant0 + 100);

// C：充值 1000 + 赠送 1000，转 1500 → 充值优先扣完，差额由赠送补足
var parts = xy.splitPayable(C, 150000);
eq('拆分：先扣充值 1000', parts.cash, 100000);
eq('拆分：赠送补 500', parts.grant, 50000);
var bCash0 = xy.viewAccount(B).cash;
var bGrant0 = xy.viewAccount(B).grant;
xy.transfer({ from: C, to: B, amountCent: 150000 });
eq('付款方充值池清零', xy.viewAccount(C).cash, 0);
eq('付款方赠送池剩 500', xy.viewAccount(C).grant, 500);
eq('收款方充值池 +1000', xy.viewAccount(B).cash, bCash0 + 1000);
eq('收款方赠送池 +500', xy.viewAccount(B).grant, bGrant0 + 500);
throws('两种学元都不够时被拒', function () { xy.transfer({ from: C, to: A, amountCent: 60000 }); }, /可用学元不足/);
throws('赠送学元仍不可提现', function () { xy.requestWithdraw({ user: C, amountCent: 10000, requestId: 'wd:grant' }); }, /可提现学元不足/);

console.log('\n=== 系统守恒 ===');
var total = db.prepare("SELECT COALESCE(SUM(balance),0) AS s FROM xy_account").get().s;
eq('全体账户余额之和 = 0', total, 0);
var mintAcc = xy.getAccount('@system:mint');
eq('铸币账户 = 已发行 - 已提现', mintAcc.balance, -(4 * 100000 + 3 * 100000 + 10000 - 30000));
var cashTotal = db.prepare("SELECT COALESCE(SUM(cash_balance),0) AS s FROM xy_account").get().s;
var grantTotal = db.prepare("SELECT COALESCE(SUM(grant_balance),0) AS s FROM xy_account").get().s;
var userTotal = db.prepare("SELECT COALESCE(SUM(balance),0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
eq('学生充值池 + 赠送池 = 学生总余额', cashTotal + grantTotal, userTotal);

var aud = xy.audit();
ok('audit 通过', aud.ok, aud.issues);

console.log('\n=== 排行榜、流水与概览 ===');
var lb = xy.leaderboard({ limit: 10 });
eq('榜单 4 人', lb.length, 4);
ok('系统账户不在榜单', lb.every(function (x) { return x.user_id.charAt(0) !== '@'; }));
var h = xy.history(A, { limit: 5 });
ok('流水有记录', h.list.length >= 3, { n: h.list.length });
ok('流水带中文类型', /[\u4e00-\u9fa5]/.test(h.list[0].kind_label), h.list[0]);
ok('流水带资金池标签', /充值|赠送/.test(h.list[0].pool_label), h.list[0]);

var sum = xy.summary({ recentLimit: 3 });
eq('发行概览账户数 4', sum.accounts, 4);
ok('概览含充值池', sum.cash > 0, sum.cash);
ok('概览含赠送池', sum.grant > 0, sum.grant);
ok('概览含最近交易', sum.recent.length === 3, sum.recent.length);

console.log('\n=== 越界与异常 ===');
throws('系统账户不可开户', function () { xy.ensureAccount('@system:mint'); }, /系统账户/);
throws('非法用户标识', function () { xy.ensureAccount('a b'); }, /非法/);
throws('冻结超过可用额', function () { xy.hold(C, 999999); }, /不足/);
throws('解冻额超过冻结总额被拒', function () { xy.release(C, 100); }, /超过冻结/);
var noRefA = xy.getAccount(A).balance;
xy.post({ entries: [{ user_id: A, delta: -1 }, { user_id: B, delta: 1 }], kind: 'transfer' });
xy.post({ entries: [{ user_id: A, delta: -1 }, { user_id: B, delta: 1 }], kind: 'transfer' });
eq('无 ref 的业务各自独立入账', xy.getAccount(A).balance, noRefA - 2);

var finalAudit = xy.audit();
ok('全部操作后 audit 仍通过', finalAudit.ok, finalAudit.issues);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
db.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
