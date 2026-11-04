// 迁移 024：应用级存储 + 定时任务记账
//
// 背景（2026-10 生态审计的三项基座缺口）：
//   1. 第三方应用没有服务端 KV/对象存储，只能直连共享 SQLite 或挤在公共云盘；
//   2. 应用没有定时任务托管，只能自己 setInterval（重启即丢、错过不补）；
//   3. 任务执行情况无处可查，出问题只能翻 stdout。
//
// 设计要点：
//   - app_data / app_blobs 都以 (app_name, owner) 为隔离维度；owner=user_id 即「个人数据」，
//     owner='*' 保留给应用级共享数据（当前只允许应用后端经服务层写入，HTTP 只读）。
//   - 键与值都限长（见 core/app-data.js），防止单条写爆库。
//   - app_jobs 只记「最近一次」执行结果，用于健康面板与错过后补跑判断。
//
// 幂等性说明：全部 IF NOT EXISTS。

function up(db) {
  // 应用级 KV：owner 为用户 id 或 '*'
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_data (' +
    '  app_name TEXT NOT NULL,' +
    '  owner TEXT NOT NULL,' +
    '  data_key TEXT NOT NULL,' +
    '  value TEXT,' +
    '  updated_at INTEGER,' +
    '  PRIMARY KEY (app_name, owner, data_key)' +
    ')'
  );

  // 应用级对象存储：文件落盘，元数据在此
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_blobs (' +
    '  id TEXT PRIMARY KEY,' +
    '  app_name TEXT NOT NULL,' +
    '  owner TEXT NOT NULL,' +
    '  name TEXT NOT NULL,' +
    '  mime TEXT,' +
    '  size INTEGER,' +
    '  rel_path TEXT,' +
    '  created_at INTEGER' +
    ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_app_blobs_owner ON app_blobs (app_name, owner)');

  // 定时任务执行记账（每个应用每个任务一行）
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_jobs (' +
    '  app_name TEXT NOT NULL,' +
    '  job_name TEXT NOT NULL,' +
    '  last_run_at INTEGER,' +
    '  last_status TEXT,' +
    '  last_error TEXT,' +
    '  run_count INTEGER NOT NULL DEFAULT 0,' +
    '  PRIMARY KEY (app_name, job_name)' +
    ')'
  );
}

module.exports = { version: 24, name: 'app_data_and_jobs', up: up };
