// CampusBili 桥接后端路由
// 提供身份验证接口，CampusBili 后端可调用此接口验证 ClassIntra 用户身份
// （前端 postMessage 已注入身份，此接口用于后端二次验证，可选）

var express = require('express');
var router = express.Router();

// 验证 ClassIntra 用户身份
// CampusBili 后端可将 postMessage 收到的 user_id + timestamp 提交到此接口验证
// POST /api/campusbili-bridge/verify
// body: { user_id, timestamp }
// 返回: { valid: true, user: { user_id, net_name, is_admin, role } }
router.post('/verify', function(req, res) {
  // req.user 由全局 JWT 中间件填充（CampusBili 需携带 ClassIntra 用户的有效 JWT）
  if (!req.user || !req.user.user_id) {
    return res.status(401).json({ valid: false, error: '未认证' });
  }
  res.json({
    valid: true,
    user: {
      user_id: req.user.user_id,
      net_name: req.user.net_name,
      is_admin: req.user.is_admin,
      role: req.user.role
    }
  });
});

// 查询桥接配置（CampusBili 可拉取，了解当前 ClassIntra 环境信息）
router.get('/config', function(req, res) {
  res.json({
    platform: 'classintra',
    bridgeVersion: '1.0.0',
    features: ['postMessage-identity', 'back-button'],
    // CampusBili 站点正则匹配（用于 Browser.vue 判断是否注入桥接）
    sitePattern: 'campusbili'
  });
});

module.exports = router;
