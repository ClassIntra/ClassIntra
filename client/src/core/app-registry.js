// 前端聚合层：APP_REGISTRY 应用元数据注册表
// 从 apps/*/manifest.json 聚合桌面应用元数据，供 store/modules/desktop.js 使用
// 仅聚合 category === 'desktop' 的应用
//
// icon 字段支持两种形式：
//   1. 绝对路径 '/resources/public/icons/Countdown.png' → 直接使用
//   2. 相对路径 './icon.png' → 自动转换为 '/apps-static/{appName}/icon.png'

import { loadManifests } from './manifest-loader';

var manifests = loadManifests();
var APP_REGISTRY = manifests
  .filter(function(m) {
    return m.category === 'desktop';
  })
  .map(function(m) {
    var icon = m.icon || '';
    // 相对路径自动转换为 apps-static 路径（图标可放应用目录内）
    if (icon.indexOf('./') === 0) {
      icon = '/apps-static/' + m.name + '/' + icon.replace(/^\.\//, '');
    }
    return {
      name: m.name,
      label: m.label,
      icon: icon,
      color: m.color,
      route: m.frontend && m.frontend.route,
      // visibleRoles: 可选，限定应用图标仅对某些角色显示
      // 未声明表示对所有用户可见
      visibleRoles: m.visibleRoles || null
    };
  });

function mergeMarketApps(apps) {
  var marketNames = {};
  if (Array.isArray(apps)) {
    apps.forEach(function(app) {
      if (!app || !app.name || !app.route) return;
      marketNames[app.name] = true;
      var item = APP_REGISTRY.find(function(entry) { return entry.name === app.name; });
      var icon = app.icon || '';
      if (icon.indexOf('./') === 0) {
        icon = '/market-static/' + app.name + '/' + icon.replace(/^\.\//, '');
      }
      var next = {
        name: app.name,
        label: app.label || app.name,
        icon: icon,
        color: app.color || '',
        route: app.route,
        visibleRoles: app.visibleRoles || null,
        market: true,
        version: app.version || '0.0.0'
      };
      if (item && item.market) Object.assign(item, next);
      else if (!item) APP_REGISTRY.push(next);
    });
  }
  for (var i = APP_REGISTRY.length - 1; i >= 0; i--) {
    if (APP_REGISTRY[i].market && !marketNames[APP_REGISTRY[i].name]) {
      APP_REGISTRY.splice(i, 1);
    }
  }
  return APP_REGISTRY;
}

export { APP_REGISTRY, mergeMarketApps };
