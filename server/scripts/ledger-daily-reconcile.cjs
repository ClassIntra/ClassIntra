// 学元账本 · 日终三方对账 CLI
// ============================================================
// 用法（一律用系统 Node / ABI 137）：
//   node server/scripts/ledger-daily-reconcile.cjs                       # 生产库，今天
//   node server/scripts/ledger-daily-reconcile.cjs --db <库副本路径>      # 验证用，不碰生产
//   node server/scripts/ledger-daily-reconcile.cjs --day 2026-11-11 --force
//   node server/scripts/ledger-daily-reconcile.cjs --json
//
// 退出码：0 = 零差异；1 = 有差异或无法执行（可直接当发版门禁）。
// ⚠️ 不加 --db 会连生产库并写 runs/diffs 两张对账表（不动任何资金行）。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var path = require('path');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  var v = process.argv[i + 1];
  if (!v || v.slice(0, 2) === '--') return true;
  return v;
}

var dbArg = arg('db');
if (dbArg && dbArg !== true) {
  var resolved = path.resolve(String(dbArg));
  if (!fs.existsSync(resolved)) {
    console.error('库不存在: ' + resolved);
    process.exit(1);
  }
  process.env.DB_PATH = resolved;
}

var day = String(arg('day', new Date().toISOString().slice(0, 10)));
var force = process.argv.indexOf('--force') !== -1;
var asJson = process.argv.indexOf('--json') !== -1;

var reconcile = require('../src/ledger/reconcile');
var inv = require('../src/ledger/invariants');
var proof = require('../src/ledger/proof');
var units = require('../src/ledger/units');

// *_cent 是「账本单位」，不是人民币分。同时给出元与学元，避免运维再拿 /1000 去猜。
function moneyLine(label, cent) {
  var n = Number(cent) || 0;
  return label + ': ' + (n / units.UNITS_PER_YUAN).toFixed(2) + ' 元 / ' +
    (n / units.UNITS_PER_XUEYUAN).toFixed(2) + ' 学元（' + n + ' 账本单位）';
}

function finish(payload, good) {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  process.exit(good ? 0 : 1);
}

if (!reconcile.ready()) {
  var missing = { ok: false, error: 'SCHEMA_MISSING', message: '对账表不存在，请先跑迁移 046', day: day };
  if (asJson) console.log(JSON.stringify(missing, null, 2));
  else console.error('\n✗ ' + missing.message + '\n');
  process.exit(1);
}

var deep = inv.checkDeep();
var head = proof.head();
var r = reconcile.run(null, { runKey: 'daily:' + day, force: force });
var good = !!r.ok && !!deep.ok;

if (!asJson) {
  console.log('\n=== 学元账本 · 日终对账 ' + day + ' ===');
  console.log('库        : ' + (process.env.DB_PATH || '(默认 config.dbPath)'));
  console.log('轻量层    : I1–I10 ' + (deep.base_ok ? '✓ 全绿' : '✗ ' + deep.base_issues.length + ' 项'));
  console.log('深度层    : I11–I13 ' + (deep.issues.length === 0 ? '✓ 全绿' : '✗ ' + deep.issues.length + ' 项'));
  deep.issues.forEach(function (i) { console.log('            ' + i.code + '：' + i.detail); });
  console.log('哈希链    : ' + (head ? 'genesis #' + head.genesis_tx_id + ' → head #' + head.head_tx_id : '未初始化'));
  console.log('对账运行  : #' + r.run_id + (r.duplicate ? '（今日已跑，返回既有结果）' : ''));
  console.log('差异      : ' + r.issue_count + ' 项' + (r.warning_count ? '（warn ' + r.warning_count + '）' : ''));
  (r.diffs || []).slice(0, 20).forEach(function (d) {
    console.log('  [' + d.level + '] ' + d.code + ' ' + d.scope + '/' + d.key +
      ' 期望 ' + d.expected + ' 实际 ' + d.actual + ' — ' + d.detail);
  });
  if (r.summary) {
    console.log(moneyLine('账面现金  ', r.summary.cash_on_book_cent));
    console.log(moneyLine('真金负债  ', r.summary.cashbook_liability_cent));
    console.log(moneyLine('平台现金  ', r.summary.platform_cash_cent));
    console.log(moneyLine('真实成本  ', r.summary.cost_cent));
    console.log(moneyLine('已实现毛利', r.summary.gross_cent));
    console.log('存量      : ' + r.summary.tx_count + ' 笔交易 / ' + r.summary.entry_count + ' 条分录');
  }
  console.log('\n结论: ' + (good ? '✓ 账本可自证，零差异' : '✗ 存在差异，先查 /api/xy/admin/reconcile/latest') + '\n');
}

finish({
  ok: good,
  day: day,
  run: { id: r.run_id, key: r.run_key, duplicate: !!r.duplicate, issue_count: r.issue_count },
  light: { ok: deep.base_ok, issues: deep.base_issues },
  deep: { ok: deep.issues.length === 0, issues: deep.issues, summary: deep.summary },
  chain: head ? { genesis_tx_id: head.genesis_tx_id, head_tx_id: head.head_tx_id, head_hash: head.head_hash } : null,
  reconcile: { diffs: r.diffs, summary: r.summary }
}, good);
