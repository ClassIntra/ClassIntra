// 应用级存储服务：KV + 对象存储
// ============================================================
// 给第三方应用一块「自己的地盘」，但不用直连共享 SQLite、也不用挤公共云盘。
//
// 隔离模型：
//   owner = 用户 id  → 每个人的私有数据（默认，HTTP 只能读写自己的）
//   owner = '*'      → 应用级共享数据（只允许应用后端经本服务写入；HTTP 只读）
//
// 限额（防止单个应用把班级服务器写爆）：
//   - 单值 ≤ 64KB，单用户每应用 ≤ 500 个键
//   - 单个文件 ≤ 5MB，单用户每应用 ≤ 50 个文件
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var config = require('../config');

var MAX_VALUE_BYTES = 64 * 1024;
var MAX_KEYS = 500;
var MAX_BLOB_BYTES = 5 * 1024 * 1024;
var MAX_BLOBS = 50;

var SHARED_OWNER = '*';
var KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
var BLOB_NAME_RE = /^[A-Za-z0-9_.\- ]{1,80}$/;

var blobRoot = path.join(config.resourcesDir, 'app-data');

function db() {
  return require('../utils/db');
}

function isValidAppName(name) {
  return /^[a-z][a-z0-9-]{1,63}$/.test(String(name || ''));
}

function isValidKey(key) {
  return KEY_RE.test(String(key || ''));
}

function isValidBlobName(name) {
  return BLOB_NAME_RE.test(String(name || ''));
}

function normalizeOwner(userId) {
  var owner = String(userId || '').trim();
  if (!owner) throw new Error('缺少数据归属（owner）');
  return owner;
}

// 读：JSON 优先，失败按字符串返回
function readValue(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch (e) { return raw; }
}

function get(appName, owner, key) {
  if (!isValidKey(key)) throw new Error('键名非法（字母/数字/下划线/点/冒号/短横，1-128）');
  var row = db().prepare('SELECT value FROM app_data WHERE app_name = ? AND owner = ? AND data_key = ?')
    .get(appName, normalizeOwner(owner), String(key));
  return row ? readValue(row.value) : null;
}

function set(appName, owner, key, value) {
  if (!isValidKey(key)) throw new Error('键名非法（字母/数字/下划线/点/冒号/短横，1-128）');
  var own = normalizeOwner(owner);
  var raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(raw, 'utf8') > MAX_VALUE_BYTES) {
    throw new Error('单个键的值超过 64KB 上限');
  }
  var exists = db().prepare('SELECT 1 FROM app_data WHERE app_name = ? AND owner = ? AND data_key = ?')
    .get(appName, own, String(key));
  if (!exists) {
    var count = db().prepare('SELECT COUNT(*) AS c FROM app_data WHERE app_name = ? AND owner = ?').get(appName, own).c;
    if (count >= MAX_KEYS) throw new Error('每个应用每人最多 ' + MAX_KEYS + ' 个键，请先清理');
  }
  db().prepare(
    'INSERT INTO app_data (app_name, owner, data_key, value, updated_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(app_name, owner, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(appName, own, String(key), raw, Date.now());
  return true;
}

function remove(appName, owner, key) {
  var info = db().prepare('DELETE FROM app_data WHERE app_name = ? AND owner = ? AND data_key = ?')
    .run(appName, normalizeOwner(owner), String(key));
  return info.changes > 0;
}

function listKeys(appName, owner) {
  var rows = db().prepare('SELECT data_key, updated_at FROM app_data WHERE app_name = ? AND owner = ? ORDER BY data_key')
    .all(appName, normalizeOwner(owner));
  return rows.map(function (r) { return { key: r.data_key, updatedAt: r.updated_at }; });
}

// 一次性取回全部（限制总量，避免前端逐 key 请求）
function getAll(appName, owner) {
  var rows = db().prepare('SELECT data_key, value, updated_at FROM app_data WHERE app_name = ? AND owner = ? ORDER BY data_key')
    .all(appName, normalizeOwner(owner));
  var out = {};
  for (var i = 0; i < rows.length; i++) out[rows[i].data_key] = readValue(rows[i].value);
  return out;
}

// ========== 对象存储 ==========

function blobId(appName, owner, name) {
  return crypto.createHash('sha256').update(appName + '|' + owner + '|' + name).digest('hex').slice(0, 32);
}

function blobDir(appName, owner) {
  // owner 可能是外部传入的用户 id，做一次安全化（不允许路径分隔符）
  var safeOwner = String(owner).replace(/[^A-Za-z0-9_.@-]/g, '_');
  return path.join(blobRoot, appName, safeOwner);
}

function putBlob(appName, owner, name, buffer, mime) {
  var own = normalizeOwner(owner);
  if (!isValidBlobName(name)) throw new Error('文件名非法（字母/数字/下划线/点/短横/空格，1-80）');
  if (!buffer || !buffer.length) throw new Error('文件内容为空');
  if (buffer.length > MAX_BLOB_BYTES) throw new Error('单个文件超过 5MB 上限');

  var existing = db().prepare('SELECT COUNT(*) AS c FROM app_blobs WHERE app_name = ? AND owner = ?').get(appName, own).c;
  var hit = db().prepare('SELECT id FROM app_blobs WHERE app_name = ? AND owner = ? AND name = ?').get(appName, own, name);
  if (!hit && existing >= MAX_BLOBS) throw new Error('每个应用每人最多 ' + MAX_BLOBS + ' 个文件，请先删除');

  var id = blobId(appName, own, name);
  var dir = blobDir(appName, own);
  fs.mkdirSync(dir, { recursive: true });
  var rel = path.join('app-data', appName, String(own).replace(/[^A-Za-z0-9_.@-]/g, '_'), id);
  fs.writeFileSync(path.join(config.resourcesDir, rel), buffer);

  db().prepare(
    'INSERT INTO app_blobs (id, app_name, owner, name, mime, size, rel_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, size = excluded.size, created_at = excluded.created_at'
  ).run(id, appName, own, name, String(mime || 'application/octet-stream'), buffer.length, rel, Date.now());

  return { id: id, name: name, size: buffer.length, mime: String(mime || 'application/octet-stream') };
}

function getBlobMeta(appName, owner, name) {
  return db().prepare('SELECT * FROM app_blobs WHERE app_name = ? AND owner = ? AND name = ?')
    .get(appName, normalizeOwner(owner), String(name)) || null;
}

function listBlobs(appName, owner) {
  return db().prepare('SELECT id, name, mime, size, created_at FROM app_blobs WHERE app_name = ? AND owner = ? ORDER BY created_at DESC')
    .all(appName, normalizeOwner(owner));
}

function deleteBlob(appName, owner, name) {
  var own = normalizeOwner(owner);
  var meta = getBlobMeta(appName, own, name);
  if (!meta) return false;
  try { fs.unlinkSync(path.join(config.resourcesDir, meta.rel_path)); } catch (e) {}
  db().prepare('DELETE FROM app_blobs WHERE id = ?').run(meta.id);
  return true;
}

function blobPath(meta) {
  return path.join(config.resourcesDir, meta.rel_path);
}

// ========== 用量与清理 ==========
// 卸载默认不清数据（用户可能重装）；应用可在 cleanup.js 里调 purge()，
// 部署者也可用 MARKET_PURGE_APP_DATA_ON_UNINSTALL=1 强制清干净。

function usage(appName) {
  var out = { appName: appName, keys: 0, blobs: 0, blobBytes: 0 };
  try {
    var d = db();
    out.keys = d.prepare('SELECT COUNT(*) AS c FROM app_data WHERE app_name = ?').get(appName).c;
    var b = d.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS bytes FROM app_blobs WHERE app_name = ?').get(appName);
    out.blobs = b.c || 0;
    out.blobBytes = b.bytes || 0;
  } catch (e) {}
  return out;
}

function purgeApp(appName) {
  var removed = { keys: 0, blobs: 0 };
  try {
    var d = db();
    removed.keys = d.prepare('DELETE FROM app_data WHERE app_name = ?').run(appName).changes;
    removed.blobs = d.prepare('DELETE FROM app_blobs WHERE app_name = ?').run(appName).changes;
  } catch (e) {}
  try {
    fs.rmSync(path.join(blobRoot, appName), { recursive: true, force: true });
  } catch (e) {}
  return removed;
}

module.exports = {
  SHARED_OWNER: SHARED_OWNER,
  LIMITS: { MAX_VALUE_BYTES: MAX_VALUE_BYTES, MAX_KEYS: MAX_KEYS, MAX_BLOB_BYTES: MAX_BLOB_BYTES, MAX_BLOBS: MAX_BLOBS },
  isValidAppName: isValidAppName,
  isValidKey: isValidKey,
  isValidBlobName: isValidBlobName,
  get: get,
  set: set,
  remove: remove,
  listKeys: listKeys,
  getAll: getAll,
  putBlob: putBlob,
  getBlobMeta: getBlobMeta,
  listBlobs: listBlobs,
  deleteBlob: deleteBlob,
  blobPath: blobPath,
  usage: usage,
  purgeApp: purgeApp
};
