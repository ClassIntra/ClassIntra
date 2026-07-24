// 前端核心：ThemeEngine 主题引擎
// 参考 Ditto packages/theme/src/engine.ts，去掉四档动画（用户明确单档即可）
//
// 设计要点：
// 1. setTheme 通过 setAttribute('data-theme', id) 触发 CSS 切换（旧机制，向后兼容）
// 2. 额外写入 --ci-* 新变量（inline style），供新代码使用
// 3. 旧变量（--primary-color 等）继续由 :root 和 [data-theme="dark"] CSS 提供
// 4. subscribe 订阅主题变化，setMotionEnabled 控制动画开关
// 5. loadExternalTheme 加载远程主题包 JSON
// 6. 单例模式 getThemeEngine()
// 7. 内置主题从 themes/ 顶级目录动态加载（通过 theme-loader）
// 8. 扩展主题：通过 theme-extension-loader 扫描 theme-extensions/ 目录，
//    调用扩展包的 apply(engine, manifest) 注册到 _themes
// 9. 动态色注入：setDynamicColor(seedColor) 重新生成扩展主题的 color token，
//    如果当前主题是该扩展主题，则立即重新写入 --ci-color-* 变量

import { flattenTokens, applyToElement, removeFromElement } from '@shared/theme-adapter';
import { LIGHT_TOKENS } from '@shared/theme-tokens';
import { loadThemes } from './theme-loader';
import { getEventBus } from './event-bus';
import { EVENT_NAMES } from '@shared/constants';

function ThemeEngine() {
  this._currentTheme = null; // 当前主题 id
  this._themes = {}; // 已注册主题：{ id: { id, name, type, tokens, icons } }
  this._subscribers = []; // 主题变化订阅者
  this._motionEnabled = true; // 动画是否启用
  this._motionInitialized = false;
  // 扩展主题状态：{ extensionId: { seedColor, lightId, darkId, manifest, applyFn, buildTokensFn } }
  this._extensionState = {};
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

// 加载外部主题包
// url: 主题包 JSON URL（同源或 CORS 允许）
// options: { apply: boolean } apply=true 时加载后自动切换到该主题
// 主题包格式：{ id, name, type: 'light'|'dark', tokens, icons }
// 返回 Promise<themeId>
ThemeEngine.prototype.loadExternalTheme = function(url, options) {
  options = options || {};
  var self = this;
  if (!url || typeof url !== 'string') {
    return Promise.reject(new Error('loadExternalTheme: url 必填'));
  }
  // CLAUDE.md 约束：禁用缓存机制，所以 fetch 用 cache: 'no-store'
  return fetch(url, { cache: 'no-store' })
    .then(function(res) {
      if (!res.ok) {
        throw new Error('loadExternalTheme: HTTP ' + res.status + ' 加载 ' + url + ' 失败');
      }
      return res.json();
    })
    .then(function(themePack) {
      // 验证主题包格式
      if (!themePack || typeof themePack !== 'object') {
        throw new Error('loadExternalTheme: 主题包必须是 JSON 对象');
      }
      if (!themePack.id || typeof themePack.id !== 'string') {
        throw new Error('loadExternalTheme: 主题包缺少 id 字段');
      }
      if (!themePack.name || typeof themePack.name !== 'string') {
        throw new Error('loadExternalTheme: 主题包缺少 name 字段');
      }
      if (themePack.type !== 'light' && themePack.type !== 'dark') {
        throw new Error('loadExternalTheme: type 必须是 "light" 或 "dark"');
      }
      // 不允许覆盖内置主题（light/dark）
      if (themePack.id === 'light' || themePack.id === 'dark') {
        throw new Error('loadExternalTheme: 不允许覆盖内置主题 "' + themePack.id + '"');
      }
      // 注册主题
      self.registerTheme(themePack.id, {
        name: themePack.name,
        type: themePack.type,
        tokens: themePack.tokens || null,
        icons: themePack.icons || null
      });
      // 可选：自动切换到该主题
      if (options.apply) {
        self.setTheme(themePack.id);
      }
      return themePack.id;
    });
};

// ========== 扩展主题 API ==========

// 注册扩展主题状态
// 由扩展包 apply.js 在注册主题后调用，保存 buildTokens 函数和种子色
// extensionId: 扩展 id（如 'material-you'）
// state: { seedColor, lightId, darkId, manifest, buildTokens }
//   buildTokens: function(isDark, seedColor) → 结构化 tokens 对象
ThemeEngine.prototype.registerExtension = function(extensionId, state) {
  if (!extensionId || !state) return;
  this._extensionState[extensionId] = {
    seedColor: state.seedColor,
    lightId: state.lightId,
    darkId: state.darkId,
    manifest: state.manifest,
    buildTokens: typeof state.buildTokens === 'function' ? state.buildTokens : null
  };
};

// 获取扩展状态
ThemeEngine.prototype.getExtension = function(extensionId) {
  return this._extensionState[extensionId] || null;
};

// 列出所有已注册的扩展主题
ThemeEngine.prototype.listExtensions = function() {
  var self = this;
  return Object.keys(this._extensionState).map(function(id) {
    var s = self._extensionState[id];
    return {
      id: id,
      seedColor: s.seedColor,
      lightId: s.lightId,
      darkId: s.darkId,
      name: s.manifest ? s.manifest.name : id,
      type: s.manifest ? s.manifest.type : 'static',
      hasDynamicColor: !!s.buildTokens
    };
  });
};

// 设置扩展主题的种子色（动态色注入）
// extensionId: 扩展 id（如 'material-you'）
// seedColor: 新种子色（'#RRGGBB' 或 '#RGB'）
// 返回 boolean 是否成功
// 副作用：如果当前主题是该扩展的 light/dark 变体，立即重新写入 --ci-* 变量
ThemeEngine.prototype.setDynamicColor = function(extensionId, seedColor) {
  var state = this._extensionState[extensionId];
  if (!state || !state.buildTokens) {
    console.warn('[ThemeEngine] 扩展主题 "' + extensionId + '" 不存在或不支持动态色');
    return false;
  }
  if (!seedColor || typeof seedColor !== 'string' || !/^#([a-f\d]{6}|[a-f\d]{3})$/i.test(seedColor)) {
    console.warn('[ThemeEngine] 种子色 "' + seedColor + '" 不是合法 HEX');
    return false;
  }

  // 重算并更新 light/dark 主题的 tokens
  var newLightTokens = state.buildTokens(false, seedColor);
  var newDarkTokens = state.buildTokens(true, seedColor);

  // 更新已注册主题的 tokens
  if (this._themes[state.lightId]) {
    this._themes[state.lightId].tokens = newLightTokens;
  }
  if (this._themes[state.darkId]) {
    this._themes[state.darkId].tokens = newDarkTokens;
  }

  // 更新种子色记录
  state.seedColor = seedColor;

  // 如果当前主题是该扩展的变体，立即应用新 tokens
  if (this._currentTheme === state.lightId || this._currentTheme === state.darkId) {
    // 重新调用 setTheme 触发 --ci-* 变量重写
    this.setTheme(this._currentTheme);
  }

  // 通过 EventBus 广播动态色变化
  try {
    var bus = getEventBus();
    bus.emit('theme:dynamic-color-changed', {
      extensionId: extensionId,
      seedColor: seedColor
    });
  } catch (e) { /* EventBus 未初始化时忽略 */ }

  return true;
};

// 获取当前主题所属的扩展 id（如果不是扩展主题，返回 null）
ThemeEngine.prototype.getCurrentExtensionId = function() {
  var current = this._currentTheme;
  if (!current) return null;
  var self = this;
  var ids = Object.keys(this._extensionState);
  for (var i = 0; i < ids.length; i++) {
    var s = self._extensionState[ids[i]];
    if (s.lightId === current || s.darkId === current) {
      return ids[i];
    }
  }
  return null;
};

// 获取当前扩展主题的种子色（如果不是扩展主题，返回 null）
ThemeEngine.prototype.getCurrentSeedColor = function() {
  var extId = this.getCurrentExtensionId();
  if (!extId) return null;
  var state = this._extensionState[extId];
  return state ? state.seedColor : null;
};

// ========== 单例 ==========
var _instance = null;
function getThemeEngine() {
  if (!_instance) {
    _instance = new ThemeEngine();
    // 从 themes/ 顶级目录加载所有内置主题
    var themes = loadThemes();
    if (themes.length === 0) {
      // 兜底：theme-loader 未加载到任何主题时，使用 shared 重导出的内置 tokens
      _instance.registerTheme('light', {
        name: '默认浅色',
        type: 'light',
        tokens: LIGHT_TOKENS,
        icons: null
      });
    } else {
      for (var i = 0; i < themes.length; i++) {
        _instance.registerTheme(themes[i].id, {
          name: themes[i].name,
          type: themes[i].type,
          tokens: themes[i].tokens,
          icons: themes[i].icons
        });
      }
    }
  }
  return _instance;
}

// ========== 兼容 API（替代原 client/src/themes/index.js）==========
// 旧代码 import { THEME_REGISTRY, listThemes, getTheme } from '@/themes' 仍可正常使用
function _buildRegistry() {
  var engine = getThemeEngine();
  var themes = engine.listThemes();
  var registry = {};
  for (var i = 0; i < themes.length; i++) {
    registry[themes[i].id] = themes[i];
  }
  return registry;
}

// 在模块加载时构建一次快照（与旧 themes/index.js 行为一致）
// 注意：新主题注册后需调用 listThemes() 获取最新列表
var THEME_REGISTRY = _buildRegistry();

function listThemes() {
  return getThemeEngine().listThemes();
}

function getTheme(id) {
  var engine = getThemeEngine();
  var theme = engine.getTheme(id) || engine.getTheme('light');
  if (!theme) {
    // ThemeEngine 未初始化时的兜底
    return { id: 'light', name: '默认浅色', type: 'light', icons: null };
  }
  return { id: theme.id, name: theme.name, type: theme.type, icons: theme.icons };
}

// 加载所有扩展主题（延迟加载，避免与内置主题耦合）
// 应在 App.vue mounted 中调用一次，或由 Settings 页"启用扩展主题"按钮调用
// 返回 Promise<appliedIds[]>
function loadThemeExtensions(options) {
  // 动态 import 避免影响首屏（扩展主题是可选功能）
  return import('./theme-extension-loader').then(function(mod) {
    var loadExtensions = mod.loadExtensions;
    var engine = getThemeEngine();
    return loadExtensions(engine, options || {});
  });
}

export {
  ThemeEngine,
  getThemeEngine,
  THEME_REGISTRY,
  listThemes,
  getTheme,
  loadThemeExtensions
};
