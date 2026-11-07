// 学元账本 · 单位口径审计（只读，可作发版门禁）
// 用法：node server/scripts/ledger-unit-audit.cjs
//
// 2026-11-07 之前，这里打印的是「两套口径差 100 倍，等产品拍板」。
// 现在已经归位：1 元 = 1000 学元 × 100 账本单位/学元 = 100000 单位。
// 本脚本改为**验证这条链是否仍然成立**，并把账上余额按唯一口径换算成人民币。
// 任何一侧被单独改回去，退出码非 0。

var db = require('../src/utils/db');
var units = require('../src/ledger/units');
var xy = require('../src/services/xueyuan');

var U = units.UNITS_PER_YUAN;
var audit = units.scaleAudit();
var bad = 0;

function check(name, cond, extra) {
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
  if (!cond) bad++;
}

function sumAsset(asset) {
  return Number(db.prepare([
    'SELECT COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
    'JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE a.kind = 'user' AND b.asset = ?"
  ].join('\n')).get(asset).s) || 0;
}

function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

console.log('\n=== 学元单位口径审计 ===\n');
check('1 学元 = 100 账本单位', audit.unitsPerXueyuan === 100);
check('1 元 = 1000 学元（汇率冻结）', audit.xueyuanPerYuan === xy.yuanRate());
check('1 元 = 100000 账本单位', audit.ledgerUnitsPerYuan === 100000, audit.ledgerUnitsPerYuan);
check('口径已统一（倍差 = 1）', audit.unified, audit.split);
check('门面 yuanToCent 与账本一致', xy.yuanToCent(1) === units.yuanToUnits(1),
  { facade: xy.yuanToCent(1), ledger: units.yuanToUnits(1) });
check('门面 fromCent / toCent 往返', xy.fromCent(xy.toCent(12.34)) === 12.34);
check('/api/xy 与门面对同一「1 元」得到同一数字',
  units.yuanToUnits(1) === units.yuanToWalletUnits(1));

console.log('\n--- 账上余额（按唯一口径换算成人民币）---');
console.log('  资产        账本单位       折合人民币(元)     折合学元');
['CASH', 'GRANT', 'PRACTICE'].forEach(function (asset) {
  var u = sumAsset(asset);
  console.log('  ' + asset.padEnd(10) + String(u).padStart(12) +
    fmt(u / U).padStart(18) + fmt(u / audit.unitsPerXueyuan).padStart(14));
});

console.log('\n--- 限额：常量 vs 设计值 ---');
var LIM = xy.LIMITS;
[
  ['单笔充值', LIM.MAX_RECHARGE_CENT, 200],
  ['学期充值配额', LIM.RECHARGE_QUOTA_CENT, 300],
  ['单次发放', LIM.MAX_GRANT_CENT, 0.5],
  ['每日发放上限', LIM.GRANT_DAILY_CAP_CENT, 2],
  ['单笔转账', LIM.MAX_TRANSFER_CENT, 500],
  ['单笔提现', LIM.MAX_WITHDRAW_CENT, 1000]
].forEach(function (r) {
  var got = r[1] / U;
  var hit = Math.abs(got - r[2]) < 1e-9;
  check(r[0] + ' = ' + r[2] + ' 元', hit, { actual: got, expected: r[2] });
});

console.log('\n' + (bad ? '✗ 口径校验失败 ' + bad + ' 项' : '✓ 全部通过'));
console.log('');
process.exit(bad ? 1 : 0);
