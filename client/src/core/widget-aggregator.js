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
      // 权限字段：拥有指定 permission 的用户才能查看/添加此 widget（null 表示无限制）
      permission: w.permission || null,
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

// 注销 widget（市场应用卸载/停用时摘除其小组件）
function unregisterWidget(id) {
  if (!id || !WIDGET_REGISTRY[id]) return false;
  delete WIDGET_REGISTRY[id];
  return true;
}

// ===== 市场应用小组件的运行时注册 =====
// 市场应用的 widget 没有独立 .vue 组件文件（不参与构建），渲染入口在
// entry.js 的 definition.widgets[<id>] 契约上（见 https://classintra.github.io/development/package-spec）。
// 注册键统一加 'mw:' 前缀（market widget），避免与官方 widget id 冲突。
// apps = marketRegistry.refresh() 的返回值（listInstalled 已透传 widgets 白名单字段）。
import MarketWidgetHost from '@/components/MarketWidgetHost.vue';

function makeMarketWidgetComponent(appName, widgetId) {
  return {
    name: 'MarketWidget_' + appName + '_' + widgetId,
    functional: true,
    props: { config: { type: Object, default: function() { return {}; } } },
    render: function(h, ctx) {
      return h(MarketWidgetHost, {
        props: { appName: appName, widgetId: widgetId, config: (ctx.props && ctx.props.config) || {} }
      });
    }
  };
}

function syncMarketWidgets(apps) {
  var list = Array.isArray(apps) ? apps : [];
  var wantedKeys = {};
  list.forEach(function(app) {
    if (!app || !app.name || !Array.isArray(app.widgets)) return;
    var appLabel = app.label || app.name;
    app.widgets.forEach(function(w) {
      if (!w || !w.id || !w.name) return;
      var key = 'mw:' + app.name + ':' + w.id;
      wantedKeys[key] = true;
      if (WIDGET_REGISTRY[key]) {
        // 已注册（版本更新场景）：就地刷新元数据
        WIDGET_REGISTRY[key].name = appLabel + ' · ' + w.name;
        WIDGET_REGISTRY[key].description = w.description || '';
        WIDGET_REGISTRY[key].configSchema = w.configSchema || null;
        WIDGET_REGISTRY[key].permission = w.permission || null;
        return;
      }
      registerWidget({
        id: key,
        name: appLabel + ' · ' + w.name,
        component: makeMarketWidgetComponent(app.name, w.id),
        defaultSize: w.defaultSize || { w: 2, h: 2 },
        minSize: w.minSize || { w: 1, h: 1 },
        maxSize: w.maxSize || { w: 4, h: 4 },
        description: w.description || '',
        configSchema: w.configSchema || null,
        permission: w.permission || null,
        // _app 记录来源应用：桌面布局清理（cleanLayoutApps）按 appName 摘除失效 widget
        _app: app.name,
        _market: true
      });
    });
  });
  Object.keys(WIDGET_REGISTRY).forEach(function(key) {
    if (key.indexOf('mw:') === 0 && !wantedKeys[key]) unregisterWidget(key);
  });
}

export { WIDGET_REGISTRY, getWidget, listWidgets, registerWidget, unregisterWidget, syncMarketWidgets };
