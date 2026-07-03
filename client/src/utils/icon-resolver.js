// 主题图标解析器（架构预留）
// 当前阶段：直接返回 app.icon，保持现状
// 未来：根据 settings.themeId，从主题包内查找替换图标
//
// 设计目的：
//   - 让 AppIcon.vue 不直接依赖 app.icon 字段
//   - 引入抽象层，未来切换主题时可在此处返回主题包内对应图标
//   - 当前为零行为变更，纯架构层

import store from '@/store';

// 解析应用图标路径
// app: APP_REGISTRY 中的应用对象，含 icon 字段
// 返回：图标 URL 字符串
export function resolveAppIcon(app) {
  if (!app || !app.icon) return '';

  // 阶段1（当前）：直接返回 APP_REGISTRY 中的 icon 路径
  // 兼容现状，无任何行为变更
  return app.icon;

  // 阶段2（未来实现，当前注释保留）：
  //   var themeId = store.state.settings.theme || 'light';
  //   var theme = getTheme(themeId);
  //   if (theme && theme.icons) {
  //     // 尝试返回主题包内的图标（带 fallback）
  //     var themedIcon = theme.icons + '/' + app.name + '.png';
  //     return themedIcon;  // 配合 <img onerror> 回退到 app.icon
  //   }
  //   return app.icon;
}

// 预留：批量预加载主题图标（未来实现）
export function preloadThemeIcons(themeId) {
  // 阶段2：根据主题预加载所有图标到缓存
  return Promise.resolve();
}
