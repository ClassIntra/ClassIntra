#!/usr/bin/env node
// ClassIntra 第三方模块校验诊断 CLI（应用 / 插件 / 主题 三合一，小组件随应用校验）
// 用法：
//   node scripts/diag.js app [app-name]     校验全部/指定应用（manifest 规范 + 文件完整性 + 路由冲突）
//   node scripts/diag.js plugin [plug-name] 校验全部/指定插件（backend 必有 + 挂载点冲突）
//   node scripts/diag.js theme [theme-id]   校验全部/指定主题（manifest 契约 + tokens 冒烟）
//   node scripts/diag.js compat [app-name]  Chrome 80 兼容性 lint（apps + market-apps 前端，all 时自动附带）
//   node scripts/diag.js market [name]      市场应用预校验（market-apps/ 与 ../market/apps/，与安装时同一校验器）
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
  //           + ../market/apps/*（市场源目录——装前预检也该能跑兼容 lint）
  var groups = [
    { dir: 'apps', raw: false },
    { dir: 'market-apps', raw: true },
    { dir: path.join('..', 'market', 'apps'), raw: true }
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

// ---------------- 市场应用预校验 ----------------
// 与安装时同一份校验器（market-service.validateMarketManifest），把原本
// "用户点安装才暴露" 的 manifest/文件问题提前到开发阶段。
// 校验目标：market-apps/<name>（已安装目录）与本地市场源 ../market/apps/<name>（源码目录）。
function diagMarket(onlyName) {
  var marketService = require('../server/src/core/market-service');
  var appsDir = path.join(root, 'apps');

  // 官方应用已占用的 route / mountPath（冲突检测用）
  var officialRoutes = {};
  var officialMounts = {};
  try {
    fs.readdirSync(appsDir).forEach(function (n) {
      var mp = path.join(appsDir, n, 'manifest.json');
      if (!fs.existsSync(mp)) return;
      try {
        var m = JSON.parse(fs.readFileSync(mp, 'utf8'));
        if (m.frontend && m.frontend.route) officialRoutes[m.frontend.route] = n;
        if (m.backend && m.backend.mountPath) officialMounts[m.backend.mountPath] = n;
      } catch (e) {}
    });
  } catch (e) {}

  var roots = [
    path.join(root, 'market-apps'),
    path.resolve(root, '..', 'market', 'apps')
  ];
  var checkedAny = false;
  var allPass = true;
  var seenRoutes = {};
  var seenMounts = {};

  roots.forEach(function (rootsDir) {
    if (!fs.existsSync(rootsDir)) return;
    var names;
    try {
      names = fs.readdirSync(rootsDir).filter(function (n) {
        return n.indexOf('.') !== 0 && fs.existsSync(path.join(rootsDir, n, 'manifest.json')) &&
          (!onlyName || n === onlyName);
      });
    } catch (e) { return; }

    names.forEach(function (name) {
      checkedAny = true;
      console.log('---- ' + name + '  (' + rootsDir + ') ----');
      var m;
      try {
        m = JSON.parse(fs.readFileSync(path.join(rootsDir, name, 'manifest.json'), 'utf8'));
      } catch (e) {
        console.log(mark(false) + ' manifest.json 解析失败: ' + e.message);
        allPass = false;
        return;
      }

      // 1. 市场专属校验（与 server 安装时同一份）
      var mErrors = marketService.validateMarketManifest(m, name);
      if (mErrors.length) {
        mErrors.forEach(function (er) { console.log(mark(false) + ' ' + er); });
        allPass = false;
      } else {
        console.log(mark(true) + ' manifest 市场校验通过');
      }

      // 2. 通用 schema（与官方应用同一校验器）
      var base = schema.validateManifest(m);
      if (!base.valid) {
        base.errors.forEach(function (er) { console.log(mark(false) + ' [schema] ' + er); });
        allPass = false;
      }

      // 3. 文件完整性（entry/overlay/style/backend 入口必须真实存在）
      [['frontend.entry', m.frontend && m.frontend.entry],
       ['frontend.style', m.frontend && m.frontend.style],
       ['frontend.overlay', m.frontend && m.frontend.overlay],
       ['backend.entry', m.backend && m.backend.entry]].forEach(function (pair) {
        if (!pair[1]) return;
        var p = path.join(rootsDir, name, String(pair[1]).replace(/^\.\//, ''));
        var exists = fs.existsSync(p);
        console.log(mark(exists) + ' ' + pair[0] + ' → ' + pair[1]);
        if (!exists) allPass = false;
      });

      // 4. cleanup 钩子建议（有后端的应用应提供，卸载才能无痕）
      if (m.backend && !fs.existsSync(path.join(rootsDir, name, 'backend', 'cleanup.js'))) {
        console.log(mark(true, true) + ' 未提供 backend/cleanup.js（建议提供：卸载时清理自建表与数据）');
      }

      // 5. route / mountPath 冲突（官方 + 同批市场应用）
      if (m.frontend && m.frontend.route) {
        if (officialRoutes[m.frontend.route]) {
          console.log(mark(false) + ' frontend.route 与官方应用 "' + officialRoutes[m.frontend.route] + '" 冲突');
          allPass = false;
        } else if (seenRoutes[m.frontend.route] && seenRoutes[m.frontend.route] !== name) {
          console.log(mark(false) + ' frontend.route 与市场应用 "' + seenRoutes[m.frontend.route] + '" 冲突');
          allPass = false;
        } else {
          seenRoutes[m.frontend.route] = name;
        }
      }
      if (m.backend && m.backend.mountPath) {
        if (officialMounts[m.backend.mountPath]) {
          console.log(mark(false) + ' backend.mountPath 与官方应用 "' + officialMounts[m.backend.mountPath] + '" 冲突');
          allPass = false;
        } else if (seenMounts[m.backend.mountPath] && seenMounts[m.backend.mountPath] !== name) {
          console.log(mark(false) + ' backend.mountPath 与市场应用 "' + seenMounts[m.backend.mountPath] + '" 冲突');
          allPass = false;
        } else {
          seenMounts[m.backend.mountPath] = name;
        }
      }

      // 6. widget 声明提示（市场 widget 的渲染入口在 entry.js，不在 manifest）
      if (m.frontend && Array.isArray(m.frontend.widgets)) {
        m.frontend.widgets.forEach(function (w) {
          if (w && w.component) {
            console.log(mark(false) + ' widgets[' + (w.id || '?') + '].component 不适用于市场应用（渲染入口请在 entry.js 的 definition.widgets 提供）');
            allPass = false;
          }
        });
      }
    });
  });

  if (onlyName && !checkedAny) {
    console.log('[FAIL] 未找到市场应用: ' + onlyName + '（已查找 market-apps/ 与 ../market/apps/）');
    return false;
  }
  if (!checkedAny) console.log(mark(true, true) + ' 没有找到任何市场应用（market-apps/ 与 ../market/apps/ 均为空）');
  return allPass;
}

// ---------------- 动效令牌合规 lint ----------------
// 依据 docs/ecosystem-design.md §5.5.1 的「动效时长与曲线映射（唯一权威表）」：
//   transition/animation 的时长必须用 var(--duration-*) 令牌、曲线必须用 var(--ease-*) 令牌。
// 硬编码时长/曲线是历史缺陷来源（第十二轮修过两波），此 lint 把规范变成可执行约束。
// 豁免：linear（等速合法）、steps()（雪碧图帧动画的时长是帧率语义，硬编码合法）、
//       var(--motion-none, 0s) 类显式归零。
function diagMotion() {
  // 带可选 fallback 的令牌匹配：var(--duration-fast) 与 var(--duration-fast, 0.15s) 都算合规
  //（market 直出应用带 fallback 是宿主令牌未注入时的正确兜底，属最佳实践）
  var VAR_DURATION_RE = /var\(--duration-[a-z-]+(?:\s*,\s*[^)]+)?\)/g;
  var VAR_EASE_RE = /var\(--ease-[a-z-]+(?:\s*,\s*[^)]+)?\)/g;
  var EASE_KEYWORD_RE = /\b(ease-in-out|ease-in|ease-out|ease)\b/;
  var DURATION_LITERAL_RE = /(?:^|[\s,(])(\d+(?:\.\d+)?m?s)\b/;

  var roots = [
    { dir: path.join(root, 'client', 'src'), label: 'client' },
    { dir: path.join(root, 'apps'), label: 'apps' },
    { dir: path.join(root, 'market-apps'), label: 'market-apps' }
  ];
  var violations = 0;
  var fileCount = 0;

  function extractStyleBlocks(content) {
    var blocks = [];
    // .vue：<style ...>…</style>（可能多段）；.scss/.css：整文件
    var re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    var m;
    var isVue = false;
    while ((m = re.exec(content)) !== null) { blocks.push(m[1]); isVue = true; }
    if (!isVue) blocks.push(content);
    return blocks;
  }

  function checkDeclaration(line, rel) {
    var problems = [];
    // 场景豁免：行内 /* motion:scene */ 显式声明"这是刻意的场景时长/节奏"
    //（如天气背景 2s 氛围切换、投票条 0.7s 数据动画——不属于全局档位语义）
    if (line.indexOf('motion:scene') !== -1) return problems;
    var isAnimation = /\banimation\s*:/.test(line);
    // 帧动画（steps）与无限循环动画的时长是帧率/周期语义，豁免令牌要求
    var cycleExempt = /steps\(/.test(line) || /\binfinite\b/.test(line);
    var lineWithoutVars = line.replace(VAR_DURATION_RE, '').replace(VAR_EASE_RE, '');
    if (!cycleExempt) {
      var durMatch = lineWithoutVars.match(DURATION_LITERAL_RE);
      var literal = durMatch && durMatch[1];
      if (literal && literal !== '0s' && literal !== '0ms') {
        problems.push('硬编码时长 "' + literal + '"（应使用 var(--duration-*) 令牌）');
      }
    }
    if (!isAnimation) {
      // transition 曲线检查（animation 的曲线语义不同，仅查 transition；linear 等速豁免）
      if (EASE_KEYWORD_RE.test(lineWithoutVars) || /cubic-bezier\(/.test(lineWithoutVars)) {
        problems.push('硬编码缓动曲线（应使用 var(--ease-*) 令牌）');
      }
    }
    return problems;
  }

  function scanFile(abs) {
    var content;
    try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { return; }
    fileCount++;
    var rel = path.relative(root, abs);
    var blocks = extractStyleBlocks(content);
    var fileProblems = [];
    blocks.forEach(function(block) {
      var lines = block.split(/\r?\n/);
      lines.forEach(function(line) {
        if (!/\b(transition|animation)\s*:/.test(line)) return;
        // @media (prefers-reduced-motion) 块内的显式归零常为 0s —— 已由 0s 豁免覆盖
        checkDeclaration(line, rel).forEach(function(p) { fileProblems.push(p + '  ←  ' + line.trim().slice(0, 90)); });
      });
    });
    if (fileProblems.length) {
      violations += fileProblems.length;
      console.log('---- ' + rel + '（' + fileProblems.length + ' 处）----');
      fileProblems.slice(0, 5).forEach(function(p) { console.log('       ✗ ' + p); });
      if (fileProblems.length > 5) console.log('       … 其余 ' + (fileProblems.length - 5) + ' 处');
    }
  }

  function walk(dir) {
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach(function(en) {
      if (en.name.indexOf('.') === 0 || en.name === 'node_modules' || en.name === 'dist') return;
      var abs = path.join(dir, en.name);
      if (en.isDirectory()) {
        walk(abs);
        return;
      }
      if (!/\.(vue|scss|css)$/.test(en.name)) return;
      var rel = path.relative(root, abs).replace(/\\/g, '/');
      // apps/<name>/frontend/** 只扫 frontend 子树；client/src 与 market-apps 全扫
      if (rel.indexOf('apps/') === 0 && rel.split('/').length > 2 && rel.split('/')[2] !== 'frontend') return;
      scanFile(abs);
    });
  }

  roots.forEach(function(r) { walk(r.dir); });
  // 历史代码存留场景时长（97 处量级），默认警告不阻断——lint 的职责是阻止新增与渐进消化；
  // --strict 模式（CI/发布前）才视为失败
  var strict = process.argv.indexOf('--strict') !== -1;
  var ok = strict ? violations === 0 : true;
  console.log(mark(ok, !strict && violations > 0) + ' motion 动效令牌合规（' + fileCount + ' 个样式文件，' +
    violations + ' 处违规' + (strict ? '' : '，警告级——用 --strict 视为失败') + '）');
  return ok;
}

// ---------------- 入口 ----------------
var kind = process.argv[2];
var target = process.argv[3];
var results = {};

if (!kind || (kind !== 'app' && kind !== 'plugin' && kind !== 'theme' && kind !== 'compat' && kind !== 'market' && kind !== 'motion' && kind !== 'all')) {
  console.log('ClassIntra 第三方模块校验诊断');
  console.log('  node scripts/diag.js app [app-name]     应用校验（含小组件/路由冲突）');
  console.log('  node scripts/diag.js plugin [plug-name] 插件校验（backend 必有/挂载点冲突）');
  console.log('  node scripts/diag.js theme [theme-id]   主题校验（含 tokens 冒烟）');
  console.log('  node scripts/diag.js compat [app-name]  Chrome 80 兼容性 lint（apps + market-apps）');
  console.log('  node scripts/diag.js market [name]      市场应用预校验（与安装时同一校验器，装前暴露问题）');
  console.log('  node scripts/diag.js motion             动效令牌合规 lint（时长/曲线必须用 --duration-*/--ease-*）');
  console.log('  node scripts/diag.js all                全部');
  process.exit(kind ? 1 : 0);
}

console.log('== ClassIntra 第三方模块校验 ==');
if (kind === 'app' || kind === 'all') results.app = diagApp(kind === 'all' ? null : target);
if (kind === 'plugin' || kind === 'all') results.plugin = diagPlugin(kind === 'all' ? null : target);
if (kind === 'theme' || kind === 'all') results.theme = diagTheme(kind === 'all' ? null : target);
if (kind === 'compat' || kind === 'all') results.compat = diagCompat(kind === 'all' ? null : target);
if (kind === 'market' || kind === 'all') results.market = diagMarket(kind === 'all' ? null : target);
if (kind === 'motion' || kind === 'all') results.motion = diagMotion();

var failed = Object.keys(results).some(function (k) { return results[k] === false; });
console.log(failed ? '== 存在阻断性问题 ==' : '== 全部通过 ==');
process.exit(failed ? 1 : 0);
