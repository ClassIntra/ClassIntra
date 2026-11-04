// 迁移 v21：大字走马灯滚动方向
//
// 背景（2026-10-26）：
//   v20 的走马灯只能「从右往左」单向滚动。实际用起来有两个问题：
//     · 竖排/从右起读的排版习惯下，反向更自然；
//     · 内容从左往右进场时，第一眼看到的不是开头，节奏更顺。
//
// 设计：新增列带 DEFAULT 'left'，旧数据无需回填（老广播肯定是 left）。
//       取值白名单在 routes/big-text.js 的 SCROLL_DIRECTIONS 里钳制，
//       非法值一律回退 'left'，端上不会拿到第三种值。
//
// ⚠️ 只放这一列：迁移按版本号跳过，已跑过 v21 的库不会重跑本文件。
//    若事后想往里加列，必须另开 v22（lock_seconds 就是这么被拆出去的）。
//
// 幂等性：ADD COLUMN 前查 PRAGMA，重复执行安全。

var COLUMNS = [
  // 走马灯滚动方向：left（默认，文字向左移）| right（文字向右移）
  ["scroll_direction", "TEXT NOT NULL DEFAULT 'left'"]
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
  console.log('[migration v21] 大字走马灯方向列就绪（新增列：' + (added.join(',') || '无') + '）');
}

module.exports = {
  version: 21,
  name: 'big_text_scroll_direction',
  up: up
};
