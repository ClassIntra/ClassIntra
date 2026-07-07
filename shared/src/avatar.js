// 共享层：头像颜色预设
// 前后端均可使用，无环境依赖

var AVATAR_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30',
  '#5AC8FA', '#FF2D55', '#5856D6', '#00C7BE', '#FF6482'
];

var AVATAR_PRESETS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30',
  '#5AC8FA', '#FF2D55', '#5856D6', '#00C7BE', '#FF6482',
  '#8E8E93', '#636366', '#FFCC00', '#00D4FF', '#BF5AF2'
];

// 根据用户 ID 计算头像颜色（无 localStorage 版本，前后端通用）
function pickAvatarColor(userId) {
  if (!userId) return '#9E9E9E';
  var sum = 0;
  var str = String(userId);
  for (var i = 0; i < str.length; i++) { sum += str.charCodeAt(i); }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

// 安全获取字符串第一个"用户感知字符"（grapheme cluster）
// Intl.Segmenter 能正确处理：
//   - 基本多语言平面外的 emoji（如 😀 U+1F600，代理对）
//   - ZWJ 序列（如 👨‍👩‍👧‍👦 家庭 emoji）
//   - 肤色修饰符（如 👋🏻）
//   - 国旗 emoji（如 🇨🇳，区域指示符对）
//   - 数学粗体/斜体等特殊字符
// 降级方案：Array.from 至少能处理代理对（不支持 ZWJ 序列）
function getFirstGrapheme(str) {
  if (!str) return '?';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      var seg = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
      var first = seg.segment(str).containing(0);
      if (first && first.segment) return first.segment;
    } catch (e) {
      // Segmenter 不可用时降级
    }
  }
  // 降级：Array.from 正确处理代理对，但无法合并 ZWJ 序列
  var chars = Array.from(str);
  return chars[0] || '?';
}

export {
  AVATAR_COLORS,
  AVATAR_PRESETS,
  pickAvatarColor,
  getFirstGrapheme
};
