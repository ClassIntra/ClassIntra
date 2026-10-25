// 个人主页装扮（Profile Skin）运行时接口
// ============================================================
// 定位：把「个人主页长什么样」从组件里彻底解耦出来，供后续装扮系统直接调用。
//
// 三层关系（改任何一层前先读这段）：
//   1. **输入层** `--ci-profile-*` —— 谁都能写，自己不定义默认值：
//        · 扩展主题 manifest 的 `profile` 段（schema 校验 → apply.js 透传到 tokens.profile
//          → flattenTokens 落成同名变量，切换主题时随 --ci-* 一起清除）
//        · 本模块（装扮包 / 用户选择）
//        · 未来的管理端下发（同一条通路，写 inline style 即可）
//   2. **消费层** `--pf-*` —— 定义在 global.scss 的 :root，是输入层的别名 + 默认回退。
//        Profile.vue 只认这一层，所以「没人装扮」和「装扮了」走的是同一套选择器。
//   3. **令牌清单** 由 @shared/theme-extension-schema 的 PROFILE_TOKENS 唯一决定，
//        schema 校验与这里共用同一个 sanitize，不会出现「一边放行一边拦」。
//
// ⚠️ 主题切换会清掉 html 上所有 `--ci-*`（theme-adapter 的 removeFromElement），
//    装扮变量也在其中 → 这里订阅主题变化后自动重写，否则「换个深色，装扮就没了」。
//
// 用法：
//   import profileSkin from '@/core/profile-skin';
//   profileSkin.apply('sakura');            // 应用预设并持久化（全局，写 documentElement）
//   profileSkin.apply({ accent: '#7C4DFF' });// 自定义（键非法会被丢弃并返回 warnings）
//   profileSkin.preview({ accent: '#000' }); // 试穿：不落盘，可 cancelPreview() 还原
//   profileSkin.clear();                     // 恢复默认
//   var off = profileSkin.subscribe(fn);     // 订阅（返回取消函数）
//
// 两种作用域，别混用：
//   · **设备级**（apply/clear）写 documentElement —— 适合"我喜欢把主页显示成什么颜色"；
//   · **元素级**（toStyle → 绑到 .profile-page 的 :style，或 applyTo(el, skin)）——
//     适合「看谁的主页就显示谁的装扮」（QQ 那种社交装扮语义）。
//     元素级要生效，容器必须带 global.scss 的 `.ci-skin-scope`（否则 :root 上算好的
//     --pf-* 已经定死，子元素再改输入层不会重算）。

import { PROFILE_TOKENS, sanitizeProfileTokens } from '@shared/theme-extension-schema';
import { getThemeEngine } from '@/core/theme-engine';

var STORAGE_KEY = 'ci:profile-skin';
var VAR_PREFIX = '--ci-profile-';

// 令牌说明：给未来的「装扮编辑器」直接渲染表单用（键 → 控件类型 / 说明 / 默认回退）
// 顺序即 UI 建议顺序；fallback 只是文档，真正回退由 global.scss 的 --pf-* 负责。
var TOKEN_SPEC = [
  { key: 'accent', label: '主色', type: 'color', fallback: '--primary-color',
    hint: '按钮、tab 下划线、筛选 chip、复制按钮' },
  { key: 'surface', label: '衬底', type: 'color', fallback: '--primary-lighter',
    hint: '统计项悬停底、徽章底色（建议带透明度）' },
  { key: 'card-bg', label: '卡片底色', type: 'color', fallback: '--surface-elevated',
    hint: '卡片与头像底盘' },
  { key: 'hairline', label: '描边', type: 'color', fallback: '--separator-color',
    hint: '统计区上下发丝线、卡片描边' },
  { key: 'radius', label: '卡片圆角', type: 'length', fallback: '--radius-lg',
    hint: '如 16px / var(--radius-xl)' },
  { key: 'radius-sm', label: '控件圆角', type: 'length', fallback: '--radius-md',
    hint: '筛选 chip、小按钮' },
  { key: 'avatar', label: '头像尺寸', type: 'length', fallback: '96px',
    hint: '主页大头像直径，下限 56px' },
  { key: 'cover-overlay', label: '封面蒙版', type: 'image', fallback: 'transparent',
    hint: '叠在封面上的一层，可放渐变/条纹（如 linear-gradient(...)）' }
];

// 内置预设：只用「主色 + 衬底 + 描边」三个键，且衬底/描边带透明度，
// 这样同一套预设在不改 card-bg 的前提下亮暗主题都成立（不会出现深色下一块白卡）。
var PRESETS = [
  { id: 'default', name: '默认', tokens: {} },
  { id: 'aurora', name: '极光', tokens: {
    accent: '#6D5CE7',
    surface: 'rgba(109, 92, 231, 0.10)',
    hairline: 'rgba(109, 92, 231, 0.22)'
  } },
  { id: 'sakura', name: '樱粉', tokens: {
    accent: '#E0557F',
    surface: 'rgba(224, 85, 127, 0.10)',
    hairline: 'rgba(224, 85, 127, 0.22)'
  } },
  { id: 'mint', name: '薄荷', tokens: {
    accent: '#0FA394',
    surface: 'rgba(15, 163, 148, 0.12)',
    hairline: 'rgba(15, 163, 148, 0.24)'
  } },
  { id: 'sunset', name: '落日', tokens: {
    accent: '#E9762B',
    surface: 'rgba(233, 118, 43, 0.12)',
    hairline: 'rgba(233, 118, 43, 0.24)'
  } }
];

// 当前生效（{ id, tokens }）；default = 空令牌
var _active = { id: 'default', tokens: {} };
// 试穿前的快照（preview 用）
var _previewBackup = null;
// 订阅者
var _subs = [];
// 主题变化钩子只挂一次
var _themeHooked = false;

function _root() {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function _findPreset(id) {
  for (var i = 0; i < PRESETS.length; i++) {
    if (PRESETS[i].id === id) return PRESETS[i];
  }
  return null;
}

// 把令牌写进 html 的 inline style；空对象等于全清
function _write(tokens) {
  var root = _root();
  if (!root || !root.style) return;
  for (var i = 0; i < PROFILE_TOKENS.length; i++) {
    var key = PROFILE_TOKENS[i];
    var val = tokens ? tokens[key] : null;
    if (val) {
      root.style.setProperty(VAR_PREFIX + key, val);
    } else {
      root.style.removeProperty(VAR_PREFIX + key);
    }
  }
}

function _notify(reason) {
  var snapshot = _subs.slice();
  for (var i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i]({ id: _active.id, tokens: Object.assign({}, _active.tokens), reason: reason });
    } catch (e) {
      try { console.warn('[profile-skin] subscriber error:', e); } catch (_) {}
    }
  }
}

// 主题切换会 removeFromElement 掉 html 上全部 --ci-*，装扮必须跟着重写。
// 订阅放在这里而不是 main.js：谁先用到装扮谁负责挂钩子，避免启动顺序耦合。
function _ensureThemeHook() {
  if (_themeHooked) return;
  _themeHooked = true;
  try {
    getThemeEngine().subscribe(function() {
      _write(_previewBackup ? _previewBackup.tokens : _active.tokens);
    });
  } catch (e) {
    // 主题引擎不可用时（单测 / 极简宿主）不挂也无妨：下次 apply 会重写
    _themeHooked = false;
  }
}

function _persist() {
  try {
    if (_active.id === 'default' && Object.keys(_active.tokens).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: _active.id,
        tokens: _active.tokens
      }));
    }
  } catch (e) { /* 隐私模式 / 配额满：降级为「本次会话有效」 */ }
}

// 应用装扮
// skin: 预设 id 字符串 | 令牌对象 { accent: '#...' }
// options: { persist: false } 不落盘（内部用；对外预览请用 preview）
// 返回 { id, tokens, warnings }
function apply(skin, options) {
  options = options || {};
  var id = 'custom';
  var raw;

  if (typeof skin === 'string') {
    var preset = _findPreset(skin);
    if (!preset) preset = _findPreset('default');
    id = preset.id;
    raw = preset.tokens;
  } else {
    raw = skin || {};
  }

  var result = sanitizeProfileTokens(raw);
  var tokens = result.tokens;

  // default 预设 = 清空；其它预设若被洗成空（理论上不会）也按 default 处理
  _active = { id: Object.keys(tokens).length === 0 ? 'default' : id, tokens: tokens };
  _previewBackup = null;
  _write(_active.tokens);
  _ensureThemeHook();
  if (options.persist !== false) _persist();
  _notify('apply');

  return {
    id: _active.id,
    tokens: Object.assign({}, _active.tokens),
    warnings: result.warnings
  };
}

// 试穿：不写 localStorage、不改 _active，可 cancelPreview() 还原到上次正式应用的装扮
function preview(skin) {
  var raw = skin;
  if (typeof skin === 'string') {
    var preset = _findPreset(skin);
    raw = preset ? preset.tokens : {};
  }
  var result = sanitizeProfileTokens(raw);
  if (!_previewBackup) _previewBackup = { id: _active.id, tokens: Object.assign({}, _active.tokens) };
  _write(result.tokens);
  _ensureThemeHook();
  return { tokens: Object.assign({}, result.tokens), warnings: result.warnings };
}

function cancelPreview() {
  if (!_previewBackup) return;
  _write(_previewBackup.tokens);
  _previewBackup = null;
}

// 恢复默认（等价 apply('default')，但语义更直白）
function clear() {
  return apply('default');
}

// 启动时恢复上次选择。main.js 的 services 阶段调用一次即可。
function restore() {
  _ensureThemeHook();
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') return null;

  // 存的是预设 id 时优先按 id 取（预设可能随着版本更新变好看，老选择自动跟进）
  if (saved.id && saved.id !== 'custom' && _findPreset(saved.id)) {
    return apply(saved.id, { persist: false });
  }
  if (saved.tokens && typeof saved.tokens === 'object') {
    return apply(saved.tokens, { persist: false });
  }
  return null;
}

function getActive() {
  return { id: _active.id, tokens: Object.assign({}, _active.tokens) };
}

function listPresets() {
  return PRESETS.map(function(p) {
    return { id: p.id, name: p.name, tokens: Object.assign({}, p.tokens) };
  });
}

function tokenSpec() {
  return TOKEN_SPEC.map(function(t) { return Object.assign({}, t); });
}

// 令牌 → 内联样式对象，给 Vue 的 :style 直接用（元素级装扮，不碰全局）
// 返回值与 apply 对齐：{ style, tokens, warnings }
function toStyle(skin) {
  var raw = skin;
  var presetId = 'custom';
  if (typeof skin === 'string') {
    var preset = _findPreset(skin);
    presetId = preset ? preset.id : 'default';
    raw = preset ? preset.tokens : {};
  }
  var result = sanitizeProfileTokens(raw);
  var style = {};
  Object.keys(result.tokens).forEach(function(k) {
    style[VAR_PREFIX + k] = result.tokens[k];
  });
  return { id: presetId, style: style, tokens: Object.assign({}, result.tokens), warnings: result.warnings };
}

// 把装扮写到指定元素（元素级；清掉该元素上没在本次令牌里的同族变量）
// el: DOM 元素（通常就是 .profile-page 的根节点）
function applyTo(el, skin) {
  var built = toStyle(skin);
  if (!el || !el.style) return built;
  for (var i = 0; i < PROFILE_TOKENS.length; i++) {
    var key = PROFILE_TOKENS[i];
    if (built.tokens[key]) {
      el.style.setProperty(VAR_PREFIX + key, built.tokens[key]);
    } else {
      el.style.removeProperty(VAR_PREFIX + key);
    }
  }
  return built;
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function() {};
  _subs.push(fn);
  return function() {
    var idx = _subs.indexOf(fn);
    if (idx !== -1) _subs.splice(idx, 1);
  };
}

var profileSkin = {
  STORAGE_KEY: STORAGE_KEY,
  VAR_PREFIX: VAR_PREFIX,
  TOKENS: PROFILE_TOKENS.slice(),
  apply: apply,
  preview: preview,
  cancelPreview: cancelPreview,
  clear: clear,
  restore: restore,
  getActive: getActive,
  listPresets: listPresets,
  tokenSpec: tokenSpec,
  toStyle: toStyle,
  applyTo: applyTo,
  subscribe: subscribe
};

export default profileSkin;
export {
  apply,
  preview,
  cancelPreview,
  clear,
  restore,
  getActive,
  listPresets,
  tokenSpec,
  toStyle,
  applyTo,
  subscribe
};
