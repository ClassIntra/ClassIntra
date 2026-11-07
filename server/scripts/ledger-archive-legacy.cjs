// 学元账本 · 旧账本归档
// 用法：
//   node server/scripts/ledger-archive-legacy.cjs              # 只导出（默认）
//   node server/scripts/ledger-archive-legacy.cjs --drop       # 导出后删表
//
// ---- 归档什么、不归档什么 ----
// 归档：xy_account / xy_tx / xy_entry —— 已经停止写入的旧账本三表。
// 不归档：xy_recharge / xy_withdraw / xy_packet* / xy_collect* / xy_pay_*
//         —— 那是充值单、提现单、红包、群收款、支付密码的**业务凭证**，
//            删了「谁交过钱、哪张单被谁批的」就查不到了，必须留在库里。
//
// ---- 为什么用 gzip 而不是直接拷库 ----
// 100MB 的整库快照每天一份很快就占满磁盘；这三张表压完通常只有几 MB，
// 而且 JSON 行格式可以直接 grep / 导入，比二进制库文件更适合「事后查一笔账」。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var db = require('../src/utils/db');

var LEDGER_TABLES = ['xy_account', 'xy_entry', 'xy_tx'];
var DROP = process.argv.indexOf('--drop') !== -1;

function stamp() {
  var d = new Date();
  function p(n) { return ('0' + n).slice(-2); }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function hasTable(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function main() {
  console.log('\n=== 旧账本归档 ===\n');

  var present = LEDGER_TABLES.filter(hasTable);
  var missing = LEDGER_TABLES.filter(function (t) { return !hasTable(t); });

  if (!present.length) {
    console.log('✓ 三张旧账本表都不存在了（已归档或从未创建），无需操作。');
    return 0;
  }
  if (missing.length) {
    console.log('⚠️  以下表不存在，将跳过：' + missing.join(', '));
  }

  var dump = { archived_at: new Date().toISOString(), tables: {} };
  var total = 0;

  present.forEach(function (t) {
    var rows = db.prepare('SELECT * FROM "' + t + '"').all();
    dump.tables[t] = { count: rows.length, rows: rows };
    total += rows.length;
    console.log('  ' + t.padEnd(14) + String(rows.length).padStart(7) + ' 行');
  });

  var dir = path.resolve(__dirname, '..', 'database', 'backup');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  var file = path.join(dir, 'legacy-' + stamp() + '.json.gz');
  var raw = Buffer.from(JSON.stringify(dump), 'utf8');
  fs.writeFileSync(file, zlib.gzipSync(raw, { level: 9 }));

  console.log('');
  console.log('✓ 已导出 ' + total + ' 行 →');
  console.log('  ' + file);
  console.log('  原始 ' + (raw.length / 1024).toFixed(1) + ' KB → 压缩后 ' +
    (fs.statSync(file).size / 1024).toFixed(1) + ' KB');

  if (!DROP) {
    console.log('');
    console.log('未删表（默认只读）。确认归档可读后，再执行一次并加 --drop：');
    console.log('  node server/scripts/ledger-archive-legacy.cjs --drop');
    // 顺手做一次抽检：把导出的文件读回来，确认不是空壳
    var back = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    var okCount = Object.keys(back.tables).every(function (t) {
      return back.tables[t].rows.length === back.tables[t].count;
    });
    console.log('  抽检（读回文件行数一致）: ' + (okCount ? '✓' : '✗'));
    return okCount ? 0 : 1;
  }

  console.log('');
  db.pragma('foreign_keys = OFF');
  var tx = db.transaction(function () {
    present.forEach(function (t) {
      db.exec('DROP TABLE IF EXISTS "' + t + '"');
    });
  });
  tx();
  db.pragma('foreign_keys = ON');
  db.pragma('wal_checkpoint(TRUNCATE)');

  console.log('✓ 已删除：' + present.join(', '));
  console.log('  业务凭证表（xy_recharge / xy_withdraw / xy_packet* …）保持不动。');
  console.log('');
  return 0;
}

process.exit(main());
