// AstrBot Relay - 后端路由
// 挂载路径：/api/astrbot
//
//   GET  /status                 插件与机器人连接状态（CI WS + OneBot 反向 WS）
//
// require 时自动启动：机器人登录 CI WS + 连入 AstrBot OneBot 反向 WS（幂等）。

var express = require('express');
var router = express.Router();
var relay = require('./relay');

// 启动机器人（幂等；依赖 server/.env 中的 BOT_PASSWORD 等环境变量）
relay.start();

// 状态查询
router.get('/status', function (req, res) {
  res.json({ code: 200, message: 'ok', data: relay.getStatus() });
});

module.exports = router;
