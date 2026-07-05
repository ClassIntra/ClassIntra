// 前端核心：ThemeEngine 主题引擎
// 参考 Ditto packages/theme/src/engine.ts，去掉四档动画（用户明确单档即可）
//
// 设计要点：
// 1. setTheme 通过 setAttribute('data-theme', id) 触发 CSS 切换（旧机制，向后兼容）
// 2. 额外写入 --ci-* 新变量（inline style），供新代码使用
// 3. 旧变量（--primary-color 等）继续由 :root 和 [data-theme="dark"] CSS 提供
// 4. subscribe 订阅主题变化，setMotionEnabled 控制动画开关
// 5. loadExternalTheme 预留主题包加载入口（本期不实现）
// 6. 单例模式 getThemeEngine()

import { flattenTokens, applyToElement, removeFromElement } from '@shared/theme-adapter';
import { LIGHT_TOKENS, DARK_TOKENS } from '@shared/theme-tokens';
import { getEventBus } from './event-bus';
import { EVENT_NAMES } from '@shared/constants';

function ThemeEngine() {
  this._currentTheme = null; // 当前主题 id
  this._themes = {}; // 已注册主题：{ id: { id, name, type, tokens, icons } }
  this._subscribers = []; // 主题变化订阅者
  this._motionEnabled = true; // 动画是否启用
  this._motionInitialized = false;
}

// 注册主题
// id: 主题 id（如 'light'、'dark'）
// options: { name, type: 'light'|'dark', tokens, icons }
ThemeEngine.prototype.registerTheme = function(id, options) {
  if (!id) return;
  this._themes[id] = {
    id: id,
    name: (options && options.name) || id,
    type: (options && options.type) || 'light',
    tokens: (options && options.tokens) || null,
    icons: (options && options.icons) || null
  };
};

// 设置当前主题
// id: 主题 id
// 1. 触发 CSS 切换（setAttribute('data-theme', id)）
// 2. 写入 --ci-* 新变量
// 3. 通知订阅者
ThemeEngine.prototype.setTheme = function(id) {
  var theme = this._themes[id];
  if (!theme) {
    // 未知主题，回退到 light
    theme = this._themes['light'] || { id: 'light', type: 'light', tokens: LIGHT_TOKENS };
    id = 'light';
  }
  var previousTheme = this._currentTheme;
  this._currentTheme = id;

  // 1. 触发 CSS 切换（旧机制）
  var root = document.documentElement;
  if (id === 'light') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', id);
  }

  // 2. 写入 --ci-* 新变量
  if (theme.tokens) {
    var flatMap = flattenTokens(theme.tokens);
    // 先清除旧的 --ci-* 变量，再写入新的
    removeFromElement(root);
    applyToElement(root, flatMap);
  }

  // 3. 通知订阅者
  var payload = {
    id: id,
    previous: previousTheme,
    type: theme.type,
    icons: theme.icons
  };
  var snapshot = this._subscribers.slice();
  for (var i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i](payload);
    } catch (e) {
      try { console.error('[ThemeEngine] subscriber error:', e); } catch (_) {}
    }
  }

  // 4. 通过 EventBus 广播（供非直接订阅者监听）
  try {
    var bus = getEventBus();
    bus.emit(EVENT_NAMES.THEME_CHANGED, payload);
  } catch (e) { /* EventBus 未初始化时忽略 */ }
};

// 切换 light/dark
ThemeEngine.prototype.toggleColorScheme = function() {
  var current = this._currentTheme || 'light';
  var next = current === 'light' ? 'dark' : 'light';
  this.setTheme(next);
  return next;
};

// 订阅主题变化
// callback: function(payload) { payload: { id, previous, type, icons } }
// 返回取消订阅函数
ThemeEngine.prototype.subscribe = function(callback) {
  if (typeof callback !== 'function') return function() {};
  this._subscribers.push(callback);
  var self = this;
  return function() {
    var idx = self._subscribers.indexOf(callback);
    if (idx !== -1) self._subscribers.splice(idx, 1);
  };
};

// 启用/禁用动画
// enabled: true 启用 / false 禁用
// 禁用时设置 [data-no-motion="true"]，由 _motion.scss 全局规则关闭动画
ThemeEngine.prototype.setMotionEnabled = function(enabled) {
  this._motionEnabled = !!enabled;
  var root = document.documentElement;
  if (this._motionEnabled) {
    root.removeAttribute('data-no-motion');
  } else {
    root.setAttribute('data-no-motion', 'true');
  }

  // 通过 EventBus 广播
  try {
    var bus = getEventBus();
    bus.emit(EVENT_NAMES.THEME_MOTION_TOGGLED, { enabled: this._motionEnabled });
  } catch (e) { /* EventBus 未初始化时忽略 */ }

  // 持久化到 localStorage
  try {
    if (this._motionEnabled) {
      localStorage.removeItem('ci_motion_disabled');
    } else {
      localStorage.setItem('ci_motion_disabled', '1');
    }
  } catch (e) { /* localStorage 不可用时忽略 */ }
};

// 查询动画是否启用
ThemeEngine.prototype.isMotionEnabled = function() {
  return this._motionEnabled;
};

// 初始化动画开关（从 localStorage 读取 + 检测无障碍偏好）
// 应在 App.vue mounted 中调用一次
ThemeEngine.prototype.initMotion = function() {
  if (this._motionInitialized) return;
  this._motionInitialized = true;

  // 优先级：localStorage > 无障碍偏好 > 默认启用
  var storedDisabled = false;
  try {
    storedDisabled = localStorage.getItem('ci_motion_disabled') === '1';
  } catch (e) {}

  if (storedDisabled) {
    this.setMotionEnabled(false);
    return;
  }

  // 检测系统无障碍偏好（prefers-reduced-motion）
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setMotionEnabled(false);
      return;
    }
  } catch (e) {}

  this._motionEnabled = true;
};

// 获取当前主题 id
ThemeEngine.prototype.getCurrentTheme = function() {
  return this._currentTheme || 'light';
};

// 获取当前主题类型（light/dark）
ThemeEngine.prototype.getCurrentThemeType = function() {
  var theme = this._themes[this._currentTheme];
  return theme ? theme.type : 'light';
};

// 列出所有已注册主题
ThemeEngine.prototype.listThemes = function() {
  var self = this;
  return Object.keys(this._themes).map(function(id) {
    var t = self._themes[id];
    return { id: t.id, name: t.name, type: t.type, icons: t.icons };
  });
};

// 获取主题定义
ThemeEngine.prototype.getTheme = function(id) {
  return this._themes[id] || null;
};

// 预留：加载外部主题包
// url: 主题包 URL
// 本期不实现，仅返回 rejected Promise
ThemeEngine.prototype.loadExternalTheme = function(url) {
  return Promise.reject(new Error('loadExternalTheme 尚未实现'));
};

// ========== 单例 ==========
var _instance = null;
function getThemeEngine() {
  if (!_instance) {
    _instance = new ThemeEngine();
    // 注册内置 light/dark 主题
    _instance.registerTheme('light', {
      name: '默认浅色',
      type: 'light',
      tokens: LIGHT_TOKENS,
      icons: null
    });
    _instance.registerTheme('dark', {
      name: '默认深色',
      type: 'dark',
      tokens: DARK_TOKENS,
      icons: null
    });
  }
  return _instance;
}

export {
  ThemeEngine,
  getThemeEngine
};
