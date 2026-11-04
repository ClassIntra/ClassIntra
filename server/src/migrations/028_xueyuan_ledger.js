// 迁移 028：学元账本（平台统一虚拟货币）
//
// ---- 为什么是复式记账 ----
// 学元要和现实货币保持距离，但它仍然必须有「守恒」这条底线：
// 任何时刻，全体账户余额之和恒为 0（含系统账户）。这样一次误发、
// 一次漏扣、一次并发覆盖都会立刻被对账脚本抓出来 —— 单式记账做不到。
//
// 三张表：
//   xy_account  账户（余额 + 冻结额，单位：分）
//   xy_tx       交易头（一笔业务一行，ref 是幂等键）
//   xy_entry   分录（一笔交易 N 行，delta 有正有负，SUM=0）
//
// ---- 金额单位 ----
// 全部用「分」（整数）。1 学元 = 100 分。
// 用整数是因为浮点在累加中会漂移（0.1+0.2≠0.3），而钱不允许漂移。
//
// ---- 系统账户 ----
// user_id 以 '@' 开头的是系统账户，不能登录、不能出现在榜单里：
//   @system:mint  铸币账户（余额恒为负，负数绝对值 = 流通中的学元总量）
//   @system:fee   费用归集（交易佣金/印花税等）
// 铸币账户的负余额不是欠债，而是「已发行」的镜像 —— 这是复式记账的
// 标准做法，也让「发出去多少」只需要看一个数。
//
// 幂等性说明：CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE 初始账户。

var SYSTEM_MINT = '@system:mint';
var SYSTEM_FEE = '@system:fee';

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_account (',
    '  user_id TEXT PRIMARY KEY,',
    // 余额（分）。系统账户可为负，普通账户恒 >= 0（服务层强制）
    '  balance INTEGER NOT NULL DEFAULT 0,',
    // 冻结额（分）。挂单/担保时从可用额中锁定，不动 balance
    '  frozen INTEGER NOT NULL DEFAULT 0,',
    "  status TEXT NOT NULL DEFAULT 'active',",
    '  opened_at INTEGER NOT NULL DEFAULT 0,',
    '  updated_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_tx (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    // 幂等键：同一 ref 只会成功一次（如 signin:25180001:2026-11-02）
    '  ref TEXT,',
    '  kind TEXT NOT NULL,',
    // 来源应用（null = 平台自身）
    '  app_name TEXT,',
    '  operator TEXT,',
    '  memo TEXT,',
    // 交易总额（分，正数；方向由分录表达）
    '  amount INTEGER NOT NULL DEFAULT 0,',
    '  meta_json TEXT,',
    '  created_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  // ref 唯一：只对非空 ref 生效（SQLite 允许多个 NULL）
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_xy_tx_ref ON xy_tx(ref) WHERE ref IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_tx_created ON xy_tx(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_tx_app ON xy_tx(app_name, created_at DESC)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_entry (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  tx_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    // 变动额（分）：正=入账，负=出账
    '  delta INTEGER NOT NULL,',
    // 记账后余额快照（便于逐笔回溯，也便于发现历史被篡改）
    '  balance_after INTEGER NOT NULL,',
    '  created_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_entry_user ON xy_entry(user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_entry_tx ON xy_entry(tx_id)');

  // 系统账户必须先于任何业务存在（铸币分录要往里落）
  var now = Date.now();
  var stmt = db.prepare(
    "INSERT OR IGNORE INTO xy_account (user_id, balance, frozen, status, opened_at, updated_at) VALUES (?, 0, 0, 'system', ?, ?)"
  );
  stmt.run(SYSTEM_MINT, now, now);
  stmt.run(SYSTEM_FEE, now, now);
}

module.exports = {
  version: 28,
  name: 'xueyuan_ledger',
  up: up
};
