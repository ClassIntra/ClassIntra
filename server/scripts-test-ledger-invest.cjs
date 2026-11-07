// 学元账本 · 投资进出（赠金 ⇄ 练习金）验收
// 用法：node server/scripts-test-ledger-invest.cjs
//
// 这条通道把「零花钱」和「沙盘本金」连起来：赠金可以投进证券，炒股赚的也能拿回钱包花。
// 但它必须**只**在 GRANT 与 PRACTICE 之间发生 —— 真钱 CASH 一旦进来，
// 就重演 11-05 那次「赠金买股、卖出变现金」的洗钱漏洞。
//
// 覆盖：金额守恒 / 两资产各自净额为 0 / 可用额校验 / 冻结不可撤 /
//       幂等 / CASH 完全不受影响 / I2 不被污染。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-invest-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';

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

var svc = require('./src/ledger/service');
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');
var xy = require('./src/services/xueyuan');

svc.ensureReady();

var A = '991911';
var B = '991912';
[A, B].forEach(function (u) { ledger.openUser(u); });

function cash(u) { return svc.balanceOf(u).CASH; }
function grant(u) { return svc.balanceOf(u).GRANT; }
function practice(u) { return svc.balanceOf(u).PRACTICE; }

function assetNet(asset) {
  return db.prepare('SELECT COALESCE(SUM(direction * amount_cent), 0) AS s FROM xy_ledger_entries WHERE asset = ?')
    .get(asset).s;
}

console.log('\n=== 0. 准备金 ===');
for (var i = 1; i <= 3; i++) svc.recharge({ to: A, amount_cent: 20000, ref: 'r:A:' + i });  // 60 元真金
xy.mint({ to: A, amountCent: 500000, pool: xy.POOL.GRANT, kind: 'grant', ref: 'g:A', operator: 'test' });
svc.issue({ to: B, asset: 'GRANT', amount_cent: 100000, ref: 'g:B', skipQuota: true });
eq('A 真金 60 元', cash(A), 60000);
eq('A 赠金 50 元', grant(A), 500000);
eq('A 练习金 0', practice(A), 0);

console.log('\n=== 1. 转入投资：赠金 → 练习金 ===');
var r1 = xy.investIn(A, 300000, { ref: 'inv:1' });
eq('赠金减少 30 元', grant(A), 200000);
eq('练习金增加 30 元', practice(A), 300000);
eq('真金一分没动', cash(A), 60000);
eq('总资产不变', grant(A) + practice(A) + cash(A), 560000);
eq('返回金额', r1.amount, 3000);

console.log('\n=== 2. 撤资：练习金 → 赠金（炒股赚的能拿回钱包）===');
var r2 = xy.investOut(A, 120000, { ref: 'inv:2' });
eq('练习金减少 12 元', practice(A), 180000);
eq('赠金增加 12 元', grant(A), 320000);
eq('真金仍然没动', cash(A), 60000);

console.log('\n=== 3. 可用额校验 ===');
throws('转入超过赠金余额被拒', function () {
  xy.investIn(A, 900000, { ref: 'inv:big' });
}, /赠送学元不足/);
throws('撤出超过练习金余额被拒', function () {
  xy.investOut(A, 900000, { ref: 'inv:big2' });
}, /练习金不足/);
eq('失败不影响余额', practice(A), 180000);

console.log('\n=== 4. 挂单冻结的练习金不能撤 ===');
xy.hold(A, 50000, { pool: xy.POOL.PRACTICE, ref: 'hold:1' });
eq('冻结后可用练习金', svc.balanceOf(A).PRACTICE, 130000);
throws('撤资不能吃掉冻结', function () {
  xy.investOut(A, 150000, { ref: 'inv:frozen' });
}, /练习金不足/);
ok('撤出可用部分是允许的', (function () {
  try { xy.investOut(A, 100000, { ref: 'inv:ok' }); return true; } catch (e) { return false; }
})());
xy.release(A, 50000, { pool: xy.POOL.PRACTICE, ref: 'release:1' });

console.log('\n=== 5. 幂等 ===');
var gBefore = grant(B);
xy.investIn(B, 10000, { ref: 'inv:b1' });
var gAfter1 = grant(B);
xy.investIn(B, 10000, { ref: 'inv:b1' });
eq('同 ref 重放不重复扣', grant(B), gAfter1);
ok('第一次确实扣了', gAfter1 === gBefore - 10000, { before: gBefore, after: gAfter1 });

console.log('\n=== 6. 账本守恒与 CASH 隔离 ===');
eq('GRANT 全局净额为 0', assetNet('GRANT'), 0);
eq('PRACTICE 全局净额为 0', assetNet('PRACTICE'), 0);
eq('CASH 全局净额为 0', assetNet('CASH'), 0);
var chk = inv.check({});
eq('自检全绿', chk.ok, true);
ok('自检无异常明细', chk.issues.length === 0, chk.issues);
eq('真金台账仍等于账面现金', inv.cashOnBookCent(), inv.cashbookLiabilityCent());

console.log('\n=== 7. 赚来的钱：能转账、能发红包，不能买东西 ===');
// B 只有赠金、0 真金，等价于「炒股赚了钱全撤出来」的学生
var yb = require('./src/services/yuanbao');
var gB = grant(B);
xy.transfer({ from: B, to: A, amountCent: 10000, asset: 'GRANT', ref: 't:play:1' });
eq('赠金可以转账给同学', grant(B), gB - 10000);

var cashABefore = cash(A);
var grantABefore = grant(A);
var pkt = yb.create(B, 3000, 3, '玩一下');
var claimed = yb.claim(pkt.id, A);
eq('赠金红包能发能领', claimed.claimed, true);
eq('领红包不会变成现金（资产原样转手）', cash(A), cashABefore);
ok('领到的是赠金', grant(A) > grantABefore, { before: grantABefore, after: grant(A) });

// 但商品买不了 —— 哪怕成本为 0 的数字品
var playGoods = svc.goods.create({ name: '测试头像框', price_cent: 1000, cost_cent: 0, kind: 'digital' });
var oPlay = svc.orders.create({ ref: 'o:play', buyer: B, goods_id: playGoods.id, kind: 'goods' });
throws('赠金买不了商品（哪怕成本为 0）', function () {
  svc.orders.pay(oPlay.id, { ref: 'o:play:pay' });
}, /只能用自己充值的学元/);
eq('B 真金仍为 0（没有凭空多出购买力）', cash(B), 0);
ok('B 的赠金也没被扣走', grant(B) > 0, grant(B));

console.log('\n=== 8. 真钱永远进不了股市 ===');
// 无论怎么操作，CASH 的变动只应来自充值/提现；投资通道碰不到它
var cashNet = db.prepare([
  'SELECT COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
  'FROM xy_ledger_entries e',
  'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
  'JOIN xy_ledger_accounts a ON a.id = e.account_id',
  "WHERE e.asset = 'CASH' AND a.kind = 'user'"
].join('\n')).get().s;
ok('CASH 流水只来自充值（投资通道碰不到它）', cashNet === 60000, cashNet);

console.log('\n=== 9. 第三方能力面 + 撤资不触发补发 ===');
var appApi = require('./src/ledger/app-api');
var investCore = require('./src/ledger/invest');
var C = '991913';
ledger.openUser(C);
svc.issue({ to: C, asset: 'GRANT', amount_cent: 100000, ref: 'g:C', skipQuota: true });
xy.mint({ to: C, amountCent: 300000, pool: xy.POOL.PRACTICE, kind: 'practice', ref: 'p:C', operator: 'test' });

eq('能力面只读赠金额度', appApi.grantAvailable('stock', C), 100000);
eq('补足基数初始 = 练习金 30 万', appApi.topUpBase('stock', C, 0), 300000);
eq('累计撤出初始为 0', investCore.withdrawnOutCent(C), 0);
throws('未登记应用被拒', function () { appApi.invest('chess', C, 'in', 1000, 'x:1'); }, /未登记/);
throws('方向非法被拒', function () { appApi.invest('stock', C, 'sideways', 1000, 'x:2'); }, /direction/);

var cashCBefore = cash(C);
appApi.invest('stock', C, 'in', 50000, 'inv:C:in:1');
eq('转入后练习金 +5 万', practice(C), 350000);
eq('转入后赠金 -5 万', grant(C), 50000);
eq('转入不计入撤出额', investCore.withdrawnOutCent(C), 0);
eq('转入抬高补足基数（平台不再补发）', appApi.topUpBase('stock', C, 0), 350000);

appApi.invest('stock', C, 'out', 80000, 'inv:C:out:1');
eq('撤出后练习金 -8 万', practice(C), 270000);
eq('撤出后赠金 +8 万', grant(C), 130000);
eq('累计撤出 = 8 万', investCore.withdrawnOutCent(C), 80000);
eq('★ 撤资不拉低补足基数（封住跨月反复补发）', appApi.topUpBase('stock', C, 0), 350000);

appApi.invest('stock', C, 'out', 80000, 'inv:C:out:1');
eq('重复 ref 幂等，余额不变', practice(C), 270000);
eq('重复 ref 不重复累计撤出', investCore.withdrawnOutCent(C), 80000);
eq('能力面全程碰不到 CASH', cash(C), cashCBefore);

var chk9 = inv.check({});
eq('I1–I8 全绿', chk9.ok, true);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
