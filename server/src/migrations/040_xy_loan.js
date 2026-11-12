// 迁移 040：学元贷款（只借赠送学元 GRANT）
//
// ---- 为什么要单开迁移 ----
// 036 会读取 ledger/schema.sql 建表，但它已经在所有存量库执行过，不会重跑。
// 新表必须由本迁移补上，否则老库在服务重启后没有 xy_ledger_loans，
// 钱包贷款页会报「尚未初始化」。
//
// ---- 边界 ----
// 只增加两张业务凭证表，不改任何现有表：
//   xy_ledger_loans        每笔贷款一行（本金、利息、到期日、已还累计）
//   xy_ledger_loan_repays  每次还款一行（本金/利息拆分、幂等 ref）
// 资金仍走 xy_ledger_entries：放款/还款都是 clearing ⇄ user 的 GRANT 分录。
//
// 幂等：全部 CREATE ... IF NOT EXISTS，新库由 schema.sql 先建也不会冲突。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_loans (',
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

  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_user ON xy_ledger_loans(user_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_due  ON xy_ledger_loans(status, due_at)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_loan_repays (',
    '  id             INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  loan_id        INTEGER NOT NULL REFERENCES xy_ledger_loans(id),',
    '  ref            TEXT NOT NULL UNIQUE,',
    '  amount_cent    INTEGER NOT NULL CHECK (amount_cent > 0),',
    '  principal_cent INTEGER NOT NULL CHECK (principal_cent >= 0),',
    '  interest_cent  INTEGER NOT NULL CHECK (interest_cent >= 0),',
    '  tx_id          INTEGER REFERENCES xy_ledger_transactions(id),',
    '  created_at     TEXT NOT NULL,',
    '  CHECK (principal_cent + interest_cent = amount_cent)',
    ');'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_repays_loan ON xy_ledger_loan_repays(loan_id)');
}

module.exports = { version: 40, name: 'xy_loan', up: up };
