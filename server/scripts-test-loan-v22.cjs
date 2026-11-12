// 学元信用体系 v2.2 · 运营闭环验收（自动还款 / 津贴预支 / 证券余额还贷）
// 用法：node server/scripts-test-loan-v22.cjs
//
// 这一版最容易出错的不是「功能没做」，而是「跨资产搬钱没兜住」：
//   1) 用练习金还贷时只转了钱、没销贷款（或反过来）→ 半截事务；
//   2) 还贷的练习金流进 withdrawnOut 后把补足基数拉高 → 平台再补一次；
//   3) 每日津贴自动还贷失败，把「今天领不到津贴」一起连坐；
//   4) 第三方能力面把班管的核销/限额/调分/拉黑暴露出去。
// 本测试跑真实路径：能力面 → 内核 → 账本，逐项核对。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-loan-v22-'));
process.env.DB_PATH = path.join(tmpDir, 'loan-v22.db');
process.env.NODE_ENV = 'test';
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
var invest = require('./src/ledger/invest');
var app = require('./src/ledger/app-api');
var xy = require('./src/services/xueyuan');

svc.ensureReady();

var E = '994921';   // 投资贷 → 用证券余额还清
var F = '994922';   // 余额不足回滚 / 自动还款开关
var G = '994923';   // 钱包每日津贴路由 + 预支
[E, F, G].forEach(function (u) {
  ledger.openUser(u);
  xy.mint({ to: u, amountCent: 100000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:' + u, operator: 'test' });
});

function grant(u) { return svc.balanceOf(u).GRANT; }
function practice(u) { return svc.balanceOf(u).PRACTICE; }
function cash(u) { return svc.balanceOf(u).CASH; }

// 取 wallet router 里某个 method+path 的最后一个处理函数，直接执行（绕过鉴权中间件）
var walletRouter = require('./src/routes/wallet');
function handlerFor(method, routePath) {
  for (var i = 0; i < walletRouter.stack.length; i++) {
    var layer = walletRouter.stack[i];
    if (!layer.route) continue;
    if (layer.route.path !== routePath) continue;
    if (!layer.route.methods[method]) continue;
    var stack = layer.route.stack;
    return stack[stack.length - 1].handle;
  }
  return null;
}
function callHandler(handler, req) {
  var out = { status: 200, body: null };
  var res = {
    status: function (code) { out.status = code; return res; },
    json: function (body) { out.body = body; return res; }
  };
  handler(Object.assign({ body: {}, query: {}, params: {}, get: function () { return null; } }, req), res);
  return out;
}

console.log('\n=== 0. 能力边界：只给学生能力，不给班管能力 ===');
ok('能力面有 auto 开关', typeof app.loanSetAutoRepay === 'function');
ok('能力面有证券余额还贷', typeof app.loanRepayFromPractice === 'function');
ok('能力面不暴露核销', app.loanWriteOff === undefined);
ok('能力面不暴露限额', app.loanSetLimit === undefined);
ok('能力面不暴露调分', app.loanAdjustScore === undefined);
ok('能力面不暴露拉黑', app.loanSetBlacklist === undefined);
throws('未登记应用拿不到信用能力', function () {
  app.loanSummary('wallet', E);
}, /未登记的第三方应用/);

console.log('\n=== 1. 投资贷：练习金直接还清（一个事务） ===');
// 先把 100 学元赠金投进证券，凑够本金+利息（520 学元）
app.invest('stock', E, 'in', 10000, 'e:seed');
eq('证券余额 100 学元（赠金转投）', practice(E), 10000);
var loanE = app.loanApply('stock', E, 50000, { ref: 'e:inv:1', product: 'invest' });
eq('借 500 学元', loanE.loan.principal, 500);
eq('投资贷利率 4% / 利息 20', loanE.loan.interest, 20);
eq('本金进证券后练习金 600 学元', practice(E), 60000);
var baseBefore = app.topUpBase('stock', E, 0);
var outBefore = app.withdrawnOut('stock', E);
var gBefore = grant(E);

var rp = app.loanRepayFromPractice('stock', E, { full: true, ref: 'e:inv:1:rp' });
eq('贷款还清', rp.loan.status, 'repaid');
eq('实还 520 学元', rp.repaid, 520);
eq('练习金剩 80 学元', practice(E), 8000);
eq('赠金退回后 900 学元', grant(E), 90000);
eq('还贷练习金计入累计转出', app.withdrawnOut('stock', E), outBefore + 52000);
eq('★ 补足基数不变（平台不会把还贷的钱补回来）', app.topUpBase('stock', E, 0), baseBefore);
eq('补足基数 = 练习金 80 + 累计转出 520', app.topUpBase('stock', E, 0), 60000);
eq('真金一分没动', cash(E), 0);

var gAfter = grant(E);
var pAfter = practice(E);
var rpDup = app.loanRepayFromPractice('stock', E, { full: true, ref: 'e:inv:1:rp' });
eq('同 ref 重放标记 duplicate', rpDup.duplicate, true);
eq('重放不重复转练习金', practice(E), pAfter);
eq('重放不重复扣赠金', grant(E), gAfter);

console.log('\n=== 2. 练习金不足：整体回滚，不留半截 ===');
var loanF = app.loanApply('stock', F, 50000, { ref: 'f:q:1' });
eq('F 借到 500 学元', grant(F), 150000);
var gF = grant(F);
var activeF = loan.summary(F).active;
throws('没有练习金时还贷被拒', function () {
  app.loanRepayFromPractice('stock', F, { full: true, ref: 'f:q:1:rp' });
}, /练习金不足/);
eq('回滚后贷款仍在还款中', loan.summary(F).active.id, activeF.id);
eq('回滚后赠金未变', grant(F), gF);
eq('回滚后练习金仍为 0', practice(F), 0);
var fRepay = app.loanRepay('stock', F, null, { full: true, ref: 'f:q:1:r' });
eq('普通赠金还款仍然可用', fRepay.loan.status, 'repaid');
eq('F 还清后余额 975 学元', grant(F), 97500);

console.log('\n=== 3. 自动还款开关（能力面） ===');
var loanF2 = app.loanApply('stock', F, 50000, { ref: 'f:q:2' });
eq('默认关闭自动还款', loanF2.loan.auto_repay, false);
var autoOn = app.loanSetAutoRepay('stock', F, loanF2.loan.id, true);
eq('学生可以开启', autoOn.loan.auto_repay, true);
var autoOff = app.loanSetAutoRepay('stock', F, loanF2.loan.id, false);
eq('学生可以关闭', autoOff.loan.auto_repay, false);
loan.repay(F, null, { ref: 'f:q:2:r', full: true });
var advF = app.loanApply('stock', F, 30000, { ref: 'f:adv:1', product: 'advance' });
eq('预支 0 利息', advF.loan.interest, 0);
eq('预支强制自动还款', advF.loan.auto_repay_forced, true);
throws('预支关不掉自动还款', function () {
  app.loanSetAutoRepay('stock', F, advF.loan.id, false);
}, /必须用津贴自动还款/);
loan.repay(F, null, { ref: 'f:adv:1:r', full: true });

console.log('\n=== 4. 钱包每日津贴：到账后自动还预支 ===');
var advG = loan.apply(G, 30000, { ref: 'g:adv:1', product: 'advance' });
eq('G 预支 300 学元', grant(G), 130000);
var dailyHandler = handlerFor('post', '/daily');
ok('钱包 /daily 路由存在', !!dailyHandler);
var d1 = callHandler(dailyHandler, { user: { user_id: G } });
eq('津贴领取成功', d1.body.code, 200);
eq('领取金额 200 学元', d1.body.data.amount, 200);
ok('响应带自动还款信息', !!(d1.body.data.loan_repay), d1.body.data);
eq('自动还 200 学元', d1.body.data.loan_repay.amount, 200);
eq('预支还剩 100 学元', d1.body.data.loan_repay.remaining, 100);
eq('预支未结清', d1.body.data.loan_repay.closed, false);
eq('还后余额 1300 学元（1000 本金 + 300 预支）', d1.body.data.account.grant, 1300);
eq('账户练习金 0', practice(G), 0);
var d2 = callHandler(dailyHandler, { user: { user_id: G } });
eq('同日重复领取仍成功', d2.body.code, 200);
eq('重复领取标记 duplicate', d2.body.data.duplicate, true);
eq('重复领取不再自动还款', d2.body.data.loan_repay, null);
eq('贷款仍剩 100 学元', loan.summary(G).active.remaining, 100);
var fullG = loan.repay(G, null, { ref: 'g:adv:1:r', full: true });
eq('剩余 100 学元还清', fullG.loan.status, 'repaid');

console.log('\n=== 5. 账本守恒与 I10 ===');
eq('GRANT 全局净额为 0', db.prepare("SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = 'GRANT'").get().s, 0);
eq('PRACTICE 全局净额为 0', db.prepare("SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = 'PRACTICE'").get().s, 0);
eq('CASH 全局净额为 0', db.prepare("SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = 'CASH'").get().s, 0);
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
