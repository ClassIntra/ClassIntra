var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var db = require('../utils/db');
var time = require('../utils/time');

// 转换时间字段为 ISO 字符串
function convertTimes(row) {
  if (!row) return;
  if (row.created_at) row.created_at = time.toISOString(row.created_at);
  if (row.updated_at) row.updated_at = time.toISOString(row.updated_at);
}

function convertTimesArray(rows) {
  for (var i = 0; i < rows.length; i++) convertTimes(rows[i]);
}

// GET /api/calendar/events?month=YYYY-MM — 查询某月事件
router.get('/events', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ code: 400, message: '月份参数格式应为 YYYY-MM' });
  }
  try {
    var rows = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND event_date LIKE ? ORDER BY event_date ASC, start_time ASC').all(userId, month + '%');
    convertTimesArray(rows);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取日历事件失败' });
  }
});

// GET /api/calendar/events/today — 查询今日事件
router.get('/events/today', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    // 使用 localtime 获取今天日期
    var today = db.prepare("date('now', 'localtime')").get();
    var todayStr = Object.values(today)[0];
    var rows = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND event_date = ? ORDER BY start_time ASC').all(userId, todayStr);
    convertTimesArray(rows);
    res.json({ code: 200, message: 'ok', data: rows });
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
  try {
    var info = db.prepare('INSERT INTO calendar_events (user_id, title, description, event_date, start_time, end_time, category, color, reminder_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, title, description, eventDate, startTime, endTime, category, color, reminderMinutes);
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
    // 修改事件时重置提醒标记
    var reminded = (req.body.reminder_minutes !== undefined && req.body.reminder_minutes != existing.reminder_minutes) ? 0 : existing.reminded;
    db.prepare('UPDATE calendar_events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, category = ?, color = ?, reminder_minutes = ?, reminded = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, description, eventDate, startTime, endTime, category, color, reminderMinutes, reminded, eventId);
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

// GET /api/calendar/reminders/due — 查询已到期待提醒事件（reminder-checker 调用）
router.get('/reminders/due', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    // 查询：未提醒 + 有提醒设置 + 事件时间 <= 当前时间+提醒分钟数
    var rows = db.prepare(
      "SELECT * FROM calendar_events WHERE user_id = ? AND reminded = 0 AND reminder_minutes > 0 " +
      "AND datetime(event_date || ' ' || COALESCE(NULLIF(start_time, ''), '00:00')) <= datetime('now', 'localtime', '+' || reminder_minutes || ' minutes') " +
      "AND datetime(event_date || ' ' || COALESCE(NULLIF(start_time, ''), '00:00')) >= datetime('now', 'localtime', '-1 day')"
    ).all(userId);
    // 标记为已提醒
    for (var i = 0; i < rows.length; i++) {
      db.prepare('UPDATE calendar_events SET reminded = 1 WHERE id = ?').run(rows[i].id);
    }
    convertTimesArray(rows);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询提醒失败' });
  }
});

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
