var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var CACHE_DIR = path.resolve(__dirname, '../../stream-cache');
var MAX_CONCURRENT = 5;
var IDLE_TIMEOUT = 30 * 60 * 1000; // 30 分钟
var CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 任务状态: { hash, filePath, process, startTime, lastAccess, playlistPath, cacheDir, stderr }
var _tasks = Object.create(null);
var _cleanupTimer = null;

function _hashPath(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 12);
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function _cleanTask(hash) {
  var task = _tasks[hash];
  if (!task) return;

  // 杀掉 ffmpeg 进程
  if (task.process && task.process.exitCode === null) {
    try { task.process.kill('SIGTERM'); } catch (e) {}
    setTimeout(function() {
      try { task.process.kill('SIGKILL'); } catch (e2) {}
    }, 5000);
  }

  // 删除缓存目录
  if (task.cacheDir && fs.existsSync(task.cacheDir)) {
    try {
      fs.rmSync(task.cacheDir, { recursive: true });
    } catch (e) {}
  }

  delete _tasks[hash];
}

function _cleanupLoop() {
  var now = Date.now();
  var hashes = Object.keys(_tasks);
  for (var i = 0; i < hashes.length; i++) {
    var hash = hashes[i];
    var task = _tasks[hash];
    if (!task) continue;

    var idleTime = now - task.lastAccess;
    var procDead = task.process && task.process.exitCode !== null;

    // 进程已死或空闲超时 → 清理
    if (procDead || idleTime > IDLE_TIMEOUT) {
      _cleanTask(hash);
    }
  }

  // 没有任务了 → 停止定时器
  if (Object.keys(_tasks).length === 0) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

function _startCleanup() {
  if (!_cleanupTimer) {
    _cleanupTimer = setInterval(_cleanupLoop, CLEANUP_INTERVAL);
    _cleanupTimer.unref(); // 不阻止进程退出
  }
}

var _hwEncoderCache = undefined;

// 检测可用的硬件加速编码器（GPU 转码几乎不占 CPU，只检测一次）
function _detectHardwareEncoder() {
  if (_hwEncoderCache !== undefined) return _hwEncoderCache;
  try {
    var ffBin = _getFFmpegPath() || 'ffmpeg';
    var out = require('child_process').execSync('"' + ffBin + '" -hide_banner -encoders 2>&1', {
      encoding: 'utf8', timeout: 5000, windowsHide: true
    });
    if (out.indexOf('h264_qsv') !== -1) { _hwEncoderCache = 'qsv'; return 'qsv'; }
    if (out.indexOf('h264_nvenc') !== -1) { _hwEncoderCache = 'nvenc'; return 'nvenc'; }
    if (out.indexOf('h264_amf') !== -1) { _hwEncoderCache = 'amf'; return 'amf'; }
  } catch (e) {}
  _hwEncoderCache = null;
  return null;
}

// 按优先级查找 ffmpeg 可执行文件路径
function _findFFmpegPath() {
  var locations = [
    // 用户安装的 ffmpeg
    path.join(process.env.USERPROFILE || process.env.HOME || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    // 系统 Program Files
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    // PATH 中的 ffmpeg（fallback）
    'ffmpeg.exe',
    'ffmpeg'
  ];

  for (var i = 0; i < locations.length; i++) {
    try {
      var result = require('child_process').execSync('"' + locations[i] + '" -version', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
      if (result.indexOf('ffmpeg version') !== -1) {
        return locations[i];
      }
    } catch (e) {
      // 继续尝试下一个
    }
  }
  return null;
}

var _ffmpegPath = null;

function _getFFmpegPath() {
  if (_ffmpegPath === null) {
    _ffmpegPath = _findFFmpegPath();
  }
  return _ffmpegPath;
}

// 检查 ffmpeg 是否可用
function checkFFmpeg() {
  return _getFFmpegPath() !== null;
}

// 启动转码
function start(filePath) {
  var fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    var err = new Error('文件不存在');
    err.statusCode = 404;
    throw err;
  }

  var hash = _hashPath(filePath);

  // 已有缓存 → 续期并返回
  if (_tasks[hash]) {
    _tasks[hash].lastAccess = Date.now();
    return { hash: hash, outputPath: _tasks[hash].outputPath };
  }

  // 检查并发上限
  var activeJobs = Object.keys(_tasks).filter(function(k) {
    return _tasks[k] && _tasks[k].process && _tasks[k].process.exitCode === null;
  });
  if (activeJobs.length >= MAX_CONCURRENT) {
    var busyErr = new Error('转码队列已满，请稍后重试');
    busyErr.statusCode = 503;
    busyErr.retryAfter = 3;
    throw busyErr;
  }

  // 创建缓存目录
  var cacheDir = path.join(CACHE_DIR, hash);
  _ensureDir(cacheDir);

  // 输出分片 MP4（fragmented mp4，支持流播放）
  var outputFile = path.join(cacheDir, 'output.mp4');

  // 选择最优编码方案：硬件加速 > 软件轻量
  var hwType = _detectHardwareEncoder();
  var args;
  if (hwType === 'qsv') {
    // Intel Quick Sync — GPU 转码，几乎不占 CPU
    args = [
      '-hwaccel', 'qsv', '-qsv_device', 'auto',
      '-i', fullPath,
      '-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', '2M', '-maxrate', '4M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4', '-y',
      outputFile
    ];
  } else if (hwType === 'nvenc') {
    // NVIDIA NVENC — GPU 转码
    args = [
      '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
      '-i', fullPath,
      '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-b:v', '2M', '-maxrate', '4M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4', '-y',
      outputFile
    ];
  } else if (hwType === 'amf') {
    // AMD AMF — GPU 转码
    args = [
      '-hwaccel', 'auto',
      '-i', fullPath,
      '-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'speed', '-b:v', '2M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4', '-y',
      outputFile
    ];
  } else {
    // 纯 CPU — 极限轻量参数，限线程防卡死
    args = [
      '-threads', '2',
      '-i', fullPath,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '32',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
      '-vf', 'scale=trunc(iw/4)*2:trunc(ih/4)*2:flags=fast_bilinear',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4', '-y',
      outputFile
    ];
  }

  console.log('[Transcoder] Starting with ' + (hwType || 'CPU') + ' for: ' + path.basename(fullPath));

  var ffmpegBin = _getFFmpegPath() || 'ffmpeg';
  var ffproc = spawn(ffmpegBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  // 降低 ffmpeg 进程优先级，避免卡死系统
  try {
    if (ffproc.pid) {
      require('child_process').execSync('wmic process where ProcessId=' + ffproc.pid + ' CALL setpriority 64', { windowsHide: true });
    }
  } catch (e) {}

  var stderrChunks = [];
  ffproc.stderr.on('data', function(chunk) {
    stderrChunks.push(chunk.toString());
  });

  var task = {
    hash: hash,
    filePath: filePath,
    process: ffproc,
    startTime: Date.now(),
    lastAccess: Date.now(),
    outputPath: outputFile,
    cacheDir: cacheDir,
    stderr: '',
    _error: null,
    _exitCode: null
  };

  ffproc.on('error', function(err) {
    task._error = err.message;
    _cleanTask(hash);
  });

  ffproc.on('exit', function(code) {
    task._exitCode = code;
    task.stderr = stderrChunks.join('');
    if (code !== 0 && code !== null) {
      task._error = 'ffmpeg exited with code ' + code + ': ' + (task.stderr || '').slice(-500);
    }
    // 延迟清理：给进行中的请求一些时间完成
    setTimeout(function() {
      var t = _tasks[hash];
      if (t && t._exitCode !== null) {
        _cleanTask(hash);
      }
    }, 30000);
  });

  _tasks[hash] = task;
  _startCleanup();

  return { hash: hash, outputPath: outputFile };
}

// 等待 MP4 文件有足够数据可播放（frag_keyframe+empty_moov 使得文件边写边可读）
// 异步轮询，不阻塞 Node.js 事件循环
function waitForReady(hash, minSize, waitMs) {
  return new Promise(function(resolve) {
    var maxWait = waitMs || 30000;
    var task = _tasks[hash];
    var startTime = Date.now();

    if (!task) return resolve(false);
    var filePath = task.outputPath;
    if (!filePath) return resolve(false);

    function checkReady() {
      if (!fs.existsSync(filePath)) return false;
      return fs.statSync(filePath).size >= (minSize || 262144);
    }

    function poll() {
      var elapsed = Date.now() - startTime;

      // 任务失败 → 返回当前状态
      if (task._error || task._exitCode !== null) {
        return resolve(checkReady());
      }

      // 文件就绪 → 返回 true
      if (checkReady()) return resolve(true);

      // 超时 → 返回当前状态
      if (elapsed >= maxWait) return resolve(checkReady());

      // 继续轮询
      setTimeout(poll, 300);
    }

    // 首次立即检查
    if (checkReady()) return resolve(true);
    if (task._error || task._exitCode !== null) return resolve(checkReady());

    setTimeout(poll, 300);
  });
}

// 续期访问时间
function touch(hash) {
  if (_tasks[hash]) {
    _tasks[hash].lastAccess = Date.now();
  }
}

// 当前活跃的转码进程数
function getActiveCount() {
  return Object.keys(_tasks).filter(function(k) {
    var t = _tasks[k];
    return t && t.process && t.process.exitCode === null;
  }).length;
}

// 启动时清理上次运行残留
(function cleanupStale() {
  try {
    var entries = fs.readdirSync(CACHE_DIR);
    for (var i = 0; i < entries.length; i++) {
      var entryPath = path.join(CACHE_DIR, entries[i]);
      try {
        var stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true });
        }
      } catch (e) {
        // 跳过无法删除的
      }
    }
  } catch (e) {
    // 目录为空或不存在
  }
})();

// 获取任务状态（供路由查询 ffmpeg 是否已退出）
function getTask(hash) {
  return _tasks[hash] || null;
}

// 同步转码为可移植 MP4（用于云盘上传后转码 mov/mkv/avi/webm/3gp → mp4）
// 与 start() 区别：输出 +faststart 而非 fragmented mp4；不写入 _tasks、不占 MAX_CONCURRENT 配额；等待完成而非流式预热
// 返回 Promise<{ok, exitCode, stderr}>；超时杀进程并 reject
function transcodeFileToMp4(srcPath, destPath, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var fullPath = path.resolve(srcPath);
    if (!fs.existsSync(fullPath)) {
      return reject(new Error('源文件不存在: ' + fullPath));
    }
    var ffmpegBin = _getFFmpegPath();
    if (!ffmpegBin) {
      return reject(new Error('ffmpeg 未安装，无法转码'));
    }

    // 确保输出目录存在
    var destDir = path.dirname(destPath);
    _ensureDir(destDir);

    // 选择最优编码方案：硬件加速 > 软件轻量
    var hwType = _detectHardwareEncoder();
    var args;
    if (hwType === 'qsv') {
      // Intel Quick Sync — GPU 转码
      args = [
        '-hwaccel', 'qsv', '-qsv_device', 'auto',
        '-i', fullPath,
        '-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', '2M', '-maxrate', '4M',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart',
        '-f', 'mp4', '-y',
        destPath
      ];
    } else if (hwType === 'nvenc') {
      // NVIDIA NVENC — GPU 转码
      args = [
        '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
        '-i', fullPath,
        '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-b:v', '2M', '-maxrate', '4M',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart',
        '-f', 'mp4', '-y',
        destPath
      ];
    } else if (hwType === 'amf') {
      // AMD AMF — GPU 转码
      args = [
        '-hwaccel', 'auto',
        '-i', fullPath,
        '-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'speed', '-b:v', '2M',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart',
        '-f', 'mp4', '-y',
        destPath
      ];
    } else {
      // 纯 CPU — 极限轻量参数，限线程防卡死
      args = [
        '-threads', '2',
        '-i', fullPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '32',
        '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
        '-vf', 'scale=trunc(iw/4)*2:trunc(ih/4)*2:flags=fast_bilinear',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
        '-movflags', '+faststart',
        '-f', 'mp4', '-y',
        destPath
      ];
    }

    console.log('[Transcoder-File] Starting ' + (hwType || 'CPU') + ' for: ' + path.basename(fullPath) + ' -> ' + path.basename(destPath));

    var ffproc = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    // 降低 ffmpeg 进程优先级，避免卡死系统
    try {
      if (ffproc.pid) {
        require('child_process').execSync('wmic process where ProcessId=' + ffproc.pid + ' CALL setpriority 64', { windowsHide: true });
      }
    } catch (e) {}

    var stderrChunks = [];
    ffproc.stderr.on('data', function(chunk) {
      stderrChunks.push(chunk.toString());
    });

    var maxWait = timeoutMs || 60000;
    var settled = false;

    var timeoutTimer = setTimeout(function() {
      if (settled) return;
      settled = true;
      try { ffproc.kill('SIGTERM'); } catch (e) {}
      setTimeout(function() {
        try { ffproc.kill('SIGKILL'); } catch (e2) {}
      }, 3000);
      // 删除部分写入的输出文件
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
      reject(new Error('转码超时（' + maxWait + 'ms）'));
    }, maxWait);

    ffproc.on('error', function(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      reject(new Error('ffmpeg 启动失败: ' + err.message));
    });

    ffproc.on('exit', function(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      var stderr = stderrChunks.join('');
      if (code === 0) {
        // 校验输出文件存在且非空
        try {
          if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
            resolve({ ok: true, exitCode: 0, stderr: stderr });
          } else {
            reject(new Error('转码输出文件为空或不存在'));
          }
        } catch (e) {
          reject(new Error('转码输出校验失败: ' + e.message));
        }
      } else {
        // 失败时清理半成品
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        resolve({ ok: false, exitCode: code, stderr: stderr.slice(-500) });
      }
    });
  });
}

module.exports = {
  CACHE_DIR: CACHE_DIR,
  MAX_CONCURRENT: MAX_CONCURRENT,
  checkFFmpeg: checkFFmpeg,
  start: start,
  touch: touch,
  waitForReady: waitForReady,
  getTask: getTask,
  transcodeFileToMp4: transcodeFileToMp4,
  get activeCount() {
    return getActiveCount();
  }
};
