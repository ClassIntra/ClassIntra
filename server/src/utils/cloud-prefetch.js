/**
 * cloud-prefetch.js - 跨班内容引用的云盘文件预取
 *
 * 为什么需要它：cloud_files 元数据不进中继水位同步（relay-sync 只同步消息/帖子/用户等），
 * 文件二进制靠 Syncthing 落盘。同步延迟窗口内本机既无 DB 记录也无磁盘字节 →
 * 读路径 404 → 聊天图片被前端 onerror 渲染成「文件已删除」。
 * 所以凡是「内容里引用了对端才有的 hash」的场景，都要在内容落地的同时把字节取回来。
 *
 * 两个调用时机（缺一不可）：
 *   1. 实时中继到达时（relay-handlers）：消息刚到就后台拉取，用户点开时已在本地
 *   2. 离线补同步时（relay-sync）：断线期间攒下的消息走 catchup 落地，
 *      这条路径以前完全没做预取，是「跨班聊天久了图全挂」的重灾区
 */

var fs = require('fs');
var path = require('path');
var config = require('../config');
var cloudPeer = require('./cloud-peer');

// 内容里引用云盘文件的两种形态，必须都认：
//   ① 聊天消息的内联标签：  [cloud-img:<64hex>.jpg]  / [cloud-video:...] / [cloud-audio:...]
//   ② 社区帖子的 markdown： ![名称](/api/cloud/files/<64hex>.jpg?w=800)
// 旧实现只认 ②，于是「跨班发图必挂」——聊天里的图一条都没被预取过，
// 对端只有 hash 没有字节，读路径 404 把图片渲染成「文件已删除」。
var CLOUD_URL_PATTERN = /\/api\/cloud\/files\/([a-f0-9]{64})(?:\.\w+)?/g;
var CLOUD_TAG_PATTERN = /\[cloud-(?:img|video|audio|file):([a-f0-9]{64})(?:\.\w+)?\]/g;

function collectCloudHashes(content) {
  var hashes = [];
  [CLOUD_URL_PATTERN, CLOUD_TAG_PATTERN].forEach(function(pattern) {
    var re = new RegExp(pattern.source, 'g');
    var m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && hashes.indexOf(m[1]) === -1) hashes.push(m[1]);
    }
  });
  return hashes;
}

function sharedDirOf() {
  return path.join(path.resolve(config.resourcesDir, 'cloud'), 'shared');
}

// 本地是否已有可用字节（DB 记录 + 物理文件都在）
function hasLocalBytes(db, sharedDir, hash) {
  var row = db.prepare('SELECT hash, deleted, storage_path FROM cloud_files WHERE hash = ?').get(hash);
  if (!row) return false;
  // deleted=1 多半是「字节还没到就被访问」的误标（见 cloud-routes 的 serveCloudFile），
  // 回源成功后必须复位，否则这个文件在所有节点永久显示已删除。
  if (row.deleted) return false;
  if (!row.storage_path) return false;
  return fs.existsSync(path.join(sharedDir, row.storage_path));
}

// 扫描内容中的云盘引用，对本地缺失的文件从对端拉取。异步、不阻塞调用方。
function preFetchCloudFiles(content, sourceServerId) {
  if (!content || typeof content !== 'string') return;
  var hashes = collectCloudHashes(content);
  if (hashes.length === 0) return;

  var db = require('./db');
  var sharedDir = sharedDirOf();

  hashes.forEach(function(hash) {
    if (hasLocalBytes(db, sharedDir, hash)) return;

    cloudPeer.fetchFromPeers(hash).then(function(fetched) {
      if (!fetched) return;   // 所有对端都没有（已删/脏 hash），负缓存已记下，不再重试
      try {
        var fileHash = fetched.hash;
        var buffer = fetched.buffer;
        var ext = path.extname(fetched.name) || '.bin';
        var prefix = fileHash.substring(0, 2);
        var prefixDir = path.join(sharedDir, prefix);
        if (!fs.existsSync(prefixDir)) fs.mkdirSync(prefixDir, { recursive: true });
        var storagePath = prefix + '/' + fileHash + ext;
        var destPath = path.join(sharedDir, storagePath);

        // 幂等：并发预取可能同时落盘，写一次即可（内容按 hash 寻址，必然一致）
        if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, buffer);

        var existing = db.prepare('SELECT hash, deleted FROM cloud_files WHERE hash = ?').get(fileHash);
        if (!existing) {
          db.prepare('INSERT OR IGNORE INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)')
            .run(fileHash, '__relay__', fetched.name, buffer.length, fetched.mime, storagePath);
        } else if (existing.deleted) {
          // 复位误标的 deleted，否则该文件在所有节点永久返回「已删除」占位图
          db.prepare('UPDATE cloud_files SET deleted = 0 WHERE hash = ?').run(fileHash);
        }
        console.log('[CloudSync] 预取完成:', fileHash, '(' + (buffer.length / 1024).toFixed(1) + ' KB) from', sourceServerId || fetched.from);
      } catch (e) {
        console.error('[CloudSync] 保存失败:', hash, e.message);
      }
    });
  });
}

module.exports = {
  collectCloudHashes: collectCloudHashes,
  preFetchCloudFiles: preFetchCloudFiles
};
