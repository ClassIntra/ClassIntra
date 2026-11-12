// 全局实时事件通道：第三方应用可通过 HTTP 长轮询或 WebSocket 收发事件
var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var realtimeBus = require('../utils/realtime-bus');
var db = require('../utils/db');

router.use(auth.requireAuth);

// POST /api/realtime/poll/register
router.post('/poll/register', function(req, res) {
  realtimeBus.register(req.user.user_id);
  return res.json({ code: 200, message: 'ok', data: { server_time: Date.now(), transport: 'poll' } });
});

// GET /api/realtime/poll?since=<ms>
router.get('/poll', function(req, res) {
  var userId = req.user.user_id;
  if (!realtimeBus.isRegistered(userId)) {
    return res.status(401).json({ code: 401, message: '尚未注册实时通道', data: null });
  }
  var since = parseInt(req.query.since, 10) || 0;
  var started = Date.now();
  function waitForEvents() {
    var events = realtimeBus.consume(userId, since);
    if (events.length > 0 || Date.now() - started >= 25000) {
      return res.json({ code: 200, message: 'ok', data: { events: events, server_time: Date.now() } });
    }
    setTimeout(waitForEvents, 1000);
  }
  waitForEvents();
});

// POST /api/realtime/publish
router.post('/publish', function(req, res) {
  var eventName = req.body && req.body.event;
  if (typeof eventName !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(eventName)) {
    return res.status(400).json({ code: 400, message: '事件名无效', data: null });
  }
  realtimeBus.publish({
    type: 'extension_event',
    app_name: req.body.app_name || '',
    event: eventName,
    payload: req.body.payload === undefined ? null : req.body.payload,
    sender_id: req.user.user_id,
    created_at: new Date().toISOString()
  }, null, true);
  return res.json({ code: 200, message: 'ok', data: { server_time: Date.now() } });
});

router.post('/poll/unregister', function(req, res) {
  realtimeBus.unregister(req.user.user_id);
  return res.json({ code: 200, message: 'ok' });
});

// ============================================================
// 频道（channel）—— 第三方应用的多人体 / 房间 / 大世界场景
// ============================================================
// 为什么需要它：/publish 是「广播给所有在线用户」。一个二十人同时在线的世界，
// 如果每次位移都走全局广播，全校每个人的 WS 都会收到与自己无关的数据。
// 频道把用户按房间分组，事件只投给同房间成员。
//
// 命名强制 `app:<appName>:<room>`：
//   1. 应用之间天然隔离 —— 没有前缀就无法表达「我属于哪个应用」；
//   2. 路由层据此校验该应用确实已安装且启用，防止 A 应用的用户混进 B 应用的房间；
//   3. 后续做按应用的流量统计时，不用再改协议。

// 房间段允许字母数字与 . _ : -，长度 1~40：够表达 world / room-123 / town:square
var CHANNEL_RE = /^app:([a-z][a-z0-9-]{0,31}):([A-Za-z0-9_.:-]{1,40})$/;

// 与 market-service 的 isAppEnabled 同一语义：
// app_control 里没有记录 = 视为启用（官方应用不一定登记，只有市场应用安装时才写）。
function isAppEnabled(appName) {
  try {
    var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(appName);
    return !row || !!row.enabled;
  } catch (e) {
    return true;
  }
}

function parseChannel(raw) {
  var value = String(raw || '');
  var m = CHANNEL_RE.exec(value);
  if (!m) return null;
  return { channel: value, app: m[1], room: m[2] };
}

// 加入频道：幂等。客户端重连、刷新、切页面后重新调用即可。
router.post('/channels/join', function(req, res) {
  var parsed = parseChannel(req.body && req.body.channel);
  if (!parsed) return res.status(400).json({ code: 400, message: '频道名必须形如 app:<应用名>:<房间>' });
  if (!isAppEnabled(parsed.app)) return res.status(403).json({ code: 403, message: '应用未安装或已停用' });
  var ok = realtimeBus.joinChannel(req.user.user_id, parsed.channel, parsed.app);
  if (!ok) return res.status(429).json({ code: 429, message: '频道已满或数量已达上限' });
  return res.json({
    code: 200,
    message: 'ok',
    data: { channel: parsed.channel, members: realtimeBus.channelMembers(parsed.channel).length }
  });
});

router.post('/channels/leave', function(req, res) {
  var parsed = parseChannel(req.body && req.body.channel);
  if (!parsed) return res.status(400).json({ code: 400, message: '频道名非法' });
  realtimeBus.leaveChannel(req.user.user_id, parsed.channel);
  return res.json({ code: 200, message: 'ok' });
});

// 频道内广播：只有成员能发，避免未加入的人往房间里灌数据。
router.post('/channels/publish', function(req, res) {
  var parsed = parseChannel(req.body && req.body.channel);
  if (!parsed) return res.status(400).json({ code: 400, message: '频道名非法' });
  if (!isAppEnabled(parsed.app)) return res.status(403).json({ code: 403, message: '应用未安装或已停用' });
  var members = realtimeBus.channelMembers(parsed.channel);
  if (members.indexOf(String(req.user.user_id)) === -1) {
    return res.status(403).json({ code: 403, message: '请先加入频道' });
  }
  var eventName = req.body && req.body.event;
  if (typeof eventName !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(eventName)) {
    return res.status(400).json({ code: 400, message: '事件名无效' });
  }
  var delivered = realtimeBus.publishToChannel(parsed.channel, {
    type: 'extension_event',
    app_name: parsed.app,
    channel: parsed.channel,
    event: eventName,
    payload: req.body.payload === undefined ? null : req.body.payload,
    sender_id: req.user.user_id,
    created_at: new Date().toISOString()
  });
  return res.json({ code: 200, message: 'ok', data: { delivered: delivered } });
});

router.get('/channels/members', function(req, res) {
  var parsed = parseChannel(req.query.channel);
  if (!parsed) return res.status(400).json({ code: 400, message: '频道名非法' });
  var members = realtimeBus.channelMembers(parsed.channel);
  return res.json({ code: 200, data: { channel: parsed.channel, count: members.length } });
});

// 运维视角：当前进程里所有频道。仅系统管理员可读，避免暴露房间结构。
router.get('/channels', function(req, res) {
  if (!req.user.is_admin && !req.user.is_class_admin) {
    return res.status(403).json({ code: 403, message: '无权限查看频道列表' });
  }
  return res.json({ code: 200, data: { channels: realtimeBus.channelStats() } });
});

module.exports = router;
