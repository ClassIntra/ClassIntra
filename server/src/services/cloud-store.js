// 云盘文件读取服务（跨应用共用）
//
// 背景：AI 对话要「从云盘选图发给视觉模型」，就得把用户云盘里的图片读成字节
// 再转成 data URL（上游拿不到我们带鉴权的 /api/cloud/files/:hash）。
// 云盘的物理存储与表结构归属 resource 应用（apps/resource/backend/cloud-routes.js），
// 这里只做「只读 + 归属校验」的最小抽象，避免别处再 copy 一遍路径拼接逻辑。
//
// 物理路径： <resourcesDir>/cloud/shared/<storage_path>
//   storage_path = "<hash前2位>/<hash><ext>"
//
// 授权语义（重要）：一个文件必须同时满足
//   1) cloud_files 里存在且未软删、状态不是 hidden
//   2) cloud_user_files 里有该用户的引用
// 只满足 1 的「别人上传但你没转存」的文件，一律不可读。

var path = require('path');
var fs = require('fs');
var config = require('../config');

function cloudRoot() {
  return path.join(config.resourcesDir, 'cloud');
}

function sharedRoot() {
  return path.join(cloudRoot(), 'shared');
}

// 取用户有权访问的文件元信息；无权/不存在返回 null
// 返回 { hash, name, mime, size, storagePath, absPath }
function getUserFile(hash, userId, db) {
  if (!hash || !userId) return null;
  if (!/^[a-f0-9]{64}$/.test(String(hash))) return null;
  var d = db || require('../utils/db');
  var stmt = d.prepare([
    'SELECT cf.hash, cf.size, cf.mime_type, cf.storage_path, cf.original_name,',
    '       cuf.display_name',
    'FROM cloud_user_files cuf',
    'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
    'WHERE cuf.user_id = ? AND cuf.file_hash = ? AND cf.deleted = 0',
    '  AND IFNULL(cf.status, \'ok\') != \'hidden\''
  ].join('\n'));
  var row;
  try {
    row = stmt.get(String(userId), String(hash));
  } catch (e) {
    return null;
  }
  if (!row || !row.storage_path) return null;

  // 防目录穿越：storage_path 只应是 "<2位hex>/<hash><ext>"
  if (row.storage_path.indexOf('..') !== -1 || row.storage_path.charAt(0) === '/' || row.storage_path.indexOf('\\') !== -1) {
    return null;
  }

  return {
    hash: row.hash,
    name: row.display_name || row.original_name || '图片',
    mime: row.mime_type || '',
    size: row.size || 0,
    storagePath: row.storage_path,
    absPath: path.join(sharedRoot(), row.storage_path)
  };
}

// 读取字节；超过 maxBytes 直接拒绝（调用方用它挡住几十 MB 的原图）
// 返回 { buffer, name, mime, size } 或 { error: '...' }
function readUserFile(hash, userId, maxBytes, db) {
  var info = getUserFile(hash, userId, db);
  if (!info) return { error: '文件不存在或无权访问' };
  if (!fs.existsSync(info.absPath)) return { error: '文件已丢失' };
  var limit = maxBytes && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024;
  var stat = fs.statSync(info.absPath);
  if (stat.size > limit) return { error: '图片过大（' + Math.round(stat.size / 1048576) + 'MB），请先在云盘压缩' };
  try {
    return { buffer: fs.readFileSync(info.absPath), name: info.name, mime: info.mime, size: stat.size, hash: info.hash };
  } catch (e) {
    return { error: '读取文件失败' };
  }
}

function isImageMime(mime) {
  var m = String(mime || '').toLowerCase().split(';')[0].trim();
  return m === 'image/jpeg' || m === 'image/jpg' || m === 'image/png' ||
         m === 'image/webp' || m === 'image/gif' || m === 'image/bmp';
}

// 转成上游可直接吃的 data URL；mime 缺失时按魔数兜底
function toImageDataUrl(buffer, mime) {
  var m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!isImageMime(m)) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) m = 'image/jpeg';
    else if (buffer[0] === 0x89 && buffer[1] === 0x50) m = 'image/png';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) m = 'image/gif';
    else if (buffer[0] === 0x52 && buffer[1] === 0x49) m = 'image/webp';
    else m = 'image/jpeg';
  }
  return 'data:' + m + ';base64,' + buffer.toString('base64');
}

module.exports = {
  cloudRoot: cloudRoot,
  sharedRoot: sharedRoot,
  getUserFile: getUserFile,
  readUserFile: readUserFile,
  isImageMime: isImageMime,
  toImageDataUrl: toImageDataUrl
};
