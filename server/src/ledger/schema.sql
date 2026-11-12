-- 学元体系 账本 · 账本与交易 schema（greenfield）
-- 设计依据：docs/economy-design.md §V
-- 表名统一 xy_ledger_ 前缀，与旧 xy_* 物理隔离；旧表只读归档，不迁移数据。
-- 建表：node server/scripts/ledger-init.cjs
-- ⚠️ 不要放进 server/src/migrations/ —— PM2 自动重启会执行迁移目录。

PRAGMA foreign_keys = ON;

-- ---------- 资产：只有三种语义，靠数据行扩展而不是改表列 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_assets (
  asset         TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  redeemable    INTEGER NOT NULL CHECK (redeemable    IN (0,1)),
  transferable  INTEGER NOT NULL CHECK (transferable  IN (0,1)),
  external_cost INTEGER NOT NULL CHECK (external_cost IN (0,1)),
  supply        TEXT NOT NULL CHECK (supply IN ('cash','quota','closed')),
  sink          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'cent',
  -- v2 加固（迁移 046）：累计发行净额硬顶，0 = 不限（默认，保持线上行为）。
  -- 上限是**数据**不是代码：加一种资产只需给它写一行，不需要改内核。
  supply_cap_cent INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- ---------- 账户：钱在谁手里。只允许五种 kind ----------
-- allow_negative=1 只给发行对手方（clearing）：它的负值就是「已发行净额」。
CREATE TABLE IF NOT EXISTS xy_ledger_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('user','seller','platform','escrow','clearing')),
  owner_id       TEXT NOT NULL DEFAULT '',
  allow_negative INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  created_at     TEXT NOT NULL,
  UNIQUE (kind, owner_id)
);

-- ---------- 余额：(账户, 资产) 复合主键。不设 >=0 的 CHECK ----------
-- 原因：clearing 必须为负；负余额是否合法取决于账户属性，而 CHECK 不能跨表查询。
-- 校验在 ledger.post() 内完成（见 V.5 与 V.14 修正 1）。
CREATE TABLE IF NOT EXISTS xy_ledger_balances (
  account_id INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  asset      TEXT    NOT NULL REFERENCES xy_ledger_assets(asset),
  balance    INTEGER NOT NULL DEFAULT 0,
  -- v2 加固（迁移 046）：每次经 ledger.post() 更新必 +1。
  -- 绕过 post() 直接改余额会留下 version 断层，日终对账据此报警。
  version    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, asset)
);

-- ---------- 交易头：ref 是唯一幂等键 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'posted',
  initiator   TEXT,
  memo        TEXT,
  payload     TEXT,
  amount_cent INTEGER NOT NULL DEFAULT 0,
  -- v2 加固（迁移 046）：请求指纹。同 ref 异 payload 必须拒绝，不能静默返回 duplicate。
  -- 历史行为 NULL（legacy），只走「去重」不参与指纹比对，避免误伤存量重放。
  request_hash TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- 分录：只增不改。direction +1 入 / -1 出 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id       INTEGER NOT NULL REFERENCES xy_ledger_transactions(id),
  line_no     INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  asset       TEXT    NOT NULL REFERENCES xy_ledger_assets(asset),
  direction   INTEGER NOT NULL CHECK (direction IN (1,-1)),
  amount_cent INTEGER NOT NULL CHECK (amount_cent > 0),
  created_at  TEXT NOT NULL,
  UNIQUE (tx_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_entries_acc ON xy_ledger_entries(account_id, asset);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_entries_tx  ON xy_ledger_entries(tx_id);

-- ---------- 真金台账：scope 分开「负债侧」与「损益侧」 ----------
-- liability: recharge / refund —— 决定兑付敞口（I2 只对比这一侧）
-- pnl:       goods_cost / ai_cost / margin / fee —— 平台损益，不影响欠用户多少
CREATE TABLE IF NOT EXISTS xy_ledger_cashbook (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id       INTEGER REFERENCES xy_ledger_transactions(id),
  -- 只记**真实发生的人民币进出**。fee / margin 是账本内转移，不产生真金流，故不在此表。
  -- cross_in / cross_out：真金在两个班的账本之间迁移，一边减负债、一边加负债。
  -- 少了这两个类型，跨班红包/转账会在 cashbook.record 处被 CHECK 直接拒掉。
  type        TEXT NOT NULL CHECK (type IN ('recharge','refund','cross_in','cross_out','goods_cost','ai_cost','adjust')),
  scope       TEXT NOT NULL CHECK (scope IN ('liability','pnl')),
  amount_cent INTEGER NOT NULL,
  ref         TEXT NOT NULL UNIQUE,
  note        TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- 商品 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_goods (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_account_id INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  cover             TEXT NOT NULL DEFAULT '',
  price_cent        INTEGER NOT NULL CHECK (price_cent >= 0),
  cost_cent         INTEGER NOT NULL DEFAULT 0 CHECK (cost_cent >= 0),
  kind              TEXT NOT NULL CHECK (kind IN ('digital','physical','service')),
  stock_qty         INTEGER NOT NULL DEFAULT -1 CHECK (stock_qty >= -1),
  sold_qty          INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  status            TEXT NOT NULL DEFAULT 'on_shelf',
  -- v2 加固（迁移 046）：有真实成本 / 实物的商品必须只用 external_cost=1 的资产购买。
  requires_external INTEGER NOT NULL DEFAULT 0
);

-- ---------- 订单 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  buyer_account_id  INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  seller_account_id INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  goods_id          INTEGER REFERENCES xy_ledger_goods(id),
  kind              TEXT NOT NULL CHECK (kind IN ('goods','transfer','fee')),
  status            TEXT NOT NULL CHECK (status IN ('created','paid','fulfilled','done','closed','refunding','refunded','disputed')),
  asset             TEXT NOT NULL REFERENCES xy_ledger_assets(asset),
  qty               INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  note              TEXT NOT NULL DEFAULT '',
  face_cent         INTEGER NOT NULL CHECK (face_cent > 0),
  cost_cent         INTEGER NOT NULL DEFAULT 0 CHECK (cost_cent >= 0),
  rebate_cent       INTEGER NOT NULL DEFAULT 0 CHECK (rebate_cent >= 0),
  fee_cent          INTEGER NOT NULL DEFAULT 0 CHECK (fee_cent >= 0),
  created_at        TEXT NOT NULL,
  paid_at           TEXT,
  fulfilled_at      TEXT,
  closed_at         TEXT,
  -- 结构约束：练习金永不进订单（唯一允许的资产名硬编码，属结构禁令非扩展点）
  CHECK (asset <> 'PRACTICE'),
  -- 粗校验；真实上限 = platformMargin，由 templates/rebate 计算（V.14 修正 3）
  CHECK (rebate_cent <= face_cent)
);

-- ---------- 托管明细：一单可多次 hold（部分退款） ----------
CREATE TABLE IF NOT EXISTS xy_ledger_holds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES xy_ledger_orders(id),
  buyer_account_id  INTEGER NOT NULL,
  seller_account_id INTEGER NOT NULL,
  asset             TEXT NOT NULL,
  amount_cent       INTEGER NOT NULL CHECK (amount_cent > 0),
  state             TEXT NOT NULL CHECK (state IN ('held','settled','released'))
);
-- 一单可以有**多条** held 托管记录：支付按「赠送抵扣 ≤ 毛利」拆池，
-- 同一单可能同时压着 CASH 和 GRANT 两部分。所以唯一键是 (order_id, asset)，
-- 不是 order_id —— 后者会让「部分用赠金抵扣」的订单直接插不进去。
CREATE UNIQUE INDEX IF NOT EXISTS uq_xy_ledger_holds_active ON xy_ledger_holds(order_id, asset) WHERE state = 'held';
CREATE INDEX IF NOT EXISTS idx_xy_ledger_holds_state ON xy_ledger_holds(state);

-- ---------- 状态迁移：状态与资金同事务，迁移不可重复 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_order_transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES xy_ledger_orders(id),
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  -- 纯状态迁移（如 paid→fulfilled）没有资金动作，允许为空
  tx_id       INTEGER REFERENCES xy_ledger_transactions(id),
  ref         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  UNIQUE (order_id, from_status, to_status)
);

-- ---------- 红包：双轨显式二选一，不可混发 ----------
CREATE TABLE IF NOT EXISTS xy_ledger_redpackets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  sender_account_id INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  asset             TEXT NOT NULL REFERENCES xy_ledger_assets(asset),
  total_cent        INTEGER NOT NULL CHECK (total_cent > 0),
  count             INTEGER NOT NULL CHECK (count > 0),
  mode              TEXT NOT NULL CHECK (mode IN ('real','practice')),
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        TEXT NOT NULL,
  CHECK ((mode = 'real'     AND asset = 'CASH') OR
         (mode = 'practice' AND asset = 'PRACTICE'))
);

CREATE TABLE IF NOT EXISTS xy_ledger_redpacket_claims (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  redpacket_id       INTEGER NOT NULL REFERENCES xy_ledger_redpackets(id),
  claimer_account_id INTEGER NOT NULL,
  amount_cent        INTEGER NOT NULL CHECK (amount_cent > 0),
  ref                TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL,
  -- 一人一份：重复领取在数据库层就挡住
  UNIQUE (redpacket_id, claimer_account_id)
);

-- ---------- 学元贷款：只借 GRANT，不碰真金 ----------
-- 放款 = clearing -(本金) → user +(本金)
-- 还款 = user -(本息) → clearing +(本息)
-- 两个方向都只走 GRANT，所以 I2「账面现金 ≡ 真金台账负债」完全不受影响。
-- 本表只是业务凭证：余额与流水仍在 xy_ledger_balances / xy_ledger_entries。
-- 逾期不落状态列，由 status='active' + due_at + 宽限期 < now 派生 —— 少一个需要定时改写的状态。
-- written_off 是班管核销（确认收不回来），只改状态、不动钱；应还与已还的差额就是损失。
CREATE TABLE IF NOT EXISTS xy_ledger_loans (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ref                   TEXT NOT NULL UNIQUE,
  user_id               TEXT NOT NULL,
  account_id            INTEGER NOT NULL REFERENCES xy_ledger_accounts(id),
  principal_cent        INTEGER NOT NULL CHECK (principal_cent > 0),
  interest_cent         INTEGER NOT NULL DEFAULT 0 CHECK (interest_cent >= 0),
  due_at                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','repaid','written_off')),
  -- v2 信用体系：产品、期数、放款时锁定的利率、是否发生过逾期还款
  product               TEXT NOT NULL DEFAULT 'quick',
  installments          INTEGER NOT NULL DEFAULT 1,
  rate_percent          REAL NOT NULL DEFAULT 5,
  late_flag             INTEGER NOT NULL DEFAULT 0 CHECK (late_flag IN (0,1)),
  auto_repay             INTEGER NOT NULL DEFAULT 0 CHECK (auto_repay IN (0,1)),
  repaid_principal_cent INTEGER NOT NULL DEFAULT 0
                        CHECK (repaid_principal_cent >= 0 AND repaid_principal_cent <= principal_cent),
  repaid_interest_cent  INTEGER NOT NULL DEFAULT 0
                        CHECK (repaid_interest_cent >= 0 AND repaid_interest_cent <= interest_cent),
  out_tx_id             INTEGER REFERENCES xy_ledger_transactions(id),
  opened_at             TEXT NOT NULL,
  closed_at             TEXT,
  last_repay_at         TEXT,
  write_off_at          TEXT,
  write_off_by          TEXT,
  write_off_reason      TEXT,
  -- 状态与已还金额必须自洽：标 repaid 就一定真的还满；标 written_off 就必须有核销时间
  CHECK (status <> 'repaid' OR
         (repaid_principal_cent = principal_cent AND repaid_interest_cent = interest_cent)),
  CHECK (status <> 'written_off' OR write_off_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_user ON xy_ledger_loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_loans_due  ON xy_ledger_loans(status, due_at);

-- 每笔还款一行：本金/利息拆分以这里为准，loan 上的累计值只是物化缓存。
CREATE TABLE IF NOT EXISTS xy_ledger_loan_repays (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id        INTEGER NOT NULL REFERENCES xy_ledger_loans(id),
  ref            TEXT NOT NULL UNIQUE,
  amount_cent    INTEGER NOT NULL CHECK (amount_cent > 0),
  principal_cent INTEGER NOT NULL CHECK (principal_cent >= 0),
  interest_cent  INTEGER NOT NULL CHECK (interest_cent >= 0),
  tx_id          INTEGER REFERENCES xy_ledger_transactions(id),
  created_at     TEXT NOT NULL,
  -- 拆分明细必须刚好等于这笔还款额
  CHECK (principal_cent + interest_cent = amount_cent)
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_repays_loan ON xy_ledger_loan_repays(loan_id);

-- 分期账单：每期一条。旧贷款由 042 回填为 1 期，新贷款按期生成。
CREATE TABLE IF NOT EXISTS xy_ledger_loan_installments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id              INTEGER NOT NULL REFERENCES xy_ledger_loans(id),
  seq                  INTEGER NOT NULL CHECK (seq > 0),
  due_at               TEXT NOT NULL,
  principal_cent       INTEGER NOT NULL CHECK (principal_cent >= 0),
  interest_cent        INTEGER NOT NULL CHECK (interest_cent >= 0),
  paid_principal_cent  INTEGER NOT NULL DEFAULT 0
                       CHECK (paid_principal_cent >= 0 AND paid_principal_cent <= principal_cent),
  paid_interest_cent   INTEGER NOT NULL DEFAULT 0
                       CHECK (paid_interest_cent >= 0 AND paid_interest_cent <= interest_cent),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  late_paid            INTEGER NOT NULL DEFAULT 0 CHECK (late_paid IN (0,1)),
  paid_at              TEXT,
  UNIQUE (loan_id, seq),
  CHECK (status <> 'paid' OR (paid_principal_cent = principal_cent AND paid_interest_cent = interest_cent))
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_installments_loan ON xy_ledger_loan_installments(loan_id, seq);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_installments_due ON xy_ledger_loan_installments(status, due_at);

-- 信用档案：每个借款人一行。score 300–850；limit_override_cent=0 表示按规则算。
CREATE TABLE IF NOT EXISTS xy_ledger_credit_profiles (
  user_id              TEXT PRIMARY KEY,
  score                INTEGER NOT NULL DEFAULT 600 CHECK (score BETWEEN 300 AND 850),
  limit_override_cent  INTEGER NOT NULL DEFAULT 0 CHECK (limit_override_cent >= 0),
  limit_high_water_cent INTEGER NOT NULL DEFAULT 0 CHECK (limit_high_water_cent >= 0),
  blacklist_until      TEXT,
  blacklist_reason     TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- 信用分变动：只增不改，ref 幂等。
CREATE TABLE IF NOT EXISTS xy_ledger_credit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  score_after INTEGER NOT NULL CHECK (score_after BETWEEN 300 AND 850),
  reason      TEXT NOT NULL,
  ref         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_credit_events_user ON xy_ledger_credit_events(user_id, id);

-- 班管信用操作审计：限额/调分/拉黑/延期/核销。
CREATE TABLE IF NOT EXISTS xy_ledger_credit_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  operator    TEXT NOT NULL,
  reason      TEXT,
  payload     TEXT,
  ref         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_credit_audit_user ON xy_ledger_credit_audit(user_id, id);

-- ============================================================
-- v2 加固（迁移 046）· 可证明性 / 失败留痕 / 日终对账 / 供给硬闸
-- 本段与 migrations/046_ledger_hardening_v2.js 必须保持逐字一致：
-- 测试脚本只跑本 schema，生产只跑迁移，任何一边漏了都会让两套库结构漂移。
-- ============================================================

-- ---------- 分录哈希链：每笔上链交易一行 ----------
-- 历史段由 chain_state.genesis_digest 背书（迁移时压一次全历史分录摘要），
-- 之后每笔新交易接在链尾。改任意一条历史分录都会让 digest 或某节 hash 断开。
CREATE TABLE IF NOT EXISTS xy_ledger_tx_seals (
  tx_id       INTEGER PRIMARY KEY REFERENCES xy_ledger_transactions(id),
  prev_hash   TEXT NOT NULL,
  entry_hash  TEXT NOT NULL,
  chain_hash  TEXT NOT NULL,
  actor       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS xy_ledger_chain_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  genesis_tx_id     INTEGER NOT NULL,
  genesis_digest    TEXT NOT NULL,
  genesis_head_hash TEXT NOT NULL,
  head_tx_id        INTEGER NOT NULL,
  head_hash         TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- ---------- 被拒绝的写入凭证 ----------
-- 事务回滚会带走事务内写的行，所以校验阶段（事务外）由 post() 写一份，
-- 事务内失败由路由层 wrap() 补一份；按 (ref, request_hash, error_code) 可去重。
CREATE TABLE IF NOT EXISTS xy_ledger_post_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL,
  request_hash TEXT,
  error_code   TEXT NOT NULL,
  message      TEXT NOT NULL,
  actor        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_attempts_ref ON xy_ledger_post_attempts(ref, created_at);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_attempts_code ON xy_ledger_post_attempts(error_code, created_at);

-- ---------- 日终对账：运行记录 + 差异明细 ----------
-- run_key 按天唯一，60s 巡检重复调用直接返回已有结果，不重复写差异。
CREATE TABLE IF NOT EXISTS xy_ledger_reconcile_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key     TEXT NOT NULL UNIQUE,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  summary     TEXT
);

CREATE TABLE IF NOT EXISTS xy_ledger_reconcile_diffs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER NOT NULL REFERENCES xy_ledger_reconcile_runs(id),
  code       TEXT NOT NULL,
  scope      TEXT NOT NULL,
  key_name   TEXT NOT NULL,
  expected   INTEGER,
  actual     INTEGER,
  delta      INTEGER,
  detail     TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error','warn')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_recon_diffs_run ON xy_ledger_reconcile_diffs(run_id, code);

-- ---------- 累计发行计数器 ----------
-- 物化视图，避免每笔 post() 去 SUM 线性增长的 entries 表（V.14 修正 2）。
-- 日终对账拿它与分录交叉验证，保证「计数器不等于账」时能被发现。
CREATE TABLE IF NOT EXISTS xy_ledger_supply_state (
  asset       TEXT PRIMARY KEY REFERENCES xy_ledger_assets(asset),
  issued_cent INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

-- ---------- 渠道回执（Cluss 桥） ----------
-- 桥转账成功后留一行可查凭证，供对端按 ref 对账；不参与守恒与兑付敞口。
CREATE TABLE IF NOT EXISTS xy_ledger_bridge_receipts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT NOT NULL UNIQUE,
  tx_id       INTEGER REFERENCES xy_ledger_transactions(id),
  user_id     TEXT NOT NULL,
  amount_cent INTEGER NOT NULL,
  actor       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_ledger_bridge_receipts_user ON xy_ledger_bridge_receipts(user_id, created_at);
