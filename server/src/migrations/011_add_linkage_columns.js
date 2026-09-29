// 迁移 011：倒数日 ↔ 日历双向联动列
//
// 背景：双向联动依赖两个开关列，但基线表结构从未包含它们——
//   calendar_events.show_in_countdown  日历事件勾选「同步显示到倒数日」
//   countdown_events.show_in_calendar  倒数日勾选「同步显示到日历」
// 缺列导致：两端的 /for-countdown、/for-calendar 查询直接 SQL 报错（500 被前端吞掉），
// 联动恒为空；倒数日 PUT 写 show_in_calendar 也会 500。
//
// 幂等性说明：列已存在时跳过。

function up(db) {
  var calCols = db.prepare('PRAGMA table_info(calendar_events)').all();
  var hasShowInCountdown = calCols.some(function (c) { return c.name === 'show_in_countdown'; });
  if (!hasShowInCountdown) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN show_in_countdown INTEGER DEFAULT 0');
  }

  var cdCols = db.prepare('PRAGMA table_info(countdown_events)').all();
  var hasShowInCalendar = cdCols.some(function (c) { return c.name === 'show_in_calendar'; });
  if (!hasShowInCalendar) {
    db.exec('ALTER TABLE countdown_events ADD COLUMN show_in_calendar INTEGER DEFAULT 0');
  }
}

module.exports = { version: 11, name: 'add_linkage_columns', up: up };
