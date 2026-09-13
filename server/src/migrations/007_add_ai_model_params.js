// AI 模型参数扩展 + 使用策略（migration 007）
//
// 背景：ai_models 006 落地后，模型级参数仍依赖全局硬编码
// （MAX_CONTEXT_TOKENS=10000）与固定默认值。不同模型上下文窗口差异巨大
// （GLM-4-Flash 128K vs 部分中转 8K），需要按模型配置：
//   - max_context_tokens：对话历史 + 系统提示的预算上限（0 = 全局默认）
//   - max_output_tokens：单次回复输出上限（0 = 按 api_style 默认）
//   - reasoning_effort：思考模式默认强度（'' = 不注入 / low / medium / high）
//
// 使用策略（ai_policies）：预设「模型授权方案」，管理员定义若干策略
// （如「仅免费」「考试模式」），在管理页多选用户一次性应用。
//   - model_ids 为 JSON 数组；空数组 = 不限制（可用全部启用模型）
//   - is_default：未指定策略的用户生效的策略（全局唯一一行 =1）

function up(db) {
  var cols = db.prepare('PRAGMA table_info(ai_models)').all();
  var names = {};
  for (var i = 0; i < cols.length; i++) names[cols[i].name] = true;

  if (!names.max_context_tokens) {
    db.exec("ALTER TABLE ai_models ADD COLUMN max_context_tokens INTEGER DEFAULT 0");
  }
  if (!names.max_output_tokens) {
    db.exec("ALTER TABLE ai_models ADD COLUMN max_output_tokens INTEGER DEFAULT 0");
  }
  if (!names.reasoning_effort) {
    db.exec("ALTER TABLE ai_models ADD COLUMN reasoning_effort TEXT DEFAULT ''");
  }

  // 思考强度取值约束
  db.exec("CREATE TRIGGER IF NOT EXISTS trg_ai_models_effort BEFORE UPDATE ON ai_models WHEN NEW.reasoning_effort NOT IN ('','low','medium','high') BEGIN SELECT RAISE(ABORT, 'invalid reasoning_effort'); END;");

  // ---- 使用策略 ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS ai_policies (',
    '  id TEXT PRIMARY KEY,',
    '  label TEXT NOT NULL,',
    '  model_ids TEXT DEFAULT \'[]\',',
    '  is_default INTEGER DEFAULT 0,',
    '  sort_order INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  var count = db.prepare('SELECT COUNT(*) AS n FROM ai_policies').get().n;
  if (count === 0) {
    // 内置默认策略：不限（空数组 = 全部启用模型）
    db.prepare("INSERT INTO ai_policies (id, label, model_ids, is_default, sort_order) VALUES ('all', '全部模型', '[]', 1, 0)").run();
  }
}

module.exports = { version: 7, name: 'add_ai_model_params_policies', up: up };
