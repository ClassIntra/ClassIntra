var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var multer = require('multer');
var auth = require('../middleware/auth');
var db = require('../utils/db');
var transcoder = require('../services/stream-transcoder');

// 云盘根目录
var cloudDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'), 'cloud');
var sharedDir = path.join(cloudDir, 'shared');
var tmpDir = path.join(cloudDir, '.tmp');
var trashDir = path.join(cloudDir, '.trash');

// 需要转码为 mp4 的视频扩展名（mp4 本身跳过）
var TRANSCODE_EXTS = ['.mov', '.mkv', '.avi', '.webm', '.3gp'];

// 媒体文件 MIME 类型映射
var MEDIA_MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
};

// ========== 文件服务 ==========

// 流式发送媒体文件，支持 Range 请求（视频/音频播放必需）
function sendMediaFile(req, res, filePath) {
  var stat;
  try { stat = fs.statSync(filePath); } catch (e) { return false; }

  var ext = path.extname(filePath).toLowerCase();
  var mimeType = MEDIA_MIME[ext] || 'application/octet-stream';
  var isVideo = mimeType.indexOf('video/') === 0;
  var isAudio = mimeType.indexOf('audio/') === 0;

  // 覆盖全局 no-cache：媒体文件允许浏览器缓存和缓冲
  res.set('Content-Type', mimeType);
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'public, max-age=3600');
  res.removeHeader('Pragma');
  res.removeHeader('Expires');

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
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(svg, 'utf8'));
  } else {
    // 音频/视频返回 410 Gone
    res.status(410).json({ code: 410, message: '文件已被上传者删除' });
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
function processUploadedFile(tmpFilePath, originalName, userId) {
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
        var refResult = db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, originalName);

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

      db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(hash, userId, originalName, stat.size, mimeType, storagePath);
      db.prepare('INSERT INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, originalName);

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
    var ext = path.extname(file.originalname) || '.bin';
    var tmpName = 'upload_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, tmpName);
  }
});
var upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
                   '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus',
                   '.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowed.indexOf(ext) === -1) {
      return cb(new Error('不支持的文件类型，仅支持图片/音频/视频'));
    }
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
    var ext = path.extname(file.originalname) || '.bin';
    var tmpName = 'guest_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, tmpName);
  }
});
var guestUpload = multer({
  storage: guestStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
                   '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus',
                   '.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowed.indexOf(ext) === -1) {
      return cb(new Error('不支持的文件类型，仅支持图片/音频/视频'));
    }
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
  var ownerId = req.guestOwnerId;
  var filePath = req.file.path;
  var originalName = req.file.originalname;

  processUploadedFile(filePath, originalName, ownerId).then(function(result) {
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

// 列出用户云盘文件（从数据库查询，自动过滤已删除文件）
router.get('/files', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;

  try {
    var files = db.prepare([
      'SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,',
      '       cf.size, cf.mime_type, cf.owner_user_id',
      'FROM cloud_user_files cuf',
      'JOIN cloud_files cf ON cuf.file_hash = cf.hash',
      'WHERE cuf.user_id = ? AND cf.deleted = 0',
      'ORDER BY cuf.uploaded_at DESC'
    ].join('\n')).all(userId);

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
  var userId = req.user.user_id;
  var filePath = req.file.path;
  var originalName = req.file.originalname;

  processUploadedFile(filePath, originalName, userId).then(function(result) {
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
  var files = req.files;
  var results = [];
  var idx = 0;

  function processNext() {
    if (idx >= files.length) {
      return res.json({ code: 200, data: { files: results } });
    }
    var f = files[idx];
    idx++;
    processUploadedFile(f.path, f.originalname, userId).then(function(result) {
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

  // 判断是否为 64 位十六进制哈希
  if (!/^[a-f0-9]{64}$/.test(param)) {
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
  var file = db.prepare('SELECT storage_path, deleted, mime_type FROM cloud_files WHERE hash = ?').get(fileHash);
  if (!file) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  if (file.deleted === 1) {
    return sendDeletedPlaceholder(res, file.mime_type);
  }

  var filePath = path.join(sharedDir, file.storage_path);
  if (!fs.existsSync(filePath)) {
    // 物理文件丢失，标记为已删除
    db.prepare('UPDATE cloud_files SET deleted = 1 WHERE hash = ?').run(fileHash);
    return sendDeletedPlaceholder(res, file.mime_type);
  }

  return sendMediaFile(req, res, filePath);
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
    if (urlParam.indexOf('..') !== -1 || urlParam.indexOf('/') !== -1 || urlParam.indexOf('\\') !== -1) {
      return res.status(400).json({ code: 400, message: '无效的文件 URL' });
    }

    if (/^[a-f0-9]{64}$/.test(urlParam)) {
      // 新格式：直接是哈希
      fileHash = urlParam;
    } else {
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
    // 系统资源文件：复制到 shared/ 并创建记录
    var resourcesDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'));
    var sourcePath = path.resolve(resourcesDir, imageUrl.replace('/resources/', ''));
    if (sourcePath.indexOf(resourcesDir + path.sep) !== 0 && sourcePath !== resourcesDir) {
      return res.status(400).json({ code: 400, message: '无效的文件路径' });
    }
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    try {
      fileHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
      var ext = path.extname(sourcePath).toLowerCase();
      var existing = db.prepare('SELECT hash FROM cloud_files WHERE hash = ?').get(fileHash);

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
      fileHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath2)).digest('hex');
      var ext2 = path.extname(sourcePath2).toLowerCase();
      var existing2 = db.prepare('SELECT hash FROM cloud_files WHERE hash = ?').get(fileHash);

      if (!existing2) {
        var prefix2 = fileHash.substring(0, 2);
        ensureDir(path.join(sharedDir, prefix2));
        var storagePath2 = prefix2 + '/' + fileHash + ext2;
        fs.copyFileSync(sourcePath2, path.join(sharedDir, storagePath2));
        var stat2 = fs.statSync(sourcePath2);
        var mimeType2 = guessMimeType(ext2, path.basename(sourcePath2));
        db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(fileHash, '__system__', path.basename(sourcePath2), stat2.size, mimeType2, storagePath2);
        displayName = path.basename(sourcePath2);
      } else {
        displayName = existing2.original_name || path.basename(sourcePath2);
      }
    } catch (e) {
      console.error('[Cloud] 转存照片失败:', e);
      return res.status(500).json({ code: 500, message: '文件处理失败' });
    }
  }

  if (!fileHash) {
    return res.status(404).json({ code: 404, message: '无法定位源文件' });
  }

  // 检查源文件是否已被删除
  var cloudFile = db.prepare('SELECT hash, size, deleted FROM cloud_files WHERE hash = ?').get(fileHash);
  if (!cloudFile || cloudFile.deleted === 1) {
    return res.status(404).json({ code: 404, message: '源文件已被删除' });
  }

  // 建立引用
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

module.exports = router;
