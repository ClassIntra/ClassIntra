// 后端集成层：Token 存储与管理
// 参考 Ditto packages/integration/src/token-store.ts
//
// 设计要点：
// 1. HMAC-SHA256 签名：token（公开标识）+ secret（私钥，仅签发时返回一次）
// 2. TTL 机制：默认 30 天过期，支持提前 revoke
// 3. 权限范围：每个集成绑定 scopes 数组，控制可访问的 channel
// 4. origin 白名单：每个集成绑定 origins 数组，控制可嵌入的页面来源
// 5. 表结构：integrations（id, name, token, secret_hash, scopes_json, webhook_url, origins_json, active, created_at, expires_at）

var crypto = require('crypto');
var db = require('../utils/db');

// ========== 工具函数 ==========

// 生成随机 token（32 字节 hex）
function _generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 生成随机 secret（64 字节 hex）
function _generateSecret() {
  return crypto.randomBytes(64).toString('hex');
}

// 计算 secret 的 hash（存储 hash 而非明文，防止数据库泄露）
function _hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// 安全比较字符串（防时序攻击）
function _safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ========== 核心 API ==========

/**
 * 签发新集成 token
 * @param {string} name - 集成名称
 * @param {Object} options
 * @param {string[]} options.scopes - 权限范围
 * @param {string} [options.webhookUrl] - webhook 推送 URL
 * @param {string[]} [options.origins] - 允许的 origin 白名单
 * @param {number} [options.ttlDays] - 有效期天数（默认 30）
 * @returns {{ id, name, token, secret, scopes, webhookUrl, origins, expiresAt }}
 */
function issueToken(name, options) {
  if (!name) throw new Error('issueToken: name 必填');
  options = options || {};
  var scopes = Array.isArray(options.scopes) ? options.scopes : [];
  var origins = Array.isArray(options.origins) ? options.origins : [];
  var ttlDays = typeof options.ttlDays === 'number' ? options.ttlDays : 30;
  var webhookUrl = options.webhookUrl || '';

  var token = _generateToken();
  var secret = _generateSecret();
  var secretHash = _hashSecret(secret);
  var expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  var stmt = db.prepare(
    'INSERT INTO integrations (name, token, secret_hash, scopes_json, webhook_url, origins_json, active, created_at, expires_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, 1, datetime(\'now\'), ?)'
  );
  var info = stmt.run(name, token, secretHash, JSON.stringify(scopes), webhookUrl, JSON.stringify(origins), expiresAt);

  return {
    id: info.lastInsertRowid,
    name: name,
    token: token,
    secret: secret, // 仅签发时返回一次
    scopes: scopes,
    webhookUrl: webhookUrl,
    origins: origins,
    expiresAt: expiresAt
  };
}

/**
 * 验证 token（用于 webhook 接收）
 * @param {string} token - 待验证的 token
 * @returns {{ id, name, secret_hash, scopes, webhookUrl, origins } | null}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  var row = db.prepare('SELECT * FROM integrations WHERE token = ? AND active = 1').get(token);
  if (!row) return null;
  // 检查是否过期
  if (row.expires_at) {
    var expires = new Date(row.expires_at).getTime();
    if (Date.now() > expires) return null;
  }
  var scopes = [];
  var origins = [];
  try { scopes = JSON.parse(row.scopes_json || '[]'); } catch (e) {}
  try { origins = JSON.parse(row.origins_json || '[]'); } catch (e) {}
  return {
    id: row.id,
    name: row.name,
    secret_hash: row.secret_hash,
    scopes: scopes,
    webhookUrl: row.webhook_url,
    origins: origins,
    expiresAt: row.expires_at
  };
}

/**
 * 撤销 token
 * @param {number} id - 集成 id
 */
function revokeToken(id) {
  var result = db.prepare('UPDATE integrations SET active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 列出所有集成（管理员用，不含 secret）
 */
function listIntegrations() {
  var rows = db.prepare('SELECT id, name, token, scopes_json, webhook_url, origins_json, active, created_at, expires_at FROM integrations ORDER BY id DESC').all();
  return rows.map(function(r) {
    var scopes = []; var origins = [];
    try { scopes = JSON.parse(r.scopes_json || '[]'); } catch (e) {}
    try { origins = JSON.parse(r.origins_json || '[]'); } catch (e) {}
    return {
      id: r.id,
      name: r.name,
      token: r.token,
      scopes: scopes,
      webhookUrl: r.webhook_url,
      origins: origins,
      active: !!r.active,
      createdAt: r.created_at,
      expiresAt: r.expires_at
    };
  });
}

/**
 * 获取单个集成
 */
function getIntegration(id) {
  var row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  if (!row) return null;
  var scopes = []; var origins = [];
  try { scopes = JSON.parse(row.scopes_json || '[]'); } catch (e) {}
  try { origins = JSON.parse(row.origins_json || '[]'); } catch (e) {}
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    scopes: scopes,
    webhookUrl: row.webhook_url,
    origins: origins,
    active: !!row.active,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

/**
 * 更新集成
 */
function updateIntegration(id, fields) {
  var updates = [];
  var values = [];
  if (fields.name !== undefined) { updates.push('name = ?'); values.push(fields.name); }
  if (fields.scopes !== undefined) { updates.push('scopes_json = ?'); values.push(JSON.stringify(fields.scopes)); }
  if (fields.webhookUrl !== undefined) { updates.push('webhook_url = ?'); values.push(fields.webhookUrl); }
  if (fields.origins !== undefined) { updates.push('origins_json = ?'); values.push(JSON.stringify(fields.origins)); }
  if (fields.active !== undefined) { updates.push('active = ?'); values.push(fields.active ? 1 : 0); }
  if (updates.length === 0) return;
  values.push(id);
  db.prepare('UPDATE integrations SET ' + updates.join(', ') + ' WHERE id = ?').run.apply(db, values);
}

/**
 * 重新生成 secret（忘记旧 secret 时用）
 * @param {number} id - 集成 id
 * @returns {string} 新 secret（仅返回一次）
 */
function regenerateSecret(id) {
  var secret = _generateSecret();
  var secretHash = _hashSecret(secret);
  db.prepare('UPDATE integrations SET secret_hash = ? WHERE id = ?').run(secretHash, id);
  return secret;
}

/**
 * 验证 webhook 签名
 * @param {string} secretHash - 存储的 secret hash
 * @param {string} timestamp - 请求时间戳
 * @param {string} rawBody - 原始请求体
 * @param {string} signature - 待验证的签名（sha256=<hex>）
 * @returns {boolean}
 */
function verifyWebhookSignature(secretHash, timestamp, rawBody, signature) {
  if (!signature || typeof signature !== 'string') return false;
  // 签名格式：sha256=<hex>
  var prefix = 'sha256=';
  if (signature.indexOf(prefix) !== 0) return false;
  var providedHex = signature.slice(prefix.length);
  // 计算期望签名：HMAC-SHA256(secretHash, timestamp + '.' + rawBody)
  // 注意：secret_hash 本身作为 HMAC 密钥（不存储明文 secret）
  var expected = crypto.createHmac('sha256', secretHash).update(timestamp + '.' + rawBody).digest('hex');
  return _safeEqual(expected, providedHex);
}

module.exports = {
  issueToken: issueToken,
  verifyToken: verifyToken,
  revokeToken: revokeToken,
  listIntegrations: listIntegrations,
  getIntegration: getIntegration,
  updateIntegration: updateIntegration,
  regenerateSecret: regenerateSecret,
  verifyWebhookSignature: verifyWebhookSignature
};
