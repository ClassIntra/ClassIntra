#!/usr/bin/env node
// ClassIntra 应用前端开发循环工具（apps/ 内置应用 与 market-apps/ 市场应用通吃）
//
// 两类应用的前端生效机制完全不同：
//   apps/       → vite 全量打包进 client/dist（改一行也要全量构建）
//   market-apps/ → 原生 entry.js/style.css 由服务器 /market-static 直出，无缓存头，
//                  改完刷新浏览器即生效，无需任何构建
// 本工具按类型自动走对应流程：
//   node scripts/build-app.js <name>           兼容 lint +（apps/）vite 构建 /（market-apps/）直出检查
//   node scripts/build-app.js <name> --watch   market-apps/ 专用：监听文件变化自动重跑 lint 并提示刷新
//
// apps/ 修改一行的开发期迭代不建议反复全量构建，用 HMR：
//   cd client && npx vite dev   （改 .vue 秒级热更新，/api 自动代理到 9001）

var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;

var root = path.resolve(__dirname, '..');

var name = process.argv[2];
var watch = process.argv.indexOf('--watch') !== -1;

if (!name) {
  console.log('用法：node scripts/build-app.js <app-name> [--watch]');
  console.log('  <name> 依次在 apps/（构建型）与 market-apps/（直出型）中查找');
  process.exit(1);
}

// 定位应用类型
var mode = null; // 'apps' | 'market-apps'
var appDir = null;
['apps', 'market-apps'].some(function (dir) {
  var p = path.join(root, dir, name);
  if (fs.existsSync(path.join(p, 'manifest.json'))) { mode = dir; appDir = p; return true; }
  return false;
});
if (!mode) {
  console.error('找不到应用：' + name + '（apps/ 与 market-apps/ 均无 manifest.json）');
  process.exit(1);
}

function runLint() {
  return new Promise(function (resolve) {
    var child = spawn(process.execPath, [path.join(root, 'scripts', 'diag.js'), 'compat', name], { stdio: 'inherit' });
    child.on('close', function (code) { resolve(code === 0); });
  });
}

// ---------------- market-apps/：直出型 ----------------
function checkMarket() {
  var m = JSON.parse(fs.readFileSync(path.join(appDir, 'manifest.json'), 'utf8'));
  var missing = [];
  ['entry', 'style'].forEach(function (key) {
    var rel = m.frontend && m.frontend[key];
    if (rel && !fs.existsSync(path.join(appDir, rel))) missing.push('frontend.' + key + ' → ' + rel);
  });
  if (m.icon && m.icon.indexOf('./') === 0 && !fs.existsSync(path.join(appDir, m.icon))) {
    missing.push('icon → ' + m.icon);
  }
  if (missing.length) {
    console.error('文件缺失：');
    missing.forEach(function (x) { console.error('  ✗ ' + x); });
    process.exit(1);
  }
  console.log('');
  console.log('[直出型] market-apps/' + name + ' 无需构建：');
  console.log('  - 前端由服务器 /market-static/' + name + '/ 直接提供（响应带 no-cache，改完刷新即生效）');
  console.log('  - 页面路由 ' + ((m.frontend && m.frontend.route) || '?') + ' ；后端挂载 ' + ((m.backend && m.backend.mountPath) || '无'));
  console.log('  - 改 backend/ 需重启服务器，或以 CLASSINTRA_HOT_RELOAD=1 启动实现热重载');
  if (watch) watchMarket();
}

function watchMarket() {
  console.log('');
  console.log('[watch] 监听 market-apps/' + name + ' 变化（Ctrl+C 退出）...');
  var timer = null;
  fs.watch(appDir, { recursive: true }, function (event, filename) {
    if (!filename) return;
    var rel = String(filename).replace(/\\/g, '/');
    clearTimeout(timer);
    // 防抖：编辑器保存常触发多次事件
    timer = setTimeout(function () {
      var ts = new Date().toTimeString().slice(0, 8);
      if (rel.indexOf('backend/') === 0) {
        console.log('[' + ts + '] ' + rel + ' 变更 → 后端需重启服务器（或 CLASSINTRA_HOT_RELOAD=1 启动）');
        return;
      }
      runLint().then(function (ok) {
        console.log('[' + ts + '] ' + rel + ' 变更 → ' + (ok ? 'lint 通过，刷新浏览器即生效' : 'lint 未过，修复后刷新'));
      });
    }, 300);
  });
}

// ---------------- apps/：构建型 ----------------
function buildApps() {
  if (watch) {
    console.log('[提示] apps/ 为 vite 全量打包，watch 逐次全量构建无收益。');
    console.log('       开发期请用 HMR：cd client && npx vite dev （改 .vue 秒级热更新）');
    console.log('       （market-apps/ 才支持 --watch；本命令继续执行一次完整构建）');
  }
  console.log('vite build 构建中（全量，产物 client/dist/）...');
  var viteBin = path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    console.error('找不到 vite：' + viteBin + '（先在 client/ 下 npm install）');
    process.exit(1);
  }
  var child = spawn(process.execPath, [viteBin, 'build'], { cwd: path.join(root, 'client'), stdio: 'inherit' });
  child.on('close', function (code) {
    if (code === 0) {
      console.log('构建完成。前端改动需已包含全部应用（vite 全量打包，无法单应用构建）。');
    }
    process.exit(code || 0);
  });
}

// ---------------- 入口 ----------------
runLint().then(function (ok) {
  if (!ok) {
    console.error('兼容性 lint 未通过，请先修复上方 ✗ 项（详见 docs/third-party-development.md 兼容基线一节）');
    process.exit(1);
  }
  if (mode === 'market-apps') checkMarket();
  else buildApps();
});
