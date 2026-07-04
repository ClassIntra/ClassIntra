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

export {
  AVATAR_COLORS,
  AVATAR_PRESETS,
  pickAvatarColor
};
