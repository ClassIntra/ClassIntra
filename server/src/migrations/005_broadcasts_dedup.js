// 广播去重（根治「广播表被无限重复插入」的风暴）
//
// 背景：broadcasts 建表时没有任何唯一约束，导致两个问题：
//   1) init-db.js 的 `INSERT OR IGNORE` 实为普通 INSERT —— 每次服务端启动都插一条欢迎语
//   2) relay-sync.js 的 catchup 回灌靠 (content, created_at) 查询判重，而 created_at 照抄
//      源端值、跨库时序不可靠；插入后又产生新的 rowid，被同步水位线视为"新数据"回推对端，
//      形成 A→B→A 的正反馈死循环（实测每秒约 40 条）
//
// 实测数据（清理前）：ClassNet 欢迎语 491 条，created_at 各不相同（相隔约 2.5 分钟），
// 全部来自对端 8i 的历史脏数据，一次 catchup 批量灌入本机。
//
// 对策：
//   a) (content, created_at) 唯一索引 —— 让 INSERT OR IGNORE 对「同一时刻的同一广播」生效
//   b) 一次性内容归档 —— 同 content 只留最早一条，清掉对端历史脏数据
//   c) 同步侧的时间窗去重（见 relay-sync.js 的 bcRecentCheck）——
//      同一 content 若最近已有记录则拒绝回灌。用时间窗而非全局唯一，
//      是为了保留「管理员隔天再发一次同样内容」的合法能力。
//
// 幂等性说明：建索引前先清理已存在的重复行（保留每组最小 rowid），
// 否则 CREATE UNIQUE INDEX 会因重复键失败。

function up(db) {
  // 1) 内容级归档：同一 content 只保留 rowid 最小的一条（时间最早）。
  //    这一步会清掉对端反复回灌产生的 491 条 ClassNet 欢迎语，只留最早那条。
  //    注意：这是迁移内的一次性操作；运行期同一内容是否允许重复，
  //    由 relay-sync.js 的时间窗判据决定（不在此处施加全局唯一约束）。
  try {
    db.exec([
      'DELETE FROM broadcasts WHERE rowid NOT IN (',
      '  SELECT MIN(rowid) FROM broadcasts GROUP BY content',
      ')'
    ].join('\n'));
  } catch (e) {
    console.warn('[migration 005] 内容级归档失败（可忽略）:', e.message);
  }

  // 2) 建唯一索引，使 INSERT OR IGNORE 对广播真正生效
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_content_created ON broadcasts(content, created_at)');

  // 3) 内容索引（非唯一）：加速同步侧「同内容最近是否存在」的时间窗查询
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcasts_content ON broadcasts(content)');
}

module.exports = { version: 5, name: 'broadcasts_dedup', up: up };
