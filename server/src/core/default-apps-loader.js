// 后端聚合层：默认应用列表加载器
// 从 manifest.json 提取 defaultApps 列表（供 init-db.js 初始化 app_control 表）
// 同时提供 getAllApps() 供管理后台展示

var manifestLoader = require('./manifest-loader');

// 获取默认启用的应用列表
function getDefaultApps() {
  var manifests = manifestLoader.loadManifests();
  return manifests
    .filter(function(m) { return m.defaultEnabled !== false; })
    .map(function(m) { return m.name; });
}

// 获取所有应用元数据（供管理后台）
function getAllApps() {
  var manifests = manifestLoader.loadManifests();
  return manifests.map(function(m) {
    return {
      name: m.name,
      label: m.label,
      icon: m.icon,
      color: m.color,
      category: m.category || 'desktop',
      canDisable: m.canDisable !== false,
      defaultEnabled: m.defaultEnabled !== false,
      order: m.order || 99
    };
  });
}

// 获取桌面应用（category === 'desktop'）
function getDesktopApps() {
  var manifests = manifestLoader.loadManifests();
  return manifests
    .filter(function(m) { return (m.category || 'desktop') === 'desktop'; })
    .map(function(m) {
      return {
        name: m.name,
        label: m.label,
        icon: m.icon,
        color: m.color,
        route: m.frontend && m.frontend.route
      };
    });
}

module.exports = {
  getDefaultApps: getDefaultApps,
  getAllApps: getAllApps,
  getDesktopApps: getDesktopApps
};
