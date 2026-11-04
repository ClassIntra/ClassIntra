// 日历/倒数日重复逻辑直测：node scripts/_app-repeat-test.mjs
var cal = await import(new URL('../apps/calendar/backend/repeat-utils.js', import.meta.url).href);
var cd = await import(new URL('../apps/countdown/backend/repeat-utils.js', import.meta.url).href);

var passed = 0;
var failed = 0;
function assert(name, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error('FAIL ' + name + ': actual=' + a + ' expected=' + e); }
}

// ===== 日历 occurrenceDates =====
// weekly：2026-01-05（周一）起每周，2 月窗口 → 2/2、2/9、2/16、2/23
assert('weekly 2月窗口', cal.occurrenceDates(
  { repeat_type: 'weekly', event_date: '2026-01-05', repeat_end: '' },
  '2026-02-01', '2026-02-28'
), ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']);

// daily：1-30 起每天，2 月窗口 → 整月
var daily = cal.occurrenceDates(
  { repeat_type: 'daily', event_date: '2026-01-30', repeat_end: '' },
  '2026-02-01', '2026-02-28'
);
assert('daily 天数', daily.length, 28);
assert('daily 首日', daily[0], '2026-02-01');
assert('daily 末日', daily[27], '2026-02-28');

// monthly 大月 31 号 → 平年 2 月钳制为 28，3 月回到 31
assert('monthly 31日钳制2月', cal.occurrenceDates(
  { repeat_type: 'monthly', event_date: '2026-01-31', repeat_end: '' },
  '2026-02-01', '2026-02-28'
), ['2026-02-28']);
assert('monthly 31日大月', cal.occurrenceDates(
  { repeat_type: 'monthly', event_date: '2026-01-31', repeat_end: '' },
  '2026-03-01', '2026-03-31'
), ['2026-03-31']);

// yearly 2月29日 → 平年顺延 3月1日（Date 规范化语义）
assert('yearly 2月29顺延', cal.occurrenceDates(
  { repeat_type: 'yearly', event_date: '2024-02-29', repeat_end: '' },
  '2026-02-01', '2026-03-31'
), ['2026-03-01']);

// repeat_end 截止（含当天）
assert('repeat_end 截止', cal.occurrenceDates(
  { repeat_type: 'weekly', event_date: '2026-01-05', repeat_end: '2026-02-09' },
  '2026-02-01', '2026-02-28'
), ['2026-02-02', '2026-02-09']);

// 窗口早于首次日期 → 空
assert('窗口早于首次', cal.occurrenceDates(
  { repeat_type: 'weekly', event_date: '2026-06-01', repeat_end: '' },
  '2026-02-01', '2026-02-28'
), []);

// none / 未知类型 → 空
assert('none 不展开', cal.occurrenceDates(
  { repeat_type: 'none', event_date: '2026-01-05', repeat_end: '' },
  '2026-02-01', '2026-02-28'
), []);
assert('未知类型不展开', cal.occurrenceDates(
  { repeat_type: 'weirdly', event_date: '2026-01-05', repeat_end: '' },
  '2026-02-01', '2026-02-28'
), []);

// ===== 日历 nextOccurrence =====
assert('nextOccurrence weekly', cal.nextOccurrence(
  { repeat_type: 'weekly', event_date: '2026-01-05', repeat_end: '' },
  '2026-02-10'
), '2026-02-16');
assert('nextOccurrence 超过 repeat_end', cal.nextOccurrence(
  { repeat_type: 'weekly', event_date: '2026-01-05', repeat_end: '2026-02-09' },
  '2026-02-10'
), null);

// ===== 日历 expandRepeats =====
var rows = [
  { id: 1, title: '单次', event_date: '2026-02-05', start_time: '10:00', repeat_type: 'none' },
  { id: 2, title: '周会', event_date: '2026-01-05', start_time: '09:00', repeat_type: 'weekly', repeat_end: '' }
];
var expanded = cal.expandRepeats(rows, '2026-02-01', '2026-02-28');
assert('expand 总数（1 单次 + 4 实例）', expanded.length, 5);
assert('expand 排序首项', expanded[0].title, '周会');
assert('expand 排序首项日期', expanded[0].event_date, '2026-02-02');
assert('expand 实例 id', expanded[0].id, 'rep_2_2026-02-02');
assert('expand source_event_id', expanded[0].source_event_id, 2);
assert('expand _repeat 标记', expanded[0]._repeat, 1);
var single = expanded.filter(function(r) { return r.title === '单次'; });
assert('expand 单次透传', single.length, 1);
assert('expand 单次 id 不变', single[0].id, 1);

// ===== 倒数日 getNextOccurrence =====
var today = new Date();
var todayStr = today.getFullYear() + '-' +
  String(today.getMonth() + 1).padStart(2, '0') + '-' +
  String(today.getDate()).padStart(2, '0');

assert('cd none 透传', cd.getNextOccurrence('2020-01-01', 'none'), '2020-01-01');

// weekly：结果 >= 今天、与首次日期相差 7 的倍数、距今天不超过 7 天
var wTarget = '2026-01-05';
var wNext = cd.getNextOccurrence(wTarget, 'weekly');
var wNextDate = new Date(wNext + 'T00:00:00');
var wFirstDate = new Date(2026, 0, 5);
var wDiff = Math.round((wNextDate - wFirstDate) / 86400000);
var wFromToday = Math.round((wNextDate - today) / 86400000);
assert('cd weekly 7 的倍数', wDiff % 7, 0);
assert('cd weekly >= 今天', wFromToday >= 0, true);
assert('cd weekly 距今<7天', wFromToday < 7, true);

// future target：尚未发生的 weekly 事件 → 首次日期本身
assert('cd weekly 未来首次', cd.getNextOccurrence('2027-06-01', 'weekly'), '2027-06-01');

// monthly 15 号：今天是 1 号 → 本月 15 号
var mNext = cd.getNextOccurrence('2026-06-15', 'monthly');
var mExpected = new Date(today.getFullYear(), today.getMonth(), 15);
var mExpectedStr = mExpected.getFullYear() + '-' + String(mExpected.getMonth() + 1).padStart(2, '0') + '-' + '15';
assert('cd monthly 本月15号', mNext, mExpectedStr);

// monthly 31 号 → 本月月末钳制（11月=30）
var m31 = cd.getNextOccurrence('2026-01-31', 'monthly');
var lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
assert('cd monthly 31号钳制', m31,
  today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + lastDay);

// yearly：已过 → 明年同日
var yNext = cd.getNextOccurrence('2020-03-10', 'yearly');
var yExpectedYear = (today.getMonth() + 1 > 3 || (today.getMonth() + 1 === 3 && today.getDate() > 10))
  ? today.getFullYear() + 1 : today.getFullYear();
assert('cd yearly 已过顺延', yNext, yExpectedYear + '-03-10');

// 无效输入兜底
assert('cd 非法日期透传', cd.getNextOccurrence('bad', 'weekly'), 'bad');

console.log('');
console.log('passed=' + passed + ' failed=' + failed);
if (failed > 0) process.exit(1);
