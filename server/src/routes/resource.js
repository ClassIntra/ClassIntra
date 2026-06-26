var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var auth = require('../middleware/auth');
var config = require('../config');

var RESOURCES_DIR = config.resourcesDir;

if (!fs.existsSync(RESOURCES_DIR)) {
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
}

var db = require('../utils/db');

function getHiddenFolders(req) {
  var hidden = ['public', 'cloud'];
  if (req.user && req.user.is_admin) {
    hidden = ['cloud'];
  }
  if (!req.user || !req.user.is_admin) {
    try {
      var row = db.prepare('SELECT resource_settings_json FROM user_settings WHERE user_id = ?').get('__system__');
      if (row && row.resource_settings_json) {
        var settings = JSON.parse(row.resource_settings_json);
        // 兼容旧版 media_visible
        if (typeof settings.media_visible !== 'undefined' && typeof settings.video_visible === 'undefined' && typeof settings.music_visible === 'undefined') {
          if (settings.media_visible === false) {
            hidden.push('videos', 'music');
          }
        } else {
          if (settings.video_visible === false) {
            hidden.push('videos');
          }
          if (settings.music_visible === false) {
            hidden.push('music');
          }
        }
      }
    } catch (e) {}
  }
  return hidden;
}

function isPathSafe(userPath) {
  if (!userPath) return true;
  var resolved = path.resolve(RESOURCES_DIR, userPath || '');
  if (!resolved.startsWith(RESOURCES_DIR)) return false;
  var basename = path.basename(userPath);
  if (basename !== basename.replace(/[\r\n"\\]/g, '')) return false;
  return true;
}

function isNameSafe(name) {
  if (!name) return false;
  if (name !== name.replace(/[\r\n"\\]/g, '')) return false;
  if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return false;
  if (name === '.' || name === '..') return false;
  return true;
}

function getFullPath(userPath) {
  return path.resolve(RESOURCES_DIR, userPath || '');
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var srcPath = path.join(src, entries[i].name);
    var destPath = path.join(dest, entries[i].name);
    if (entries[i].isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmDirSync(dirPath) {
  var entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var fullPath = path.join(dirPath, entries[i].name);
    if (entries[i].isDirectory()) {
      rmDirSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
  fs.rmdirSync(dirPath);
}

function getFileType(ext) {
  var videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'];
  var imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  var audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];
  var docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  var textExts = ['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'htm', 'xml', 'py', 'java', 'c', 'cpp', 'vue', 'jsx', 'csv'];
  var archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];

  var lowerExt = (ext || '').toLowerCase();
  if (videoExts.indexOf(lowerExt) !== -1) return 'video';
  if (imageExts.indexOf(lowerExt) !== -1) return 'image';
  if (audioExts.indexOf(lowerExt) !== -1) return 'audio';
  if (docExts.indexOf(lowerExt) !== -1) return 'document';
  if (textExts.indexOf(lowerExt) !== -1) return 'text';
  if (archiveExts.indexOf(lowerExt) !== -1) return 'archive';
  return 'other';
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function buildBreadcrumb(dirPath) {
  if (!dirPath) return [{ name: '根目录', path: '' }];
  var parts = dirPath.split('/').filter(function(p) { return p; });
  var crumbs = [{ name: '根目录', path: '' }];
  var currentPath = '';
  for (var i = 0; i < parts.length; i++) {
    currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
    crumbs.push({ name: parts[i], path: currentPath });
  }
  return crumbs;
}

router.use(auth.requireAuth);

// ── 流媒体转码路由（MKV → MP4 实时转码）──

var streamTranscoder = require('../services/stream-transcoder');
var _ffmpegAvailable = null;

function isFFmpegAvailable() {
  if (_ffmpegAvailable === null) {
    _ffmpegAvailable = streamTranscoder.checkFFmpeg();
  }
  return _ffmpegAvailable;
}

// 转码并返回渐进式 MP4 流
router.get('/stream', async function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  if (!isFFmpegAvailable()) {
    return res.status(500).json({
      code: 500,
      message: '服务器未安装 ffmpeg，无法播放 MKV 文件。请联系管理员安装 ffmpeg。'
    });
  }

  var mp4Path, hash;
  try {
    var result = streamTranscoder.start(fullPath);
    hash = result.hash;
    mp4Path = result.outputPath;
    // 异步等待 MP4 数据就绪（不阻塞事件循环）
    var ready = await streamTranscoder.waitForReady(hash, 262144, 120000);
    if (!ready) {
      return res.status(500).json({ code: 500, message: '转码超时，请重试' });
    }
    streamTranscoder.touch(hash);
  } catch (e) {
    if (e.statusCode === 503) {
      res.set('Retry-After', String(e.retryAfter || 3));
      return res.status(503).json({ code: 503, message: e.message, retryAfter: e.retryAfter || 3 });
    }
    if (e.statusCode === 404) {
      return res.status(404).json({ code: 404, message: e.message });
    }
    console.error('[stream] error:', e.message || e);
    return res.status(500).json({ code: 500, message: '转码启动失败' });
  }

  // 转码过程中文件持续增长 → 不设 Content-Length，用轮询流式推送
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Content-Type', 'video/mp4');

  var fd = fs.openSync(mp4Path, 'r');
  var readPos = 0;
  var ended = false;

  // 清理：请求断开时停止
  req.on('close', function() {
    ended = true;
    try { fs.closeSync(fd); } catch (e) {}
    streamTranscoder.touch(hash);
  });

  // 轮询推送新数据
  function pushData() {
    if (ended) return;
    try {
      var stat = fs.fstatSync(fd);
      var available = stat.size;
      if (available > readPos) {
        var buf = Buffer.alloc(available - readPos);
        var bytesRead = fs.readSync(fd, buf, 0, buf.length, readPos);
        if (bytesRead > 0) {
          res.write(buf.slice(0, bytesRead));
          readPos += bytesRead;
        }
      }
    } catch (e) {
      ended = true;
      try { fs.closeSync(fd); } catch (e2) {}
      res.end();
      return;
    }
    // 检查 ffmpeg 是否已退出
    var task = streamTranscoder.getTask(hash);
    var ffDone = task ? (task._exitCode !== null && task._exitCode !== undefined) : false;
    if (ffDone && readPos >= (fs.fstatSync(fd).size || 0)) {
      ended = true;
      try { fs.closeSync(fd); } catch (e) {}
      res.end();
      return;
    }
    setTimeout(pushData, 250);
  }

  pushData();
});

router.get('/', function(req, res) {
  var dirPath = req.query.path || '';
  if (!isPathSafe(dirPath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(dirPath);

  fs.readdir(fullPath, function(err, files) {
    if (err) {
      return res.status(404).json({ code: 404, message: '目录不存在' });
    }

    var fileList = [];
    var hiddenFolders = getHiddenFolders(req);
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.startsWith('.')) continue;
      if (hiddenFolders.indexOf(file) !== -1) continue;
      var filePath = path.join(fullPath, file);
      try {
        var stat = fs.statSync(filePath);
        var ext = path.extname(file).substring(1);
        fileList.push({
          name: file,
          is_dir: stat.isDirectory(),
          fileType: stat.isDirectory() ? 'folder' : getFileType(ext),
          size: stat.size,
          sizeFormatted: stat.isDirectory() ? '--' : formatSize(stat.size),
          modified: stat.mtime.toISOString(),
          extension: stat.isDirectory() ? '' : ext
        });
      } catch (e) {
        // skip
      }
    }

    fileList.sort(function(a, b) {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });

    var breadcrumbs = buildBreadcrumb(dirPath);

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
      code: 200,
      message: 'ok',
      data: {
        files: fileList,
        path: dirPath,
        breadcrumbs: breadcrumbs
      }
    });
  });
});

router.get('/search', function(req, res) {
  var query = (req.query.q || '').trim().toLowerCase();
  var typeFilter = req.query.type || '';
  var dirPath = req.query.path || '';

  if (!query) {
    return res.status(400).json({ code: 400, message: '搜索关键词不能为空' });
  }

  var searchRoot = isPathSafe(dirPath) ? getFullPath(dirPath) : RESOURCES_DIR;
  var results = [];
  var hiddenFolders = getHiddenFolders(req);

  function searchDir(dir, relBase) {
    try {
      var items = fs.readdirSync(dir);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.startsWith('.')) continue;
        if (hiddenFolders.indexOf(item) !== -1) continue;
        var itemPath = path.join(dir, item);
        var relPath = relBase ? relBase + '/' + item : item;
        try {
          var stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            if (item.toLowerCase().indexOf(query) !== -1) {
              results.push({
                name: item,
                is_dir: true,
                fileType: 'folder',
                size: 0,
                sizeFormatted: '--',
                modified: stat.mtime.toISOString(),
                path: relPath
              });
            }
            searchDir(itemPath, relPath);
          } else {
            var ext = path.extname(item).substring(1);
            var fType = getFileType(ext);
            if (item.toLowerCase().indexOf(query) !== -1) {
              if (typeFilter && typeFilter !== fType) continue;
              results.push({
                name: item,
                is_dir: false,
                fileType: fType,
                size: stat.size,
                sizeFormatted: formatSize(stat.size),
                modified: stat.mtime.toISOString(),
                extension: ext,
                path: relPath
              });
            }
          }
        } catch (e) {
          // skip
        }
      }
    } catch (e) {
      // skip
    }
  }

  searchDir(searchRoot, dirPath);

  results.sort(function(a, b) {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;
    return a.name.localeCompare(b.name);
  });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ code: 200, message: 'ok', data: { results: results, query: query } });
});

router.get('/download', function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return res.status(400).json({ code: 400, message: '不能下载文件夹' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  var mimeMap = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'json': 'application/json',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
    'xml': 'application/xml', 'py': 'text/x-python', 'java': 'text/x-java-source',
    'c': 'text/x-c', 'cpp': 'text/x-c++src', 'vue': 'text/x-vue',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'flac': 'audio/flac', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
    'pdf': 'application/pdf',
    'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
    'gz': 'application/gzip'
  };

  var mimeType = mimeMap[ext] || 'application/octet-stream';

  var fileName = path.basename(fullPath);
  var encodedName = encodeURIComponent(fileName);
  res.set('Content-Type', mimeType);
  res.set('Content-Length', stat.size);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Content-Disposition', "attachment; filename=\"" + encodedName + "\"; filename*=UTF-8''" + encodedName);

  var fileStream = fs.createReadStream(fullPath);
  fileStream.pipe(res);
});

router.get('/raw', function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return res.status(400).json({ code: 400, message: '不能预览文件夹' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  var mimeMap = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'json': 'application/json',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
    'xml': 'application/xml', 'py': 'text/x-python', 'java': 'text/x-java-source',
    'c': 'text/x-c', 'cpp': 'text/x-c++src', 'vue': 'text/x-vue',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp', 'ico': 'image/x-icon',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'flac': 'audio/flac', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
    'pdf': 'application/pdf',
    'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf', 'otf': 'font/otf', 'eot': 'application/vnd.ms-fontobject'
  };

  var mimeType = mimeMap[ext] || 'application/octet-stream';

  res.set('Content-Type', mimeType);
  res.set('Content-Length', stat.size);
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');

  var fileStream = fs.createReadStream(fullPath);
  fileStream.pipe(res);
});

router.get('/preview', function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  var textExts = ['txt', 'md', 'json', 'js', 'ts', 'css', 'xml', 'py', 'java', 'c', 'cpp', 'vue', 'jsx', 'csv'];
  var htmlExts = ['html', 'htm'];

  if (htmlExts.indexOf(ext) !== -1) {
    fs.readFile(fullPath, 'utf-8', function(err, content) {
      if (err) {
        return res.status(500).json({ code: 500, message: '读取文件失败' });
      }
      res.json({
        code: 200,
        data: {
          content: content,
          name: path.basename(fullPath),
          extension: ext,
          type: 'html'
        }
      });
    });
    return;
  }

  if (textExts.indexOf(ext) !== -1) {
    fs.readFile(fullPath, 'utf-8', function(err, content) {
      if (err) {
        return res.status(500).json({ code: 500, message: '读取文件失败' });
      }
      res.json({
        code: 200,
        data: {
          content: content,
          name: path.basename(fullPath),
          extension: ext,
          type: 'text'
        }
      });
    });
    return;
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(fullPath);
});

router.delete('/file', auth.requireAdmin, function(req, res) {
  var filePath = req.body.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  try {
    var stat = fs.statSync(fullPath);
    var pathParts = filePath.split('/').filter(function(p) { return p; });
    if (stat.isDirectory() && pathParts.length <= 1) {
      return res.status(403).json({ code: 403, message: '禁止删除一级文件夹' });
    }
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

router.patch('/rename', auth.requireAdmin, function(req, res) {
  var oldPath = req.body.old_path;
  var newName = req.body.new_name;

  if (!oldPath || !newName) {
    return res.status(400).json({ code: 400, message: '参数不完整' });
  }
  if (!isPathSafe(oldPath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }
  if (!isNameSafe(newName)) {
    return res.status(400).json({ code: 400, message: '文件名包含非法字符' });
  }

  var oldFullPath = getFullPath(oldPath);
  var dir = path.dirname(oldFullPath);
  var newFullPath = path.join(dir, newName);

  if (!fs.existsSync(oldFullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }
  if (fs.existsSync(newFullPath)) {
    return res.status(400).json({ code: 400, message: '目标名称已存在' });
  }

  try {
    fs.renameSync(oldFullPath, newFullPath);
    res.json({ code: 200, message: '重命名成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '重命名失败' });
  }
});

router.post('/move', auth.requireAdmin, function(req, res) {
  var sourcePaths = req.body.source_paths;
  var targetDir = req.body.target_dir;

  if (!sourcePaths || !targetDir) {
    return res.status(400).json({ code: 400, message: '参数不完整' });
  }

  for (var i = 0; i < sourcePaths.length; i++) {
    if (!isPathSafe(sourcePaths[i]) || !isPathSafe(targetDir)) {
      return res.status(403).json({ code: 403, message: '禁止访问' });
    }
  }

  try {
    var targetDirFullPath = getFullPath(targetDir);
    if (!fs.existsSync(targetDirFullPath)) {
      return res.status(400).json({ code: 400, message: '目标目录不存在' });
    }
    if (!fs.statSync(targetDirFullPath).isDirectory()) {
      return res.status(400).json({ code: 400, message: '目标路径不是目录' });
    }

    for (var j = 0; j < sourcePaths.length; j++) {
      var sourceFullPath = getFullPath(sourcePaths[j]);
      var targetFullPath = path.join(targetDirFullPath, path.basename(sourcePaths[j]));

      if (sourceFullPath === targetFullPath) {
        return res.status(400).json({ code: 400, message: '源路径和目标路径相同' });
      }
      if (!fs.existsSync(sourceFullPath)) {
        return res.status(400).json({ code: 400, message: '源文件不存在: ' + path.basename(sourcePaths[j]) });
      }
      if (fs.existsSync(targetFullPath)) {
        return res.status(400).json({ code: 400, message: '目标位置已存在: ' + path.basename(sourcePaths[j]) });
      }

      try {
        fs.renameSync(sourceFullPath, targetFullPath);
      } catch (renameErr) {
        if (renameErr.code === 'EXDEV' || renameErr.code === 'EPERM') {
          if (fs.statSync(sourceFullPath).isDirectory()) {
            copyDirSync(sourceFullPath, targetFullPath);
            rmDirSync(sourceFullPath);
          } else {
            fs.copyFileSync(sourceFullPath, targetFullPath);
            fs.unlinkSync(sourceFullPath);
          }
        } else {
          throw renameErr;
        }
      }
    }
    res.json({ code: 200, message: '移动成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '移动失败: ' + (e.message || '') });
  }
});

router.post('/copy', auth.requireAdmin, function(req, res) {
  var sourcePaths = req.body.source_paths;
  var targetDir = req.body.target_dir;

  if (!sourcePaths || !targetDir) {
    return res.status(400).json({ code: 400, message: '参数不完整' });
  }

  for (var i = 0; i < sourcePaths.length; i++) {
    if (!isPathSafe(sourcePaths[i]) || !isPathSafe(targetDir)) {
      return res.status(403).json({ code: 403, message: '禁止访问' });
    }
  }

  try {
    for (var j = 0; j < sourcePaths.length; j++) {
      var sourceFullPath = getFullPath(sourcePaths[j]);
      var targetFullPath = path.join(getFullPath(targetDir), path.basename(sourcePaths[j]));
      fs.cpSync(sourceFullPath, targetFullPath, { recursive: true });
    }
    res.json({ code: 200, message: '复制成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '复制失败' });
  }
});

router.post('/create-folder', auth.requireAdmin, function(req, res) {
  var parentPath = req.body.parent_path || '';
  var folderName = req.body.folder_name;

  if (!folderName) {
    return res.status(400).json({ code: 400, message: '文件夹名称不能为空' });
  }
  if (!isNameSafe(folderName)) {
    return res.status(400).json({ code: 400, message: '文件夹名称包含非法字符' });
  }
  if (!isPathSafe(parentPath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = path.join(getFullPath(parentPath), folderName);

  if (fs.existsSync(fullPath)) {
    return res.status(400).json({ code: 400, message: '文件夹已存在' });
  }

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ code: 200, message: '创建成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '创建失败' });
  }
});

var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
var MEDIA_EXTS = ['.mp4', '.webm', '.mp3', '.wav', '.ogg', '.flac', '.m4a'];
var FONT_EXTS = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];
var CODE_EXTS = ['.js', '.mjs', '.ts', '.wasm', '.json', '.css'];
var DATA_EXTS = ['.dat', '.bin', '.obj', '.gltf', '.glb', '.babylon', '.scene'];
var ASSET_EXTS = IMAGE_EXTS.concat(MEDIA_EXTS).concat(FONT_EXTS).concat(CODE_EXTS).concat(DATA_EXTS);

function rewriteExternalUrls(html, dirFullPath, baseHref) {
  var urlPattern = /(src|href|data-src|data-href)\s*=\s*["']([^"']+)["']/gi;
  var jsUrlPattern = /["']((https?:\/\/)[^"']+\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|webm|mp3|wav|ogg|css|js|woff2?|ttf|otf|eot|wasm|mjs|json|dat|bin|gltf|glb))["']/gi;

  var localFileCache = null;

  function getLocalFiles() {
    if (localFileCache) return localFileCache;
    localFileCache = {};
    try {
      _scanDir(dirFullPath, dirFullPath, localFileCache);
    } catch (e) {}
    return localFileCache;
  }

  function _scanDir(base, current, cache) {
    var entries = fs.readdirSync(current);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(current, entry);
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        _scanDir(base, fullPath, cache);
      } else {
        var ext = path.extname(entry).toLowerCase();
        if (ASSET_EXTS.indexOf(ext) !== -1) {
          cache[entry.toLowerCase()] = path.relative(base, fullPath).replace(/\\/g, '/');
        }
      }
    }
  }

  html = html.replace(urlPattern, function(match, attr, url) {
    if (url.charAt(0) === '#' || url.charAt(0) === '/' || url.indexOf('data:') === 0 || url.indexOf('javascript:') === 0 || url.indexOf('mailto:') === 0) {
      return match;
    }
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
      return match;
    }
    var fileName = url.split('/').pop().split('?')[0].split('#')[0];
    if (!fileName) return match;
    var localFiles = getLocalFiles();
    var localPath = localFiles[fileName.toLowerCase()];
    if (localPath) {
      return attr + '="' + baseHref + encodeURIComponent(localPath).replace(/%2F/g, '/') + '"';
    }
    return match;
  });

  html = html.replace(jsUrlPattern, function(match, url, protocol, ext) {
    var fileName = url.split('/').pop().split('?')[0].split('#')[0];
    if (!fileName) return match;
    var localFiles = getLocalFiles();
    var localPath = localFiles[fileName.toLowerCase()];
    if (localPath) {
      return '"' + baseHref + encodeURIComponent(localPath).replace(/%2F/g, '/') + '"';
    }
    return match;
  });

  return html;
}

function rewriteCssLinks(html, htmlDirPath) {
  var linkPattern = /(<link\s[^>]*href\s*=\s*["'])([^"']+\.css)(["'][^>]*>)/gi;
  return html.replace(linkPattern, function(match, prefix, cssHref, suffix) {
    if (cssHref.indexOf('://') !== -1 || cssHref.indexOf('/api/resources/css-proxy') === 0) {
      return match;
    }
    var cssPath;
    if (cssHref.charAt(0) === '/') {
      cssPath = cssHref.substring(1);
    } else {
      cssPath = htmlDirPath + '/' + cssHref;
    }
    cssPath = path.normalize(cssPath).replace(/\\/g, '/');
    return prefix + '/api/resources/css-proxy?path=' + encodeURIComponent(cssPath) + suffix;
  });
}

router.get('/css-proxy', auth.requireAuth, function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  if (ext !== 'css') {
    return res.status(400).json({ code: 400, message: '仅支持CSS文件' });
  }

  var cssContent = fs.readFileSync(fullPath, 'utf-8');
  var dirPath = path.dirname(filePath);
  var fullDirPath = getFullPath(dirPath);

  var dirParts = dirPath.split(/[/\\]/);
  var encodedDirParts = [];
  for (var i = 0; i < dirParts.length; i++) {
    if (dirParts[i]) {
      encodedDirParts.push(encodeURIComponent(dirParts[i]));
    }
  }
  var baseHref = '/resources/' + encodedDirParts.join('/') + '/';

  cssContent = rewriteCssUrls(cssContent, fullDirPath, baseHref);

  res.set('Content-Type', 'text/css; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Cross-Origin-Resource-Policy');
  res.send(cssContent);
});

function rewriteCssUrls(css, dirFullPath, baseHref) {
  var localFileCache = null;

  function getLocalFiles() {
    if (localFileCache) return localFileCache;
    localFileCache = {};
    try {
      _scanDir(dirFullPath, dirFullPath, localFileCache);
    } catch (e) {}
    return localFileCache;
  }

  function _scanDir(base, current, cache) {
    var entries = fs.readdirSync(current);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fp = path.join(current, entry);
      var st = fs.statSync(fp);
      if (st.isDirectory()) {
        _scanDir(base, fp, cache);
      } else {
        var e = path.extname(entry).toLowerCase();
        if (ASSET_EXTS.indexOf(e) !== -1) {
          cache[entry.toLowerCase()] = path.relative(base, fp).replace(/\\/g, '/');
        }
      }
    }
  }

  var cssUrlPattern = /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi;
  css = css.replace(cssUrlPattern, function(match, url) {
    var fileName = url.split('/').pop().split('?')[0].split('#')[0];
    if (!fileName) return match;
    var localFiles = getLocalFiles();
    var localPath = localFiles[fileName.toLowerCase()];
    if (localPath) {
      return 'url("' + baseHref + encodeURIComponent(localPath).replace(/%2F/g, '/') + '")';
    }
    return match;
  });

  // 重写CSS中的相对路径url()
  var relativeUrlPattern = /url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi;
  var processedCss = css.replace(relativeUrlPattern, function(match, url) {
    if (url.indexOf('data:') === 0 || url.indexOf('http://') === 0 || url.indexOf('https://') === 0 || url.indexOf('#') === 0) {
      return match;
    }
    var resolvedUrl = url;
    if (url.charAt(0) !== '/' && !url.startsWith('../')) {
      // 相对路径：尝试在本地文件中查找
      var fileName = url.split('?')[0].split('#')[0];
      var localFiles = getLocalFiles();
      var localPath = localFiles[fileName.toLowerCase()];
      if (localPath) {
        return 'url("' + baseHref + encodeURIComponent(localPath).replace(/%2F/g, '/') + '")';
      }
    }
    return match;
  });
  return processedCss;
}

router.get('/html-proxy', auth.requireAuth, function(req, res) {
  var filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }
  if (!isPathSafe(filePath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return res.status(400).json({ code: 400, message: '不能预览文件夹' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  if (ext !== 'html' && ext !== 'htm') {
    return res.status(400).json({ code: 400, message: '仅支持HTML文件预览' });
  }

  var dirPath = path.dirname(filePath);
  var htmlContent = fs.readFileSync(fullPath, 'utf-8');

  var dirParts = dirPath.split(/[/\\]/);
  var encodedDirParts = [];
  for (var i = 0; i < dirParts.length; i++) {
    if (dirParts[i]) {
      encodedDirParts.push(encodeURIComponent(dirParts[i]));
    }
  }
  var baseHref = '/resources/' + encodedDirParts.join('/') + '/';
  var hsBaseHref = '/api/resources/hs/' + (dirPath ? dirPath.replace(/\\/g, '/') + '/' : '');

  // 注入base标签解析相对路径资源
  if (htmlContent.match(/<head[^>]*>/i)) {
    htmlContent = htmlContent.replace(/<head[^>]*>/i, '$&<base href="' + baseHref + '">');
  } else if (htmlContent.match(/<html[^>]*>/i)) {
    htmlContent = htmlContent.replace(/<html[^>]*>/i, '$&<head><base href="' + baseHref + '"></head>');
  } else {
    htmlContent = '<base href="' + baseHref + '">' + htmlContent;
  }

  var fullDirPath = getFullPath(dirPath);
  htmlContent = rewriteExternalUrls(htmlContent, fullDirPath, baseHref);
  htmlContent = rewriteCssLinks(htmlContent, dirPath);

  // 注入WASM和多线程支持所需的meta标签
  var wasmSupportMeta = '<meta name="supported-csp" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;">';
  if (htmlContent.match(/<head[^>]*>/i)) {
    htmlContent = htmlContent.replace(/<head[^>]*>/i, '$&' + wasmSupportMeta);
  } else {
    htmlContent = wasmSupportMeta + htmlContent;
  }

  // 设置响应头：支持WASM SharedArrayBuffer、跨域资源加载、Worker线程
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Embedder-Policy', 'require-corp');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; font-src * data:; media-src * blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; worker-src * blob:; connect-src *;");
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Referrer-Policy');
  res.send(htmlContent);
});

router.get('/hs/:path(*)', auth.requireAuth, function(req, res) {
  var requestedPath = req.params.path || '';
  if (!requestedPath) {
    return res.status(400).json({ code: 400, message: '文件路径不能为空' });
  }

  var normalizedPath = path.normalize(requestedPath).replace(/\\/g, '/');
  if (normalizedPath.startsWith('..')) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }
  if (!isPathSafe(normalizedPath)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  var fullPath = getFullPath(normalizedPath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }

  var stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return res.status(400).json({ code: 400, message: '不能预览文件夹' });
  }

  var ext = path.extname(fullPath).substring(1).toLowerCase();
  var mimeMap = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'mjs': 'application/javascript',
    'json': 'application/json', 'txt': 'text/plain', 'md': 'text/markdown',
    'csv': 'text/csv', 'xml': 'application/xhtml+xml',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'bmp': 'image/bmp', 'ico': 'image/x-icon',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'flac': 'audio/flac', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
    'pdf': 'application/pdf',
    'wasm': 'application/wasm',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf',
    'otf': 'font/otf', 'eot': 'application/vnd.ms-fontobject',
    'data': 'application/octet-stream', 'bin': 'application/octet-stream',
    'dat': 'application/octet-stream', 'obj': 'model/obj',
    'glb': 'model/gltf-binary', 'gltf': 'model/gltf+json',
    'mpkg': 'application/vnd.apple.installer+xml',
    'swf': 'application/x-shockwave-flash',
    'webmanifest': 'application/manifest+json',
    'xhtml': 'application/xhtml+xml',
    'ts': 'application/typescript'
  };

  var mimeType = mimeMap[ext] || 'application/octet-stream';
  res.set('Content-Type', mimeType);
  res.set('Content-Length', stat.size);
  res.set('Cache-Control', 'public, max-age=3600');
  // 支持WASM跨域加载和SharedArrayBuffer
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD, RANGE');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (ext === 'wasm') {
    res.set('Accept-Ranges', 'bytes');
    res.set('Cross-Origin-Embedder-Policy', 'same-origin');
  }

  // 处理Range请求（WASM流式编译需要）
  var rangeHeader = req.headers.range;
  if (rangeHeader && (ext === 'wasm' || ext === 'mp4' || ext === 'webm')) {
    var parts = rangeHeader.replace(/bytes=/, '').split('-');
    var start = parseInt(parts[0], 10) || 0;
    var end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    var chunkSize = end - start + 1;
    if (start >= stat.size) {
      return res.status(416).set('Content-Range', 'bytes */' + stat.size).end();
    }
    res.status(206);
    res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size);
    res.set('Content-Length', chunkSize);
    var fileStream = fs.createReadStream(fullPath, { start: start, end: end });
    fileStream.pipe(res);
  } else {
    var fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
  }
});

// CORS预检请求处理
router.options('/hs/:path(*)', auth.requireAuth, function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD, RANGE');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

module.exports = router;
