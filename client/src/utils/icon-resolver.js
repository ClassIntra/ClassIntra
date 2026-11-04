// 主题图标解析器（架构预留）
// 当前阶段：直接返回 app.icon，保持现状
// 未来：根据 settings.themeId，从主题包内查找替换图标
//
// 设计目的：
//   - 让 AppIcon.vue 不直接依赖 app.icon 字段
//   - 引入抽象层，未来切换主题时可在此处返回主题包内对应图标
//   - 当前为零行为变更，纯架构层
//
// 2026-11-02 性能：官方桌面图标原图 180×180（3x），DPR≤2 的设备改取
// 预生成的 120px 变体（Resources/public/icons/120/）——60 CSS px × 2 = 120，
// 逐像素等价，首屏图标体积从 515KB 降到 202KB（慢网启动快 ~1s）。

import store from '@/store';

var THUMB_DIR = '/resources/public/icons/120/';
var OFFICIAL_ICON_RE = /^\/resources\/public\/icons\/([^/?]+\.png)(\?[^#]*)?$/i;

function currentDpr() {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

// 解析单个图标路径（桌面官方 PNG 按 DPR 选尺寸，其它路径原样返回）
export function resolveIconPath(path) {
  if (!path || typeof path !== 'string') return path;
  var m = OFFICIAL_ICON_RE.exec(path);
  if (!m) return path;
  if (currentDpr() > 2) return path;  // 3x 屏用原图，保持清晰度
  return THUMB_DIR + m[1] + (m[2] || '');
}

// 解析应用图标路径
// app: APP_REGISTRY 中的应用对象，含 icon 字段
// 返回：图标 URL 字符串
export function resolveAppIcon(app) {
  if (!app || !app.icon) return '';
  return resolveIconPath(app.icon);
}

// 预留：批量预加载主题图标（未来实现）
export function preloadThemeIcons(themeId) {
  // 阶段2：根据主题预加载图标到缓存
  return Promise.resolve();
}
