// 共享层：主题 Token 定义
// 参考 Ditto packages/theme/src/tokens.ts，适配 ClassIntra 的 JS + Chrome 80 约束
//
// 设计要点：
// 1. 只提取主题相关 token（color/shadow/motion），不提取静态变量（font/spacing/z/radius）
// 2. LIGHT_TOKENS / DARK_TOKENS 与 global.scss 中 :root / [data-theme="dark"] 的值保持同步
// 3. 新 --ci-* 变量与旧变量（--primary-color 等）短期双写，新代码用 --ci-*，旧代码继续用旧变量
// 4. 主题包加载（loadExternalTheme）预留入口，本期不实现

// ========== Light 主题 Token ==========
// 值与 global.scss :root 保持一致
var LIGHT_TOKENS = {
  color: {
    primary: '#007AFF',
    primaryHover: '#0066CC',
    primaryPressed: '#004E99',
    primaryRgb: '0, 122, 255',
    primaryLight: 'rgba(0, 122, 255, 0.12)',
    primaryLighter: 'rgba(0, 122, 255, 0.06)',
    accent: {
      music: '#FF2D55',
      weather: '#4A90D9',
      community: '#FF9500',
      chat: '#34C759',
      notes: '#FFCC00',
      resource: '#5856D6',
      settings: '#8E8E93',
      ai: '#AF52DE',
      aiRgb: '175, 82, 222'
    },
    semantic: {
      success: '#34C759',
      successRgb: '52, 199, 89',
      warning: '#FF9500',
      warningRgb: '255, 149, 0',
      danger: '#FF3B30',
      dangerRgb: '255, 59, 48',
      dangerPressed: '#D70015',
      info: '#5AC8FA'
    },
    bg: {
      base: '#F2F2F7',
      card: '#FFFFFF',
      elevated: 'rgba(255, 255, 255, 0.72)',
      glass: 'rgba(255, 255, 255, 0.65)'
    },
    text: {
      primary: 'rgba(0, 0, 0, 0.90)',
      secondary: 'rgba(60, 60, 67, 0.60)',
      tertiary: 'rgba(60, 60, 67, 0.30)'
    },
    border: {
      default: 'rgba(60, 60, 67, 0.12)',
      separator: 'rgba(60, 60, 67, 0.29)'
    },
    glass: {
      dock: 'rgba(255, 255, 255, 0.65)',
      nav: 'rgba(249, 249, 249, 0.70)',
      navBorder: 'rgba(60, 60, 67, 0.12)',
      island: 'rgba(28, 28, 30, 0.72)',
      islandText: '#FFFFFF',
      sidebar: 'rgba(242, 242, 247, 0.60)',
      bg: 'rgba(255, 255, 255, 0.55)',
      border: 'rgba(255, 255, 255, 0.18)'
    },
    onWallpaper: {
      text: '#FFFFFF',
      shadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
      dot: 'rgba(255, 255, 255, 0.4)',
      dotActive: '#FFFFFF'
    }
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    md: '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
    lg: '0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
    xl: '0 24px 80px rgba(0,0,0,0.16)'
  },
  motion: {
    easeStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    easeDecelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    easeAccelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    durationFast: '0.15s',
    durationNormal: '0.25s',
    durationSlow: '0.35s'
  }
};

// ========== Dark 主题 Token ==========
// 值与 global.scss [data-theme="dark"] 保持一致
var DARK_TOKENS = {
  color: {
    primary: '#0A84FF',
    primaryHover: '#409CFF',
    primaryPressed: '#0066CC',
    primaryRgb: '10, 132, 255',
    primaryLight: 'rgba(10, 132, 255, 0.16)',
    primaryLighter: 'rgba(10, 132, 255, 0.08)',
    accent: {
      music: '#FF2D55',
      weather: '#4A90D9',
      community: '#FF9500',
      chat: '#34C759',
      notes: '#FFCC00',
      resource: '#5856D6',
      settings: '#8E8E93',
      ai: '#AF52DE',
      aiRgb: '175, 82, 222'
    },
    semantic: {
      success: '#34C759',
      successRgb: '52, 199, 89',
      warning: '#FF9500',
      warningRgb: '255, 149, 0',
      danger: '#FF3B30',
      dangerRgb: '255, 59, 48',
      dangerPressed: '#D70015',
      info: '#5AC8FA'
    },
    bg: {
      base: '#000000',
      card: '#1C1C1E',
      elevated: 'rgba(28, 28, 30, 0.72)',
      glass: 'rgba(28, 28, 30, 0.65)'
    },
    text: {
      primary: 'rgba(235, 235, 245, 0.95)',
      secondary: 'rgba(235, 235, 245, 0.60)',
      tertiary: 'rgba(235, 235, 245, 0.30)'
    },
    border: {
      default: 'rgba(84, 84, 88, 0.65)',
      separator: 'rgba(84, 84, 88, 0.65)'
    },
    glass: {
      dock: 'rgba(28, 28, 30, 0.65)',
      nav: 'rgba(20, 20, 22, 0.70)',
      navBorder: 'rgba(84, 84, 88, 0.65)',
      island: 'rgba(18, 18, 20, 0.75)',
      islandText: '#FFFFFF',
      sidebar: 'rgba(18, 18, 20, 0.60)',
      bg: 'rgba(28, 28, 30, 0.55)',
      border: 'rgba(255, 255, 255, 0.08)'
    },
    onWallpaper: {
      text: '#FFFFFF',
      shadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
      dot: 'rgba(255, 255, 255, 0.4)',
      dotActive: '#FFFFFF'
    }
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.3)',
    md: '0 4px 12px rgba(0,0,0,0.3)',
    lg: '0 12px 40px rgba(0,0,0,0.4)',
    xl: '0 24px 80px rgba(0,0,0,0.5)'
  },
  motion: {
    easeStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    easeDecelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    easeAccelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    durationFast: '0.15s',
    durationNormal: '0.25s',
    durationSlow: '0.35s'
  }
};

export {
  LIGHT_TOKENS,
  DARK_TOKENS
};
