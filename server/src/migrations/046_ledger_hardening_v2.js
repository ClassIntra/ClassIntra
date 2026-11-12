// 迁移 046 · 学元账本 v2 加固（可证明性 / 幂等 / 对账 / 供给硬闸）
// ============================================================
// 与 src/ledger/schema.sql 的「v2 加固」段逐字对应：测试库只跑 schema，
// 生产库只跑本迁移，两边结构必须一致。
//
// ⚠️ 本迁移**全是无破坏性 DDL**（ADD COLUMN / CREATE TABLE IF NOT EXISTS /
//    回填标记），不 DROP、不重建、不改任何一条既有分录或余额数值。
//    回滚只需停用新模块，资金层无需恢复。
//
// 编码约定：var / function（服务端 CommonJS 风格）

function hasColumn(db, table, col) {
  var rows = db.prepare('PRAGMA table_info(' + table + ')').all();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].name === col) return true;
  }
  return false;
}

function addColumn(db, table, col, decl) {
  if (hasColumn(db, table, col)) return false;
  db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
  return true;
}

function up(db) {
  var added = [];

  // ---- 1. 新列（历史行为默认值，语义不变） ----
  if (addColumn(db, 'xy_ledger_assets', 'supply_cap_cent', 'INTEGER NOT NULL DEFAULT 0')) added.push('assets.supply_cap_cent');
  if (addColumn(db, 'xy_ledger_balances', 'version', 'INTEGER NOT NULL DEFAULT 0')) added.push('balances.version');
  if (addColumn(db, 'xy_ledger_transactions', 'request_hash', 'TEXT')) added.push('transactions.request_hash');
  if (addColumn(db, 'xy_ledger_goods', 'requires_external', 'INTEGER NOT NULL DEFAULT 0')) added.push('goods.requires_external');

  // ---- 2. 新表（与 schema.sql 逐字一致） ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_tx_seals (',
    '  tx_id       INTEGER PRIMARY KEY REFERENCES xy_ledger_transactions(id),',
    '  prev_hash   TEXT NOT NULL,',
    '  entry_hash  TEXT NOT NULL,',
    '  chain_hash  TEXT NOT NULL,',
    '  actor       TEXT,',
    '  created_at  TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_ledger_chain_state (',
    '  id                INTEGER PRIMARY KEY CHECK (id = 1),',
    '  genesis_tx_id     INTEGER NOT NULL,',
    '  genesis_digest    TEXT NOT NULL,',
    '  genesis_head_hash TEXT NOT NULL,',
    '  head_tx_id        INTEGER NOT NULL,',
    '  head_hash         TEXT NOT NULL,',
    '  updated_at        TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_ledger_post_attempts (',
    '  id           INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  ref          TEXT NOT NULL,',
    '  request_hash TEXT,',
    '  error_code   TEXT NOT NULL,',
    '  message      TEXT NOT NULL,',
    '  actor        TEXT,',
    '  created_at   TEXT NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_xy_ledger_attempts_ref ON xy_ledger_post_attempts(ref, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_xy_ledger_attempts_code ON xy_ledger_post_attempts(error_code, created_at);',
    'CREATE TABLE IF NOT EXISTS xy_ledger_reconcile_runs (',
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  run_key     TEXT NOT NULL UNIQUE,',
    '  started_at  TEXT NOT NULL,',
    '  finished_at TEXT,',
    '  ok          INTEGER NOT NULL DEFAULT 0,',
    '  issue_count INTEGER NOT NULL DEFAULT 0,',
    '  summary     TEXT',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_ledger_reconcile_diffs (',
    '  id         INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  run_id     INTEGER NOT NULL REFERENCES xy_ledger_reconcile_runs(id),',
    '  code       TEXT NOT NULL,',
    '  scope      TEXT NOT NULL,',
    '  key_name   TEXT NOT NULL,',
    '  expected   INTEGER,',
    '  actual     INTEGER,',
    '  delta      INTEGER,',
    '  detail     TEXT NOT NULL DEFAULT \'\',',
    '  level      TEXT NOT NULL DEFAULT \'error\' CHECK (level IN (\'error\',\'warn\')),',
    '  created_at TEXT NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_xy_ledger_recon_diffs_run ON xy_ledger_reconcile_diffs(run_id, code);',
    'CREATE TABLE IF NOT EXISTS xy_ledger_supply_state (',
    '  asset       TEXT PRIMARY KEY REFERENCES xy_ledger_assets(asset),',
    '  issued_cent INTEGER NOT NULL DEFAULT 0,',
    '  version     INTEGER NOT NULL DEFAULT 1,',
    '  updated_at  TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_ledger_bridge_receipts (',
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  ref         TEXT NOT NULL UNIQUE,',
    '  tx_id       INTEGER REFERENCES xy_ledger_transactions(id),',
    '  user_id     TEXT NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  actor       TEXT,',
    '  created_at  TEXT NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_xy_ledger_bridge_receipts_user ON xy_ledger_bridge_receipts(user_id, created_at);'
  ].join('\n'));

  // ---- 3. 回填：让存量数据在新约束下「本来就是干净的」 ----
  // balances.version：历史行统一标记为 1（legacy 已初始化），日终对账只把
  // 「有分录却 version=0」判为断层。不去猜每行真实变更次数 —— 猜错不如不猜。
  db.exec('UPDATE xy_ledger_balances SET version = 1 WHERE version = 0');

  // goods.requires_external：有真实成本或实物/服务类商品才需要 external_cost 门禁。
  db.exec([
    'UPDATE xy_ledger_goods SET requires_external = 1',
    "WHERE requires_external = 0 AND (cost_cent > 0 OR kind IN ('physical','service'))"
  ].join('\n'));

  // ---- 4. 初始化链与供给计数器 ----
  // 必须在同一事务内、且在**任何新交易写入之前**完成：genesis_tx_id 取当前
  // MAX(tx.id)，此后所有新交易都落在链的新段里。
  var proof = require('../ledger/proof');
  var supply = require('../ledger/supply');
  var genesis = proof.ensureGenesis(db);
  var supplyState = supply.ensure(db);

  console.log('[migration 046] 新列: ' + (added.join(', ') || '（均已存在）'));
  console.log('[migration 046] genesis: ' + JSON.stringify(genesis));
  console.log('[migration 046] supply: ' + JSON.stringify(supplyState));
}

module.exports = { version: 46, name: 'ledger_hardening_v2', up: up };
