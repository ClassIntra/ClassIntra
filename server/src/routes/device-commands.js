/**
 * device-commands.js — 设备指令信箱的客户端接口
 *
 * 只提供两个端点，构成「补拉 + 确认」闭环：
 *   GET  /api/device-commands/pending  拉取所有未投递且未过期的指令
 *   POST /api/device-commands/ack      确认已执行，服务端标记 delivered_at
 *
 * 客户端调用时机（见 client/src/utils/command-inbox.js）：
 *   1. WS 连接建立 / 重连成功时立刻补拉一次
 *   2. 定时兜底补拉（默认 15s），覆盖 WS 推送丢失、服务端重启丢队列等场景
 *   3. 执行完指令后立刻 ACK
 */

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var deviceCommands = require('../services/device-commands');

router.use(auth.requireAuth);

// GET /api/device-commands/pending
// 返回 { code:200, data:{ commands:[{uid,cmd_type,payload,created_at,expires_at}] } }
router.get('/pending', function(req, res) {
  var userId = req.user && req.user.user_id;
  if (!userId) {
    return res.status(401).json({ code: 401, message: '未登录', data: { commands: [] } });
  }
  try {
    var commands = deviceCommands.fetchPending(userId);
    return res.json({ code: 200, message: 'ok', data: { commands: commands, server_time: Date.now() } });
  } catch (e) {
    console.error('[DeviceCmd] pending failed:', e.message);
    return res.status(500).json({ code: 500, message: '查询失败', data: { commands: [] } });
  }
});

// POST /api/device-commands/ack  { uids: ["...", "..."] }
router.post('/ack', function(req, res) {
  var userId = req.user && req.user.user_id;
  if (!userId) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  var uids = req.body && req.body.uids;
  if (!Array.isArray(uids)) {
    return res.status(400).json({ code: 400, message: 'uids 必须是数组' });
  }
  try {
    var n = deviceCommands.ack(userId, uids);
    return res.json({ code: 200, message: 'ok', data: { acked: n } });
  } catch (e) {
    console.error('[DeviceCmd] ack failed:', e.message);
    return res.status(500).json({ code: 500, message: '确认失败' });
  }
});

module.exports = router;
