// 迁移 013：AI 对话用量记账（按账户）
//
// 背景：ai-chat 从上游拿到的 usage（prompt / completion / cache_hit token）
// 一直只在 finishAssistantReply / saveAssistantMessage 里 console.log，既不留存
// 也无法回答「谁用了多少、值多少钱」。本迁移只落"记账"这一层：
//   - 模型侧：单价字段 + 流式用量开关
//   - 流水侧：ai_usage_log 明细表
// 不做额度闸门、不做余额扣减（后续档位在此基础上叠加）。
//
// ---- 金额单位（重要）----
// 上游报价口径是「元 / 百万 token」。直接存元会引入浮点误差，故：
//   单价字段 price_in / price_out / price_cache_hit：单位「微元 / 千 token」(INTEGER)
//   换算：微元每千 = 元每百万 × 1000
//         （1 元/1M token = 1e6 微元 / 1e6 token = 1 微元/token … 每千即 1000 微元）
//   例：¥18/1M → 18000；¥0.1/1M（GLM-Flash / DeepSeek 命中价）→ 100
//   cost_micro：单位「微元」，1 元 = 1,000,000 微元，展示时再除。
// 全整数运算，不做浮点累加。
//
// ---- 缓存命中语义 ----
// DeepSeek 等返回 prompt_tokens = cache_hit + cache_miss，即命中部分已含在
// prompt_tokens 内。计费时命中部分要按 price_cache_hit 单独算，否则重复计费；
// 若管理员未配 price_cache_hit（=0），则命中部分回落按 price_in 计（不欠费）。
// 计算逻辑见 apps/ai-chat/backend/routes.js 的 calcCostMicro。
//
// 幂等性说明：ADD COLUMN 前用 PRAGMA table_info 检查；建表用 IF NOT EXISTS。

function up(db) {
  var cols = db.prepare('PRAGMA table_info(ai_models)').all();
  var names = {};
  for (var i = 0; i < cols.length; i++) names[cols[i].name] = true;

  if (!names.price_in) {
    db.exec('ALTER TABLE ai_models ADD COLUMN price_in INTEGER DEFAULT 0');
  }
  if (!names.price_out) {
    db.exec('ALTER TABLE ai_models ADD COLUMN price_out INTEGER DEFAULT 0');
  }
  if (!names.price_cache_hit) {
    db.exec('ALTER TABLE ai_models ADD COLUMN price_cache_hit INTEGER DEFAULT 0');
  }
  // 1 = 流式请求注入 stream_options:{include_usage:true}（OpenAI 兼容端点默认不带 usage）
  // 个别中转会因未知字段 400，可在管理面板单独关掉
  if (!names.supports_stream_options) {
    db.exec('ALTER TABLE ai_models ADD COLUMN supports_stream_options INTEGER DEFAULT 1');
  }

  // ---- 用量流水 ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS ai_usage_log (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  conversation_id TEXT DEFAULT \'\',',
    '  model_id TEXT DEFAULT \'\',',
    // chat（非流式，含降级换模）| stream（流式）| summary（上下文摘要，记在会话归属人）
    // | search（联网搜索，Tavily credits，token 全 0）| compact（预留：上下文裁剪）
    '  source TEXT NOT NULL,',
    '  prompt_tokens INTEGER DEFAULT 0,',
    '  completion_tokens INTEGER DEFAULT 0,',
    '  cache_hit_tokens INTEGER DEFAULT 0,',
    '  cache_miss_tokens INTEGER DEFAULT 0,',
    '  total_tokens INTEGER DEFAULT 0,',
    // 微元（1e-6 元）
    '  cost_micro INTEGER DEFAULT 0,',
    // 1 = 上游未回 usage，按字符数估算（estimateTokens），非精确账
    '  estimated INTEGER DEFAULT 0,',
    // 联网搜索次数（Tavily credits 之和）
    '  search_credits INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log(user_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_conv ON ai_usage_log(conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON ai_usage_log(model_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log(created_at DESC)');
}

module.exports = { version: 13, name: 'ai_billing_usage_log', up: up };
