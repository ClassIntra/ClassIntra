// 课程表共享工具函数
// 被 Timetable.vue 和 TimetableTodayWidget.vue 复用，避免重复代码

// 科目颜色映射（iOS 系统配色，亮色/暗色模式均可读）
var SUBJECT_COLORS = {
  '语文': '#FF453A',
  '数学': '#007AFF',
  '英语': '#34C759',
  '物理': '#FF9500',
  '化学': '#AF52DE',
  '生物': '#5AC8FA',
  '历史': '#FFCC00',
  '地理': '#5856D6',
  '政治': '#FF2D55',
  '体育': '#30D158',
  '音乐': '#FF375F',
  '美术': '#BF5AF2',
  '信息技术': '#64D2FF',
  '通用技术': '#64D2FF',
  '自习': '#8E8E93',
  '早读': '#FF9F0A',
  '班会': '#FF453A',
  '周测': '#FF6961',
  '新闻联播': '#0A84FF',
  '课外活动': '#30D158',
  '听力': '#0A84FF',
  '社团': '#BF5AF2',
  '心理': '#FF375F',
  '考试': '#FF453A'
};

// 星期标签（下标 0 占位，1=周一 ... 7=周日）
var DAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 时段显示顺序
var PERIOD_ORDER = ['早读', '上午', '下午', '课外活动', '听力', '新闻联播', '晚自习', '收尾'];

// 根据 'HH:MM:SS' 判断所属时段
function getPeriodKey(timeStr) {
  var parts = timeStr.split(':');
  var minutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (minutes < 8 * 60) return '早读';
  if (minutes < 12 * 60) return '上午';
  if (minutes < 17 * 60 + 20) return '下午';
  if (minutes < 18 * 60) return '课外活动';
  if (minutes < 19 * 60 + 10) return '听力';
  if (minutes < 19 * 60 + 30) return '新闻联播';
  if (minutes < 21 * 60 + 30) return '晚自习';
  return '收尾';
}

// hex 转 rgba 字符串（用于卡片半透明背景）
function hexToRgba(hex, alpha) {
  var r = parseInt(hex.substring(1, 3), 16);
  var g = parseInt(hex.substring(3, 5), 16);
  var b = parseInt(hex.substring(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// '06:50:00' -> '06:50'
function formatTime(t) {
  if (!t) return '';
  return t.substring(0, 5);
}

// 根据开学日期计算当前是第几周
function calcWeekNumber(termStart) {
  if (!termStart) return 1;
  var start = new Date(termStart + 'T00:00:00');
  var now = new Date();
  var diff = now - start;
  if (diff < 0) return 1;
  var days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return Math.floor(days / 7) + 1;
}

// 计算本周各天的日期字符串（下标 1=周一 ... 7=周日）
function getWeekDates() {
  var now = new Date();
  var day = now.getDay(); // 0=周日, 1=周一...
  var monday = new Date(now);
  if (day === 0) {
    monday.setDate(now.getDate() - 6);
  } else {
    monday.setDate(now.getDate() - (day - 1));
  }
  var dates = {};
  for (var i = 1; i <= 7; i++) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + (i - 1));
    dates[i] = (d.getMonth() + 1) + '/' + d.getDate();
  }
  return dates;
}

// 把 Date 格式化为 'YYYY-MM-DD'（本地时区）
function formatDateStr(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// JS getDay() 转为本组件 day 值（JS: 0=周日；本组件: 7=周日）
function jsDayToCompDay(jsDay) {
  return jsDay === 0 ? 7 : jsDay;
}

// 在 schedules 中找到某天适用的课表
// weekType: 'odd' | 'even' | 'all'
function findScheduleForDay(data, compDay, weekType) {
  if (!data || !data.schedules) return null;
  for (var i = 0; i < data.schedules.length; i++) {
    var sch = data.schedules[i];
    if (sch.enable_day === compDay && (sch.weeks === 'all' || sch.weeks === weekType)) {
      return sch;
    }
  }
  return null;
}

// 获取某日课表（已按时间排序）
// 参数：data, compDay(1-7), weekType
function getDayClasses(data, compDay, weekType) {
  var sch = findScheduleForDay(data, compDay, weekType);
  if (!sch || !sch.classes) return [];
  var list = sch.classes.slice();
  list.sort(function(a, b) {
    return (a.start_time || '').localeCompare(b.start_time || '');
  });
  return list;
}

// 查找节假日
function findHoliday(dateStr, holidays) {
  if (!holidays || !holidays.length) return null;
  for (var i = 0; i < holidays.length; i++) {
    if (holidays[i].date === dateStr) return holidays[i];
  }
  return null;
}

// 查找调休
function findAdjustment(dateStr, adjustments) {
  if (!adjustments || !adjustments.length) return null;
  for (var i = 0; i < adjustments.length; i++) {
    if (adjustments[i].date === dateStr) return adjustments[i];
  }
  return null;
}

// 获取某日"实际"上学的 day 值（调休日返回 as_day）
// 返回: { day: 1-7, weekType: 'odd'|'even'|'all', note: string, isAdjusted: bool }
function getEffectiveDay(jsDay, dateStr, adjustments, defaultWeekType) {
  var adj = findAdjustment(dateStr, adjustments);
  if (adj) {
    return {
      day: adj.as_day,
      weekType: adj.weeks || defaultWeekType,
      note: adj.note || '',
      isAdjusted: true
    };
  }
  return {
    day: jsDayToCompDay(jsDay),
    weekType: defaultWeekType,
    note: '',
    isAdjusted: false
  };
}

// 查找下节课
// todayClasses: 已排序的课节数组
// nowMs: 当前时间戳
// 返回: { class, status: 'ongoing'|'upcoming'|'done', nextClass }
function findNextClass(todayClasses, nowMs) {
  if (!todayClasses || !todayClasses.length) {
    return { class: null, status: 'done', nextClass: null };
  }
  var now = new Date(nowMs);
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var ongoing = null;
  var upcoming = null;
  for (var i = 0; i < todayClasses.length; i++) {
    var cls = todayClasses[i];
    var sp = (cls.start_time || '').split(':');
    var ep = (cls.end_time || '').split(':');
    var s = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
    var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
    if (nowMin >= s && nowMin <= e) {
      ongoing = cls;
      break;
    }
    if (nowMin < s) {
      upcoming = cls;
      break;
    }
  }
  if (ongoing) return { class: ongoing, status: 'ongoing', nextClass: null };
  if (upcoming) return { class: upcoming, status: 'upcoming', nextClass: upcoming };
  return { class: null, status: 'done', nextClass: null };
}

// 格式化倒计时
// targetMs: 目标时间戳
// nowMs: 当前时间戳
function formatCountdown(targetMs, nowMs) {
  var diff = targetMs - nowMs;
  if (diff <= 0) return '已开始';
  var minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 1) return '即将开始';
  if (minutes < 60) return '还有 ' + minutes + ' 分钟';
  var hours = Math.floor(minutes / 60);
  var remainMin = minutes % 60;
  return '还有 ' + hours + ' 小时 ' + remainMin + ' 分钟';
}

// 把 'HH:MM:SS' 转为当天时间戳
function timeStrToTodayMs(timeStr) {
  if (!timeStr) return 0;
  var parts = timeStr.split(':');
  var now = new Date();
  now.setHours(parseInt(parts[0], 10) || 0);
  now.setMinutes(parseInt(parts[1], 10) || 0);
  now.setSeconds(parseInt(parts[2], 10) || 0);
  now.setMilliseconds(0);
  return now.getTime();
}

// 获取科目颜色（带兜底）
function getSubjectColor(subjectName) {
  return SUBJECT_COLORS[subjectName] || '#8E8E93';
}

// ===== 调课系统（按日期隔离，基于稳定 key 引用）=====
// 调课数据存于 localStorage，key 为 timetable_overrides_YYYY-MM-DD
// override 结构: { key, action: 'replace'|'delete'|'insert', subject?, start_time?, end_time?, afterKey? }
// key = start_time + '|' + subject，用作稳定标识，避免 idx 在 insert/delete 后漂移

// 构建课节稳定标识：start_time + '|' + subject
function buildClassKey(cls) {
  return (cls.start_time || '') + '|' + (cls.subject || '');
}

// 读取某日调课数据
function loadOverrides(dateStr) {
  if (!dateStr) return [];
  try {
    var raw = localStorage.getItem('timetable_overrides_' + dateStr);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// 保存某日调课数据
function saveOverrides(dateStr, list) {
  if (!dateStr) return;
  try {
    localStorage.setItem('timetable_overrides_' + dateStr, JSON.stringify(list));
  } catch (e) {}
}

// 清除某日调课数据
function clearOverrides(dateStr) {
  if (!dateStr) return;
  try {
    localStorage.removeItem('timetable_overrides_' + dateStr);
  } catch (e) {}
}

// 去重合并：同 key 同 action 的旧 override 被新 override 替换
function dedupeOverride(overrides, newOverride) {
  var result = overrides.filter(function(o) {
    return !(o.key === newOverride.key && o.action === newOverride.action);
  });
  result.push(newOverride);
  return result;
}

// 应用调课到原始课节数组（基于稳定 key，避免索引漂移）
// classes: 原始课节数组（来自 getDayClasses）
// overrides: [{ key, action, subject?, start_time?, end_time?, afterKey? }]
// 返回: 新数组，调课后的课节带 _adjusted: true 标记，_overrideKey 供模板引用
function applyOverrides(classes, overrides) {
  if (!overrides || !overrides.length) {
    return classes.map(function(c) {
      return Object.assign({}, c, { _adjusted: false, _overrideKey: buildClassKey(c) });
    });
  }
  // 1. 复制原数组并附加内部 _key 索引
  var result = classes.map(function(c) {
    return Object.assign({}, c, { _adjusted: false, _key: buildClassKey(c) });
  });

  // 2. 按 action 分组处理
  var replaces = overrides.filter(function(o) { return o.action === 'replace'; });
  var deletes = overrides.filter(function(o) { return o.action === 'delete'; });
  var inserts = overrides.filter(function(o) { return o.action === 'insert'; });

  // replace：按 key 查找原课节并覆盖字段
  replaces.forEach(function(o) {
    for (var i = 0; i < result.length; i++) {
      if (result[i]._key === o.key) {
        var newSubject = o.subject || result[i].subject;
        var newStart = o.start_time || result[i].start_time;
        var newEnd = o.end_time || result[i].end_time;
        result[i] = Object.assign({}, result[i], {
          subject: newSubject,
          start_time: newStart,
          end_time: newEnd,
          _adjusted: true,
          _key: buildClassKey({ start_time: newStart, subject: newSubject })
        });
        break;
      }
    }
  });

  // delete：按 key 查找并移除
  deletes.forEach(function(o) {
    for (var i = 0; i < result.length; i++) {
      if (result[i]._key === o.key) {
        result.splice(i, 1);
        break;
      }
    }
  });

  // insert：基于 afterKey 定位插入位置
  inserts.forEach(function(o) {
    var insertAt = result.length; // 默认追加到末尾
    if (o.afterKey) {
      for (var i = 0; i < result.length; i++) {
        if (result[i]._key === o.afterKey) {
          insertAt = i + 1;
          break;
        }
      }
    }
    var newCls = {
      subject: o.subject || '自习',
      start_time: o.start_time || '00:00:00',
      end_time: o.end_time || '00:00:00',
      _adjusted: true,
      _key: buildClassKey({ start_time: o.start_time, subject: o.subject })
    };
    result.splice(insertAt, 0, newCls);
  });

  // 3. 清理内部 _key 字段，附加 _overrideKey 供模板引用
  return result.map(function(c) {
    var copy = Object.assign({}, c);
    delete copy._key;
    copy._overrideKey = buildClassKey(c);
    return copy;
  });
}

export {
  SUBJECT_COLORS,
  DAY_LABELS,
  PERIOD_ORDER,
  getPeriodKey,
  hexToRgba,
  formatTime,
  calcWeekNumber,
  getWeekDates,
  formatDateStr,
  jsDayToCompDay,
  findScheduleForDay,
  getDayClasses,
  findHoliday,
  findAdjustment,
  getEffectiveDay,
  findNextClass,
  formatCountdown,
  timeStrToTodayMs,
  getSubjectColor,
  buildClassKey,
  loadOverrides,
  saveOverrides,
  clearOverrides,
  dedupeOverride,
  applyOverrides
};
