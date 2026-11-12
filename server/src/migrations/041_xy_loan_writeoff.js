// 迁移 041：学元贷款 v1.1 —— 支持班管核销
//
// ---- 为什么需要这一条 ----
// 040 已经先一步在部分库（包括 18i 生产库）落过第一版贷款表：
//   status CHECK 只允许 active / repaid，没有 write_off_at/by/reason。
// 之后 v1.1 增加了「班管核销」，需要：
//   · status 允许 written_off
//   · write_off_at / write_off_by / write_off_reason 三列
//   · written_off 必须有核销时间
// SQLite 不能 ALTER CHECK，只能重建表。生产库已有真实贷款与还款，
// 必须按 id 原样搬迁，绝不能 DROP 后当空表重建。
//
// ---- 外键 ----
// xy_ledger_loan_repays.loan_id REFERENCES xy_ledger_loans(id)。
// SQLite 不能在事务内切换 foreign_keys，所以本迁移声明 foreignKeysOff:true，
// 由 migration-runner 在事务外关闭、提交后恢复并跑 foreign_key_check。
// 重建期间 legacy_alter_table=ON，避免 RENAME 把还款表的外键改指向 _old。
//
// 幂等：已是新结构（含 written_off + write_off_at）直接返回；表不存在也返回。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  var row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='xy_ledger_loans'"
  ).get();
  if (!row) return;

  var oldSql = String(row.sql);
  if (oldSql.indexOf("'written_off'") !== -1 && oldSql.indexOf('write_off_at') !== -1) return;

  db.exec('PRAGMA legacy_alter_table = ON');
  try {
    db.exec('ALTER TABLE xy_ledger_loans RENAME TO xy_ledger_loans_old');

    db.exec([
      'CREATE TABLE xy_ledger_loans (',
      '  id                    INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  ref                   TEXT NOT NULL UNIQUE,',
      '  user_id               TEXT NOT NULL,',
      '  account_id            INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),',
      '  principal_cent        INTEGER NOT NULL CHECK (principal_cent > 0),',
      '  interest_cent         INTEGER NOT NULL DEFAULT 0 CHECK (interest_cent >= 0),',
      '  due_at                TEXT NOT NULL,',
      "  status                TEXT NOT NULL DEFAULT 'active'",
      "                        CHECK (status IN ('active','repaid','written_off')),",
      '  repaid_principal_cent INTEGER NOT NULL DEFAULT 0',
      '                        CHECK (repaid_principal_cent >= 0 AND repaid_principal_cent <= principal_cent),',
      '  repaid_interest_cent  INTEGER NOT NULL DEFAULT 0',
      '                        CHECK (repaid_interest_cent >= 0 AND repaid_interest_cent <= interest_cent),',
      '  out_tx_id             INTEGER REFERENCES xy_ledger_transactions(id),',
      '  opened_at             TEXT NOT NULL,',
      '  closed_at             TEXT,',
      '  last_repay_at         TEXT,',
      '  write_off_at          TEXT,',
      '  write_off_by          TEXT,',
      '  write_off_reason      TEXT,',
      "  CHECK (status <> 'repaid' OR",
      '         (repaid_principal_cent = principal_cent AND repaid_interest_cent = interest_cent)),',
      "  CHECK (status <> 'written_off' OR write_off_at IS NOT NULL)",
      ');'
    ].join('\n'));

    db.exec([
      'INSERT INTO xy_ledger_loans (',
      '  id, ref, user_id, account_id, principal_cent, interest_cent, due_at, status,',
      '  repaid_principal_cent, repaid_interest_cent, out_tx_id,',
      '  opened_at, closed_at, last_repay_at',
      ')',
      'SELECT',
      '  id, ref, user_id, account_id, principal_cent, interest_cent, due_at, status,',
      '  repaid_principal_cent, repaid_interest_cent, out_tx_id,',
      '  opened_at, closed_at, last_repay_at',
      'FROM xy_ledger_loans_old'
    ].join('\n'));

    db.exec('DROP TABLE xy_ledger_loans_old');
    db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_user ON xy_ledger_loans(user_id, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_due  ON xy_ledger_loans(status, due_at)');
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF');
  }

  var bad = db.prepare('PRAGMA foreign_key_check').all();
  if (bad.length) {
    throw new Error('贷款表重建后外键校验失败: ' + JSON.stringify(bad.slice(0, 3)));
  }
}

module.exports = {
  version: 41,
  name: 'xy_loan_writeoff',
  foreignKeysOff: true,
  up: up
};
