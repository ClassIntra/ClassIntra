// Material You 动态色彩生成器
// ============================================================
// 基于 Material Design 3 (M3) Dynamic Color 规范，从用户提供的种子色
// （壁纸主色或用户自选色）派生出一整套和谐、对比度合格的主题色板。
//
// 核心概念：
// 1. HCT 色彩空间（Hue/Chroma/Tone）：M3 原生色彩空间，感知更均匀
//    本实现采用 HSL 近似（Chrome 80 兼容，无需 oklch CSS 支持）
//    注释中保留 HCT 术语，未来可平滑升级为完整 HCT→CAM16→RGB 实现
// 2. Tonal Palette：每个色调生成 0-100 共 13 档 tone（亮度梯度）
// 3. 五个调色板：
//    - primary：主品牌色（基于种子色相）
//    - secondary：次级色（色相微偏，chroma 降低）
//    - tertiary：第三色（色相偏移 ~60°，提供对比强调）
//    - neutral：中性色（极低 chroma，用于背景/文字）
//    - neutralVariant：中性变体（低 chroma，用于边框/次要表面）
// 4. 角色色映射：从 5 个 palette 的特定 tone 取值，映射到 M3 语义角色
//    （primary/primaryContainer/onPrimary/...），亮色与深色模式取不同 tone
//
// 参考：
// - https://m3.material.io/styles/color/the-color-system/color-roles
// - https://m3.material.io/styles/color/dynamic-color/overview
// - Google material-color-utilities (TypeScript) 的 JS 简化移植
//
// 兼容：Chrome 80+（ES5 风格，无可选链、无 BigInt、无原生 oklch）

// ========== 色彩空间转换 ==========

// HEX → HSL
// 返回 { h: 0-360, s: 0-100, l: 0-100 }
function hexToHsl(hex) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 50 };
  var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var delta = max - min;
  var h = 0, s = 0, l = (max + min) / 2;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r: h = ((g - b) / delta + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / delta + 2); break;
      case b: h = ((r - g) / delta + 4); break;
    }
    h *= 60;
  }
  return { h: h, s: s * 100, l: l * 100 };
}

// HSL → HEX
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = l - c / 2;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return _rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}

// ========== Tonal Palette 生成 ==========

// M3 标准 tone 档位（13+3 档）
// 0/10/20/25/30/35/40/50/60/70/80/90/95/98/99/100
var M3_TONES = [0, 10, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100];

// 从单一色相+饱和度生成 tonal palette
// hue: 0-360, chroma: 0-100（HSL saturation 近似 HCT chroma）
// 返回 { 0: '#xxx', 10: '#xxx', ..., 100: '#xxx' }
function generateTonalPalette(hue, chroma) {
  var palette = {};
  for (var i = 0; i < M3_TONES.length; i++) {
    var tone = M3_TONES[i];
    // HSL 近似：tone 直接映射为 lightness
    // chroma 越高 saturation 越高，但在极高/极低 tone 时降低（避免脏色）
    var sat = chroma;
    // 在 tone 接近 0/100 时，降低饱和度以模拟 HCT 的 chroma 收敛
    if (tone <= 10 || tone >= 95) sat = chroma * 0.4;
    else if (tone <= 20 || tone >= 90) sat = chroma * 0.7;
    palette[tone] = hslToHex(hue, sat, tone);
  }
  return palette;
}

// ========== 从种子色生成完整 M3 配色方案 ==========

// 主入口：从种子色生成 5 个 tonal palette
// seedColor: '#RRGGBB'
// 返回 { primary, secondary, tertiary, neutral, neutralVariant }（每个是 palette 对象）
function generateScheme(seedColor) {
  var hsl = hexToHsl(seedColor);
  var hue = hsl.h;
  var chroma = Math.max(hsl.s, 30); // 种子色饱和度太低时兜底到 30，保证有辨识度

  // primary：种子色相，高 chroma
  var primary = generateTonalPalette(hue, Math.min(chroma, 48));

  // secondary：同色相，chroma 降低（M3 secondary 更柔和）
  var secondary = generateTonalPalette(hue, Math.min(chroma * 0.5, 16));

  // tertiary：色相偏移 ~60°（向暖/冷方向），中等 chroma（提供对比强调）
  var tertiaryHue = _shiftHue(hue, 60);
  var tertiary = generateTonalPalette(tertiaryHue, Math.min(chroma * 0.6, 24));

  // neutral：极低 chroma（接近灰），色相微偏种子色（M3 neutral 带一丝种子色调）
  var neutral = generateTonalPalette(hue, 4);

  // neutralVariant：低 chroma，色相同种子色（用于边框/次要表面）
  var neutralVariant = generateTonalPalette(hue, 8);

  return {
    primary: primary,
    secondary: secondary,
    tertiary: tertiary,
    neutral: neutral,
    neutralVariant: neutralVariant
  };
}

// ========== 角色色映射（M3 Color Roles） ==========

// 从 scheme + 明暗模式生成 M3 角色色
// isDark: true=深色模式, false=亮色模式
// 返回 { primary, onPrimary, primaryContainer, onPrimaryContainer, ... }
function generateColorRoles(scheme, isDark) {
  var p = scheme.primary, s = scheme.secondary, t = scheme.tertiary;
  var n = scheme.neutral, nv = scheme.neutralVariant;

  if (isDark) {
    // 深色模式：角色色取高 tone（亮），on-色取低 tone（暗）
    return {
      primary: p[80],
      onPrimary: p[20],
      primaryContainer: p[30],
      onPrimaryContainer: p[90],
      secondary: s[80],
      onSecondary: s[20],
      secondaryContainer: s[30],
      onSecondaryContainer: s[90],
      tertiary: t[80],
      onTertiary: t[20],
      tertiaryContainer: t[30],
      onTertiaryContainer: t[90],
      background: n[10],
      onBackground: n[90],
      surface: n[10],
      onSurface: n[90],
      surfaceVariant: nv[30],
      onSurfaceVariant: nv[80],
      outline: nv[60],
      outlineVariant: nv[30],
      surfaceContainer: n[12],
      surfaceContainerHigh: n[17],
      surfaceContainerHighest: n[22],
      inverseSurface: n[90],
      inverseOnSurface: n[20],
      scrim: n[0]
    };
  }
  // 亮色模式：角色色取低 tone（深），on-色取高 tone（亮）
  return {
    primary: p[40],
    onPrimary: p[100],
    primaryContainer: p[90],
    onPrimaryContainer: p[10],
    secondary: s[40],
    onSecondary: s[100],
    secondaryContainer: s[90],
    onSecondaryContainer: s[10],
    tertiary: t[40],
    onTertiary: t[100],
    tertiaryContainer: t[90],
    onTertiaryContainer: t[10],
    background: n[99],
    onBackground: n[10],
    surface: n[98],
    onSurface: n[10],
    surfaceVariant: nv[90],
    onSurfaceVariant: nv[30],
    outline: nv[50],
    outlineVariant: nv[80],
    surfaceContainer: n[94],
    surfaceContainerHigh: n[92],
    surfaceContainerHighest: n[90],
    inverseSurface: n[20],
    inverseOnSurface: n[95],
    scrim: n[0]
  };
}

// ========== 映射到 ClassIntra --ci-* Token 体系 ==========

// 把 M3 角色色映射为 ClassIntra 现有 --ci-color-* 变量
// 这样 Material You 主题既符合 M3 规范，又能驱动现有 iOS 组件库
// 返回 { '--ci-color-primary': '#xxx', ... }（扁平 CSS 变量映射）
function rolesToCiTokens(roles, scheme, isDark) {
  // 语义色：从 tertiary palette 派生（M3 无内置语义色，用 palette 近似）
  // success 用绿色调（色相偏移到 ~140°）
  var successHue = _shiftHue(hexToHsl(scheme.primary[40]).h, 140 - hexToHsl(scheme.primary[40]).h);
  // 简化：直接用固定语义色（M3 风格），避免过度派生
  var semantic = isDark
    ? { success: '#A6D785', warning: '#FFB4A2', danger: '#FFB4AB', info: '#9EC6F0' }
    : { success: '#386A20', warning: '#8C4A00', danger: '#BA1A1A', info: '#00658E' };

  var tokens = {};
  // 主交互色
  tokens['--ci-color-primary'] = roles.primary;
  tokens['--ci-color-primary-hover'] = isDark ? scheme.primary[70] : scheme.primary[35];
  tokens['--ci-color-primary-pressed'] = isDark ? scheme.primary[60] : scheme.primary[30];
  tokens['--ci-color-primary-rgb'] = _hexToRgbStr(roles.primary);
  tokens['--ci-color-primary-light'] = _hexToRgba(roles.primaryContainer, 0.4);
  tokens['--ci-color-primary-lighter'] = _hexToRgba(roles.primaryContainer, 0.2);

  // 语义色
  tokens['--ci-color-semantic-success'] = semantic.success;
  tokens['--ci-color-semantic-success-rgb'] = _hexToRgbStr(semantic.success);
  tokens['--ci-color-semantic-warning'] = semantic.warning;
  tokens['--ci-color-semantic-warning-rgb'] = _hexToRgbStr(semantic.warning);
  tokens['--ci-color-semantic-danger'] = semantic.danger;
  tokens['--ci-color-semantic-danger-rgb'] = _hexToRgbStr(semantic.danger);
  tokens['--ci-color-semantic-danger-pressed'] = isDark ? '#FFDAD6' : '#93000A';
  tokens['--ci-color-semantic-info'] = semantic.info;

  // 背景与表面
  tokens['--ci-color-bg-base'] = roles.background;
  tokens['--ci-color-bg-card'] = roles.surface;
  tokens['--ci-color-bg-elevated'] = _hexToRgba(roles.surfaceContainerHigh, isDark ? 0.72 : 0.85);
  tokens['--ci-color-bg-glass'] = _hexToRgba(roles.surfaceContainer, 0.65);

  // 文字色
  tokens['--ci-color-text-primary'] = roles.onSurface;
  tokens['--ci-color-text-secondary'] = roles.onSurfaceVariant;
  tokens['--ci-color-text-tertiary'] = _hexToRgba(roles.onSurfaceVariant, 0.55);

  // 边框与分隔线
  tokens['--ci-color-border-default'] = _hexToRgba(roles.outline, 0.5);
  tokens['--ci-color-border-separator'] = _hexToRgba(roles.outlineVariant, 0.7);

  // 毛玻璃材质（M3 风格：用 surfaceContainer 半透明）
  tokens['--ci-color-glass-dock'] = _hexToRgba(roles.surfaceContainerHigh, 0.65);
  tokens['--ci-color-glass-nav'] = _hexToRgba(roles.surfaceContainer, 0.70);
  tokens['--ci-color-glass-nav-border'] = _hexToRgba(roles.outlineVariant, 0.4);
  tokens['--ci-color-glass-island'] = isDark ? '#1C1B1F' : roles.surfaceContainerHighest;
  tokens['--ci-color-glass-island-text'] = roles.onSurface;
  tokens['--ci-color-glass-sidebar'] = _hexToRgba(roles.surfaceContainer, 0.60);
  tokens['--ci-color-glass-bg'] = _hexToRgba(roles.surfaceContainer, 0.55);
  tokens['--ci-color-glass-border'] = _hexToRgba(roles.outlineVariant, 0.3);

  // 壁纸上的文字（保持白字 + 阴影，M3 不覆盖此场景）
  tokens['--ci-color-on-wallpaper-text'] = '#FFFFFF';
  tokens['--ci-color-on-wallpaper-shadow'] = '0 1px 3px rgba(0, 0, 0, 0.6)';
  tokens['--ci-color-on-wallpaper-dot'] = 'rgba(255, 255, 255, 0.4)';
  tokens['--ci-color-on-wallpaper-dot-active'] = '#FFFFFF';

  return tokens;
}

// ========== 完整入口：种子色 → --ci-* 扁平变量 ==========

// 从种子色生成完整的 --ci-* CSS 变量映射
// seedColor: '#RRGGBB'
// isDark: 是否深色模式
// 返回 { '--ci-color-primary': '#xxx', '--ci-shape-lg': '28px', ... }
function generateMaterialYouTokens(seedColor, isDark) {
  var scheme = generateScheme(seedColor);
  var roles = generateColorRoles(scheme, isDark);
  var tokens = rolesToCiTokens(roles, scheme, isDark);

  // 阴影：M3 风格更柔和
  if (isDark) {
    tokens['--ci-shadow-sm'] = '0 1px 2px rgba(0,0,0,0.4)';
    tokens['--ci-shadow-md'] = '0 2px 6px rgba(0,0,0,0.4)';
    tokens['--ci-shadow-lg'] = '0 8px 24px rgba(0,0,0,0.5)';
    tokens['--ci-shadow-xl'] = '0 16px 48px rgba(0,0,0,0.6)';
  } else {
    tokens['--ci-shadow-sm'] = '0 1px 2px rgba(0,0,0,0.08)';
    tokens['--ci-shadow-md'] = '0 2px 6px rgba(0,0,0,0.10)';
    tokens['--ci-shadow-lg'] = '0 8px 24px rgba(0,0,0,0.12)';
    tokens['--ci-shadow-xl'] = '0 16px 48px rgba(0,0,0,0.14)';
  }

  return tokens;
}

// ========== 工具函数 ==========

function _hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  var m = hex.replace('#', '').match(/^([a-f\d]{6}|[a-f\d]{3})$/i);
  if (!m) return null;
  var s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return {
    r: parseInt(s.substr(0, 2), 16),
    g: parseInt(s.substr(2, 2), 16),
    b: parseInt(s.substr(4, 2), 16)
  };
}

function _rgbToHex(r, g, b) {
  var toHex = function (n) {
    var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return h.length === 1 ? '0' + h : h;
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function _hexToRgbStr(hex) {
  var rgb = _hexToRgb(hex);
  return rgb ? (rgb.r + ', ' + rgb.g + ', ' + rgb.b) : '0, 0, 0';
}

function _hexToRgba(hex, alpha) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return 'rgba(0, 0, 0, ' + alpha + ')';
  return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
}

// 色相偏移（保证结果在 0-360）
function _shiftHue(hue, delta) {
  return ((hue + delta) % 360 + 360) % 360;
}

// ========== 导出 ==========

export {
  hexToHsl,
  hslToHex,
  generateTonalPalette,
  generateScheme,
  generateColorRoles,
  rolesToCiTokens,
  generateMaterialYouTokens,
  M3_TONES
};

export default {
  hexToHsl: hexToHsl,
  hslToHex: hslToHex,
  generateTonalPalette: generateTonalPalette,
  generateScheme: generateScheme,
  generateColorRoles: generateColorRoles,
  rolesToCiTokens: rolesToCiTokens,
  generateMaterialYouTokens: generateMaterialYouTokens,
  M3_TONES: M3_TONES
};
