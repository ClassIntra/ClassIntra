// 后端核心：第三方应用市场服务
// 职责：
//   1. 从市场源（GitHub 仓库 / 本地目录）拉取目录 index.json
//   2. 安装/更新/卸载第三方应用到 market-apps/（无需重启服务器）
//   3. 后端路由热挂载：单一 dispatcher 中间件在启动时注册一次，
//      安装/卸载/更新仅修改 dispatcher 内部表 → 真正的热插拔
//   4. 安装后写入 app_control 表（默认启用），重启后由 manifest-loader 持久扫描
//
// 市场源定义：
//   gitee  —— 官方市场镜像（https://gitee.com/classintra/market，走 Gitee Raw）
//   github  —— 官方市场备用源（https://github.com/ClassIntra/market，走 GitHub Raw）
//   local  —— 本地目录市场（默认 <项目根>/../market，便于私有部署与开发调试）
//
// 安全约束：
//   - 文件路径防穿越（拒绝 ..、绝对路径、盘符）
//   - 扩展名白名单 + 单文件/总数/总大小上限
//   - manifest 强校验（name 匹配、mountPath 必须以 /api/ 开头）
//   - 与官方 apps/、plugins/ 的 name/route/mountPath 冲突检测

var fs = require('fs');
var path = require('path');
var axios = require('axios');
var manifestLoader = require('./manifest-loader');
var validateManifest = require('./manifest-schema').validateManifest;
var rateLimitLib = require('../middleware/rate-limit').createRateLimiter;

var rootDir = path.resolve(__dirname, '../../../');
var marketAppsDir = manifestLoader.marketAppsDir;

// ========== 安装限制 ==========
var MAX_FILES = 300;                  // 单应用最大文件数
var MAX_FILE_BYTES = 15 * 1024 * 1024; // 单文件上限 15MB
var MAX_TOTAL_BYTES = 80 * 1024 * 1024; // 单应用总大小上限 80MB
var ALLOWED_EXTS = ['.json', '.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.txt', '.md', '.html'];
var CATALOG_CACHE_MS = 60000; // 目录缓存 60s

// ========== 市场源 ==========
var DEFAULT_SOURCES = [
  {
    id: 'gitee',
    label: '官方市场（Gitee）',
    type: 'http',
    base: 'https://gitee.com/classintra/market/raw/main/'
  },
  {
    id: 'github',
    label: '官方市场（GitHub）',
    type: 'http',
    base: 'https://raw.githubusercontent.com/ClassIntra/market/main/'
  },
  {
    id: 'local',
    label: '本地市场',
    type: 'local',
    base: process.env.MARKET_LOCAL_DIR || path.join(rootDir, '..', 'market')
  }
];

function getSource(sourceId) {
  for (var i = 0; i < DEFAULT_SOURCES.length; i++) {
    if (DEFAULT_SOURCES[i].id === sourceId) return DEFAULT_SOURCES[i];
  }
  return null;
}

function getSourceFallbacks(sourceId) {
  var preferred = getSource(sourceId);
  if (!preferred) return [];

  var fallbackIds = preferred.id === 'gitee'
    ? ['github', 'local']
    : preferred.id === 'github'
      ? ['gitee', 'local']
      : [];

  return [preferred].concat(fallbackIds.map(function(id) {
    return getSource(id);
  }).filter(function(source) {
    return source;
  }));
}

// ========== 热挂载调度器 ==========
// mounts: { mountPath: { appName, router, layers: [middleware...] } }
// dispatcher 在 app.js 启动时 app.use 一次（位于官方应用路由之后、catch-all 之前），
// 之后安装/卸载/更新只改 mounts 表，无需再次 app.use → 支持真正的运行时插拔
var _mounts = {};
var _removedMountPaths = {};

function _clearRequireCache(appDir) {
  Object.keys(require.cache).forEach(function(k) {
    if (k.indexOf(appDir + path.sep) === 0) {
      delete require.cache[k];
    }
  });
}

// 加载（或重载）一个市场应用的后端 router
function _loadRouter(manifest) {
  var entryPath = manifestLoader.getAppEntryPath(manifest.name, manifest.backend.entry, marketAppsDir);
  if (!fs.existsSync(entryPath)) return null;
  var appDir = path.join(marketAppsDir, manifest.name);
  _clearRequireCache(appDir);
  var moduleLib = require('module');
  var dependencyPath = path.join(rootDir, 'server', 'node_modules');
  var nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(function(item) {
    return item;
  });
  if (nodePaths.indexOf(dependencyPath) === -1) nodePaths.push(dependencyPath);
  process.env.NODE_PATH = nodePaths.join(path.delimiter);
  moduleLib.Module._initPaths();
  return require(entryPath);
}

// 设置挂载（安装/更新共用）：热替换 router
function _setMount(manifest) {
  if (!manifest.backend || !manifest.backend.mountPath || !manifest.backend.entry) return false;
  var router = _loadRouter(manifest);
  if (!router) {
    console.error('[market] 后端入口不存在:', manifest.name, manifest.backend.entry);
    return false;
  }
  var layers = [];
  if (manifest.backend.rateLimit) {
    var opts = manifest.backend.rateLimit;
    var rlOpts = { max: opts.max, windowMs: opts.windowMs };
    if (opts.message) rlOpts.message = opts.message;
    layers.push(rateLimitLib(rlOpts));
  }
  layers.push(router);
  _mounts[manifest.backend.mountPath] = {
    appName: manifest.name,
    layers: layers
  };
  delete _removedMountPaths[manifest.backend.mountPath];
  console.log('[market] 热挂载后端路由:', manifest.name, '->', manifest.backend.mountPath);
  return true;
}

// 卸载挂载
function _removeMount(manifest) {
  if (manifest.backend && manifest.backend.mountPath && _mounts[manifest.backend.mountPath]) {
    delete _mounts[manifest.backend.mountPath];
    _removedMountPaths[manifest.backend.mountPath] = true;
    console.log('[market] 卸载后端路由:', manifest.name, '->', manifest.backend.mountPath);
  }
}

// 调度器中间件：按最长前缀匹配分发给对应市场应用
function isAppEnabled(appName) {
  try {
    var db = require('../utils/db');
    var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(appName);
    return !row || !!row.enabled;
  } catch (e) {
    return true;
  }
}

function dispatcher() {
  return function(req, res, next) {
    var keys = Object.keys(_mounts);
    var matched = null;
    for (var i = 0; i < keys.length; i++) {
      var mp = keys[i];
      if (req.path === mp || req.path.indexOf(mp + '/') === 0) {
        if (!matched || mp.length > matched.length) matched = mp;
      }
    }
    if (!matched) {
      var removedPaths = Object.keys(_removedMountPaths);
      for (var r = 0; r < removedPaths.length; r++) {
        if (req.path === removedPaths[r] || req.path.indexOf(removedPaths[r] + '/') === 0) {
          return res.status(404).json({ code: 404, message: '应用不存在' });
        }
      }
      return next();
    }
    var mount = _mounts[matched];
    if (!isAppEnabled(mount.appName)) {
      return res.status(404).json({ code: 404, message: '应用未启用' });
    }
    var originalUrl = req.url;
    var originalBaseUrl = req.baseUrl;
    var relativeUrl = req.url.substring(matched.length);
    if (!relativeUrl || relativeUrl.charAt(0) !== '/') relativeUrl = '/' + relativeUrl;
    req.url = relativeUrl;
    req.baseUrl = (originalBaseUrl || '') + matched;
    var restored = false;

    function restoreRequest() {
      if (restored) return;
      restored = true;
      req.url = originalUrl;
      req.baseUrl = originalBaseUrl;
    }

    var idx = 0;
    function run(err) {
      if (err) {
        restoreRequest();
        return next(err);
      }
      if (idx >= mount.layers.length) {
        restoreRequest();
        return next();
      }
      var layer = mount.layers[idx++];
      layer(req, res, run);
    }
    run();
  };
}

// 启动时初始化：挂载所有已安装市场应用的后端
function init() {
  if (!fs.existsSync(marketAppsDir)) return;
  var manifests = _scanInstalledRaw();
  var count = 0;
  manifests.forEach(function(m) {
    if (m.backend && _setMount(m)) count++;
  });
  if (count > 0) console.log('[market] 启动挂载 ' + count + ' 个第三方应用后端路由');
}

// ========== 已安装应用扫描 ==========
// 直接扫描目录（不走 manifest-loader 缓存，保证安装/卸载后立即可见）
function _scanInstalledRaw() {
  var list = [];
  if (!fs.existsSync(marketAppsDir)) return list;
  var entries = fs.readdirSync(marketAppsDir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    if (entries[i].name.indexOf('.') === 0) continue; // 跳过 .tmp-* 临时目录
    var manifestPath = path.join(marketAppsDir, entries[i].name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      var raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      var result = validateManifest(raw);
      if (!result.valid) {
        console.warn('[market] 已安装应用 manifest 验证失败:', raw.name, result.errors.join('; '));
        continue;
      }
      result.manifest._sourceDir = marketAppsDir;
      result.manifest._sourceType = 'market';
      list.push(result.manifest);
    } catch (e) {
      console.error('[market] 读取 manifest 失败:', entries[i].name, e.message);
    }
  }
  list.sort(function(a, b) { return (a.order || 99) - (b.order || 99); });
  return list;
}

// 对外：已安装列表（含图标 URL / 安装时间）
function listInstalled() {
  return _scanInstalledRaw().map(function(m) {
    var stat = null;
    try { stat = fs.statSync(path.join(marketAppsDir, m.name, 'manifest.json')); } catch (e) {}
    var icon = m.icon || '';
    if (icon.indexOf('./') === 0) icon = '/market-static/' + m.name + '/' + icon.replace(/^\.\//, '');
    return {
      name: m.name,
      label: m.label,
      version: m.version || '0.0.0',
      description: m.description || '',
      author: m.author || '',
      icon: icon,
      color: m.color || '',
      category: m.category || 'desktop',
      route: m.frontend && m.frontend.route ? m.frontend.route : '',
      frontendEntry: m.frontend && m.frontend.entry ? m.frontend.entry : '',
      frontendStyle: m.frontend && m.frontend.style ? m.frontend.style : '',
      hasBackend: !!(m.backend && m.backend.mountPath),
      enabled: isAppEnabled(m.name),
      source: 'market',
      installedAt: stat ? stat.mtimeMs : 0
    };
  });
}

// ========== 市场目录 ==========
var _catalogCache = {}; // sourceId → { at, data }

function _fetchFile(source, relPath, binary) {
  if (source.type === 'http') {
    return axios.get(source.base + relPath, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_FILE_BYTES,
      validateStatus: function(s) { return s >= 200 && s < 300; }
    }).then(function(res) { return Buffer.from(res.data); });
  }
  // local
  return new Promise(function(resolve, reject) {
    var full = _safeJoin(source.base, relPath);
    if (!full) return reject(new Error('非法路径: ' + relPath));
    fs.readFile(full, function(err, data) {
      if (err) reject(new Error('读取文件失败: ' + relPath));
      else resolve(data);
    });
  });
}

function _validateCatalog(data) {
  if (!data || !Array.isArray(data.apps)) throw new Error('市场目录格式错误：缺少 apps 数组');
  var apps = [];
  for (var i = 0; i < data.apps.length; i++) {
    var a = data.apps[i];
    if (!a || !a.name || !a.label || !Array.isArray(a.files) || a.files.length === 0) {
      console.warn('[market] 目录条目不完整，已跳过:', a && a.name);
      continue;
    }
    apps.push(a);
  }
  return { version: data.version || 1, updated_at: data.updated_at || '', apps: apps };
}

function getCatalog(sourceId) {
  var source = getSource(sourceId);
  if (!source) return Promise.reject(new Error('未知市场源: ' + sourceId));
  var cached = _catalogCache[sourceId];
  if (cached && Date.now() - cached.at < CATALOG_CACHE_MS) {
    return Promise.resolve(cached.data);
  }
  return _fetchFile(source, 'index.json').then(function(buf) {
    var data = _validateCatalog(JSON.parse(buf.toString('utf8')));
    _catalogCache[sourceId] = { at: Date.now(), data: data };
    return data;
  }).catch(function(e) {
    throw new Error('获取市场目录失败: ' + (e.message || e));
  });
}

function getCatalogWithFallback(sourceId) {
  var sources = getSourceFallbacks(sourceId);
  if (!sources.length) return Promise.reject(new Error('未知市场源: ' + sourceId));

  function attempt(index, errors) {
    var source = sources[index];
    return getCatalog(source.id).then(function(catalog) {
      return { source: source, catalog: catalog };
    }).catch(function(error) {
      errors.push(source.id + ': ' + error.message);
      if (index + 1 >= sources.length) {
        throw new Error('所有市场源均不可用：' + errors.join('；'));
      }
      return attempt(index + 1, errors);
    });
  }

  return attempt(0, []);
}

function clearCatalogCache(sourceId) {
  if (sourceId) delete _catalogCache[sourceId];
  else _catalogCache = {};
}

// ========== 安全校验 ==========
function _safeJoin(baseDir, relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  var normalized = path.normalize(relPath).replace(/\\/g, '/');
  if (normalized.indexOf('..') !== -1 || normalized.indexOf(':') !== -1) return null;
  if (normalized.indexOf('/') === 0) return null; // 绝对路径
  var full = path.resolve(baseDir, normalized);
  if (full.indexOf(path.resolve(baseDir) + path.sep) !== 0) return null;
  return full;
}

// 校验下载的 manifest（市场应用扩展校验）
function _validateMarketManifest(m, expectedName) {
  var errors = [];
  if (!m || typeof m !== 'object') return ['manifest 非对象'];
  if (m.name !== expectedName) errors.push('manifest.name (' + m.name + ') 与请求的应用名 (' + expectedName + ') 不一致');
  if (!m.label) errors.push('缺少 label');
  if (!m.frontend || !m.frontend.route || m.frontend.route.indexOf('/') !== 0) errors.push('frontend.route 缺失或非法（必须以 / 开头）');
  if (!m.frontend || !m.frontend.entry || typeof m.frontend.entry !== 'string') errors.push('frontend.entry 缺失（第三方应用前端入口，如 ./frontend/entry.js）');
  if (m.backend) {
    if (!m.backend.mountPath || m.backend.mountPath.indexOf('/api/') !== 0) errors.push('backend.mountPath 缺失或非法（必须以 /api/ 开头）');
    if (!m.backend.entry || typeof m.backend.entry !== 'string') errors.push('backend.entry 缺失');
  }
  return errors;
}

// 与官方 apps/、plugins/ 及其他已安装市场应用冲突检测
function _detectConflicts(manifest) {
  var errors = [];
  var official = manifestLoader.loadManifests().filter(function(m) { return m._sourceType !== 'market'; });
  var installedOthers = _scanInstalledRaw().filter(function(m) { return m.name !== manifest.name; });
  var all = official.concat(installedOthers);
  all.forEach(function(m) {
    if (m.name === manifest.name) errors.push('应用名 ' + manifest.name + ' 与官方/已安装应用冲突');
    if (m.frontend && manifest.frontend && m.frontend.route === manifest.frontend.route) {
      errors.push('前端路由 ' + manifest.frontend.route + ' 已被应用 ' + m.name + ' 占用');
    }
    if (m.backend && manifest.backend && m.backend.mountPath === manifest.backend.mountPath) {
      errors.push('后端挂载路径 ' + manifest.backend.mountPath + ' 已被应用 ' + m.name + ' 占用');
    }
  });
  return errors;
}

// ========== 安装 / 更新 ==========
// installApp: 下载 → 校验 → 原子写入 → app_control 注册 → 热挂载
function installAppFromSource(appName, sourceId) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(appName || '')) throw new Error('应用名非法（kebab-case）');
    var source = getSource(sourceId) || getSource('gitee');
    return getCatalog(source.id).then(function(catalog) {
      var entry = null;
      for (var i = 0; i < catalog.apps.length; i++) {
        if (catalog.apps[i].name === appName) { entry = catalog.apps[i]; break; }
      }
      if (!entry) throw new Error('市场目录中不存在应用: ' + appName);
      if (entry.files.length > MAX_FILES) throw new Error('文件数超过上限 ' + MAX_FILES);

      var prefix = 'apps/' + appName + '/';
      var total = 0;
      var downloads = [];
      // 逐个下载（保持顺序，避免并发过大）
      function next(idx) {
        if (idx >= entry.files.length) return Promise.resolve(downloads);
        var rel = entry.files[idx];
        if (typeof rel !== 'string' || rel.indexOf(prefix) !== 0) {
          return Promise.reject(new Error('文件路径必须在 ' + prefix + ' 下: ' + rel));
        }
        var ext = path.extname(rel).toLowerCase();
        if (ALLOWED_EXTS.indexOf(ext) === -1) {
          return Promise.reject(new Error('不支持的文件类型: ' + rel));
        }
        return _fetchFile(source, rel).then(function(buf) {
          if (buf.length > MAX_FILE_BYTES) throw new Error('文件过大: ' + rel);
          total += buf.length;
          if (total > MAX_TOTAL_BYTES) throw new Error('应用总大小超过上限');
          downloads.push({ rel: rel, buf: buf });
          return next(idx + 1);
        });
      }
      return next(0).then(function() {
        return { entry: entry, downloads: downloads, source: source };
      });
    });
  }).then(function(ctx) {
    // 从下载内容中提取并校验 manifest
    var manifestBuf = null;
    for (var i = 0; i < ctx.downloads.length; i++) {
      if (ctx.downloads[i].rel === prefix0(appName) + 'manifest.json') { manifestBuf = ctx.downloads[i].buf; break; }
    }
    if (!manifestBuf) throw new Error('包内缺少 manifest.json');
    var manifest;
    try { manifest = JSON.parse(manifestBuf.toString('utf8')); }
    catch (e) { throw new Error('manifest.json 解析失败'); }
    var errs = _validateMarketManifest(manifest, appName);
    if (errs.length) throw new Error(errs.join('; '));
    var result = validateManifest(manifest);
    if (!result.valid) throw new Error('manifest 基础校验失败: ' + result.errors.join('; '));
    ctx.manifest = result.manifest;
    // 冲突检测（安装前）
    var conflicts = _detectConflicts(ctx.manifest);
    if (conflicts.length) throw new Error(conflicts.join('; '));
    return ctx;
  }).then(function(ctx) {
    // 原子写入：先写临时目录，成功后替换
    if (!fs.existsSync(marketAppsDir)) fs.mkdirSync(marketAppsDir, { recursive: true });
    var tmpDir = path.join(marketAppsDir, '.tmp-' + appName + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      for (var i = 0; i < ctx.downloads.length; i++) {
        var d = ctx.downloads[i];
        var inner = d.rel.replace(/^apps\/[^/]+\//, ''); // apps/gomoku/x → x
        if (!inner || inner.indexOf('/') === 0) throw new Error('非法包内路径: ' + d.rel);
        var dest = _safeJoin(tmpDir, inner);
        if (!dest) throw new Error('非法包内路径: ' + d.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, d.buf);
      }
      // 替换旧目录（更新场景）
      var finalDir = path.join(marketAppsDir, appName);
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
      fs.renameSync(tmpDir, finalDir);
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      throw new Error('写入文件失败: ' + e.message);
    }
    return ctx;
  }).then(function(ctx) {
    // app_control 注册（保留原启用状态；未注册过则默认启用）
    try {
      var db = require('../utils/db');
      db.prepare('INSERT OR IGNORE INTO app_control (app_name, enabled) VALUES (?, 1)').run(ctx.manifest.name);
    } catch (e) {
      console.warn('[market] app_control 注册失败（表可能未初始化）:', e.message);
    }
    // 热挂载后端
    if (ctx.manifest.backend) {
      var mounted = _setMount(ctx.manifest);
      if (!mounted) console.warn('[market] 后端挂载失败（应用仍安装，重启后自动重试）');
    }
    // 刷新 manifest-loader 缓存（管理后台/默认应用列表立即感知）
    manifestLoader.clearCache();
    console.log('[market] 应用已安装:', ctx.manifest.name, 'v' + (ctx.manifest.version || '0.0.0'));
    return {
      name: ctx.manifest.name,
      label: ctx.manifest.label,
      version: ctx.manifest.version || '0.0.0',
      source: ctx.source.id
    };
  });
}

function installApp(appName, sourceId) {
  var sources = getSourceFallbacks(sourceId || 'gitee');
  if (!sources.length) return Promise.reject(new Error('未知市场源: ' + sourceId));

  function attempt(index, errors) {
    return installAppFromSource(appName, sources[index].id).catch(function(error) {
      errors.push(sources[index].id + ': ' + error.message);
      if (index + 1 >= sources.length) {
        throw new Error('所有市场源均不可用：' + errors.join('；'));
      }
      return attempt(index + 1, errors);
    });
  }

  return attempt(0, []);
}

function prefix0(appName) { return 'apps/' + appName + '/'; }

// ========== 卸载 ==========
function uninstallApp(appName) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(appName || '')) throw new Error('应用名非法');
    var manifestPath = path.join(marketAppsDir, appName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('应用未安装: ' + appName);
    var manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
    // 1. 卸载热挂载
    _removeMount(manifest);
    // 2. 移除 app_control 记录
    try {
      var db = require('../utils/db');
      db.prepare('DELETE FROM app_control WHERE app_name = ?').run(appName);
    } catch (e) {
      console.warn('[market] app_control 清理失败:', e.message);
    }
    // 3. 删除目录
    var finalDir = path.join(marketAppsDir, appName);
    fs.rmSync(finalDir, { recursive: true, force: true });
    // 4. 清缓存
    manifestLoader.clearCache();
    console.log('[market] 应用已卸载:', appName);
    return { name: appName };
  });
}

// 更新 = 重新安装最新版（保留启用状态）
function updateApp(appName, sourceId) {
  return installApp(appName, sourceId || 'gitee');
}

// 获取已安装应用的 manifest（供路由/API 使用）
function getInstalledManifest(appName) {
  var list = _scanInstalledRaw();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === appName) return list[i];
  }
  return null;
}

module.exports = {
  init: init,
  dispatcher: dispatcher,
  listInstalled: listInstalled,
  getCatalog: getCatalog,
  getCatalogWithFallback: getCatalogWithFallback,
  clearCatalogCache: clearCatalogCache,
  installApp: installApp,
  uninstallApp: uninstallApp,
  updateApp: updateApp,
  getInstalledManifest: getInstalledManifest,
  getSources: function() {
    return DEFAULT_SOURCES.map(function(s) { return { id: s.id, label: s.label, type: s.type }; });
  },
  marketAppsDir: marketAppsDir
};
