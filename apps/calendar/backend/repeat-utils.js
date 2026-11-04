// 日历重复事件纯函数（CommonJS，供 routes.js 与直测脚本复用）
// 重复类型：daily / weekly / monthly / yearly，event_date 为首次发生日期，
// repeat_end（'YYYY-MM-DD'，'' 表示不限）为截止（含当天）。

// 'YYYY-MM-DD' → Date（本地时区）
function parseDate(s) {
  var p = String(s || '').split('-');
  if (p.length !== 3) return null;
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== parseInt(p[0], 10) || d.getMonth() !== parseInt(p[1], 10) - 1 || d.getDate() !== parseInt(p[2], 10)) return null;
  return d;
}

// Date → 'YYYY-MM-DD'
function fmtDate(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// 月末天数（month 1-12）
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 加 n 个月并钳制月末（1月31日 + 1月 = 2月28/29日）
function addMonths(date, n) {
  var targetMonth = new Date(date.getFullYear(), date.getMonth() + n, 1);
  var day = Math.min(date.getDate(), daysInMonth(targetMonth.getFullYear(), targetMonth.getMonth() + 1));
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
}

// 重复事件在 [winStart, winEnd]（'YYYY-MM-DD'）内的发生实例日期数组
// 同时约束：>= event_date（首次日期）、<= repeat_end（若有）
// 每事件实例数上限 62，防病态数据
function occurrenceDates(row, winStart, winEnd) {
  var type = row.repeat_type;
  if (!type || type === 'none') return [];
  var start = parseDate(row.event_date);
  var winS = parseDate(winStart);
  var winE = parseDate(winEnd);
  if (!start || !winS || !winE) return [];
  var end = row.repeat_end ? parseDate(row.repeat_end) : null;
  // 有效起点：max(首次日期, 窗口起点)；有效终点：min(窗口终点, repeat_end)
  var cursorFloor = start > winS ? start : winS;
  var cursorCeil = winE;
  if (end && end < cursorCeil) cursorCeil = end;
  if (cursorFloor > cursorCeil) return [];

  var dates = [];
  var MAX = 62;

  if (type === 'daily') {
    var d = new Date(cursorFloor);
    while (d <= cursorCeil && dates.length < MAX) {
      dates.push(fmtDate(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (type === 'weekly') {
    // 相位对齐：从首次日期起每 7 天
    var diffDays = Math.round((cursorFloor - start) / 86400000);
    var k = Math.ceil(diffDays / 7);
    var w = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k * 7);
    while (w <= cursorCeil && dates.length < MAX) {
      if (w >= cursorFloor) dates.push(fmtDate(w));
      w.setDate(w.getDate() + 7);
    }
  } else if (type === 'monthly') {
    // 从首次日期起逐月推进（保持月内日期钳制）
    var monthsDiff = (cursorFloor.getFullYear() - start.getFullYear()) * 12 + (cursorFloor.getMonth() - start.getMonth());
    var m = new Date(start);
    if (monthsDiff > 0) m = addMonths(start, monthsDiff);
    var guard = 0;
    while (m <= cursorCeil && dates.length < MAX && guard < 1200) {
      if (m >= cursorFloor) dates.push(fmtDate(m));
      m = addMonths(m, 1);
      guard++;
    }
  } else if (type === 'yearly') {
    var yearsDiff = cursorFloor.getFullYear() - start.getFullYear();
    var yDate = new Date(start.getFullYear() + Math.max(0, yearsDiff), start.getMonth(), start.getDate());
    // 2月29日在平年自动顺延为 3月1日（Date 规范化行为），保留该语义
    var guard2 = 0;
    while (yDate <= cursorCeil && dates.length < MAX && guard2 < 200) {
      if (yDate >= cursorFloor) dates.push(fmtDate(yDate));
      yDate = new Date(yDate.getFullYear() + 1, start.getMonth(), start.getDate());
      guard2++;
    }
  } else {
    return [];  // 未知类型不展开
  }
  return dates;
}

// 重复事件的下一次发生日期（>= fromDate；超过 repeat_end 返回 null）
// 供 /for-countdown 等取"下一次"语义
function nextOccurrence(row, fromDate) {
  var dates = occurrenceDates(row, fromDate, '9999-12-31');
  return dates.length ? dates[0] : null;
}

// 把行列表展开为 [winStart, winEnd] 窗口内的实例列表
// 无重复行：仅当 event_date 落在窗口内时透传（窗口外丢弃）
// 重复行：返回 {...row, event_date: 实例日期, id: 'rep_'+原id+'_'+实例日期,
// _repeat: 1, source_event_id: 原id}；原行不重复出现
// 注：调用方应取 event_date <= winEnd 的全部行（重复事件可跨月产生实例）
function expandRepeats(rows, winStart, winEnd) {
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.repeat_type || row.repeat_type === 'none') {
      if (String(row.event_date) >= winStart && String(row.event_date) <= winEnd) {
        result.push(row);
      }
      continue;
    }
    var dates = occurrenceDates(row, winStart, winEnd);
    for (var j = 0; j < dates.length; j++) {
      var inst = Object.assign({}, row, {
        event_date: dates[j],
        id: 'rep_' + row.id + '_' + dates[j],
        _repeat: 1,
        source_event_id: row.id,
        _series_start: row.event_date  // 系列首次日期，编辑重复事件时回填用
      });
      result.push(inst);
    }
  }
  // 按日期+开始时间排序，调用方通常直接展示
  result.sort(function(a, b) {
    var d = String(a.event_date).localeCompare(String(b.event_date));
    if (d !== 0) return d;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
  return result;
}

module.exports = { occurrenceDates, nextOccurrence, expandRepeats, parseDate, fmtDate };
