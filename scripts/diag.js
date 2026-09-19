#!/usr/bin/env node
// ClassIntra 第三方模块校验诊断 CLI（应用 / 主题 三合一，小组件随应用校验）
// 用法：
//   node scripts/diag.js app [app-name]   校验全部/指定应用（manifest 规范 + 文件完整性 + 路由冲突）
//   node scripts/diag.js theme [theme-id] 校验全部/指定主题（manifest 契约 + tokens 冒烟）
//   node scripts/diag.js all              两类都跑
// 校验项：
//   - manifest 走 server/src/core/manifest-schema.js（与运行时同一校验器，errors 阻断 / warnings 提示）
//   - 文件完整性：frontend.component / backend.entry / widgets[].component / tokens.js 是否存在
//   - 路由冲突：多个应用声明同一 frontend.route
//   - 主题：type 枚举 + tokens.js require 冒烟（导出 TOKENS 对象）

var fs = require('fs');
var path = require('path');
var schema = require('../server/src/core/manifest-schema');

var root = path.resolve(__dirname, '..');

function mark(ok, warn) { return ok ? '[OK]  ' : (warn ? '[WARN]' : '[FAIL]'); }

// ---------------- 应用校验 ----------------
function diagApp(onlyName) {
  var appsDir = path.join(root, 'apps');
  var names = fs.readdirSync(appsDir).filter(function (n) {
    return fs.existsSync(path.join(appsDir, n, 'manifest.json')) && (!onlyName || n === onlyName);
  });
  if (onlyName && !names.length) { console.log('[FAIL] 应用不存在或无 manifest.json：apps/' + onlyName); return false; }

  var routeMap = {};
  var allPass = true;

  names.forEach(function (name) {
    var problems = [];
    var warns = [];
    var m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(appsDir, name, 'manifest.json'), 'utf8')); }
    catch (e) { problems.push('manifest.json 解析失败：' + e.message); }

    if (m) {
      // 运行时同款校验器
      var r = schema.validateManifest(m);
      r.errors.forEach(function (e) { problems.push(e); });
      r.warnings.forEach(function (w) { warns.push(w); });

      if (m.name !== name) problems.push('manifest.name（' + m.name + '）与目录名不一致');

      // 文件完整性
      var fe = m.frontend || {};
      ['component', 'entry'].forEach(function (key) {
        if (fe[key] && !fs.existsSync(path.join(appsDir, name, fe[key]))) {
          problems.push('frontend.' + key + ' 文件不存在：' + fe[key]);
        }
      });
      if (Array.isArray(fe.widgets)) {
        fe.widgets.forEach(function (w) {
          if (!w.id || !w.component) { problems.push('widgets[] 项缺少 id 或 component'); return; }
          if (!fs.existsSync(path.join(appsDir, name, w.component))) {
            problems.push('小组件「' + w.id + '」组件不存在：' + w.component);
          }
        });
      }
      if (m.backend && m.backend.entry && !fs.existsSync(path.join(appsDir, name, m.backend.entry))) {
        problems.push('backend.entry 文件不存在：' + m.backend.entry);
      }

      // 路由冲突
      if (fe.route) {
        if (routeMap[fe.route]) problems.push('route 冲突：' + fe.route + ' 已被 ' + routeMap[fe.route] + ' 占用');
        else routeMap[fe.route] = name;
      }
    }

    var ok = problems.length === 0;
    if (!ok) allPass = false;
    console.log(mark(ok, !ok && problems.length === 0) + ' app    ' + name +
      '  v' + ((m && m.version) || '?') + '  route=' + ((m.frontend && m.frontend.route) || '-') +
      '  widgets=' + ((m.frontend && m.frontend.widgets && m.frontend.widgets.length) || 0) +
      (m.backend ? '  backend' : ''));
    problems.forEach(function (p) { console.log('       ✗ ' + p); });
    warns.forEach(function (w) { console.log('       ⚠ ' + w); });
  });
  return allPass;
}

// ---------------- 主题校验 ----------------
function diagTheme(onlyId) {
  var themesDir = path.join(root, 'themes');
  var ids = fs.readdirSync(themesDir).filter(function (n) {
    return fs.existsSync(path.join(themesDir, n, 'manifest.json')) && (!onlyId || n === onlyId);
  });
  if (onlyId && !ids.length) { console.log('[FAIL] 主题不存在或无 manifest.json：themes/' + onlyId); return false; }

  var allPass = true;
  ids.forEach(function (id) {
    var problems = [];
    var warns = [];
    var m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(themesDir, id, 'manifest.json'), 'utf8')); }
    catch (e) { problems.push('manifest.json 解析失败：' + e.message); }

    if (m) {
      if (!m.id) problems.push('id 字段缺失');
      else if (m.id !== id) problems.push('manifest.id（' + m.id + '）与目录名不一致');
      if (!m.name) problems.push('name 字段缺失');
      if (m.type !== 'light' && m.type !== 'dark') problems.push('type 必须为 light 或 dark（theme-loader 强约束），当前：' + m.type);
      if (!m.tokens) warns.push('未声明 tokens 路径，主题将无 token 数据');
      if (m.tokens) {
        var tokensPath = path.join(themesDir, id, m.tokens);
        if (!fs.existsSync(tokensPath)) problems.push('tokens 文件不存在：' + m.tokens);
        else {
          // require 冒烟：确认导出 TOKENS 对象（theme-loader 读 TOKENS/default）
          delete require.cache[require.resolve(tokensPath)];
          var mod = require(tokensPath);
          var tokens = mod && (mod.TOKENS || mod.default) || (typeof mod === 'object' ? mod : null);
          if (!tokens || typeof tokens !== 'object') problems.push('tokens.js 未导出 TOKENS 对象');
          else if (!tokens.color) warns.push('tokens 缺少 color 分组（主题将基本不可定制）');
        }
      }
    }

    var ok = problems.length === 0;
    if (!ok) allPass = false;
    console.log(mark(ok) + ' theme  ' + id + '  v' + ((m && m.version) || '?') + '  type=' + ((m && m.type) || '-'));
    problems.forEach(function (p) { console.log('       ✗ ' + p); });
    warns.forEach(function (w) { console.log('       ⚠ ' + w); });
  });
  return allPass;
}

// ---------------- 入口 ----------------
var kind = process.argv[2];
var target = process.argv[3];
var results = {};

if (!kind || (kind !== 'app' && kind !== 'theme' && kind !== 'all')) {
  console.log('ClassIntra 第三方模块校验诊断');
  console.log('  node scripts/diag.js app [app-name]    应用校验（含小组件/路由冲突）');
  console.log('  node scripts/diag.js theme [theme-id]  主题校验（含 tokens 冒烟）');
  console.log('  node scripts/diag.js all               全部');
  process.exit(kind ? 1 : 0);
}

console.log('== ClassIntra 第三方模块校验 ==');
if (kind === 'app' || kind === 'all') results.app = diagApp(kind === 'all' ? null : target);
if (kind === 'theme' || kind === 'all') results.theme = diagTheme(kind === 'all' ? null : target);

var failed = Object.keys(results).some(function (k) { return results[k] === false; });
console.log(failed ? '== 存在阻断性问题 ==' : '== 全部通过 ==');
process.exit(failed ? 1 : 0);
