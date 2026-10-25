// 个人主页 / 社区「我的」共用的封面兜底
// ============================================================
// 没设封面时不该是一块灰色 —— 按 userId 哈希从固定配色里取一条**确定性**渐变：
// 同一个人在任何页面、任何时候都是同一个颜色，看起来像"设计过的默认值"而不是缺失。
//
// 之所以抽成工具：社区「我的」页和个人主页都要用。之前只写在 Profile.vue 的 computed 里，
// 复制一份到社区必然漂移（改配色时只改一处，两个页面就不一致）。

// 深 → 浅的三段式，保证叠在上面的白色文字/按钮都可读
var COVER_PALETTES = [
  'linear-gradient(135deg, #1D3F73 0%, #2E6FBF 48%, #63A4E8 100%)',
  'linear-gradient(135deg, #0E4F52 0%, #17868A 48%, #4FC3C6 100%)',
  'linear-gradient(135deg, #3B2A6B 0%, #6C4CB8 48%, #A88FE0 100%)',
  'linear-gradient(135deg, #6E2340 0%, #B24A6E 48%, #E39AB4 100%)',
  'linear-gradient(135deg, #6B3A1E 0%, #B96A38 48%, #E7A97A 100%)',
  'linear-gradient(135deg, #1E4032 0%, #2F6B51 48%, #6BAA8B 100%)',
  'linear-gradient(135deg, #232A33 0%, #3D4854 48%, #7A8896 100%)',
  'linear-gradient(135deg, #123A4A 0%, #1F6275 48%, #4E9BAE 100%)'
];

function coverGradient(userId) {
  var id = String(userId || '0');
  var h = 0;
  for (var i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 100000;
  }
  return COVER_PALETTES[h % COVER_PALETTES.length];
}

export { COVER_PALETTES, coverGradient };
