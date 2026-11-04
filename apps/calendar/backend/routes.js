var express = require('express');
var router = express.Router();
var auth = require('../../../server/src/middleware/auth');
var db = require('../../../server/src/utils/db');
var time = require('../../../server/src/utils/time');
var repeatUtils = require('./repeat-utils');

// 重复事件合法值校验
var REPEAT_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
function normalizeRepeatType(v) {
  return REPEAT_TYPES.indexOf(v) !== -1 ? v : 'none';
}
// repeat_end 仅接受 YYYY-MM-DD 或空串
function normalizeRepeatEnd(v) {
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// 月窗口起止（'YYYY-MM' → ['YYYY-MM-01', 'YYYY-MM-DD'])
function monthWindow(month) {
  var parts = month.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var lastDay = new Date(y, m, 0).getDate();
  return [month + '-01', month + '-' + (lastDay < 10 ? '0' + lastDay : lastDay)];
}

// 转换时间字段为 ISO 字符串
function convertTimes(row) {
  if (!row) return;
  if (row.created_at) row.created_at = time.toISOString(row.created_at);
  if (row.updated_at) row.updated_at = time.toISOString(row.updated_at);
}

function convertTimesArray(rows) {
  for (var i = 0; i < rows.length; i++) convertTimes(rows[i]);
}

// GET /api/calendar/events?month=YYYY-MM — 查询某月事件（重复事件展开为实例）
router.get('/events', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ code: 400, message: '月份参数格式应为 YYYY-MM' });
  }
  try {
    // 取 event_date <= 月末 的全部行（重复事件可从历史月份延伸到本月），
    // 再由 expandRepeats 统一做窗口过滤与实例展开
    var win = monthWindow(month);
    var rows = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND event_date <= ? ORDER BY event_date ASC, start_time ASC').all(userId, win[1]);
    var data = repeatUtils.expandRepeats(rows, win[0], win[1]);
    convertTimesArray(data);
    res.json({ code: 200, message: 'ok', data: data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取日历事件失败' });
  }
});

// GET /api/calendar/events/today — 查询今日事件（重复事件按实例展开）
router.get('/events/today', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var todayRow = db.prepare("SELECT date('now', 'localtime') AS today").get();
    var todayStr = todayRow.today;
    var rows = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND event_date <= ?').all(userId, todayStr);
    var data = repeatUtils.expandRepeats(rows, todayStr, todayStr);
    convertTimesArray(data);
    res.json({ code: 200, message: 'ok', data: data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取今日事件失败' });
  }
});

// POST /api/calendar/events — 创建事件
router.post('/events', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var title = (req.body.title || '').trim();
  var eventDate = (req.body.event_date || '').trim();
  if (!title) return res.status(400).json({ code: 400, message: '标题不能为空' });
  if (!eventDate) return res.status(400).json({ code: 400, message: '日期不能为空' });
  var description = req.body.description || '';
  var startTime = req.body.start_time || '';
  var endTime = req.body.end_time || '';
  var category = req.body.category || 'general';
  var color = req.body.color || '';
  var reminderMinutes = parseInt(req.body.reminder_minutes, 10) || 0;
  // 重复事件字段
  var repeatType = normalizeRepeatType(req.body.repeat_type);
  var repeatEnd = normalizeRepeatEnd(req.body.repeat_end);
  // 联动字段：是否同步显示到倒数日（前端勾选「同步显示到倒数日」）
  var showInCountdown = req.body.show_in_countdown ? 1 : 0;
  try {
    var info = db.prepare('INSERT INTO calendar_events (user_id, title, description, event_date, start_time, end_time, category, color, reminder_minutes, repeat_type, repeat_end, show_in_countdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, title, description, eventDate, startTime, endTime, category, color, reminderMinutes, repeatType, repeatEnd, showInCountdown);
    res.json({ code: 200, message: '创建成功', data: { id: info.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '创建失败' });
  }
});

// PUT /api/calendar/events/:id — 更新事件
router.put('/events/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var eventId = req.params.id;
  try {
    var existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ code: 404, message: '事件不存在' });
    if (String(existing.user_id) !== String(userId)) return res.status(403).json({ code: 403, message: '无权限修改' });
    var title = (req.body.title !== undefined) ? (req.body.title || '').trim() : existing.title;
    var description = (req.body.description !== undefined) ? req.body.description : existing.description;
    var eventDate = (req.body.event_date !== undefined) ? (req.body.event_date || '').trim() : existing.event_date;
    var startTime = (req.body.start_time !== undefined) ? req.body.start_time : existing.start_time;
    var endTime = (req.body.end_time !== undefined) ? req.body.end_time : existing.end_time;
    var category = (req.body.category !== undefined) ? req.body.category : existing.category;
    var color = (req.body.color !== undefined) ? req.body.color : existing.color;
    var reminderMinutes = (req.body.reminder_minutes !== undefined) ? (parseInt(req.body.reminder_minutes, 10) || 0) : existing.reminder_minutes;
    // 重复事件字段
    var repeatType = (req.body.repeat_type !== undefined) ? normalizeRepeatType(req.body.repeat_type) : (existing.repeat_type || 'none');
    var repeatEnd = (req.body.repeat_end !== undefined) ? normalizeRepeatEnd(req.body.repeat_end) : (existing.repeat_end || '');
    // 重复规则变化时重置重复提醒游标
    var repeatLastReminded = (repeatType !== (existing.repeat_type || 'none') || repeatEnd !== (existing.repeat_end || ''))
      ? '' : (existing.repeat_last_reminded || '');
    // 联动字段：是否同步显示到倒数日
    var showInCountdown = (req.body.show_in_countdown !== undefined) ? (req.body.show_in_countdown ? 1 : 0) : existing.show_in_countdown;
    // 修改事件时重置提醒标记
    var reminded = (req.body.reminder_minutes !== undefined && req.body.reminder_minutes != existing.reminder_minutes) ? 0 : existing.reminded;
    db.prepare('UPDATE calendar_events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, category = ?, color = ?, reminder_minutes = ?, reminded = ?, repeat_type = ?, repeat_end = ?, repeat_last_reminded = ?, show_in_countdown = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, description, eventDate, startTime, endTime, category, color, reminderMinutes, reminded, repeatType, repeatEnd, repeatLastReminded, showInCountdown, eventId);
    res.json({ code: 200, message: '更新成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

// DELETE /api/calendar/events/:id — 删除事件
router.delete('/events/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var eventId = req.params.id;
  try {
    var existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ code: 404, message: '事件不存在' });
    if (String(existing.user_id) !== String(userId)) return res.status(403).json({ code: 403, message: '无权限删除' });
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

// GET /api/calendar/events/for-countdown — 返回可显示到倒数日的日历事件（虚拟倒数日）
// 用于倒数日应用消费日历数据，id 加 cal_ 前缀避免与倒数日事件 id 冲突
// 重复事件返回下一次发生日期（对齐倒数日 next_date 语义）；已过 repeat_end 的事件跳过
router.get('/events/for-countdown', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var rows = db.prepare('SELECT id, title, description, event_date, start_time, end_time, category, color, repeat_type, repeat_end FROM calendar_events WHERE user_id = ? AND show_in_countdown = 1 ORDER BY event_date ASC').all(userId);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var targetDate = r.event_date;
      if (r.repeat_type && r.repeat_type !== 'none') {
        var next = repeatUtils.nextOccurrence(r, repeatUtils.fmtDate(new Date()));
        if (!next) continue;  // 重复已结束
        targetDate = next;
      }
      result.push({
        id: 'cal_' + r.id,
        source: 'calendar',
        source_id: r.id,
        title: r.title,
        target_date: targetDate,
        category: r.category || 'other',
        color: r.color,
        icon: '',
        note: r.description || '',
        repeat_type: r.repeat_type || 'none'
      });
    }
    res.json({ code: 200, message: 'ok', data: result });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询联动日历事件失败' });
  }
});

// GET /api/calendar/reminders/due — 查询已到期待提醒事件（reminder-checker 调用）
// 非重复事件沿用 reminded 列；重复事件用 repeat_last_reminded 记录已提醒实例日期
router.get('/reminders/due', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var rows = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND reminded = 0 AND reminder_minutes > 0').all(userId);
    var nowMs = Date.now();
    var winLowMs = nowMs - 86400000;  // 与原 SQL 口径一致：早于 1 天前的不提醒
    var due = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var fireAt = null;   // 命中的实例日期（重复事件用于游标记录）
      var hit = false;
      if (r.repeat_type && r.repeat_type !== 'none') {
        // 重复事件：检查 [今天-1, 今天+2] 窗口内的实例
        var startScan = new Date(nowMs - 86400000);
        var endScan = new Date(nowMs + 2 * 86400000);
        var dates = repeatUtils.occurrenceDates(r, repeatUtils.fmtDate(startScan), repeatUtils.fmtDate(endScan));
        for (var d = 0; d < dates.length; d++) {
          var instMs = eventDatetimeMs(dates[d], r.start_time);
          if (instMs === null) continue;
          if (instMs <= nowMs + r.reminder_minutes * 60000 && instMs >= winLowMs) {
            // 同一实例只提醒一次
            if (r.repeat_last_reminded && String(r.repeat_last_reminded) >= dates[d]) continue;
            hit = true;
            fireAt = dates[d];
            break;
          }
        }
        if (hit) {
          db.prepare('UPDATE calendar_events SET repeat_last_reminded = ? WHERE id = ?').run(fireAt, r.id);
        }
      } else {
        var evMs = eventDatetimeMs(r.event_date, r.start_time);
        if (evMs !== null && evMs <= nowMs + r.reminder_minutes * 60000 && evMs >= winLowMs) {
          hit = true;
          db.prepare('UPDATE calendar_events SET reminded = 1 WHERE id = ?').run(r.id);
        }
      }
      if (hit) {
        if (fireAt) r._instance_date = fireAt;
        due.push(r);
      }
    }
    convertTimesArray(due);
    res.json({ code: 200, message: 'ok', data: due });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询提醒失败' });
  }
});

// 'YYYY-MM-DD' + 'HH:MM:SS'（可空）→ 本地时间戳
function eventDatetimeMs(dateStr, timeStr) {
  var d = repeatUtils.parseDate(dateStr);
  if (!d) return null;
  var hh = 0, mm = 0, ss = 0;
  var tp = String(timeStr || '').split(':');
  if (tp.length >= 2) {
    hh = parseInt(tp[0], 10) || 0;
    mm = parseInt(tp[1], 10) || 0;
    ss = parseInt(tp[2], 10) || 0;
  }
  var ms = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, ss).getTime();
  return isFinite(ms) ? ms : null;
}

// GET /api/calendar/birthdays?month=YYYY-MM — 查询本月公开生日的用户
router.get('/birthdays', auth.requireAuth, function(req, res) {
  var month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ code: 400, message: '月份参数格式应为 YYYY-MM' });
  }
  var monthNum = month.split('-')[1];
  try {
    // privacy 反向语义：birthday = 0 (false) 表示公开
    var rows = db.prepare(
      "SELECT user_id, net_name, real_name, " +
      "json_extract(info_json, '$.birthday') as birthday " +
      "FROM users " +
      "WHERE json_extract(privacy_settings, '$.birthday') = 0 " +
      "AND json_extract(info_json, '$.birthday') IS NOT NULL " +
      "AND json_extract(info_json, '$.birthday') != '' " +
      "AND strftime('%m', json_extract(info_json, '$.birthday')) = ?"
    ).all(monthNum);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询生日失败' });
  }
});

module.exports = router;
