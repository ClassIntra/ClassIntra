// Dark 主题 Token 定义
// 值与 client/src/styles/global.scss [data-theme="dark"] 保持同步
// 仅提取主题相关 token（color/shadow/motion），不提取静态变量（font/spacing/z/radius）

var TOKENS = {
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

export { TOKENS };
export default TOKENS;
