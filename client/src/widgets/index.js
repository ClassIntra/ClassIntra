// 桌面小组件注册表（manifest 结构，预留插件系统）
// 中心化管理所有可用 widget，Desktop.vue 通过 getWidget 懒加载组件
// 插件未来可通过 registerWidget API 动态注册
//
// widget manifest 字段:
//   - id: 唯一标识（对应 WIDGET_REGISTRY 的 key）
//   - name: 显示名称
//   - component: 异步组件加载函数 () => import(...)
//   - defaultSize: 默认大小 { w, h }（网格跨度，1-4）
//   - minSize: 最小大小 { w, h }
//   - maxSize: 最大大小 { w, h }
//   - description: 描述文字
//   - configSchema: 配置 schema（null 表示无配置项）
//       { fields: [{ key, label, type: 'select'|'text'|'bool', options?, default? }] }
//
// widget 数据结构（store state.layout.widgets[pageId]）:
//   { id, type, slot, w, h, config }
//   - id: 唯一 ID（'w_' + 时间戳）
//   - type: 对应 WIDGET_REGISTRY 的 key
//   - slot: 预留（未来用于网格定位）
//   - w/h: 网格跨度（1-4）
//   - config: 用户配置对象（透传给 widget 组件）

var WIDGET_REGISTRY = {
  'timetable-today': {
    id: 'timetable-today',
    name: '今日课表',
    component: function() { return import('@/widgets/TimetableTodayWidget.vue'); },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 4 },
    description: '显示今日课程和下节课倒计时',
    configSchema: null  // 今日课表无配置项
  },
  'countdown': {
    id: 'countdown',
    name: '倒数日',
    component: function() { return import('@/widgets/CountdownWidget.vue'); },
    defaultSize: { w: 2, h: 1 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 2 },
    description: '显示最近的倒数日',
    configSchema: {
      fields: [
        {
          key: 'filter',
          label: '显示范围',
          type: 'select',
          options: [
            { value: 'all', label: '全部' },
            { value: 'pinned', label: '仅置顶' },
            { value: 'today', label: '仅今天' }
          ],
          default: 'all'
        }
      ]
    }
  }
};

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

export { WIDGET_REGISTRY, getWidget, listWidgets, registerWidget };
