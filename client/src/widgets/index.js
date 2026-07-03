// 桌面小组件注册表
// 中心化管理所有可用 widget，Desktop.vue 通过 getWidget 懒加载组件
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
    description: '显示今日课程和下节课倒计时'
  }
};

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

export { WIDGET_REGISTRY, getWidget, listWidgets };
