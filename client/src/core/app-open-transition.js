// 前端核心：应用打开/关闭过渡（安卓容器变换式）
// ============================================================
// 从桌面图标位置"展开"成整个应用页面，返回桌面时反向"收缩"回图标位置
//（Material Design 的 container transform 在本系统的实现）。
//
// 机制（全程合成层，Chrome 80 平板流畅）：
//   1. 图标点击时 captureOrigin(el) 记录图标视口 rect
//   2. 路由切换，App.vue 按「桌面 → 应用 / 应用 → 桌面」选择过渡名
//   3. before-enter 把页面容器以 transform 定到图标 rect（translate+scale），
//      CSS 过渡回到自然态（全屏）——enter 完成
//   4. 返回桌面：leave 钩子把页面容器 transform 收缩回同一 rect + 淡出
//
// 降级（保平板流畅是第一优先级）：
//   - prefers-reduced-motion → 不播（普通 fade）
//   - perf-policy 档位为 low（低端设备/省电模式）→ 不播
//   - 无图标 rect（深链/文件夹内打开/刷新进入）→ 不播
//   - 根元素有 position:fixed 的页面注意：transform 期间会改变 fixed 的包含块，
//     动画结束即清除 style，影响仅在 ~300ms 动画窗口内
//
// 编码约定：var / function / 单引号（Chrome 80 基线）

import { getPerfPolicy } from '@/core/perf-policy';

var _pendingOrigin = null; // 本次打开的图标 rect（enter 时消费）
var _lastOrigin = null;    // 最近一次打开的图标 rect（返回收缩用）
var _lastAppRoute = '';    // 记录展开的应用路由（收缩时仍对应才播）

function captureOrigin(el) {
  if (!el || !el.getBoundingClientRect) return;
  try {
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return; // 不可见/异常元素不作为起点
    _pendingOrigin = { x: r.left, y: r.top, w: r.width, h: r.height };
  } catch (e) {}
}

function consumeOrigin(routePath) {
  var o = _pendingOrigin;
  _pendingOrigin = null;
  if (o) {
    _lastOrigin = o;
    _lastAppRoute = routePath || '';
  }
  return o;
}

function hasPendingOrigin() { return !!_pendingOrigin; }

// 返回收缩：目标应用与最近展开的一致才播（桌面布局可能已变，rect 失配则 fade）
function canCollapse(routePath) {
  return !!_lastOrigin && _lastAppRoute === (routePath || '');
}

function getLastOrigin() { return _lastOrigin; }

function clearLast() {
  _lastOrigin = null;
  _lastAppRoute = '';
}

// 是否允许播放（用户偏好 + 性能档位）
function enabled() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch (e) {}
  try {
    if (getPerfPolicy().getLevel() === 'low') return false;
  } catch (e) {}
  return true;
}

export {
  captureOrigin,
  consumeOrigin,
  hasPendingOrigin,
  canCollapse,
  getLastOrigin,
  clearLast,
  enabled
};

// 聚合默认导出（消费方按命名空间使用：appOpenTransition.captureOrigin(...)）
export default {
  captureOrigin: captureOrigin,
  consumeOrigin: consumeOrigin,
  hasPendingOrigin: hasPendingOrigin,
  canCollapse: canCollapse,
  getLastOrigin: getLastOrigin,
  clearLast: clearLast,
  enabled: enabled
};
