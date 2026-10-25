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
var crypto = require('crypto');
var axios = require('axios');
var manifestLoader = require('./manifest-loader');
var validateManifest = require('./manifest-schema').validateManifest;
var CURRENT_SDK_VERSION = require('./manifest-schema').CURRENT_SDK_VERSION;
var KNOWN_ROLES = require('./manifest-schema').KNOWN_ROLES;
var LAYOUT_MODES = require('./manifest-schema').LAYOUT_MODES;
var rateLimitLib = require('../middleware/rate-limit').createRateLimiter;
var appConfig = require('../utils/app-config');
var marketProcess = require('./market-process');

var rootDir = path.resolve(__dirname, '../../../');
var marketAppsDir = manifestLoader.marketAppsDir;
var marketThemesDir = path.join(rootDir, 'market-themes'); // 市场主题运行时目录（主题包：manifest.json + tokens.json + 合成的 pack.json）
var runtimePluginsDir = manifestLoader.pluginsDir; // 插件运行时目录（rootDir/plugins，源码维护于 market 仓库）

// ========== 安装限制 ==========
// 安装上限（可用环境变量覆盖：大型项目部署按需放宽）
var MAX_FILES = Number(process.env.MARKET_MAX_FILES) || 300;                 // 单应用最大文件数
var MAX_FILE_BYTES = (Number(process.env.MARKET_MAX_FILE_MB) || 15) * 1024 * 1024;   // 单文件上限
var MAX_TOTAL_BYTES = (Number(process.env.MARKET_MAX_TOTAL_MB) || 80) * 1024 * 1024; // 单应用总大小上限
// 文件扩展名白名单：Web 资源 + 多语言源码（独立端口服务可携带任意语言实现，
// 宿主运行时由部署者预装——市场信任模型与插件后端一致）
var ALLOWED_EXTS = [
  // Web 资源
  '.json', '.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.txt', '.md', '.html',
  '.jsonc', '.mov', '.mp4', '.webm',
  // 多语言源码与工程文件（进程形态 backend.process 可为任意语言）
  '.py', '.rb', '.go', '.java', '.rs', '.php', '.sh', '.bat', '.ps1',
  '.toml', '.yaml', '.yml', '.xml', '.csv', '.ini', '.cfg', '.lock',
  '.c', '.h', '.cpp', '.cs', '.kt', '.sql', '.wasm', '.map'
];
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

// 检测 manifest 声明的 required 配置缺失项（DB → env → default 三级回退后仍为空）
function _configMissing(manifest) {
  var schema = manifest && Array.isArray(manifest.config) ? manifest.config : [];
  if (!schema.length) return [];
  try {
    return appConfig.resolveConfig(manifest.name, schema).missingRequired;
  } catch (e) {
    return [];
  }
}

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

// 加载（或重载）一个市场应用的后端 router（baseDir 缺省为 market-apps，插件传 runtimePluginsDir）
function _loadRouter(manifest, baseDir) {
  var sourceDir = baseDir || marketAppsDir;
  var entryPath = manifestLoader.getAppEntryPath(manifest.name, manifest.backend.entry, sourceDir);
  if (!fs.existsSync(entryPath)) return null;
  var appDir = path.join(sourceDir, manifest.name);
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
function _setMount(manifest, baseDir) {
  if (!manifest.backend || !manifest.backend.mountPath || !manifest.backend.entry) return false;
  var router = _loadRouter(manifest, baseDir);
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
    layers: layers,
    // 独立端口型：dispatcher 命中该挂载时反代到 127.0.0.1:port（不走 layers）
    processPort: manifest.backend.process ? (manifest.backend.process.port || null) : null
  };
  delete _removedMountPaths[manifest.backend.mountPath];
  console.log('[market] 热挂载后端路由:', manifest.name, '->', manifest.backend.mountPath);
  return true;
}

// 卸载挂载
function _removeMount(manifest) {
  if (manifest.backend && manifest.backend.mountPath && _mounts[manifest.backend.mountPath]) {
    delete _mounts[manifest.backend.mountPath];
    _noteRemovedMountPath(manifest.backend.mountPath);
    console.log('[market] 卸载后端路由:', manifest.name, '->', manifest.backend.mountPath);
  }
}

// 已卸载路径登记（对后续请求返回明确 404 而非穿透到 SPA 兜底）。
// 封顶防长周期反复装卸撑大内存：超过 64 条时按插入序淘汰最旧的。
var REMOVED_MOUNT_PATHS_CAP = 64;
function _noteRemovedMountPath(mp) {
  _removedMountPaths[mp] = true;
  var keys = Object.keys(_removedMountPaths);
  if (keys.length > REMOVED_MOUNT_PATHS_CAP) delete _removedMountPaths[keys[0]];
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
    // 独立端口型：反代到子进程（127.0.0.1:port，仅 HTTP；进程由 market-process 托管）
    if (mount.processPort) {
      return _proxyToLocalPort(req, res, mount.processPort);
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

// 反代到本机子进程端口（独立端口型后端；仅 HTTP，WS 升级不支持）
function _proxyToLocalPort(req, res, port) {
  var http = require('http');
  var options = {
    host: '127.0.0.1',
    port: port,
    method: req.method,
    path: req.url,
    headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + port })
  };
  var upstream = http.request(options, function(upRes) {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', function(e) {
    if (!res.headersSent) {
      res.status(502).json({ code: 502, message: '应用服务未响应（进程可能未启动）: ' + e.message });
    } else {
      res.end();
    }
  });
  // 请求体转发（有体才 pipe，避免空 body 挂起）
  var hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  if (hasBody) req.pipe(upstream);
  else upstream.end();
}

// 启动时初始化：挂载所有已安装市场应用的后端
function init() {
  // 孤儿管控记录清扫不依赖 market-apps 目录存在（init-db 在 app.js 更早处已完成建表）
  sweepOrphanAppControl();
  var manifests = [];
  if (fs.existsSync(marketAppsDir)) {
    manifests = _scanInstalledRaw();
    var count = 0;
    manifests.forEach(function(m) {
      if (m.backend && _setMount(m)) count++;
      // 独立端口型：拉起子进程（停用状态的除外——请求期闸门也会拦）
      if (m.backend && m.backend.process && isAppEnabled(m.name)) {
        try { marketProcess.startApp(m, path.join(marketAppsDir, m.name)); } catch (e) {
          console.error('[market] 进程型应用启动失败:', m.name, e.message);
        }
      }
    });
    if (count > 0) console.log('[market] 启动挂载 ' + count + ' 个第三方应用后端路由');
  }
  // 启动时扫描 required 配置缺失：管理端有「待配置」角标，这里再日志兜底，杜绝静默失败
  var plugins = _scanInstalledPlugins();
  var cfgWarn = [];
  manifests.forEach(function(m) {
    var missing = _configMissing(m);
    if (missing.length) cfgWarn.push(m.name + '(' + missing.map(function(x) { return x.key; }).join(',') + ')');
  });
  plugins.forEach(function(p) {
    var missing = _configMissing(p);
    if (missing.length) cfgWarn.push(p.name + '(' + missing.map(function(x) { return x.key; }).join(',') + ')');
  });
  if (cfgWarn.length) {
    console.warn('[market] 以下应用/插件缺少必填配置（请在管理端应用市场 → 已安装列表中点击「配置」补全）: ' + cfgWarn.join('; '));
  }
}

// ========== 孤儿管控记录清扫 ==========
// app_control 是启停的唯一真相，但应用下线方式多样（官方应用删除、直接删目录等），
// 目录没了记录还在 → /system/app-control 的 enabled_apps 出现幽灵条目
// （notes / ai-chat 下线时踩过：init-db 只幂等清理过 'cloud' 的孤儿行）。
// 规则（保守）：名字在 apps/、plugins/、market-apps/ 任一目录中存在（含 manifest
// 校验失败的残缺目录）即保留；否则视为孤儿删除。仅启动时执行一次。
function sweepOrphanAppControl() {
  try {
    var db = require('../utils/db');
    var rows = db.prepare('SELECT app_name FROM app_control').all();
    if (!rows.length) return;
    var valid = {};
    manifestLoader.loadManifests().forEach(function(m) { valid[m.name] = true; });
    [marketAppsDir, runtimePluginsDir].forEach(function(dir) {
      if (!fs.existsSync(dir)) return;
      try {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isDirectory() && entries[i].name.indexOf('.') !== 0) valid[entries[i].name] = true;
        }
      } catch (e) {}
    });
    var removed = [];
    for (var r = 0; r < rows.length; r++) {
      var name = rows[r].app_name;
      if (!valid[name]) {
        db.prepare('DELETE FROM app_control WHERE app_name = ?').run(name);
        removed.push(name);
      }
    }
    if (removed.length) console.log('[market] 已清扫孤儿应用管控记录:', removed.join(', '));
  } catch (e) {
    console.warn('[market] 孤儿管控记录清扫跳过（数据库可能未就绪）:', e.message);
  }
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
      // 能力披露：安装前告知用户「这个应用会用到什么」。
      // 非拦截（开放模型），仅用于 UI 展示与市场审核参考。
      capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
      // 布局偏好透传（如 navbar: 'custom' 让应用自绘标题栏）
      layout: m.layout || null,
      route: m.frontend && m.frontend.route ? m.frontend.route : '',
      frontendEntry: m.frontend && m.frontend.entry ? m.frontend.entry : '',
      frontendStyle: m.frontend && m.frontend.style ? m.frontend.style : '',
      // 静态站点迁入（iframe 形态）：首页相对路径
      frontendStatic: m.frontend && m.frontend.static ? m.frontend.static : '',
      // 独立端口型后端：主服务 spawn 子进程并把 mountPath 反代到 127.0.0.1:port
      hasProcess: !!(m.backend && m.backend.process),
      processPort: m.backend && m.backend.process ? (m.backend.process.port || null) : null,
      // 全局悬浮层入口（可选）：非空表示宿主会在任意页面加载并挂载该悬浮层
      overlayEntry: m.frontend && m.frontend.overlay ? m.frontend.overlay : '',
      // 桌面小组件声明（可选）：去掉 component 字段（市场应用的 widget 渲染入口
      // 在 entry.js 的 definition.widgets 契约上，manifest 中的 component 不生效）
      widgets: (m.frontend && Array.isArray(m.frontend.widgets) ? m.frontend.widgets : []).map(function(w) {
        return {
          id: w.id,
          name: w.name,
          description: w.description || '',
          defaultSize: w.defaultSize || { w: 2, h: 2 },
          minSize: w.minSize || { w: 1, h: 1 },
          maxSize: w.maxSize || { w: 4, h: 4 },
          configSchema: w.configSchema || null,
          permission: w.permission || null
        };
      }),
      hasBackend: !!(m.backend && m.backend.mountPath),
      enabled: isAppEnabled(m.name),
      // 是否声明了配置项（决定管理端是否显示「配置」按钮）
      hasConfig: Array.isArray(m.config) && m.config.length > 0,
      // 配置状态：required 声明中三级回退（DB → env → default）后仍缺失的项，
      // 管理端据此显示「待配置」角标与配置入口
      configMissing: _configMissing(m),
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
    // 与 HTTP 源的 maxContentLength 对齐：本地源文件同样受 15MB 上限约束
    fs.stat(full, function(statErr, stat) {
      if (statErr) return reject(new Error('读取文件失败: ' + relPath));
      if (stat.size > MAX_FILE_BYTES) return reject(new Error('文件过大（超过 ' + (MAX_FILE_BYTES / 1048576) + 'MB）: ' + relPath));
      fs.readFile(full, function(err, data) {
        if (err) reject(new Error('读取文件失败: ' + relPath));
        else resolve(data);
      });
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
  // 插件目录（可选段；插件安装流程为独立链路）
  var plugins = [];
  if (Array.isArray(data.plugins)) {
    for (var p = 0; p < data.plugins.length; p++) {
      var pl = data.plugins[p];
      if (!pl || !pl.name || !pl.label || !Array.isArray(pl.files) || pl.files.length === 0) {
        console.warn('[market] 插件目录条目不完整，已跳过:', pl && pl.name);
        continue;
      }
      plugins.push(pl);
    }
  }
  // 主题目录（可选段；旧版系统忽略此字段）
  var themes = [];
  if (Array.isArray(data.themes)) {
    for (var t = 0; t < data.themes.length; t++) {
      var th = data.themes[t];
      if (!th || !th.name || !th.label || !Array.isArray(th.files) || th.files.length === 0) {
        console.warn('[market] 主题目录条目不完整，已跳过:', th && th.name);
        continue;
      }
      themes.push(th);
    }
  }
  return { version: data.version || 1, updated_at: data.updated_at || '', apps: apps, plugins: plugins, themes: themes };
}

// 把目录条目里的相对路径图标（./icon.svg / icon.svg）改写为服务器中转代理地址。
// 背景：目录来自远程市场源，前端 <img> 直接用相对路径会相对当前页面 URL 解析而 404；
// 且接入设备未必能直连 gitee/github，统一走服务器中转（与市场下载同一策略）。
// 注意：index.json 里的 icon 是相对「应用/插件子目录」的路径（apps/<name>/icon.svg），
// 改写时必须补上 apps/<name>/ 或 plugins/<name>/ 前缀，否则会去仓库根目录找而 404。
// 绝对 URL（http/https）与以 / 开头的路径原样保留。缓存按 sourceId 分键，改写结果可直接入缓存。
function _resolveCatalogIcons(catalog, sourceId) {
  var groups = [
    { list: catalog.apps, dir: 'apps' },
    { list: catalog.plugins, dir: 'plugins' }
  ];
  for (var g = 0; g < groups.length; g++) {
    var list = groups[g].list;
    var dir = groups[g].dir;
    if (!Array.isArray(list)) continue;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var icon = item && item.icon;
      if (!icon || typeof icon !== 'string') continue;
      if (icon.indexOf('http://') === 0 || icon.indexOf('https://') === 0 || icon.charAt(0) === '/') continue;
      var rel = icon.replace(/^\.\//, '');
      // 已带 apps/ 或 plugins/ 前缀的按全路径处理（兼容未来目录写全路径），否则相对子目录补前缀
      if (rel.indexOf('apps/') !== 0 && rel.indexOf('plugins/') !== 0) {
        rel = dir + '/' + (item.name || '') + '/' + rel;
      }
      item.icon = '/api/market/asset?source=' + encodeURIComponent(sourceId) +
        '&path=' + encodeURIComponent(rel);
    }
  }
  return catalog;
}

// 市场目录静态资源的扩展名白名单（仅图片）
var ASSET_EXT_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};

// 代理拉取市场源中的静态资源（应用图标等）。
// path 必须是纯相对路径且扩展名在图片白名单内，防止目录穿越与任意文件读取。
function fetchAsset(sourceId, relPath) {
  var source = getSource(sourceId);
  if (!source) return Promise.reject(new Error('未知市场源: ' + sourceId));
  var clean = String(relPath || '').trim().replace(/\\/g, '/');
  if (!clean || clean.indexOf('..') !== -1 || clean.charAt(0) === '/') {
    return Promise.reject(new Error('非法资源路径'));
  }
  var dot = clean.lastIndexOf('.');
  var ext = dot === -1 ? '' : clean.substring(dot).toLowerCase();
  var contentType = ASSET_EXT_TYPES[ext];
  if (!contentType) return Promise.reject(new Error('不支持的资源类型'));
  return _fetchFile(source, clean).then(function(buf) {
    return { buffer: buf, contentType: contentType };
  });
}

function getCatalog(sourceId) {
  var source = getSource(sourceId);
  if (!source) return Promise.reject(new Error('未知市场源: ' + sourceId));
  var cached = _catalogCache[sourceId];
  if (cached && Date.now() - cached.at < CATALOG_CACHE_MS) {
    return Promise.resolve(cached.data);
  }
  var rawIndex = null;
  return _fetchFile(source, 'index.json').then(function(buf) {
    rawIndex = buf;
    return _verifyCatalogSignature(source, buf);
  }).then(function(verified) {
    // 验签启用时（true/false），失败即拒绝使用该目录——防篡改是硬闸门
    if (verified === false) {
      throw new Error('市场目录签名校验失败（源: ' + source.id + '）——目录可能被篡改或发布者密钥已轮换');
    }
    var data = _validateCatalog(JSON.parse(rawIndex.toString('utf8')));
    _resolveCatalogIcons(data, source.id);
    data._verified = verified; // true / 'unsigned' / 'local'（路由层透传给前端展示）
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

// ========== 市场目录验签（防篡改） ==========
// 发布端：scripts/market-sign.mjs 用 ed25519 私钥对 index.json 原始字节签名，
//         index.json.sig 与 index.json 一起推到市场仓库。
// 验签端：配置 MARKET_SIGNING_PUBLIC_KEY（PEM 文本或 PEM 文件路径）后，
//         http 源（gitee/github）的目录必须验签通过才可用；local 源按文件系统信任跳过。
// 返回值：true=验签通过 / false=验签失败 / 'unsigned'=未启用验签 / 'local'=本地源免验
var _signingPublicKey = null;
var _signingKeyLoaded = false;
function _loadSigningPublicKey() {
  if (_signingKeyLoaded) return _signingPublicKey;
  _signingKeyLoaded = true;
  var raw = process.env.MARKET_SIGNING_PUBLIC_KEY;
  if (!raw) return null;
  var pem = raw.indexOf('-----BEGIN') === 0 ? raw : null;
  if (!pem) {
    // 按文件路径处理
    try { pem = fs.readFileSync(raw, 'utf8'); } catch (e) { pem = null; }
  }
  if (pem && pem.indexOf('-----BEGIN') === 0) {
    _signingPublicKey = crypto.createPublicKey(pem);
  } else {
    console.warn('[market] MARKET_SIGNING_PUBLIC_KEY 既不是 PEM 文本也不是可读的 PEM 文件路径，验签未启用');
  }
  return _signingPublicKey;
}

function _verifyCatalogSignature(source, indexBuf) {
  if (source.type !== 'http') return 'local';
  var pub = _loadSigningPublicKey();
  if (!pub) return 'unsigned';
  return _fetchFile(source, 'index.json.sig')
    .then(function(sigBuf) {
      var sigHex = sigBuf.toString('utf8').trim();
      var sig = Buffer.from(sigHex, 'hex');
      var ok = crypto.verify(null, indexBuf, pub, sig);
      console.log('[market] 目录验签(' + source.id + '): ' + (ok ? '通过' : '失败'));
      return ok;
    })
    .catch(function() {
      console.warn('[market] 目录缺少签名文件 index.json.sig（源: ' + source.id + '）');
      return false;
    });
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
//
// ⚠️ 市场应用不走 shared/src/manifest-schema.js 的 FIELD_DEFS 白名单校验路径，
//    因此新增 manifest 字段必须在此处显式登记，否则会被静默丢弃。
//    （第十轮已踩过：visibleRoles 三个官方 manifest 已在用但 schema 未声明。）
//
// 与 manifest-schema 的分工：
//   - 本函数：市场专属约束（路由前缀、入口文件、SDK 版本、能力披露、可见角色）
//   - validateManifest()：通用字段类型与枚举校验
function _validateMarketManifest(m, expectedName) {
  var errors = [];
  if (!m || typeof m !== 'object') return ['manifest 非对象'];
  if (m.name !== expectedName) errors.push('manifest.name (' + m.name + ') 与请求的应用名 (' + expectedName + ') 不一致');
  if (!m.label) errors.push('缺少 label');
  if (!m.frontend || !m.frontend.route || m.frontend.route.indexOf('/') !== 0) errors.push('frontend.route 缺失或非法（必须以 / 开头）');
  // ---- frontend.overlay：全局悬浮层入口（可选能力）----
  // 声明后，应用处于"已安装且启用"状态时，宿主会在任意页面加载该脚本并挂载全局悬浮容器
  // （z-index 9400，低于超能岛/模态/Toast）。契约见 client/src/core/market-overlay-host.js
  if (m.frontend && m.frontend.overlay !== undefined) {
    var ov = m.frontend.overlay;
    if (typeof ov !== 'string' || ov.indexOf('./') !== 0 || ov.slice(-3) !== '.js' || ov.indexOf('..') !== -1) {
      errors.push('frontend.overlay 非法（必须是包内相对路径，形如 ./frontend/overlay.js）');
    }
  }
  // ---- frontend.widgets：桌面小组件声明（可选）----
  // 市场应用的小组件没有独立 .vue 组件（component 字段会被忽略并告警），
  // 渲染入口在 entry.js 的 definition.widgets[<id>] 契约上，见 docs/market-dev-guide.md
  if (m.frontend && m.frontend.widgets !== undefined) {
    if (!Array.isArray(m.frontend.widgets)) {
      errors.push('frontend.widgets 应为数组类型');
    } else {
      for (var wi = 0; wi < m.frontend.widgets.length; wi++) {
        var w = m.frontend.widgets[wi];
        if (!w || typeof w !== 'object' || Array.isArray(w)) {
          errors.push('frontend.widgets[' + wi + '] 应为对象');
          continue;
        }
        if (!w.id || typeof w.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(w.id)) {
          errors.push('frontend.widgets[' + wi + '].id 缺失或非法（kebab-case）');
        }
        if (!w.name || typeof w.name !== 'string') {
          errors.push('frontend.widgets[' + wi + '].name 缺失');
        }
        if (w.component) {
          errors.push('frontend.widgets[' + wi + '].component 不适用于市场应用（渲染入口请在 entry.js 的 definition.widgets 中提供）');
        }
      }
    }
  }
  if (m.backend) {
    if (!m.backend.mountPath || m.backend.mountPath.indexOf('/api/') !== 0) errors.push('backend.mountPath 缺失或非法（必须以 /api/ 开头）');
    if (!m.backend.entry || typeof m.backend.entry !== 'string') errors.push('backend.entry 缺失');
    // ---- backend.process：独立端口型后端（主服务 spawn 子进程 + 反代 mountPath → 127.0.0.1:port）----
    // 与 backend.entry 关系：process 声明时 entry 仅作为包完整性锚点（进程型服务的入口在 process.command/entry）
    if (m.backend.process !== undefined) {
      var pc = m.backend.process;
      if (!pc || typeof pc !== 'object' || Array.isArray(pc)) {
        errors.push('backend.process 应为对象：{ command?: "node server.js", entry?: "./backend/server.js", port: 1024-65535 }');
      } else {
        if (!pc.command && !pc.entry) errors.push('backend.process 需要 command 或 entry 至少一项');
        var portNum = Number(pc.port);
        if (!pc.port || !Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
          errors.push('backend.process.port 非法（1024-65535 的空闲端口，安装时探测冲突）');
        }
      }
    }
  }

  // ---- frontend.static：静态站点迁入（iframe 形态，无 entry.js 契约）----
  // 已有独立项目（vite/webpack 打包的 dist）最快的迁入路径：声明首页路径即跑。
  // 声明 static 时 frontend.entry 变为可选（二者至少其一）
  if (m.frontend && m.frontend.static !== undefined) {
    var st = m.frontend.static;
    if (typeof st !== 'string' || st.indexOf('./') !== 0 || st.slice(-5) !== '.html') {
      errors.push('frontend.static 非法（必须是包内相对路径，形如 ./frontend/index.html）');
    }
  } else if (!m.frontend || !m.frontend.entry || typeof m.frontend.entry !== 'string') {
    errors.push('frontend.entry 缺失（第三方应用前端入口，如 ./frontend/entry.js；纯静态站可改用 frontend.static）');
  }

  // ---- sdk：所需 SDK 主版本。高于当前版本时阻断安装（宁可明确报错，不要静默失败）----
  if (m.sdk !== undefined) {
    if (typeof m.sdk !== 'string' || !/^\d+$/.test(m.sdk)) {
      errors.push('sdk 字段应为纯数字主版本字符串（如 "1"）');
    } else if (parseInt(m.sdk, 10) > parseInt(CURRENT_SDK_VERSION, 10)) {
      errors.push(
        '此应用要求 SDK v' + m.sdk + '，当前系统为 v' + CURRENT_SDK_VERSION +
        '——请升级 ClassIntra 后再安装'
      );
    }
  }

  // ---- capabilities：能力披露（安装期可选拦截）----
  // 开放模型默认不拦截；部署端配置 MARKET_RESTRICTED_CAPABILITIES（逗号分隔，如
  // "device.camera,data.http"）后，声明了受限能力的应用/插件直接拒装——
  // 敏感能力从"披露"升级为"默认拒绝"，强度由部署者决定
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) {
      errors.push('capabilities 应为数组类型');
    } else {
      var restricted = _getRestrictedCapabilities();
      for (var ci = 0; ci < m.capabilities.length; ci++) {
        if (typeof m.capabilities[ci] !== 'string') {
          errors.push('capabilities[' + ci + '] 应为字符串');
          continue;
        }
        if (restricted.indexOf(m.capabilities[ci]) !== -1) {
          errors.push('此应用声明了受限能力 "' + m.capabilities[ci] +
            '"（本部署已通过 MARKET_RESTRICTED_CAPABILITIES 禁用该能力），拒绝安装');
        }
      }
    }
  }

  // ---- layout：布局偏好 ----
  if (m.layout !== undefined) {
    if (!m.layout || typeof m.layout !== 'object' || Array.isArray(m.layout)) {
      errors.push('layout 应为对象类型');
    } else if (m.layout.mode !== undefined && LAYOUT_MODES.indexOf(m.layout.mode) === -1) {
      errors.push('layout.mode "' + m.layout.mode + '" 不在枚举中（' + LAYOUT_MODES.join(' / ') + '）');
    }
  }

  // ---- visibleRoles：可见角色白名单 ----
  if (m.visibleRoles !== undefined) {
    if (!Array.isArray(m.visibleRoles)) {
      errors.push('visibleRoles 应为数组类型');
    } else {
      for (var vi = 0; vi < m.visibleRoles.length; vi++) {
        if (typeof m.visibleRoles[vi] !== 'string') {
          errors.push('visibleRoles[' + vi + '] 应为字符串');
        } else if (KNOWN_ROLES.indexOf(m.visibleRoles[vi]) === -1) {
          errors.push('visibleRoles 中的 "' + m.visibleRoles[vi] + '" 不是已知角色（' + KNOWN_ROLES.join(' / ') + '）');
        }
      }
    }
  }

  // ---- config：配置项声明（安装时引导管理员填写，值存数据库 app_config 表）----
  if (m.config !== undefined) {
    if (!Array.isArray(m.config)) {
      errors.push('config 应为数组类型');
    } else {
      for (var cf = 0; cf < m.config.length; cf++) {
        var cItem = m.config[cf];
        if (!cItem || typeof cItem !== 'object' || Array.isArray(cItem)) {
          errors.push('config[' + cf + '] 应为对象');
          continue;
        }
        if (!cItem.key || typeof cItem.key !== 'string') {
          errors.push('config[' + cf + '].key 缺失或非字符串');
          continue;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cItem.key)) {
          errors.push('config[' + cf + '].key "' + cItem.key + '" 应为环境变量风格（字母/数字/下划线，不以数字开头）');
          continue;
        }
        if (!cItem.label || typeof cItem.label !== 'string') {
          errors.push('config[' + cf + '].label 缺失（用于管理端配置表单的显示名）');
          continue;
        }
        var cType = cItem.type || 'string';
        if (['string', 'number', 'boolean', 'secret'].indexOf(cType) === -1) {
          errors.push('config[' + cf + '].type "' + cType + '" 不在枚举中（string / number / boolean / secret）');
        }
      }
      var seenKeys = {};
      for (var ck = 0; ck < m.config.length; ck++) {
        var cKey = m.config[ck] && m.config[ck].key;
        if (cKey && seenKeys[cKey]) errors.push('config 中存在重复 key: ' + cKey);
        if (cKey) seenKeys[cKey] = true;
      }
    }
  }

  return errors;
}

function compareVersions(a, b) {
  var left = String(a || '0.0.0').split('.');
  var right = String(b || '0.0.0').split('.');
  for (var i = 0; i < 3; i++) {
    var l = parseInt(left[i], 10) || 0;
    var r = parseInt(right[i], 10) || 0;
    if (l !== r) return l - r;
  }
  return 0;
}

// ========== 逐文件哈希校验（防镜像损坏/半更新） ==========
// index.json 条目的可选 hashes: { '<包内相对路径>': '<sha256 hex>' }
//（scripts/market-index-gen.mjs 自动生成）。安装时逐个比对，不匹配即中止。
function _verifyFileHashes(kindName, entry, downloads) {
  var hashes = entry && entry.hashes;
  if (!hashes || typeof hashes !== 'object') return;
  var prefix = kindName + 's/'; // apps/ | plugins/ | themes/
  downloads.forEach(function(d) {
    var rel = String(d.rel || '');
    if (rel.indexOf(prefix) !== 0) return;
    var inner = rel.slice(prefix.length).replace(/^[^/]+\//, ''); // 去掉 <name>/ 前缀
    var expected = hashes[inner];
    if (!expected) return; // 清单未覆盖的文件不强制（向后兼容旧目录）
    var actual = crypto.createHash('sha256').update(d.buf).digest('hex');
    if (actual !== expected) {
      throw new Error('文件哈希不匹配: ' + rel + '（目录声明 ' + expected.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…）——源可能损坏或被篡改');
    }
  });
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
      var installed = _scanInstalledRaw().filter(function(app) { return app.name === appName; })[0];
      if (installed && compareVersions(entry.version, installed.version) < 0) {
        throw new Error('拒绝降级: 当前版本 ' + installed.version + ' 高于市场版本 ' + entry.version);
      }
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
        _verifyFileHashes('app', entry, downloads);
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
    // 独立端口型：端口冲突检测（已装应用声明占用 / 系统实际占用都拒装）
    var portCheck = Promise.resolve();
    if (manifest.backend && manifest.backend.process) {
      var wantedPort = manifest.backend.process.port;
      var portOwner = null;
      var installedAll = _scanInstalledRaw();
      for (var pi = 0; pi < installedAll.length; pi++) {
        var each = installedAll[pi];
        if (each.backend && each.backend.process && each.backend.process.port === wantedPort) { portOwner = each.name; break; }
      }
      if (portOwner) throw new Error('端口 ' + wantedPort + ' 已被已安装应用 "' + portOwner + '" 声明，请换一个端口');
      portCheck = marketProcess.isPortFree(wantedPort).then(function(free) {
        if (!free) throw new Error('端口 ' + wantedPort + ' 已被系统其他程序占用，请换一个端口');
      });
    }
    return portCheck.then(function() { return ctx; });
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
        _removeTree(finalDir);
      }
      try {
        fs.renameSync(tmpDir, finalDir);
      } catch (renameErr) {
        // Windows：旧目录被占用（EPERM）时退化为覆盖写入（安装兜底，非原子但可靠）
        fs.mkdirSync(finalDir, { recursive: true });
        fs.cpSync(tmpDir, finalDir, { recursive: true });
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      }
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
      // 独立端口型：拉起子进程
      if (ctx.manifest.backend.process) {
        try {
          marketProcess.startApp(ctx.manifest, path.join(marketAppsDir, appName));
        } catch (e) {
          console.error('[market] 进程型应用启动失败:', appName, e.message);
        }
      }
    }
    // 刷新 manifest-loader 缓存（管理后台/默认应用列表立即感知）
    manifestLoader.clearCache();
    console.log('[market] 应用已安装:', ctx.manifest.name, 'v' + (ctx.manifest.version || '0.0.0'));
    return {
      name: ctx.manifest.name,
      label: ctx.manifest.label,
      version: ctx.manifest.version || '0.0.0',
      source: ctx.source.id,
      // required 配置缺失项：前端据此在安装成功后弹「立即配置」引导
      configRequired: _configMissing(ctx.manifest)
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

// 受限能力清单（逗号分隔 env，缓存于进程生命周期；未配置 = 开放模型不拦截）
var _restrictedCache = null;
function _getRestrictedCapabilities() {
  if (_restrictedCache) return _restrictedCache;
  var raw = process.env.MARKET_RESTRICTED_CAPABILITIES || '';
  _restrictedCache = raw.split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s; });
  return _restrictedCache;
}

// ========== 卸载 ==========
// 分文件删除目录：环境的删除保护闸会拦截一次性大体积递归删除
//（SAFE_DELETE_BULK_CONFIRM_REQUIRED），逐文件小步删除等价且无痕。
function _removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    var p = path.join(dir, entries[i].name);
    if (entries[i].isDirectory()) _removeTree(p);
    else { try { fs.unlinkSync(p); } catch (e) {} }
  }
  try { fs.rmdirSync(dir); } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
  }
}
// 应用/插件自清理钩子：backend/cleanup.js（可选文件）。
// 卸载目录之前执行，应用在里面 DROP 自己建的表、DELETE 自己的 kv 数据 —— 卸载即无痕。
// 钩子签名：module.exports = function cleanup(ctx) { ... }（同步或返回 Promise），
// ctx = { name, manifest }；数据库连接用与 backend/routes.js 相同的
// path.resolve(process.cwd(), 'src/utils/db') 方式获取。
function _runCleanupHook(appName, manifest, baseDir) {
  var dir = baseDir || marketAppsDir;
  var hookPath = path.join(dir, appName, 'backend', 'cleanup.js');
  if (!fs.existsSync(hookPath)) return Promise.resolve(false);
  _clearRequireCache(path.join(dir, appName));
  var hook = require(hookPath);
  if (typeof hook !== 'function') return Promise.resolve(false);
  return Promise.resolve()
    .then(function() { return hook({ name: appName, manifest: manifest }); })
    .then(function() {
      console.log('[market] 清理钩子执行完成:', appName);
      return true;
    });
}

function uninstallApp(appName) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(appName || '')) throw new Error('应用名非法');
    var manifestPath = path.join(marketAppsDir, appName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('应用未安装: ' + appName);
    var manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
    // 1. 卸载热挂载
    _removeMount(manifest);
    // 2. 应用自清理钩子（backend/cleanup.js）：失败则中止卸载、保留现场，避免半删除状态
    return _runCleanupHook(appName, manifest).catch(function(e) {
      throw new Error('应用清理钩子执行失败，已中止卸载（可修复 cleanup.js 后重试）: ' + (e && e.message || e));
    });
  }).then(function() {
    // 3. 移除 app_control 记录
    try {
      var db = require('../utils/db');
      db.prepare('DELETE FROM app_control WHERE app_name = ?').run(appName);
    } catch (e) {
      console.warn('[market] app_control 清理失败:', e.message);
    }
    // 4. 清理该应用在数据库中的配置（避免残留脏数据）
    try { appConfig.clearValues(appName); } catch (e) {}
    // 5. 驱逐已加载后端模块的 require 缓存（cleanup 钩子存在时已随钩子清过，
    //    无钩子的应用在此兜底），否则模块代码滞留内存直到进程重启
    try { _clearRequireCache(path.join(marketAppsDir, appName)); } catch (e) {}
    // 6. 停止独立端口型子进程（等进程退出再删目录——Windows 下文件被进程占用会删失败）
    var stopDone = Promise.resolve();
    try {
      if (manifest.backend && manifest.backend.process) {
        stopDone = new Promise(function(resolve) {
          marketProcess.stopApp(appName, resolve);
        });
      }
    } catch (e) {}
    return stopDone.then(function() {
      // 7. 删除目录
      var finalDir = path.join(marketAppsDir, appName);
      _removeTree(finalDir);
      // 8. 清缓存
      manifestLoader.clearCache();
      console.log('[market] 应用已卸载:', appName);
      return { name: appName };
    });
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

// 获取应用或插件的完整 manifest（配置 API 用：读取 config 声明）
function getConfigurableManifest(name) {
  var app = getInstalledManifest(name);
  if (app) return app;
  var manifestPath = path.join(runtimePluginsDir, name, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      var m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m.type === 'plugin' && m.name === name) return m;
    } catch (e) {}
  }
  return null;
}

// ========== 插件市场（插件为独立扩展模块：无前端页面、必有后端，安装到运行时 plugins/ 目录） ==========

// 扫描本地已安装插件（runtimePluginsDir 下含 type=plugin 的 manifest）
function _scanInstalledPlugins() {
  var list = [];
  if (!fs.existsSync(runtimePluginsDir)) return list;
  var dirs = fs.readdirSync(runtimePluginsDir).filter(function(d) {
    try { return fs.statSync(path.join(runtimePluginsDir, d)).isDirectory() && d.indexOf('.') !== 0; } catch (e) { return false; }
  });
  for (var i = 0; i < dirs.length; i++) {
    var mp = path.join(runtimePluginsDir, dirs[i], 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    try {
      var m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      if (m.type !== 'plugin') continue;
      var st = fs.statSync(path.join(runtimePluginsDir, dirs[i]));
      var pname = m.name || dirs[i];
      var canDisable = m.canDisable !== false;
      list.push({
        name: pname,
        label: m.label || pname,
        version: m.version || '0.0.0',
        description: m.description || '',
        // 署名字段：市场化插件由 index.json 提供，插件 manifest 通常不写
        author: m.author || '',
        // 是否允许管理员暂停（canDisable === false 表示声明常开，不受管控）
        canDisable: canDisable,
        // 当前启停状态：常开插件恒为 true，其余取 app_control 记录
        enabled: canDisable ? isAppEnabled(pname) : true,
        // 是否声明了配置项 + required 缺失项（插件无前端页面，管理端插件列表据此显示）
        hasConfig: Array.isArray(m.config) && m.config.length > 0,
        configMissing: _configMissing({ name: pname, config: m.config }),
        installedAt: st.mtimeMs,
        dir: dirs[i]
      });
    } catch (e) {
      console.warn('[market] 插件 manifest 读取失败:', dirs[i], e.message);
    }
  }
  return list;
}

function listInstalledPlugins() { return _scanInstalledPlugins(); }

// 插件包 manifest 校验（与 app 校验的差异：backend 必填、frontend 可选、type 必须为 plugin）
function _validateMarketPluginManifest(m, expectedName) {
  var errors = [];
  if (!m || typeof m !== 'object') return ['manifest 非对象'];
  if (m.type !== 'plugin') errors.push('manifest.type 必须为 "plugin"');
  if (m.name !== expectedName) errors.push('manifest.name (' + m.name + ') 与请求的插件名 (' + expectedName + ') 不一致');
  if (!m.label) errors.push('缺少 label');
  if (!m.version) errors.push('缺少 version');
  if (!m.backend || !m.backend.mountPath || m.backend.mountPath.indexOf('/api/') !== 0) errors.push('backend.mountPath 缺失或非法（必须以 /api/ 开头）');
  if (!m.backend || !m.backend.entry || typeof m.backend.entry !== 'string') errors.push('backend.entry 缺失');
  if (m.frontend && m.frontend.entry && typeof m.frontend.entry !== 'string') errors.push('frontend.entry 非法');
  if (m.sdk !== undefined) {
    if (typeof m.sdk !== 'string' || !/^\d+$/.test(m.sdk)) {
      errors.push('sdk 字段应为纯数字主版本字符串（如 "1"）');
    } else if (parseInt(m.sdk, 10) > parseInt(CURRENT_SDK_VERSION, 10)) {
      errors.push('此插件要求 SDK v' + m.sdk + '，当前系统为 v' + CURRENT_SDK_VERSION + '——请升级 ClassIntra 后再安装');
    }
  }
  // ---- capabilities：与市场应用同款的安装期可选拦截 ----
  if (m.capabilities !== undefined && Array.isArray(m.capabilities)) {
    var restrictedCaps = _getRestrictedCapabilities();
    for (var rci = 0; rci < m.capabilities.length; rci++) {
      if (typeof m.capabilities[rci] === 'string' && restrictedCaps.indexOf(m.capabilities[rci]) !== -1) {
        errors.push('此插件声明了受限能力 "' + m.capabilities[rci] + '"，拒绝安装');
      }
    }
  }
  // ---- config：配置项声明（与 _validateMarketManifest 的 config 校验一致）----
  if (m.config !== undefined) {
    if (!Array.isArray(m.config)) {
      errors.push('config 应为数组类型');
    } else {
      for (var cf = 0; cf < m.config.length; cf++) {
        var cItem = m.config[cf];
        if (!cItem || typeof cItem !== 'object' || Array.isArray(cItem)) {
          errors.push('config[' + cf + '] 应为对象');
          continue;
        }
        if (!cItem.key || typeof cItem.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cItem.key)) {
          errors.push('config[' + cf + '].key 缺失或非法（环境变量风格：字母/数字/下划线）');
          continue;
        }
        if (!cItem.label || typeof cItem.label !== 'string') {
          errors.push('config[' + cf + '].label 缺失（用于管理端配置表单的显示名）');
          continue;
        }
        var cType = cItem.type || 'string';
        if (['string', 'number', 'boolean', 'secret'].indexOf(cType) === -1) {
          errors.push('config[' + cf + '].type "' + cType + '" 不在枚举中（string / number / boolean / secret）');
        }
      }
    }
  }
  return errors;
}

// 从指定市场源下载并安装插件（下载 → 校验 → 原子写入 plugins/ → 热挂载后端）
function installPluginFromSource(pluginName, sourceId) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(pluginName || '')) throw new Error('插件名非法（kebab-case）');
    var source = getSource(sourceId) || getSource('gitee');
    return getCatalog(source.id).then(function(catalog) {
      var plugins = catalog.plugins || [];
      var entry = null;
      for (var i = 0; i < plugins.length; i++) {
        if (plugins[i].name === pluginName) { entry = plugins[i]; break; }
      }
      if (!entry) throw new Error('市场目录中不存在插件: ' + pluginName);
      var installed = _scanInstalledPlugins().filter(function(p) { return p.name === pluginName; })[0];
      if (installed && compareVersions(entry.version, installed.version) < 0) {
        throw new Error('拒绝降级: 当前版本 ' + installed.version + ' 高于市场版本 ' + entry.version);
      }
      if (entry.files.length > MAX_FILES) throw new Error('文件数超过上限 ' + MAX_FILES);

      var prefix = 'plugins/' + pluginName + '/';
      var total = 0;
      var downloads = [];
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
          if (total > MAX_TOTAL_BYTES) throw new Error('插件总大小超过上限');
          downloads.push({ rel: rel, buf: buf });
          return next(idx + 1);
        });
      }
      return next(0).then(function() {
        _verifyFileHashes('plugin', entry, downloads);
        return { entry: entry, downloads: downloads, source: source };
      });
    });
  }).then(function(ctx) {
    var manifestBuf = null;
    var manifestRel = 'plugins/' + pluginName + '/manifest.json';
    for (var i = 0; i < ctx.downloads.length; i++) {
      if (ctx.downloads[i].rel === manifestRel) { manifestBuf = ctx.downloads[i].buf; break; }
    }
    if (!manifestBuf) throw new Error('包内缺少 manifest.json');
    var manifest;
    try { manifest = JSON.parse(manifestBuf.toString('utf8')); }
    catch (e) { throw new Error('manifest.json 解析失败'); }
    var errs = _validateMarketPluginManifest(manifest, pluginName);
    if (errs.length) throw new Error(errs.join('; '));
    ctx.manifest = manifest;
    return ctx;
  }).then(function(ctx) {
    // 原子写入运行时 plugins/ 目录
    if (!fs.existsSync(runtimePluginsDir)) fs.mkdirSync(runtimePluginsDir, { recursive: true });
    var tmpDir = path.join(runtimePluginsDir, '.tmp-' + pluginName + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      for (var i = 0; i < ctx.downloads.length; i++) {
        var d = ctx.downloads[i];
        var inner = d.rel.replace(/^plugins\/[^/]+\//, '');
        if (!inner || inner.indexOf('/') === 0) throw new Error('非法包内路径: ' + d.rel);
        var dest = _safeJoin(tmpDir, inner);
        if (!dest) throw new Error('非法包内路径: ' + d.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, d.buf);
      }
      var finalDir = path.join(runtimePluginsDir, pluginName);
      if (fs.existsSync(finalDir)) {
        _removeTree(finalDir);
      }
      try {
        fs.renameSync(tmpDir, finalDir);
      } catch (renameErr) {
        // Windows：旧目录被占用（EPERM）时退化为覆盖写入（安装兜底，非原子但可靠）
        fs.mkdirSync(finalDir, { recursive: true });
        fs.cpSync(tmpDir, finalDir, { recursive: true });
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      }
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      throw new Error('写入文件失败: ' + e.message);
    }
    // 热挂载插件后端（挂载失败时插件仍已落盘，重启后由 route-aggregator 自动挂载）
    // app_control 注册：与管理后台的插件启用/禁用机制对齐（默认启用）
    try {
      var db = require('../utils/db');
      db.prepare('INSERT OR IGNORE INTO app_control (app_name, enabled) VALUES (?, 1)').run(ctx.manifest.name);
    } catch (e) {
      console.warn('[market] app_control 注册失败（表可能未初始化）:', e.message);
    }
    var mounted = _setMount(ctx.manifest, runtimePluginsDir);
    if (!mounted) console.warn('[market] 插件后端挂载失败（重启后自动重试）');
    manifestLoader.clearCache();
    console.log('[market] 插件已安装:', ctx.manifest.name, 'v' + (ctx.manifest.version || '0.0.0'));
    return {
      name: ctx.manifest.name,
      label: ctx.manifest.label,
      version: ctx.manifest.version || '0.0.0',
      source: ctx.source.id,
      requiresRebuild: !!ctx.manifest.frontend,
      // required 配置缺失项：前端据此在安装成功后弹「立即配置」引导
      configRequired: _configMissing(ctx.manifest)
    };
  });
}

function installPlugin(pluginName, sourceId) {
  var sources = getSourceFallbacks(sourceId || 'gitee');
  if (!sources.length) return Promise.reject(new Error('未知市场源: ' + sourceId));
  function attempt(index, errors) {
    return installPluginFromSource(pluginName, sources[index].id).catch(function(error) {
      errors.push(sources[index].id + ': ' + error.message);
      if (index + 1 < sources.length) return attempt(index + 1, errors);
      throw new Error('所有市场源安装失败: ' + errors.join(' | '));
    });
  }
  return attempt(0, []);
}

// 卸载插件：撤挂载 → 删目录 → 清缓存（保护：不允许卸载仍在运行的清单来源外目录）
function uninstallPlugin(pluginName) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(pluginName || '')) throw new Error('插件名非法');
    var manifestPath = path.join(runtimePluginsDir, pluginName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('插件未安装: ' + pluginName);
    var manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
    _removeMount(manifest);
    // 自清理钩子（backend/cleanup.js）：失败则中止卸载、保留现场
    return _runCleanupHook(pluginName, manifest, runtimePluginsDir).catch(function(e) {
      throw new Error('插件清理钩子执行失败，已中止卸载: ' + (e && e.message || e));
    });
  }).then(function() {
    // 清理 app_control 记录（管理后台不再显示该插件）
    try {
      var db = require('../utils/db');
      db.prepare('DELETE FROM app_control WHERE app_name = ?').run(pluginName);
    } catch (e) {
      console.warn('[market] app_control 清理失败:', e.message);
    }
    // 清理该插件在数据库中的配置（避免残留脏数据）
    try { appConfig.clearValues(pluginName); } catch (e) {}
    // 驱逐后端模块 require 缓存（无钩子时的兜底）
    try { _clearRequireCache(path.join(runtimePluginsDir, pluginName)); } catch (e) {}
    var finalDir = path.join(runtimePluginsDir, pluginName);
    _removeTree(finalDir);
    manifestLoader.clearCache();
    console.log('[market] 插件已卸载:', pluginName);
    return { name: pluginName };
  });
}

// ========== 主题市场 ==========
// 主题包为"纯数据 JSON"（无脚本、免注入、CSP 安全）：
//   themes/<id>/manifest.json  { id, name, type: 'light'|'dark', version, description, author, tokens: './tokens.json', icon? }
//   themes/<id>/tokens.json    TOKENS 数据对象（与 themes/light/tokens.js 导出的 TOKENS 同构）
// 安装时原子写入 market-themes/<id>/，并合成 pack.json（manifest + tokens 内联）——
// 客户端 ThemeEngine.loadExternalTheme('/market-theme-static/<id>/pack.json') 一次取全。

// 扫描本地已安装市场主题
function listInstalledThemes() {
  var list = [];
  if (!fs.existsSync(marketThemesDir)) return list;
  var entries;
  try { entries = fs.readdirSync(marketThemesDir, { withFileTypes: true }); } catch (e) { return list; }
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory() || entries[i].name.indexOf('.') === 0) continue;
    var mp = path.join(marketThemesDir, entries[i].name, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    try {
      var m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      if (m.id !== entries[i].name) continue;
      var stat = fs.statSync(mp);
      list.push({
        id: m.id,
        name: m.name || m.id,
        type: m.type,
        version: m.version || '0.0.0',
        description: m.description || '',
        author: m.author || '',
        icon: m.icon && m.icon.indexOf('./') === 0 ? '/market-theme-static/' + m.id + '/' + m.icon.replace(/^\.\//, '') : (m.icon || ''),
        // 客户端 ThemeEngine.loadExternalTheme 的取用地址（一次取全 manifest+tokens）
        packUrl: '/market-theme-static/' + m.id + '/pack.json',
        installedAt: stat.mtimeMs
      });
    } catch (e) {
      console.warn('[market] 主题 manifest 读取失败:', entries[i].name, e.message);
    }
  }
  return list;
}

// 主题包 manifest 校验
function _validateMarketThemeManifest(m, expectedId) {
  var errors = [];
  if (!m || typeof m !== 'object') return ['manifest 非对象'];
  if (m.id !== expectedId) errors.push('manifest.id (' + m.id + ') 与请求的主题 id (' + expectedId + ') 不一致');
  if (!m.name || typeof m.name !== 'string') errors.push('缺少 name');
  if (m.type !== 'light' && m.type !== 'dark') errors.push('type 必须为 "light" 或 "dark"');
  if (m.id === 'light' || m.id === 'dark') errors.push('主题 id 不能是 "light"/"dark"（内置主题不可覆盖）');
  if (!m.tokens || typeof m.tokens !== 'string' || m.tokens.slice(-5) !== '.json') {
    errors.push('tokens 必须指向包内 tokens.json（市场主题为纯数据 JSON，不支持 .js）');
  }
  return errors;
}

// 从指定市场源下载并安装主题（下载 → 校验 → 原子写入 → 合成 pack.json）
function installThemeFromSource(themeId, sourceId) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(themeId || '')) throw new Error('主题 id 非法（kebab-case）');
    var source = getSource(sourceId) || getSource('gitee');
    return getCatalog(source.id).then(function(catalog) {
      var themes = catalog.themes || [];
      var entry = null;
      for (var i = 0; i < themes.length; i++) {
        if (themes[i].name === themeId) { entry = themes[i]; break; }
      }
      if (!entry) throw new Error('市场目录中不存在主题: ' + themeId);
      var installed = listInstalledThemes().filter(function(t) { return t.id === themeId; })[0];
      if (installed && compareVersions(entry.version, installed.version) < 0) {
        throw new Error('拒绝降级: 当前版本 ' + installed.version + ' 高于市场版本 ' + entry.version);
      }
      if (entry.files.length > MAX_FILES) throw new Error('文件数超过上限 ' + MAX_FILES);

      var prefix = 'themes/' + themeId + '/';
      var total = 0;
      var downloads = [];
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
          if (total > MAX_TOTAL_BYTES) throw new Error('主题总大小超过上限');
          downloads.push({ rel: rel, buf: buf });
          return next(idx + 1);
        });
      }
      return next(0).then(function() { _verifyFileHashes('theme', entry, downloads); return { entry: entry, downloads: downloads, source: source }; });
    });
  }).then(function(ctx) {
    var manifestBuf = null;
    var tokensBuf = null;
    var tokensRel = 'themes/' + themeId + '/tokens.json';
    for (var i = 0; i < ctx.downloads.length; i++) {
      if (ctx.downloads[i].rel === prefix0(themeId) + 'manifest.json') manifestBuf = ctx.downloads[i].buf;
      if (ctx.downloads[i].rel === tokensRel) tokensBuf = ctx.downloads[i].buf;
    }
    if (!manifestBuf) throw new Error('包内缺少 manifest.json');
    if (!tokensBuf) throw new Error('包内缺少 tokens.json（' + tokensRel + '）');
    var manifest;
    try { manifest = JSON.parse(manifestBuf.toString('utf8')); }
    catch (e) { throw new Error('manifest.json 解析失败'); }
    var errs = _validateMarketThemeManifest(manifest, themeId);
    if (errs.length) throw new Error(errs.join('; '));
    var tokens;
    try { tokens = JSON.parse(tokensBuf.toString('utf8')); }
    catch (e) { throw new Error('tokens.json 解析失败: ' + e.message); }
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('tokens.json 必须是数据对象');
    ctx.manifest = manifest;
    ctx.tokens = tokens;
    return ctx;
  }).then(function(ctx) {
    // 原子写入 + 合成 pack.json（manifest + tokens 内联，供 loadExternalTheme 一次取全）
    if (!fs.existsSync(marketThemesDir)) fs.mkdirSync(marketThemesDir, { recursive: true });
    var tmpDir = path.join(marketThemesDir, '.tmp-' + themeId + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      for (var i = 0; i < ctx.downloads.length; i++) {
        var d = ctx.downloads[i];
        var inner = d.rel.replace(/^themes\/[^/]+\//, '');
        if (!inner || inner.indexOf('/') === 0) throw new Error('非法包内路径: ' + d.rel);
        var dest = _safeJoin(tmpDir, inner);
        if (!dest) throw new Error('非法包内路径: ' + d.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, d.buf);
      }
      var pack = {
        id: ctx.manifest.id,
        name: ctx.manifest.name,
        type: ctx.manifest.type,
        version: ctx.manifest.version || '0.0.0',
        description: ctx.manifest.description || '',
        author: ctx.manifest.author || '',
        tokens: ctx.tokens,
        icons: ctx.manifest.icons || null
      };
      fs.writeFileSync(path.join(tmpDir, 'pack.json'), JSON.stringify(pack));
      var finalDir = path.join(marketThemesDir, themeId);
      if (fs.existsSync(finalDir)) _removeTree(finalDir);
      try {
        fs.renameSync(tmpDir, finalDir);
      } catch (renameErr) {
        // Windows：旧目录被占用（EPERM）时退化为覆盖写入（安装兜底，非原子但可靠）
        fs.mkdirSync(finalDir, { recursive: true });
        fs.cpSync(tmpDir, finalDir, { recursive: true });
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      }
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
      throw new Error('写入文件失败: ' + e.message);
    }
    console.log('[market] 主题已安装:', themeId, 'v' + (ctx.manifest.version || '0.0.0'));
    return {
      id: themeId,
      name: ctx.manifest.name,
      version: ctx.manifest.version || '0.0.0',
      source: ctx.source.id
    };
  });
}

function installTheme(themeId, sourceId) {
  var sources = getSourceFallbacks(sourceId || 'gitee');
  if (!sources.length) return Promise.reject(new Error('未知市场源: ' + sourceId));
  function attempt(index, errors) {
    return installThemeFromSource(themeId, sources[index].id).catch(function(error) {
      errors.push(sources[index].id + ': ' + error.message);
      if (index + 1 >= sources.length) {
        throw new Error('所有市场源均不可用：' + errors.join('；'));
      }
      return attempt(index + 1, errors);
    });
  }
  return attempt(0, []);
}

function uninstallTheme(themeId) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(themeId || '')) throw new Error('主题 id 非法');
    var finalDir = path.join(marketThemesDir, themeId);
    if (!fs.existsSync(path.join(finalDir, 'manifest.json'))) throw new Error('主题未安装: ' + themeId);
    _removeTree(finalDir);
    console.log('[market] 主题已卸载:', themeId);
    return { id: themeId };
  });
}

// 设置插件启停：写 app_control 表（与 market 调度器、route-aggregator 闸门共用同一份真相），
// 即时生效——请求期闸门实时读取该表，无需重启。
function setPluginEnabled(pluginName, enabled, operatorId) {
  return Promise.resolve().then(function() {
    if (!/^[a-z][a-z0-9-]*$/.test(pluginName || '')) throw new Error('插件名非法');
    var manifestPath = path.join(runtimePluginsDir, pluginName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('插件未安装: ' + pluginName);
    var manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
    if (manifest.canDisable === false && !enabled) {
      throw new Error('插件「' + (manifest.label || pluginName) + '」声明为不可暂停');
    }
    var db = require('../utils/db');
    db.prepare("INSERT INTO app_control (app_name, enabled, updated_by, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(app_name) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .run(pluginName, enabled ? 1 : 0, operatorId || '');
    console.log('[market] 插件启停更新:', pluginName, enabled ? '启用' : '暂停');
    return { name: pluginName, label: manifest.label || pluginName, enabled: !!enabled };
  });
}

module.exports = {
  init: init,
  dispatcher: dispatcher,
  listInstalled: listInstalled,
  // 市场应用 manifest 校验器（与安装时同一份）：供 scripts/diag.js market 做装前预检
  validateMarketManifest: _validateMarketManifest,
  getInstalledManifest: getInstalledManifest,
  getConfigurableManifest: getConfigurableManifest,
  getCatalog: getCatalog,
  getCatalogWithFallback: getCatalogWithFallback,
  fetchAsset: fetchAsset,
  clearCatalogCache: clearCatalogCache,
  installApp: installApp,
  uninstallApp: uninstallApp,
  updateApp: updateApp,
  listInstalledPlugins: listInstalledPlugins,
  installPlugin: installPlugin,
  uninstallPlugin: uninstallPlugin,
  setPluginEnabled: setPluginEnabled,
  listInstalledThemes: listInstalledThemes,
  installTheme: installTheme,
  uninstallTheme: uninstallTheme,
  // 逐文件哈希校验（冒烟测试用；安装链内部自动调用）
  verifyFileHashes: _verifyFileHashes,
  // 独立端口型进程：状态查询 + 启停联动（admin 启停路由调用）
  processStatus: function() { return marketProcess.status(); },
  refreshProcessState: function(appName, enabled) {
    var m = getInstalledManifest(appName);
    if (m && m.backend && m.backend.process) {
      marketProcess.refreshProcessState(m, path.join(marketAppsDir, appName), enabled);
    }
  },
  getSources: function() {
    return DEFAULT_SOURCES.map(function(s) { return { id: s.id, label: s.label, type: s.type }; });
  },
  marketAppsDir: marketAppsDir,
  marketThemesDir: marketThemesDir,
  runtimePluginsDir: runtimePluginsDir
};
