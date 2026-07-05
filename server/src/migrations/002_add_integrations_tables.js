// 迁移 v2：集成系统表
// 阶段 4 引入的外部集成 token 管理 + webhook 接收相关表
// 原本在 init-db.js 中创建，阶段 5 统一抽取为迁移文件
//
// 表结构：
// - integrations: 存储 token + secret_hash + scopes + origins + webhook_url

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS integrations (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name TEXT NOT NULL,',
    '  token TEXT NOT NULL UNIQUE,',
    '  secret_hash TEXT NOT NULL,',
    '  scopes_json TEXT DEFAULT \'[]\',',
    '  webhook_url TEXT DEFAULT \'\',',
    '  origins_json TEXT DEFAULT \'[]\',',
    '  active INTEGER DEFAULT 1,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  expires_at TEXT DEFAULT NULL',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_integrations_token ON integrations(token)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_integrations_active ON integrations(active)');
}

module.exports = {
  version: 2,
  name: 'add_integrations_tables',
  up: up
};
