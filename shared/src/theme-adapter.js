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
// 供主题包加载用：用户主题包只需提供一个主色，自动生成完整色阶
// 算法：50-400 与白色混合（越靠近 50 越浅），500 为原色，600-900 与黑色混合（越靠近 900 越深）
// 输入：'#007AFF' → 输出：{ 50: '...', 100: '...', ..., 900: '...' }
function generateColorScale(hex) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return { 50: hex, 100: hex, 200: hex, 300: hex, 400: hex, 500: hex, 600: hex, 700: hex, 800: hex, 900: hex };

  var levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  // 每个色阶与白色/黑色的混合比例
  // 50: 95% white, 100: 90% white, 200: 75% white, 300: 60% white, 400: 30% white
  // 500: 原色
  // 600: 20% black, 700: 40% black, 800: 60% black, 900: 80% black
  var mixRatios = {
    50: 0.95, 100: 0.90, 200: 0.75, 300: 0.60, 400: 0.30,
    500: 0,
    600: -0.20, 700: -0.40, 800: -0.60, 900: -0.80
  };

  var scale = {};
  for (var i = 0; i < levels.length; i++) {
    var level = levels[i];
    var ratio = mixRatios[level];
    if (ratio > 0) {
      // 与白色混合
      scale[level] = _rgbToHex(_mix(rgb, { r: 255, g: 255, b: 255 }, ratio));
    } else if (ratio < 0) {
      // 与黑色混合
      scale[level] = _rgbToHex(_mix(rgb, { r: 0, g: 0, b: 0 }, -ratio));
    } else {
      // 原色
      scale[level] = hex;
    }
  }
  return scale;
}

// HEX 转 RGB
function _hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  var m = hex.replace('#', '').match(/^([a-f\d]{6}|[a-f\d]{3})$/i);
  if (!m) return null;
  var s = m[1];
  if (s.length === 3) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  return {
    r: parseInt(s.substr(0, 2), 16),
    g: parseInt(s.substr(2, 2), 16),
    b: parseInt(s.substr(4, 2), 16)
  };
}

// RGB 转 HEX
function _rgbToHex(rgb) {
  var toHex = function(n) {
    var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return h.length === 1 ? '0' + h : h;
  };
  return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
}

// 混合两个 RGB 颜色，ratio 是 color2 的占比（0-1）
function _mix(color1, color2, ratio) {
  return {
    r: color1.r + (color2.r - color1.r) * ratio,
    g: color1.g + (color2.g - color1.g) * ratio,
    b: color1.b + (color2.b - color1.b) * ratio
  };
}

export {
  flattenTokens,
  applyToElement,
  removeFromElement,
  generateColorScale
};
