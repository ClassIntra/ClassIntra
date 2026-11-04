// 迁移 030：学元双资金池 + 线下充值 / 提现
//
// ---- 为什么要拆两个池 ----
// 学元现在分两类来源：
//   cash  充值学元：班管线下收现金后录入，可转账、发红包、投资、提现
//   grant 赠送学元：开户礼金 / 每日津贴 / 教师发放 / 成就奖励，只能用于投资
//
// 拆池是为了堵住「系统赠送 → 提现套现」的漏洞：两条钱路从记账层就分开，
// 任何一条业务走错池都会在服务层直接拒绝，而不是靠前端自觉。
//
// ---- 兼容 ----
// 历史余额全部来自当时的单池体系（没有充值渠道），因此统一回填到 grant；
// 在途的红包/跨班转账也标记为 grant，保证旧业务能按原路结算完。
// 新业务一律显式写 pool，不再依赖默认值。
//
// 系统账户（@system:*）的 balance 是全局镜像，不参与分池。

function hasColumn(db, table, col) {
  try {
    var cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].name === col) return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

function addColumn(db, table, col, decl) {
  if (!hasColumn(db, table, col)) {
    try {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
    } catch (e) {
      // 表尚未创建（例如 xy_packet 由服务层懒建）时跳过，服务层 ensure 会补列
    }
  }
}

function up(db) {
  // ---- 账户分池 ----
  addColumn(db, 'xy_account', 'cash_balance', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'xy_account', 'grant_balance', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'xy_account', 'frozen_cash', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'xy_account', 'frozen_grant', 'INTEGER NOT NULL DEFAULT 0');

  // ---- 分录标记资金池 ----
  addColumn(db, 'xy_entry', 'pool', 'TEXT');
  // ---- 在途红包 / 跨班转账标记资金池 ----
  addColumn(db, 'xy_packet', 'pool', "TEXT NOT NULL DEFAULT 'grant'");
  addColumn(db, 'xy_cross_tx', 'pool', "TEXT NOT NULL DEFAULT 'grant'");

  // 历史普通账户余额 → 赠送池；系统账户不分池
  db.exec([
    "UPDATE xy_account SET grant_balance = balance",
    "WHERE user_id NOT LIKE '@%' AND cash_balance = 0 AND grant_balance = 0 AND balance <> 0"
  ].join(' '));

  db.exec([
    "UPDATE xy_account SET frozen_grant = frozen",
    "WHERE user_id NOT LIKE '@%' AND frozen_cash = 0 AND frozen_grant = 0 AND frozen <> 0"
  ].join(' '));

  // 历史分录：普通账户视为赠送，系统账户标记 system
  db.exec([
    "UPDATE xy_entry SET pool = CASE",
    "WHEN user_id LIKE '@%' THEN 'system'",
    "ELSE 'grant' END",
    "WHERE pool IS NULL OR pool = ''"
  ].join(' '));

  // ---- 线下充值流水 ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_recharge (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  yuan_cents INTEGER NOT NULL DEFAULT 0,',
    '  rate REAL NOT NULL DEFAULT 1,',
    "  method TEXT NOT NULL DEFAULT 'cash',",
    '  operator TEXT,',
    '  memo TEXT,',
    '  request_id TEXT,',
    '  tx_id INTEGER,',
    '  created_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_xy_recharge_req ON xy_recharge(request_id) WHERE request_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_recharge_user ON xy_recharge(user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_recharge_time ON xy_recharge(created_at DESC)');

  // ---- 提现申请 ----
  // 状态：pending（待班管线下付款）→ paid（已付现，扣款）/ rejected（驳回，解冻）
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_withdraw (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  status TEXT NOT NULL DEFAULT \'pending\',',
    '  memo TEXT,',
    '  review_memo TEXT,',
    '  operator TEXT,',
    '  reviewer TEXT,',
    '  request_id TEXT,',
    '  tx_id INTEGER,',
    '  created_at INTEGER NOT NULL DEFAULT 0,',
    '  reviewed_at INTEGER',
    ')'
  ].join('\n'));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_xy_withdraw_req ON xy_withdraw(request_id) WHERE request_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_withdraw_user ON xy_withdraw(user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_withdraw_status ON xy_withdraw(status, id DESC)');
}

module.exports = {
  version: 30,
  name: 'xueyuan_pools',
  up: up
};
