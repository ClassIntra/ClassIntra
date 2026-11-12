// 学元账本 · 日终三方对账（差异落库）
// ============================================================
// invariants.check() 是「现在对不对」，本文件是「今天有没有对过、错了哪一行、
// 上次是什么时候对的」。差异不落库的对账等于没对：第二天没人记得昨晚报过什么。
//
// 三方 = 分录聚合 / 余额物化 / 真金台账负债侧；另交叉校验托管三数、累计发行、
// 哈希链、余额版本断层。每项差异按 (code, scope, key) 落一行，可追历史。
//
// ⚠️ PNL 只是报表项（warn），不进 issues：历史订单数据不全，拿它拦门禁会
//    让每一次对账都失败，最后大家只好把对账关掉 —— 那就本末倒置了。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var defaultDb = require('../utils/db');
var proof = require('./proof');

function d(db) { return db || defaultDb; }
function q(sql, db) { return d(db).prepare(sql); }
function nowIso() { return new Date().toISOString(); }

function tableReady(db, name) {
  return !!d(db).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function ready(db) {
  return tableReady(db, 'xy_ledger_reconcile_runs') &&
         tableReady(db, 'xy_ledger_reconcile_diffs') &&
         tableReady(db, 'xy_ledger_balances');
}

function add(diffs, code, scope, key, expected, actual, detail, level) {
  diffs.push({
    code: code,
    scope: String(scope),
    key: String(key),
    expected: expected == null ? null : Number(expected),
    actual: actual == null ? null : Number(actual),
    delta: (expected == null || actual == null) ? null : Number(actual) - Number(expected),
    detail: detail || '',
    level: level || 'error'
  });
}

// opts = { runKey, force, skipProof }
function run(db, opts) {
  var conn = d(db);
  var o = opts || {};
  if (!ready(conn)) {
    return { ok: false, duplicate: false, schema_missing: true,
      issues: [{ code: 'SCHEMA_MISSING', detail: '对账表不存在，请先跑迁移 046' }] };
  }

  var runKey = String(o.runKey || ('daily:' + nowIso().slice(0, 10)));
  var existing = conn.prepare('SELECT * FROM xy_ledger_reconcile_runs WHERE run_key = ?').get(runKey);
  if (existing && !o.force) {
    return {
      ok: !!existing.ok, duplicate: true, run_id: existing.id, run_key: runKey,
      issue_count: Number(existing.issue_count), finished_at: existing.finished_at,
      diffs: conn.prepare('SELECT * FROM xy_ledger_reconcile_diffs WHERE run_id = ? ORDER BY id').all(existing.id)
    };
  }

  var info = conn.prepare([
    'INSERT INTO xy_ledger_reconcile_runs (run_key, started_at, ok, issue_count)',
    "VALUES (?, ?, 0, 0)"
  ].join(' ')).run(runKey, nowIso());
  var runId = Number(info.lastInsertRowid);

  var diffs = [];

  // ---- 1. 余额物化 vs 分录聚合（双向 UNION，能抓出「只在其中一边有」的行）----
  var driftRows = q([
    'SELECT k AS kk, SUM(b) AS expected, SUM(e) AS actual FROM (',
    "  SELECT account_id || '|' || asset AS k, balance AS b, 0 AS e FROM xy_ledger_balances",
    '  UNION ALL',
    "  SELECT account_id || '|' || asset AS k, 0 AS b, direction * amount_cent AS e FROM xy_ledger_entries",
    ') GROUP BY k HAVING SUM(b) <> SUM(e)'
  ].join('\n'), conn).all();
  driftRows.forEach(function (r) {
    add(diffs, 'BALANCE_DRIFT', 'balance', r.kk, r.expected, r.actual,
      '余额物化与分录汇总不一致');
  });

  // ---- 2. 真金：账面现金 ≡ cashbook 负债侧 ----
  var onBook = q([
    'SELECT COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
    "JOIN xy_ledger_accounts a ON a.id = b.account_id WHERE b.asset = 'CASH' AND a.kind <> 'clearing'"
  ].join('\n'), conn).get().s;
  var liab = q("SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook WHERE scope = 'liability'", conn).get().s;
  if (Number(onBook) !== Number(liab)) {
    add(diffs, 'CASH_COVER', 'cashbook', 'CASH', onBook, liab, '账面现金与真金台账负债侧不等');
  }

  // ---- 3. 托管：escrow 余额 ≡ 未结 hold ≡ 未完成订单面值（逐资产）----
  var esc = q([
    'SELECT b.asset, COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
    "JOIN xy_ledger_accounts a ON a.id = b.account_id WHERE a.kind = 'escrow' AND a.owner_id = 'orders'",
    'GROUP BY b.asset'
  ].join('\n'), conn).all();
  var holds = q("SELECT asset, COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_holds WHERE state = 'held' GROUP BY asset", conn).all();
  var orders = q([
    'SELECT asset, COALESCE(SUM(face_cent), 0) AS s FROM xy_ledger_orders',
    "WHERE status IN ('paid','fulfilled','refunding','disputed') GROUP BY asset"
  ].join('\n'), conn).all();
  function toMap(rows) { var m = {}; rows.forEach(function (r) { m[r.asset] = Number(r.s); }); return m; }
  var em = toMap(esc), hm = toMap(holds), om = toMap(orders);
  var keys = {};
  [em, hm, om].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = true; }); });
  Object.keys(keys).forEach(function (asset) {
    var e = em[asset] || 0, h = hm[asset] || 0, ord = om[asset] || 0;
    if (e !== h) add(diffs, 'ESCROW_DRIFT', 'escrow', asset + ':hold', e, h, '托管余额与未结 hold 不等');
    if (ord !== 0 && h !== ord) add(diffs, 'ESCROW_DRIFT', 'escrow', asset + ':order', ord, h, '未完成订单面值与未结 hold 不等');
  });

  // ---- 4. 累计发行计数器 vs 分录（物化视图必须能被流水重算出来）----
  if (tableReady(conn, 'xy_ledger_supply_state')) {
    var stateRows = q('SELECT asset, issued_cent FROM xy_ledger_supply_state', conn).all();
    var realRows = q([
      'SELECT e.asset, COALESCE(SUM(e.amount_cent), 0) AS s FROM xy_ledger_entries e',
      "JOIN xy_ledger_accounts a ON a.id = e.account_id WHERE a.kind = 'clearing' AND e.direction = -1",
      'GROUP BY e.asset'
    ].join('\n'), conn).all();
    var sm = {}, rm = {};
    stateRows.forEach(function (r) { sm[r.asset] = Number(r.issued_cent); });
    realRows.forEach(function (r) { rm[r.asset] = Number(r.s); });
    Object.keys(sm).concat(Object.keys(rm)).filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .forEach(function (asset) {
        var s = sm[asset] || 0, r = rm[asset] || 0;
        if (s !== r) add(diffs, 'SUPPLY_DRIFT', 'supply', asset, r, s, '累计发行计数器与分录不一致');
      });
  }

  // ---- 5. 哈希链（历史段 + 新段一起验）----
  if (!o.skipProof) {
    var pv = proof.verify(conn);
    (pv.issues || []).forEach(function (i) {
      add(diffs, 'SEAL_' + i.code, 'proof', String(i.tx_id || 'chain'), null, null,
        i.detail || i.code);
    });
  }

  // ---- 6. 余额版本断层：有分录却是 version=0，说明有人绕过 post() 写余额 ----
  var versionRows = q([
    'SELECT b.account_id, b.asset FROM xy_ledger_balances b WHERE b.version = 0',
    'AND EXISTS (SELECT 1 FROM xy_ledger_entries e WHERE e.account_id = b.account_id AND e.asset = b.asset)'
  ].join('\n'), conn).all();
  versionRows.forEach(function (r) {
    add(diffs, 'VERSION_DRIFT', 'balance_version', r.account_id + '|' + r.asset, 1, 0,
      '余额行有分录但版本为 0（疑似绕过 ledger.post 写入）');
  });

  // ---- 7. 报表项（只进 summary，不进 issues）----
  var summary = {
    cash_on_book_cent: Number(onBook),
    cashbook_liability_cent: Number(liab),
    platform_cash_cent: q([
      'SELECT COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
      "JOIN xy_ledger_accounts a ON a.id = b.account_id WHERE b.asset = 'CASH' AND a.kind = 'platform'"
    ].join('\n'), conn).get().s,
    cashbook_pnl_cent: q("SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook WHERE scope = 'pnl'", conn).get().s,
    tx_count: q('SELECT COUNT(*) AS n FROM xy_ledger_transactions', conn).get().n,
    entry_count: q('SELECT COUNT(*) AS n FROM xy_ledger_entries', conn).get().n,
    order_count: q('SELECT COUNT(*) AS n FROM xy_ledger_orders', conn).get().n,
    proof: o.skipProof ? null : (function () {
      var p = proof.verify(conn);
      return { ok: p.ok, checked: p.checked, legacy_checked: p.legacy_checked, head_hash: p.head_hash };
    })()
  };
  summary.cost_cent = -Number(summary.cashbook_pnl_cent);
  summary.gross_cent = Number(summary.platform_cash_cent) - Number(summary.cost_cent);

  var errors = diffs.filter(function (x) { return x.level === 'error'; });
  var warnings = diffs.filter(function (x) { return x.level === 'warn'; });

  var insDiff = conn.prepare([
    'INSERT INTO xy_ledger_reconcile_diffs',
    '(run_id, code, scope, key_name, expected, actual, delta, detail, level, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join(' '));
  diffs.forEach(function (x) {
    insDiff.run(runId, x.code, x.scope, x.key, x.expected, x.actual, x.delta, x.detail, x.level, nowIso());
  });

  conn.prepare([
    'UPDATE xy_ledger_reconcile_runs SET finished_at = ?, ok = ?, issue_count = ?, summary = ? WHERE id = ?'
  ].join(' ')).run(nowIso(), errors.length === 0 ? 1 : 0, errors.length, JSON.stringify(summary), runId);

  return {
    ok: errors.length === 0,
    duplicate: false,
    run_id: runId,
    run_key: runKey,
    issue_count: errors.length,
    warning_count: warnings.length,
    diffs: diffs,
    summary: summary
  };
}

function latest(db) {
  var conn = d(db);
  if (!ready(conn)) return null;
  var r = conn.prepare('SELECT * FROM xy_ledger_reconcile_runs ORDER BY id DESC LIMIT 1').get();
  if (!r) return null;
  return {
    run: r,
    diffs: conn.prepare('SELECT * FROM xy_ledger_reconcile_diffs WHERE run_id = ? ORDER BY id').all(r.id)
  };
}

function history(db, limit) {
  var conn = d(db);
  if (!ready(conn)) return [];
  return conn.prepare('SELECT * FROM xy_ledger_reconcile_runs ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100));
}

module.exports = {
  run: run,
  latest: latest,
  history: history,
  ready: ready
};
