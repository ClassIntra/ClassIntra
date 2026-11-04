// 迁移 029：支付密码 / 收款码 / 跨班支付
//
// ---- 为什么支付密码单独一张表 ----
// 登录密码是「进这个班」的凭证，支付密码是「花这笔钱」的凭证。
// 两者的生命周期、锁定策略、找回方式都不一样：
//   · 登录密码连续错误由 auth 处理，锁的是会话
//   · 支付密码连续错误只锁「支付」15 分钟，不影响看余额和领津贴
// 放同一张表会让两套风控互相污染，也容易在用户资料接口里被顺手带出去。
//
// ---- 收款码为什么要落库 ----
// 跨班付款时，付款方班级无法验证「这个学号是不是收款方班级的人」——
// users 表里有跨班镜像用户，光看学号分不出来。
// 所以收款码由收款方班级**签发并落库**：只有在本班登录过的人才能拿到 token，
// 对端入账时只认 token，镜像用户不可能凭空生成。这比信任请求体里的学号安全。
//
// ---- 跨班支付为什么两阶段 ----
// 两个班是两套独立账本，不能分布式事务。做法：
//   付款方先冻结 → 通知收款方入账 → 收款方成功回执 → 付款方结算（解冻+回收）
//   收款方失败/超时 → 付款方解冻退回
// 任何一步失败都不会双花；重复请求靠 ref 幂等。pending 的记录由后台重试。

var db = require('../utils/db');

function up() {
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_pay_pin (
  user_id TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  set_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS xy_pay_code (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_xy_pay_code_user ON xy_pay_code(user_id);

CREATE TABLE IF NOT EXISTS xy_cross_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  to_server TEXT NOT NULL,
  to_base TEXT NOT NULL,
  to_token TEXT,
  amount_cent INTEGER NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  peer_tx TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_xy_cross_tx_status ON xy_cross_tx(status, created_at);
CREATE INDEX IF NOT EXISTS idx_xy_cross_tx_user ON xy_cross_tx(from_user, id DESC);
`);
}

module.exports = {
  version: 29,
  name: 'wallet_pay',
  up: up
};
