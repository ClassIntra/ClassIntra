// 迁移 016：AI 额度闸门（ai_wallet）
//
// 背景：013 只「记账」，人人都能无限用。这一层补上「额度」：
// 管理员给个别用户设一个月度金额上限，超了就拒绝发消息（402）。
//
// ---- 语义（重要，决定会不会误伤人）----
//   quota_micro = 0  → **不限额**（默认值，所有存量用户零影响）
//   quota_micro > 0  → 「最近 N 天」滚动窗口内已用金额 + 本次预估 ≥ 上限 → 拒绝
// 金额单位与 013 一致：微元（1 元 = 1e6 微元）。
//
// ---- 为什么不存 used_micro ----
// 已用金额直接从 ai_usage_log 聚合（SUM(cost_micro)），不另设余额字段：
//   1) 记账已在 4 个埋点落库，余额跟着流水走，永不漂移；
//   2) 免去「扣减失败/回滚/并发」一类事务问题；
//   3) (user_id, created_at) 已有索引，聚合是毫秒级。
// 本表只存管理员设定的上限。
//
// 幂等性说明：IF NOT EXISTS。

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS ai_wallet (',
    '  user_id TEXT PRIMARY KEY,',
    // 0 = 不限额；>0 = 滚动窗口内金额上限（微元）
    '  quota_micro INTEGER NOT NULL DEFAULT 0,',
    // 上限生效的滚动窗口天数（0 = 跟随全局默认 30 天）
    '  window_days INTEGER NOT NULL DEFAULT 0,',
    '  updated_at TEXT',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_wallet_quota ON ai_wallet(quota_micro) WHERE quota_micro > 0');
}

module.exports = { version: 16, name: 'ai_wallet_quota', up: up };
