var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var multer = require('multer');
var auth = require('../middleware/auth');
var db = require('../utils/db');

// 云盘根目录
var cloudDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'), 'cloud');

// 确保云盘目录存在
function ensureUserDir(userId) {
  var userDir = path.join(cloudDir, String(userId));
  var photoDir = path.join(userDir, 'photos');
  var noteDir = path.join(userDir, 'note');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(photoDir, { recursive: true });
    fs.mkdirSync(noteDir, { recursive: true });
  } else {
    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
    if (!fs.existsSync(noteDir)) fs.mkdirSync(noteDir, { recursive: true });
  }
  return userDir;
}

// 获取用户云盘目录
function getUserDir(userId) {
  return path.join(cloudDir, String(userId));
}

// 文件上传配置
var storage = multer.diskStorage({
  destination: function(req, file, cb) {
    var userDir = getUserDir(req.user.user_id);
    var photoDir = path.join(userDir, 'photos');
    if (!fs.existsSync(photoDir)) {
      fs.mkdirSync(photoDir, { recursive: true });
    }
    cb(null, photoDir);
  },
  filename: function(req, file, cb) {
    var userId = req.user.user_id;
    var ext = path.extname(file.originalname) || '.jpg';
    // 将媒体类型编码进文件名，解决 .webm/.mp4 扩展名歧义（录音 audio/webm 与录像 video/webm 都带 .webm）
    var mediaType = (req.body && req.body.mediaType) || '';
    var tag = '';
    if (mediaType === 'audio') tag = '__audio';
    else if (mediaType === 'video') tag = '__video';
    else if (mediaType === 'image') tag = '__image';
    var filename = userId + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + tag + ext;
    cb(null, filename);
  }
});
var upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB，支持录像
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

// ============ 上传码（免登录跨浏览器上传）============
// 码字符集：去掉易混淆字符 0/O/1/I/L
var CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
var MAX_FAIL_COUNT = 5;
var LOCK_MINUTES = 5;

function generateCode() {
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

// 生成唯一码（防碰撞）
function generateUniqueCode() {
  for (var attempt = 0; attempt < 10; attempt++) {
    var code = generateCode();
    var existing = db.prepare('SELECT code FROM upload_codes WHERE code = ?').get(code);
    if (!existing) return code;
  }
  return generateCode(); // 兜底
}

// 验证上传码：返回 { ownerId, error }
function verifyUploadCode(code) {
  if (!code || code.length !== 6) {
    return { ownerId: null, error: '上传码格式不正确' };
  }
  var row = db.prepare('SELECT * FROM upload_codes WHERE code = ?').get(code.toUpperCase());
  if (!row) {
    return { ownerId: null, error: '上传码无效' };
  }
  // 检查锁定
  if (row.locked_until) {
    var lockedUntil = new Date(row.locked_until + 'Z').getTime();
    if (Date.now() < lockedUntil) {
      var remainMin = Math.ceil((lockedUntil - Date.now()) / 60000);
      return { ownerId: null, error: '上传码已被锁定，请 ' + remainMin + ' 分钟后再试' };
    }
    // 锁定过期，重置
    db.prepare('UPDATE upload_codes SET fail_count = 0, locked_until = NULL WHERE code = ?').run(row.code);
  }
  return { ownerId: row.owner_id, error: null };
}

// 记录验证失败
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

// 验证成功重置失败计数
function resetCodeFailCount(code) {
  db.prepare('UPDATE upload_codes SET fail_count = 0, locked_until = NULL WHERE code = ?').run((code || '').toUpperCase());
}

// 免登录上传的 multer 配置（在 destination 中验证上传码）
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
    var photoDir = path.join(getUserDir(result.ownerId), 'photos');
    if (!fs.existsSync(photoDir)) {
      fs.mkdirSync(photoDir, { recursive: true });
    }
    cb(null, photoDir);
  },
  filename: function(req, file, cb) {
    var ownerId = req.guestOwnerId;
    var ext = path.extname(file.originalname) || '.bin';
    // 将媒体类型编码进文件名，解决 .webm/.mp4 扩展名歧义（录音 audio/webm 与录像 video/webm 都带 .webm）
    var mediaType = (req.body && req.body.mediaType) || '';
    var tag = '';
    if (mediaType === 'audio') tag = '__audio';
    else if (mediaType === 'video') tag = '__video';
    else if (mediaType === 'image') tag = '__image';
    var filename = ownerId + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + tag + ext;
    cb(null, filename);
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

// 生成/刷新上传码（已登录用户）
router.post('/upload-code', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var newCode = generateUniqueCode();
  // 替换该用户的所有旧码（一个用户只保留一个有效码）
  db.prepare('DELETE FROM upload_codes WHERE owner_id = ?').run(userId);
  db.prepare('INSERT INTO upload_codes (code, owner_id, fail_count, locked_until) VALUES (?, ?, 0, NULL)').run(newCode, userId);
  res.json({ code: 200, data: { code: newCode, created_at: new Date().toISOString() } });
});

// 获取当前上传码（已登录用户，如不存在则自动生成）
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

// 免登录上传（通过上传码认证）
router.post('/guest-upload', guestUpload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  res.json({
    code: 200,
    data: {
      name: req.file.filename,
      size: req.file.size,
      url: '/api/cloud/files/' + encodeURIComponent(req.file.filename)
    }
  });
});

// guest-upload 的错误处理（上传码无效/文件类型不支持等）
router.use('/guest-upload', function(err, req, res, next) {
  if (err) {
    var msg = err.message || '上传失败';
    // multer 文件大小限制
    if (err.code === 'LIMIT_FILE_SIZE') {
      msg = '文件超过 200MB 限制';
    }
    return res.status(400).json({ code: 400, message: msg });
  }
  next();
});

// 验证上传码（前端检查码是否有效，不记录失败次数）
router.post('/verify-code', function(req, res) {
  var code = (req.body && req.body.code) || '';
  var result = verifyUploadCode(code);
  if (result.ownerId) {
    res.json({ code: 200, data: { valid: true } });
  } else {
    res.json({ code: 200, data: { valid: false, message: result.error } });
  }
});

// 列出用户云盘文件（不包含 note 目录）
router.get('/files', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var userDir = getUserDir(userId);
  ensureUserDir(userId);

  var photoDir = path.join(userDir, 'photos');
  var files = [];

  try {
    var entries = fs.readdirSync(photoDir);
    for (var i = 0; i < entries.length; i++) {
      var filePath = path.join(photoDir, entries[i]);
      var stat = fs.statSync(filePath);
      if (stat.isFile()) {
        files.push({
          name: entries[i],
          size: stat.size,
          created_at: stat.mtime.toISOString(),
          url: '/api/cloud/files/' + encodeURIComponent(entries[i])
        });
      }
    }
    files.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
  } catch (e) {}

  res.json({ code: 200, data: { files: files } });
});

// 上传文件
router.post('/upload', auth.requireAuth, upload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  res.json({
    code: 200,
    data: {
      name: req.file.filename,
      size: req.file.size,
      url: '/api/cloud/files/' + encodeURIComponent(req.file.filename)
    }
  });
});

// 批量上传
router.post('/upload-batch', auth.requireAuth, upload.array('files', 10), function(req, res) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ code: 400, message: '未收到文件' });
  }
  var results = req.files.map(function(f) {
    return {
      name: f.filename,
      size: f.size,
      url: '/api/cloud/files/' + encodeURIComponent(f.filename)
    };
  });
  res.json({ code: 200, data: { files: results } });
});

// 获取文件（需登录，支持访问其他用户的共享图片）
router.get('/files/:filename', auth.requireAuth, function(req, res) {
  var filename = decodeURIComponent(req.params.filename);

  // 安全检查：防止路径遍历
  if (filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的文件名' });
  }

  // 新格式文件名：userId_timestamp_random.ext
  var parts = filename.split('_');
  if (parts.length >= 3) {
    var ownerId = parts[0];
    var filePath = path.join(getUserDir(ownerId), 'photos', filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }

  // 旧格式文件名：timestamp_random.ext - 遍历所有用户目录查找
  try {
    if (fs.existsSync(cloudDir)) {
      var users = fs.readdirSync(cloudDir);
      for (var i = 0; i < users.length; i++) {
        var candidatePath = path.join(cloudDir, users[i], 'photos', filename);
        if (fs.existsSync(candidatePath)) {
          return res.sendFile(candidatePath);
        }
      }
    }
  } catch (e) {
    // ignore
  }

  res.status(404).json({ code: 404, message: '文件不存在' });
});

// 删除文件
router.delete('/files/:filename', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var filename = decodeURIComponent(req.params.filename);

  if (filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的文件名' });
  }

  var filePath = path.join(getUserDir(userId), 'photos', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  fs.unlinkSync(filePath);
  res.json({ code: 200, message: '删除成功' });
});

// 保存笔记到 note 目录
router.post('/note/:noteId', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var noteId = req.params.noteId;
  var content = req.body.content || '';

  // 安全检查
  if (noteId.indexOf('..') !== -1 || noteId.indexOf('/') !== -1 || noteId.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的笔记ID' });
  }

  ensureUserDir(userId);
  var notePath = path.join(getUserDir(userId), 'note', noteId + '.json');

  var noteData = {
    id: noteId,
    content: content,
    title: req.body.title || '',
    tags: req.body.tags || [],
    folder: req.body.folder || '默认',
    updated_at: new Date().toISOString()
  };

  fs.writeFileSync(notePath, JSON.stringify(noteData, null, 2), 'utf8');
  res.json({ code: 200, data: noteData });
});

// 读取笔记
router.get('/note/:noteId', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var noteId = req.params.noteId;

  if (noteId.indexOf('..') !== -1 || noteId.indexOf('/') !== -1 || noteId.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的笔记ID' });
  }

  var notePath = path.join(getUserDir(userId), 'note', noteId + '.json');

  if (!fs.existsSync(notePath)) {
    return res.status(404).json({ code: 404, message: '笔记不存在' });
  }

  var data = fs.readFileSync(notePath, 'utf8');
  res.json({ code: 200, data: JSON.parse(data) });
});

// 列出所有笔记
router.get('/notes', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var noteDir = path.join(getUserDir(userId), 'note');

  if (!fs.existsSync(noteDir)) {
    return res.json({ code: 200, data: { notes: [] } });
  }

  var notes = [];
  var entries = fs.readdirSync(noteDir);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].endsWith('.json')) {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(noteDir, entries[i]), 'utf8'));
        notes.push({
          id: data.id,
          title: data.title || '未命名',
          folder: data.folder || '默认',
          updated_at: data.updated_at,
          tags: data.tags || []
        });
      } catch (e) {}
    }
  }
  notes.sort(function(a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
  res.json({ code: 200, data: { notes: notes } });
});

// 删除笔记
router.delete('/note/:noteId', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var noteId = req.params.noteId;

  if (noteId.indexOf('..') !== -1 || noteId.indexOf('/') !== -1 || noteId.indexOf('\\') !== -1) {
    return res.status(400).json({ code: 400, message: '无效的笔记ID' });
  }

  var notePath = path.join(getUserDir(userId), 'note', noteId + '.json');

  if (fs.existsSync(notePath)) {
    fs.unlinkSync(notePath);
  }

  res.json({ code: 200, message: '删除成功' });
});

// 从 URL 保存图片到云盘
router.post('/save-from-url', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var imageUrl = req.body.url;

  if (!imageUrl) {
    return res.status(400).json({ code: 400, message: '缺少图片 URL' });
  }

  // 验证 URL 是否来自本站（安全考虑）
  var allowedPrefixes = ['/api/cloud/files/', '/resources/', '/api/photos/'];
  var isAllowed = false;
  for (var i = 0; i < allowedPrefixes.length; i++) {
    if (imageUrl.indexOf(allowedPrefixes[i]) === 0) {
      isAllowed = true;
      break;
    }
  }

  if (!isAllowed) {
    return res.status(400).json({ code: 400, message: '仅支持转存本站图片' });
  }

  // 查找源文件路径
  var filePath;
  if (imageUrl.indexOf('/api/cloud/files/') === 0) {
    // 云盘图片：可能来自任意用户，遍历查找
    var filename = decodeURIComponent(imageUrl.replace('/api/cloud/files/', ''));
    // 安全检查
    if (filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1) {
      return res.status(400).json({ code: 400, message: '无效的文件名' });
    }
    // 新格式：userId_timestamp_random.ext → 从该用户目录查找
    var parts = filename.split('_');
    if (parts.length >= 3) {
      var ownerId = parts[0];
      var candidatePath = path.join(getUserDir(ownerId), 'photos', filename);
      if (fs.existsSync(candidatePath)) {
        filePath = candidatePath;
      }
    }
    // 旧格式或无主文件：遍历所有用户云盘
    if (!filePath) {
      try {
        if (fs.existsSync(cloudDir)) {
          var users = fs.readdirSync(cloudDir);
          for (var u = 0; u < users.length; u++) {
            var candidatePath = path.join(cloudDir, users[u], 'photos', filename);
            if (fs.existsSync(candidatePath)) {
              filePath = candidatePath;
              break;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (!filePath) {
      return res.status(404).json({ code: 404, message: '图片不存在' });
    }
  } else if (imageUrl.indexOf('/resources/') === 0) {
    // Resources 目录下的图片
    var resourcesDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'));
    filePath = path.join(resourcesDir, imageUrl.replace('/resources/', ''));
    // 安全检查
    if (filePath.indexOf('..') !== -1) {
      return res.status(400).json({ code: 400, message: '无效的图片路径' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: '图片不存在' });
    }
  } else if (imageUrl.indexOf('/api/photos/') === 0) {
    // Photos API 的图片
    var resourcesDir = path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources'));
    filePath = path.join(resourcesDir, 'public', 'photos', imageUrl.replace('/api/photos/', ''));
    if (filePath.indexOf('..') !== -1) {
      return res.status(400).json({ code: 400, message: '无效的图片路径' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: '图片不存在' });
    }
  }

  // 确保用户云盘目录存在
  ensureUserDir(userId);
  var photoDir = path.join(getUserDir(userId), 'photos');

  // 生成新的文件名
  var ext = path.extname(filePath) || '.jpg';
  var newFilename = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
  var newFilePath = path.join(photoDir, newFilename);

  // 复制文件到用户云盘
  try {
    fs.copyFileSync(filePath, newFilePath);
    res.json({
      code: 200,
      data: {
        name: newFilename,
        size: fs.statSync(newFilePath).size,
        url: '/api/cloud/files/' + encodeURIComponent(newFilename)
      }
    });
  } catch (e) {
    console.error('[Cloud] 转存图片失败:', e);
    res.status(500).json({ code: 500, message: '转存失败：' + e.message });
  }
});

// Multer 错误处理中间件
router.use(function(err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 400, message: '文件大小超过限制（最大20MB）' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ code: 400, message: '文件数量超过限制（最多10个）' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ code: 400, message: '意外的文件字段' });
  }
  if (err.message === '不支持的文件类型，仅支持图片/音频/视频') {
    return res.status(400).json({ code: 400, message: '不支持的文件类型，仅支持图片/音频/视频' });
  }
  // 其他错误
  console.error('[Cloud] 上传错误:', err);
  res.status(500).json({ code: 500, message: '上传失败：' + err.message });
});

module.exports = router;
