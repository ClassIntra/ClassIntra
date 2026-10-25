// 后端核心：市场应用进程管理器（独立端口型后端的托管）
// ============================================================
// 有些第三方内容本质是独立服务（游戏联机服务器、算法服务等），无法表达为
// express router。manifest 声明 backend.process 后，由本管理器：
//   spawn 子进程（cwd=应用目录，注入 PORT/CI_APP_NAME 环境变量）
//   崩溃自动重启（指数退避，上限 5 次）
//   stdout/stderr 归因收集（[proc:<name>] 前缀进主日志）
//   停用/卸载时终止进程树（win32 用 taskkill /T /F）
// 主服务 dispatcher 将 mountPath 反代到 127.0.0.1:<port>（见 market-service.js）。
//
// 约束（保姆式简化，写进文档）：
//   - 仅信任模型同 market：安装即信任（与插件后端任意 require 同级攻击面）
//   - 反代仅 HTTP（WS 升级暂不支持，联机类走 HTTP 轮询或 HTTP 长连接）
//   - 开发者应只绑 127.0.0.1（外网暴露由部署者网络层控制）
//   - 端口冲突在安装期检测拒绝；进程存活状态可经 diagnostics 查询

var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;
var path = require('path');

var MAX_RESTARTS = 5;
var RESTART_BASE_MS = 3000;

// name -> { proc, port, restarts, startedAt, lastExitCode, stopping }
var _running = {};

function log(name, level, chunk) {
  var text = String(chunk).replace(/\s+$/, '');
  if (!text) return;
  var tag = '[proc:' + name + ']';
  (level === 'err' ? console.error : console.log)(tag + ' ' + text);
}

function recordExit(name, code) {
  var rec = _running[name];
  if (!rec) return;
  rec.lastExitCode = code;
  rec.proc = null;
}

// 启动（或重启）一个进程型应用
function startApp(manifest, appDir) {
  var name = manifest.name;
  var procConf = manifest.backend && manifest.backend.process;
  if (!procConf) return false;
  if (_running[name] && _running[name].proc) return true; // 已在跑
  var command = procConf.command || ('node ' + procConf.entry);
  var parts = command.split(/\s+/);
  var cmd = parts[0];
  var args = parts.slice(1);
  var env = Object.assign({}, process.env, {
    CI_APP_NAME: name,
    PORT: String(procConf.port),
    CI_APP_DIR: appDir
  });
  var rec = _running[name] || { restarts: 0 };
  _running[name] = Object.assign(rec, {
    port: procConf.port,
    startedAt: Date.now(),
    stopping: false,
    proc: null
  });
  var proc;
  try {
    proc = spawn(cmd, args, { cwd: appDir, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('[market-process] 启动失败:', name, e.message);
    recordExit(name, -1);
    return false;
  }
  rec.proc = proc;
  proc.stdout.on('data', function(d) { log(name, 'out', d); });
  proc.stderr.on('data', function(d) { log(name, 'err', d); });
  proc.on('error', function(e) {
    console.error('[market-process] 进程错误:', name, e.message);
  });
  proc.on('exit', function(code) {
    var r = _running[name];
    recordExit(name, code);
    if (!r || r.stopping) return;
    if (r.restarts >= MAX_RESTARTS) {
      console.error('[market-process] "' + name + '" 连续崩溃 ' + r.restarts + ' 次，放弃自动重启');
      return;
    }
    r.restarts += 1;
    var delay = RESTART_BASE_MS * r.restarts;
    console.warn('[market-process] "' + name + '" 退出（code=' + code + '），' + delay + 'ms 后第 ' + r.restarts + ' 次重启');
    setTimeout(function() {
      // 重启前确认仍应运行（可能已被停用/卸载）
      var still = _running[name];
      if (!still || still.stopping) return;
      try {
        if (!isAppEnabledSafe(name)) {
          console.warn('[market-process] "' + name + '" 已停用，不再重启');
          return;
        }
      } catch (e) {}
      startApp(manifest, appDir);
    }, delay);
  });
  console.log('[market-process] 已启动:', name, '->', cmd, '(port ' + procConf.port + ')');
  return true;
}

function isAppEnabledSafe(name) {
  var db = require('../utils/db');
  var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(name);
  return !row || !!row.enabled;
}

// 停止进程树（幂等）。callback 在进程真正终止后调用（或立即，若未运行）
function stopApp(name, callback) {
  var rec = _running[name];
  if (!rec || !rec.proc) {
    delete _running[name];
    if (callback) callback();
    return;
  }
  rec.stopping = true;
  var pid = rec.proc.pid;
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    delete _running[name];
    if (callback) callback();
  }
  rec.proc.once('exit', finish);
  if (process.platform === 'win32') {
    // Windows：taskkill 终止整棵进程树（子进程不残留）
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], function() { finish(); });
  } else {
    try { rec.proc.kill('SIGTERM'); } catch (e) {}
    setTimeout(function() {
      try { rec.proc.kill('SIGKILL'); } catch (e) {}
      finish();
    }, 3000).unref();
  }
  // 兜底：8s 后强制清理记录
  setTimeout(finish, 8000).unref();
}

// 停用/启用联动：停用杀进程，启用拉起（由 admin 启停路由调用）
function refreshProcessState(manifest, appDir, enabled) {
  if (!manifest || !manifest.backend || !manifest.backend.process) return;
  if (enabled) {
    startApp(manifest, appDir);
  } else {
    stopApp(manifest.name);
  }
}

// 状态查询（运行时检查器/诊断用）
function status() {
  var out = {};
  Object.keys(_running).forEach(function(name) {
    var r = _running[name];
    out[name] = {
      running: !!r.proc,
      port: r.port,
      restarts: r.restarts,
      pid: r.proc ? r.proc.pid : null,
      startedAt: r.startedAt,
      lastExitCode: r.lastExitCode === undefined ? null : r.lastExitCode
    };
  });
  return out;
}

// 端口占用探测（安装期防冲突）
function isPortFree(port) {
  var net = require('net');
  return new Promise(function(resolve) {
    var srv = net.createServer();
    srv.once('error', function() { resolve(false); });
    srv.once('listening', function() { srv.close(function() { resolve(true); }); });
    srv.listen(port, '127.0.0.1');
  });
}

module.exports = {
  startApp: startApp,
  stopApp: stopApp,
  refreshProcessState: refreshProcessState,
  status: status,
  isPortFree: isPortFree
};
