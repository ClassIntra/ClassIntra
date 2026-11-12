// 学元账本 · 累计发行硬闸
// ============================================================
// 「不能凭空印钱」原来只靠配额（单笔 / 每日）和人工纪律。配额能挡手滑，
// 挡不住「每天发一点、发一年」。这里给每个资产一个 O(1) 的累计发行计数器：
//
//   post() 每笔事务内：issued_cent += 本笔 clearing 发行额；若 > cap 则整笔回滚。
//
// 为什么不每次 SUM(entries)：entries 线性增长，全表聚合进写入热路径会拖死
// post()（V.14 修正 2）。计数器是物化视图，reconcile 再拿它与分录交叉验证。
//
// cap 来自 xy_ledger_assets.supply_cap_cent，0 = 不限（**默认**，保持线上行为）。
// CASH 有真金背书，理论上不该设 cap；真要设也能设，机制与权益资产同构。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var defaultDb = require('../utils/db');
var errors = require('./errors');

function d(db) { return db || defaultDb; }
function q(sql, db) { return d(db).prepare(sql); }
function nowIso() { return new Date().toISOString(); }

function tableReady(db) {
  return !!d(db).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_supply_state'").get();
}

// 为每个资产建一行；issued_cent 首次按历史分录聚合（迁移只跑一次，允许 O(n)）。
function ensure(db) {
  var conn = d(db);
  if (!tableReady(conn)) return { skipped: true, reason: 'supply_state 表不存在（请先跑迁移 046）' };
  var assets = conn.prepare('SELECT asset FROM xy_ledger_assets').all();

  // ⚠️ 快速路径：post() 每笔都会调 ensure，一旦初始化完就绝不能再跑
  // SUM(entries) —— 那会把线性增长的全表扫描塞进写入热路径（V.14 修正 2）。
  var have = conn.prepare('SELECT COUNT(*) AS n FROM xy_ledger_supply_state').get().n;
  if (have >= assets.length) return { skipped: true, reason: 'already initialized', rows: have };

  var clearingIds = conn.prepare("SELECT id FROM xy_ledger_accounts WHERE kind = 'clearing'").all();
  var issued = {};
  if (clearingIds.length) {
    var rows = conn.prepare([
      'SELECT asset, COALESCE(SUM(amount_cent), 0) AS s',
      'FROM xy_ledger_entries WHERE direction = -1 AND account_id IN (' +
        clearingIds.map(function () { return '?'; }).join(',') + ') GROUP BY asset'
    ].join('\n')).all(...clearingIds.map(function (r) { return r.id; }));
    rows.forEach(function (r) { issued[r.asset] = Number(r.s) || 0; });
  }
  var ins = conn.prepare([
    'INSERT OR IGNORE INTO xy_ledger_supply_state (asset, issued_cent, version, updated_at)',
    'VALUES (?, ?, 1, ?)'
  ].join(' '));
  var created = 0;
  assets.forEach(function (a) {
    var r = ins.run(a.asset, issued[a.asset] || 0, nowIso());
    created += r.changes;
  });
  return { created: created, totals: issued };
}

function read(db, asset) {
  if (!tableReady(db)) return null;
  return q('SELECT * FROM xy_ledger_supply_state WHERE asset = ?', db).get(String(asset).toUpperCase()) || null;
}

function all(db) {
  if (!tableReady(db)) return [];
  return q('SELECT * FROM xy_ledger_supply_state ORDER BY asset', db).all();
}

function capOf(db, asset) {
  var row = q('SELECT supply_cap_cent FROM xy_ledger_assets WHERE asset = ?', db).get(String(asset).toUpperCase());
  return row ? Number(row.supply_cap_cent || 0) : 0;
}

// 在 post() 的事务内调用。issueByAsset = { CASH: n, GRANT: n, ... }（本笔发行额）。
// 返回实际写入的增量，供 reconcile 与审计使用。
// ⚠️ 抛错必须让外层事务整体回滚 —— 发行额与分录要么一起成立，要么一起不成立。
function apply(db, issueByAsset) {
  var conn = d(db);
  if (!tableReady(conn)) return { skipped: true, deltas: {} };
  var names = Object.keys(issueByAsset || {});
  var deltas = {};

  // 先全量校验再写入：避免「前两个资产已经 +1、第三个超限」留下半截计数。
  for (var i = 0; i < names.length; i++) {
    var asset = String(names[i]).toUpperCase();
    var add = Number(issueByAsset[asset]) || 0;
    if (add <= 0) continue;
    var cap = capOf(conn, asset);
    var cur = conn.prepare('SELECT issued_cent, version FROM xy_ledger_supply_state WHERE asset = ?').get(asset);
    var issued = cur ? Number(cur.issued_cent) : 0;
    if (cap > 0 && issued + add > cap) {
      throw errors.of('SUPPLY_CAP_EXCEEDED',
        '资产 ' + asset + ' 累计发行超限（已发 ' + issued + ' 分，本笔 ' + add +
        ' 分，上限 ' + cap + ' 分）', { asset: asset, issued: issued, add: add, cap: cap });
    }
    deltas[asset] = { add: add, version: cur ? Number(cur.version) : 0 };
  }

  var names2 = Object.keys(deltas);
  for (var k = 0; k < names2.length; k++) {
    var a = names2[k];
    var info = deltas[a];
    var exists = conn.prepare('SELECT 1 AS x FROM xy_ledger_supply_state WHERE asset = ?').get(a);
    if (exists) {
      var upd = conn.prepare([
        'UPDATE xy_ledger_supply_state',
        'SET issued_cent = issued_cent + ?, version = version + 1, updated_at = ?',
        'WHERE asset = ? AND version = ?'
      ].join(' ')).run(info.add, nowIso(), a, info.version);
      if (!upd.changes) {
        throw errors.of('VERSION_CONFLICT', '资产 ' + a + ' 发行计数器版本冲突，请重试');
      }
    } else {
      conn.prepare([
        'INSERT INTO xy_ledger_supply_state (asset, issued_cent, version, updated_at)',
        'VALUES (?, ?, 1, ?)'
      ].join(' ')).run(a, info.add, nowIso());
    }
  }
  return { skipped: false, deltas: deltas };
}

module.exports = {
  ensure: ensure,
  read: read,
  all: all,
  capOf: capOf,
  apply: apply,
  tableReady: tableReady
};
