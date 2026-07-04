// 后端聚合层：manifest 加载器
// 用 fs 扫描 apps/*/manifest.json
// 此文件位于 server/src/core/，到 apps/ 的相对路径为 ../../../apps/

var fs = require('fs');
var path = require('path');

var appsDir = path.resolve(__dirname, '../../../apps');

// 缓存（每次启动加载一次，开发时如需热加载可手动清除）
var _cache = null;

function loadManifests() {
  if (_cache) return _cache;
  var manifests = [];
  try {
    if (!fs.existsSync(appsDir)) {
      console.warn('[manifest-loader] apps/ 目录不存在:', appsDir);
      _cache = manifests;
      return manifests;
    }
    var entries = fs.readdirSync(appsDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isDirectory()) continue;
      var manifestPath = path.join(appsDir, entries[i].name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        var m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (m && m.name) manifests.push(m);
      } catch (e) {
        console.error('[manifest-loader] 加载 manifest 失败:', entries[i].name, e.message);
      }
    }
    // 按 order 升序排序
    manifests.sort(function(a, b) { return (a.order || 99) - (b.order || 99); });
  } catch (e) {
    console.error('[manifest-loader] 扫描 apps/ 目录失败:', e.message);
  }
  _cache = manifests;
  return manifests;
}

// 获取应用后端入口绝对路径
// relPath 形如 './backend/routes.js'
function getAppEntryPath(appName, relPath) {
  if (!relPath) return null;
  var cleaned = relPath.replace(/^\.\//, '');
  return path.resolve(appsDir, appName, cleaned);
}

// 清除缓存（开发时热加载用）
function clearCache() {
  _cache = null;
}

module.exports = {
  loadManifests: loadManifests,
  getAppEntryPath: getAppEntryPath,
  clearCache: clearCache,
  appsDir: appsDir
};
