// 全局实时事件通道：第三方应用可通过 HTTP 长轮询或 WebSocket 收发事件
var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');

router.use(auth.requireAuth);

function getChatServer() {
  try { return require('../ws/chat-server'); } catch (e) { return null; }
}

// POST /api/realtime/poll/register
router.post('/poll/register', function(req, res) {
  var cs = getChatServer();
  if (!cs || !cs.registerPoller) {
    return res.status(503).json({ code: 503, message: '实时服务不可用', data: null });
  }
  var userId = req.user.user_id;
  cs.registerPoller(userId, {
    user_id: userId,
    net_name: req.user.net_name || userId,
    real_name: req.user.real_name || userId,
    status: 'online'
  });
  return res.json({ code: 200, message: 'ok', data: { server_time: Date.now(), transport: 'poll' } });
});

// GET /api/realtime/poll?since=<ms>
router.get('/poll', function(req, res) {
  var cs = getChatServer();
  var userId = req.user.user_id;
  if (!cs || !cs.consumePollEvents || !cs.isPoller || !cs.isPoller(userId)) {
    return res.status(401).json({ code: 401, message: '尚未注册实时通道', data: null });
  }
  var since = parseInt(req.query.since, 10) || 0;
  var started = Date.now();
  function waitForEvents() {
    var events = cs.consumePollEvents(userId, since);
    if (events.length > 0 || Date.now() - started >= 25000) {
      return res.json({ code: 200, message: 'ok', data: { events: events, server_time: Date.now() } });
    }
    setTimeout(waitForEvents, 1000);
  }
  waitForEvents();
});

// POST /api/realtime/publish
router.post('/publish', function(req, res) {
  var cs = getChatServer();
  var eventName = req.body && req.body.event;
  if (!cs || !cs.broadcast || typeof eventName !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(eventName)) {
    return res.status(400).json({ code: 400, message: '事件名无效', data: null });
  }
  cs.broadcast({
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
  var cs = getChatServer();
  if (cs && cs.unregisterPoller) cs.unregisterPoller(req.user.user_id);
  return res.json({ code: 200, message: 'ok' });
});

module.exports = router;
