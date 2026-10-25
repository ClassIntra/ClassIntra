var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var multer = require('multer');
var auth = require('../../../server/src/middleware/auth');
var db = require('../../../server/src/utils/db');
var transcoder = require('../../../server/src/services/stream-transcoder');
var botTransfer = require('./bot-transfer');
var http = require('http');
var config = require('../../../server/src/config');

// 图片实时缩放（可选依赖，未安装时回退到原图）
var sharp = null;
try { sharp = require('sharp'); } catch (e) { /* sharp 未安装 */ }

// 云盘根目录
var cloudDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'), 'cloud');
var sharedDir = path.join(cloudDir, 'shared');
var tmpDir = path.join(cloudDir, '.tmp');
var trashDir = path.join(cloudDir, '.trash');

// 图片缩放内存缓存（LRU 简单实现，最多 200 条，自动清理）
var resizeCache = new Map();
var RESIZE_CACHE_MAX = 200;

function getCachedResize(cacheKey) {
  var entry = resizeCache.get(cacheKey);
  if (!entry) return null;
  // 更新访问时间（LRU）
  resizeCache.delete(cacheKey);
  resizeCache.set(cacheKey, entry);
  return entry.data;
}

function setCachedResize(cacheKey, data) {
  if (resizeCache.size >= RESIZE_CACHE_MAX) {
    // 删除最旧的条目
    var oldestKey = resizeCache.keys().next().value;
    resizeCache.delete(oldestKey);
  }
  resizeCache.set(cacheKey, { data: data, time: Date.now() });
}

// If-None-Match 精确匹配（支持逗号分隔的多 etag 列表与 W/ 弱比较）。
// express 的自动条件请求只走 res.send，流式/手动 send 的响应必须自己判。
function etagFresh(req, etag) {
  if (!etag) return false;
  var inm = req.headers['if-none-match'];
  if (!inm) return false;
  if (inm.trim() === '*') return true;
  var list = inm.split(',');
  for (var i = 0; i < list.length; i++) {
    if (list[i].trim() === etag) return true;
  }
  return false;
}

// 需要转码为 mp4 的视频扩展名（mp4 本身跳过）
var TRANSCODE_EXTS = ['.mov', '.mkv', '.avi', '.webm', '.3gp'];

// 媒体文件 MIME 类型映射
var MEDIA_MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.txt': 'text/plain', '.md': 'text/plain', '.log': 'text/plain',
  '.xml': 'text/plain', '.yml': 'text/plain',
  '.json': 'application/json', '.csv': 'text/csv'
};

// MIME → 扩展名：手机相册/网盘导出的文件常无扩展名（如 Image_1787579382045_5529），
// 此时以浏览器报告的 MIME 类型为准
var EXT_FROM_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/bmp': '.bmp',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg',
  'audio/opus': '.opus', 'audio/webm': '.webm',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/x-matroska': '.mkv', 'video/msvideo': '.avi', 'video/x-msvideo': '.avi',
  'video/3gpp': '.3gp',
  'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
  'text/xml': '.xml', 'application/json': '.json',
  'application/x-yaml': '.yml'
};

// 文本类扩展名：允许上传并支持在线查看（注意：绝不放行 .html/.svg/.js 等可执行格式，防同源 XSS）
var TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yml'];

// 安全黑名单：能在浏览器同源执行的格式一律拒绝上传
var BLOCKED_EXTS = ['.html', '.htm', '.svg', '.js', '.mjs', '.xhtml', '.xsl', '.xslt'];
var BLOCKED_MIMES = ['text/html', 'text/javascript', 'application/javascript', 'application/x-javascript', 'image/svg+xml', 'application/xhtml+xml'];

function resolveUploadExt(originalname, mimetype) {
  var ext = path.extname(originalname || '').toLowerCase();
  if (BLOCKED_EXTS.indexOf(ext) !== -1) return null;
  var allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
                 '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus',
                 '.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'].concat(TEXT_EXTS);
  if (allowed.indexOf(ext) !== -1) return ext;
  var mime = (mimetype || '').toLowerCase().split(';')[0].trim();
  if (BLOCKED_MIMES.indexOf(mime) !== -1) return null;
  if (EXT_FROM_MIME[mime]) return EXT_FROM_MIME[mime];
  var mime = (mimetype || '').toLowerCase().split(';')[0].trim();
  if (EXT_FROM_MIME[mime]) return EXT_FROM_MIME[mime];
  if (mime.indexOf('image/') === 0) return '.jpg';
  if (mime.indexOf('audio/') === 0) return '.mp3';
  if (mime.indexOf('video/') === 0) return '.mp4';
  return null;
}

// 魔数嗅探：扩展名与 MIME 都缺失时（安卓相册/缓存导出常见），读文件头判断真实类型
function sniffMediaExt(filePath) {
  var fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    var buf = Buffer.alloc(512);
    var n = fs.readSync(fd, buf, 0, 512, 0);
    if (n < 4) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
    if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return '.mp3';
    if (buf[0] === 0xFF && (buf[1] === 0xFB || buf[1] === 0xF3 || buf[1] === 0xF2)) return '.mp3';
    if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return '.ogg';
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return '.webm';
    var fourCC = buf.toString('ascii', 0, 4);
    if (fourCC === 'RIFF') {
      var sub = buf.toString('ascii', 8, 12);
      if (sub === 'WEBP') return '.webp';
      if (sub === 'WAVE') return '.wav';
    }
    if (buf.toString('ascii', 4, 8) === 'ftyp') {
      var brand = buf.toString('ascii', 8, 12);
      if (brand.indexOf('qt') === 0) return '.mov';
      if (brand.indexOf('M4A') === 0) return '.m4a';
      return '.mp4';
    }
    // 文本兜底：前 512 字节不含 0x00 即视为文本（UTF-8/GBK 均无 0x00，二进制格式头部几乎必含）
    var hasNul = false;
    for (var i = 0; i < n; i++) {
      if (buf[i] === 0) { hasNul = true; break; }
    }
    if (!hasNul) return '.txt';
    return null;
  } catch (e) {
    return null;
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (e2) { /* ignore */ }
  }
}

// 上传落盘后的兜底：扩展名与 MIME 都不可用时嗅探文件头并重命名临时文件
// 返回 true = 可用；false = 无法识别为媒体（调用方应 400 并清理临时文件）
function finalizeUploadExt(file) {
  if (resolveUploadExt(file.originalname, file.mimetype)) return true;
  var sniffed = sniffMediaExt(file.path);
  if (!sniffed) return false;
  var newPath = file.path.substring(0, file.path.length - path.extname(file.path).length) + sniffed;
  try {
    fs.renameSync(file.path, newPath);
    file.path = newPath;
    return true;
  } catch (e) {
    return false;
  }
}

// ========== 文件服务 ==========

// 流式发送媒体文件，支持 Range 请求（视频/音频播放必需）
function sendMediaFile(req, res, filePath) {
  var stat;
  try { stat = fs.statSync(filePath); } catch (e) { return false; }

  var ext = path.extname(filePath).toLowerCase();
  var mimeType = MEDIA_MIME[ext] || 'application/octet-stream';
  var isVideo = mimeType.indexOf('video/') === 0;
  var isAudio = mimeType.indexOf('audio/') === 0;
  var etag = 'W/"' + path.basename(filePath) + '-' + stat.mtimeMs + '-' + stat.size + '"';

  // 覆盖全局 no-cache：媒体文件允许浏览器缓存和缓冲。
  // 文件 URL 是内容寻址的（hash = sha256），同 hash 内容永不改变，过期后靠 ETag
  // 做 304 协商即可 —— 弱网平板上反复进出页面不必重下同一张头像/封面。
  // 下载模式（?download=1）是附件语义：浏览器不当展示资源缓存，直接 no-store。
  //
  // ⚠️ Pragma/Expires 必须一起摘掉：全局中间件给所有响应加了 `Pragma: no-cache`，
  //    浏览器（及中间代理）会拿它当 HTTP/1.0 的 no-cache 用，max-age 再长也白搭 ——
  //    表现为"每次进页面头像封面全部重下"。
  res.set('Content-Type', mimeType);
  res.set('Accept-Ranges', 'bytes');
  res.set('ETag', etag);
  res.removeHeader('Pragma');
  res.removeHeader('Expires');
  if (req.query.download === '1') {
    res.set('Cache-Control', 'no-store');
  } else {
    res.set('Cache-Control', 'public, max-age=86400');
    // 手动 304：本函数是流式响应，不过 express 的 res.send，
    // 它的自动条件请求逻辑在这里不生效，必须自己判 If-None-Match
    if (etagFresh(req, etag)) {
      res.removeHeader('Content-Type');
      res.status(304).end();
      return true;
    }
  }

  // 处理 Range 请求（视频/音频必需，浏览器用 206 分段加载实现 seek 和缓冲）
  var rangeHeader = req.get('Range');
  if (rangeHeader && (isVideo || isAudio)) {
    var parts = rangeHeader.replace(/bytes=/, '').split('-');
    var start = parseInt(parts[0], 10) || 0;
    var end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    var chunkSize = end - start + 1;
    if (start >= stat.size) {
      res.status(416).set('Content-Range', 'bytes */' + stat.size).end();
      return true;
    }
    res.status(206);
    res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size);
    res.set('Content-Length', chunkSize);
    fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
  } else {
    res.set('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}

// 扫描磁盘查找通过 Syncthing 同步来的文件（数据库中无记录）
function findSyncedFile(fileHash) {
  var prefix = fileHash.substring(0, 2);
  var dirPath = path.join(sharedDir, prefix);
  if (!fs.existsSync(dirPath)) return null;
  try {
    var files = fs.readdirSync(dirPath);
    for (var i = 0; i < files.length; i++) {
      if (files[i].indexOf(fileHash) === 0) {
        var ext = path.extname(files[i]).toLowerCase();
        var storagePath = prefix + '/' + files[i];
        var fullPath = path.join(sharedDir, storagePath);
        var stat = fs.statSync(fullPath);
        var mimeType = guessMimeType(ext, files[i]);
        // 自动注册到数据库，owner 标记为 __sync__（INSERT OR IGNORE 防并发冲突）
        db.prepare(
          'INSERT OR IGNORE INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(fileHash, '__sync__', files[i], stat.size, mimeType, storagePath);
        return { storage_path: storagePath, deleted: 0, mime_type: mimeType, size: stat.size, original_name: files[i] };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ============ CC 按需回源（读路径跨节点兜底）============
// 背景：cloud_files 元数据不走中继水位同步（relay-sync 只同步消息/帖子/用户等），
// 文件二进制靠 Syncthing 落盘。同步延迟窗口内本地既无 DB 记录、磁盘也没有
// （findSyncedFile 未命中）→ 读路径 404 → 头像/封面短暂回落成文字兜底，
// 要等 Syncthing 追上才恢复（刷新即好）。
// app.js 的 botMediaFallback 已对 botmedia 做了同一思路的回源；这里补云盘：
// 404 时按需向 peer 的 /api/cloud/peer-fetch/:hash 拉取，sha256 验证后落盘
// + 补记 cloud_files，再走本地服务路径，后续请求直接命中。
//
// 防护：
//   - single-flight：同一 hash 的并发请求合并成一次回源，其余等它落盘后本地读
//   - 负缓存 60s：文件哪台都没有时（已删/脏 hash），不打爆对端
//   - 256MB 上限 + 流式写 .tmp 再改名：大文件不进内存，半途失败不留残file
//   - 哈希校验：peer-fetch 是可信内网通道，但仍防传输损坏/错文件落盘
var peerBackfillInflight = {};   // hash → Promise（single-flight）
var peerBackfillMiss = {};       // hash → ts（负缓存）
var PEER_BACKFILL_MISS_TTL = 60 * 1000;
var PEER_BACKFILL_MAX_SIZE = 256 * 1024 * 1024;
// 原图回源最多让读请求等这么久：等不到就先 404（前端文字兜底），回源转后台继续。
// 两节点链路慢到 1~4KB/s，不能让一个头像请求把连接挂死几十秒。
var PEER_BACKFILL_GRACE_MS = parseInt(process.env.PEER_BACKFILL_GRACE_MS, 10) || 2500;

// 对端 HTTP 基址：优先 PEER_MEDIA_BASES（与 app.js botMediaFallback 同名同语义，
// 联调时可显式指定），否则从中继 RELAY_SERVERS 的 ws://host:port 推导
// http://host:<本服务端口>（生产两端同为 9001，与 relay-handlers 的推导一致）。
function peerBackfillBases() {
  var bases = [];
  var env = String(process.env.PEER_MEDIA_BASES || '').trim();
  if (env) {
    env.split(',').forEach(function(x) {
      x = x.trim().replace(/\/+$/, '');
      if (x && bases.indexOf(x) === -1) bases.push(x);
    });
  }
  if (!bases.length) {
    var servers = (config.relay && config.relay.servers) || [];
    for (var i = 0; i < servers.length; i++) {
      try {
        var u = new URL(servers[i]);
        var b = 'http://' + u.hostname + ':' + (config.port || 9001);
        if (bases.indexOf(b) === -1) bases.push(b);
      } catch (e) { /* 忽略非法 URL */ }
    }
  }
  return bases;
}

// 从单个 peer 拉取文件：流式落 .tmp → 验 sha256 → 进 shared/ → 补记 cloud_files。
// 成功 resolve { storage_path, mime_type, original_name }，失败 reject（调用方换下一个 peer）。
function fetchCloudFileFromPeer(base, fileHash) {
  return new Promise(function(resolve, reject) {
    var req = http.get(base + '/api/cloud/peer-fetch/' + fileHash, {
      headers: { 'X-Relay-Secret': (config.relay && config.relay.secret) || '' },
      timeout: 30000
    }, function(resp) {
      if (resp.statusCode !== 200) {
        resp.resume();
        return reject(new Error('HTTP ' + resp.statusCode));
      }
      var declared = parseInt(resp.headers['content-length'], 10) || 0;
      if (declared > PEER_BACKFILL_MAX_SIZE) {
        resp.resume();
        return reject(new Error('file too large (' + declared + ')'));
      }
      var fileName = '';
      try { fileName = decodeURIComponent(resp.headers['x-file-name'] || ''); } catch (e) { /* 脏文件名不阻塞回源 */ }
      var mimeType = resp.headers['x-file-mime'] || 'application/octet-stream';
      var hasher = crypto.createHash('sha256');
      var received = 0;
      ensureDir(tmpDir);
      var tmpPath = path.join(tmpDir, 'backfill-' + fileHash + '-' + Date.now() + '.part');
      var out = fs.createWriteStream(tmpPath);
      var settled = false;
      function fail(e) {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch (e2) {}
        try { fs.unlinkSync(tmpPath); } catch (e2) {}
        reject(e);
      }
      resp.on('data', function(chunk) {
        if (settled) return;
        received += chunk.length;
        if (received > PEER_BACKFILL_MAX_SIZE) {
          fail(new Error('file too large'));
          resp.destroy();
          return;
        }
        hasher.update(chunk);
      });
      resp.on('error', fail);
      out.on('error', fail);
      out.on('finish', function() {
        if (settled) return;
        settled = true;
        if (hasher.digest('hex') !== fileHash) {
          try { fs.unlinkSync(tmpPath); } catch (e) {}
          return reject(new Error('hash mismatch'));
        }
        try {
          var ext = path.extname(fileName) || '.bin';
          var prefix = fileHash.substring(0, 2);
          ensureDir(path.join(sharedDir, prefix));
          var storagePath = prefix + '/' + fileHash + ext;
          fs.renameSync(tmpPath, path.join(sharedDir, storagePath));
          // owner 标记 __relay__（与 preFetchCloudFiles 一致）；INSERT OR IGNORE 防竞态
          db.prepare('INSERT OR IGNORE INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)')
            .run(fileHash, '__relay__', fileName || fileHash, received, mimeType, storagePath);
          resolve({ storage_path: storagePath, mime_type: mimeType, original_name: fileName || fileHash });
        } catch (e) { fail(e); }
      });
      resp.pipe(out);
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('timeout')); });
  });
}

// 按需回源入口：single-flight + 负缓存 + 逐 peer 尝试。
// 永远 resolve（成功给记录，失败给 null），不 reject —— 调用方只关心「有没有拿到」。
function backfillFromPeers(fileHash) {
  if (peerBackfillInflight[fileHash]) return peerBackfillInflight[fileHash];
  var missAt = peerBackfillMiss[fileHash];
  if (missAt && Date.now() - missAt < PEER_BACKFILL_MISS_TTL) return Promise.resolve(null);
  var bases = peerBackfillBases();
  if (!bases.length) return Promise.resolve(null);
  var p = new Promise(function(resolve) {
    var idx = 0;
    (function tryNext() {
      if (idx >= bases.length) {
        // 所有 peer 都没有 → 负缓存，期间同类请求直接 404，不再打对端
        peerBackfillMiss[fileHash] = Date.now();
        if (Object.keys(peerBackfillMiss).length > 1000) {
          var now = Date.now();
          for (var k in peerBackfillMiss) {
            if (now - peerBackfillMiss[k] > PEER_BACKFILL_MISS_TTL) delete peerBackfillMiss[k];
          }
        }
        return resolve(null);
      }
      var base = bases[idx++];
      fetchCloudFileFromPeer(base, fileHash).then(function(rec) {
        delete peerBackfillMiss[fileHash];
        console.log('[CloudSync] 按需回源成功:', fileHash, '←', base);
        resolve(rec);
      }).catch(function(e) {
        console.warn('[CloudSync] 按需回源未命中:', fileHash, '←', base, '-', e.message);
        tryNext();
      });
    })();
  });
  p.then(function() { delete peerBackfillInflight[fileHash]; }, function() { delete peerBackfillInflight[fileHash]; });
  p.catch(function() {}); // 双保险：内部不 reject，防漏接导致 unhandledRejection
  peerBackfillInflight[fileHash] = p;
  return p;
}

// ============ 缩略图回源（慢链路上真正可用的那条路）============
// 背景：两节点间实测 1~4KB/s（RTT 400ms、丢包 20%，LAN 的 TCP 还被防火墙挡死），
// 拉几 MB 原图要几十分钟 —— 同步窗口内头像/封面必然回落成文字兜底。
// 但前端请求头像/封面都带 ?w=48/96/...，真正需要的只是几 KB 的缩略图：
// 让对端缩放后回传，1~2 秒即可到位。缩略图只进内存缓存，**绝不写进 shared/**
// （shared 是内容寻址的原图区，写进去会被当成原图，sha256 也对不上）。
var peerThumbCache = new Map();    // hash_w<w> → { data, mime }
var peerThumbInflight = {};        // hash_w<w> → Promise（single-flight）
var peerThumbMiss = {};            // hash_w<w> → ts（负缓存）
var PEER_THUMB_MAX_SIZE = 1024 * 1024;
var PEER_THUMB_CACHE_MAX = 200;
var PEER_THUMB_MISS_TTL = 60 * 1000;

function getPeerThumb(key) {
  var entry = peerThumbCache.get(key);
  if (!entry) return null;
  peerThumbCache.delete(key);      // LRU：命中后移到最新
  peerThumbCache.set(key, entry);
  return entry;
}

function setPeerThumb(key, entry) {
  if (peerThumbCache.size >= PEER_THUMB_CACHE_MAX) {
    peerThumbCache.delete(peerThumbCache.keys().next().value);
  }
  peerThumbCache.set(key, entry);
}

// 从单个 peer 拉缩略图：整块进内存（已限 1MB），失败 resolve(null) 不 reject。
function fetchThumbFromPeer(base, fileHash, width) {
  return new Promise(function(resolve) {
    var done = false;
    function finish(v) { if (!done) { done = true; resolve(v); } }
    var req = http.get(base + '/api/cloud/peer-fetch/' + fileHash + '?w=' + width, {
      headers: { 'X-Relay-Secret': (config.relay && config.relay.secret) || '' },
      timeout: 30000
    }, function(resp) {
      if (resp.statusCode !== 200) { resp.resume(); return finish(null); }
      var declared = parseInt(resp.headers['content-length'], 10) || 0;
      if (declared > PEER_THUMB_MAX_SIZE) { resp.destroy(); return finish(null); }
      var chunks = [];
      var received = 0;
      resp.on('data', function(c) {
        received += c.length;
        if (received > PEER_THUMB_MAX_SIZE) { resp.destroy(); return finish(null); }
        chunks.push(c);
      });
      resp.on('end', function() {
        if (!chunks.length) return finish(null);
        finish({ data: Buffer.concat(chunks), mime: resp.headers['x-file-mime'] || 'application/octet-stream' });
      });
      resp.on('error', function() { finish(null); });
    });
    req.on('error', function() { finish(null); });
    req.on('timeout', function() { req.destroy(); finish(null); });
  });
}

// 缩略图回源入口：single-flight + 负缓存 + 逐 peer 尝试。
function backfillThumbFromPeers(fileHash, width) {
  var key = fileHash + '_w' + width;
  var cached = getPeerThumb(key);
  // 命中内存缓存：标记 cached，调用方据此不再打 X-Backfilled（本次没走网络）
  if (cached) return Promise.resolve({ data: cached.data, mime: cached.mime, cached: true });
  if (peerThumbInflight[key]) return peerThumbInflight[key];
  var missAt = peerThumbMiss[key];
  if (missAt && Date.now() - missAt < PEER_THUMB_MISS_TTL) return Promise.resolve(null);
  var bases = peerBackfillBases();
  if (!bases.length) return Promise.resolve(null);
  var p = new Promise(function(resolve) {
    var idx = 0;
    (function tryNext() {
      if (idx >= bases.length) {
        peerThumbMiss[key] = Date.now();
        return resolve(null);
      }
      var base = bases[idx++];
      fetchThumbFromPeer(base, fileHash, width).then(function(t) {
        if (!t || !t.data || !t.data.length) return tryNext();
        delete peerThumbMiss[key];
        setPeerThumb(key, t);
        console.log('[CloudSync] 缩略图回源成功:', fileHash, 'w=' + width, t.data.length + 'B', '←', base);
        resolve(t);
      });
    })();
  });
  p.then(function() { delete peerThumbInflight[key]; }, function() { delete peerThumbInflight[key]; });
  peerThumbInflight[key] = p;
  return p;
}

// 发送回源到的缩略图（ETag/长缓存与本地缩放路径保持一致，便于前端复用缓存）
function servePeerThumb(req, res, thumb, fileHash, width) {
  var etag = 'W/"' + fileHash + '_w' + width + '-' + thumb.data.length + '"';
  res.set('Content-Type', thumb.mime);
  res.set('ETag', etag);
  res.removeHeader('Pragma');
  res.removeHeader('Expires');
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('X-Resized', '1');
  if (etagFresh(req, etag)) { res.removeHeader('Content-Type'); return res.status(304).end(); }
  res.send(thumb.data);
}

// 发送"文件已删除"占位图
function sendDeletedPlaceholder(res, mimeType) {
  if (mimeType && mimeType.indexOf('image/') === 0) {
    // SVG 占位图：灰底 + 提示文字
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
      '<rect fill="#e8e8e8" width="400" height="300" rx="12"/>' +
      '<rect fill="#d0d0d0" x="150" y="100" width="100" height="80" rx="8"/>' +
      '<polygon fill="#d0d0d0" points="150,100 170,60 230,60 250,100"/>' +
      '<text x="200" y="220" text-anchor="middle" fill="#999" font-size="16" font-family="sans-serif">文件已删除</text>' +
      '<text x="200" y="245" text-anchor="middle" fill="#bbb" font-size="12" font-family="sans-serif">File Deleted</text>' +
      '</svg>';
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(svg, 'utf8'));
  } else {
    // 音频/视频返回 410 Gone
    res.status(410).json({ code: 410, message: '文件已被上传者删除' });
  }
}

// 发送"文件已被管理员下架"占位响应（班管审核下架后）
function sendModeratedPlaceholder(res, mimeType) {
  if (mimeType && mimeType.indexOf('image/') === 0) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
      '<rect fill="#f2f2f2" width="400" height="300" rx="12"/>' +
      '<rect fill="#d9d9d9" x="163" y="100" width="74" height="74" rx="8"/>' +
      '<text x="200" y="145" text-anchor="middle" fill="#8e8e93" font-size="34" font-family="sans-serif">✕</text>' +
      '<text x="200" y="215" text-anchor="middle" fill="#999" font-size="16" font-family="sans-serif">该文件已被管理员下架</text>' +
      '<text x="200" y="240" text-anchor="middle" fill="#bbb" font-size="12" font-family="sans-serif">Content Moderated</text>' +
      '</svg>';
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(svg, 'utf8'));
  } else {
    res.status(410).json({ code: 410, message: '该文件已被管理员下架' });
  }
}

// 根据扩展名和文件名猜测 MIME 类型
function guessMimeType(ext, filename) {
  var lower = (filename || '').toLowerCase();
  // 优先文件名中的类型标记（兼容旧格式）
  if (lower.indexOf('__audio') > -1) return 'audio/webm';
  if (lower.indexOf('__video') > -1) return 'video/webm';
  if (lower.indexOf('__image') > -1) return 'image/' + (ext.replace('.', '') || 'png');
  return MEDIA_MIME[ext] || 'application/octet-stream';
}

// ========== 视频转码 ==========

// 尝试将视频文件转码为 mp4：成功返回新文件名（同目录，扩展名改为 .mp4），失败/跳过返回 null
function tryTranscodeVideoToMp4(filePath) {
  return new Promise(function(resolve) {
    var ext = path.extname(filePath).toLowerCase();
    if (TRANSCODE_EXTS.indexOf(ext) === -1) {
      return resolve(null); // 非需转码格式，跳过
    }
    if (!transcoder.checkFFmpeg()) {
      console.warn('[Cloud] ffmpeg 不可用，跳过转码:', path.basename(filePath));
      return resolve(null);
    }

    var dir = path.dirname(filePath);
    var baseName = path.basename(filePath, ext);
    var tmpOutput = path.join(dir, baseName + '.mp4.tmp');

    console.log('[Cloud] 开始转码:', path.basename(filePath), '->', path.basename(tmpOutput));
    var startTime = Date.now();

    transcoder.transcodeFileToMp4(filePath, tmpOutput, 60000).then(function(result) {
      if (result.ok) {
        var finalPath = path.join(dir, baseName + '.mp4');
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
          fs.renameSync(tmpOutput, finalPath);
          var elapsed = Date.now() - startTime;
          console.log('[Cloud] 转码成功:', path.basename(filePath), '->', path.basename(finalPath), '(' + elapsed + 'ms)');
          resolve(path.basename(finalPath));
        } catch (e) {
          console.error('[Cloud] 转码后文件操作失败:', e.message);
          try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (e2) {}
          resolve(null);
        }
      } else {
        console.error('[Cloud] 转码失败 exitCode=' + result.exitCode + ':', result.stderr);
        try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (e) {}
        resolve(null);
      }
    }).catch(function(err) {
      console.error('[Cloud] 转码异常:', err.message);
      try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (e) {}
      resolve(null);
    });
  });
}

// ========== 文件哈希 ==========

// 计算文件 SHA-256（流式，支持大文件）
function computeFileHash(filePath) {
  return new Promise(function(resolve, reject) {
    var hash = crypto.createHash('sha256');
    var stream = fs.createReadStream(filePath);
    stream.on('data', function(chunk) { hash.update(chunk); });
    stream.on('end', function() { resolve(hash.digest('hex')); });
    stream.on('error', reject);
  });
}

// ========== 目录管理 ==========

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 确保用户目录存在（仅 note 目录，photos 目录不再使用）
function ensureUserDir(userId) {
  var userDir = path.join(cloudDir, String(userId));
  var noteDir = path.join(userDir, 'note');
  ensureDir(noteDir);
  return userDir;
}

function getUserDir(userId) {
  return path.join(cloudDir, String(userId));
}

// ========== 核心上传处理（共享逻辑） ==========

// 处理已保存到 .tmp/ 的文件：转码 → 哈希 → 去重 → 入库
// 返回 { hash, displayName, size, url } 或抛错
// source：上传渠道标记（'app' 应用内 / 'lite' 专属上传页 / 'guest' 上传码），班管审核只看非 'app'
function processUploadedFile(tmpFilePath, originalName, userId, folder, source) {
  return tryTranscodeVideoToMp4(tmpFilePath).then(function(newName) {
    // 转码成功后 tmp 文件已被替换为 mp4，路径变了
    var finalPath = newName ? path.join(path.dirname(tmpFilePath), newName) : tmpFilePath;

    return computeFileHash(finalPath).then(function(hash) {
      var ext = path.extname(finalPath).toLowerCase();
      var mimeType = guessMimeType(ext, path.basename(finalPath));
      var stat = fs.statSync(finalPath);

      var prefix = hash.substring(0, 2);
      var storagePath = prefix + '/' + hash + ext;

      // 查是否已有此文件
      var existing = db.prepare('SELECT hash, deleted, owner_user_id FROM cloud_files WHERE hash = ?').get(hash);

      if (existing) {
        if (existing.deleted === 1) {
          // 文件曾被 owner 删除，恢复物理文件并重置 deleted 标记
          ensureDir(path.join(sharedDir, prefix));
          var destPath = path.join(sharedDir, storagePath);
          if (fs.existsSync(destPath)) {
            // .trash 中可能还有副本，直接用新的
            try { fs.unlinkSync(destPath); } catch (e) {}
          }
          fs.renameSync(finalPath, destPath);
          db.prepare('UPDATE cloud_files SET deleted = 0, storage_path = ?, size = ?, mime_type = ?, owner_user_id = ? WHERE hash = ?').run(storagePath, stat.size, mimeType, userId, hash);
        } else {
          // 文件已存在且正常，删除临时文件
          try { fs.unlinkSync(finalPath); } catch (e) {}
        }

        // 添加用户引用（INSERT OR IGNORE 处理重复收藏）
        var refResult = db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name, folder) VALUES (?, ?, ?, ?)').run(userId, hash, originalName, folder || '');

        return {
          hash: hash,
          name: originalName,
          size: stat.size,
          url: '/api/cloud/files/' + hash,
          existed: refResult.changes === 0
        };
      }

      // 全新文件：移动到 shared/
      ensureDir(path.join(sharedDir, prefix));
      var destPath = path.join(sharedDir, storagePath);
      fs.renameSync(finalPath, destPath);

      db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run(hash, userId, originalName, stat.size, mimeType, storagePath, source || 'app');
      db.prepare('INSERT INTO cloud_user_files (user_id, file_hash, display_name, folder) VALUES (?, ?, ?, ?)').run(userId, hash, originalName, folder || '');

      return {
        hash: hash,
        name: originalName,
        size: stat.size,
        url: '/api/cloud/files/' + hash,
        existed: false
      };
    });
  });
}

// ============ 上传码（免登录跨浏览器上传）============
var CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
var MAX_FAIL_COUNT = 5;
var LOCK_MINUTES = 5;

function generateCode() {
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(crypto.randomInt(0, CODE_CHARS.length));
  }
  return code;
}

function generateUniqueCode() {
  for (var attempt = 0; attempt < 10; attempt++) {
    var code = generateCode();
    var existing = db.prepare('SELECT code FROM upload_codes WHERE code = ?').get(code);
    if (!existing) return code;
  }
  return generateCode();
}

function verifyUploadCode(code) {
  if (!code || code.length !== 6) {
    return { ownerId: null, error: '上传码格式不正确' };
  }
  var row = db.prepare('SELECT * FROM upload_codes WHERE code = ?').get(code.toUpperCase());
  if (!row) {
    return { ownerId: null, error: '上传码无效' };
  }
  if (row.locked_until) {
    var lockedUntil = new Date(row.locked_until + 'Z').getTime();
    if (Date.now() < lockedUntil) {
      var remainMin = Math.ceil((lockedUntil - Date.now()) / 60000);
      return { ownerId: null, error: '上传码已被锁定，请 ' + remainMin + ' 分钟后再试' };
    }
    db.prepare('UPDATE upload_codes SET fail_count = 0, locked_until = NULL WHERE code = ?').run(row.code);
  }
  return { ownerId: row.owner_id, error: null };
}

function recordCodeFailure(code) {
  var row = db.prepare('SELECT * FROM upload_codes WHERE code = ?').get((code || '').toUpperCase());
  if (!row) return;
  var newFail = row.fail_count + 1;
  if (newFail >= MAX_FAIL_COUNT) {
    var lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare('UPDATE upload_codes SET fail_count = ?, locked_until = ? WHERE code = ?').run(newFail, lockedUntil, row.code);
  } else {
    db.prepare('UPDATE upload_codes SET fail_count = ? WHERE code = ?').run(newFail, row.code);
  }
}

function resetCodeFailCount(code) {
  db.prepare('UPDATE upload_codes SET fail_count = 0, locked_until = NULL WHERE code = ?').run((code || '').toUpperCase());
}

// ============ Multer 配置 ============

// 已登录上传：保存到 .tmp/（处理后再移至 shared/）
var storage = multer.diskStorage({
  destination: function(req, file, cb) {
    ensureDir(tmpDir);
    cb(null, tmpDir);
  },
  filename: function(req, file, cb) {
    var ext = resolveUploadExt(file.originalname, file.mimetype) || '.bin';
    var tmpName = 'upload_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, tmpName);
  }
});
var upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  // multer 2.x 默认按 latin1 解析 multipart 的 filename 参数 → 中文文件名会变成
  // "é¿å¾…" 这种乱码落库，用户在云盘里看到的就是一堆乱码名。
  // defParamCharset: 'utf8' 让 busboy 按 UTF-8 解码，从根上修掉（长图导出、
  // 相册导出等所有非 ASCII 文件名都受益）。
  defParamCharset: 'utf8',
  // 不在 filter 里拒收：扩展名/MIME 全缺失的文件也要落盘后靠魔数嗅探判定（见 finalizeUploadExt）
  fileFilter: function(req, file, cb) {
    cb(null, true);
  }
});

// 免登录上传：在 destination 中验证上传码，保存到 .tmp/
var guestStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    var code = (req.body && req.body.code) || '';
    var result = verifyUploadCode(code);
    if (!result.ownerId) {
      recordCodeFailure(code);
      return cb(new Error(result.error || '上传码无效'));
    }
    resetCodeFailCount(code);
    req.guestOwnerId = result.ownerId;
    req.guestCode = code.toUpperCase();
    ensureDir(tmpDir);
    cb(null, tmpDir);
  },
  filename: function(req, file, cb) {
    var ext = resolveUploadExt(file.originalname, file.mimetype) || '.bin';
    var tmpName = 'guest_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, tmpName);
  }
});
var guestUpload = multer({
  storage: guestStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  defParamCharset: 'utf8',   // 同上：中文文件名按 UTF-8 解码
  fileFilter: function(req, file, cb) {
    cb(null, true);
  }
});

// ============ 上传码路由 ============

// 生成/刷新上传码
router.post('/upload-code', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var newCode = generateUniqueCode();
  db.prepare('DELETE FROM upload_codes WHERE owner_id = ?').run(userId);
  db.prepare('INSERT INTO upload_codes (code, owner_id, fail_count, locked_until) VALUES (?, ?, 0, NULL)').run(newCode, userId);
  res.json({ code: 200, data: { code: newCode, created_at: new Date().toISOString() } });
});

// 获取当前上传码
router.get('/upload-code', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var row = db.prepare('SELECT * FROM upload_codes WHERE owner_id = ?').get(userId);
  if (!row) {
    var newCode = generateUniqueCode();
    db.prepare('INSERT INTO upload_codes (code, owner_id, fail_count, locked_until) VALUES (?, ?, 0, NULL)').run(newCode, userId);
    return res.json({ code: 200, data: { code: newCode, created_at: new Date().toISOString() } });
  }
  res.json({ code: 200, data: { code: row.code, created_at: row.created_at } });
});

// 验证上传码
router.post('/verify-code', function(req, res) {
  var code = (req.body && req.body.code) || '';
  var result = verifyUploadCode(code);
  if (result.ownerId) {
    res.json({ code: 200, data: { valid: true } });
  } else {
    res.json({ code: 200, data: { valid: false, message: result.error } });
  }
});

// ============ 文件路由 ============

// 免登录上传（通过上传码认证）
router.post('/guest-upload', guestUpload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  if (!finalizeUploadExt(req.file)) {
    try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    return res.status(400).json({ code: 400, message: '不支持的文件类型，仅支持图片/音频/视频' });
  }
  var ownerId = req.guestOwnerId;
  var filePath = req.file.path;
  var originalName = req.file.originalname;

  processUploadedFile(filePath, originalName, ownerId, '', 'guest').then(function(result) {
    res.json({ code: 200, data: result });
  }).catch(function(err) {
    console.error('[Cloud] guest-upload 处理失败:', err);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    res.status(500).json({ code: 500, message: '文件处理失败' });
  });
});

// guest-upload 的错误处理
router.use('/guest-upload', function(err, req, res, next) {
  if (err) {
    var msg = err.message || '上传失败';
    if (err.code === 'LIMIT_FILE_SIZE') {
      msg = '文件超过 200MB 限制';
    }
    return res.status(400).json({ code: 400, message: msg });
  }
  next();
});

// 列出用户云盘文件（从数据库查询，自动过滤已删除文件，支持 ?folder= 筛选）
router.get('/files', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var folderFilter = req.query.folder || '';

  try {
    var sql, params;
    if (folderFilter === '__root__') {
      // 仅根目录（folder = ''）
      sql = [
        'SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,',
        '       cf.size, cf.mime_type, cf.owner_user_id',
        'FROM cloud_user_files cuf',
        'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
        'WHERE cuf.user_id = ? AND cf.deleted = 0 AND IFNULL(cf.status, \'ok\') != \'hidden\' AND cuf.folder = \'\'',
        'ORDER BY cuf.uploaded_at DESC'
      ].join('\n');
      params = [userId];
    } else if (folderFilter) {
      // 指定分组
      sql = [
        'SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,',
        '       cf.size, cf.mime_type, cf.owner_user_id',
        'FROM cloud_user_files cuf',
        'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
        'WHERE cuf.user_id = ? AND cf.deleted = 0 AND IFNULL(cf.status, \'ok\') != \'hidden\' AND cuf.folder = ?',
        'ORDER BY cuf.uploaded_at DESC'
      ].join('\n');
      params = [userId, folderFilter];
    } else {
      // 全部文件（排除隐藏分组中的文件）
      sql = [
        'SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,',
        '       cf.size, cf.mime_type, cf.owner_user_id',
        'FROM cloud_user_files cuf',
        'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
        'LEFT JOIN cloud_folders cfolder ON cfolder.user_id = cuf.user_id AND cfolder.name = cuf.folder',
        'WHERE cuf.user_id = ? AND cf.deleted = 0 AND IFNULL(cf.status, \'ok\') != \'hidden\'',
        '  AND (cuf.folder = \'\' OR cfolder.id IS NULL OR cfolder.hide_from_all = 0)',
        'ORDER BY cuf.uploaded_at DESC'
      ].join('\n');
      params = [userId];
    }

    var stmt = db.prepare(sql);
    var files = stmt.all.apply(stmt, params);

    var result = files.map(function(f) {
      return {
        hash: f.file_hash,
        name: f.display_name,
        display_name: f.display_name,
        size: f.size,
        mime_type: f.mime_type,
        folder: f.folder || '',
        url: '/api/cloud/files/' + f.file_hash,
        uploaded_at: f.uploaded_at,
        is_owner: f.owner_user_id === userId
      };
    });

    res.json({ code: 200, data: { files: result } });
  } catch (e) {
    console.error('[Cloud] 文件列表查询失败:', e);
    res.json({ code: 200, data: { files: [] } });
  }
});

// 上传文件
router.post('/upload', auth.requireAuth, upload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  if (!finalizeUploadExt(req.file)) {
    try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    return res.status(400).json({ code: 400, message: '不支持的文件类型，仅支持图片/音频/视频' });
  }
  var userId = req.user.user_id;
  var filePath = req.file.path;
  var originalName = req.file.originalname;
  var folder = (req.body.folder || '').trim();
  var source = req.body.source === 'lite' ? 'lite' : 'app';

  processUploadedFile(filePath, originalName, userId, folder, source).then(function(result) {
    res.json({ code: 200, data: result });
  }).catch(function(err) {
    console.error('[Cloud] 上传处理失败:', err);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    res.status(500).json({ code: 500, message: '文件处理失败' });
  });
});

// 批量上传（串行处理）
router.post('/upload-batch', auth.requireAuth, upload.array('files', 10), function(req, res) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  var userId = req.user.user_id;
  var folder = (req.body.folder || '').trim();
  var source = req.body.source === 'lite' ? 'lite' : 'app';
  var files = req.files;
  var results = [];
  var idx = 0;

  function processNext() {
    if (idx >= files.length) {
      return res.json({ code: 200, data: { files: results } });
    }
    var f = files[idx];
    idx++;
    if (!finalizeUploadExt(f)) {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
      results.push({ error: '不支持的文件类型，仅支持图片/音频/视频' });
      processNext();
      return;
    }
    processUploadedFile(f.path, f.originalname, userId, folder, source).then(function(result) {
      results.push(result);
      processNext();
    }).catch(function(err) {
      console.error('[Cloud] 批量上传处理失败:', err);
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
      results.push({ error: '处理失败' });
      processNext();
    });
  }
  processNext();
});

// 获取文件（支持哈希 + 旧 URL 兼容 + 软删除占位）
router.get('/files/:param', auth.requireAuth, function(req, res) {
  var param = decodeURIComponent(req.params.param);

  // 安全检查
  if (param.indexOf('..') !== -1 || param.indexOf('/') !== -1 || param.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的文件标识' });
  }

  var fileHash = param;

  // 支持 hash.ext 格式：提取纯哈希（URL 含扩展名便于前端识别媒体类型）
  var hashExtMatch = param.match(/^([a-f0-9]{64})\.\w+$/);
  if (hashExtMatch) {
    fileHash = hashExtMatch[1];
  }

  // 判断是否为 64 位十六进制哈希（纯哈希或已提取）
  if (!/^[a-f0-9]{64}$/.test(fileHash)) {
    // 不是哈希 → 查旧 URL 映射表
    var mapping = db.prepare('SELECT file_hash FROM cloud_old_url_map WHERE old_filename = ?').get(param);
    if (mapping) {
      fileHash = mapping.file_hash;
    } else {
      // 尝试旧式文件查找（兼容迁移前刚启动时的过渡状态）
      // 新格式文件名：userId_timestamp_random.ext
      var parts = param.split('_');
      if (parts.length >= 3) {
        var ownerId = parts[0];
        var candidatePath = path.join(getUserDir(ownerId), 'photos', param);
        if (fs.existsSync(candidatePath)) {
          return sendMediaFile(req, res, candidatePath);
        }
      }
      // 旧格式：遍历所有用户目录
      try {
        if (fs.existsSync(cloudDir)) {
          var users = fs.readdirSync(cloudDir);
          for (var i = 0; i < users.length; i++) {
            var candidatePath = path.join(cloudDir, users[i], 'photos', param);
            if (fs.existsSync(candidatePath)) {
              return sendMediaFile(req, res, candidatePath);
            }
          }
        }
      } catch (e) { /* ignore */ }
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }
  }

  // 哈希查找
  var file = db.prepare('SELECT storage_path, deleted, mime_type, status, original_name FROM cloud_files WHERE hash = ?').get(fileHash);
  if (!file) {
    // CC 同步：数据库中无记录，尝试扫描磁盘（Syncthing 同步的文件）
    file = findSyncedFile(fileHash);
  }
  if (!file) {
    // 本地无记录且磁盘无文件 → 跨节点按需回源（中继/Syncthing 同步延迟兜底）。
    // 两条路径：
    //   ① 客户端要缩略图（?w=）→ 只回源几 KB 的缩略图（慢链路上的唯一可行解）；
    //   ② 否则回源原图 —— 只等 PEER_BACKFILL_GRACE_MS，等不到先 404 让前端兜底，
    //      后台继续拉，落盘后下次请求命中；绝不让读请求挂死几十秒。
    var wantWidth = parseInt(req.query.w, 10);
    if (wantWidth > 0 && req.query.download !== '1') {
      // 同样只等宽限期：等不到先 404 兜底，回源转后台，落库后下次请求命中
      var thumbTimer = setTimeout(function() {
        if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
      }, PEER_BACKFILL_GRACE_MS);
      return backfillThumbFromPeers(fileHash, wantWidth).then(function(thumb) {
        clearTimeout(thumbTimer);
        if (!thumb) {
          if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
          return;
        }
        if (res.headersSent) return;   // 已超时响应过
        if (!thumb.cached) res.set('X-Backfilled', '1');   // 缓存命中不再标记（本次未走网络）
        servePeerThumb(req, res, thumb, fileHash, wantWidth);
      }).catch(function(e) {
        clearTimeout(thumbTimer);
        console.error('[Cloud] 缩略图回源异常:', fileHash, e && e.message);
        if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
      });
    }
    var graceTimer = setTimeout(function() {
      if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
    }, PEER_BACKFILL_GRACE_MS);
    return backfillFromPeers(fileHash).then(function(rec) {
      clearTimeout(graceTimer);
      if (!rec) {
        if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
        return;
      }
      if (res.headersSent) return;   // 已超时响应过，回源成果留给下次请求
      res.set('X-Backfilled', '1');
      var fresh = db.prepare('SELECT storage_path, deleted, mime_type, status, original_name FROM cloud_files WHERE hash = ?').get(fileHash) || rec;
      serveCloudFile(req, res, fresh, fileHash);
    }).catch(function(e) {
      clearTimeout(graceTimer);
      console.error('[Cloud] 按需回源异常:', fileHash, e && e.message);
      if (!res.headersSent) res.status(404).json({ code: 404, message: '文件不存在' });
    });
  }
  serveCloudFile(req, res, file, fileHash);
});

// 哈希文件的本地服务路径（删除/审核占位、缩放、304、Range）。
// 从 /files/:param 抽出，供「按需回源成功后重入」与常规命中共用。
function serveCloudFile(req, res, file, fileHash) {

  if (file.deleted === 1) {
    return sendDeletedPlaceholder(res, file.mime_type);
  }

  // 班管审核下架的文件：所有访问者均返回占位（先上传再审核，下架即全网不可见）
  if (file.status === 'hidden') {
    return sendModeratedPlaceholder(res, file.mime_type);
  }

  var filePath = path.join(sharedDir, file.storage_path);
  if (!fs.existsSync(filePath)) {
    // 物理文件丢失，标记为已删除
    db.prepare('UPDATE cloud_files SET deleted = 1 WHERE hash = ?').run(fileHash);
    return sendDeletedPlaceholder(res, file.mime_type);
  }

  // 下载模式：附件下发（浏览器原生下载进度，兼容旧内核 WebView 的 blob 下载缺陷）
  if (req.query.download === '1') {
    var fname = file.original_name || fileHash;
    res.set('Content-Disposition', 'attachment; filename="' + String(fname).replace(/[^\x20-\x7E]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname));
  }

  // 图片实时缩放（?w= 参数，sharp 可用时生效；下载模式跳过缩放直接发原图）
  var targetWidth = parseInt(req.query.w, 10);
  if (targetWidth > 0 && req.query.download !== '1' && sharp && file.mime_type && file.mime_type.indexOf('image/') === 0) {
    var cacheKey = fileHash + '_w' + targetWidth;
    var cached = getCachedResize(cacheKey);
    if (cached) {
      var cEtag = 'W/"' + cacheKey + '-' + cached.length + '"';
      res.set('Content-Type', file.mime_type);
      res.set('ETag', cEtag);
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Resized', '1');
      if (etagFresh(req, cEtag)) { res.removeHeader('Content-Type'); return res.status(304).end(); }
      return res.send(cached);
    }

    sharp(filePath).metadata().then(function(metadata) {
      if (metadata.width <= targetWidth) {
        // 原图比目标还小，直接发送原图
        return sendMediaFile(req, res, filePath);
      }
      return sharp(filePath).resize({ width: targetWidth, withoutEnlargement: true }).toBuffer().then(function(resized) {
        setCachedResize(cacheKey, resized);
        var fEtag = 'W/"' + cacheKey + '-' + resized.length + '"';
        res.set('Content-Type', file.mime_type);
        res.set('ETag', fEtag);
        res.removeHeader('Pragma');
        res.removeHeader('Expires');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('X-Resized', '1');
        if (etagFresh(req, fEtag)) { res.removeHeader('Content-Type'); return res.status(304).end(); }
        res.send(resized);
      });
    }).catch(function(e) {
      console.error('[Cloud] 图片缩放失败, 回退原图:', e.message);
      return sendMediaFile(req, res, filePath);
    });
    return; // 异步处理中，不继续执行
  }

  return sendMediaFile(req, res, filePath);
}

// ============ CC 文件同步 ============

// 供 peer 服务器拉取文件（relay secret 认证）
router.get('/peer-fetch/:hash', function(req, res) {
  var relaySecret = (require('../../../server/src/config').relay || {}).secret || '';
  var authHeader = req.get('X-Relay-Secret') || '';

  if (!relaySecret || authHeader !== relaySecret) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var hash = req.params.hash;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ code: 400, message: '无效的哈希' });
  }

  var file = db.prepare('SELECT storage_path, size, mime_type, original_name, deleted FROM cloud_files WHERE hash = ?').get(hash);
  if (!file || file.deleted === 1) {
    // CC 同步：尝试扫描磁盘
    file = findSyncedFile(hash);
  }
  if (!file || file.deleted === 1) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var filePath = path.join(sharedDir, file.storage_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ code: 404, message: '物理文件丢失' });
  }

  // 元信息响应头（原图与缩略图共用；Content-Length 必须是实际要发的字节数）
  function setFileMeta(len) {
    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.set('Content-Length', len);
    res.set('X-File-Hash', hash);
    res.set('X-File-Name', encodeURIComponent(file.original_name));
    res.set('X-File-Mime', file.mime_type || '');
  }

  // 慢链路优化：对端只要缩略图（?w=）时先缩放再回传 —— 几 KB 取代几 MB 原图。
  // 两节点间实测只有 1~4KB/s，传原图要几十分钟，同步窗口内头像/封面必然回落。
  var peerWidth = parseInt(req.query.w, 10);
  if (peerWidth > 0 && sharp && (file.mime_type || '').indexOf('image/') === 0) {
    sharp(filePath).metadata().then(function(meta) {
      // 原图比目标还窄/取不到尺寸 → 直接发原图（对端按大小自行决定是否接收）
      if (!meta || !meta.width || meta.width <= peerWidth) return null;
      return sharp(filePath).resize({ width: peerWidth, withoutEnlargement: true }).toBuffer();
    }).then(function(resized) {
      if (!resized) {
        setFileMeta(file.size);
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      setFileMeta(resized.length);
      res.set('X-File-Resized', '1');
      res.end(resized);
    }).catch(function(e) {
      console.error('[Cloud] peer-fetch 缩放失败, 回退原图:', e && e.message);
      setFileMeta(file.size);
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // 流式传输原始文件 + 元信息响应头
  setFileMeta(file.size);
  fs.createReadStream(filePath).pipe(res);
});

// 删除文件（区分 owner 删除和取消收藏）
router.delete('/files/:param', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var param = decodeURIComponent(req.params.param);

  // 安全检查
  if (param.indexOf('..') !== -1 || param.indexOf('/') !== -1 || param.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的文件标识' });
  }

  // 判断是哈希还是旧格式文件名
  var fileHash = param;
  if (!/^[a-f0-9]{64}$/.test(param)) {
    // 旧格式文件名 → 查映射表
    var mapping = db.prepare('SELECT file_hash FROM cloud_old_url_map WHERE old_filename = ?').get(param);
    if (mapping) {
      fileHash = mapping.file_hash;
    } else {
      // 旧式直接删除（迁移前的文件）
      var filePath = path.join(getUserDir(userId), 'photos', param);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ code: 404, message: '文件不存在' });
      }
      fs.unlinkSync(filePath);
      return res.json({ code: 200, message: '删除成功' });
    }
  }

  // 查 cloud_files
  var file = db.prepare('SELECT hash, owner_user_id, storage_path, deleted FROM cloud_files WHERE hash = ?').get(fileHash);
  if (!file) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  if (file.deleted === 1) {
    // 已被删除，清理用户引用即可
    db.prepare('DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?').run(userId, fileHash);
    return res.json({ code: 200, message: '已移除', owner_delete: false });
  }

  // 检查用户是否拥有此文件引用
  var userRef = db.prepare('SELECT id FROM cloud_user_files WHERE user_id = ? AND file_hash = ?').get(userId, fileHash);
  if (!userRef) {
    return res.status(404).json({ code: 404, message: '文件不在你的云盘中' });
  }

  if (file.owner_user_id === userId) {
    // 原始上传者：物理删除
    ensureDir(trashDir);
    var filePath = path.join(sharedDir, file.storage_path);
    var trashPath = path.join(trashDir, fileHash + path.extname(file.storage_path));

    // 移入 .trash
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, trashPath);
      }
    } catch (e) {
      console.error('[Cloud] 移动文件到 trash 失败:', e.message);
    }

    // 软删除 + 清除所有用户引用
    db.prepare('UPDATE cloud_files SET deleted = 1 WHERE hash = ?').run(fileHash);
    db.prepare('DELETE FROM cloud_user_files WHERE file_hash = ?').run(fileHash);

    return res.json({ code: 200, message: '文件已删除，所有转存用户的引用已清除', owner_delete: true });
  } else {
    // 非 owner：仅取消自己的收藏
    db.prepare('DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?').run(userId, fileHash);
    return res.json({ code: 200, message: '已从云盘移除', owner_delete: false });
  }
});

// 笔记路由已统一迁移至 notes.js（cloud_notes 数据库表），不再使用 JSON 文件存储

// ============ 转存路由 ============

// 资源文件复制进 shared/ 并登记 cloud_files。
// 用途：① 非 botmedia 的系统资源/照片；② bot 转运不可用时的回退路径。
// 返回 { fileHash, displayName }，失败抛错由调用方转 500。
function copyResourceIntoCloud(sourcePath) {
  var fileHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  var ext = path.extname(sourcePath).toLowerCase();
  var existing = db.prepare('SELECT hash, original_name FROM cloud_files WHERE hash = ?').get(fileHash);
  var displayName;
  if (!existing) {
    var prefix = fileHash.substring(0, 2);
    ensureDir(path.join(sharedDir, prefix));
    var storagePath = prefix + '/' + fileHash + ext;
    fs.copyFileSync(sourcePath, path.join(sharedDir, storagePath));
    var stat = fs.statSync(sourcePath);
    var mimeType = guessMimeType(ext, path.basename(sourcePath));
    db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(fileHash, '__system__', path.basename(sourcePath), stat.size, mimeType, storagePath);
    displayName = path.basename(sourcePath);
  } else {
    displayName = existing.original_name || path.basename(sourcePath);
  }
  return { fileHash: fileHash, displayName: displayName };
}

// bot 转运成功后补登 cloud_files：物理文件已由 bot 硬链接进 shared/，
// 这里只补数据库行（source='bot' 标明来源，便于甄别）。行已存在（含软删）时不动。
function ensureCloudFileFromTransfer(r, fileName) {
  var existing = db.prepare('SELECT hash FROM cloud_files WHERE hash = ?').get(r.hash);
  if (existing) return;
  var ext = path.extname(fileName).toLowerCase();
  var mimeType = guessMimeType(ext, fileName);
  db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(r.hash, '__system__', fileName, r.size, mimeType, r.storage_path, 'bot');
}

// 转存收尾：源文件状态检查 + 建立当前用户引用 + 响应
function finishSaveFromUrl(res, userId, fileHash, displayName) {
  var cloudFile = db.prepare('SELECT hash, size, deleted FROM cloud_files WHERE hash = ?').get(fileHash);
  if (!cloudFile || cloudFile.deleted === 1) {
    return res.status(404).json({ code: 404, message: '源文件已被删除' });
  }
  var refResult = db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, fileHash, displayName || '转存文件');
  res.json({
    code: 200,
    data: {
      hash: fileHash,
      name: displayName || '转存文件',
      size: cloudFile.size,
      url: '/api/cloud/files/' + fileHash,
      existed: refResult.changes === 0
    }
  });
}

// 从 URL 保存文件到云盘（仅建立引用，不复制文件）
router.post('/save-from-url', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var imageUrl = req.body.url;

  if (!imageUrl) {
    return res.status(400).json({ code: 400, message: '缺少文件 URL' });
  }

  // 验证 URL 是否来自本站
  var allowedPrefixes = ['/api/cloud/files/', '/resources/', '/api/photos/'];
  var isAllowed = false;
  for (var i = 0; i < allowedPrefixes.length; i++) {
    if (imageUrl.indexOf(allowedPrefixes[i]) === 0) {
      isAllowed = true;
      break;
    }
  }

  if (!isAllowed) {
    return res.status(400).json({ code: 400, message: '仅支持转存本站文件' });
  }

  // 从 URL 定位源文件并获取/计算哈希
  var fileHash = null;
  var displayName = '';

  if (imageUrl.indexOf('/api/cloud/files/') === 0) {
    // 云盘文件 URL：可能是新格式（/hash）或旧格式（/filename）
    var urlParam = decodeURIComponent(imageUrl.replace('/api/cloud/files/', ''));
    // 去除查询参数（如 ?w=800 缩放参数），避免影响 hash 正则匹配
    var _qIdx = urlParam.indexOf('?');
    if (_qIdx !== -1) urlParam = urlParam.substring(0, _qIdx);
    if (urlParam.indexOf('..') !== -1 || urlParam.indexOf('/') !== -1 || urlParam.indexOf('\\') !== -1) {
      return res.status(400).json({ code: 400, message: '无效的文件 URL' });
    }

    // 支持 hash.ext 格式和裸哈希
    var extMatch = urlParam.match(/^([a-f0-9]{64})(?:\.\w+)?$/);
    if (extMatch) {
      fileHash = extMatch[1];
    }
    if (!fileHash) {
      // 旧格式：查映射表
      var mapping = db.prepare('SELECT file_hash FROM cloud_old_url_map WHERE old_filename = ?').get(urlParam);
      if (mapping) {
        fileHash = mapping.file_hash;
      } else {
        // 旧式文件：计算哈希并迁移
        var foundPath = null;
        var parts = urlParam.split('_');
        if (parts.length >= 3) {
          var candidatePath = path.join(getUserDir(parts[0]), 'photos', urlParam);
          if (fs.existsSync(candidatePath)) foundPath = candidatePath;
        }
        if (!foundPath) {
          try {
            if (fs.existsSync(cloudDir)) {
              var users = fs.readdirSync(cloudDir);
              for (var u = 0; u < users.length; u++) {
                var cp = path.join(cloudDir, users[u], 'photos', urlParam);
                if (fs.existsSync(cp)) { foundPath = cp; break; }
              }
            }
          } catch (e) {}
        }

        if (foundPath) {
          // 迁移这个旧文件
          try {
            fileHash = require('crypto').createHash('sha256').update(require('fs').readFileSync(foundPath)).digest('hex');
            var ext = path.extname(foundPath).toLowerCase();
            var prefix = fileHash.substring(0, 2);
            ensureDir(path.join(sharedDir, prefix));
            var storagePath = prefix + '/' + fileHash + ext;
            var destPath = path.join(sharedDir, storagePath);

            var existing = db.prepare('SELECT hash FROM cloud_files WHERE hash = ?').get(fileHash);
            if (!existing) {
              fs.renameSync(foundPath, destPath);
              var stat = fs.statSync(destPath);
              var mimeType = guessMimeType(ext, path.basename(foundPath));
              db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(fileHash, parts.length >= 3 ? parts[0] : '__system__', urlParam, stat.size, mimeType, storagePath);
            } else {
              try { fs.unlinkSync(foundPath); } catch (e) {}
            }
            db.prepare('INSERT OR IGNORE INTO cloud_old_url_map (old_filename, file_hash) VALUES (?, ?)').run(urlParam, fileHash);
          } catch (e) {
            return res.status(500).json({ code: 500, message: '文件处理失败' });
          }
        }
      }
    }

    if (fileHash) {
      var cloudFile = db.prepare('SELECT original_name FROM cloud_files WHERE hash = ? AND deleted = 0').get(fileHash);
      if (cloudFile) {
        displayName = cloudFile.original_name;
      }
    }
  } else if (imageUrl.indexOf('/resources/') === 0) {
    // 系统资源文件：默认复制到 shared/ 并创建记录；
    // botmedia 文件（bot 用 yt-dlp 下载的视频等）改走「bot 转运」——不复制字节，
    // 由 AstrBot 插件把原文件硬链接进 shared/，见 bot-transfer.js。
    var resourcesDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'));
    var sourcePath = path.resolve(resourcesDir, imageUrl.replace('/resources/', ''));
    if (sourcePath.indexOf(resourcesDir + path.sep) !== 0 && sourcePath !== resourcesDir) {
      return res.status(400).json({ code: 400, message: '无效的文件路径' });
    }
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    var botFile = botTransfer.resolveBotmediaFile(imageUrl, resourcesDir);
    if (botFile) {
      // 异步：bot 完成物理硬链接后回到这里入库并响应
      botTransfer.transfer(botFile.fileName).then(function(r) {
        if (r.ok) {
          try {
            ensureCloudFileFromTransfer(r, botFile.fileName);
          } catch (e) {
            console.error('[Cloud] bot 转运后入库失败:', e);
            return res.status(500).json({ code: 500, message: '文件处理失败' });
          }
          finishSaveFromUrl(res, userId, r.hash, botFile.fileName);
        } else if (r.reason === 'not_found') {
          return res.status(404).json({ code: 404, message: '该视频已被机器人清理，请重新下载' });
        } else {
          // bot 不可达/未配置/响应异常：回退本地复制，保证转存链路可用
          console.warn('[Cloud] bot 转运不可用（' + r.reason + ': ' + r.message + '），回退本地复制');
          try {
            var copiedFallback = copyResourceIntoCloud(sourcePath);
            finishSaveFromUrl(res, userId, copiedFallback.fileHash, copiedFallback.displayName);
          } catch (e) {
            console.error('[Cloud] 转存资源文件失败:', e);
            return res.status(500).json({ code: 500, message: '文件处理失败' });
          }
        }
      });
      return; // 响应权已移交 .then
    }

    try {
      var copiedResource = copyResourceIntoCloud(sourcePath);
      fileHash = copiedResource.fileHash;
      displayName = copiedResource.displayName;
    } catch (e) {
      console.error('[Cloud] 转存资源文件失败:', e);
      return res.status(500).json({ code: 500, message: '文件处理失败' });
    }
  } else if (imageUrl.indexOf('/api/photos/') === 0) {
    var resourcesDir2 = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'));
    var photosBase = path.resolve(resourcesDir2, 'public', 'photos');
    var sourcePath2 = path.resolve(photosBase, imageUrl.replace('/api/photos/', ''));
    if (sourcePath2.indexOf(photosBase + path.sep) !== 0 && sourcePath2 !== photosBase) {
      return res.status(400).json({ code: 400, message: '无效的文件路径' });
    }
    if (!fs.existsSync(sourcePath2)) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    try {
      var copiedPhoto = copyResourceIntoCloud(sourcePath2);
      fileHash = copiedPhoto.fileHash;
      displayName = copiedPhoto.displayName;
    } catch (e) {
      console.error('[Cloud] 转存照片失败:', e);
      return res.status(500).json({ code: 500, message: '文件处理失败' });
    }
  }

  if (!fileHash) {
    return res.status(404).json({ code: 404, message: '无法定位源文件' });
  }

  finishSaveFromUrl(res, userId, fileHash, displayName);
});

// ============ 失效资源检测与一键清除 ============

// 检测当前用户名下「物理文件已丢失」的云盘条目。
// 典型成因：bot 清理了 botmedia 原文件（硬链接策略上线前的历史双副本不受影响，
// 但跨班同步失败、手动删盘、数据损坏都会造成 shared/ 下实体缺失）。
// 可见性口径与 /files 一致（deleted=0、非 hidden、不含隐藏分组）。
router.get('/invalid', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var rows = db.prepare([
      'SELECT cuf.file_hash, cuf.display_name, cuf.folder, cf.size, cf.storage_path',
      'FROM cloud_user_files cuf',
      'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
      'LEFT JOIN cloud_folders cfolder ON cfolder.user_id = cuf.user_id AND cfolder.name = cuf.folder',
      'WHERE cuf.user_id = ? AND cf.deleted = 0 AND IFNULL(cf.status, \'ok\') != \'hidden\'',
      '  AND (cuf.folder = \'\' OR cfolder.id IS NULL OR cfolder.hide_from_all = 0)'
    ].join('\n')).all(userId);

    var invalid = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var sp = String(r.storage_path || '');
      // 形态异常的 storage_path 视为失效（数据损坏），不进 path.join 防穿越
      if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.\w{1,8}$/.test(sp)) {
        invalid.push({ hash: r.file_hash, name: r.display_name, size: r.size || 0, folder: r.folder || '' });
        continue;
      }
      if (!fs.existsSync(path.join(sharedDir, sp))) {
        invalid.push({ hash: r.file_hash, name: r.display_name, size: r.size || 0, folder: r.folder || '' });
      }
    }
    res.json({ code: 200, data: { invalid: invalid, total: rows.length } });
  } catch (e) {
    console.error('[Cloud] 失效资源检测失败:', e);
    res.json({ code: 200, data: { invalid: [], total: 0 } });
  }
});

// 一键清除失效资源：移除当前用户对这些条目的引用；
// 引用清零的 cloud_files 行顺手软删（物理文件本就缺失，避免孤儿行越积越多）。
// 安全：清理前对每个条目复验物理文件仍不存在——检测期间可能被恢复
//（如跨班同步补档），恢复了的不能删引用。
router.post('/invalid/clear', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var HASH_RE = /^[a-f0-9]{64}$/;
  var hashes = Array.isArray(req.body.hashes)
    ? req.body.hashes.filter(function(h) { return HASH_RE.test(String(h)); })
    : null;
  try {
    var targets;
    if (hashes && hashes.length) {
      // 只清理前端展示过的那批，防止检测期间的新变化被误伤
      var marks = hashes.map(function() { return '?'; }).join(',');
      targets = db.prepare(
        'SELECT cuf.file_hash AS hash, cf.storage_path AS storage_path FROM cloud_user_files cuf ' +
        'JOIN cloud_files cf ON cuf.file_hash = cf.hash ' +
        'WHERE cuf.user_id = ? AND cuf.file_hash IN (' + marks + ')'
      ).all.apply(null, [userId].concat(hashes));
    } else {
      // 未传 hashes：按服务端当前检测结果全清（容错路径）
      targets = db.prepare(
        'SELECT cuf.file_hash AS hash, cf.storage_path AS storage_path FROM cloud_user_files cuf ' +
        'JOIN cloud_files cf ON cuf.file_hash = cf.hash ' +
        'WHERE cuf.user_id = ? AND cf.deleted = 0'
      ).all(userId).filter(function(t) {
        var sp = String(t.storage_path || '');
        if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.\w{1,8}$/.test(sp)) return true;
        return !fs.existsSync(path.join(sharedDir, sp));
      });
    }

    var delRefStmt = db.prepare('DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?');
    var countRefStmt = db.prepare('SELECT COUNT(*) AS n FROM cloud_user_files WHERE file_hash = ?');
    var getPathStmt = db.prepare('SELECT storage_path FROM cloud_files WHERE hash = ?');
    var softDelStmt = db.prepare('UPDATE cloud_files SET deleted = 1 WHERE hash = ?');
    var removed = 0;
    targets.forEach(function(t) {
      // 复验：物理文件可能已恢复（跨班同步补档等），恢复了的跳过不删引用
      var sp = String(t.storage_path || '');
      if (/^[a-f0-9]{2}\/[a-f0-9]{64}\.\w{1,8}$/.test(sp) && fs.existsSync(path.join(sharedDir, sp))) {
        return;
      }
      removed += delRefStmt.run(userId, t.hash).changes;
      var left = countRefStmt.get(t.hash);
      if (!left || left.n === 0) softDelStmt.run(t.hash);
    });
    res.json({ code: 200, message: '已清除 ' + removed + ' 个失效资源', data: { removed: removed } });
  } catch (e) {
    console.error('[Cloud] 清除失效资源失败:', e);
    res.status(500).json({ code: 500, message: '清除失败，请重试' });
  }
});

// ============ 分组（文件夹）管理 ============

// 创建分组
router.post('/folders', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var name = (req.body.name || '').trim();

  if (!name) {
    return res.status(400).json({ code: 400, message: '分组名称不能为空' });
  }
  if (name.length > 50) {
    return res.status(400).json({ code: 400, message: '分组名称不能超过50个字符' });
  }

  try {
    var result = db.prepare('INSERT INTO cloud_folders (user_id, name) VALUES (?, ?)').run(userId, name);
    res.json({ code: 200, data: { id: result.lastInsertRowid, name: name } });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ code: 400, message: '分组名称已存在' });
    }
    console.error('[Cloud] 创建分组失败:', e);
    res.status(500).json({ code: 500, message: '创建分组失败' });
  }
});

// 列出我的分组（含文件计数）
router.get('/folders', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;

  try {
    var folders = db.prepare([
      'SELECT cf.id, cf.name, cf.share_code, cf.hide_from_all, cf.created_at,',
      '  (SELECT COUNT(*) FROM cloud_user_files cuf2 JOIN cloud_files cfl ON cuf2.file_hash = cfl.hash WHERE cuf2.user_id = ? AND cuf2.folder = cf.name AND cfl.deleted = 0) as file_count',
      'FROM cloud_folders cf',
      'WHERE cf.user_id = ?',
      'ORDER BY cf.created_at ASC'
    ].join('\n')).all(userId, userId);

    var mapped = folders.map(function(f) {
      return { id: f.id, name: f.name, file_count: f.file_count, hide_from_all: !!f.hide_from_all, share_code: f.share_code, created_at: f.created_at };
    });
    res.json({ code: 200, data: { folders: mapped } });
  } catch (e) {
    console.error('[Cloud] 列出分组失败:', e);
    res.json({ code: 200, data: { folders: [] } });
  }
});

// 切换分组"在全部中显示"
router.patch('/folders/:id/toggle-hide', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var folderId = parseInt(req.params.id, 10);
  try {
    var folder = db.prepare('SELECT * FROM cloud_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
    if (!folder) return res.status(404).json({ code: 404, message: '分组不存在' });
    var newVal = folder.hide_from_all ? 0 : 1;
    db.prepare('UPDATE cloud_folders SET hide_from_all = ? WHERE id = ?').run(newVal, folderId);
    res.json({ code: 200, data: { hide_from_all: !!newVal } });
  } catch (e) {
    console.error('[Cloud] 切换分组显示失败:', e);
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// 重命名分组
router.put('/folders/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var folderId = parseInt(req.params.id, 10);
  var newName = (req.body.name || '').trim();

  if (!newName) {
    return res.status(400).json({ code: 400, message: '分组名称不能为空' });
  }
  if (newName.length > 50) {
    return res.status(400).json({ code: 400, message: '分组名称不能超过50个字符' });
  }

  var folder = db.prepare('SELECT * FROM cloud_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
  if (!folder) {
    return res.status(404).json({ code: 404, message: '分组不存在' });
  }

  var oldName = folder.name;

  try {
    // 更新文件夹名称 + 迁移文件中的 folder 字段
    db.prepare('UPDATE cloud_folders SET name = ? WHERE id = ? AND user_id = ?').run(newName, folderId, userId);
    db.prepare('UPDATE cloud_user_files SET folder = ? WHERE user_id = ? AND folder = ?').run(newName, userId, oldName);
    res.json({ code: 200, data: { id: folderId, name: newName } });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ code: 400, message: '分组名称已存在' });
    }
    console.error('[Cloud] 重命名分组失败:', e);
    res.status(500).json({ code: 500, message: '重命名失败' });
  }
});

// 删除分组（文件回到根目录）
router.delete('/folders/:id', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var folderId = parseInt(req.params.id, 10);

  var folder = db.prepare('SELECT * FROM cloud_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
  if (!folder) {
    return res.status(404).json({ code: 404, message: '分组不存在' });
  }

  // 文件移回根目录
  db.prepare('UPDATE cloud_user_files SET folder = \'\' WHERE user_id = ? AND folder = ?').run(userId, folder.name);
  // 删除分组
  db.prepare('DELETE FROM cloud_folders WHERE id = ? AND user_id = ?').run(folderId, userId);

  res.json({ code: 200, message: '分组已删除，文件已移回根目录' });
});

// ============ 批量操作 ============

// 批量移动文件到分组
router.post('/files/batch-move', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var hashes = req.body.hashes || [];
  var targetFolder = (req.body.folder || '').trim();

  if (!Array.isArray(hashes) || hashes.length === 0) {
    return res.status(400).json({ code: 400, message: '请选择至少一个文件' });
  }

  // 如果移动到非根目录，检查目标分组是否存在
  if (targetFolder !== '') {
    var folderExists = db.prepare('SELECT id FROM cloud_folders WHERE user_id = ? AND name = ?').get(userId, targetFolder);
    if (!folderExists) {
      return res.status(404).json({ code: 404, message: '目标分组不存在' });
    }
  }

  var moved = 0;
  var updateStmt = db.prepare('UPDATE cloud_user_files SET folder = ? WHERE user_id = ? AND file_hash = ? AND folder != ?');
  for (var i = 0; i < hashes.length; i++) {
    var result = updateStmt.run(targetFolder, userId, hashes[i], targetFolder);
    if (result.changes > 0) moved++;
  }

  res.json({ code: 200, data: { moved: moved, folder: targetFolder } });
});

// 批量删除文件（仅移除当前用户引用）
router.post('/files/batch-delete', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var items = req.body.items || []; // [{hash, is_owner}] 或简单 ['hash1','hash2']

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ code: 400, message: '请选择至少一个文件' });
  }

  var deleted = 0;
  var ownerDeletes = 0;

  for (var i = 0; i < items.length; i++) {
    var hash = typeof items[i] === 'string' ? items[i] : items[i].hash;
    var isOwner = typeof items[i] === 'object' ? items[i].is_owner : false;

    if (!/^[a-f0-9]{64}$/.test(hash)) continue;

    // 删除用户引用
    var refResult = db.prepare('DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?').run(userId, hash);
    if (refResult.changes === 0) continue;

    // 如果用户是 owner，执行物理删除
    if (isOwner) {
      var file = db.prepare('SELECT owner_user_id, storage_path FROM cloud_files WHERE hash = ? AND deleted = 0').get(hash);
      if (file && file.owner_user_id === userId) {
        // 移入 trash
        ensureDir(path.join(cloudDir, '.trash'));
        var srcPath = path.join(sharedDir, file.storage_path);
        var trashPath = path.join(cloudDir, '.trash', hash + path.extname(file.storage_path));
        try { if (fs.existsSync(srcPath)) fs.renameSync(srcPath, trashPath); } catch (e) {}
        db.prepare('UPDATE cloud_files SET deleted = 1 WHERE hash = ?').run(hash);
        db.prepare('DELETE FROM cloud_user_files WHERE file_hash = ?').run(hash);
        ownerDeletes++;
      }
    }
    deleted++;
  }

  res.json({
    code: 200,
    data: { deleted: deleted, owner_deletes: ownerDeletes },
    message: '已删除 ' + deleted + ' 个文件' + (ownerDeletes > 0 ? '（含 ' + ownerDeletes + ' 个物理删除）' : '')
  });
});

// ============ 分组分享 ============

var SHARE_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generateShareCode() {
  var code = '';
  for (var i = 0; i < 8; i++) {
    code += SHARE_CODE_CHARS.charAt(crypto.randomInt(0, SHARE_CODE_CHARS.length));
  }
  return code;
}

function generateUniqueShareCode() {
  for (var attempt = 0; attempt < 10; attempt++) {
    var code = generateShareCode();
    var existing = db.prepare('SELECT id FROM cloud_folders WHERE share_code = ?').get(code);
    if (!existing) return code;
  }
  return generateShareCode();
}

// 生成/刷新分享码
router.post('/folders/:id/share', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var folderId = parseInt(req.params.id, 10);

  var folder = db.prepare('SELECT * FROM cloud_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
  if (!folder) {
    return res.status(404).json({ code: 404, message: '分组不存在' });
  }

  var shareCode = generateUniqueShareCode();
  db.prepare('UPDATE cloud_folders SET share_code = ? WHERE id = ?').run(shareCode, folderId);

  // 跨服务器同步：广播分享码 + 文件列表到所有 peer 服务器
  // 解决跨班（跨服务器）分享码无效问题：分享码存储在创建者所在服务器数据库，
  // 需通过 relay-bus 同步到其他服务器，文件内容由 Syncthing/peer-fetch 保证跨服务器可访问
  try {
    var relayBus = require('../../../server/src/utils/relay-bus');
    var sourceFiles = db.prepare([
      'SELECT cuf.file_hash, cuf.display_name, cfl.size, cfl.mime_type, cfl.storage_path',
      'FROM cloud_user_files cuf',
      'JOIN cloud_files cfl ON cuf.file_hash = cfl.hash',
      'WHERE cuf.user_id = ? AND cuf.folder = ? AND cfl.deleted = 0'
    ].join('\n')).all(userId, folder.name);

    relayBus.emit('cloud_share_code_created', {
      share_code: shareCode,
      source_user_id: userId,
      folder_name: folder.name,
      files: sourceFiles.map(function(f) {
        return {
          hash: f.file_hash,
          display_name: f.display_name,
          size: f.size,
          mime_type: f.mime_type,
          storage_path: f.storage_path
        };
      })
    });
  } catch (e) {
    console.error('[Cloud] 分享码跨服务器同步失败:', e.message);
  }

  res.json({ code: 200, data: { share_code: shareCode, folder_name: folder.name } });
});

// 查看分享的分组信息
router.get('/folders/shared/:code', auth.requireAuth, function(req, res) {
  var code = (req.params.code || '').toUpperCase();

  var folder = db.prepare('SELECT cf.*, u.net_name as owner_name FROM cloud_folders cf LEFT JOIN users u ON cf.user_id = u.user_id WHERE cf.share_code = ?').get(code);
  if (!folder) {
    return res.status(404).json({ code: 404, message: '分享码无效或已失效' });
  }

  // 获取分组内的文件列表（预览前20个）
  var files = db.prepare([
    'SELECT cuf.file_hash, cuf.display_name, cfl.size, cfl.mime_type',
    'FROM cloud_user_files cuf',
    'JOIN cloud_files cfl ON cuf.file_hash = cfl.hash',
    'WHERE cuf.user_id = ? AND cuf.folder = ? AND cfl.deleted = 0',
    'LIMIT 20'
  ].join('\n')).all(folder.user_id, folder.name);

  var totalCount = db.prepare([
    'SELECT COUNT(*) as cnt FROM cloud_user_files cuf',
    'JOIN cloud_files cfl ON cuf.file_hash = cfl.hash',
    'WHERE cuf.user_id = ? AND cuf.folder = ? AND cfl.deleted = 0'
  ].join('\n')).get(folder.user_id, folder.name).cnt;

  res.json({
    code: 200,
    data: {
      folder_name: folder.name,
      owner_name: folder.owner_name || folder.user_id,
      total_files: totalCount,
      preview_files: files.map(function(f) {
        return {
          hash: f.file_hash,
          name: f.display_name,
          size: f.size,
          mime_type: f.mime_type
        };
      })
    }
  });
});

// 导入分享的分组
router.post('/folders/import/:code', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var code = (req.params.code || '').toUpperCase();

  var folder = db.prepare('SELECT * FROM cloud_folders WHERE share_code = ?').get(code);
  if (!folder) {
    return res.status(404).json({ code: 404, message: '分享码无效或已失效' });
  }

  if (folder.user_id === userId) {
    return res.status(400).json({ code: 400, message: '不能导入自己的分组' });
  }

  // 确保目标分组存在（不存在则创建）
  var targetFolder = db.prepare('SELECT id FROM cloud_folders WHERE user_id = ? AND name = ?').get(userId, folder.name);
  if (!targetFolder) {
    try {
      var createResult = db.prepare('INSERT INTO cloud_folders (user_id, name) VALUES (?, ?)').run(userId, folder.name);
      targetFolder = { id: createResult.lastInsertRowid };
    } catch (e) {
      // 同名分组可能被并发创建
      targetFolder = db.prepare('SELECT id FROM cloud_folders WHERE user_id = ? AND name = ?').get(userId, folder.name);
      if (!targetFolder) {
        return res.status(500).json({ code: 500, message: '创建目标分组失败' });
      }
    }
  }

  // 批量导入文件引用
  var sourceFiles = db.prepare([
    'SELECT cuf.file_hash, cuf.display_name',
    'FROM cloud_user_files cuf',
    'JOIN cloud_files cfl ON cuf.file_hash = cfl.hash',
    'WHERE cuf.user_id = ? AND cuf.folder = ? AND cfl.deleted = 0'
  ].join('\n')).all(folder.user_id, folder.name);

  var imported = 0;
  var skipped = 0;
  var insertStmt = db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name, folder) VALUES (?, ?, ?, ?)');

  for (var i = 0; i < sourceFiles.length; i++) {
    var result = insertStmt.run(userId, sourceFiles[i].file_hash, sourceFiles[i].display_name, folder.name);
    if (result.changes > 0) imported++;
    else skipped++;
  }

  res.json({
    code: 200,
    data: {
      folder_name: folder.name,
      imported: imported,
      skipped: skipped,
      total: sourceFiles.length
    },
    message: '成功导入 ' + imported + ' 个文件' + (skipped > 0 ? '，' + skipped + ' 个已存在跳过' : '')
  });
});

// ============ 班管审核 ============

// 全班上传流：所有云盘文件记录（含已下架），班管审查用
router.get('/admin/uploads', auth.requireAuth, auth.requirePermission('cloud_review'), function(req, res) {
  var statusFilter = (req.query.status || '').toLowerCase();
  var userFilter = (req.query.user_id || '').trim();
  var limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

  if (statusFilter !== 'ok' && statusFilter !== 'hidden') statusFilter = '';

  try {
    var sql = [
      'SELECT cf.hash, cf.original_name, cf.size, cf.mime_type, IFNULL(cf.status, \'ok\') AS status, cf.deleted, cf.created_at,',
      '       cf.owner_user_id, IFNULL(cf.source, \'app\') AS source, u.net_name AS owner_net_name, u.real_name AS owner_real_name,',
      '       (SELECT COUNT(*) FROM cloud_user_files cuf2 WHERE cuf2.file_hash = cf.hash) AS ref_count',
      'FROM cloud_files cf',
      'LEFT JOIN users u ON u.user_id = cf.owner_user_id',
      'WHERE 1=1'
    ];
    var params = [];
    if (req.query.channel === 'external') {
      // 班管审核只看「专属上传页」传来的文件；上传码(guest)与教室应用内(app)均不进审核流
      sql.push("AND IFNULL(cf.source, 'app') = 'lite'");
    }
    if (statusFilter === 'hidden') {
      sql.push("AND IFNULL(cf.status, 'ok') = 'hidden'");
    } else if (statusFilter === 'ok') {
      sql.push("AND IFNULL(cf.status, 'ok') = 'ok' AND cf.deleted = 0");
    }
    if (userFilter) {
      sql.push('AND cf.owner_user_id = ?');
      params.push(userFilter);
    }
    sql.push('ORDER BY cf.created_at DESC, cf.rowid DESC LIMIT ' + limit);

    var stmt = db.prepare(sql.join('\n'));
    var rows = stmt.all.apply(stmt, params);

    var files = rows.map(function(r) {
      return {
        hash: r.hash,
        name: r.original_name,
        size: r.size,
        mime_type: r.mime_type,
        status: r.status,
        deleted: r.deleted === 1,
        created_at: r.created_at,
        owner_id: r.owner_user_id,
        source: r.source,
        owner_name: r.owner_real_name || r.owner_net_name || r.owner_user_id,
        ref_count: r.ref_count,
        url: '/api/cloud/files/' + r.hash
      };
    });
    res.json({ code: 200, data: { files: files } });
  } catch (e) {
    console.error('[Cloud] 班管上传流查询失败:', e);
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

// 下架 / 恢复（下架后所有列表不可见、文件下发返回占位）
router.patch('/admin/files/:hash/status', auth.requireAuth, auth.requirePermission('cloud_review'), function(req, res) {
  var hash = req.params.hash;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ code: 400, message: '无效的文件标识' });
  }
  var status = req.body ? req.body.status : '';
  if (status !== 'ok' && status !== 'hidden') {
    return res.status(400).json({ code: 400, message: 'status 仅支持 ok / hidden' });
  }

  var file = db.prepare('SELECT hash, original_name FROM cloud_files WHERE hash = ?').get(hash);
  if (!file) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  db.prepare('UPDATE cloud_files SET status = ? WHERE hash = ?').run(status, hash);
  res.json({
    code: 200,
    message: (status === 'hidden' ? '已下架：' : '已恢复：') + file.original_name,
    data: { hash: hash, status: status }
  });
});

// ============ 错误处理中间件 ============

router.use(function(err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 400, message: '文件大小超过限制（最大200MB）' });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ code: 400, message: '文件数量超过限制（最多10个）' });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ code: 400, message: '意外的文件字段' });
  }
  if (err && err.message === '不支持的文件类型，仅支持图片/音频/视频') {
    return res.status(400).json({ code: 400, message: '不支持的文件类型，仅支持图片/音频/视频' });
  }
  if (err) {
    console.error('[Cloud] 上传错误:', err);
    return res.status(500).json({ code: 500, message: '上传失败：' + err.message });
  }
  next();
});

// ============ Cluss 互通（云盘 ⇄ Cluss 导入导出）============
//
// 方向与通道：
//   导出：学生在云盘勾选文件 → 本机 POST 到 Cluss 的 /api/cloud/upload（multipart）
//   导入：勾选 Cluss 云盘文件 → 拉回字节 → 复用 processUploadedFile 入本盘
//
// 认证：直接转发学生请求里的 CI JWT（Authorization 头）。Cluss 侧用共享的
// CI_JWT_SECRET 验签（与 iframe 免登同一条链路），首次访问会自动联邦落库，
// 文件始终落在同一个学生名下，不会串号。上游地址与 cluss-proxy.js 同源同配置。
//
// 限制（Cluss 侧既定，硬编码对齐，改了要同步 Cluss 的 cloud.js / cloud-store.js）：
//   · 单文件 10MB；每用户配额 200MB；上传限流 30 次/分钟/用户
//   · 类型仅图片 + 纯文本（txt/md/json/csv）；html/svg/js 等可执行格式不收

var http = require('http');

var CLUSS_HOST = process.env.CLUSS_PROXY_HOST || '127.0.0.1';
var CLUSS_PORT = parseInt(process.env.CLUSS_PROXY_PORT || '9003', 10);
var CLUSS_MAX_FILE_BYTES = 10 * 1024 * 1024;
var CLUSS_EXPORTABLE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.txt', '.md', '.json', '.csv'];
var CLUSS_BATCH_MAX = 10;

// 通用 HTTP 请求（服务端 → 本机 Cluss）。返回 { status, headers, buffer }。
function clussRequest(method, urlPath, headers, body, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var options = {
      host: CLUSS_HOST,
      port: CLUSS_PORT,
      method: method,
      path: urlPath,
      headers: headers || {}
    };
    var upstream = http.request(options, function(res) {
      var chunks = [];
      var size = 0;
      res.on('data', function(c) {
        size += c.length;
        if (size > 64 * 1024 * 1024) {
          upstream.destroy();
          reject(new Error('Cluss 响应过大'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', function() {
        resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    upstream.setTimeout(timeoutMs || 8000, function() {
      upstream.destroy(new Error('Cluss 请求超时'));
    });
    upstream.on('error', reject);
    if (body) upstream.write(body);
    upstream.end();
  });
}

function clussJson(buffer) {
  try { return JSON.parse(buffer.toString('utf8')); } catch (e) { return null; }
}

// 转发学生的 CI JWT 给 Cluss（Cluss 凭共享密钥验签并自动联邦落库）
function clussAuthHeaders(req, extra) {
  var h = { Authorization: req.headers.authorization || '' };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

function clussUnavailable(res, err) {
  console.error('[Cloud] Cluss 不可达 (' + CLUSS_HOST + ':' + CLUSS_PORT + '):', err.message);
  return res.status(502).json({ code: 502, message: 'Cluss 没有启动或暂时不可达' });
}

function clussExportableExt(name) {
  var ext = path.extname(name || '').toLowerCase();
  return CLUSS_EXPORTABLE_EXTS.indexOf(ext) !== -1;
}

// multipart 单文件体（Cluss 上传字段名固定为 file；multer 2.x 按 UTF-8 解析文件名）
function clussMultipart(filename, mime, fileBuf) {
  var boundary = '----ClassIntraCluss' + crypto.randomBytes(12).toString('hex');
  var safeName = String(filename || 'file').replace(/[\"\r\n]/g, '').slice(0, 200) || 'file';
  var head = '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + safeName + '"\r\n' +
    'Content-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n';
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: Buffer.concat([Buffer.from(head, 'utf8'), fileBuf, Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8')])
  };
}

// Cluss 存活探测（/api/health 无需鉴权）
router.get('/cluss/status', auth.requireAuth, function(req, res) {
  clussRequest('GET', '/api/health', {}, null, 2000).then(function(r) {
    var json = clussJson(r.buffer) || {};
    res.json({
      code: 200,
      data: {
        available: r.status === 200,
        version: (json.data && json.data.version) || ''
      }
    });
  }).catch(function(err) {
    res.json({ code: 200, data: { available: false, version: '' } });
  });
});

// Cluss 云盘概览：文件列表 + 配额（一次拉齐，导入弹窗用）
router.get('/cluss/overview', auth.requireAuth, function(req, res) {
  Promise.all([
    clussRequest('GET', '/api/cloud/files?limit=200', clussAuthHeaders(req), null, 8000),
    clussRequest('GET', '/api/cloud/quota', clussAuthHeaders(req), null, 8000)
  ]).then(function(rs) {
    var filesRes = clussJson(rs[0].buffer);
    var quotaRes = clussJson(rs[1].buffer);
    if (rs[0].status === 401 || rs[1].status === 401) {
      return res.status(401).json({ code: 401, message: 'Cluss 登录态校验失败，请重新进入 Cluss 应用后再试' });
    }
    res.json({
      code: 200,
      data: {
        files: (filesRes && filesRes.data && filesRes.data.files) || [],
        quota: (quotaRes && quotaRes.data) || null
      }
    });
  }).catch(function(err) {
    clussUnavailable(res, err);
  });
});

// Cluss 缩略图代理（导入弹窗里图片预览；?thumb=1 由 Cluss 磁盘缓存）
router.get('/cluss/thumb/:hash', auth.requireAuth, function(req, res) {
  var hash = String(req.params.hash || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ code: 400, message: 'hash 不合法' });
  }
  clussRequest('GET', '/api/cloud/files/' + hash + '?thumb=1', clussAuthHeaders(req), null, 8000).then(function(r) {
    if (r.status !== 200) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(r.buffer);
  }).catch(function() {
    res.status(502).end();
  });
});

// 导出到 Cluss：body { hashes: [本盘 hash] }，单次最多 10 个，顺序发送（Cluss 限流 30/分钟）
router.post('/cluss/export', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var hashes = Array.isArray(req.body.hashes) ? req.body.hashes.slice(0, CLUSS_BATCH_MAX) : [];
  if (!hashes.length) {
    return res.status(400).json({ code: 400, message: '没有要导出的文件' });
  }

  var results = [];
  var chain = Promise.resolve();
  hashes.forEach(function(hash) {
    chain = chain.then(function() {
      var itemHash = String(hash || '');
      var row = db.prepare([
        'SELECT cf.hash, cf.size, cf.mime_type, cf.storage_path, cf.status, cuf.display_name',
        'FROM cloud_user_files cuf JOIN cloud_files cf ON cuf.file_hash = cf.hash',
        'WHERE cuf.user_id = ? AND cuf.file_hash = ? AND cf.deleted = 0'
      ].join('\n')).get(userId, itemHash);

      if (!row) {
        results.push({ hash: itemHash, name: '', ok: false, reason: '文件不存在或已删除' });
        return;
      }
      if (row.status === 'hidden') {
        results.push({ hash: itemHash, name: row.display_name, ok: false, reason: '文件已被班管下架' });
        return;
      }
      if (!clussExportableExt(row.display_name)) {
        results.push({ hash: itemHash, name: row.display_name, ok: false, reason: 'Cluss 仅支持图片与 txt/md/json/csv 文本' });
        return;
      }
      if (row.size > CLUSS_MAX_FILE_BYTES) {
        results.push({ hash: itemHash, name: row.display_name, ok: false, reason: '超过 Cluss 单文件 10MB 限制' });
        return;
      }

      var filePath = path.join(sharedDir, row.storage_path);
      var fileBuf;
      try {
        fileBuf = fs.readFileSync(filePath);
      } catch (e) {
        results.push({ hash: itemHash, name: row.display_name, ok: false, reason: '物理文件缺失' });
        return;
      }

      var mp = clussMultipart(row.display_name, row.mime_type, fileBuf);
      return clussRequest('POST', '/api/cloud/upload', clussAuthHeaders(req, {
        'Content-Type': mp.contentType,
        'Content-Length': mp.body.length
      }), mp.body, 20000).then(function(r) {
        var json = clussJson(r.buffer);
        if (r.status === 200 && json && json.data && json.data.hash) {
          results.push({ hash: itemHash, name: row.display_name, ok: true, cluss_hash: json.data.hash, duplicated: !!json.data.duplicated });
          console.log('[Cloud] 导出到 Cluss: %s → %s (%s)', row.display_name, json.data.hash.slice(0, 12), userId);
        } else {
          results.push({ hash: itemHash, name: row.display_name, ok: false, reason: (json && json.message) || ('Cluss 返回 ' + r.status) });
        }
      }).catch(function(err) {
        results.push({ hash: itemHash, name: row.display_name, ok: false, reason: err.message || '导出失败' });
      });
    });
  });

  chain.then(function() {
    var okCount = 0;
    for (var i = 0; i < results.length; i++) if (results[i].ok) okCount++;
    res.json({ code: 200, data: { results: results, ok_count: okCount, total: hashes.length } });
  }).catch(function(err) {
    console.error('[Cloud] Cluss 导出异常:', err);
    res.status(500).json({ code: 500, message: '导出失败：' + err.message });
  });
});

// 从 Cluss 导入：body { items: [{ hash, name }] }，单次最多 10 个
router.post('/cluss/import', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var items = Array.isArray(req.body.items) ? req.body.items.slice(0, CLUSS_BATCH_MAX) : [];
  if (!items.length) {
    return res.status(400).json({ code: 400, message: '没有要导入的文件' });
  }

  ensureDir(tmpDir);
  var results = [];
  var chain = Promise.resolve();

  items.forEach(function(it) {
    chain = chain.then(function() {
      var hash = String((it && it.hash) || '');
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        results.push({ hash: hash, name: (it && it.name) || '', ok: false, reason: 'hash 不合法' });
        return;
      }
      // 名字取自 Cluss 列表：剥路径、去控制字符、封顶（与 Cluss 侧 200 封顶一致）
      var name = path.basename(String((it && it.name) || '')).replace(/[\x00-\x1f]/g, '').slice(0, 200) || hash;
      if (!resolveUploadExt(name, '')) {
        results.push({ hash: hash, name: name, ok: false, reason: '不支持的文件类型' });
        return;
      }

      return clussRequest('GET', '/api/cloud/files/' + hash, clussAuthHeaders(req), null, 20000).then(function(r) {
        if (r.status !== 200 || !r.buffer.length) {
          var json = clussJson(r.buffer);
          results.push({ hash: hash, name: name, ok: false, reason: (json && json.message) || ('Cluss 返回 ' + r.status) });
          return;
        }

        // 落 .tmp 后走与普通上传完全相同的入库管道（哈希去重/引用登记）
        var tmpPath = path.join(tmpDir, 'cluss_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + path.extname(name).toLowerCase());
        fs.writeFileSync(tmpPath, r.buffer);
        return processUploadedFile(tmpPath, name, userId, '', 'app').then(function(saved) {
          results.push({ hash: hash, name: name, ok: true, ci_hash: saved.hash, existed: !!saved.existed });
          console.log('[Cloud] 从 Cluss 导入: %s → %s (%s)', name, saved.hash.slice(0, 12), userId);
        }).catch(function(err) {
          try { fs.unlinkSync(tmpPath); } catch (e2) {}
          results.push({ hash: hash, name: name, ok: false, reason: err.message || '入库失败' });
        });
      }).catch(function(err) {
        results.push({ hash: hash, name: name, ok: false, reason: err.message || '导入失败' });
      });
    });
  });

  chain.then(function() {
    var okCount = 0;
    for (var i = 0; i < results.length; i++) if (results[i].ok) okCount++;
    res.json({ code: 200, data: { results: results, ok_count: okCount, total: items.length } });
  }).catch(function(err) {
    console.error('[Cloud] Cluss 导入异常:', err);
    res.status(500).json({ code: 500, message: '导入失败：' + err.message });
  });
});

module.exports = router;
