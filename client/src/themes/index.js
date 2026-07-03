// 主题注册表（架构预留）
// 当前阶段：仅 light/dark 两个内置主题
// 未来：支持主题包加载（从 Resources/public/themes/ 导入第三方主题）
//
// 主题对象结构：
//   { id, name, type: 'light'|'dark', icons: null|string }
//   - icons: null = 使用默认图标；string = 主题图标目录路径

var THEME_REGISTRY = {
  'light': {
    id: 'light',
    name: '默认浅色',
    type: 'light',
    icons: null
  },
  'dark': {
    id: 'dark',
    name: '默认深色',
    type: 'dark',
    icons: null
  }
};

// 列出所有可用主题
function listThemes() {
  return Object.keys(THEME_REGISTRY).map(function(k) {
    return Object.assign({}, THEME_REGISTRY[k]);
  });
}

// 获取主题定义
function getTheme(id) {
  return THEME_REGISTRY[id] || THEME_REGISTRY.light;
}

export { THEME_REGISTRY, listThemes, getTheme };
