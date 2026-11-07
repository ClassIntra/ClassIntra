// 迁移 039：真金台账允许跨班类型
//
// ---- 为什么 ----
// cashbook 的 type 列带 CHECK 白名单，原来只有 recharge/refund/goods_cost/ai_cost/adjust。
// 跨班红包 / 跨班转账把可兑付的 CASH 从 A 班账本搬到 B 班账本：
//   A 班 burn CASH（兑付义务减少）→ 需要 cross_out
//   B 班 mint CASH（兑付义务增加）→ 需要 cross_in
// 不写这两笔，I2「账面现金 ≡ 真金台账负债」会在两个班同时对不平；
// 写了但 CHECK 不放行，则 cashbook.record 抛错、整笔领取事务回滚 ——
// 表现就是「别的班的红包领不了」。
//
// SQLite 不能 ALTER CHECK，必须重建表。重建期间保留全部历史行与 id。
// 幂等：先检查建表语句是否已含 cross_in，是则跳过。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  var row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='xy_ledger_cashbook'"
  ).get();
  if (!row) return;                                   // 新库由 schema.sql 建表
  if (String(row.sql).indexOf('cross_in') !== -1) return;

  db.exec('PRAGMA foreign_keys = OFF');
  var run = db.transaction(function () {
    db.exec('ALTER TABLE xy_ledger_cashbook RENAME TO xy_ledger_cashbook_old');
    db.exec([
      'CREATE TABLE xy_ledger_cashbook (',
      '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  tx_id       INTEGER REFERENCES xy_ledger_transactions(id),',
      "  type        TEXT NOT NULL CHECK (type IN ('recharge','refund','cross_in','cross_out','goods_cost','ai_cost','adjust')),",
      "  scope       TEXT NOT NULL CHECK (scope IN ('liability','pnl')),",
      '  amount_cent INTEGER NOT NULL,',
      '  ref         TEXT NOT NULL UNIQUE,',
      '  note        TEXT,',
      '  created_at  TEXT NOT NULL',
      ');'
    ].join('\n'));
    db.exec([
      'INSERT INTO xy_ledger_cashbook (id, tx_id, type, scope, amount_cent, ref, note, created_at)',
      'SELECT id, tx_id, type, scope, amount_cent, ref, note, created_at FROM xy_ledger_cashbook_old'
    ].join('\n'));
    db.exec('DROP TABLE xy_ledger_cashbook_old');
  });
  run();
  db.exec('PRAGMA foreign_keys = ON');
}

module.exports = { version: 39, name: 'cashbook_cross_types', up: up };
