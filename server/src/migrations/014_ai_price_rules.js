// 迁移 014：AI 价格规则（峰谷/折扣/限免）+ 用量流水单价快照
//
// 背景：013 只给了每个模型一组静态单价，但真实计费要复杂得多：
//   - 同一厂商不同模型价格不同（013 已解决：单价在 ai_models 行上）
//   - 峰谷定价（如 DeepSeek 闲时折扣、GLM 的错峰价）—— 同一模型在不同时段不同价
//   - 限时活动/优惠（打折）
//   - 限时免费（限免）
// 因此把「基准价」与「时段/活动覆盖」分离：
//   ai_models.price_*         = 基准价
//   ai_price_rules            = 覆盖规则，命中则替代基准价
//
// ---- 规则命中（全部条件满足才算命中）----
//   1. 模型：model_id = '' 表示全部模型；否则精确匹配
//   2. 日期区间：valid_from / valid_until（YYYY-MM-DD，按规则时区的当地日期，含两端）
//   3. 星期：days_of_week = '1,2,3,4,5'（1=周一 … 7=周日）或 '*' = 不限
//   4. 时段：start_time / end_time（HH:MM，按规则时区）；start >= end 视为跨零点
//      （例：DeepSeek 闲时 16:30-00:30 UTC → start='16:30', end='00:30', timezone_offset=0）
//   命中多条时取 priority 最小者；priority 相同则「模型专用」优先于「全局」。
//
// ---- 三种计价方式 ----
//   kind='price'     绝对单价覆盖：直接用 price_in / price_out / price_cache_hit
//   kind='discount'  折扣：基准价 × discount_percent / 100（100 = 不打折）
//   kind='free'      限免：计价 0（token 仍照记，用于看用量）
//
// ---- 为什么流水要存单价快照 ----
// 规则/基准价随时会改，若报表用"当前价 × 历史 token"重算，改一次价就会篡改全部历史账。
// 故 013 的 ai_usage_log 增补三列单价快照 + rule_id / rule_label：
// 结算当时用了什么单价、命中哪条规则，永久固化在流水里。
//
// 幂等性：ADD COLUMN 前查 PRAGMA；建表用 IF NOT EXISTS。

function up(db) {
  // ---- 价格规则 ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS ai_price_rules (',
    '  id TEXT PRIMARY KEY,',
    '  label TEXT NOT NULL,',
    // '' = 全部模型
    '  model_id TEXT DEFAULT \'\',',
    // price | discount | free
    '  kind TEXT DEFAULT \'price\',',
    '  price_in INTEGER DEFAULT 0,',
    '  price_out INTEGER DEFAULT 0,',
    '  price_cache_hit INTEGER DEFAULT 0,',
    '  discount_percent INTEGER DEFAULT 100,',
    // '1,2,3,4,5'（1=周一..7=周日）| '*' = 不限
    '  days_of_week TEXT DEFAULT \'*\',',
    '  start_time TEXT DEFAULT \'\',',
    '  end_time TEXT DEFAULT \'\',',
    // 分钟偏移，UTC = 0，UTC+8 = 480（峰谷按厂商时区算，DeepSeek 用 UTC）
    '  timezone_offset INTEGER DEFAULT 0,',
    '  valid_from TEXT DEFAULT \'\',',
    '  valid_until TEXT DEFAULT \'\',',
    // 小者优先；同优先级时模型专用 > 全局
    '  priority INTEGER DEFAULT 100,',
    '  enabled INTEGER DEFAULT 1,',
    '  note TEXT DEFAULT \'\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec("CREATE TRIGGER IF NOT EXISTS trg_ai_price_rules_kind BEFORE UPDATE ON ai_price_rules WHEN NEW.kind NOT IN ('price','discount','free') BEGIN SELECT RAISE(ABORT, 'invalid pricing kind'); END;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ai_price_rules_model ON ai_price_rules(enabled, model_id, priority)");

  // ---- 用量流水：单价快照 + 规则标识 ----
  var cols = db.prepare('PRAGMA table_info(ai_usage_log)').all();
  var names = {};
  for (var i = 0; i < cols.length; i++) names[cols[i].name] = true;

  if (!names.rule_id) db.exec("ALTER TABLE ai_usage_log ADD COLUMN rule_id TEXT DEFAULT ''");
  if (!names.rule_label) db.exec("ALTER TABLE ai_usage_log ADD COLUMN rule_label TEXT DEFAULT ''");
  if (!names.price_in_snapshot) db.exec('ALTER TABLE ai_usage_log ADD COLUMN price_in_snapshot INTEGER DEFAULT 0');
  if (!names.price_out_snapshot) db.exec('ALTER TABLE ai_usage_log ADD COLUMN price_out_snapshot INTEGER DEFAULT 0');
  if (!names.price_cache_hit_snapshot) db.exec('ALTER TABLE ai_usage_log ADD COLUMN price_cache_hit_snapshot INTEGER DEFAULT 0');

  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_rule ON ai_usage_log(rule_id, created_at DESC)');
}

module.exports = { version: 14, name: 'ai_price_rules_and_snapshots', up: up };
