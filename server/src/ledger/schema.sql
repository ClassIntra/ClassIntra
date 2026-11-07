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
  price_cent        INTEGER NOT NULL CHECK (price_cent >= 0),
  cost_cent         INTEGER NOT NULL DEFAULT 0 CHECK (cost_cent >= 0),
  kind              TEXT NOT NULL CHECK (kind IN ('digital','physical','service')),
  status            TEXT NOT NULL DEFAULT 'on_shelf'
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
