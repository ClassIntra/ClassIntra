// 迁移 v22：大字「禁止关闭时长」可配置
//
// 背景（2026-10-26）：
//   v20 把「多久之后才允许轻触关闭」硬编码在端上（MIN_DWELL_MS = 5000），
//   班管没法按场景调整 —— 紧急通知希望学生点不掉，普通提醒则希望早点能关。
//   这里把它提升为可下发字段 lock_seconds。
//
// 为什么单开 v22 而不是塞进 v21（踩过的坑）：
//   迁移按 version 记录，跑过 v21 的库再启动会直接跳过该文件。测试库已经
//   跑过 v21，把新列塞进去会导致「测试库没列、生产库有列」的不一致。
//
// 设计：DEFAULT 5 —— 与迁移前端上的硬编码一致，老广播行为不变。
//       取值由服务端钳制到 [0, duration]，端上不再自行加码。
//
// 幂等性：ADD COLUMN 前查 PRAGMA，重复执行安全。

var COLUMNS = [
  // 禁止关闭时长（秒）：这段时间内轻触/点击都不关闭，防止强提示被一划就没
  ["lock_seconds", "INTEGER NOT NULL DEFAULT 5"]
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
  console.log('[migration v22] 大字禁止关闭时长列就绪（新增列：' + (added.join(',') || '无') + '）');
}

module.exports = {
  version: 22,
  name: 'big_text_lock_seconds',
  up: up
};
