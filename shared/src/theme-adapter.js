// 共享层：主题适配器
// 参考 Ditto packages/theme/src/adapter.ts
//
// 功能：
// 1. flattenTokens: 把结构化 token 对象展平为 { '--ci-xxx': value } 的扁平映射
// 2. applyToElement: 把扁平映射写入 DOM 元素的 inline style
// 3. generateColorScale: 从单一颜色生成 50-900 色阶（供主题包加载用，本期预留）

// 把驼峰命名转为 kebab-case
// 例：primaryHover → primary-hover，successRgb → success-rgb
function _toKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, function(_, a, b) {
    return a + '-' + b.toLowerCase();
  }).toLowerCase();
}

// 递归展平 token 对象
// 输入：{ color: { primary: '#007AFF', accent: { music: '#FF2D55' } } }
// 输出：{ '--ci-color-primary': '#007AFF', '--ci-color-accent-music': '#FF2D55' }
// prefix 用于递归，外部调用时传 'ci' 或留空
function flattenTokens(tokens, prefix) {
  var result = {};
  if (!tokens || typeof tokens !== 'object') return result;
  var keys = Object.keys(tokens);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = tokens[key];
    var fullKey = prefix ? prefix + '-' + _toKebab(key) : 'ci-' + _toKebab(key);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // 递归展平
      var nested = flattenTokens(value, fullKey);
      var nestedKeys = Object.keys(nested);
      for (var j = 0; j < nestedKeys.length; j++) {
        result[nestedKeys[j]] = nested[nestedKeys[j]];
      }
    } else {
      // 叶子节点，直接写入（CSS 变量名以 -- 开头）
      result['--' + fullKey] = String(value);
    }
  }
  return result;
}

// 把扁平映射写入 DOM 元素的 inline style
// flatMap: { '--ci-color-primary': '#007AFF', ... }
function applyToElement(element, flatMap) {
  if (!element || !flatMap) return;
  var keys = Object.keys(flatMap);
  for (var i = 0; i < keys.length; i++) {
    element.style.setProperty(keys[i], flatMap[keys[i]]);
  }
}

// 从 DOM 元素移除所有 --ci-* 变量
function removeFromElement(element) {
  if (!element || !element.style) return;
  // 遍历所有 inline style 属性，移除以 --ci- 开头的
  var toRemove = [];
  for (var i = 0; i < element.style.length; i++) {
    var prop = element.style[i];
    if (prop && prop.indexOf('--ci-') === 0) {
      toRemove.push(prop);
    }
  }
  for (var j = 0; j < toRemove.length; j++) {
    element.style.removeProperty(toRemove[j]);
  }
}

// 从单一颜色生成色阶（50-900）
// 供主题包加载用，本期预留不实现完整逻辑
// 输入：'#007AFF' → 输出：{ 50: '...', 100: '...', ..., 900: '...' }
function generateColorScale(hex) {
  // 简化版：仅返回原色作为所有色阶的值
  // 完整实现可参考 Ditto adapter.ts 的 mixWithWhite/mixWithBlack
  var scale = {};
  var levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (var i = 0; i < levels.length; i++) {
    scale[levels[i]] = hex;
  }
  return scale;
}

export {
  flattenTokens,
  applyToElement,
  removeFromElement,
  generateColorScale
};
