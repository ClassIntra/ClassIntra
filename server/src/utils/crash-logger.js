var fs = require('fs');
var path = require('path');
var os = require('os');

var LOG_DIR = path.join(__dirname, '..', '..', 'logs');
var CRASH_LOG = path.join(LOG_DIR, 'crash.log');
var ACTIVITY_LOG = path.join(LOG_DIR, 'activity.log');

try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {}

var MAX_LOG_SIZE = 5 * 1024 * 1024;

function rotateLog(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      var stats = fs.statSync(filePath);
      if (stats.size > MAX_LOG_SIZE) {
        var backup = filePath.replace('.log', '.old.log');
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(filePath, backup);
      }
    }
  } catch (e) {}
}

function timestamp() {
  return new Date().toISOString();
}

function writeCrashLog(type, err) {
  rotateLog(CRASH_LOG);
  var lines = [
    '',
    '================================================================',
    '[' + timestamp() + '] ' + type,
    '----------------------------------------------------------------'
  ];
  if (err) {
    lines.push('Message: ' + (err.message || String(err)));
    lines.push('Name: ' + (err.name || 'Unknown'));
    if (err.code) lines.push('Code: ' + err.code);
    if (err.stack) lines.push('Stack:\n' + err.stack);
  } else {
    lines.push('No error object');
  }
  lines.push('Memory: ' + JSON.stringify(process.memoryUsage()));
  lines.push('Uptime: ' + process.uptime() + 's');
  lines.push('PID: ' + process.pid);
  lines.push('================================================================');
  try {
    fs.appendFileSync(CRASH_LOG, lines.join('\n') + '\n');
  } catch (e) {
    console.error('[CrashLogger] Failed to write crash log:', e.message);
  }
}

function logActivity(action, detail) {
  rotateLog(ACTIVITY_LOG);
  var line = '[' + timestamp() + '] ' + action + (detail ? ' | ' + detail : '');
  try {
    fs.appendFileSync(ACTIVITY_LOG, line + '\n');
  } catch (e) {}
}

var lastActivity = '';
var lastActivityTime = 0;

function trackActivity(action, detail) {
  lastActivity = action + (detail ? ' | ' + detail : '');
  lastActivityTime = Date.now();
  if (process.env.VERBOSE_LOG === '1') {
    logActivity(action, detail);
  }
}

function installCrashHandlers() {
  process.on('uncaughtException', function(err) {
    console.error('[CRASH] Uncaught exception:', err.message || err);
    if (err.stack) console.error(err.stack);
    writeCrashLog('UNCAUGHT_EXCEPTION', err);
    setTimeout(function() { process.exit(1); }, 1000);
  });

  process.on('unhandledRejection', function(reason, promise) {
    console.error('[CRASH] Unhandled rejection:', reason);
    writeCrashLog('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // SIGTERM/SIGINT 只记日志不退出——app.js 注册了 gracefulShutdown（广播停机通知→关HTTP→exit），
  // 这里抢先 process.exit 会跳过优雅停机流程
  process.on('SIGTERM', function() {
    var msg = 'SIGTERM received. Last activity: ' + lastActivity + ' (' + (Date.now() - lastActivityTime) + 'ms ago)';
    console.error('[CRASH] ' + msg);
    writeCrashLog('SIGTERM', new Error(msg));
  });

  process.on('SIGINT', function() {
    var msg = 'SIGINT received. Last activity: ' + lastActivity + ' (' + (Date.now() - lastActivityTime) + 'ms ago)';
    console.error('[CRASH] ' + msg);
    writeCrashLog('SIGINT', new Error(msg));
  });

  var originalExit = process.exit;
  process.exit = function(code) {
    var msg = 'process.exit(' + code + ') called. Last activity: ' + lastActivity + ' (' + (Date.now() - lastActivityTime) + 'ms ago)';
    writeCrashLog('PROCESS_EXIT', new Error(msg));
    originalExit.call(process, code);
  };

  setInterval(function() {
    var mem = process.memoryUsage();
    var memMB = Math.round(mem.rss / 1024 / 1024);
    if (memMB > 500) {
      var msg = 'High memory usage: ' + memMB + 'MB RSS. Last activity: ' + lastActivity;
      console.warn('[Memory] ' + msg);
      writeCrashLog('HIGH_MEMORY', new Error(msg));
    }
  }, 30000).unref();

  process.on('exit', function(code) {
    if (code !== 0) {
      var msg = 'Process exiting with code ' + code + '. Last activity: ' + lastActivity + ' (' + (Date.now() - lastActivityTime) + 'ms ago)';
      writeCrashLog('NONZERO_EXIT', new Error(msg));
    }
  });
}

var MEMORY_WARN_MB = 400;
var MEMORY_CRITICAL_MB = 700;

function getMemoryMB() {
  var mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
    arrayBuffers: Math.round(mem.arrayBuffers / 1024 / 1024)
  };
}

function isMemoryPressure() {
  var mem = process.memoryUsage();
  return mem.rss > MEMORY_CRITICAL_MB * 1024 * 1024;
}

function isMemoryWarning() {
  var mem = process.memoryUsage();
  return mem.rss > MEMORY_WARN_MB * 1024 * 1024;
}

module.exports = {
  installCrashHandlers: installCrashHandlers,
  trackActivity: trackActivity,
  logActivity: logActivity,
  writeCrashLog: writeCrashLog,
  isMemoryPressure: isMemoryPressure,
  isMemoryWarning: isMemoryWarning,
  getMemoryMB: getMemoryMB
};
