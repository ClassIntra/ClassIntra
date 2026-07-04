// 前端聚合层：小组件聚合器
// 从 apps/*/manifest.json 聚合桌面 widget 注册表
// 兼容原 client/src/widgets/index.js 的 API（getWidget/listWidgets/registerWidget）
// 插件未来可通过 registerWidget 动态注册

import { loadManifests, getComponent } from './manifest-loader';

var manifests = loadManifests();
var WIDGET_REGISTRY = {};

manifests.forEach(function(m) {
  if (!m.frontend || !m.frontend.widgets) return;
  m.frontend.widgets.forEach(function(w) {
    var loader = getComponent(m.name, w.component);
    if (!loader) {
      console.error('[widget-aggregator] 找不到 widget 组件:', m.name, w.component);
      return;
    }
    WIDGET_REGISTRY[w.id] = {
      id: w.id,
      name: w.name,
      component: loader,
      defaultSize: w.defaultSize || { w: 2, h: 2 },
      minSize: w.minSize || { w: 1, h: 1 },
      maxSize: w.maxSize || { w: 4, h: 4 },
      description: w.description || '',
      configSchema: w.configSchema || null,
      // 记录来源应用，便于调试
      _app: m.name
    };
  });
});

// 获取 widget 定义
function getWidget(type) {
  return WIDGET_REGISTRY[type] || null;
}

// 列出所有可用 widget
function listWidgets() {
  return Object.keys(WIDGET_REGISTRY).map(function(k) {
    return Object.assign({}, WIDGET_REGISTRY[k]);
  });
}

// 动态注册 widget（预留插件系统入口）
// manifest: { id, name, component, defaultSize?, minSize?, maxSize?, description?, configSchema? }
function registerWidget(manifest) {
  if (!manifest || !manifest.id || !manifest.component) {
    console.error('[widgets] registerWidget: manifest 缺少 id 或 component');
    return false;
  }
  if (WIDGET_REGISTRY[manifest.id]) {
    console.warn('[widgets] registerWidget: widget ' + manifest.id + ' 已存在，覆盖');
  }
  WIDGET_REGISTRY[manifest.id] = Object.assign({
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 4 },
    configSchema: null
  }, manifest);
  return true;
}

export { WIDGET_REGISTRY, getWidget, listWidgets, registerWidget };
