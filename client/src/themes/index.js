// 主题注册表（架构预留）
// 当前阶段：light/dark 两个内置主题
// 未来：支持主题包加载（从 Resources/public/themes/ 导入第三方主题）
//
// 阶段 2 起内部委托 ThemeEngine（core/theme-engine.js），保留对外 API 兼容
// 旧代码 import { THEME_REGISTRY, listThemes, getTheme } 仍可正常使用
//
// 主题对象结构：
//   { id, name, type: 'light'|'dark', icons: null|string }
//   - icons: null = 使用默认图标；string = 主题图标目录路径

import { getThemeEngine } from '@/core/theme-engine';

// 兼容旧代码：THEME_REGISTRY 在模块加载时构建一次快照
// 新主题注册后需调用 listThemes() 获取最新列表
function _buildRegistry() {
  var engine = getThemeEngine();
  var themes = engine.listThemes();
  var registry = {};
  for (var i = 0; i < themes.length; i++) {
    registry[themes[i].id] = themes[i];
  }
  return registry;
}

var THEME_REGISTRY = _buildRegistry();

// 列出所有可用主题
function listThemes() {
  return getThemeEngine().listThemes();
}

// 获取主题定义（与旧格式兼容，不含 tokens）
function getTheme(id) {
  var engine = getThemeEngine();
  var theme = engine.getTheme(id) || engine.getTheme('light');
  if (!theme) {
    // ThemeEngine 未初始化时的兜底
    return { id: 'light', name: '默认浅色', type: 'light', icons: null };
  }
  return { id: theme.id, name: theme.name, type: theme.type, icons: theme.icons };
}

export { THEME_REGISTRY, listThemes, getTheme };
