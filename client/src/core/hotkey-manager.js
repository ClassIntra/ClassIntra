// 前端核心：HotkeyManager 快捷键管理器
// 参考 Ditto packages/services/src/hotkey/
//
// 设计要点：
// 1. capture 阶段监听，确保在 target 元素之前拦截
// 2. combo normalize：'Ctrl+K' / 'ctrl+k' / 'Control+K' 统一为 'ctrl+k'
// 3. 输入框过滤：默认在 input/textarea/contenteditable 中不触发（除非声明 global: true）
// 4. 倒序匹配：后注册的优先级高（允许覆盖）
// 5. register 返回取消注册函数
// 6. 单例模式 getHotkeyManager()

// 组合键规范化：转为小写 + 排序修饰键 + '+' 连接
// 支持 ctrl/cmd/meta/alt/shift + 字母/数字/特殊键
function _normalizeCombo(combo) {
  if (!combo || typeof combo !== 'string') return '';
  var parts = combo.toLowerCase().split('+');
  var mods = [];
  var main = '';
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p === 'ctrl' || p === 'control') {
      mods.push('ctrl');
    } else if (p === 'cmd' || p === 'meta' || p === 'command') {
      mods.push('meta');
    } else if (p === 'alt' || p === 'option') {
      mods.push('alt');
    } else if (p === 'shift') {
      mods.push('shift');
    } else if (p) {
      main = p;
    }
  }
  mods.sort();
  var result = mods.join('+');
  if (main) {
    result = result ? result + '+' + main : main;
  }
  return result;
}

// 从 KeyboardEvent 提取 combo 字符串
function _eventToCombo(e) {
  var mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.metaKey) mods.push('meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  mods.sort();
  // key 优先于 keycode（key 已是小写）
  var main = e.key || '';
  // 忽略修饰键本身（单独按 Ctrl 不算快捷键）
  if (main === 'Control' || main === 'Shift' || main === 'Alt' || main === 'Meta') {
    return '';
  }
  main = main.toLowerCase();
  // 规范化特殊键名
  if (main === 'escape') main = 'esc';
  if (main === 'delete') main = 'del';
  if (main === ' ') main = 'space';
  if (main === 'arrowup') main = 'up';
  if (main === 'arrowdown') main = 'down';
  if (main === 'arrowleft') main = 'left';
  if (main === 'arrowright') main = 'right';
  var result = mods.join('+');
  if (main) {
    result = result ? result + '+' + main : main;
  }
  return result;
}

// 判断事件目标是否在输入框中
function _isInInput(target) {
  if (!target) return false;
  var tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) return true;
  return false;
}

function HotkeyManager() {
  this._bindings = []; // [{ id, combo, description, handler, global }]
  this._installed = false;
  this._onKeyDown = null;
}

// 安装全局 keydown 监听器（capture 阶段）
HotkeyManager.prototype.install = function() {
  if (this._installed) return;
  var self = this;
  this._onKeyDown = function(e) {
    self._handleKeyDown(e);
  };
  // capture: true 确保在 target 之前拦截
  window.addEventListener('keydown', this._onKeyDown, true);
  this._installed = true;
};

// 卸载监听器
HotkeyManager.prototype.uninstall = function() {
  if (!this._installed || !this._onKeyDown) return;
  window.removeEventListener('keydown', this._onKeyDown, true);
  this._onKeyDown = null;
  this._installed = false;
};

// 注册快捷键
// binding: { id, combo, description, handler, global? }
//   - id: 唯一标识（用于去重和取消）
//   - combo: 'Ctrl+K' / 'alt+s' 等
//   - description: 描述（供 UI 展示）
//   - handler: function(e) {}
//   - global: 是否在输入框中也触发（默认 false）
// 返回取消注册函数
HotkeyManager.prototype.register = function(binding) {
  if (!binding || !binding.combo || typeof binding.handler !== 'function') {
    return function() {};
  }
  var normalized = _normalizeCombo(binding.combo);
  if (!normalized) return function() {};

  var entry = {
    id: binding.id || ('hk_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
    combo: normalized,
    description: binding.description || '',
    handler: binding.handler,
    global: binding.global === true
  };
  this._bindings.push(entry);

  var self = this;
  return function() {
    var idx = self._bindings.indexOf(entry);
    if (idx !== -1) self._bindings.splice(idx, 1);
  };
};

// 内部：keydown 事件处理
HotkeyManager.prototype._handleKeyDown = function(e) {
  var combo = _eventToCombo(e);
  if (!combo) return;

  // 倒序遍历（后注册的优先级高）
  // 复制数组，防止 handler 内部 register/unregister 修改原数组
  var snapshot = this._bindings.slice();
  for (var i = snapshot.length - 1; i >= 0; i--) {
    var b = snapshot[i];
    if (b.combo !== combo) continue;

    // 输入框过滤：非 global 的绑定在输入框中不触发
    if (!b.global && _isInInput(e.target)) continue;

    // 拦截默认行为
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    try {
      b.handler(e);
    } catch (err) {
      try { console.error('[HotkeyManager] handler error for combo "' + b.combo + '":', err); } catch (_) {}
    }
    // 匹配到第一个（倒序中最后的注册）即停止
    return;
  }
};

// 获取所有已注册的快捷键（供 UI 展示）
HotkeyManager.prototype.list = function() {
  return this._bindings.map(function(b) {
    return {
      id: b.id,
      combo: b.combo,
      description: b.description,
      global: b.global
    };
  });
};

// 取消所有注册（保留 install 状态）
HotkeyManager.prototype.clear = function() {
  this._bindings = [];
};

// ========== 单例 ==========
var _instance = null;
function getHotkeyManager() {
  if (!_instance) {
    _instance = new HotkeyManager();
    _instance.install();
  }
  return _instance;
}

export {
  HotkeyManager,
  getHotkeyManager
};
