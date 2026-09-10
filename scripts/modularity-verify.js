#!/usr/bin/env node
// ============================================================
// modularity-verify.js — 模块化「删除式自测」（零删除实现）
// ============================================================
// 验证 ClassIntra「一切皆可扩展、无模块也可正常使用」的架构约束。
//
// 实现原理（对生产目录零影响）：
//   在系统临时目录建「快照」：源码目录（client/server/shared/themes）整体 junction，
//   模块源（apps/plugins/market-apps）逐子项 junction。
//   “移除模块” = 把对应 junction 链接 rename 到快照内 _removed/ 隐藏目录
//   —— 扫描器（manifest 聚合/路由聚合）不再看到该模块，等效于目录被删除；
//   全程无任何删除操作，天然兼容受限删除配额的环境。
//
//   L1 plugins：隐藏 plugins/ + market-apps/（保留全部 apps/）
//   L2 modules：再隐藏可选业务 apps/（仅保留必需系统模块 settings/admin）
//
// 校验步骤：
//   1) client 生产构建（vite build → 快照内 client-dist，不污染真实 dist）
//   2) server 冷启动（隔离 PORT/WS_PORT/RELAY_PORT/DB_PATH/RESOURCES_DIR）
//   3) 核心健康/版本端点冒烟
//
// 用法：
//   node scripts/modularity-verify.js [--mode plugins|modules|all] [--skip-build] [--skip-boot]
//   环境变量 NODE_EXE 可指定与 native 模块（better-sqlite3）ABI 匹配的 Node
//   退出码：0 = 全绿；非 0 = 存在断点
//
// 快照留在 %TEMP%/ci-modular-verify/ 下（自动清理为尽力而为，可手动删除）。

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var { spawnSync, spawn } = require('child_process');

// ---------- 参数 ----------
var args = process.argv.slice(2);
function argVal(name, dflt) {
  var i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
var mode = argVal('mode', 'all');   // plugins | modules | all
var label = mode;                   // 当前迭代模式（main 循环中会逐轮更新）
var skipBuild = args.indexOf('--skip-build') !== -1;
var skipBoot = args.indexOf('--skip-boot') !== -1;

var root = path.resolve(__dirname, '..');
var tmpBase = path.join(os.tmpdir(), 'ci-modular-verify');
var runDir = path.join(tmpBase, 'run-' + Date.now());
var hideDir = path.join(runDir, '_removed');

// 必需系统模块（平台核心，L2 中保留）
var REQUIRED_MODULES = ['settings', 'admin'];

// 可选业务模块（L2 中隐藏）
var OPTIONAL_APPS = [
  'ai-chat', 'bot-admin', 'calculator', 'calendar', 'chat', 'cloud',
  'community', 'countdown', 'integration', 'market', 'music', 'notes',
  'resource', 'timetable', 'weather'
];

// 只读挂载的源码目录（整体 junction，永不隐藏）。
// client 与 server 不在此列：二者必须真实拷贝 ——
//   client 若为 junction，rollup 用 realpath 得到生产绝对路径去 emit index.html，
//   触发 "fileName must be neither absolute nor relative"；
//   server 若为 junction，其 core/manifest-loader 以 __dirname 反推的根是生产仓库根，
//   加载的将是生产模块而非快照内已隐藏的模块，启动验证失去意义。
var MOUNT_DIRS = ['shared', 'themes'];
// 模块根目录（plugins/market-apps 整目录隐藏；apps 逐子项隐藏）
var MODULE_ROOTS = ['plugins', 'market-apps', 'apps'];

// ---------- 小工具 ----------
function log(prefix, msg) { console.log('[' + prefix + '] ' + msg); }
function fail(prefix, msg) { console.error('[' + prefix + '] FAIL: ' + msg); }

// robocopy 多线程拷贝（排除 node_modules/dist 等）。退出码 <8 视为成功
function copyDir(src, dst, extraExcludes) {
  var ex = ['node_modules', 'dist', '.git', 'logs', 'build.log'].concat(extraExcludes || []);
  var args = [src, dst, '/E', '/MT:32', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD'].concat(ex);
  var r = spawnSync('robocopy', args, { encoding: 'utf8' });
  var code = (r.status === null) ? 1 : r.status;
  if (code >= 8) {
    fail('copy', 'robocopy 失败 code=' + code + ' src=' + src);
    return false;
  }
  return true;
}

function junction(target, link) {
  // Windows 目录联接（junction），无需管理员权限
  fs.symlinkSync(target, link, 'junction');
}

// 把快照内的模块链接「移出扫描范围」（rename，非删除）
function moveOut(p, destDir) {
  if (!fs.existsSync(p)) return;
  fs.mkdirSync(destDir, { recursive: true });
  var dest = path.join(destDir, path.basename(p));
  fs.renameSync(p, dest);
  log('drill', '已隐藏: ' + path.relative(runDir, p));
}

function linkChildDir(parentSrc, parentDst, name) {
  var src = path.join(parentSrc, name);
  var dst = path.join(parentDst, name);
  var st;
  try { st = fs.lstatSync(src); } catch (e) { return; }
  if (st.isSymbolicLink()) junction(fs.realpathSync(src), dst);
  else if (st.isDirectory()) junction(src, dst);
  else fs.copyFileSync(src, dst);
}

// 选择与 native 模块（better-sqlite3）ABI 匹配的 Node 运行时
function nodeExe() {
  if (process.env.NODE_EXE) return process.env.NODE_EXE;
  var candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'nodejs', 'node.exe'),
    process.execPath
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { fs.accessSync(candidates[i]); return candidates[i]; } catch (e) {}
  }
  return process.execPath;
}

// ---------- 快照 ----------
function prepare() {
  var rel = path.relative(tmpBase, runDir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('快照路径不在临时目录内，已中止');
  }
  fs.mkdirSync(runDir, { recursive: true });

  // client / server 真实拷贝（原因见 MOUNT_DIRS 注释）
  ['client', 'server'].forEach(function(name) {
    if (!copyDir(path.join(root, name), path.join(runDir, name))) {
      throw new Error(name + ' 拷贝失败');
    }
  });

  MOUNT_DIRS.forEach(function(name) {
    var src = path.join(root, name);
    if (fs.existsSync(src)) junction(src, path.join(runDir, name));
  });

  // 模块源由 label 决定：plugins/market-apps 一律不挂载（=不存在）；
  // apps 见 prepareModules()
  prepareModules();

  // node_modules：client/server 随整体 junction 已包含；若缺则单独补 junction
  ['client', 'server'].forEach(function(name) {
    var srcNm = path.join(root, name, 'node_modules');
    var dstNm = path.join(runDir, name, 'node_modules');
    if (fs.existsSync(srcNm) && !fs.existsSync(dstNm)) {
      if (fs.lstatSync(srcNm).isSymbolicLink()) junction(fs.realpathSync(srcNm), dstNm);
      else junction(srcNm, dstNm);
    }
  });
  log('drill', '快照就绪: ' + runDir);
}

// 按 label 组织模块源（见 prepare 调用处注释）：
//   plugins / market-apps 不挂载 = 目录不存在；
//   apps：plugins 模式整体 junction（子项为真实目录，Dirent.isDirectory()=true，
//         server 的 manifest-loader 按 isDirectory 扫描可看到全部应用）；
//         modules 模式真实拷贝必需系统模块（settings/admin 无 node_modules，拷贝轻量）
function prepareModules() {
  var appsSrc = path.join(root, 'apps');
  if (label === 'plugins') {
    if (fs.existsSync(appsSrc)) junction(appsSrc, path.join(runDir, 'apps'));
    log('drill', '已移除(不挂载): plugins/ market-apps/；apps/ 完整保留');
    return;
  }
  fs.mkdirSync(path.join(runDir, 'apps'), { recursive: true });
  REQUIRED_MODULES.forEach(function(name) {
    var src = path.join(root, 'apps', name);
    if (fs.existsSync(src)) copyDir(src, path.join(runDir, 'apps', name));
  });
  log('drill', '已移除(不挂载): plugins/ market-apps/ 与可选业务 apps/；仅保留必需系统模块 [' + REQUIRED_MODULES.join(', ') + ']');
}

function hideOptional() {
  // plugins / market-apps 未挂载即“不存在”，无需额外动作；
  // modules 模式的 apps 只含必需系统模块，天然满足“无业务模块”。
}

// ---------- 构建 ----------
function build() {
  var clientDir = path.join(runDir, 'client');
  var outDir = path.join(runDir, 'client-dist');
  log('build', 'vite build 开始（outDir=' + outDir + '）...');
  var r = spawnSync(nodeExe(), ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--logLevel', 'warn'], {
    cwd: clientDir,
    encoding: 'utf8',
    timeout: 600000,
    env: Object.assign({}, process.env, { NODE_ENV: 'production' })
  });
  if (r.status !== 0) {
    fail('build', '构建失败，exit=' + r.status);
    console.error(((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').slice(-50).join('\n'));
    return false;
  }
  log('build', '构建成功');
  return true;
}

// ---------- 启动冒烟 ----------
function waitHttp(url, timeoutMs) {
  return new Promise(function(resolve) {
    var started = Date.now();
    (function poll() {
      var req = http.get(url, function(res) {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500 });
      });
      req.on('error', function() {
        if (Date.now() - started > timeoutMs) resolve({ ok: false, error: 'timeout' });
        else setTimeout(poll, 1000);
      });
    })();
  });
}

function boot() {
  return new Promise(function(resolve) {
    var serverDir = path.join(runDir, 'server');
    var dbPath = path.join(runDir, 'drill.db');
    var logFile = path.join(runDir, 'server-boot.log');
    var env = Object.assign({}, process.env, {
      NODE_ENV: 'production',
      PORT: '9111',
      WS_PORT: '11111',
      RELAY_PORT: '12111',
      DB_PATH: dbPath,
      RESOURCES_DIR: path.join(root, 'Resources'),
      JWT_SECRET: 'modularity-verify-drill-secret',
      SYNCTHING_PORT: '18384',
      ADMIN_USER_IDS: '',
      // 与生产一致：apps/ 后端 bare import（express 等）经 NODE_PATH 指向 server/node_modules
      NODE_PATH: path.join(serverDir, 'node_modules')
    });
    var child = spawn(nodeExe(), ['src/app.js'], { cwd: serverDir, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    var out = fs.createWriteStream(logFile);
    child.stdout.pipe(out);
    child.stderr.pipe(out);

    var settled = false;
    var finish = function(ok, reason) {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(function() { try { child.kill('SIGKILL'); } catch (e) {} }, 12000);
      if (!ok) {
        fail('boot', reason || '启动冒烟失败，日志: ' + logFile);
        try {
          console.error('---- 服务端日志尾部 ----');
          console.error(fs.readFileSync(logFile, 'utf8').split('\n').slice(-50).join('\n'));
        } catch (e) {}
      } else {
        log('boot', '启动冒烟通过（日志: ' + logFile + '）');
      }
      resolve(ok);
    };

    child.on('error', function(err) { finish(false, '启动失败: ' + err.message); });
    child.on('exit', function(code) {
      if (!settled) finish(false, '进程提前退出 code=' + code);
    });
    waitHttp('http://127.0.0.1:9111/api/system/health', 45000).then(function(r) {
      if (!r.ok) {
        finish(false, '健康端点未就绪: ' + (r.error || ('http ' + r.statusCode)));
        return;
      }
      http.get('http://127.0.0.1:9111/api/system/version', function(res) {
        res.resume();
        finish(res.statusCode === 200, '版本端点异常: http ' + res.statusCode);
      }).on('error', function() { finish(false, '版本端点请求失败'); });
    });
  });
}

// ---------- 主流程 ----------
async function main() {
  var modes = mode === 'all' ? ['plugins', 'modules'] : [mode];
  var allPass = true;
  var snapshotRoots = [];
  for (var i = 0; i < modes.length; i++) {
    var m = modes[i];
    label = m;
    console.log('\n================ 删除式自测 [' + m + '] ================');
    runDir = path.join(tmpBase, 'run-' + Date.now() + '-' + m);
    hideDir = path.join(runDir, '_removed');
    snapshotRoots.push(runDir);
    try { prepare(); } catch (e) {
      allPass = false;
      console.error('[drill] 快照准备失败:', e.message);
      break;
    }
    try { hideOptional(m); } catch (e) {
      allPass = false;
      console.error('[drill] 模块隐藏失败:', e.message);
      break;
    }
    if (!skipBuild && !build()) { allPass = false; continue; }
    if (!skipBoot) {
      var ok = await boot();
      if (!ok) allPass = false;
    }
  }
  console.log('\n========================================');
  console.log(allPass
    ? '[result] 删除式自测通过（无插件 / 无可选模块均可构建、启动并通过核心冒烟）'
    : '[result] 删除式自测失败，见上方断点');
  if (snapshotRoots.length) {
    console.log('快照保留于（验证后可手动删除）: ' + path.join(tmpBase, 'run-*'));
  }
  process.exit(allPass ? 0 : 1);
}

main();
