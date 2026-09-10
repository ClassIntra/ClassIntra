// 前端核心：令牌注入器（TokenInjector）
// ============================================================
// 作用：把在 :root / [data-theme] 上生效的 CSS 自定义属性（--ci-* 及旧别名）
//       复制到指定的容器根节点，使容器**内部**（含第三方应用的 DOM）
//       自动继承主题变量。
//
// 为什么需要它？
//   CSS 自定义属性本身是继承的——理论上第三方 DOM 挂在 body 下就能拿到 :root 的变量。
//   但有三个现实问题：
//     1. 部分第三方样式表会写死颜色（如 color:#333），不消费变量 → 需要兜底
//     2. 主题切换时，若容器有独立的样式作用域（后续若要加 isolation），变量不会自动刷新
//     3. 未来若支持「单应用独立主题」或「应用级视觉覆盖」，需要在容器层覆盖
//   因此采用「显式注入 + 主题变化重注入」的策略，把跟随从「隐式继承」变为「显式保证」。
//
// 实现要点：
//   - 只注入**已定义且非空**的令牌，避免把 undefined 写进 style 造成污染
//   - 使用 el.style.setProperty 写在容器根节点的内联样式上，优先级高于应用自身声明
//   - clean() 负责移除注入的令牌，避免应用切换后残留
//
// 编码约定：全文件使用 var / function / 单引号 / 2 空格缩进

// 需要注入的令牌白名单（前缀匹配）
// 说明：只注入 --ci-* 体系与已知的旧别名，避免把无关变量带过去
var TOKEN_PREFIXES = ['--ci-', '--ios-'];
var TOKEN_EXACT = [
  // 颜色
  '--primary-color', '--secondary-color', '--success-color', '--warning-color',
  '--danger-color', '--info-color',
  // 背景
  '--background-color', '--secondary-bg', '--tertiary-bg', '--card-bg',
  '--nav-bg', '--sidebar-bg', '--input-bg', '--hover-bg', '--active-bg',
  // 文本
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-quaternary',
  '--text-inverse', '--text-link',
  // 边框与分隔
  '--border-color', '--separator-color', '--divider-color',
  // 圆角
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
  '--radius-2xl', '--radius-3xl', '--radius-full',
  // 字号
  '--font-size-caption2', '--font-size-caption1', '--font-size-footnote',
  '--font-size-subheadline', '--font-size-body', '--font-size-headline',
  '--font-size-title3', '--font-size-title2', '--font-size-title1',
  '--font-size-largeTitle',
  // 字重
  '--font-weight-regular', '--font-weight-medium', '--font-weight-semibold',
  '--font-weight-bold',
  // 字体
  '--font-family', '--font-family-mono',
  // 间距
  '--spacing-xs', '--spacing-sm', '--spacing-md', '--spacing-lg',
  '--spacing-xl', '--spacing-2xl',
  // 动效
  '--duration-fast', '--duration-normal', '--duration-slow',
  '--ease-standard', '--ease-emphasized', '--ease-spring',
  // 毛玻璃
  '--glass-blur-container', '--glass-blur-nav', '--glass-blur-card',
  // 阴影
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-xl'
];

// 缓存「当前 :root 上已生效的令牌」，避免每次注入都做全量 getComputedStyle
var _tokenCache = null;
var _cacheThemeId = null;

// 从 :root 计算样式中采集令牌
function collectTokens() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {};
  }
  var root = document.documentElement;
  if (!root) return {};

  // 主题标识变化时清空缓存
  var themeId = root.getAttribute('data-theme') || 'light';
  var noMotion = root.getAttribute('data-no-motion') || '';
  var cacheKey = themeId + '|' + noMotion;
  if (_tokenCache && _cacheThemeId === cacheKey) {
    return _tokenCache;
  }

  var computed = window.getComputedStyle(root);
  var tokens = {};
  var i, j, name, value;

  // 1. 单次遍历 computed，同时做前缀匹配
  //    原实现为「外层遍历前缀 × 内层遍历 computed」（O(P×N)），
  //    在 P=2、N≈150 时需遍历 300 次；改为单次遍历 O(N)（§5.5.5 性能约束）
  var len = computed.length;
  for (i = 0; i < len; i++) {
    name = computed[i];
    if (!name) continue;
    for (j = 0; j < TOKEN_PREFIXES.length; j++) {
      if (name.indexOf(TOKEN_PREFIXES[j]) === 0) {
        value = computed.getPropertyValue(name);
        if (value && value.trim()) tokens[name] = value.trim();
        break; // 命中一个前缀即可，避免重复取值
      }
    }
  }

  // 2. 按白名单采集旧别名
  for (i = 0; i < TOKEN_EXACT.length; i++) {
    name = TOKEN_EXACT[i];
    if (tokens[name]) continue;
    value = computed.getPropertyValue(name);
    if (value && value.trim()) tokens[name] = value.trim();
  }

  _tokenCache = tokens;
  _cacheThemeId = cacheKey;
  return tokens;
}

// 清除令牌缓存（主题切换后调用，或由外部强制刷新）
function invalidateCache() {
  _tokenCache = null;
  _cacheThemeId = null;
}

function TokenInjector() {
  this._injected = {};   // { '<elementId-or-marker>': [tokenNames] } —— 记录已注入的容器
  this._markerSeq = 0;
}

// 向容器注入令牌
// el: 容器根节点（通常是 AppShell 的 $el）
// options: { overrides: { '--primary-color': '#ff0000' } } —— 应用级覆盖（未来使用）
TokenInjector.prototype.inject = function(el, options) {
  if (!el || !el.style) return 0;
  var opts = options || {};
  var tokens = collectTokens();
  var count = 0;
  var self = this;

  // 给容器打标记，便于 clean 时识别
  if (!el.__ciTokenMarker) {
    el.__ciTokenMarker = 'ci-tok-' + (++self._markerSeq);
    self._injected[el.__ciTokenMarker] = [];
  }
  var recorded = self._injected[el.__ciTokenMarker];

  var names = Object.keys(tokens);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    try {
      if (el.style.getPropertyValue(name) !== tokens[name]) {
        el.style.setProperty(name, tokens[name]);
      }
      if (recorded.indexOf(name) === -1) recorded.push(name);
      count++;
    } catch (e) {
      // 个别非法属性名忽略
    }
  }

  // 应用级覆盖（优先级最高，写在最后）
  if (opts.overrides && typeof opts.overrides === 'object') {
    var ovNames = Object.keys(opts.overrides);
    for (var k = 0; k < ovNames.length; k++) {
      var ovName = ovNames[k];
      try {
        el.style.setProperty(ovName, opts.overrides[ovName]);
        if (recorded.indexOf(ovName) === -1) recorded.push(ovName);
      } catch (e) {}
    }
  }

  // 标记容器：让第三方样式可以针对「在 AppShell 内」写选择器
  el.setAttribute('data-ci-shell', '1');

  return count;
};

// 清理容器上注入的令牌
TokenInjector.prototype.clean = function(el) {
  if (!el || !el.style) return 0;
  var marker = el.__ciTokenMarker;
  var names = marker && this._injected[marker] ? this._injected[marker] : [];
  var count = 0;
  for (var i = 0; i < names.length; i++) {
    try {
      el.style.removeProperty(names[i]);
      count++;
    } catch (e) {}
  }
  if (marker) delete this._injected[marker];
  try {
    el.removeAttribute('data-ci-shell');
    delete el.__ciTokenMarker;
  } catch (e) {}
  return count;
};

// 采集结果（供诊断 / SDK context.theme 使用）
TokenInjector.prototype.getTokens = function() {
  return collectTokens();
};

// 获取单个令牌值
TokenInjector.prototype.getToken = function(name) {
  var tokens = collectTokens();
  return tokens[name] || '';
};

// 判断令牌是否存在（供 context.compat.has 使用）
TokenInjector.prototype.hasToken = function(name) {
  var tokens = collectTokens();
  return Object.prototype.hasOwnProperty.call(tokens, name);
};

var _instance = null;

function getTokenInjector() {
  if (!_instance) {
    _instance = new TokenInjector();
  }
  return _instance;
}

export {
  TOKEN_PREFIXES,
  TOKEN_EXACT,
  TokenInjector,
  getTokenInjector,
  collectTokens,
  invalidateCache
};
