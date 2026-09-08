// AstrBot Relay - 后端路由
// 挂载路径：/api/astrbot
//
//   GET  /status                 插件与机器人连接状态（CI WS + OneBot 反向 WS），需管理员会话
//   POST /publish                论坛发帖（AstrBot 端 LLM 工具回调），需共享密钥 x-publish-key
//
// require 时自动启动：机器人登录 CI WS + 连入 AstrBot OneBot 反向 WS（幂等）。

var express = require('express');
var router = express.Router();
var relay = require('./relay');
// 状态接口仅管理员可见；发布接口走共享密钥，见 publishKeyOk
var { requireAuth, requireAdmin } = require('../../../server/src/middleware/auth');

// 启动机器人（幂等；依赖 server/.env 中的 BOT_PASSWORD 等环境变量）
relay.start();

// 发布接口鉴权：请求头 x-publish-key 必须与 server/.env 的 ASTRBOT_PUBLISH_KEY 一致
function publishKeyOk(req) {
  var expected = process.env.ASTRBOT_PUBLISH_KEY || '';
  if (!expected) return false;
  return String(req.headers['x-publish-key'] || '') === expected;
}

// 论坛帖子字段清洗（与 community 应用路由保持一致）
function sanitizePostPayload(body) {
  body = body || {};
  var payload = {
    type: 'forum',
    title: String(body.title || '').trim(),
    content: String(body.content || '').trim(),
    is_anonymous: body.anonymous || body.is_anonymous ? 1 : 0,
    visible_groups: Array.isArray(body.visible_groups) ? body.visible_groups : [],
    hidden_groups: Array.isArray(body.hidden_groups) ? body.hidden_groups : [],
    tags: []
  };
  if (Array.isArray(body.tags)) {
    payload.tags = body.tags.filter(function (t) {
      return typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 20;
    }).slice(0, 5);
  }
  return payload;
}

// 状态查询（管理员）
router.get('/status', requireAuth, requireAdmin, function (req, res) {
  res.json({ code: 200, message: 'ok', data: relay.getStatus() });
});

// 论坛发帖（AstrBot 插件用共享密钥调用，机器人账号身份）
router.post('/publish', function (req, res) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  var payload = sanitizePostPayload(req.body);
  if (!payload.content) {
    return res.status(400).json({ code: 400, message: '帖子内容不能为空' });
  }
  relay.publishForumPost(payload).then(function (post) {
    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: post.id,
        type: post.type,
        title: post.title || '',
        content: post.content || '',
        anonymous: post.anonymous || post.is_anonymous || 0,
        created_at: post.created_at || null
      }
    });
  }).catch(function (e) {
    var status = (e && e.response && e.response.status) || 500;
    var message = (e && e.response && e.response.data && e.response.data.message)
      || e.message || '发帖失败';
    if (status >= 500) console.error('[astrbot-relay] 发布帖子失败:', e);
    res.status(status >= 500 ? 500 : status).json({ code: status, message: message });
  });
});

module.exports = router;
