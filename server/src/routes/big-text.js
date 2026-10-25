/**
 * big-text.js — 大字广播（全屏强提示）
 *
 * 班管 / 持有 manage_big_text 权限的班干，可推送一条全屏大字到指定设备。
 *
 * 可变项（全部服务端钳制 + 白名单，防止前端传异常值把设备界面搞崩）：
 *   内容 / 副内容 / 显示时长
 *   展示模式 static | carousel（多行轮播）| scroll（单行走马灯）
 *   轮播间隔 / 走马灯速度
 *   背景色 / 背景渐变 / 字体颜色 / 文字渐变 / 字体 / 字号 / 字重 / 对齐
 *   特效 none | gradient_text | gradient_bg | rainbow | neon
 *   是否显示发送者
 *
 * 投递复用「设备指令信箱」（services/device-commands.js）：
 * 在线设备秒级弹出，离线设备上线后自动补弹 —— 与封禁共用同一条必达通道。
 *
 * ⚠️ 与既有「广播管理 /broadcasts」的区别：
 *    broadcasts 是投到超能岛的滚动快讯（弱提示，用户可忽略）；
 *    big-text 是全屏强制覆盖（强提示，盖住当前界面直到时长结束）。
 *
 * 策略（presets）：把一整套外观参数存成命名方案，下次一键复用。
 *    按「创建者 + 名称」唯一，同名覆盖。
 */

var express = require('express');
var router = express.Router();
var db = require('../utils/db');
var auth = require('../middleware/auth');
var time = require('../utils/time');
var constants = require('../utils/constants');
var deviceCommands = require('../services/device-commands');

var LIMITS = {
  contentMax: 400,      // 轮播场景一段大字可能含多条通知，放宽到 400
  subContentMax: 120,
  durationMin: 3,
  durationMax: 600,
  fontSizeMin: 24,
  fontSizeMax: 400,
  switchIntervalMin: 2,
  switchIntervalMax: 60,
  scrollSpeedMin: 20,
  scrollSpeedMax: 200,
  ttlGraceMs: 5 * 60 * 1000,
  ttlCapMs: 60 * 60 * 1000
};

// 允许的字体（安全白名单：防止注入任意 font-family 串）
var FONT_FAMILIES = {
  '': '',
  'system': "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  'sans': "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  'serif': "'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif",
  'kai': "'Kaiti SC', 'KaiTi', 'STKaiti', serif",
  'hei': "'Heiti SC', 'SimHei', 'Microsoft YaHei', sans-serif",
  'mono': "'Courier New', Consolas, monospace",
  'rounded': "'PingFang SC', 'Yuanti SC', 'Microsoft YaHei', sans-serif"
};

var FONT_WEIGHTS = ['400', '500', '600', '700', '900'];
var TEXT_ALIGNS = ['center', 'left', 'right'];
var DISPLAY_MODES = ['static', 'carousel', 'scroll'];
var EFFECTS = ['none', 'gradient_text', 'gradient_bg', 'rainbow', 'neon'];

function clampInt(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(v, fallback) {
  var s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return fallback;
}

// 渐变描述：{from,to,angle}；非法输入整体回退 null（端上退回纯色）
function normalizeGradient(v, fallbackFrom, fallbackTo) {
  if (!v) return null;
  var from = normalizeHexColor(v.from, fallbackFrom);
  var to = normalizeHexColor(v.to, fallbackTo);
  var angle = clampInt(v.angle, 0, 360, 135);
  return { from: from, to: to, angle: angle };
}

function logAction(adminId, action, target, detail) {
  try {
    var stmt = db.prepare("INSERT INTO admin_logs (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))");
    stmt.run(adminId, action, target || '', detail || '');
  } catch (e) {
    console.error('[BigText] Failed to log action:', e.message);
  }
}

// 解析操作者可管辖的班号：班管取常量表，班干取 user_id 的 YYCCNN 中段
function resolveOperatorClass(req) {
  var operatorId = req.user ? req.user.user_id : '';
  var adminClass = constants.getAdminClass(operatorId);
  if (adminClass) return String(adminClass);
  if (operatorId && operatorId.length >= 4) return operatorId.substring(2, 4);
  return '';
}

// 展开目标人群为学号数组（已排除班管，班管不可被管控）
function resolveTargets(req, targetType, targetIds, operatorClass) {
  var cohortPrefix = process.env.COHORT || '25';

  if (targetType === 'class') {
    if (!operatorClass) return { error: '无法确定操作班级范围' };
    var rows = db.prepare(
      "SELECT user_id FROM users WHERE user_id LIKE ? AND (status IS NULL OR status <> 'deleted')"
    ).all(cohortPrefix + operatorClass + '%');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var uid = String(rows[i].user_id);
      if (!constants.isClassAdmin(uid)) out.push(uid);
    }
    return { targets: out };
  }

  var ids = Array.isArray(targetIds) ? targetIds : [];
  var valid = [];
  for (var j = 0; j < ids.length; j++) {
    var id = String(ids[j] == null ? '' : ids[j]).trim();
    if (!id) continue;
    if (constants.isClassAdmin(id)) continue;
    if (operatorClass && id.length >= 4 && id.substring(2, 4) !== operatorClass) continue;
    if (valid.indexOf(id) === -1) valid.push(id);
  }
  return { targets: valid };
}

/**
 * 把请求体规范成一份「样式 spec」。
 * 发送与保存策略共用这一份逻辑 —— 否则策略里能存进非法值，下发时再兜底就晚了。
 */
function normalizeStyle(body) {
  body = body || {};
  var bgColor = normalizeHexColor(body.bg_color, '#101828');
  var fontColor = normalizeHexColor(body.font_color, '#ffffff');
  var effect = EFFECTS.indexOf(String(body.effect)) !== -1 ? String(body.effect) : 'none';
  var displayMode = DISPLAY_MODES.indexOf(String(body.display_mode)) !== -1 ? String(body.display_mode) : 'static';
  var fontFamily = FONT_FAMILIES.hasOwnProperty(String(body.font_family || '')) ? String(body.font_family || '') : '';

  return {
    duration: clampInt(body.duration, LIMITS.durationMin, LIMITS.durationMax, 10),
    display_mode: displayMode,
    switch_interval: clampInt(body.switch_interval, LIMITS.switchIntervalMin, LIMITS.switchIntervalMax, 5),
    scroll_speed: clampInt(body.scroll_speed, LIMITS.scrollSpeedMin, LIMITS.scrollSpeedMax, 60),
    effect: effect,
    bg_color: bgColor,
    bg_gradient: normalizeGradient(body.bg_gradient, bgColor, '#1D2939'),
    font_color: fontColor,
    text_gradient: normalizeGradient(body.text_gradient, fontColor, '#FFFFFF'),
    font_family: fontFamily,
    font_family_css: FONT_FAMILIES[fontFamily] || '',
    font_size: clampInt(body.font_size, LIMITS.fontSizeMin, LIMITS.fontSizeMax, 120),
    font_weight: FONT_WEIGHTS.indexOf(String(body.font_weight)) !== -1 ? String(body.font_weight) : '700',
    text_align: TEXT_ALIGNS.indexOf(String(body.text_align)) !== -1 ? String(body.text_align) : 'center',
    sub_content: String(body.sub_content == null ? '' : body.sub_content).trim().substring(0, LIMITS.subContentMax),
    show_sender: body.show_sender === undefined ? true : !!body.show_sender
  };
}

// ===== POST /api/admin/big-text 发送大字 =====
router.post('/', auth.requirePermission('manage_big_text'), function(req, res) {
  var body = req.body || {};

  var content = String(body.content == null ? '' : body.content).trim();
  if (!content) return res.status(400).json({ code: 400, message: '大字内容不能为空' });
  if (content.length > LIMITS.contentMax) content = content.substring(0, LIMITS.contentMax);

  var style = normalizeStyle(body);
  var targetType = (body.target_type === 'users') ? 'users' : 'class';
  var operatorClass = resolveOperatorClass(req);
  var resolved = resolveTargets(req, targetType, body.target_ids, operatorClass);
  if (resolved.error) return res.status(403).json({ code: 403, message: resolved.error });
  var targets = resolved.targets || [];
  if (targets.length === 0) return res.status(400).json({ code: 400, message: '没有可送达的目标设备' });

  var operatorId = req.user ? req.user.user_id : '';
  var nameRow = db.prepare('SELECT net_name FROM users WHERE user_id = ?').get(operatorId);
  var operatorName = nameRow ? nameRow.net_name : operatorId;
  var createdAt = time.nowISO();

  var insert = db.prepare(
    'INSERT INTO big_text_broadcasts ' +
    '(content, sub_content, show_sender, display_mode, switch_interval, scroll_speed, effect, ' +
    ' text_gradient, bg_gradient, duration, bg_color, font_color, font_family, font_size, font_weight, text_align, ' +
    ' target_type, target_class, target_ids, created_by, created_by_name, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  var result = insert.run(
    content,
    style.sub_content,
    style.show_sender ? 1 : 0,
    style.display_mode,
    style.switch_interval,
    style.scroll_speed,
    style.effect,
    style.text_gradient ? JSON.stringify(style.text_gradient) : '',
    style.bg_gradient ? JSON.stringify(style.bg_gradient) : '',
    style.duration,
    style.bg_color,
    style.font_color,
    style.font_family,
    style.font_size,
    style.font_weight,
    style.text_align,
    targetType, operatorClass, JSON.stringify(targetType === 'users' ? targets : []),
    operatorId, operatorName, createdAt
  );
  var broadcastId = result.lastInsertRowid;

  var ttlMs = Math.min(style.duration * 1000 + LIMITS.ttlGraceMs, LIMITS.ttlCapMs);

  var payload = Object.assign({}, style, {
    id: broadcastId,
    content: content,
    // 端上直接用的行数组：轮播按行切换，静态按 pre-line 整段显示
    lines: content.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(function(s) { return s; }),
    sender_name: operatorName,
    created_at: createdAt
  });

  var dispatched = deviceCommands.dispatch(targets, 'big_text', payload, {
    createdBy: operatorId,
    ttlMs: ttlMs
  });

  var liveCount = 0;
  for (var i = 0; i < dispatched.length; i++) if (dispatched[i].live) liveCount++;

  logAction(operatorId, 'send_big_text', String(broadcastId),
    '目标 ' + targets.length + ' 人（在线 ' + liveCount + '），时长 ' + style.duration + 's，模式 ' + style.display_mode +
    '，特效 ' + style.effect + '：' + content.substring(0, 50));

  res.json({
    code: 200,
    message: '大字已发送',
    data: {
      id: broadcastId,
      targets: targets.length,
      online: liveCount,
      queued: targets.length - liveCount,
      created_at: createdAt
    }
  });
});

// ===== GET /api/admin/big-text 历史列表 =====
// ⚠️ 必须按操作者可管辖范围隔离：大字内容可能带班级事务细节，班管/班干
//    不应该看到别班的广播记录。超管（无班号）看全部。
router.get('/', auth.requirePermission('manage_big_text'), function(req, res) {
  try {
    var operatorId = req.user ? req.user.user_id : '';
    var operatorClass = resolveOperatorClass(req);
    var rows;
    if (operatorClass) {
      rows = db.prepare(
        'SELECT * FROM big_text_broadcasts WHERE target_class = ? OR created_by = ? ORDER BY id DESC LIMIT 50'
      ).all(operatorClass, operatorId);
    } else {
      rows = db.prepare('SELECT * FROM big_text_broadcasts ORDER BY id DESC LIMIT 50').all();
    }
    for (var i = 0; i < rows.length; i++) {
      try { rows[i].target_ids = JSON.parse(rows[i].target_ids || '[]'); } catch (e) { rows[i].target_ids = []; }
      rows[i].text_gradient = parseJsonOr(rows[i].text_gradient, null);
      rows[i].bg_gradient = parseJsonOr(rows[i].bg_gradient, null);
      rows[i].show_sender = rows[i].show_sender ? true : false;
    }
    res.json({ code: 200, message: 'ok', data: { list: rows } });
  } catch (e) {
    console.error('[BigText] list failed:', e.message);
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

// ===== 策略（预设）=====
// 只存样式，不存内容/目标 —— 策略是「长什么样」，不是「发给谁说什么」。

router.get('/presets', auth.requirePermission('manage_big_text'), function(req, res) {
  var operatorId = req.user ? req.user.user_id : '';
  try {
    var rows = db.prepare(
      'SELECT id, name, payload, created_at, updated_at FROM big_text_presets WHERE created_by = ? ORDER BY updated_at DESC LIMIT 50'
    ).all(operatorId);
    for (var i = 0; i < rows.length; i++) rows[i].payload = parseJsonOr(rows[i].payload, {});
    res.json({ code: 200, message: 'ok', data: { list: rows } });
  } catch (e) {
    console.error('[BigText] presets list failed:', e.message);
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

router.post('/presets', auth.requirePermission('manage_big_text'), function(req, res) {
  var body = req.body || {};
  var name = String(body.name == null ? '' : body.name).trim().substring(0, 40);
  if (!name) return res.status(400).json({ code: 400, message: '策略名称不能为空' });

  var operatorId = req.user ? req.user.user_id : '';
  // 走同一份规范化，保证策略里不会存进非法值
  var style = normalizeStyle(body.payload || body);
  var now = time.nowISO();

  try {
    var existing = db.prepare('SELECT id FROM big_text_presets WHERE created_by = ? AND name = ?').get(operatorId, name);
    if (existing) {
      db.prepare('UPDATE big_text_presets SET payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(style), now, existing.id);
      logAction(operatorId, 'save_big_text_preset', name, '覆盖更新策略');
      return res.json({ code: 200, message: '策略已更新', data: { id: existing.id, name: name, updated: true } });
    }
    var r = db.prepare('INSERT INTO big_text_presets (name, payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, JSON.stringify(style), operatorId, now, now);
    logAction(operatorId, 'save_big_text_preset', name, '新建策略');
    res.json({ code: 200, message: '策略已保存', data: { id: r.lastInsertRowid, name: name, updated: false } });
  } catch (e) {
    console.error('[BigText] preset save failed:', e.message);
    res.status(500).json({ code: 500, message: '保存失败' });
  }
});

router.delete('/presets/:id', auth.requirePermission('manage_big_text'), function(req, res) {
  var id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ code: 400, message: '无效的 id' });
  var operatorId = req.user ? req.user.user_id : '';
  var r = db.prepare('DELETE FROM big_text_presets WHERE id = ? AND created_by = ?').run(id, operatorId);
  if (r.changes === 0) return res.status(404).json({ code: 404, message: '策略不存在' });
  res.json({ code: 200, message: '已删除', data: { id: id } });
});

// ===== POST /api/admin/big-text/:id/recall 撤回 =====
// 撤回不是删记录：已弹出的设备要立刻收起，未弹出的设备补拉时要跳过。
router.post('/:id/recall', auth.requirePermission('manage_big_text'), function(req, res) {
  var id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ code: 400, message: '无效的 id' });

  var row = db.prepare('SELECT * FROM big_text_broadcasts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' });

  var operatorId = req.user ? req.user.user_id : '';
  var operatorClass = resolveOperatorClass(req);
  var resolved = resolveTargets(req, row.target_type, safeParseIds(row.target_ids), operatorClass);

  if (row.recalled_at) return res.json({ code: 200, message: '已撤回', data: { id: id } });

  db.prepare("UPDATE big_text_broadcasts SET recalled_at = datetime('now') WHERE id = ?").run(id);

  var targets = resolved.targets || [];
  if (targets.length > 0) {
    deviceCommands.dispatch(targets, 'big_text_recall', { id: id }, {
      createdBy: operatorId,
      ttlMs: 10 * 60 * 1000
    });
    // 把还没投递的原始 big_text 指令一并注销：离线设备上线后只会收到 recall，
    // 不会再「先弹出来、再被收起」地闪一下。已投递（已 ACK）的不动，由 recall 收起。
    var cancelled = deviceCommands.cancelPending(targets, 'big_text', 'id', id);
    // 对端服务器库里的同源指令也要注销（漫游用户连上对端时补拉才不会闪）
    try {
      var relayBus = require('../utils/relay-bus');
      relayBus.relayOnly('device_command_cancel', {
        cmd_type: 'big_text',
        match_field: 'id',
        match_value: id,
        targets: targets
      });
    } catch (e) {
      // relay 不可用（单机部署）时本地注销已足够
    }
    console.log('[BigText] recall #' + id + ': targets=' + targets.length + ' cancelledPending=' + cancelled);
  }

  logAction(operatorId, 'recall_big_text', String(id), '撤回大字：' + String(row.content).substring(0, 50));
  res.json({ code: 200, message: '已撤回', data: { id: id, targets: targets.length } });
});

function parseJsonOr(str, fallback) {
  try {
    var v = JSON.parse(str || '');
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeParseIds(str) {
  var v = parseJsonOr(str, []);
  return Array.isArray(v) ? v : [];
}

module.exports = router;
module.exports.FONT_FAMILIES = FONT_FAMILIES;
module.exports.LIMITS = LIMITS;
module.exports.normalizeStyle = normalizeStyle;
