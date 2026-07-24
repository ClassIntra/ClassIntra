// Material You 扩展主题 - 应用入口
// ============================================================
// 由 theme-extension-loader.js 在扫描到 manifest.json 后调用：
//   apply(engine, manifest, options) → 注册主题到 ThemeEngine
//
// 设计要点：
// 1. 静态 token（shape/motion/shadow）从 tokens.js 读取
// 2. 动态 color token 由 dynamic-color.js 生成（基于种子色）
// 3. 默认使用 manifest.defaultSeed 生成初始配色，用户可通过
//    engine.setDynamicColor('material-you', seedColor) 在运行时切换种子色
// 4. base=auto：继承当前 light/dark 主题，仅覆盖 shape/motion/color/shadow
//    这样 iOS 组件库的特有 token（glass 材质、onWallpaper 等）依然可用
// 5. 注册两套主题：material-you-light / material-you-dark
//    用户切换浅色/深色时由 ThemeEngine.setTheme 决定，本扩展只负责注册
// 6. 通过 engine.registerExtension 把 buildTokens 函数注册到引擎，
//    引擎据此实现 setDynamicColor 动态色重算

import { TOKENS } from './tokens.js';
import { generateMaterialYouTokens } from './dynamic-color.js';

// 构建完整的结构化 token 对象（color + shape + shadow + motion）
// isDark: 是否深色模式
// seedColor: 种子色（'#RRGGBB'），缺省取 manifest.defaultSeed
function buildTokens(manifest, isDark, seedColor) {
  var seed = seedColor || (manifest && manifest.defaultSeed) || '#0061A4';
  // 动态色 token（color + shadow，shadow 在 dynamic-color.js 内已按 isDark 区分）
  var dynamicTokens = generateMaterialYouTokens(seed, isDark);

  // 还原为结构化对象，供 ThemeEngine.registerTheme 使用
  // flattenTokens 会把 { color: { primary: ... } } 展平为 { --ci-color-primary: ... }
  var structured = {
    color: _unflattenColor(dynamicTokens),
    shape: TOKENS.shape,
    shadow: _unflattenShadow(dynamicTokens),
    motion: TOKENS.motion
  };
  return structured;
}

// 应用扩展主题到 ThemeEngine
// engine: ThemeEngine 实例
// manifest: 扩展 manifest 对象
// options: { apply: boolean, seedColor: string }
//   - apply: 是否注册后立即切换到该主题（默认 false）
//   - seedColor: 自定义种子色（缺省取 manifest.defaultSeed）
// 返回：注册的主题 id 数组
function apply(engine, manifest, options) {
  options = options || {};
  if (!engine || typeof engine.registerTheme !== 'function') {
    console.warn('[material-you] ThemeEngine 不存在或缺少 registerTheme 方法');
    return [];
  }

  var seed = options.seedColor || (manifest && manifest.defaultSeed) || '#0061A4';
  var extensionId = manifest.id || 'material-you';

  // 注册浅色变体
  var lightTokens = buildTokens(manifest, false, seed);
  var lightId = extensionId + '-light';
  engine.registerTheme(lightId, {
    name: manifest.name + ' 浅色',
    type: 'light',
    tokens: lightTokens,
    icons: null
  });

  // 注册深色变体
  var darkTokens = buildTokens(manifest, true, seed);
  var darkId = extensionId + '-dark';
  engine.registerTheme(darkId, {
    name: manifest.name + ' 深色',
    type: 'dark',
    tokens: darkTokens,
    icons: null
  });

  // 通过 engine.registerExtension 保存扩展状态（供 setDynamicColor 使用）
  if (typeof engine.registerExtension === 'function') {
    engine.registerExtension(extensionId, {
      seedColor: seed,
      lightId: lightId,
      darkId: darkId,
      manifest: manifest,
      buildTokens: function(isDark, newSeed) {
        return buildTokens(manifest, isDark, newSeed);
      }
    });
  }

  // 可选：立即切换
  if (options.apply) {
    var currentType = engine.getCurrentThemeType ? engine.getCurrentThemeType() : 'light';
    engine.setTheme(currentType === 'dark' ? darkId : lightId);
  }

  return [lightId, darkId];
}

// ========== 工具：从扁平 --ci-color-* 还原为结构化 color 对象 ==========
// ThemeEngine.registerTheme 期望 tokens 是结构化对象，
// 经 flattenTokens 展平后再写入 DOM。
// 因此需要把 dynamic-color.js 输出的扁平映射"反扁平化"为 { color: {...} } 结构。
function _unflattenColor(flatMap) {
  var color = {};
  Object.keys(flatMap).forEach(function(k) {
    if (k.indexOf('--ci-color-') !== 0) return;
    var name = k.replace(/^--ci-color-/, '');
    var parts = name.split('-');
    var node = color;
    for (var i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = flatMap[k];
  });
  return color;
}

// 阴影也按 --ci-shadow-* 还原
function _unflattenShadow(flatMap) {
  var shadow = {};
  Object.keys(flatMap).forEach(function(k) {
    if (k.indexOf('--ci-shadow-') !== 0) return;
    var name = k.replace(/^--ci-shadow-/, '');
    shadow[name] = flatMap[k];
  });
  // 兜底：如果 dynamic-color 未输出 shadow，用静态值
  if (Object.keys(shadow).length === 0) {
    shadow = TOKENS.shadow;
  }
  return shadow;
}

export { apply, buildTokens };
export default { apply: apply, buildTokens: buildTokens };
