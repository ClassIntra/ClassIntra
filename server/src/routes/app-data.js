// 应用级存储 HTTP 接口（/api/app-data）
// ============================================================
// 只解决一件事：第三方应用需要「跟着账号走」的服务端存储，而不必直连共享 SQLite。
//
// 权限模型（重要）：
//   - 所有端点都要求登录；数据按 (app_name, 当前用户) 隔离，用户之间不可互读。
//   - 应用必须是「已安装且未停用」，否则 403（停用应用连自己的数据也读不到）。
//   - 应用级共享数据（owner='*'）只允许应用后端经 core/app-data 服务写入；
//     HTTP 侧当前不开放写共享区，避免任意用户污染全班看到的数据。
//
// 编码约定：var / function / 2 空格缩进。

var express = require('express');
var path = require('path');
var router = express.Router();
var auth = require('../middleware/auth');
var manifestLoader = require('../core/manifest-loader');
var appData = require('../core/app-data');

// 应用存在性 + 启停检查（每次读 manifest 缓存，成本可忽略）
function checkApp(req, res, next) {
  var name = String(req.params.app || '');
  if (!appData.isValidAppName(name)) {
    return res.status(400).json({ code: 400, message: '应用名非法' });
  }
  var found = false;
  try {
    found = manifestLoader.loadManifests().some(function (m) { return m.name === name; });
  } catch (e) { found = false; }
  if (!found) return res.status(404).json({ code: 404, message: '应用未安装: ' + name });

  try {
    var db = require('../utils/db');
    var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(name);
    if (row && !row.enabled) {
      return res.status(403).json({ code: 403, message: '应用已停用，数据接口不可用' });
    }
  } catch (e) { /* 表未初始化时按启用处理 */ }

  req.appName = name;
  next();
}

router.use('/:app', auth.requireAuth, checkApp);

// ---------- KV ----------

// 列出键（不含值，适合先看有哪些）
router.get('/:app/kv', function (req, res) {
  try {
    var keys = appData.listKeys(req.appName, req.user.user_id);
    res.json({ code: 200, data: { keys: keys, limit: appData.LIMITS.MAX_KEYS } });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

// 一次取回全部键值（客户端启动时同步用）
router.get('/:app/kv/all', function (req, res) {
  try {
    res.json({ code: 200, data: { values: appData.getAll(req.appName, req.user.user_id) } });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

router.get('/:app/kv/:key', function (req, res) {
  try {
    var value = appData.get(req.appName, req.user.user_id, req.params.key);
    if (value === null) return res.status(404).json({ code: 404, message: '键不存在' });
    res.json({ code: 200, data: { key: req.params.key, value: value } });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

router.put('/:app/kv/:key', function (req, res) {
  try {
    var body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
      return res.status(400).json({ code: 400, message: '缺少 value 字段' });
    }
    appData.set(req.appName, req.user.user_id, req.params.key, body.value);
    res.json({ code: 200, message: '已保存' });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

router.delete('/:app/kv/:key', function (req, res) {
  try {
    var removed = appData.remove(req.appName, req.user.user_id, req.params.key);
    res.json({ code: 200, data: { removed: removed } });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

// ---------- 对象存储 ----------

router.get('/:app/blobs', function (req, res) {
  try {
    res.json({
      code: 200,
      data: { blobs: appData.listBlobs(req.appName, req.user.user_id), limit: appData.LIMITS.MAX_BLOBS }
    });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

// 上传：原始字节 body（Content-Type 即文件类型），上限 5MB
router.put('/:app/blobs/:name', express.raw({ type: '*/*', limit: appData.LIMITS.MAX_BLOB_BYTES }), function (req, res) {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ code: 400, message: '空文件或缺少请求体' });
    }
    var mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    var meta = appData.putBlob(req.appName, req.user.user_id, req.params.name, req.body, mime);
    res.json({ code: 200, message: '已上传', data: meta });
  } catch (e) {
    var status = /超过 5MB/.test(e.message) ? 413 : 400;
    res.status(status).json({ code: status, message: e.message });
  }
});

router.get('/:app/blobs/:name', function (req, res) {
  try {
    var meta = appData.getBlobMeta(req.appName, req.user.user_id, req.params.name);
    if (!meta) return res.status(404).json({ code: 404, message: '文件不存在' });
    res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
    res.setHeader('Content-Length', meta.size);
    // 私有数据：只允许浏览器短期缓存，不共享给代理
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(path.resolve(appData.blobPath(meta)));
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

router.delete('/:app/blobs/:name', function (req, res) {
  try {
    var removed = appData.deleteBlob(req.appName, req.user.user_id, req.params.name);
    res.json({ code: 200, data: { removed: removed } });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

module.exports = router;
