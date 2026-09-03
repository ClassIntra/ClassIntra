// AstrBot Relay - 后端路由
// 挂载路径：/api/astrbot
//
//   GET  /status                 插件与机器人连接状态
//   POST /callback               AstrBot 异步任务回调（经反向隧道）
//   GET  /resource?path=/...     资源代理：透传 AstrBot 生成的资源给前端
//
// require 时自动启动机器人 WS 客户端（幂等）。

var express = require('express');
var router = express.Router();
var relay = require('./relay');

// 启动机器人（幂等；依赖 server/.env 中的 BOT_PASSWORD 等环境变量）
relay.start();

// 状态查询
router.get('/status', function (req, res) {
  res.json({ code: 200, message: 'ok', data: relay.getStatus() });
});

// 异步任务回调（Bot 服务器通过反向隧道调用）
router.post('/callback', function (req, res) {
  var body = req.body || {};
  var taskId = body.task_id;
  if (!taskId) {
    return res.status(400).json({ code: 400, message: '缺少 task_id' });
  }
  var task = relay.completeTask(taskId);
  if (!task) {
    return res.json({ code: 200, message: '任务不存在或已处理（可能已超时清理）', data: null });
  }
  if (body.status === 'success') {
    relay.sendRichMessage(task.userId, body);
  } else {
    relay.sendPrivate(task.userId, '😵 林晞处理这个任务时出错了：' + (body.error || '未知错误'));
  }
  res.json({ code: 200, message: 'ok', data: null });
});

// 资源代理：/api/astrbot/resource?path=/classintra_res/<token>.png
// 下载 AstrBot 生成的资源到本地 Resources/astrbot/remote/，随后前端经
// /resources/astrbot/remote/<token>.png（express.static）原生渲染。
router.get('/resource', function (req, res) {
  var resourcePath = String(req.query.path || '');
  if (resourcePath.indexOf(relay.ALLOWED_RESOURCE_PREFIX) !== 0) {
    return res.status(400).json({ code: 400, message: '非法资源路径' });
  }
  relay.fetchResource(resourcePath).then(function (localPath) {
    var token = resourcePath.substring(relay.ALLOWED_RESOURCE_PREFIX.length);
    // 资源已落盘到 Resources/astrbot/remote/<token>，交给静态服务，302 即可
    res.redirect(302, '/resources/astrbot/remote/' + token);
  }).catch(function (err) {
    console.error('[astrbot-relay] 资源代理失败:', err.message);
    res.status(502).json({ code: 502, message: '资源获取失败: ' + err.message });
  });
});

module.exports = router;
