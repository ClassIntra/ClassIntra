// 前端核心：主题加载器
// 扫描独立的顶级 themes/ 目录，加载所有 themes/*/manifest.json
// 此文件位于 client/src/core/，到 themes/ 的相对路径为 ../../../themes/
//
// 主题 manifest 结构：
//   { id, name, type: 'light'|'dark', version, description, tokens: './tokens.js', icons: null }
//
// 输出：返回主题对象数组，每个对象含 tokens 数据（已加载为 JS 对象）
//   [{ id, name, type, tokens, icons }]

// eager 加载 manifest 与 tokens 模块
// Vite 5+ 使用 query 形式加载 JSON
var themeManifests = import.meta.glob('../../../themes/*/manifest.json', { eager: true, query: '?json' });
// tokens 模块用 eager 加载，避免运行时异步 require
var themeTokenModules = import.meta.glob('../../../themes/*/tokens.js', { eager: true });

// 缓存
var _cache = null;

function loadThemes() {
  if (_cache) return _cache;
  var themes = [];
  Object.keys(themeManifests).forEach(function(p) {
    var mod = themeManifests[p];
    var m = mod.default || mod;
    if (!m || !m.id) return;
    // 验证必要字段
    if (!m.name || typeof m.name !== 'string') {
      console.warn('[theme-loader] 主题 "' + (m.id || p) + '" 缺少 name 字段，跳过');
      return;
    }
    if (m.type !== 'light' && m.type !== 'dark') {
      console.warn('[theme-loader] 主题 "' + m.id + '" type 必须为 light 或 dark，跳过');
      return;
    }
    // 加载 tokens 数据
    var tokens = null;
    if (m.tokens) {
      // m.tokens 形如 './tokens.js'，构建 glob key
      var cleaned = m.tokens.replace(/^\.\//, '');
      // 从 manifest 路径提取目录前缀
      // p 形如 '../../../themes/light/manifest.json'
      var dir = p.replace(/manifest\.json$/, '');
      var tokensKey = dir + cleaned;
      var tokensMod = themeTokenModules[tokensKey];
      if (tokensMod) {
        tokens = tokensMod.default || tokensMod.TOKENS || tokensMod;
      } else {
        console.warn('[theme-loader] 主题 "' + m.id + '" 的 tokens 文件未找到:', tokensKey);
      }
    }
    themes.push({
      id: m.id,
      name: m.name,
      type: m.type,
      version: m.version || '0.0.0',
      description: m.description || '',
      tokens: tokens,
      icons: m.icons || null
    });
  });
  _cache = themes;
  return themes;
}

export { loadThemes };
