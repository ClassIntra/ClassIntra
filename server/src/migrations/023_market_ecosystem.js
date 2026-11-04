// 迁移 023：市场生态基础表（自定义市场源 / 安装指标 / 应用错误 / 使用记录）
//
// 背景（2026-10 生态审计）：
//   1. 市场源此前硬编码 gitee/github/local 三个，第三方无法自建源分发，
//      所有上架都被卡在官方仓。本表保存管理员在管理端添加的自定义源。
//   2. 安装/更新次数、最近安装时间原先只存在于日志里，开发者和班管都看不到。
//   3. 第三方应用的运行期异常没有落点，出问题只能靠猜。
//
// 读取方式：
//   - market_sources    → server/src/core/market-service.js 与内置源合并
//   - market_app_metrics → 安装收尾 recordMetric()
//   - market_app_errors  → POST /api/market/app-error（限流）
//   - market_app_usage   → 应用打开心跳（同表去重按 app+user）
//
// 幂等性说明：全部 IF NOT EXISTS。

function up(db) {
  // 管理员添加的自定义市场源（内置三源不落库，避免被误删/覆盖）
  db.exec(
    'CREATE TABLE IF NOT EXISTS market_sources (' +
    '  id TEXT PRIMARY KEY,' +
    '  label TEXT NOT NULL,' +
    '  base TEXT NOT NULL,' +
    '  type TEXT NOT NULL DEFAULT \'http\',' +
    '  created_at INTEGER,' +
    '  created_by TEXT' +
    ')'
  );

  // 每个班级服务器本地的安装指标（自托管模型下没有全局安装量）
  db.exec(
    'CREATE TABLE IF NOT EXISTS market_app_metrics (' +
    '  app_name TEXT PRIMARY KEY,' +
    '  install_count INTEGER NOT NULL DEFAULT 0,' +
    '  update_count INTEGER NOT NULL DEFAULT 0,' +
    '  first_install_at INTEGER,' +
    '  last_install_at INTEGER' +
    ')'
  );

  // 第三方应用运行期错误（前端上报；按应用归因）
  db.exec(
    'CREATE TABLE IF NOT EXISTS market_app_errors (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  app_name TEXT NOT NULL,' +
    '  message TEXT,' +
    '  stack TEXT,' +
    '  url TEXT,' +
    '  user_id TEXT,' +
    '  created_at INTEGER' +
    ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_market_app_errors_app ON market_app_errors (app_name, created_at)');

  // 应用使用记录（谁在什么时候用过哪个应用；用于「最近使用」与活跃度）
  db.exec(
    'CREATE TABLE IF NOT EXISTS market_app_usage (' +
    '  app_name TEXT NOT NULL,' +
    '  user_id TEXT NOT NULL,' +
    '  last_seen_at INTEGER,' +
    '  open_count INTEGER NOT NULL DEFAULT 0,' +
    '  PRIMARY KEY (app_name, user_id)' +
    ')'
  );
}

module.exports = { version: 23, name: 'market_ecosystem', up: up };
