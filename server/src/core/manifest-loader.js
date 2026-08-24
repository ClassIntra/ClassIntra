// 后端聚合层：manifest 加载器
// 扫描 apps/、plugins/、market-apps/ 三个相互独立的顶级目录
// apps/        —— 应用（含前端页面 + 可选后端）
// plugins/     —— 插件（仅后端，无前端页面）
// market-apps/ —— 第三方市场应用（运行时安装，支持热插拔）
//
// 加载的 manifest 上附带 _sourceDir 元数据，供 route-aggregator 解析入口路径
// 此文件位于 server/src/core/，到根目录的相对路径为 ../../../

var fs = require('fs');
var path = require('path');
var validateManifest = require('./manifest-schema').validateManifest;

var rootDir = path.resolve(__dirname, '../../../');
var appsDir = path.join(rootDir, 'apps');
var pluginsDir = path.join(rootDir, 'plugins');
var marketAppsDir = path.join(rootDir, 'market-apps');

// 扫描源定义：type 用于日志区分，dir 为绝对路径
var SOURCE_DIRS = [
  { type: 'app', dir: appsDir },
  { type: 'plugin', dir: pluginsDir },
  { type: 'market', dir: marketAppsDir }
];

// 缓存（每次启动加载一次，开发时如需热加载可调用 clearCache）
var _cache = null;

// 扫描单个源目录，将有效 manifest 追加到 manifests 数组
// 每个 manifest 上附带 _sourceDir / _sourceType，供 getEntryPath 使用
function _scanSource(sourceDef, manifests) {
  if (!fs.existsSync(sourceDef.dir)) return;
  var entries;
  try {
    entries = fs.readdirSync(sourceDef.dir, { withFileTypes: true });
  } catch (e) {
    console.error('[manifest-loader] 读取目录失败:', sourceDef.dir, e.message);
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    var name = entries[i].name;
    var manifestPath = path.join(sourceDef.dir, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      var raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!raw || !raw.name) continue;
      var result = validateManifest(raw);
      if (!result.valid) {
        console.warn('[manifest-loader] manifest "' + raw.name + '" 验证失败:', result.errors.join('; '));
        continue;
      }
      if (result.warnings.length > 0) {
        console.warn('[manifest-loader] manifest "' + raw.name + '" 警告:', result.warnings.join('; '));
      }
      // 标记来源目录，供 route-aggregator 解析入口路径
      result.manifest._sourceDir = sourceDef.dir;
      result.manifest._sourceType = sourceDef.type;
      manifests.push(result.manifest);
    } catch (e) {
      console.error('[manifest-loader] 加载 manifest 失败:', name, e.message);
    }
  }
}

function loadManifests() {
  if (_cache) return _cache;
  var manifests = [];
  for (var i = 0; i < SOURCE_DIRS.length; i++) {
    _scanSource(SOURCE_DIRS[i], manifests);
  }
  // 按 order 升序排序（越小越靠前，未配置默认 99）
  manifests.sort(function(a, b) { return (a.order || 99) - (b.order || 99); });
  _cache = manifests;
  return manifests;
}

// 获取入口绝对路径
// appName: 应用/插件名称
// relPath: 形如 './backend/routes.js'
// sourceDir: 可选，manifest 来源目录；缺省时回退到 appsDir（向后兼容）
function getAppEntryPath(appName, relPath, sourceDir) {
  if (!relPath) return null;
  var cleaned = relPath.replace(/^\.\//, '');
  var base = sourceDir || appsDir;
  return path.resolve(base, appName, cleaned);
}

// 清除缓存（开发时热加载用）
function clearCache() {
  _cache = null;
}

module.exports = {
  loadManifests: loadManifests,
  getAppEntryPath: getAppEntryPath,
  clearCache: clearCache,
  appsDir: appsDir,
  pluginsDir: pluginsDir,
  marketAppsDir: marketAppsDir
};
