// 迁移 025：对外写接口幂等表 + 定时任务分布式锁
//
// 背景：
//   1. 对外查询 API 已上线，下一步要开「写」——写必须可重试，否则网络抖一下就重复发公告。
//      用 Idempotency-Key 落表，24 小时内同键直接回放上次响应。
//   2. 定时任务目前是进程内计时：多实例部署时每个实例都会跑一遍。
//      加一个 locked_until 抢占位，同一时刻只有一个实例能执行。
//
// 幂等性说明：
//   - integration_requests 建表 IF NOT EXISTS
//   - app_jobs 新增 locked_until 列：先 PRAGMA 检查再 ALTER（SQLite 不支持 ADD COLUMN IF NOT EXISTS）

function hasColumn(db, table, column) {
  try {
    var cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].name === column) return true;
    }
  } catch (e) {}
  return false;
}

function up(db) {
  // 对外写接口的幂等记录：key 由调用方给（或服务端按内容生成）
  db.exec(
    'CREATE TABLE IF NOT EXISTS integration_requests (' +
    '  idem_key TEXT PRIMARY KEY,' +
    '  integration_id INTEGER,' +
    '  method TEXT,' +
    '  path TEXT,' +
    '  status INTEGER,' +
    '  response_body TEXT,' +
    '  created_at INTEGER' +
    ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_integration_requests_created ON integration_requests (created_at)');

  // 定时任务锁：locked_until > now 表示有实例正在跑
  if (!hasColumn(db, 'app_jobs', 'locked_until')) {
    db.exec('ALTER TABLE app_jobs ADD COLUMN locked_until INTEGER DEFAULT 0');
  }
}

module.exports = { version: 25, name: 'integration_idempotency_and_job_lock', up: up };
