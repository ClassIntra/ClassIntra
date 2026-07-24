// Material You 扩展主题 - 静态 Token 定义
// ============================================================
// 此文件定义 Material You 主题的静态 token（不随种子色变化的部分）：
//   - shape：M3 风格更大圆角（4→8、8→12、12→16、16→20、20→24、24→28、28→32）
//   - motion：M3 标准缓动曲线（emphasized 用 M3 官方曲线）
//   - shadow：M3 柔和阴影梯度
//
// 动态部分（color）：由 dynamic-color.js 在运行时根据种子色生成，
// 通过 ThemeEngine.setDynamicColor(seedColor) 注入到 --ci-color-* 变量。
// 注入的动态色会覆盖 light/dark 主题的默认色，但保留 ClassIntra Token 命名。
//
// 主题加载流程：
//   1. theme-extension-loader 扫描 theme-extensions/material-you/manifest.json
//   2. 调用 apply.js 的 apply(engine, manifest) 注册主题
//   3. apply.js 合并 tokens.js 静态值 + dynamic-color.js 动态值
//   4. 切换主题时 ThemeEngine 写入 --ci-* 变量，组件自动跟随

var TOKENS = {
  // 颜色：留空对象，由 dynamic-color.js 在运行时填充
  // 此处仅声明结构，便于文档化与 ThemeEngine 读取
  color: {
    // 以下字段全部由 dynamic-color.js 注入，此处仅作为占位说明
    // primary, primaryHover, primaryPressed, primaryRgb, primaryLight, primaryLighter
    // semantic: { success, warning, danger, info, ... }
    // bg: { base, card, elevated, glass }
    // text: { primary, secondary, tertiary }
    // border: { default, separator }
    // glass: { dock, nav, navBorder, island, islandText, sidebar, bg, border }
    // onWallpaper: { text, shadow, dot, dotActive }
  },

  // 形状：M3 风格更大圆角，比 iOS 默认梯度 +4px
  // 重要：M3 强调"圆润有机"的形态语言
  shape: {
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '20px',
    xl: '24px',
    '2xl': '28px',
    '3xl': '32px',
    pill: '9999px'
  },

  // 阴影：M3 风格更柔和（比 iOS 弱一些）
  // 配合更大圆角，营造"漂浮感"
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.08)',
    md: '0 2px 6px rgba(0,0,0,0.10)',
    lg: '0 8px 24px rgba(0,0,0,0.12)',
    xl: '0 16px 48px rgba(0,0,0,0.14)'
  },

  // 动效：M3 标准缓动曲线
  // 注：M3 emphasized = cubic-bezier(0.3, 0, 0, 1)（比 iOS 的 0.32,0.72,0,1 略柔和）
  motion: {
    easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
    easeDecelerate: 'cubic-bezier(0, 0, 0, 1)',
    easeAccelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    easeEmphasized: 'cubic-bezier(0.3, 0, 0, 1)',
    durationFast: '0.15s',
    durationNormal: '0.3s',
    durationSlow: '0.45s'
  }
};

export { TOKENS };
export default TOKENS;
