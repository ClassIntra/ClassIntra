// AI 模型注册表：支持任意 OpenAI 兼容模型接入（v1.3 ai-chat 泛化改造）
//
// 背景：此前 ai-chat 硬编码两个 provider —— 'default'（GPT 转发）与 'deepseek'，
// 由 config（env）驱动，前端双按钮切换。改造目标：
//   1. 任意 OpenAI 兼容 API（GLM / Qwen / Kimi / OneAPI 中转 / 自建等）均可接入
//   2. 管理员可增删改模型、启停（控制用户可见性）、指定全局默认模型
//   3. 旧数据无缝升级：user_settings.ai_settings_json.model 里已存的
//      'default' / 'deepseek' 值继续有效（种子记录沿用同一 id）
//
// 兼容性设计：
//   - 内置两条种子（default / deepseek）的 api_url / api_key / model 存空串，
//     运行时为空则回退到 config（env）——env 仍是这两个内置模型的
//     source of truth，8i 等部署环境只改 .env 无需动库；
//     管理面板编辑内置模型后 DB 值优先。
//   - 表不存在时（旧库未跑迁移）服务端回退 env 双 provider，行为同旧版。

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS ai_models (',
    '  id TEXT PRIMARY KEY,',
    '  label TEXT NOT NULL,',
    '  api_url TEXT DEFAULT \'\',',
    '  api_key TEXT DEFAULT \'\',',
    '  model TEXT DEFAULT \'\',',
    '  color TEXT DEFAULT \'#6366f1\',',
    '  api_style TEXT DEFAULT \'openai\',',
    '  supports_thinking INTEGER DEFAULT 0,',
    '  supports_search INTEGER DEFAULT 0,',
    '  is_free INTEGER DEFAULT 0,',
    '  enabled INTEGER DEFAULT 1,',
    '  is_default INTEGER DEFAULT 0,',
    '  builtin INTEGER DEFAULT 0,',
    '  sort_order INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  // 思考参数风格取值约束（'openai' | 'deepseek'），防手改库引入脏值
  db.exec("CREATE TRIGGER IF NOT EXISTS trg_ai_models_api_style BEFORE UPDATE ON ai_models WHEN NEW.api_style NOT IN ('openai','deepseek') BEGIN SELECT RAISE(ABORT, 'invalid api_style'); END;");

  // 唯一默认：任何时候 is_default=1 的行不超过一行（部分写入型工具不走应用层校验）
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_models_default ON ai_models(is_default) WHERE is_default = 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_models_enabled ON ai_models(enabled, sort_order)');

  // 种子：仅当表为空时插入（幂等），值取 env 与 config/index.js 同源
  var count = db.prepare('SELECT COUNT(*) AS n FROM ai_models').get().n;
  if (count > 0) return;

  var env = process.env;
  var gptModels = (env.AI_AVAILABLE_MODELS || 'gpt-4o-mini-2024-07-18,gpt-4o-mini').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  var gptModel = env.AI_MODEL || 'gpt-3.5-turbo';
  if (gptModels.indexOf(gptModel) < 0) gptModel = gptModels[0] || gptModel;

  var insert = db.prepare([
    'INSERT INTO ai_models',
    '  (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search, is_free, enabled, is_default, builtin, sort_order)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join('\n'));

  // default（GPT）：api_url/api_key/model 留空 = 运行时继承 config.ai（env）
  insert.run('default', 'GPT', '', '', '', '#f59e0b', 'openai', 0, 0, 1, 1, 1, 1, 0);
  // deepseek：思考 + 联网（现有能力），api_url/api_key/model 留空 = 继承 config.deepseek（env）
  insert.run('deepseek', 'DeepSeek', '', '', '', '#10b981', 'deepseek', 1, 1, 0, 1, 0, 1, 10);
}

module.exports = { version: 6, name: 'add_ai_models', up: up };
