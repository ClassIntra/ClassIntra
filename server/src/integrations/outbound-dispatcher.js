// 后端集成层：Outbound Dispatcher（外部推送器）
// 参考 Ditto packages/integration/src/outbound-dispatcher.ts
//
// 设计要点：
// 1. ClassIntra 内部事件 → 推送到订阅了该事件的集成的 webhook_url
// 2. 每个请求附带 HMAC 签名 + token + timestamp
// 3. 异步推送，不阻塞主流程
// 4. 失败记录日志，本期不实现重试（预留 retryCount 字段）
// 5. 复用 token-store 的集成列表

var crypto = require('crypto');
var tokenStore = require('./token-store');
var db = require('../utils/db');

// 内置事件 → scope 映射
var EVENT_SCOPE_MAP = {
  'user.signed_in': 'user:read',
  'user.signed_out': 'user:read',
  'message.received': 'message:read',
  'announcement.published': 'notification:write',
  'countdown.reached': 'countdown:read',
  'calendar.event_created': 'calendar:read'
};

/**
 * 向所有订阅了该事件的集成推送 webhook
 * @param {string} event - 事件类型（如 'user.signed_out'）
 * @param {Object} data - 事件数据
 * @param {Object} [options] - 可选参数
 * @param {string[]} [options.excludeIntegrationIds] - 排除的集成 id 列表
 */
function dispatch(event, data, options) {
  options = options || {};
  var excludeIds = options.excludeIntegrationIds || [];

  // 查询所有活跃且有 webhook_url 的集成
  var integrations = _getActiveIntegrationsWithWebhook();
  var requiredScope = EVENT_SCOPE_MAP[event];

  var pending = [];
  for (var i = 0; i < integrations.length; i++) {
    var it = integrations[i];
    // 排除指定集成
    if (excludeIds.indexOf(String(it.id)) !== -1) continue;
    // 检查 scope（如果事件有对应 scope 要求）
    if (requiredScope && it.scopes.indexOf(requiredScope) === -1) continue;
    pending.push(_deliver(it, event, data));
  }

  // 异步并行推送
  if (pending.length > 0) {
    Promise.allSettled ? Promise.allSettled(pending) : Promise.all(pending.map(function(p) {
      return p.then(function(v) { return { status: 'fulfilled', value: v }; }, function(e) { return { status: 'rejected', reason: e }; });
    })).then(function(results) {
      _logResults(event, results);
    });
  }
}

/**
 * 查询所有活跃且有 webhook_url 的集成
 */
function _getActiveIntegrationsWithWebhook() {
  try {
    var rows = db.prepare(
      "SELECT id, name, token, secret_hash, scopes_json, webhook_url FROM integrations WHERE active = 1 AND webhook_url != ''"
    ).all();
    return rows.map(function(r) {
      var scopes = [];
      try { scopes = JSON.parse(r.scopes_json || '[]'); } catch (e) {}
      return {
        id: r.id,
        name: r.name,
        token: r.token,
        secret_hash: r.secret_hash,
        scopes: scopes,
        webhookUrl: r.webhook_url
      };
    });
  } catch (e) {
    console.error('[outbound-dispatcher] 查询集成失败:', e.message);
    return [];
  }
}

/**
 * 向单个集成推送 webhook
 */
function _deliver(integration, event, data) {
  var timestamp = String(Date.now());
  var body = JSON.stringify({
    event: event,
    data: data,
    timestamp: timestamp,
    source: 'classintra'
  });

  // 计算 HMAC 签名（用 secret_hash 作为密钥）
  var signature = 'sha256=' + crypto.createHmac('sha256', integration.secret_hash).update(timestamp + '.' + body).digest('hex');

  var headers = {
    'Content-Type': 'application/json',
    'X-ClassIntra-Token': integration.token,
    'X-ClassIntra-Signature': signature,
    'X-ClassIntra-Timestamp': timestamp,
    'X-ClassIntra-Event': event
  };

  // 用 fetch（Node 18+）或 http 模块
  return _postJson(integration.webhookUrl, body, headers, integration.id);
}

/**
 * 发送 POST 请求（兼容 Node 18+ fetch 和旧版 http 模块）
 */
function _postJson(url, body, headers, integrationId) {
  if (typeof fetch === 'function') {
    // Node 18+ 内置 fetch
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    }).then(function(res) {
      if (!res.ok) {
        console.warn('[outbound-dispatcher] webhook 推送失败 integration=' + integrationId + ' status=' + res.status);
      }
      return { ok: res.ok, status: res.status };
    }).catch(function(err) {
      console.warn('[outbound-dispatcher] webhook 推送异常 integration=' + integrationId + ':', err.message);
      return { ok: false, error: err.message };
    });
  }

  // 旧版 Node 用 http/https 模块
  return new Promise(function(resolve) {
    try {
      var parsed = new URL(url);
      var lib = parsed.protocol === 'https:' ? require('https') : require('http');
      var req = lib.request(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers)
      }, function(res) {
        res.on('end', function() {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.warn('[outbound-dispatcher] webhook 推送失败 integration=' + integrationId + ' status=' + res.statusCode);
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
        });
      });
      req.on('error', function(err) {
        console.warn('[outbound-dispatcher] webhook 推送异常 integration=' + integrationId + ':', err.message);
        resolve({ ok: false, error: err.message });
      });
      req.write(body);
      req.end();
    } catch (e) {
      console.warn('[outbound-dispatcher] URL 解析失败 integration=' + integrationId + ':', e.message);
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * 记录推送结果
 */
function _logResults(event, results) {
  var fulfilled = 0;
  var rejected = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value && results[i].value.ok) {
      fulfilled++;
    } else {
      rejected++;
    }
  }
  if (rejected > 0) {
    console.warn('[outbound-dispatcher] event="' + event + '" 推送完成: ' + fulfilled + ' 成功, ' + rejected + ' 失败');
  }
}

module.exports = {
  dispatch: dispatch,
  EVENT_SCOPE_MAP: EVENT_SCOPE_MAP
};
