// 倒数日重复事件纯函数（CommonJS，供 routes.js 与直测脚本复用）
// repeat_type: none / weekly / monthly / yearly（target_date 为首次发生日期）
// 语义：返回 >= 今天（本地时区）的下一次发生日期 'YYYY-MM-DD'

function fmtDate(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// 今天 00:00 的 Date
function todayStart() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// 计算重复事件的下次发生日期
// targetDate 'YYYY-MM-DD'；无重复时原样返回
function getNextOccurrence(targetDate, repeatType) {
  if (!repeatType || repeatType === 'none' || !targetDate) return targetDate;
  var parts = targetDate.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return targetDate;
  var first = new Date(year, month - 1, day);
  var today = todayStart();

  if (repeatType === 'weekly') {
    // 自首次日期起每 7 天，取 >= 今天的下一次
    var diffDays = Math.round((today - first) / 86400000);
    var k = Math.max(0, Math.ceil(diffDays / 7));
    var next = new Date(year, month - 1, day + k * 7);
    if (next < today) next = new Date(year, month - 1, day + (k + 1) * 7);
    return fmtDate(next);
  }

  if (repeatType === 'yearly') {
    var nowYear = today.getFullYear();
    for (var y = nowYear; y <= nowYear + 1; y++) {
      // 2月29日在平年顺延为 3月1日（Date 规范化）
      var next = new Date(y, month - 1, day);
      if (next >= first && next >= today) return fmtDate(next);
    }
    return targetDate;
  }

  if (repeatType === 'monthly') {
    // 自首次日期起逐月推进，取 >= 今天的下一次（保持日号钳制）
    var monthsDiff = (today.getFullYear() - first.getFullYear()) * 12 + (today.getMonth() - first.getMonth());
    var step = Math.max(0, monthsDiff);
    for (var i = 0; i < 3; i++) {
      var md = new Date(first.getFullYear(), first.getMonth() + step + i, 1);
      var dayInMonth = Math.min(day, new Date(md.getFullYear(), md.getMonth() + 1, 0).getDate());
      var candidate = new Date(md.getFullYear(), md.getMonth(), dayInMonth);
      if (candidate >= first && candidate >= today) return fmtDate(candidate);
    }
    return targetDate;
  }

  return targetDate;
}

module.exports = { getNextOccurrence };
