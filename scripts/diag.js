#!/usr/bin/env node
// ClassIntra 第三方模块校验诊断 CLI（应用 / 插件 / 主题 三合一，小组件随应用校验）
// 用法：
//   node scripts/diag.js app [app-name]     校验全部/指定应用（manifest 规范 + 文件完整性 + 路由冲突）
//   node scripts/diag.js plugin [plug-name] 校验全部/指定插件（backend 必有 + 挂载点冲突）
//   node scripts/diag.js theme [theme-id]   校验全部/指定主题（manifest 契约 + tokens 冒烟）
//   node scripts/diag.js compat [app-name]  Chrome 80 兼容性 lint（apps + market-apps 前端，all 时自动附带）
//   node scripts/diag.js all                全部
// 校验项：
//   - manifest 走 server/src/core/manifest-schema.js（与运行时同一校验器，errors 阻断 / warnings 提示）
//   - 文件完整性：frontend.component / backend.entry / widgets[].component / tokens.js 是否存在
//   - 路由冲突：多个应用声明同一 frontend.route；插件/应用声明同一 backend.mountPath
//   - 插件特有：backend（mountPath + entry）必填——插件无前端页面，纯后端扩展
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

// ---------------- 插件校验 ----------------
function diagPlugin(onlyName) {
  var pluginsDir = path.join(root, 'plugins');
  var names = fs.readdirSync(pluginsDir).filter(function (n) {
    // _sdk / node_modules 等无 manifest.json 的目录自动跳过（与运行时 manifest-loader 行为一致）
    return fs.existsSync(path.join(pluginsDir, n, 'manifest.json')) && (!onlyName || n === onlyName);
  });
  if (onlyName && !names.length) { console.log('[FAIL] 插件不存在或无 manifest.json：plugins/' + onlyName); return false; }

  // 挂载点占用表：先收应用的 backend.mountPath，再做跨类冲突检测
  var mountMap = {};
  var appsDir = path.join(root, 'apps');
  fs.readdirSync(appsDir).forEach(function (n) {
    try {
      var am = JSON.parse(fs.readFileSync(path.join(appsDir, n, 'manifest.json'), 'utf8'));
      if (am.backend && am.backend.mountPath) mountMap[am.backend.mountPath] = 'app:' + n;
    } catch (e) { /* 应用自身问题由 diagApp 报告 */ }
  });

  var allPass = true;
  names.forEach(function (name) {
    var problems = [];
    var warns = [];
    var m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(pluginsDir, name, 'manifest.json'), 'utf8')); }
    catch (e) { problems.push('manifest.json 解析失败：' + e.message); }

    if (m) {
      var r = schema.validateManifest(m);
      r.errors.forEach(function (e) { problems.push(e); });
      r.warnings.forEach(function (w) { warns.push(w); });

      if (m.name !== name) problems.push('manifest.name（' + m.name + '）与目录名不一致');
      if (m.type !== 'plugin') problems.push('插件目录的 manifest.type 必须为 "plugin"，当前：' + (m.type || '(缺省)'));
      if (m.frontend) warns.push('插件无前端页面，frontend 字段将被忽略');

      // 插件后端必有：主 backend + extraBackends 逐项校验
      var backs = [];
      if (m.backend) backs.push(m.backend);
      if (Array.isArray(m.extraBackends)) backs = backs.concat(m.extraBackends);
      if (!backs.length) {
        problems.push('插件必须有 backend 声明（mountPath + entry）——插件是纯后端扩展');
      } else {
        backs.forEach(function (b, i) {
          var tag = (m.backend === b) ? 'backend' : 'extraBackends[' + i + ']';
          if (!b.mountPath) problems.push(tag + '.mountPath 缺失');
          else if (mountMap[b.mountPath]) problems.push('挂载点冲突：' + b.mountPath + ' 已被 ' + mountMap[b.mountPath] + ' 占用');
          else mountMap[b.mountPath] = 'plugin:' + name;
          if (!b.entry) problems.push(tag + '.entry 缺失');
          else if (!fs.existsSync(path.join(pluginsDir, name, b.entry))) problems.push(tag + '.entry 文件不存在：' + b.entry);
        });
      }
    }

    var ok = problems.length === 0;
    if (!ok) allPass = false;
    console.log(mark(ok) + ' plugin ' + name +
      '  v' + ((m && m.version) || '?') +
      '  mount=' + (((m && m.backend && m.backend.mountPath)) || '-') +
      (Array.isArray(m.extraBackends) && m.extraBackends.length ? '  +' + m.extraBackends.length : ''));
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

// ---------------- 兼容性 lint（Chrome 80 基线） ----------------
// 分级依据：
//   - failRaw：语法类新特性（?. ?? &&= 等）。apps/ 经 vite 构建（esbuild target chrome80）自动转译，
//     不构成问题；market-apps/ 原生直出浏览器无任何转译，Chrome 80 上必挂 → FAIL
//   - failAlways：运行时 API（replaceChildren/.at()/findLast/structuredClone）与 CSS 新特性
//     （aspect-ratio/inset/dvh/:is()）。esbuild 只转译语法，这些构建救不了、也无 polyfill → 一律 FAIL
//   - warn：gap（apps/ 的 flex gap 有构建期 polyfill，grid 需 grid-gap；market-apps/ 直出无 polyfill → FAIL，
//     与 motion-verify.js E3 同标准）、backdrop-filter 缺 -webkit- 前缀（Safari 不渲染）
var JS_RULES = [
  { re: /[\w)\]]\?\./, msg: '可选链 ?.（Chrome 80 不支持；直出无转译）', failRaw: true },
  { re: /\?\?/, msg: '空值合并 ??（Chrome 80 不支持；直出无转译）', failRaw: true },
  { re: /&&=|\|\|=/, msg: '逻辑赋值 &&=/||=（Chrome 85+；直出无转译）', failRaw: true },
  { re: /\?\?=/, msg: '逻辑赋值 ??=（Chrome 85+；直出无转译）', failRaw: true },
  { re: /\bstructuredClone\s*\(/, msg: 'structuredClone（Chrome 98+；构建不可转译）', failAlways: true },
  { re: /[\w)\]]\.replaceChildren\s*\(/, msg: 'replaceChildren（Chrome 86+；构建不可转译）', failAlways: true },
  { re: /[\w)\]]\.at\s*\(/, msg: '.at()（Chrome 92+；构建不可转译）', failAlways: true },
  { re: /[\w)\]]\.findLast(Index)?\s*\(/, msg: 'findLast/findLastIndex（Chrome 97+；构建不可转译）', failAlways: true }
];
var CSS_RULES = [
  { re: /(^|[\s;{])aspect-ratio\s*:/, msg: 'aspect-ratio（Chrome 88+；无 polyfill）', failAlways: true },
  { re: /(^|[\s;{])inset\s*:/, msg: 'inset 简写（Chrome 87+）；改用 top/right/bottom/left', failAlways: true },
  { re: /\b(dvh|svh|lvh)\b/, msg: 'dvh/svh/lvh 单位（Chrome 108+）；改用 vh + JS 或 100%', failAlways: true },
  { re: /:is\s*\(|:where\s*\(/, msg: ':is()/:where()（Chrome 88+）；展开为具体选择器', failAlways: true },
  { key: 'gap', re: /(^|[\s;{])gap\s*:/, msg: 'gap（Chrome 84+；flex 用 margin 替代，grid 用 grid-gap）' },
  { key: 'backdrop', re: /backdrop-filter/, msg: 'backdrop-filter 缺 -webkit- 前缀（Safari 不渲染）；补一行 -webkit-backdrop-filter' }
];

// 拆分 .vue：只扫 <script>（按 JS 规则）与 <style>（按 CSS 规则）；<template> 区跳过
//（Vue 2 模板表达式编译为 render 函数后经 esbuild 转译，直出场景不存在）
function splitVueSegs(src) {
  var lines = src.split('\n');
  var segs = [];
  var mode = null;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*<script\b/.test(l)) { mode = 'js'; continue; }
    if (/^\s*<\/script>/.test(l)) { mode = null; continue; }
    if (/^\s*<style\b/.test(l)) { mode = 'css'; continue; }
    if (/^\s*<\/style>/.test(l)) { mode = null; continue; }
    if (mode) segs.push({ type: mode, line: l, no: i + 1 });
  }
  return segs;
}

// 递归收集 frontend/ 下待扫文件（.js/.vue/.css，跳过 node_modules）
function collectFrontendFiles(dir) {
  var out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (name) {
    var p = path.join(dir, name);
    var st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') return;
      out = out.concat(collectFrontendFiles(p));
    } else if (/\.(js|vue|css)$/.test(name)) {
      out.push(p);
    }
  });
  return out;
}

function diagCompat(onlyName) {
  // 扫描目标：apps/*（构建型，failRaw 豁免）+ market-apps/*（直出型，全严格）
  var groups = [
    { dir: 'apps', raw: false },
    { dir: 'market-apps', raw: true }
  ].map(function (g) {
    var base = path.join(root, g.dir);
    var names = fs.existsSync(base)
      ? fs.readdirSync(base).filter(function (n) {
          return fs.existsSync(path.join(base, n, 'manifest.json')) && (!onlyName || n === onlyName);
        })
      : [];
    return { dir: g.dir, raw: g.raw, names: names };
  });

  if (onlyName && groups.every(function (g) { return !g.names.length; })) {
    console.log('[FAIL] 兼容扫描目标不存在（apps/ 与 market-apps/ 均无）：' + onlyName);
    return false;
  }

  var allPass = true;
  groups.forEach(function (g) {
    g.names.forEach(function (name) {
      var problems = [];
      var warns = [];
      var files = collectFrontendFiles(path.join(root, g.dir, name, 'frontend'));
      files.forEach(function (f) {
        var rel = path.relative(root, f).replace(/\\/g, '/');
        var src;
        try { src = fs.readFileSync(f, 'utf8'); } catch (e) { return; }

        // 统一为逐行段列表：.vue 只取 script/style 区，.js/.css 整文件单一段
        var segs;
        if (/\.vue$/.test(f)) {
          segs = splitVueSegs(src);
        } else {
          var t = /\.css$/.test(f) ? 'css' : 'js';
          segs = src.split('\n').map(function (line, idx) {
            return { type: t, line: line, no: idx + 1 };
          });
        }

        // 块注释整段跳过 + JS 的 // 行跳过（避免文档注释里出现的 API 名误报；
        // 行内尾注释仍会被扫，属可接受误差）
        var active = [];
        var inComment = false;
        segs.forEach(function (seg) {
          if (inComment) {
            if (seg.line.indexOf('*/') !== -1) inComment = false;
            return;
          }
          var ci = seg.line.indexOf('/*');
          if (ci !== -1) {
            if (seg.line.indexOf('*/', ci + 2) === -1) inComment = true;
            return;
          }
          if (seg.type === 'js' && /^\s*\/\//.test(seg.line)) return;
          active.push(seg);
        });

        active.forEach(function (seg) {
          var loc = rel + ':' + seg.no;
          var text = seg.line;

          if (seg.type === 'js') {
            for (var j = 0; j < JS_RULES.length; j++) {
              var r = JS_RULES[j];
              if (!r.re.test(text)) continue;
              if (r.failRaw && !g.raw) continue; // 构建型应用由 esbuild 转译，豁免
              problems.push(loc + '  ' + r.msg);
              break;
            }
          } else {
            for (var k = 0; k < CSS_RULES.length; k++) {
              var c = CSS_RULES[k];
              if (c.key === 'backdrop') {
                if (!/-webkit-backdrop-filter/.test(text) && c.re.test(text.replace(/-webkit-backdrop-filter/g, ''))) {
                  warns.push(loc + '  ' + c.msg);
                }
                continue;
              }
              if (!c.re.test(text)) continue;
              if (c.key === 'gap' && g.raw) { problems.push(loc + '  ' + c.msg + '（直出无 polyfill）'); continue; }
              if (c.key === 'gap') { warns.push(loc + '  ' + c.msg); continue; }
              problems.push(loc + '  ' + c.msg);
              break;
            }
          }
        });
      });

      var ok = problems.length === 0;
      if (!ok) allPass = false;
      console.log(mark(ok) + ' compat ' + name + '（' + g.dir + (g.raw ? '，直出' : '，构建') + '）  ' + files.length + ' 个前端文件');
      problems.forEach(function (p) { console.log('       ✗ ' + p); });
      warns.forEach(function (w) { console.log('       ⚠ ' + w); });
    });
  });
  return allPass;
}

// ---------------- 入口 ----------------
var kind = process.argv[2];
var target = process.argv[3];
var results = {};

if (!kind || (kind !== 'app' && kind !== 'plugin' && kind !== 'theme' && kind !== 'compat' && kind !== 'all')) {
  console.log('ClassIntra 第三方模块校验诊断');
  console.log('  node scripts/diag.js app [app-name]     应用校验（含小组件/路由冲突）');
  console.log('  node scripts/diag.js plugin [plug-name] 插件校验（backend 必有/挂载点冲突）');
  console.log('  node scripts/diag.js theme [theme-id]   主题校验（含 tokens 冒烟）');
  console.log('  node scripts/diag.js compat [app-name]  Chrome 80 兼容性 lint（apps + market-apps）');
  console.log('  node scripts/diag.js all                全部');
  process.exit(kind ? 1 : 0);
}

console.log('== ClassIntra 第三方模块校验 ==');
if (kind === 'app' || kind === 'all') results.app = diagApp(kind === 'all' ? null : target);
if (kind === 'plugin' || kind === 'all') results.plugin = diagPlugin(kind === 'all' ? null : target);
if (kind === 'theme' || kind === 'all') results.theme = diagTheme(kind === 'all' ? null : target);
if (kind === 'compat' || kind === 'all') results.compat = diagCompat(kind === 'all' ? null : target);

var failed = Object.keys(results).some(function (k) { return results[k] === false; });
console.log(failed ? '== 存在阻断性问题 ==' : '== 全部通过 ==');
process.exit(failed ? 1 : 0);
