// 后端路由：集成管理 API
// 路径前缀：/api/integrations
//
// 接口列表：
//   POST   /tokens                          签发新 token（管理员）
//   GET    /tokens                          列出所有集成（管理员）
//   GET    /tokens/:id                      获取单个集成（管理员）
//   PUT    /tokens/:id                      更新集成（管理员）
//   DELETE /tokens/:id                      撤销 token（管理员）
//   POST   /tokens/:id/regenerate-secret    重新生成 secret（管理员）
//   GET    /origins                         获取 origin 白名单（已登录用户）
//   POST   /webhook                         webhook 接收（外部系统，token 认证）

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var tokenStore = require('../integrations/token-store');
var originRegistry = require('../integrations/origin-registry');
var webhookReceiver = require('../integrations/webhook-receiver').createWebhookReceiver();
var constants = require('../utils/constants');

// ========== Token 管理（管理员） ==========

// 签发新 token
router.post('/tokens', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var body = req.body || {};
    if (!body.name) {
      return res.status(400).json({ code: 400, message: 'name 必填' });
    }
    // 验证 scopes 合法性
    var scopes = Array.isArray(body.scopes) ? body.scopes : [];
    // 验证 origins 合法性
    var origins = Array.isArray(body.origins) ? body.origins : [];
    for (var i = 0; i < origins.length; i++) {
      if (!originRegistry.isValidOrigin(origins[i])) {
        return res.status(400).json({ code: 400, message: 'origin 格式无效: ' + origins[i] });
      }
    }
    var result = tokenStore.issueToken(body.name, {
      scopes: scopes,
      webhookUrl: body.webhookUrl || '',
      origins: origins,
      ttlDays: typeof body.ttlDays === 'number' ? body.ttlDays : 30
    });
    res.json({ code: 200, message: 'token 签发成功', data: result });
  } catch (e) {
    console.error('[integrations] 签发 token 失败:', e.message);
    res.status(500).json({ code: 500, message: '签发 token 失败' });
  }
});

// 列出所有集成
router.get('/tokens', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var list = tokenStore.listIntegrations();
    res.json({ code: 200, data: list });
  } catch (e) {
    console.error('[integrations] 列出集成失败:', e.message);
    res.status(500).json({ code: 500, message: '列出集成失败' });
  }
});

// 获取单个集成
router.get('/tokens/:id', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var id = parseInt(req.params.id, 10);
    var integration = tokenStore.getIntegration(id);
    if (!integration) {
      return res.status(404).json({ code: 404, message: '集成不存在' });
    }
    res.json({ code: 200, data: integration });
  } catch (e) {
    console.error('[integrations] 获取集成失败:', e.message);
    res.status(500).json({ code: 500, message: '获取集成失败' });
  }
});

// 更新集成
router.put('/tokens/:id', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var id = parseInt(req.params.id, 10);
    var existing = tokenStore.getIntegration(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '集成不存在' });
    }
    var body = req.body || {};
    // 验证 origins
    if (Array.isArray(body.origins)) {
      for (var i = 0; i < body.origins.length; i++) {
        if (!originRegistry.isValidOrigin(body.origins[i])) {
          return res.status(400).json({ code: 400, message: 'origin 格式无效: ' + body.origins[i] });
        }
      }
    }
    tokenStore.updateIntegration(id, body);
    res.json({ code: 200, message: '更新成功' });
  } catch (e) {
    console.error('[integrations] 更新集成失败:', e.message);
    res.status(500).json({ code: 500, message: '更新集成失败' });
  }
});

// 撤销 token
router.delete('/tokens/:id', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var id = parseInt(req.params.id, 10);
    var existing = tokenStore.getIntegration(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '集成不存在' });
    }
    tokenStore.revokeToken(id);
    res.json({ code: 200, message: '已撤销' });
  } catch (e) {
    console.error('[integrations] 撤销 token 失败:', e.message);
    res.status(500).json({ code: 500, message: '撤销 token 失败' });
  }
});

// 重新生成 secret
router.post('/tokens/:id/regenerate-secret', auth.requireAuth, auth.requireAdmin, function(req, res) {
  try {
    var id = parseInt(req.params.id, 10);
    var existing = tokenStore.getIntegration(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '集成不存在' });
    }
    var newSecret = tokenStore.regenerateSecret(id);
    res.json({ code: 200, message: 'secret 已重新生成', data: { secret: newSecret } });
  } catch (e) {
    console.error('[integrations] 重生成 secret 失败:', e.message);
    res.status(500).json({ code: 500, message: '重生成 secret 失败' });
  }
});

// ========== Origin 白名单（已登录用户可访问） ==========

// 获取所有允许的 origin（用于前端 postMessage 桥初始化）
router.get('/origins', auth.requireAuth, function(req, res) {
  try {
    var list = tokenStore.listIntegrations();
    var origins = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].active && list[i].origins) {
        for (var j = 0; j < list[i].origins.length; j++) {
          var origin = list[i].origins[j];
          if (origins.indexOf(origin) === -1) {
            origins.push(origin);
          }
        }
      }
    }
    res.json({ code: 200, data: { origins: origins } });
  } catch (e) {
    console.error('[integrations] 获取 origins 失败:', e.message);
    res.status(500).json({ code: 500, message: '获取 origins 失败' });
  }
});

// ========== Webhook 接收（外部系统，token 认证） ==========

// 捕获原始 body（用于签名验证）
router.post('/webhook', function(req, res, next) {
  // express.json() 已解析 body，但我们需要原始 body 用于签名验证
  // 如果 req.body 是对象，重新序列化（注意：可能与原始 body 不完全一致）
  if (!req._rawBody && req.body) {
    req._rawBody = JSON.stringify(req.body);
  }
  next();
}, webhookReceiver);

module.exports = router;
