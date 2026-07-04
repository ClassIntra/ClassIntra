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

// 计算重复事件的下次发生日期（YYYY-MM-DD）
function getNextOccurrence(targetDate, repeatType) {
  if (repeatType === 'none' || !repeatType) return targetDate;
  var parts = targetDate.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  var now = new Date();
  var nowYear = now.getFullYear();
  if (repeatType === 'yearly') {
    // 找到 >= 今年的下一个发生日期
    for (var y = nowYear; y <= nowYear + 1; y++) {
      var next = y + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
      if (next >= targetDate && new Date(next) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        return next;
      }
    }
    return targetDate;
  } else if (repeatType === 'monthly') {
    // 找到下个月的发生日期
    var nextMonth = new Date(now.getFullYear(), now.getMonth(), day);
    if (nextMonth < now) {
      nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, day);
    }
    var nm = nextMonth.getMonth() + 1;
    var nd = nextMonth.getDate();
    return nextMonth.getFullYear() + '-' + (nm < 10 ? '0' + nm : nm) + '-' + (nd < 10 ? '0' + nd : nd);
  }
  return targetDate;
}

// GET /api/countdown/events — 查询当前用户全部倒数日（置顶优先，按日期排序）
router.get('/events', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var rows = db.prepare('SELECT * FROM countdown_events WHERE user_id = ? ORDER BY pinned DESC, target_date ASC').all(userId);
    // 计算重复事件的下次发生日期
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].repeat_type && rows[i].repeat_type !== 'none') {
        rows[i].next_date = getNextOccurrence(rows[i].target_date, rows[i].repeat_type);
      } else {
        rows[i].next_date = rows[i].target_date;
      }
    }
    convertTimesArray(rows);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取倒数日失败' });
  }
});

// GET /api/countdown/events/for-calendar?month=YYYY-MM — 返回本月可显示到日历的倒数日（虚拟事件）
// 用于日历应用消费倒数日数据，id 加 cd_ 前缀避免与日历事件 id 冲突
router.get('/events/for-calendar', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ code: 400, message: '月份参数格式应为 YYYY-MM' });
  }
  try {
    // 查询所有 show_in_calendar=1 的事件，前端再按月筛选（重复事件 next_date 可能跨月）
    var rows = db.prepare('SELECT id, title, target_date, category, color, icon, repeat_type, note FROM countdown_events WHERE user_id = ? AND show_in_calendar = 1 ORDER BY target_date ASC').all(userId);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      // 计算重复事件的下次发生日期
      var effDate = (r.repeat_type && r.repeat_type !== 'none') ? getNextOccurrence(r.target_date, r.repeat_type) : r.target_date;
      if (effDate && effDate.substring(0, 7) === month) {
        result.push({
          id: 'cd_' + r.id,           // 加 cd_ 前缀避免与日历事件 id 冲突
          source: 'countdown',
          source_id: r.id,
          title: r.title,
          event_date: effDate,
          start_time: '',
          end_time: '',
          category: r.category,
          color: r.color,
          note: r.note,
          icon: r.icon
        });
      }
    }
    res.json({ code: 200, message: 'ok', data: result });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询联动倒数日失败' });
  }
});

// POST /api/countdown/events — 创建
router.post('/events', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var title = (req.body.title || '').trim();
  var targetDate = (req.body.target_date || '').trim();
  if (!title) return res.status(400).json({ code: 400, message: '标题不能为空' });
  if (!targetDate) return res.status(400).json({ code: 400, message: '目标日期不能为空' });
  var category = req.body.category || 'anniversary';
  var color = req.body.color || '';
  var icon = req.body.icon || '';
  var pinned = req.body.pinned ? 1 : 0;
  var repeatType = req.body.repeat_type || 'none';
  var reminderMinutes = parseInt(req.body.reminder_minutes, 10) || 0;
  var note = req.body.note || '';
  try {
    // 检查置顶数量上限（最多 3 个）
    if (pinned) {
      var pinnedCount = db.prepare('SELECT COUNT(*) as cnt FROM countdown_events WHERE user_id = ? AND pinned = 1').get(userId);
      if (pinnedCount.cnt >= 3) {
        return res.status(400).json({ code: 400, message: '置顶事件最多 3 个' });
      }
    }
    var info = db.prepare('INSERT INTO countdown_events (user_id, title, target_date, category, color, icon, pinned, repeat_type, reminder_minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, title, targetDate, category, color, icon, pinned, repeatType, reminderMinutes, note);
    res.json({ code: 200, message: '创建成功', data: { id: info.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '创建失败' });
  }
});

// PUT /api/countdown/events/:id — 更新
router.put('/events/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var eventId = req.params.id;
  try {
    var existing = db.prepare('SELECT * FROM countdown_events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ code: 404, message: '事件不存在' });
    if (String(existing.user_id) !== String(userId)) return res.status(403).json({ code: 403, message: '无权限修改' });
    var title = (req.body.title !== undefined) ? (req.body.title || '').trim() : existing.title;
    var targetDate = (req.body.target_date !== undefined) ? (req.body.target_date || '').trim() : existing.target_date;
    var category = (req.body.category !== undefined) ? req.body.category : existing.category;
    var color = (req.body.color !== undefined) ? req.body.color : existing.color;
    var icon = (req.body.icon !== undefined) ? req.body.icon : existing.icon;
    var repeatType = (req.body.repeat_type !== undefined) ? req.body.repeat_type : existing.repeat_type;
    var reminderMinutes = (req.body.reminder_minutes !== undefined) ? (parseInt(req.body.reminder_minutes, 10) || 0) : existing.reminder_minutes;
    var note = (req.body.note !== undefined) ? req.body.note : existing.note;
    // 置顶字段：编辑器保存时可修改（取消勾选即取消置顶）；编辑场景不走上限校验
    var pinned = (req.body.pinned !== undefined) ? (req.body.pinned ? 1 : 0) : existing.pinned;
    // 联动字段：是否同步显示到日历
    var showInCalendar = (req.body.show_in_calendar !== undefined) ? (req.body.show_in_calendar ? 1 : 0) : existing.show_in_calendar;
    // 修改提醒设置时重置提醒标记
    var reminded = (req.body.reminder_minutes !== undefined && req.body.reminder_minutes != existing.reminder_minutes) ? 0 : existing.reminded;
    db.prepare('UPDATE countdown_events SET title = ?, target_date = ?, category = ?, color = ?, icon = ?, pinned = ?, repeat_type = ?, reminder_minutes = ?, reminded = ?, note = ?, show_in_calendar = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, targetDate, category, color, icon, pinned, repeatType, reminderMinutes, reminded, note, showInCalendar, eventId);
    res.json({ code: 200, message: '更新成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

// DELETE /api/countdown/events/:id — 删除
router.delete('/events/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var eventId = req.params.id;
  try {
    var existing = db.prepare('SELECT * FROM countdown_events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ code: 404, message: '事件不存在' });
    if (String(existing.user_id) !== String(userId)) return res.status(403).json({ code: 403, message: '无权限删除' });
    db.prepare('DELETE FROM countdown_events WHERE id = ?').run(eventId);
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

// PUT /api/countdown/events/:id/pin — 切换置顶
router.put('/events/:id/pin', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var eventId = req.params.id;
  try {
    var existing = db.prepare('SELECT * FROM countdown_events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ code: 404, message: '事件不存在' });
    if (String(existing.user_id) !== String(userId)) return res.status(403).json({ code: 403, message: '无权限操作' });
    var newPinned = existing.pinned ? 0 : 1;
    // 置顶时检查上限
    if (newPinned) {
      var pinnedCount = db.prepare('SELECT COUNT(*) as cnt FROM countdown_events WHERE user_id = ? AND pinned = 1').get(userId);
      if (pinnedCount.cnt >= 3) {
        return res.status(400).json({ code: 400, message: '置顶事件最多 3 个' });
      }
    }
    db.prepare('UPDATE countdown_events SET pinned = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newPinned, eventId);
    res.json({ code: 200, message: 'ok', data: { pinned: newPinned } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// GET /api/countdown/reminders/due — 到期提醒查询
router.get('/reminders/due', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    // 查询：未提醒 + 有提醒设置 + 目标日期时间 <= 当前时间+提醒分钟数
    var rows = db.prepare(
      "SELECT * FROM countdown_events WHERE user_id = ? AND reminded = 0 AND reminder_minutes > 0 " +
      "AND datetime(target_date || ' 00:00:00') <= datetime('now', 'localtime', '+' || reminder_minutes || ' minutes') " +
      "AND datetime(target_date || ' 00:00:00') >= datetime('now', 'localtime', '-1 day')"
    ).all(userId);
    // 标记为已提醒；重复事件重置 target_date 到下次并重置 reminded
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].repeat_type && rows[i].repeat_type !== 'none') {
        var nextDate = getNextOccurrence(rows[i].target_date, rows[i].repeat_type);
        if (nextDate !== rows[i].target_date) {
          db.prepare('UPDATE countdown_events SET target_date = ?, reminded = 0, updated_at = datetime(\'now\') WHERE id = ?').run(nextDate, rows[i].id);
          // 更新返回数据中的 target_date 为下次日期（前端展示用原始日期计算）
          rows[i].target_date = nextDate;
        } else {
          db.prepare('UPDATE countdown_events SET reminded = 1 WHERE id = ?').run(rows[i].id);
        }
      } else {
        db.prepare('UPDATE countdown_events SET reminded = 1 WHERE id = ?').run(rows[i].id);
      }
    }
    convertTimesArray(rows);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询提醒失败' });
  }
});

module.exports = router;
