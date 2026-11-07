// 学元账本 · 旧账本退役门禁（只读扫描）
// 用法：node server/scripts/ledger-retire-check.cjs
//
// ---- 现在「旧账本」到底指什么 ----
// 2026-11-07 之后，学元的钱全部记在 xy_ledger_* 上。旧表里只剩两类东西：
//   A. 账本三表  xy_account / xy_tx / xy_entry   —— 已停止写入，可以归档删除
//   B. 业务凭证  xy_recharge / xy_withdraw / xy_packet* / xy_collect* / xy_pay_* …
//      —— 记的是「谁交过现金、哪张单被谁批的、红包发给谁」，属于业务档案，
//         **不是账本，不能跟着账本一起删**。删了这些，历史工单就查不到了。
//
// 所以门禁只盯 A 类：运行时还有没有人读它们。B 类单独列出来做提醒。
// 退出码 0 = A 类可以删；1 = 还有运行时依赖。

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');

// A 类：旧账本（待退役）
var LEDGER_TABLES = ['xy_account', 'xy_tx', 'xy_entry'];

// B 类：业务凭证（保留）
var BIZ_TABLES = [
  'xy_recharge', 'xy_withdraw', 'xy_collect', 'xy_collect_member',
  'xy_packet', 'xy_packet_claim', 'xy_packet_target',
  'xy_cross_packet', 'xy_cross_tx', 'xy_peer', 'xy_pay_code', 'xy_pay_pin', 'xy_user_home'
];

var ROOTS = [
  path.join(ROOT, 'server', 'src'),
  path.join(ROOT, 'market-apps', 'stock', 'backend')
];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (n) {
    var p = path.join(dir, n);
    var st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|cjs|mjs)$/.test(p)) out.push(p);
  });
  return out;
}

var files = [];
ROOTS.forEach(function (r) { walk(r, files); });
files = files.filter(function (f) {
  if (f.indexOf('ledger-retire-check') !== -1) return false;
  // 历史迁移是「已经执行过的历史记录」，不是运行时依赖；它们必须保留原文，
  // 否则老库重建会缺步骤。门禁只看现在还在跑的服务代码。
  return f.replace(/\\/g, '/').indexOf('server/src/migrations/') === -1;
});

// 注释里提到表名不算依赖 —— 否则「以前这里读写 xy_account」这种说明性文字
// 会永远把门禁卡住，最后大家只好去改注释而不是改代码。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

var ledgerRe = new RegExp('\\b(' + LEDGER_TABLES.join('|') + ')\\b');
var bizRe = new RegExp('\\b(' + BIZ_TABLES.join('|') + ')\\b');

var runtime = [];
var biz = [];

files.forEach(function (f) {
  var rel = path.relative(ROOT, f).replace(/\\/g, '/');
  var src = stripComments(fs.readFileSync(f, 'utf8'));
  if (ledgerRe.test(src)) runtime.push(rel);
  if (bizRe.test(src)) biz.push(rel);
});

console.log('\n=== 学元账本 · 旧账本退役门禁 ===');
console.log('');
console.log('A 类（旧账本三表）运行时依赖:', runtime.length);
runtime.sort().forEach(function (f) { console.log('  ✗ ' + f); });
console.log('');
console.log('B 类（业务凭证表）仍在使用:', biz.length, '个文件 —— 属于正常，不要删');
biz.sort().forEach(function (f) { console.log('  · ' + f); });

var canRetire = runtime.length === 0;
console.log('');
if (canRetire) {
  console.log('✓ A 类运行时依赖已清零，可以执行归档：');
  console.log('   ① node server/scripts/ledger-archive-legacy.cjs   （导出三表到 backup/legacy-*.json.gz）');
  console.log('   ② DROP TABLE xy_account / xy_tx / xy_entry');
  console.log('   ③ 旧库快照保留 ≥90 天');
  console.log('');
  console.log('   ⚠️ B 类 13 张业务表不在归档范围内：它们是充值单、提现单、红包、');
  console.log('      群收款、支付密码的凭证，删了历史就查不到了。');
} else {
  console.log('✗ 现在还不能删旧账本：上面的运行时文件仍在读 xy_account / xy_tx / xy_entry。');
  console.log('   先把这些读取点改到 src/ledger/*，再跑本脚本。');
}
console.log('');
process.exit(canRetire ? 0 : 1);
