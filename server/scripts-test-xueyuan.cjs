// 学元内核自测（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-xueyuan.cjs
//
// 覆盖：开户赠金幂等 / 转账校验 / 津贴连签 / 冻结与结算 / 复式记账拒绝不平衡 /
//       ref 幂等（含并发重试路径）/ 对账不变量 audit。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-xueyuan-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
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

// 造 3 个学生账号（xy 表不依赖 users，但排行榜会 join）
var now = Date.now();
var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')");
ins.run('小明', '张三', '251801');
ins.run('小红', '李四', '251802');
ins.run('小刚', '王五', '251803');

var A = '251801', B = '251802', C = '251803';

console.log('\n=== 开户与赠金 ===');
var a1 = xy.ensureAccount(A);
eq('开户成功', a1.created, true);
eq('赠金到账 1000 学元', a1.account.balance, 1000);
eq('欢迎金标记', a1.welcome_granted, true);
var a2 = xy.ensureAccount(A);
eq('重复开户不重建', a2.created, false);
eq('重复开户不重发赠金', a2.account.balance, 1000);
eq('重复调用 welcome_granted=false', a2.welcome_granted, false);
xy.ensureAccount(B);
xy.ensureAccount(C);

console.log('\n=== 转账 ===');
var t = xy.transfer({ from: A, to: B, amountCent: 15000, memo: '还你的笔' });
ok('转账返回 tx_id', t.tx_id > 0);
eq('付款方 850', xy.getAccount(A).balance, 85000);
eq('收款方 1150', xy.getAccount(B).balance, 115000);
throws('给自己转账被拒', function () { xy.transfer({ from: A, to: A, amountCent: 100 }); }, /自己/);
throws('超额转账被拒', function () { xy.transfer({ from: A, to: B, amountCent: 60000 }); }, /不能超过/);
throws('金额为 0 被拒', function () { xy.transfer({ from: A, to: B, amountCent: 0 }); }, /正整数/);
throws('未开户对象被拒', function () { xy.transfer({ from: A, to: '999999', amountCent: 100 }); }, /尚未开通/);

// 余额不足：A 先转满单笔上限 500，只剩 350，再转 500 就该被拒
xy.transfer({ from: A, to: B, amountCent: 50000 });
eq('转出 500 后剩 350', xy.getAccount(A).balance, 35000);
throws('余额不足被拒', function () { xy.transfer({ from: A, to: B, amountCent: 50000 }); }, /余额不足/);

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
eq('同 ref 不重复扣款', xy.getAccount(A).balance, 34000);
eq('两次返回同一 tx_id', d1.tx_id, d2.tx_id);

console.log('\n=== 津贴 ===');
var day = xy.claimDaily(A);
eq('首日津贴 10 学元', day.amount, 10);
eq('streak=1', day.streak, 1);
var day2 = xy.claimDaily(A);
eq('当日重复领取标记 duplicate', day2.duplicate, true);
eq('当日重复领取金额 0', day2.amount, 0);
eq('余额只加了一次', xy.getAccount(A).balance, 35000);

console.log('\n=== 冻结与结算 ===');
var before = xy.getAccount(B).balance;
xy.hold(B, 50000);
eq('冻结后余额不变', xy.getAccount(B).balance, before);
eq('可用额减少', xy.getAccount(B).available, before - 50000);
// 冻结生效：C 只有 1000 学元，冻 800 后可用 200，转 500 必须失败
xy.hold(C, 80000);
eq('C 冻结后可可用 200', xy.getAccount(C).available, 20000);
throws('可用学元不足被拒', function () { xy.transfer({ from: C, to: A, amountCent: 50000 }); }, /可用学元不足/);
xy.release(C, 80000);
eq('C 解冻后可用恢复', xy.getAccount(C).available, 100000);
var afterSettle = xy.settleHold({
  user_id: B, holdCent: 50000, costCent: 48000, feeCent: 500,
  ref: 'test:settle:1', app: 'stock', memo: '买入 100 股'
});
eq('结算后余额 = 原余额 - 48000', afterSettle.balance, before - 48000);
eq('冻结已清', afterSettle.frozen, 0);

// 费用与成交额分别落在两个系统账户
var feeAcc = xy.getAccount('@system:fee');
ok('费用进入 @system:fee', feeAcc.balance === 500, feeAcc);
var settleAcc = xy.getAccount('@system:settle');
ok('成交额进入 @system:settle', settleAcc.balance === 47500, settleAcc);

console.log('\n=== 系统守恒 ===');
var total = db.prepare("SELECT COALESCE(SUM(balance),0) AS s FROM xy_account").get().s;
eq('全体账户余额之和 = 0', total, 0);
var mintAcc = xy.getAccount('@system:mint');
eq('铸币账户 = 已发行学元的负数', mintAcc.balance, -(3 * 100000 + 1000));

var aud = xy.audit();
ok('audit 通过', aud.ok, aud.issues);

console.log('\n=== 排行榜与流水 ===');
var lb = xy.leaderboard({ limit: 10 });
eq('榜单 3 人', lb.length, 3);
ok('系统账户不在榜单', lb.every(function (x) { return x.user_id.charAt(0) !== '@'; }));
var h = xy.history(A, { limit: 5 });
ok('流水有记录', h.list.length >= 3, { n: h.list.length });
ok('流水带中文类型', /[\u4e00-\u9fa5]/.test(h.list[0].kind_label), h.list[0]);

var sum = xy.summary({ recentLimit: 3 });
eq('发行概览账户数 3', sum.accounts, 3);
ok('流通量 > 0', sum.circulation > 0, sum.circulation);
ok('概览含最近交易', sum.recent.length === 3, sum.recent.length);

console.log('\n=== 越界与异常 ===');
throws('系统账户不可开户', function () { xy.ensureAccount('@system:mint'); }, /系统账户/);
throws('非法用户标识', function () { xy.ensureAccount('a b'); }, /非法/);
throws('冻结超过可用额', function () { xy.hold(C, 999999); }, /不足/);
xy.release(C, 100);
eq('多余解冻被钳到 0', xy.getAccount(C).frozen, 0);
var noRefA = xy.getAccount(A).balance;
xy.post({ entries: [{ user_id: A, delta: -1 }, { user_id: B, delta: 1 }], kind: 'transfer' });
xy.post({ entries: [{ user_id: A, delta: -1 }, { user_id: B, delta: 1 }], kind: 'transfer' });
eq('无 ref 的业务各自独立入账', xy.getAccount(A).balance, noRefA - 2);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
db.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
