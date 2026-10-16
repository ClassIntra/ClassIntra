// 迁移 015：AI 视觉能力（看图）
//
// 背景：用户想从云盘选一张图发给 AI 让它「看图说话」。落地有两个难题：
//   1) 不是每个模型都支持视觉 —— 需要逐模型标记，否则发出去就是 400；
//   2) 即便当前模型不支持，也不该直接拒绝 —— 管理员可以指定一个「统一转述模型」
//      （视觉模型），由它先把图片转述成文字，再把文字喂给真正对话的模型。
//
// 因此本迁移只做两件事：
//   - ai_models.supports_vision：该模型能否直接接收图片内容块
//   - ai_models.vision_max_images：单次最多几张图（0 = 用全局默认 4）
// 「统一转述模型」是全局配置，存 app_config（app_name='ai-chat',
// config_key='vision_relay_model'），无需新表。
//
// 幂等性说明：ADD COLUMN 前用 PRAGMA table_info 检查。

function up(db) {
  var cols = db.prepare('PRAGMA table_info(ai_models)').all();
  var names = {};
  for (var i = 0; i < cols.length; i++) names[cols[i].name] = true;

  // 1 = 支持图片内容块（OpenAI 风格 image_url / DeepSeek 风格同构）
  if (!names.supports_vision) {
    db.exec('ALTER TABLE ai_models ADD COLUMN supports_vision INTEGER DEFAULT 0');
  }
  // 0 = 跟随全局默认（MAX_VISION_IMAGES = 4）
  if (!names.vision_max_images) {
    db.exec('ALTER TABLE ai_models ADD COLUMN vision_max_images INTEGER DEFAULT 0');
  }
}

module.exports = { version: 15, name: 'ai_vision_capability', up: up };
