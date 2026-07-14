// Light 主题 Token 定义
// 值与 client/src/styles/global.scss :root 保持同步
// 仅提取主题相关 token（color/shadow/motion），不提取静态变量（font/spacing/z/radius）

var TOKENS = {
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

export { TOKENS };
export default TOKENS;
