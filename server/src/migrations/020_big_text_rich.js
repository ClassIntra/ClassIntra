// 迁移 v20：大字广播增强（轮播 / 走马灯 / 炫彩特效 / 副内容 / 策略）
//
// 背景（2026-10-24）：
//   v18 的大字只能「一段静态文字 + 一个背景色」，实际管控场景需要：
//     · 多行内容逐条轮播（一条大字里放 3~5 条通知），间隔可调；
//     · 超长单行横向滚动（走马灯），否则字号再小也放不下；
//     · 炫彩背景 / 渐变大字，用于紧急程度分级（红色闪动 = 紧急，渐变 = 提醒）；
//     · 副内容（补充说明）与「是否显示发送人」；
//     · 常用配置存成策略，下次一键复用。
//
// 设计：新增列全部带 DEFAULT，旧数据无需回填；展示参数统一走 payload 下发，
//       端上按同一份 spec 渲染，服务端只做钳制与白名单（见 routes/big-text.js）。
//
// 幂等性：ADD COLUMN 前查 PRAGMA，重复执行安全。

var COLUMNS = [
  // 副内容（一行补充说明，可为空）
  ["sub_content", "TEXT NOT NULL DEFAULT ''"],
  // 是否显示发送者署名
  ["show_sender", "INTEGER NOT NULL DEFAULT 1"],
  // 展示模式：static（静态多行）| carousel（逐行轮播）| scroll（单行横向走马灯）
  ["display_mode", "TEXT NOT NULL DEFAULT 'static'"],
  // 轮播间隔（秒）
  ["switch_interval", "INTEGER NOT NULL DEFAULT 5"],
  // 走马灯速度（像素/秒）
  ["scroll_speed", "INTEGER NOT NULL DEFAULT 60"],
  // 视觉特效：none | gradient_text | gradient_bg | rainbow | neon
  ["effect", "TEXT NOT NULL DEFAULT 'none'"],
  // 文字渐变 {from,to,angle}（effect=gradient_text 时生效）
  ["text_gradient", "TEXT NOT NULL DEFAULT ''"],
  // 背景渐变 {from,to,angle}（effect=gradient_bg 时生效）
  ["bg_gradient", "TEXT NOT NULL DEFAULT ''"]
];

function columnExists(db, table, column) {
  var rows = db.prepare('PRAGMA table_info(' + table + ')').all();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].name === column) return true;
  }
  return false;
}

function up(db) {
  var added = [];
  for (var i = 0; i < COLUMNS.length; i++) {
    var name = COLUMNS[i][0];
    if (!columnExists(db, 'big_text_broadcasts', name)) {
      db.exec('ALTER TABLE big_text_broadcasts ADD COLUMN ' + name + ' ' + COLUMNS[i][1]);
      added.push(name);
    }
  }

  // 策略（预设）：把一整套外观参数存下来复用。
  // 按「创建者 + 名称」唯一：同名视为覆盖更新，避免列表里堆一堆同名策略。
  db.exec([
    'CREATE TABLE IF NOT EXISTS big_text_presets (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name TEXT NOT NULL,',
    '  payload TEXT NOT NULL,',
    '  created_by TEXT NOT NULL DEFAULT \'\',',
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL',
    ')'
  ].join('\n'));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_big_text_presets_owner_name ON big_text_presets(created_by, name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_big_text_presets_owner ON big_text_presets(created_by, updated_at DESC)');

  console.log('[migration v20] 大字增强列 + 策略表就绪（新增列：' + (added.join(',') || '无') + '）');
}

module.exports = {
  version: 20,
  name: 'big_text_rich',
  up: up
};
