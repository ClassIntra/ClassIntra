// 迁移 027：日历重复事件列
//
// 背景：calendar_events 此前不支持重复事件（每周课程/例会需要手动逐条建）。
// 新增三列：
//   repeat_type          'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
//   repeat_end           重复截止日期 'YYYY-MM-DD'（'' 表示不限）
//   repeat_last_reminded 重复事件最近一次已提醒的实例日期（非重复事件沿用 reminded 列）
//
// 幂等性说明：列已存在时跳过。

function up(db) {
  var cols = db.prepare('PRAGMA table_info(calendar_events)').all();
  var names = {};
  for (var i = 0; i < cols.length; i++) names[cols[i].name] = true;

  if (!names['repeat_type']) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN repeat_type TEXT DEFAULT 'none'");
  }
  if (!names['repeat_end']) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN repeat_end TEXT DEFAULT ''");
  }
  if (!names['repeat_last_reminded']) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN repeat_last_reminded TEXT DEFAULT ''");
  }
}

module.exports = { version: 27, name: 'add_calendar_repeat', up: up };
