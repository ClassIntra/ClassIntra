// 存储兼容层（软破 WebView / 隐私模式）
//
// 背景：软破环境的 WebView 里 window.localStorage 为 null，对 null 调 .getItem()
// 会抛 "Cannot read property 'getItem' of null"，使 Vue 初始化失败、页面白屏。
//
// 为什么必须是「入口第一个 import」的独立模块：
//   部分模块在**导入期**（模块顶层）就访问存储，例如 store/modules/auth.js 的
//   state 初始化 `localStorage.getItem('token')`。而 ES 模块的 import 先于入口文件
//   正文执行 —— 若把兼容层写在入口正文（如原有 polyfill IIFE）里，就赶不上这些
//   导入期访问，模块导入即抛错、页面在 shim 生效前就崩了。
//   因此兼容层放在此独立模块中，由入口首个 import 引入，确保最先求值安装。
//
// 体验为先：原生存储正常可用时完全不动它，保持原有持久化能力；仅当缺失或不可写
// （隐私模式 / 配额受限）时才安装内存降级实现。

function _createMemoryStorage() {
  var data = {};
  var api = {
    getItem: function(k) {
      k = String(k);
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem: function(k, v) { data[String(k)] = String(v); },
    removeItem: function(k) { delete data[String(k)]; },
    clear: function() { data = {}; },
    key: function(i) {
      var keys = Object.keys(data);
      return (i >= 0 && i < keys.length) ? keys[i] : null;
    }
  };
  try {
    Object.defineProperty(api, 'length', {
      get: function() { return Object.keys(data).length; }
    });
  } catch (e) { api.length = 0; }
  return api;
}

function _ensureStorage(name) {
  var native = null;
  try { native = window[name]; } catch (e) { native = null; }

  // 原生存储存在且可读写 → 保持不动（正常使用，体验优先）
  if (native) {
    try {
      var probeKey = '__ci_storage_probe__';
      native.setItem(probeKey, '1');
      native.removeItem(probeKey);
      return;
    } catch (e) {
      // 存在但不可写（隐私模式 / 配额受限）→ 继续安装内存降级
    }
  }

  var fallback = _createMemoryStorage();
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: fallback
    });
  } catch (e) {
    try { window[name] = fallback; } catch (e2) {}
  }
}

if (typeof window !== 'undefined') {
  _ensureStorage('localStorage');
  _ensureStorage('sessionStorage');
}
