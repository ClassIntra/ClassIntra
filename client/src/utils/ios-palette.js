/**
 * 全站统一的 iOS 色板
 *
 * 此前 Chat（群组哈希色）/ Community（标签色）/ Countdown（预设色）各持一份
 * 互不相同步的硬编码色板，现收敛为单一来源。取值与 global.scss 的
 * iOS 系统色（主色、accent 系、语义色）同族，保持全站观感一致。
 */

// 完整 15 色：哈希取色、标签着色等需要高区分度的场景
export var IOS_PALETTE = [
  '#007AFF', // 系统蓝
  '#34C759', // 系统绿
  '#FF9500', // 系统橙
  '#AF52DE', // 系统紫（accent-ai）
  '#FF3B30', // 系统红
  '#5AC8FA', // 浅蓝（info）
  '#FF2D55', // 粉红（accent-music）
  '#5856D6', // 靛蓝（accent-resource）
  '#00C7BE', // 青绿
  '#FF6482', // 浅粉
  '#8E8E93', // 系统灰
  '#FFCC00', // 系统黄（accent-notes）
  '#00D4FF', // 天青
  '#BF5AF2', // 亮紫
  '#636366'  // 深灰
];

// 精简 8 色：选项数量受限的预设选择器
export var IOS_PALETTE_SHORT = IOS_PALETTE.slice(0, 8);

// 字符串哈希 → 稳定取色（同一名称永远得到同一颜色）
export function hashColor(text) {
  var colors = IOS_PALETTE;
  var hash = 0;
  var str = String(text || '');
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length];
}

export default { IOS_PALETTE: IOS_PALETTE, IOS_PALETTE_SHORT: IOS_PALETTE_SHORT, hashColor: hashColor };
