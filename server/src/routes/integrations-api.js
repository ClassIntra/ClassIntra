// 对外查询 API（/api/integrations/v1）
// ============================================================
// 给「机器」用的只读业务接口：班级门户、大屏、外部统计脚本可以用集成 token 拉数据，
// 不必再让部署者共享管理员密码。
//
// 鉴权：X-ClassIntra-Token（集成 token），逐端点校验 scope：
//   GET  /users*         → user:read
//   GET  /announcements  → notification:read
//   GET  /apps /stats    → market:read
//   GET  /whoami         → 无（任何有效 token 可自检）
//   POST /announcements  → notification:write（支持 Idempotency-Key）
//   POST /apps/:name/state → app:write（启用/停用应用，受保护应用拒绝）
//
// 数据边界：只暴露白名单字段；不返回密码哈希、隐私设置、联系方式、封禁原因等。
//
// 编码约定：var / function。

var express = require('express');
var router = express.Router();
var requireIntegration = require('../middleware/integration-auth').requireIntegration;

var MAX_LIMIT = 200;
var PUBLIC_USER_FIELDS = 'user_id, net_name, real_name, level, exp, status, role, created_at, last_login';

function parseIntSafe(v, def, min, max) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = def;
  return Math.min(Math.max(n, min), max);
}

// ---------- 幂等（写接口必须可重试） ----------
// 调用方带 Idempotency-Key；24 小时内同键直接回放上次响应，不重复产生副作用。
function idemKeyOf(req) {
  var raw = String(req.headers['idempotency-key'] || '').trim();
  if (!raw) return '';
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(raw)) return '';
  return 'int' + req.integration.id + ':' + raw;
}

function replayIdempotent(req, res, key) {
  if (!key) return false;
  try {
    var db = require('../utils/db');
    var row = db.prepare('SELECT status, response_body, created_at FROM integration_requests WHERE idem_key = ?').get(key);
    if (!row) return false;
    if (Date.now() - (row.created_at || 0) > 24 * 3600 * 1000) return false;
    res.setHeader('X-Idempotent-Replay', '1');
    res.status(row.status || 200).json(JSON.parse(row.response_body || '{}'));
    return true;
  } catch (e) {
    return false;
  }
}

function rememberIdempotent(req, key, status, body) {
  if (!key) return;
  try {
    var db = require('../utils/db');
    db.prepare(
      'INSERT OR REPLACE INTO integration_requests (idem_key, integration_id, method, path, status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(key, req.integration.id, req.method, req.originalUrl, status, JSON.stringify(body || {}), Date.now());
    // 顺手清理 24 小时前的旧记录，避免表无限增长
    db.prepare('DELETE FROM integration_requests WHERE created_at < ?').run(Date.now() - 24 * 3600 * 1000);
  } catch (e) {}
}

// 审计：把集成动作记为一条管理员日志（admin_id 用 integration:<id> 前缀区分人/机器）
function audit(req, action, target, detail) {
  try {
    var db = require('../utils/db');
    db.prepare("INSERT INTO admin_logs (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
      .run('integration:' + req.integration.id + ':' + (req.integration.name || ''), action, String(target || ''), String(detail || '').slice(0, 200));
  } catch (e) {}
}

function ok(res, data, extra) {
  var payload = { code: 200, data: data };
  if (extra) for (var k in extra) payload[k] = extra[k];
  res.json(payload);
}

// 自检：确认 token 有效、看到自己的 scope 与到期时间
router.get('/whoami', requireIntegration(null), function (req, res) {
  var it = req.integration;
  ok(res, {
    id: it.id,
    name: it.name,
    scopes: it.scopes || [],
    expiresAt: it.expiresAt || null,
    serverTime: new Date().toISOString()
  });
});

// 用户列表
router.get('/users', requireIntegration('user:read'), function (req, res) {
  try {
    var db = require('../utils/db');
    var limit = parseIntSafe(req.query.limit, 50, 1, MAX_LIMIT);
    var offset = parseIntSafe(req.query.offset, 0, 0, 1000000);
    var q = String(req.query.q || '').trim();
    var where = '';
    var params = [];
    if (q) {
      where = ' WHERE net_name LIKE ? OR real_name LIKE ? OR user_id LIKE ?';
      params = ['%' + q + '%', '%' + q + '%', '%' + q + '%'];
    }
    // better-sqlite3 的绑定参数按数组传入即可；不要用 .apply（会 Illegal invocation）
    var totalStmt = db.prepare('SELECT COUNT(*) AS c FROM users' + where);
    var total = totalStmt.get(params).c;
    var listStmt = db.prepare(
      'SELECT ' + PUBLIC_USER_FIELDS + ' FROM users' + where + ' ORDER BY user_id LIMIT ? OFFSET ?'
    );
    var rows = listStmt.all(params.concat([limit, offset]));
    ok(res, { users: rows, total: total, limit: limit, offset: offset });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询用户失败: ' + e.message });
  }
});

// 单个用户
router.get('/users/:userId', requireIntegration('user:read'), function (req, res) {
  try {
    var db = require('../utils/db');
    var row = db.prepare('SELECT ' + PUBLIC_USER_FIELDS + ' FROM users WHERE user_id = ?').get(String(req.params.userId));
    if (!row) return res.status(404).json({ code: 404, message: '用户不存在' });
    ok(res, { user: row });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询用户失败: ' + e.message });
  }
});

// 公告列表（不含已删除；按置顶 + 时间倒序）
router.get('/announcements', requireIntegration('notification:read'), function (req, res) {
  try {
    var db = require('../utils/db');
    var limit = parseIntSafe(req.query.limit, 20, 1, MAX_LIMIT);
    var offset = parseIntSafe(req.query.offset, 0, 0, 1000000);
    var type = String(req.query.type || '').trim();
    var where = type ? ' WHERE type = ?' : '';
    var params = type ? [type] : [];
    var totalStmt = db.prepare('SELECT COUNT(*) AS c FROM announcements' + where);
    var total = (params.length ? totalStmt.get(params[0]) : totalStmt.get()).c;
    var listStmt = db.prepare(
      'SELECT id, title, content, type, author_id, author_name, pinned, created_at FROM announcements' + where +
      ' ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?'
    );
    var rows = listStmt.all(params.concat([limit, offset]));
    ok(res, { announcements: rows, total: total, limit: limit, offset: offset });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询公告失败: ' + e.message });
  }
});

// 已安装市场应用（含启用状态）
router.get('/apps', requireIntegration('market:read'), function (req, res) {
  try {
    var marketService = require('../core/market-service');
    var apps = marketService.listInstalled().map(function (a) {
      return {
        name: a.name,
        label: a.label,
        version: a.version,
        description: a.description,
        author: a.author,
        enabled: a.enabled,
        capabilities: a.capabilities || [],
        installedAt: a.installedAt
      };
    });
    ok(res, { apps: apps });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询应用失败: ' + e.message });
  }
});

// 汇总统计（大屏 / 门户首页用）
router.get('/stats', requireIntegration('market:read'), function (req, res) {
  try {
    var db = require('../utils/db');
    var users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    var active = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;
    var announcements = db.prepare('SELECT COUNT(*) AS c FROM announcements').get().c;
    var marketService = require('../core/market-service');
    var installed = marketService.listInstalled();
    var enabled = installed.filter(function (a) { return a.enabled; }).length;
    ok(res, {
      users: { total: users, active: active },
      announcements: { total: announcements },
      apps: { installed: installed.length, enabled: enabled },
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询统计失败: ' + e.message });
  }
});

// ---------- 写接口 ----------

// 发布公告（外部系统 / 大屏 / 值班脚本）
router.post('/announcements', requireIntegration('notification:write'), function (req, res) {
  var body = req.body || {};
  var title = String(body.title || '').trim();
  var content = String(body.content || '').trim();
  var type = (body.type === 'homework') ? 'homework' : 'notice';
  if (!title) return res.status(400).json({ code: 400, message: 'title 必填' });
  if (!content) return res.status(400).json({ code: 400, message: 'content 必填' });
  if (title.length > 200) return res.status(400).json({ code: 400, message: 'title 过长（≤200）' });
  if (content.length > 20000) return res.status(400).json({ code: 400, message: 'content 过长（≤20000）' });

  var key = idemKeyOf(req);
  if (replayIdempotent(req, res, key)) return;

  try {
    var db = require('../utils/db');
    var authorName = '集成:' + (req.integration.name || req.integration.id);
    var info = db.prepare(
      "INSERT INTO announcements (title, content, type, author_id, author_name, pinned, created_at) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))"
    ).run(title, content, type, 'integration:' + req.integration.id, authorName);
    var id = info.lastInsertRowid;

    audit(req, 'integration_create_announcement', String(id), type + ': ' + title);
    require('../integrations/emit').emit('announcement.published', {
      id: id, title: title, type: type, author_id: 'integration:' + req.integration.id
    });

    var payload = { code: 200, message: '公告已发布', data: { id: id, title: title, type: type } };
    rememberIdempotent(req, key, 200, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ code: 500, message: '发布公告失败: ' + e.message });
  }
});

// 启用 / 停用应用（含第三方）。受保护应用（canDisable=false）一律拒绝。
router.post('/apps/:name/state', requireIntegration('app:write'), function (req, res) {
  var name = String(req.params.name || '');
  var body = req.body || {};
  if (typeof body.enabled !== 'boolean') {
    return res.status(400).json({ code: 400, message: 'enabled 必须是布尔值' });
  }
  var manifest = null;
  try {
    manifest = require('../core/manifest-loader').loadManifests().filter(function (m) { return m.name === name; })[0] || null;
  } catch (e) { manifest = null; }
  if (!manifest) return res.status(404).json({ code: 404, message: '应用未安装: ' + name });
  if (!body.enabled && manifest.canDisable === false) {
    return res.status(400).json({ code: 400, message: (manifest.label || name) + ' 不允许停用' });
  }

  var key = idemKeyOf(req);
  if (replayIdempotent(req, res, key)) return;

  try {
    var db = require('../utils/db');
    var enabled = body.enabled ? 1 : 0;
    db.prepare(
      "INSERT INTO app_control (app_name, enabled, updated_by, updated_at) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(app_name) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    ).run(name, enabled, 'integration:' + req.integration.id);

    try {
      require('../ws/chat-server').broadcast({
        type: 'market_app_control_changed', appName: name, enabled: enabled === 1, updatedBy: 'integration:' + req.integration.id
      });
    } catch (e) {}

    try {
      var scheduler = require('../core/app-scheduler');
      if (enabled === 1) scheduler.syncApp(name);
      else scheduler.unregister(name);
    } catch (e) {}

    require('../integrations/emit').emit(enabled === 1 ? 'app.enabled' : 'app.disabled', {
      name: name,
      label: manifest.label || name,
      source: manifest._sourceType === 'market' ? 'market' : 'builtin',
      operator: 'integration:' + req.integration.id
    });
    audit(req, enabled === 1 ? 'integration_enable_app' : 'integration_disable_app', name, manifest.label || name);

    var payload = { code: 200, message: enabled === 1 ? '应用已启用' : '应用已停用', data: { name: name, enabled: enabled === 1 } };
    rememberIdempotent(req, key, 200, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新应用状态失败: ' + e.message });
  }
});

// ---------- 自描述：OpenAPI 3.0 ----------
// 免鉴权公开：只描述「有哪些接口、字段长什么样」，不含任何班级数据。
// 目的：外部开发者不必读文档猜字段，直接导入 Postman / Apifox / Insomnia 就能调。
function buildOpenAPI(req) {
  var scheme = (req && req.protocol) || 'http';
  var host = (req && req.headers && req.headers.host) || 'localhost:9001';
  var errResp = {
    description: '出错',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  };
  function envelope(ref) {
    return {
      description: '成功',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              code: { type: 'integer', example: 200 },
              message: { type: 'string' },
              data: ref ? { $ref: '#/components/schemas/' + ref } : { type: 'object' }
            }
          }
        }
      }
    };
  }
  function listResp(ref) {
    return {
      description: '成功',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              code: { type: 'integer', example: 200 },
              data: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  items: { type: 'array', items: { $ref: '#/components/schemas/' + ref } }
                }
              }
            }
          }
        }
      }
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'ClassIntra 集成 API',
      version: '1.0.0',
      description:
        '供外部系统（班级门户 / 大屏 / 值班脚本）读写班级数据的只读+受控写入接口。\n\n' +
        '鉴权：请求头 `X-ClassIntra-Token`（管理员在「管理 → 集成」签发），按端点校验 scope。\n' +
        '幂等：写接口带 `Idempotency-Key`（8-128 位）时，24 小时内同键回放上次响应，响应头 `X-Idempotent-Replay: 1`。\n' +
        '限流：每 token 120 次/分钟。'
    },
    servers: [{ url: scheme + '://' + host + '/api/integrations/v1', description: '当前班级服务器' }],
    security: [{ IntegrationToken: [] }],
    tags: [
      { name: '自检', description: '验证 token 是否有效' },
      { name: '读', description: '查询班级数据（按 scope 放行）' },
      { name: '写', description: '受控写入（幂等 + 审计）' }
    ],
    paths: {
      '/whoami': {
        get: {
          tags: ['自检'],
          summary: '当前 token 的身份与权限',
          description: '任何有效 token 都可调用，不需要 scope。用于排查「为什么 403」。',
          responses: { '200': envelope('WhoAmI'), '401': errResp }
        }
      },
      '/users': {
        get: {
          tags: ['读'],
          summary: '用户列表',
          description: '需要 scope `user:read`。只返回公开字段（不含密码、隐私设置、联系方式）。',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: '按学号/昵称模糊搜索' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
          ],
          responses: { '200': listResp('User'), '401': errResp, '403': errResp }
        }
      },
      '/users/{id}': {
        get: {
          tags: ['读'],
          summary: '单个用户',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': envelope('User'), '404': errResp, '403': errResp }
        }
      },
      '/announcements': {
        get: {
          tags: ['读'],
          summary: '公告列表',
          description: '需要 scope `notification:read`。',
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['notice', 'homework'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
          ],
          responses: { '200': listResp('Announcement'), '403': errResp }
        },
        post: {
          tags: ['写'],
          summary: '发布公告',
          description: '需要 scope `notification:write`。写操作记入管理员日志（admin_id 为 `integration:<id>:<name>`）。',
          parameters: [
            {
              name: 'Idempotency-Key', in: 'header', required: false,
              schema: { type: 'string', minLength: 8, maxLength: 128 },
              description: '同键 24 小时内只生效一次'
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'content'],
                  properties: {
                    title: { type: 'string', maxLength: 200 },
                    content: { type: 'string', maxLength: 20000 },
                    type: { type: 'string', enum: ['notice', 'homework'], default: 'notice' }
                  }
                }
              }
            }
          },
          responses: { '200': envelope(), '400': errResp, '403': errResp }
        }
      },
      '/apps': {
        get: {
          tags: ['读'],
          summary: '已安装应用（含启用状态）',
          description: '需要 scope `market:read`。',
          responses: { '200': envelope(), '403': errResp }
        }
      },
      '/apps/{name}/state': {
        post: {
          tags: ['写'],
          summary: '启用 / 停用应用',
          description: '需要 scope `app:write`。`canDisable: false` 的受保护应用一律拒绝（400）。',
          parameters: [
            { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['enabled'],
                  properties: { enabled: { type: 'boolean' } }
                }
              }
            }
          },
          responses: { '200': envelope(), '400': errResp, '403': errResp, '404': errResp }
        }
      },
      '/stats': {
        get: {
          tags: ['读'],
          summary: '班级汇总统计',
          description: '需要 scope `market:read`。用户数 / 公告数 / 应用数。',
          responses: { '200': envelope(), '403': errResp }
        }
      }
    },
    components: {
      securitySchemes: {
        IntegrationToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-ClassIntra-Token',
          description: '管理员在「管理 → 集成」签发的 token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            code: { type: 'integer', example: 403 },
            message: { type: 'string', example: '缺少 scope: user:read' }
          }
        },
        WhoAmI: {
          type: 'object',
          properties: {
            integration: { type: 'object' },
            scopes: { type: 'array', items: { type: 'string' } }
          }
        },
        User: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            net_name: { type: 'string' },
            real_name: { type: 'string' },
            role: { type: 'string' },
            status: { type: 'string' }
          }
        },
        Announcement: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string' },
            author_name: { type: 'string' },
            created_at: { type: 'string' }
          }
        }
      }
    }
  };
}

// 免鉴权：只描述接口形状，不含数据
router.get('/openapi.json', function (req, res) {
  res.json(buildOpenAPI(req));
});

module.exports = router;
