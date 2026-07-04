// 前端聚合层：manifest 加载器
// 用 import.meta.glob eager 加载所有 apps/*/manifest.json
// 同时 glob 组件文件，构建 component 加载函数映射
//
// 注意：import.meta.glob 路径必须以相对路径或别名开头，Vite 在构建时静态分析
// 此文件位于 client/src/core/，到 apps/ 的相对路径为 ../../../apps/

var manifestModules = import.meta.glob('../../../apps/*/manifest.json', { eager: true, as: 'json' });
var componentModules = import.meta.glob('../../../apps/*/frontend/**/*.{vue,js}');

// 缓存 manifests 数组（只加载一次）
var _manifestsCache = null;

function loadManifests() {
  if (_manifestsCache) return _manifestsCache;
  var list = [];
  Object.keys(manifestModules).forEach(function(p) {
    var mod = manifestModules[p];
    var m = mod.default || mod;
    if (m && m.name) list.push(m);
  });
  // 按 order 升序排序（越小越靠前，未配置默认 99）
  list.sort(function(a, b) { return (a.order || 99) - (b.order || 99); });
  _manifestsCache = list;
  return list;
}

// 根据应用名和相对组件路径，获取组件加载函数
// relPath 形如 './frontend/Countdown.vue'
function getComponent(appName, relPath) {
  if (!relPath) return null;
  var cleaned = relPath.replace(/^\.\//, '');
  var key = '../../../apps/' + appName + '/' + cleaned;
  return componentModules[key] || null;
}

export { loadManifests, getComponent };
