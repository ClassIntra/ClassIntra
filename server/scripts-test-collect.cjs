// 群收款（AA）自测（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-collect.cjs
//
// 覆盖：建单参数校验 / 外班与停用账号准入 / 付款扣款与幂等 / 非成员不能付 /
//       进度累计 / 全员付清自动结束 / 发起人与班管权限 / 账本仍平衡。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-collect-'));
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
var collect = require('./src/services/collect');

var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, ?, ?)");
ins.run('班长', '班长', '262801', 'x', 'active');   // 发起人
ins.run('小明', '小明', '262802', 'x', 'active');
ins.run('小红', '小红', '262803', 'x', 'active');
ins.run('小刚', '小刚', '262804', 'x', 'active');
ins.run('外班', '外班', '262901', '', 'active');   // 镜像用户：password_hash 为空
ins.run('停用', '停用', '262805', 'x', 'disabled');

var C = '262801', M1 = '262802', M2 = '262803', M3 = '262804';

[C, M1, M2, M3].forEach(function (u) { xy.ensureAccount(u); });
eq('每人开户赠金 10000 学元', xy.viewAccount(M1).grant, 10000);

console.log('\n=== 1. 建单校验 ===');
throws('空标题被拒', function () {
  collect.create({ creator: C, title: '  ', members: [M1], perYuan: 5 });
}, /请填写/);
throws('没有成员被拒', function () {
  collect.create({ creator: C, title: '班费', members: [], perYuan: 5 });
}, /请至少选择/);
throws('外班镜像不能参与', function () {
  collect.create({ creator: C, title: '班费', members: [M1, '262901'], perYuan: 5 });
}, /外班/);
throws('停用账号不能参与', function () {
  collect.create({ creator: C, title: '班费', members: ['262805'], perYuan: 5 });
}, /停用/);
throws('金额必须大于 0', function () {
  collect.create({ creator: C, title: '班费', members: [M1], perYuan: 0 });
}, /正整数分/);

console.log('\n=== 2. 建单成功 ===');
var created = collect.create({
  creator: C, title: '运动会买水', members: [M1, M2, M3], perYuan: 5, expiresHours: 12
});
var cid = created.collect.id;
eq('每人 5000 学元', created.collect.per, 5000);
eq('总额 15000 学元', created.collect.total, 15000);
eq('三个成员', created.collect.members.length, 3);
eq('初始状态 open', created.collect.status, 'open');
eq('初始进度 0', created.collect.progress, 0);
eq('发起人不算成员', created.collect.members.filter(function (m) { return m.user_id === C; }).length, 0);

var dupCreate = collect.create({
  creator: C, title: '运动会买水', members: [M1, M2, M3], perYuan: 5, requestId: 'req-1'
});
var dupAgain = collect.create({
  creator: C, title: '别的事由', members: [M1], perYuan: 5, requestId: 'req-1'
});
eq('同 requestId 返回 dup', dupAgain.duplicate, true);
eq('同 requestId 不建第二张单', dupAgain.collect.id, dupCreate.collect.id);

console.log('\n=== 3. 付款 ===');
var before1 = xy.viewAccount(M1).balance;
var p1 = collect.pay(cid, M1);
eq('M1 余额扣 5000', before1 - xy.viewAccount(M1).balance, 5000);
eq('进度 33%', p1.collect.progress, 33);
eq('M1 状态 paid', p1.collect.my_status, 'paid');
eq('M1 已不能重复付', p1.collect.can_pay, false);

var p1again = collect.pay(cid, M1);
eq('重复付款返回 duplicate', p1again.duplicate, true);
eq('重复付款不再扣钱', before1 - xy.viewAccount(M1).balance, 5000);

throws('不在名单里的人不能付', function () {
  collect.pay(cid, '262801');
}, /名单/);
throws('不存在的收款单被拒', function () {
  collect.pay(99999, M1);
}, /不存在/);

console.log('\n=== 4. 收满自动结束 ===');
collect.pay(cid, M2);
var p3 = collect.pay(cid, M3);
eq('三人付清后自动 closed', p3.collect.status, 'closed');
eq('进度 100%', p3.collect.progress, 100);
eq('发起人收到 15000 学元', xy.viewAccount(C).balance, 10000 + 15000);
throws('结束后不能再付', function () {
  collect.pay(cid, M1);
}, /不能/);

console.log('\n=== 5. 关闭权限 ===');
var c2 = collect.create({ creator: C, title: '秋游车费', members: [M1, M2], perYuan: 3 }).collect;
throws('非发起人不能关闭', function () {
  collect.close(c2.id, M1);
}, /不能/);
var closed = collect.close(c2.id, C);
eq('发起人可以关闭', closed.collect.status, 'closed');
eq('关闭后仍是 0 进度（没人付）', closed.collect.progress, 0);

console.log('\n=== 6. 列表 ===');
var listC = collect.list(C);
ok('发起人能看到自己建的单', listC.created.length >= 2, { n: listC.created.length });
var listM1 = collect.list(M1);
ok('成员能看到参与的单', listM1.joined.length >= 2, { n: listM1.joined.length });
ok('列表带成员统计', typeof listM1.joined[0].member_count === 'number', listM1.joined[0]);

console.log('\n=== 7. 账本不变量 ===');
var au = xy.audit();
ok('audit 通过', au.ok === true, { issues: au.issues });
eq('全体账户余额之和为 0',
  db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM xy_account').get().s, 0);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
