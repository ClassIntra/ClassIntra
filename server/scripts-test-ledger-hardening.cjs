// 学元账本 · v2 加固验收（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-ledger-hardening.cjs（必须用系统 Node / ABI 137）
//
// 覆盖 docs/ledger-hardening-v2.md 的五条公理：
//   P1 幂等不可击穿 / P2 账本可证明 / P3 日终可自证 / P4 失败可追 / P5 供给有硬闸
// 另含：事务内失败回滚、external_cost 数据驱动门禁、跨进程并发不超卖。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-v2-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
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
function throwsCode(name, fn, code, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    var hitCode = e.code === code;
    var hitMsg = !re || re.test(e.message);
    if (hitCode && hitMsg) { pass++; console.log('  ✓ ' + name + ' [' + e.code + ']'); }
    else {
      fail++;
      console.log('  ✗ ' + name + ' → code=' + e.code + ' msg=' + e.message + '（期望 ' + code + '）');
    }
  }
}

console.log('\n=== 0. 建库与初始化 ===');
var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
// goods.get() 会 LEFT JOIN users 取卖家昵称（C2C 市集），临时库补一张最小表。
db.exec('CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, net_name TEXT, real_name TEXT)');
var assets = require('./src/ledger/assets');
var ledger = require('./src/ledger/ledger');
var proof = require('./src/ledger/proof');
var supply = require('./src/ledger/supply');
var reconcile = require('./src/ledger/reconcile');
var inv = require('./src/ledger/invariants');
var errors = require('./src/ledger/errors');
var orders = require('./src/ledger/orders');
var goods = require('./src/ledger/goods');

eq('写入 3 种资产', assets.seed(db).created, 3);
ledger.systemAccount('platform');
ledger.systemAccount('escrow', 'orders');
var clearing = ledger.systemAccount('clearing');
var A = '991901';
var B = '991902';
var ua = ledger.openUser(A);
var ub = ledger.openUser(B);
ok('A/B 开户成功', ua.id > 0 && ub.id > 0);
var genesis = proof.ensureGenesis(db);
ok('genesis 已建立', !!genesis.created || !!genesis.skipped);
eq('genesis 起点为 0（空库）', proof.head(db).genesis_tx_id, 0);
supply.ensure(db);
eq('供给计数器初始化 3 行', supply.all(db).length, 3);

function grant(ref, amount, owner) {
  return ledger.post({
    ref: ref, kind: 'grant', initiator: 'system', memo: '发放',
    entries: [
      { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: amount },
      { kind: 'user', owner: owner || A, asset: 'GRANT', direction: 1, amount_cent: amount }
    ]
  });
}
function count(table) { return db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n; }

console.log('\n=== 1. P1 幂等：同 ref 同载荷 vs 异载荷 ===');
var t1 = grant('v2:grant:1', 10000);
eq('首笔记账成功', t1.duplicate, false);
var replay = grant('v2:grant:1', 10000);
eq('同 ref 同载荷 → duplicate', replay.duplicate, true);
eq('重放返回原 tx_id', replay.tx_id, t1.tx_id);
eq('重放后余额不变', ledger.userBalance(A, 'GRANT'), 10000);

var beforeConflict = ledger.userBalance(A, 'GRANT');
throwsCode('同 ref 改金额 → 冲突', function () { grant('v2:grant:1', 9999); },
  'IDEMPOTENCY_CONFLICT', /幂等键/);
eq('冲突不改余额', ledger.userBalance(A, 'GRANT'), beforeConflict);
throwsCode('同 ref 改 memo → 冲突', function () {
  ledger.post({
    ref: 'v2:grant:1', kind: 'grant', initiator: 'system', memo: '换个备注',
    entries: [
      { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: 10000 },
      { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 10000 }
    ]
  });
}, 'IDEMPOTENCY_CONFLICT', /幂等键/);
ok('冲突在 transactions 留下指纹', !!db.prepare('SELECT request_hash FROM xy_ledger_transactions WHERE ref = ?').get('v2:grant:1').request_hash);

// legacy 兼容：迁移前的交易没有 request_hash，重放必须保持原行为、不误判冲突
db.prepare([
  'INSERT INTO xy_ledger_transactions (ref, kind, status, amount_cent, created_at)',
  "VALUES ('v2:legacy', 'grant', 'legacy', 1, ?)"
].join(' ')).run(new Date().toISOString());
var legacyReplay = ledger.post({
  ref: 'v2:legacy', kind: 'grant', memo: '完全不同的载荷',
  entries: [
    { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: 1 },
    { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 1 }
  ]
});
eq('legacy（无指纹）重放仍返回 duplicate', legacyReplay.duplicate, true);
eq('legacy 重放不产生新分录', db.prepare('SELECT COUNT(*) AS n FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id=e.tx_id WHERE t.ref=?').get('v2:legacy').n, 0);
ok('冲突留了失败凭证', count('xy_ledger_post_attempts') >= 2);

console.log('\n=== 2. P4 结构化错误码 + 中文文案不变 ===');
throwsCode('缺 ref', function () { ledger.post({ kind: 'grant', entries: [] }); },
  'MISSING_REF', /必须提供 ref/);
throwsCode('缺 kind', function () { ledger.post({ ref: 'v2:e1', entries: [] }); },
  'MISSING_KIND', /必须提供 kind/);
throwsCode('未知 kind', function () { ledger.post({ ref: 'v2:e2', kind: 'whatever', entries: [] }); },
  'UNKNOWN_KIND', /未知的业务类型/);
throwsCode('分录不足', function () { ledger.post({ ref: 'v2:e3', kind: 'grant', entries: [] }); },
  'TOO_FEW_ENTRIES', /至少需要两条分录/);
throwsCode('未知资产', function () {
  ledger.post({ ref: 'v2:e4', kind: 'grant', entries: [
    { account_id: clearing.id, asset: 'NOPE', direction: -1, amount_cent: 1 },
    { kind: 'user', owner: A, asset: 'NOPE', direction: 1, amount_cent: 1 }
  ] });
}, 'UNKNOWN_ASSET', /未知资产/);
throwsCode('方向非法', function () {
  ledger.post({ ref: 'v2:e5', kind: 'grant', entries: [
    { account_id: clearing.id, asset: 'GRANT', direction: 7, amount_cent: 1 },
    { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 1 }
  ] });
}, 'BAD_DIRECTION', /direction 只接受/);
throwsCode('金额小数', function () {
  ledger.post({ ref: 'v2:e6', kind: 'grant', entries: [
    { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: 1.5 },
    { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 1.5 }
  ] });
}, 'BAD_AMOUNT', /正整数分/);
throwsCode('不守恒', function () {
  ledger.post({ ref: 'v2:e7', kind: 'grant', entries: [
    { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: 100 },
    { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 99 }
  ] });
}, 'UNBALANCED', /不守恒/);
throwsCode('余额不足', function () {
  ledger.post({ ref: 'v2:e8', kind: 'transfer', entries: [
    { kind: 'user', owner: A, asset: 'GRANT', direction: -1, amount_cent: 99999999 },
    { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 99999999 }
  ] });
}, 'INSUFFICIENT_BALANCE', /余额不足/);
eq('系统异常归 UNEXPECTED', errors.normalize(new TypeError('boom')).code, 'UNEXPECTED');
eq('普通业务错误归 BUSINESS_RULE', errors.normalize(new Error('商品已下架')).code, 'BUSINESS_RULE');
eq('冲突返回 409', errors.statusOf('IDEMPOTENCY_CONFLICT'), 409);
ok('所有失败都留了凭证', count('xy_ledger_post_attempts') >= 10);
eq('失败不落 transactions（1 笔真实 + 1 笔 legacy）', count('xy_ledger_transactions'), 2);

console.log('\n=== 3. P2 哈希链：新段逐笔 + 历史段 digest ===');
grant('v2:chain:1', 500);
grant('v2:chain:2', 700);
var v1 = proof.verify(db);
eq('干净链 verify 通过', v1.ok, true);
ok('校验了至少 3 笔', v1.checked >= 3, { checked: v1.checked });
ok('链尾 hash 非空', !!v1.head_hash && v1.head_hash.length === 64);
var lastTx = db.prepare('SELECT MAX(id) AS id FROM xy_ledger_transactions').get().id;
eq('seal 覆盖最后一笔', !!db.prepare('SELECT 1 AS x FROM xy_ledger_tx_seals WHERE tx_id = ?').get(lastTx), true);
ok('chain_state.head_tx_id 跟上', proof.head(db).head_tx_id === lastTx);

// 篡改一条新段分录 → entry_hash 断开
var victim = db.prepare('SELECT id, amount_cent FROM xy_ledger_entries WHERE tx_id = ? ORDER BY line_no LIMIT 1').get(lastTx);
db.prepare('UPDATE xy_ledger_entries SET amount_cent = ? WHERE id = ?').run(victim.amount_cent + 1, victim.id);
var v2 = proof.verify(db);
eq('篡改分录后链断', v2.ok, false);
ok('报 SEAL_BROKEN', v2.issues.some(function (i) { return i.code === 'SEAL_BROKEN'; }), v2.issues);
db.prepare('UPDATE xy_ledger_entries SET amount_cent = ? WHERE id = ?').run(victim.amount_cent, victim.id);
eq('改回后链恢复', proof.verify(db).ok, true);

// 篡改交易头 → chain_hash 断开
db.prepare('UPDATE xy_ledger_transactions SET memo = ? WHERE id = ?').run('被改过的备注', lastTx);
var v3 = proof.verify(db);
ok('篡改交易头也能检出', !v3.ok && v3.issues.some(function (i) { return i.code === 'SEAL_BROKEN'; }), v3.issues);
db.prepare('UPDATE xy_ledger_transactions SET memo = ? WHERE id = ?').run('发放', lastTx);

// 历史段：genesis 之前插入分录，digest 必须变化（旧系统只能靠 I1c 金额比对，这里连内容都锁住）
var at = new Date().toISOString();
db.prepare('INSERT INTO xy_ledger_transactions (id, ref, kind, status, amount_cent, created_at) VALUES (-1, ?, ?, ?, ?, ?)')
  .run('v2:legacy:inject', 'grant', 'posted', 100, at);
db.prepare('INSERT INTO xy_ledger_entries (tx_id, line_no, account_id, asset, direction, amount_cent, created_at) VALUES (-1, 1, ?, ?, -1, 100, ?)')
  .run(clearing.id, 'GRANT', at);
db.prepare('INSERT INTO xy_ledger_entries (tx_id, line_no, account_id, asset, direction, amount_cent, created_at) VALUES (-1, 2, ?, ?, 1, 100, ?)')
  .run(ua.id, 'GRANT', at);
var v4 = proof.verify(db);
ok('历史段被改动 → LEGACY_DIGEST_MISMATCH', v4.issues.some(function (i) { return i.code === 'LEGACY_DIGEST_MISMATCH'; }), v4.issues);
db.prepare('DELETE FROM xy_ledger_entries WHERE tx_id = -1').run();
db.prepare('DELETE FROM xy_ledger_transactions WHERE id = -1').run();
eq('清理后历史 digest 复原', proof.verify(db).ok, true);

console.log('\n=== 4. 余额版本断层 + 深度自检 ===');
var ver = db.prepare('SELECT version FROM xy_ledger_balances WHERE account_id = ? AND asset = ?').get(ua.id, 'GRANT').version;
ok('经 post 写过的余额 version ≥ 1', ver >= 1, { version: ver });
var deep1 = inv.checkDeep();
eq('深度自检 I11–I13 全绿', deep1.ok, true);
eq('checkDeep 报 3 项', deep1.checked.length, 3);
eq('轻量层 check 仍只报 I1–I10', inv.check().checked.length, 12);
var health = inv.health();
eq('health.ok 不被深度层拖累', health.ok, true);
eq('health.deep.ok', health.deep.ok, true);
ok('health.metrics 暴露 proof_ok', health.metrics.proof_ok === true);

db.prepare('UPDATE xy_ledger_balances SET version = 0 WHERE account_id = ? AND asset = ?').run(ua.id, 'GRANT');
var deep2 = inv.checkDeep();
ok('version 断层被 I13 抓到', deep2.issues.some(function (i) { return i.code === 'I13'; }), deep2.issues);
db.prepare('UPDATE xy_ledger_balances SET version = ? WHERE account_id = ? AND asset = ?').run(ver, ua.id, 'GRANT');
eq('恢复后深度自检全绿', inv.checkDeep().ok, true);

console.log('\n=== 5. P5 供给硬闸（整笔回滚） ===');
var issued = supply.read(db, 'GRANT').issued_cent;
ok('计数器已累计发行', issued > 0, { issued: issued });
db.prepare('UPDATE xy_ledger_assets SET supply_cap_cent = ? WHERE asset = ?').run(issued + 100, 'GRANT');
var txBefore = count('xy_ledger_transactions');
var entryBefore = count('xy_ledger_entries');
var sealBefore = count('xy_ledger_tx_seals');
throwsCode('超 cap 发行被拒', function () { grant('v2:cap:over', 500); },
  'SUPPLY_CAP_EXCEEDED', /累计发行超限/);
eq('超限不落 transactions', count('xy_ledger_transactions'), txBefore);
eq('超限不落 entries', count('xy_ledger_entries'), entryBefore);
eq('超限不落 seals', count('xy_ledger_tx_seals'), sealBefore);
eq('超限不推高计数器', supply.read(db, 'GRANT').issued_cent, issued);
var capOk = grant('v2:cap:ok', 50);
eq('cap 内发行成功', capOk.duplicate, false);
eq('计数器只加 50', supply.read(db, 'GRANT').issued_cent, issued + 50);
db.prepare('UPDATE xy_ledger_assets SET supply_cap_cent = 0 WHERE asset = ?').run('GRANT');
eq('恢复默认不限', supply.capOf(db, 'GRANT'), 0);

console.log('\n=== 6. P3 日终三方对账（差异落库） ===');
var r1 = reconcile.run(db, { runKey: 'v2:test:1' });
eq('干净库对账零差异', r1.ok, true);
eq('issue_count = 0', r1.issue_count, 0);
eq('diffs 为空', r1.diffs.length, 0);
ok('summary 有三方数', !!r1.summary && typeof r1.summary.cash_on_book_cent === 'number');
var r1again = reconcile.run(db, { runKey: 'v2:test:1' });
eq('同 runKey 去重', r1again.duplicate, true);
eq('去重返回同一 run_id', r1again.run_id, r1.run_id);

// 人为制造余额漂移
db.prepare('UPDATE xy_ledger_balances SET balance = balance + 7 WHERE account_id = ? AND asset = ?').run(ua.id, 'GRANT');
var r2 = reconcile.run(db, { runKey: 'v2:test:2' });
eq('漂移使对账失败', r2.ok, false);
ok('落 BALANCE_DRIFT 差异', r2.diffs.some(function (d) { return d.code === 'BALANCE_DRIFT'; }), r2.diffs);
eq('diffs 真的写进表', db.prepare('SELECT COUNT(*) AS n FROM xy_ledger_reconcile_diffs WHERE run_id = ?').get(r2.run_id).n, r2.diffs.length);
eq('latest 指向这次运行', reconcile.latest(db).run.id, r2.run_id);
ok('history 有记录', reconcile.history(db, 10).length >= 2);
db.prepare('UPDATE xy_ledger_balances SET balance = balance - 7 WHERE account_id = ? AND asset = ?').run(ua.id, 'GRANT');
eq('恢复后对账再绿', reconcile.run(db, { runKey: 'v2:test:3' }).ok, true);
eq('I12 发行计数器与分录一致', inv.checkDeep().summary.supply.ok, true);

console.log('\n=== 7. external_cost 数据驱动门禁 ===');
var physical = goods.create({ name: '实物本子', price_cent: 1000, cost_cent: 500, kind: 'physical' });
eq('有成本实物自动打标', Number(physical.requires_external), 1);
var digital = goods.create({ name: '数字装扮', price_cent: 100, cost_cent: 0, kind: 'digital' });
eq('零成本数字品不打标', Number(digital.requires_external), 0);
throwsCode('GRANT 买实物被拒', function () {
  orders.create({ ref: 'v2:order:grant', buyer: A, goods_id: physical.id, asset: 'GRANT', face_cent: 1000 });
}, 'EXTERNAL_COST_FORBIDDEN', /真实成本|充值学元/);
var ord = orders.create({ ref: 'v2:order:cash', buyer: A, goods_id: physical.id, asset: 'CASH', face_cent: 1000 });
eq('CASH 买实物放行', ord.status, 'created');
eq('订单资产恒为 CASH', ord.asset, 'CASH');
ok('canBuyExternal 只认 CASH', assets.canBuyExternal('CASH') === true &&
  assets.canBuyExternal('GRANT') === false && assets.canBuyExternal('PRACTICE') === false);
eq('门禁不产生额外订单', count('xy_ledger_orders'), 1);

console.log('\n=== 8. 事务内失败：零残留 + 有凭有据 ===');
var tx0 = count('xy_ledger_transactions');
var en0 = count('xy_ledger_entries');
var se0 = count('xy_ledger_tx_seals');
var at0 = count('xy_ledger_post_attempts');
throws('事务内余额不足整笔回滚', function () {
  ledger.post({ ref: 'v2:rollback:1', kind: 'transfer', entries: [
    { kind: 'user', owner: A, asset: 'CASH', direction: -1, amount_cent: 1 },
    { kind: 'user', owner: B, asset: 'CASH', direction: 1, amount_cent: 1 }
  ] });
}, /余额不足/);
eq('回滚后 transactions 不增', count('xy_ledger_transactions'), tx0);
eq('回滚后 entries 不增', count('xy_ledger_entries'), en0);
eq('回滚后 seals 不增', count('xy_ledger_tx_seals'), se0);
ok('回滚后仍有失败凭证', count('xy_ledger_post_attempts') > at0);
eq('回滚后链仍然完整', proof.verify(db).ok, true);
eq('回滚后轻量层仍全绿', inv.check().ok, true);

console.log('\n=== 9. 跨进程并发（真并发，不是循环模拟） ===');
// 造足 8×100 + 8×100 的本金
grant('v2:conc:seed', 5000);
var balBeforeConc = ledger.userBalance(A, 'GRANT');

var workerPath = path.join(tmpDir, 'conc-worker.cjs');
var workerSrc = [
  '"use strict";',
  'process.env.DB_PATH = ' + JSON.stringify(process.env.DB_PATH) + ';',
  'process.env.NODE_ENV = "test";',
  'var ledger = require(' + JSON.stringify(path.join(__dirname, 'src', 'ledger', 'ledger.js')) + ');',
  'var idx = process.argv[2];',
  'var mode = process.argv[3];',
  'var ref = mode === "same" ? "v2:conc:same" : "v2:conc:unique:" + idx;',
  'try {',
  '  var r = ledger.post({ ref: ref, kind: "transfer", initiator: "991901", entries: [',
  '    { kind: "user", owner: "991901", asset: "GRANT", direction: -1, amount_cent: 100 },',
  '    { kind: "user", owner: "991902", asset: "GRANT", direction: 1, amount_cent: 100 }',
  '  ]});',
  '  console.log(JSON.stringify({ ok: true, duplicate: !!r.duplicate }));',
  '} catch (e) {',
  '  console.log(JSON.stringify({ ok: false, code: e.code || "UNEXPECTED", message: e.message }));',
  '}'
].join('\n');
fs.writeFileSync(workerPath, workerSrc);

function spawnWorker(i, mode) {
  return new Promise(function (resolve) {
    var p = cp.spawn(process.execPath, [workerPath, String(i), mode], { cwd: __dirname });
    var out = '';
    p.stdout.on('data', function (d) { out += d.toString(); });
    p.stderr.on('data', function (d) { out += d.toString(); });
    p.on('close', function () {
      var parsed = null;
      try { parsed = JSON.parse(out.trim().split('\n').pop()); } catch (e) { parsed = null; }
      resolve(parsed || { ok: false, message: 'worker 无输出: ' + out.slice(0, 200) });
    });
  });
}

var uniqueJobs = [];
for (var u = 0; u < 8; u++) uniqueJobs.push(spawnWorker(u, 'unique'));

Promise.all(uniqueJobs).then(function (uniqueResults) {
  eq('8 个并发进程全部成功', uniqueResults.filter(function (r) { return r.ok === true; }).length, 8);
  eq('unique ref 无一被判重复', uniqueResults.filter(function (r) { return r.duplicate === true; }).length, 0);
  ok('无 SQLITE_BUSY / database is locked', !uniqueResults.some(function (r) {
    return /SQLITE_BUSY|database is locked/.test(r.message || '');
  }), uniqueResults);
  eq('8 笔各扣 100', balBeforeConc - ledger.userBalance(A, 'GRANT'), 800);

  var sameJobs = [];
  for (var s = 0; s < 8; s++) sameJobs.push(spawnWorker(s, 'same'));
  return Promise.all(sameJobs);
}).then(function (sameResults) {
  eq('同 ref 并发全部正常返回', sameResults.filter(function (r) { return r.ok === true; }).length, 8);
  eq('同 ref 只有 1 笔真正记账', sameResults.filter(function (r) { return r.duplicate === false; }).length, 1);
  eq('其余 7 笔判为 duplicate', sameResults.filter(function (r) { return r.duplicate === true; }).length, 7);
  eq('同 ref 并发只扣 100', balBeforeConc - ledger.userBalance(A, 'GRANT'), 900);
  ok('并发后 B 收到 900', ledger.userBalance(B, 'GRANT') >= 900, { b: ledger.userBalance(B, 'GRANT') });
  eq('并发后链仍完整', proof.verify(db).ok, true);
  eq('并发后 I1–I10 全绿', inv.check().ok, true);
  eq('并发后深度层全绿', inv.checkDeep().ok, true);
  eq('并发后对账零差异', reconcile.run(db, { runKey: 'v2:test:final' }).ok, true);

  console.log('\n========================================');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  console.log('========================================\n');
  try { db.close(); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('并发测试异常:', e);
  process.exit(1);
});
