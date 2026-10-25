// 迁移 v18：设备指令信箱（Device Command Outbox）+ 大字广播
//
// 背景（2026-10-23）：
//   封禁/解禁此前只做「内存实时推送」——sendToClient() 在目标用户没有活动 WS 连接、
//   也没有注册 HTTP 长轮询队列时，会**静默丢弃**并返回 false，调用方还不检查返回值。
//   于是设备若恰好在推送瞬间处于 WS 重连窗口 / 平板息屏 / X5 内核 poll 模式但未注册
//   poller，这条封禁指令就永久丢失，只能等下一次偶然的 HTTP 请求才生效 ——
//   这就是「有些设备收到不及时」的根因。
//
// 方案：把「一发子弹」改成「一封挂号信」。
//   - device_commands 是所有必须送达的控制指令的持久化信箱（at-least-once）。
//   - 指令先落库，再尝试实时推送；客户端上线/重连/轮询时带 last_cmd_id 游标补拉
//     漏掉的指令，执行完回 ACK 标记 delivered。
//   - 指令带自增 id，端上据此幂等去重，重复投递无害。
//   - 过期指令（expires_at 已过）不再补投，避免设备睡了一晚上醒来收到一堆过期大字。
//
// 幂等性：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS。

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS device_commands (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  cmd_uid TEXT NOT NULL,',
    '  target_user_id TEXT NOT NULL,',
    '  cmd_type TEXT NOT NULL,',
    '  payload TEXT NOT NULL DEFAULT \'{}\',',
    '  created_at TEXT NOT NULL,',
    '  expires_at TEXT,',
    '  delivered_at TEXT,',
    '  created_by TEXT DEFAULT \'\',',
    '  server_id TEXT DEFAULT \'\'',
    ')'
  ].join('\n'));

  // 唯一约束必须是 (cmd_uid, target_user_id) 复合的：
  // 同一条指令（同一个 uid）广播给 N 个目标就是 N 行，单列 UNIQUE(cmd_uid) 会让
  // 第 2 行起被 INSERT OR IGNORE 静默吃掉，导致「只发了第一个人」。
  // 跨服务器 relay 回来的同源指令靠「同 uid + 同 target」去重。
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_device_commands_uid ON device_commands(cmd_uid, target_user_id)');
  // 补拉主查询：某用户、某游标之后的未投递指令
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_commands_target ON device_commands(target_user_id, id)');
  // 清理任务：按过期时间扫描
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_commands_expiry ON device_commands(expires_at)');
  // ACK 去重的辅助查询
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_commands_pending ON device_commands(target_user_id, delivered_at)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS big_text_broadcasts (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  content TEXT NOT NULL,',
    '  duration INTEGER NOT NULL DEFAULT 10,',
    '  bg_color TEXT NOT NULL DEFAULT \'#101828\',',
    '  font_color TEXT NOT NULL DEFAULT \'#FFFFFF\',',
    '  font_family TEXT NOT NULL DEFAULT \'\',',
    '  font_size INTEGER NOT NULL DEFAULT 120,',
    '  font_weight TEXT NOT NULL DEFAULT \'700\',',
    '  text_align TEXT NOT NULL DEFAULT \'center\',',
    '  target_type TEXT NOT NULL DEFAULT \'class\',',
    '  target_class TEXT NOT NULL DEFAULT \'\',',
    '  target_ids TEXT NOT NULL DEFAULT \'[]\',',
    '  created_by TEXT NOT NULL DEFAULT \'\',',
    '  created_by_name TEXT NOT NULL DEFAULT \'\',',
    '  created_at TEXT NOT NULL,',
    '  recalled_at TEXT',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_big_text_created ON big_text_broadcasts(created_at DESC)');

  console.log('[migration v18] 已创建 device_commands / big_text_broadcasts 表');
}

module.exports = {
  version: 18,
  name: 'device_commands',
  up: up
};
