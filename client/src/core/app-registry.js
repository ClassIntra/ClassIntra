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
  .filter(function(m) { return m.category === 'desktop'; })
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
      route: m.frontend && m.frontend.route
    };
  });

export { APP_REGISTRY };
