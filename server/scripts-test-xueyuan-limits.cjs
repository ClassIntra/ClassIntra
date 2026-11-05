// 学元「经济护栏」自测（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-xueyuan-limits.cjs
//
// 与 scripts-test-xueyuan.cjs 的分工：
//   那个测「记账内核是否守恒」，这个测「政策护栏是否生效」。
//   本脚本**不覆盖任何 XUEYUAN_* 环境变量**，跑的就是生产默认值 ——
//   所以它是「默认参数有没有被改坏」的最后一道防线。
//
// 覆盖：
//   1) 默认限额常量本身（1:1000、单笔 200 元、学期 300 元、单次 0.5 元、每日 2 元）
//   2) 单笔充值上限
//   3) 学期累计充值配额（含「拆成多笔」绕过场景）
//   4) 幂等重放不被配额误杀
//   5) 教师发放单次上限 + 每人每日累计上限
//   6) splitPayOrder：赠送学元抵扣上限 = 毛利率，现金不足必须硬失败
//   7) health()：指标齐备、警告可读、账本仍然平衡

var fs = require('fs');
var os = require('os');
var path = require('path');

// 刻意不设 XUEYUAN_YUAN_RATE：本脚本要验证的就是生产默认参数。
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-xy-limits-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
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
    if (!re || re.test(e.message)) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}

console.log('\n=== 建库 ===');
var runner = require('./src/utils/migration-runner');
var r = runner.runAll();
console.log('迁移到 v' + r.currentVersion + '，执行 ' + r.applied + ' 个');

var db = require('./src/utils/db');
var xy = require('./src/services/xueyuan');

var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')");
ins.run('小明', '张三', '261801');
ins.run('小红', '李四', '261802');

var A = '261801';   // 有充值
var B = '261802';   // 只有赠金
var ADMIN = '261800';

console.log('\n=== 1. 默认限额常量 ===');
eq('汇率 1:1000', xy.yuanRate(), 1000);
eq('单笔充值上限 200 元', xy.centToYuan(xy.LIMITS.MAX_RECHARGE_CENT), 200);
eq('学期充值配额 300 元', xy.centToYuan(xy.LIMITS.RECHARGE_QUOTA_CENT), 300);
eq('单次发放上限 0.5 元', xy.centToYuan(xy.LIMITS.MAX_GRANT_CENT), 0.5);
eq('每日发放上限 2 元', xy.centToYuan(xy.LIMITS.GRANT_DAILY_CAP_CENT), 2);
eq('每日津贴 0.2 元', xy.centToYuan(xy.LIMITS.DAILY_CENT), 0.2);

xy.ensureAccount(A);
xy.ensureAccount(B);

console.log('\n=== 2. 单笔充值上限 ===');
throws('201 元被单笔上限拒绝', function () {
  xy.recharge({ user: A, yuan: 201, operator: ADMIN, requestId: 'rc-over' });
}, /200 元/);
throws('2000 元（旧上限）同样被拒', function () {
  xy.recharge({ user: A, yuan: 2000, operator: ADMIN, requestId: 'rc-over2' });
}, /200 元/);

var rc1 = xy.recharge({ user: A, yuan: 200, operator: ADMIN, requestId: 'rc-200' });
eq('充 200 元成功', rc1.recharge.amount, 200000);
eq('充值后现金池 = 200000 学元', xy.viewAccount(A).cash, 200000);

console.log('\n=== 3. 学期累计配额（防拆单） ===');
var rc2 = xy.recharge({ user: A, yuan: 100, operator: ADMIN, requestId: 'rc-quota-100' });
eq('再充 100 元，学期累计到 300 元仍可入账', rc2.recharge.amount, 100000);
eq('本学期已用配额 300 元', xy.centToYuan(xy.rechargedInSemesterCent(A)), 300);

throws('第 301 元被学期配额拒绝', function () {
  xy.recharge({ user: A, yuan: 1, operator: ADMIN, requestId: 'rc-quota-over' });
}, /本学期充值配额/);

var dup = xy.recharge({ user: A, yuan: 100, operator: ADMIN, requestId: 'rc-quota-100' });
eq('幂等重放不被配额误杀（返回 duplicate）', dup.duplicate, true);
eq('重放不改变余额', xy.viewAccount(A).cash, 300000);

console.log('\n=== 4. 教师发放：单次 + 每日双配额 ===');
throws('发 0.6 元被单次上限拒绝', function () {
  xy.grant({ to: B, amountCent: 60000, ref: 'gr-over', operator: ADMIN });
}, /单人单次发放不能超过/);

var g1 = xy.grant({ to: B, amountCent: 50000, ref: 'gr-1', operator: ADMIN });
eq('发 0.5 元成功', !!g1.tx_id, true);
eq('今日已发 0.5 元', xy.centToYuan(xy.grantedTodayCent(B)), 0.5);

xy.grant({ to: B, amountCent: 50000, ref: 'gr-2', operator: ADMIN });
xy.grant({ to: B, amountCent: 50000, ref: 'gr-3', operator: ADMIN });
xy.grant({ to: B, amountCent: 50000, ref: 'gr-4', operator: ADMIN });
eq('连发 4 笔共 2 元', xy.centToYuan(xy.grantedTodayCent(B)), 2);

throws('当日第 5 笔被每日上限拒绝', function () {
  xy.grant({ to: B, amountCent: 1, ref: 'gr-5', operator: ADMIN });
}, /每人每日发放上限/);

var gDup = xy.grant({ to: B, amountCent: 50000, ref: 'gr-1', operator: ADMIN });
eq('发放幂等重放返回 duplicate', gDup.duplicate, true);
eq('重放不再增加今日累计', xy.centToYuan(xy.grantedTodayCent(B)), 2);

console.log('\n=== 5. splitPayOrder：赠送抵扣上限 = 毛利率 ===');
// B 只有赠送学元、没有充值 —— 这正是「用零成本铸币白拿实物」的漏洞场景
var bAcc = xy.viewAccount(B);
ok('B 有充足赠送学元', bAcc.grant > 10000, { grant: bAcc.grant });
eq('B 没有充值学元', bAcc.cash, 0);

throws('赠送学元买实物但未充值 → 硬失败', function () {
  xy.splitPayOrder(B, 10000, 0.3);
}, /充值学元不足/);

var partsB = xy.splitPayOrder(B, 10000, 1);
eq('比例放到 1 时允许全额赠送抵扣', partsB.grant, 10000);
eq('全额抵扣时不动现金池', partsB.cash, 0);

var partsA = xy.splitPayOrder(A, 100000, 0.3);
eq('30% 上限：赠送抵扣 30000', partsA.grant, 30000);
eq('70% 由现金池承担', partsA.cash, 70000);

var partsA0 = xy.splitPayOrder(A, 100000, 0);
eq('比例为 0 时全部走现金池', partsA0.cash, 100000);
eq('比例为 0 时不动赠送', partsA0.grant, 0);

throws('比例非法（负数）按 0 处理', function () {
  xy.splitPayOrder(B, 1000, -1);
}, /充值学元不足/);

console.log('\n=== 6. 币值健康度 ===');
var h = xy.health({ days: 30 });
eq('窗口天数回显', h.window_days, 30);
ok('给出健康等级', ['ok', 'watch', 'risk'].indexOf(h.level) >= 0, { level: h.level });
eq('账户数 2', h.accounts, 2);
ok('流通量 > 0', h.circulation > 0, { circulation: h.circulation });
ok('可提现敞口 = 300000 学元', xy.fromCent(h.withdrawable_cent) === 300000, { got: xy.fromCent(h.withdrawable_cent) });
ok('准备金覆盖敞口', h.cash_cent >= h.withdrawable_cent, { cash: h.cash_cent, wd: h.withdrawable_cent });
eq('限额透出单笔充值 200 元', h.limits.max_recharge_yuan, 200);
eq('限额透出每日发放 2 元', h.limits.grant_daily_cap_yuan, 2);
ok('警告是数组', Array.isArray(h.warnings), { t: typeof h.warnings });
ok('回笼率已计算', typeof h.sink_ratio === 'number', { v: h.sink_ratio });
ok('货币深度已计算', typeof h.depth_days === 'number', { v: h.depth_days });

h.warnings.forEach(function (w) {
  ok('警告有可读文案：' + w.code, typeof w.text === 'string' && w.text.length > 4, { text: w.text });
});

console.log('\n=== 7. 账本不变量 ===');
var au = xy.audit();
ok('audit 通过（复式记账仍平衡）', au.ok === true, { issues: au.issues });
eq('全体账户余额之和为 0', db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM xy_account').get().s, 0);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
