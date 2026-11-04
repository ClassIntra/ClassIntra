// 前端核心：市场 SDK 工厂
// ============================================================
// 为第三方应用构造 context 对象。这是第三方应用的唯一编程接口。
//
// 命名空间（详见 docs/ecosystem-design.md §4 与公开 SDK 参考）：
//   context.ui      —— 预制 iOS DOM 片段（13 个）
//   context.data    —— 数据能力（api / realtime / storage）
//   context.system  —— 系统能力（user / theme / router / toast / modal / notify / clipboard / share）
//   context.device  —— 设备能力（info / filePicker / camera）
//   context.theme   —— 主题便捷层（current / getToken / subscribe）
//   context.app     —— 应用自身（name / version / manifest / config / log / onDestroy）
//   context.compat  —— 兼容探测（chromeVersion / isX5 / has）
//
// 关键设计：
//   - 能力按需：命名空间隔离，避免把所有内部对象暴露给第三方
//   - 契约优于约定：context.app.onDestroy 注册清理函数，卸载时自动调用
//   - 存储隔离：context.data.storage 强制 ci:app:<name>: 前缀
//   - 兼容探测：第三方可据此做降级分支（如 flex-gap 缺失）
//
// 编码约定：全文件使用 var / function / 单引号 / 2 空格缩进（Chrome 80 兼容基线）

import { ui, ensureStyles } from '@/core/market-sdk-ui';
import { getTokenInjector, collectTokens } from '@/core/token-injector';
import * as navbarStore from '@/core/app-navbar-store';

// ============================================================
// 一、版本与兼容探测（context.compat）
// ============================================================

// 解析当前 Chrome 主版本号
function detectChromeVersion() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 0;
  var ua = navigator.userAgent;
  var m = ua.match(/Chrome\/(\d+)/);
  if (m && m[1]) return parseInt(m[1], 10);
  // X5 内核标识
  m = ua.match(/MQQBrowser\/(\d+)/);
  if (m && m[1]) return parseInt(m[1], 10);
  return 0;
}

// 是否运行在腾讯 X5 / TBS 内核
function detectIsX5() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  var ua = navigator.userAgent;
  return /MQQBrowser|TBS|X5|TencentTraveler/i.test(ua);
}

// 探测能力支持
function detectCapability(name) {
  if (typeof document === 'undefined') return false;
  switch (name) {
    case 'flex-gap':
      // Chrome 84+ 原生支持 flex gap
      return detectChromeVersion() >= 84;
    case 'backdrop-filter':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('backdrop-filter', 'blur(1px)') : false);
    case 'webp':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('background-image', 'url("x.webp")') : false);
    case 'container-query':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('container-type', 'inline-size') : false);
    case 'clipboard':
      return typeof navigator !== 'undefined' && !!(navigator.clipboard);
    case 'resize-observer':
      return typeof ResizeObserver !== 'undefined';
    case 'intersection-observer':
      return typeof IntersectionObserver !== 'undefined';
    case 'passive-events':
      return true; // Chrome 51+ 支持，基线内
    case 'css-vars':
      return typeof CSS !== 'undefined' && CSS.supports && CSS.supports('--ci-test', '1');
    case 'local-storage':
      try {
        if (typeof localStorage === 'undefined') return false;
        localStorage.setItem('__ci_probe__', '1');
        localStorage.removeItem('__ci_probe__');
        return true;
      } catch (e) { return false; }
    default:
      return false;
  }
}

// ============================================================
// 二、存储命名空间（context.data.storage）
// ============================================================

// 创建带前缀的存储包装，强制隔离。
// 所有键会被自动加上 'ci:app:<appName>:' 前缀，避免与宿主或其他应用冲突。
function createNamespacedStorage(appName, auditor) {
  var prefix = 'ci:app:' + appName + ':';
  if (auditor && typeof auditor.noteStoragePrefix === 'function') {
    auditor.noteStoragePrefix(prefix);
  }

  function fullKey(key) {
    return prefix + String(key);
  }

  return {
    // 命名空间前缀（供诊断）
    prefix: prefix,
    get: function(key, fallback) {
      try {
        var raw = localStorage.getItem(fullKey(key));
        if (raw === null) return fallback === undefined ? null : fallback;
        try { return JSON.parse(raw); } catch (e) { return raw; }
      } catch (e) {
        return fallback === undefined ? null : fallback;
      }
    },
    set: function(key, value) {
      try {
        var raw = (typeof value === 'string') ? value : JSON.stringify(value);
        localStorage.setItem(fullKey(key), raw);
        return true;
      } catch (e) {
        // 配额溢出等
        return false;
      }
    },
    remove: function(key) {
      try { localStorage.removeItem(fullKey(key)); return true; } catch (e) { return false; }
    },
    keys: function() {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) {
            out.push(k.slice(prefix.length));
          }
        }
      } catch (e) {}
      return out;
    },
    clear: function() {
      var self = this;
      var ks = self.keys();
      ks.forEach(function(k) { self.remove(k); });
      return ks.length;
    }
  };
}

// ============================================================
// 三、系统扩展能力（通知 / 剪贴板 / 分享）与设备能力
// ============================================================
// 说明：这些是「真实现」，不是能力目录里的空声明。
// 全部走 Chrome 80 可用的 API，缺失时给出可预期的降级路径与中文错误，
// 让第三方按文档写就能跑，而不是拿到 undefined。

var _notifyAsked = false;

// 复用宿主全局 Toast（App.vue 的 toast 条）。返回是否成功。
function _showHostToast(d, message, type) {
  var text = String(message || '');
  if (!text) return false;
  try {
    if (d.store && typeof d.store.commit === 'function') {
      d.store.commit('toast/SHOW_TOAST', { message: text, type: type || 'info', duration: 3200 });
      return true;
    }
  } catch (e) {}
  return false;
}

// ============================================================
// 运行时权限（声明 + 用时授权）
// ============================================================
// 与 iOS / Android 的两段式一致：
//   1) manifest.capabilities 声明（安装页展示，班管决定装不装）
//   2) 首次真正调用敏感能力时弹一次授权，结果按 (应用, 用户) 记到服务端
//
// 为什么不交给浏览器原生权限：原生授权粒度是「站点」，不是「应用」。
// 同源下一个应用拿到相机，另一个应用就能静默用 —— 所以宿主必须自己记一份。

var PERMISSION_LABELS = {
  'device.camera': { title: '使用相机', desc: '拍摄照片或视频' },
  'device.microphone': { title: '使用麦克风', desc: '录制音频' },
  'system.notification': { title: '发送通知', desc: '在页面不可见时提醒你' },
  'system.clipboard.read': { title: '读取剪贴板', desc: '读取你复制的内容' }
};

// 本次导航带来的分享数据（manifest.shareTarget 接收侧）。
// ⚠️ 必须是模块级：一次进入应用可能创建多个 context（重新挂载/重建），
//    绑在 context 上会导致第二个 context 读不到，注册 onShare 也就永远收不到。
//    用时间戳限界：同一导航内注册的多个 handler 都能收到，5 秒后自然失效。
var sharedIncoming = null;

// 内存缓存（当前会话）：key = app + ':' + capability，值 true/false
var permissionCache = {};
// 并发去重：同一能力同时被调两次，只弹一个窗口
var permissionPending = {};

function _permKey(appName, capability) {
  return String(appName) + ':' + String(capability);
}

function _permLabel(capability) {
  var meta = PERMISSION_LABELS[capability];
  return meta ? meta.title : capability;
}

// 授权弹层：返回 Promise<boolean>。样式全部内联，不依赖应用 CSS。
function askPermissionDialog(d, appName, capability) {
  var meta = PERMISSION_LABELS[capability] || { title: capability, desc: '' };
  var appLabel = (d.manifest && (d.manifest.label || d.manifest.name)) || appName;

  return new Promise(function (resolve) {
    if (typeof document === 'undefined' || !document.body) {
      resolve(false);
      return;
    }

    var mask = document.createElement('div');
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:60000',
      'background:rgba(0,0,0,0.42)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'box-sizing:border-box',
      '-webkit-tap-highlight-color:transparent'
    ].join(';'));

    var card = document.createElement('div');
    card.setAttribute('style', [
      'width:100%', 'max-width:320px', 'box-sizing:border-box',
      'background:var(--card-bg, #FFFFFF)',
      'color:var(--text-primary, #111827)',
      'border-radius:var(--radius-lg, 18px)',
      'padding:22px 20px 16px',
      'box-shadow:0 18px 60px rgba(0,0,0,0.28)',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      'text-align:center'
    ].join(';'));

    var icon = document.createElement('div');
    icon.setAttribute('style', [
      'width:52px', 'height:52px', 'margin:0 auto 12px', 'border-radius:14px',
      'background:var(--primary-color, #0A84FF)', 'color:#fff',
      'display:flex', 'align-items:center', 'justify-content:center', 'font-size:24px'
    ].join(';'));
    icon.textContent = '🔒';

    var title = document.createElement('div');
    title.setAttribute('style', 'font-size:16px;font-weight:600;line-height:1.35;margin-bottom:8px;');
    title.textContent = '“' + appLabel + '” 想' + meta.title;

    var desc = document.createElement('div');
    desc.setAttribute('style', [
      'font-size:13px', 'line-height:1.5', 'opacity:0.72', 'margin-bottom:18px'
    ].join(';'));
    desc.textContent = (meta.desc ? meta.desc + '。' : '') + '允许一次后，本账号在这台设备上不再重复询问；班管可随时撤销。';

    var actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex;flex-direction:column;gap:8px;');

    function makeBtn(text, primary) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.setAttribute('style', [
        'width:100%', 'padding:12px', 'border:none', 'border-radius:12px',
        'font-size:15px', 'font-weight:600', 'cursor:pointer',
        'font-family:inherit',
        primary
          ? 'background:var(--primary-color, #0A84FF);color:#fff;'
          : 'background:var(--fill-secondary, rgba(120,120,128,0.14));color:var(--text-primary, #111827);'
      ].join(';'));
      return btn;
    }

    var allow = makeBtn('允许', true);
    var deny = makeBtn('不允许', false);

    function done(value) {
      try { if (mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
      resolve(value);
    }

    allow.onclick = function () { done(true); };
    deny.onclick = function () { done(false); };
    // 点遮罩 = 拒绝（与系统弹窗一致：不明说允许就不给）
    mask.onclick = function (e) {
      if (e && e.target === mask) done(false);
    };
    // 硬拦截返回键之外的 Esc（平板外接键盘场景）
    mask.addEventListener('keydown', function (e) {
      if (e && (e.key === 'Escape' || e.keyCode === 27)) done(false);
    });

    actions.appendChild(allow);
    actions.appendChild(deny);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    mask.appendChild(card);
    document.body.appendChild(mask);
    try { allow.focus(); } catch (e) {}
  });
}

// 把授权结果记到服务端（失败不阻断，本地照常放行——权限首先是体验，记账是管理需要）
function _grantRemote(d, appName, capability) {
  try {
    if (!d.api || typeof d.api.post !== 'function') return;
    d.api.post('/app-permissions/' + encodeURIComponent(appName), {
      capability: capability,
      granted: true
    }).catch(function () {});
  } catch (e) {}
}

/**
 * 确保已获得某项敏感能力。
 * @returns Promise<true>（已授权/刚授权）或 reject（用户拒绝）
 */
function ensurePermission(d, appName, capability, options) {
  var opts = options || {};
  var key = _permKey(appName, capability);

  if (!opts.force) {
    if (permissionCache[key] === true) return Promise.resolve(true);
    if (permissionCache[key] === false) {
      return Promise.reject(new Error('你已拒绝「' + _permLabel(capability) + '」权限，可在应用设置里重新开启'));
    }
  }
  if (permissionPending[key]) return permissionPending[key];

  // 先问服务端：换设备登录时，已授过的项不该再弹
  var remote;
  if (d.api && typeof d.api.get === 'function') {
    remote = d.api.get('/app-permissions/' + encodeURIComponent(appName)).then(function (res) {
      var data = (res && res.data && res.data.data) || {};
      var granted = Array.isArray(data.granted) ? data.granted : [];
      for (var i = 0; i < granted.length; i++) {
        permissionCache[_permKey(appName, granted[i])] = true;
      }
      return granted.indexOf(capability) !== -1;
    }).catch(function () {
      // 拉不到就按「没授过」处理：宁可多问一次，不可静默放行
      return permissionCache[key] === true;
    });
  } else {
    remote = Promise.resolve(permissionCache[key] === true);
  }

  var chain = remote.then(function (already) {
    if (already) {
      permissionCache[key] = true;
      return true;
    }
    return askPermissionDialog(d, appName, capability).then(function (allowed) {
      permissionCache[key] = !!allowed;
      if (!allowed) {
        throw new Error('用户拒绝了「' + _permLabel(capability) + '」权限');
      }
      _grantRemote(d, appName, capability);
      return true;
    });
  });

  permissionPending[key] = chain;
  chain.then(function () { delete permissionPending[key]; }, function () { delete permissionPending[key]; });
  return chain;
}

// 系统通知：优先 Notification（页面不可见时才有意义），否则回落宿主 Toast。
// 返回 Promise<{ channel: 'notification' | 'toast' }>
function notifyUser(d, title, body) {
  var t = String(title || '').slice(0, 80);
  var b = String(body || '').slice(0, 300);
  var summary = t && b ? t + '：' + b : (t || b);

  function fallback() {
    var ok = _showHostToast(d, summary, 'info');
    return { channel: ok ? 'toast' : 'none' };
  }

  if (typeof Notification === 'undefined') {
    return Promise.resolve(fallback());
  }

  var visible = typeof document !== 'undefined' && !document.hidden;
  // 页面在前台：宿主 Toast 更符合系统观感，也避免重复打扰
  if (visible && Notification.permission !== 'granted') {
    return Promise.resolve(fallback());
  }

  if (Notification.permission === 'granted') {
    try {
      // eslint-disable-next-line no-new
      new Notification(t || 'ClassIntra', { body: b, tag: 'ci-app-' + Date.now() });
      return Promise.resolve({ channel: 'notification' });
    } catch (e) {
      return Promise.resolve(fallback());
    }
  }

  if (Notification.permission === 'denied') {
    return Promise.resolve(fallback());
  }

  // default：只在本会话询问一次，拒绝后不再骚扰用户
  if (_notifyAsked) return Promise.resolve(fallback());
  _notifyAsked = true;
  try {
    var ret = Notification.requestPermission(function() {});
    if (ret && typeof ret.then === 'function') {
      return ret.then(function(perm) {
        if (perm === 'granted') {
          try {
            // eslint-disable-next-line no-new
            new Notification(t || 'ClassIntra', { body: b });
            return { channel: 'notification' };
          } catch (e) {}
        }
        return fallback();
      }).catch(function() { return fallback(); });
    }
  } catch (e) {}
  return Promise.resolve(fallback());
}

// 复制文本：navigator.clipboard 优先，Chrome 80 无权限时回落 execCommand
function clipboardWrite(text) {
  var str = String(text === undefined || text === null ? '' : text);
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(str).then(function() {
      return { ok: true, method: 'clipboard' };
    }).catch(function() {
      return _legacyCopy(str);
    });
  }
  return Promise.resolve(_legacyCopy(str));
}

function _legacyCopy(str) {
  try {
    if (typeof document === 'undefined') return { ok: false, method: 'none' };
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, str.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return { ok: ok, method: ok ? 'execCommand' : 'none' };
  } catch (e) {
    return { ok: false, method: 'none' };
  }
}

function clipboardRead() {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
    return navigator.clipboard.readText().then(function(text) {
      return { text: text, method: 'clipboard' };
    }).catch(function(err) {
      throw new Error('读取剪贴板被拒绝（需要用户手势或权限授权）: ' + (err && err.message || err));
    });
  }
  return Promise.reject(new Error('当前浏览器不支持读取剪贴板（需要 Chrome 66+ 且页面获得授权）'));
}

// 分享：Web Share 优先，否则复制到剪贴板并提示，保证「有反馈、不假装成功」
// 分享：
//   1) 有系统 Web Share → 用系统面板（可分享到微信等站外）
//   2) 没有系统面板，但班上有应用声明了 shareTarget → 弹宿主的分享面板（Android Sharesheet 的对应物）
//   3) 都没有 → 退回复制到剪贴板
function shareContent(d, appName, data) {
  var payload = data || {};
  var title = String(payload.title || '');
  var text = String(payload.text || '');
  var url = String(payload.url || '');

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    return navigator.share({ title: title, text: text, url: url }).then(function () {
      return { channel: 'share' };
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return { channel: 'cancelled' };
      return _fallbackShare(d, appName, title, text, url);
    });
  }
  return _fallbackShare(d, appName, title, text, url);
}

// 宿主分享面板：列出声明了 shareTarget 的应用（排除发起方自己），外加「复制到剪贴板」。
// 返回 Promise<{name,label}|{name:''}|null>：null 表示用户取消。
function _askShareTarget(d, appName, title, text, url) {
  var targets = [];
  try {
    if (typeof d.getShareTargets === 'function') targets = d.getShareTargets() || [];
  } catch (e) { targets = []; }
  targets = targets.filter(function (t) { return t && t.name && t.name !== appName; });
  if (!targets.length) return Promise.resolve(null);

  return new Promise(function (resolve) {
    var picked = null;
    var preview = [title, text, url].filter(function (x) { return !!x; }).join(' · ').slice(0, 90);

    var actions = targets.map(function (t) {
      return {
        label: (t.title || ('分享到「' + (t.label || t.name) + '」')).slice(0, 34),
        onClick: function () { picked = t; }
      };
    });
    actions.push({
      label: '复制到剪贴板',
      variant: 'plain',
      onClick: function () { picked = { name: '' }; }
    });

    var sheet = ui.sheet({
      title: '分享',
      message: preview || '（无内容）',
      actions: actions,
      onClose: function () { resolve(picked); }
    });
    sheet.open();
  });
}

function _fallbackShare(d, appName, title, text, url) {
  return _askShareTarget(d, appName, title, text, url).then(function (picked) {
    if (picked && picked.name) {
      if (typeof d.openApp !== 'function') {
        return { channel: 'none', error: 'openApp 不可用' };
      }
      // 参数走 query：可分享、刷新不丢，目标应用用 context.app.onShare 接收
      return d.openApp(picked.name, {
        ci_share: '1',
        ci_share_title: title,
        ci_share_text: text,
        ci_share_url: url
      }).then(function () {
        return { channel: 'app', app: picked.name };
      }).catch(function () {
        return { channel: 'none', error: '打开目标应用失败' };
      });
    }
    if (picked) {
      // 用户选了「复制到剪贴板」
      var lines = [];
      if (title) lines.push(title);
      if (text) lines.push(text);
      if (url) lines.push(url);
      var res = _legacyCopy(lines.join('\n'));
      _showHostToast(d, res.ok ? '已复制分享内容' : '当前环境不支持分享', res.ok ? 'success' : 'error');
      return { channel: res.ok ? 'clipboard' : 'none' };
    }
    return { channel: 'cancelled' };
  });
}

// 设备信息：只暴露浏览器能自报的字段，别猜硬件
function deviceInfo() {
  var ua = '';
  try { ua = navigator.userAgent || ''; } catch (e) {}
  var w = 0;
  var h = 0;
  try {
    w = window.innerWidth || 0;
    h = window.innerHeight || 0;
  } catch (e) {}
  return {
    platform: (function() {
      var p = '';
      try { p = navigator.platform || ''; } catch (e) {}
      if (/android/i.test(ua)) return 'android';
      if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
      if (/windows/i.test(p)) return 'windows';
      if (/mac/i.test(p)) return 'mac';
      if (/linux/i.test(p)) return 'linux';
      return p || 'unknown';
    })(),
    viewport: { width: w, height: h },
    dpr: (function() { try { return window.devicePixelRatio || 1; } catch (e) { return 1; } })(),
    ua: ua,
    online: (function() { try { return navigator.onLine !== false; } catch (e) { return true; } })()
  };
}

// 文件选择：返回 File[]，用户取消时 resolve([])（不 reject，避免第三方写 catch 分支）
function pickFiles(appName, options) {
  var opts = options || {};
  if (typeof document === 'undefined') return Promise.resolve([]);
  return new Promise(function(resolve) {
    var input = document.createElement('input');
    input.type = 'file';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    if (opts.accept) input.accept = String(opts.accept);
    if (opts.multiple) input.multiple = true;
    if (opts.capture) input.setAttribute('capture', String(opts.capture));

    var settled = false;
    var timer = null;

    function cleanup() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { window.removeEventListener('focus', onFocus); } catch (e) {}
      try {
        if (input.parentNode) input.parentNode.removeChild(input);
      } catch (e) {}
    }

    function finish(files) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files || []);
    }

    function onFocus() {
      // 某些内核不触发 change：回到焦点后给 600ms 宽限，仍为空视为取消
      setTimeout(function() {
        if (!settled) finish([]);
      }, 600);
    }

    input.addEventListener('change', function() {
      var out = [];
      var list = input.files || [];
      for (var i = 0; i < list.length; i++) out.push(list[i]);
      finish(out);
    });

    try { window.addEventListener('focus', onFocus); } catch (e) {}
    document.body.appendChild(input);
    try {
      input.click();
    } catch (e) {
      finish([]);
    }
  });
}

// 拍照：getUserMedia → video → canvas → Blob。失败给出人话错误。
function capturePhoto(options) {
  var opts = options || {};
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error('当前浏览器不支持摄像头采集（需要 HTTPS 或 localhost）'));
  }
  var constraints = {
    video: {
      facingMode: opts.facingMode || 'user',
      width: opts.width ? { ideal: opts.width } : undefined,
      height: opts.height ? { ideal: opts.height } : undefined
    },
    audio: false
  };

  return navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
    return new Promise(function(resolve, reject) {
      var video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      document.body.appendChild(video);

      function stop() {
        try {
          var tracks = stream.getTracks ? stream.getTracks() : [];
          for (var i = 0; i < tracks.length; i++) tracks[i].stop();
        } catch (e) {}
        try { video.pause(); } catch (e) {}
        try { if (video.parentNode) video.parentNode.removeChild(video); } catch (e) {}
      }

      video.onerror = function() {
        stop();
        reject(new Error('摄像头画面加载失败'));
      };

      video.onloadedmetadata = function() {
        var w = video.videoWidth || 640;
        var h = video.videoHeight || 480;
        var maxW = opts.maxWidth || 1280;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        var type = opts.type || 'image/jpeg';
        var quality = typeof opts.quality === 'number' ? opts.quality : 0.9;
        if (typeof canvas.toBlob !== 'function') {
          stop();
          reject(new Error('当前浏览器不支持 canvas.toBlob'));
          return;
        }
        canvas.toBlob(function(blob) {
          stop();
          if (!blob) { reject(new Error('照片生成失败')); return; }
          resolve(blob);
        }, type, quality);
      };

      video.srcObject = stream;
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function() { /* 自动播放被拦时仍可由 loadedmetadata 兜底 */ });
    });
  }).catch(function(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('摄像头权限被拒绝');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('未找到可用的摄像头');
    }
    throw new Error('摄像头不可用: ' + ((err && err.message) || name || 'unknown'));
  });
}

// 录音：getUserMedia → MediaRecorder → Blob。
// 交互：底部浮条（红点 + 计时 + 停止 / 取消），到 maxDuration 自动停。
// 为什么自带 UI 而不做成 start/stop 两段式：两段式要应用自己画界面、自己管清理，
// 恰恰是最容易漏 track.stop() 的地方（麦克风指示灯一直亮，用户会以为被偷听）。
function recordAudio(d, appName, options) {
  var opts = options || {};
  var maxDuration = Math.max(5, Math.min(600, Number(opts.maxDuration) || 120));

  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error('当前浏览器不支持录音（需要 HTTPS 或 localhost）'));
  }
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持 MediaRecorder'));
  }

  function pickMime() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) {}
    }
    return '';
  }

  return ensurePermission(d, appName, 'device.microphone').then(function () {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }).then(function (stream) {
    return new Promise(function (resolve, reject) {
      var mimeType = pickMime();
      var rec;
      try {
        rec = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
      } catch (e) {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {}
        reject(new Error('录音初始化失败: ' + ((e && e.message) || 'unknown')));
        return;
      }

      var chunks = [];
      var startedAt = Date.now();
      var settled = false;
      var cancelled = false;
      var ticker = null;
      var autoStop = null;

      // ---- UI ----
      var bar = document.createElement('div');
      bar.setAttribute('style', [
        'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%)',
        'z-index:60000', 'display:flex', 'align-items:center', 'gap:12px',
        'padding:12px 16px', 'border-radius:999px',
        'background:var(--card-bg, #FFFFFF)', 'color:var(--text-primary, #111827)',
        'box-shadow:0 10px 40px rgba(0,0,0,0.28)',
        'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
        'font-size:14px'
      ].join(';'));

      var dot = document.createElement('span');
      dot.setAttribute('style', 'width:10px;height:10px;border-radius:50%;background:#FF3B30;flex:0 0 auto;');

      var label = document.createElement('span');
      label.setAttribute('style', 'min-width:44px;font-variant-numeric:tabular-nums;font-weight:600;');
      label.textContent = '00:00';

      var stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.textContent = '停止';
      stopBtn.setAttribute('style', [
        'padding:7px 15px', 'border:none', 'border-radius:999px', 'cursor:pointer',
        'background:var(--primary-color, #0A84FF)', 'color:#fff', 'font-size:13px',
        'font-weight:600', 'font-family:inherit'
      ].join(';'));

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = '取消';
      cancelBtn.setAttribute('style', [
        'padding:7px 13px', 'border:none', 'border-radius:999px', 'cursor:pointer',
        'background:transparent', 'color:inherit', 'opacity:0.6', 'font-size:13px',
        'font-family:inherit'
      ].join(';'));

      function paint() {
        var sec = Math.floor((Date.now() - startedAt) / 1000);
        var mm = ('0' + Math.floor(sec / 60)).slice(-2);
        var ss = ('0' + (sec % 60)).slice(-2);
        label.textContent = mm + ':' + ss;
        // 红点脉冲：用 JS 切换透明度，避免注入 <style> 污染全局
        dot.style.opacity = (Math.floor(sec * 2) % 2 === 0) ? '1' : '0.25';
      }

      function cleanup() {
        try { if (ticker) clearInterval(ticker); } catch (e) {}
        try { if (autoStop) clearTimeout(autoStop); } catch (e) {}
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { if (bar.parentNode) bar.parentNode.removeChild(bar); } catch (e) {}
      }

      function settle(fn, arg) {
        if (settled) return;
        settled = true;
        cleanup();
        fn(arg);
      }

      function requestStop() {
        if (settled) return;
        try {
          if (rec.state !== 'inactive') rec.stop();
          else settle(resolve, { blob: new Blob(chunks, { type: mimeType || 'audio/webm' }), duration: Date.now() - startedAt, mimeType: mimeType || 'audio/webm' });
        } catch (e) {
          settle(reject, new Error('停止录音失败: ' + ((e && e.message) || 'unknown')));
        }
      }

      rec.ondataavailable = function (e) {
        if (e && e.data && e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = function () {
        var duration = Date.now() - startedAt;
        if (cancelled) {
          settle(reject, new Error('已取消录音'));
          return;
        }
        var blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        if (!blob.size) {
          settle(reject, new Error('没有录到声音'));
          return;
        }
        settle(resolve, {
          blob: blob,
          duration: duration,
          mimeType: blob.type || mimeType || 'audio/webm'
        });
      };

      rec.onerror = function (e) {
        settle(reject, new Error('录音出错: ' + ((e && e.error && e.error.message) || 'unknown')));
      };

      stopBtn.onclick = requestStop;
      cancelBtn.onclick = function () {
        cancelled = true;
        requestStop();
      };

      bar.appendChild(dot);
      bar.appendChild(label);
      bar.appendChild(stopBtn);
      bar.appendChild(cancelBtn);
      document.body.appendChild(bar);

      try {
        rec.start(200); // 分片，避免长时间录音全压在内存
      } catch (e) {
        settle(reject, new Error('启动录音失败: ' + ((e && e.message) || 'unknown')));
        return;
      }

      paint();
      ticker = setInterval(paint, 250);
      autoStop = setTimeout(requestStop, maxDuration * 1000);
    });
  }).catch(function (err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('麦克风权限被拒绝');
    }
    if (name === 'NotFoundError') {
      throw new Error('未找到可用的麦克风');
    }
    if (err && err.message) throw err;
    throw new Error('录音不可用: ' + (name || 'unknown'));
  });
}

// 录像：getUserMedia（视频 ± 音频）→ MediaRecorder → Blob，带预览窗口。
// 与 recordAudio 同构：自带 UI、自动停、清理必 track.stop()。
// 需要 device.camera；带声音时额外需要 device.microphone（两个权限各弹一次，不合并）。
function recordVideo(d, appName, options) {
  var opts = options || {};
  var maxDuration = Math.max(3, Math.min(300, Number(opts.maxDuration) || 60));
  var withAudio = opts.audio !== false;

  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error('当前浏览器不支持录像（需要 HTTPS 或 localhost）'));
  }
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持 MediaRecorder'));
  }

  function pickMime() {
    var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) {}
    }
    return '';
  }

  return ensurePermission(d, appName, 'device.camera').then(function () {
    if (!withAudio) return true;
    return ensurePermission(d, appName, 'device.microphone');
  }).then(function () {
    return navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: opts.facingMode || 'user',
        width: opts.width ? { ideal: opts.width } : undefined,
        height: opts.height ? { ideal: opts.height } : undefined
      },
      audio: withAudio
    });
  }).then(function (stream) {
    return new Promise(function (resolve, reject) {
      var mimeType = pickMime();
      var rec;
      try {
        rec = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
      } catch (e) {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {}
        reject(new Error('录像初始化失败: ' + ((e && e.message) || 'unknown')));
        return;
      }

      var chunks = [];
      var startedAt = Date.now();
      var settled = false;
      var cancelled = false;
      var ticker = null;
      var autoStop = null;

      // ---- UI：全屏遮罩 + 预览窗口 ----
      var mask = document.createElement('div');
      mask.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:60000',
        'background:rgba(0,0,0,0.62)',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
        'box-sizing:border-box', '-webkit-tap-highlight-color:transparent'
      ].join(';'));

      var card = document.createElement('div');
      card.setAttribute('style', [
        'width:100%', 'max-width:360px', 'box-sizing:border-box', 'overflow:hidden',
        'background:var(--card-bg, #1C1C1E)', 'color:var(--text-primary, #fff)',
        'border-radius:16px', 'box-shadow:0 18px 60px rgba(0,0,0,0.4)',
        'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif'
      ].join(';'));

      var stage = document.createElement('div');
      stage.setAttribute('style', 'position:relative;background:#000;line-height:0;');

      var video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;          // 必须静音，否则扬声器把麦克风声音放出来形成回声
      video.autoplay = true;
      video.setAttribute('style', 'width:100%;height:240px;object-fit:cover;display:block;background:#000;');

      var hud = document.createElement('div');
      hud.setAttribute('style', [
        'position:absolute', 'top:10px', 'left:10px', 'display:flex', 'align-items:center', 'gap:6px',
        'padding:4px 9px', 'border-radius:999px', 'background:rgba(0,0,0,0.5)', 'color:#fff', 'font-size:12px',
        'font-variant-numeric:tabular-nums'
      ].join(';'));

      var dot = document.createElement('span');
      dot.setAttribute('style', 'width:8px;height:8px;border-radius:50%;background:#FF3B30;');

      var label = document.createElement('span');
      label.textContent = '00:00';

      var footer = document.createElement('div');
      footer.setAttribute('style', 'display:flex;gap:8px;padding:12px;justify-content:flex-end;');

      function makeBtn(text, primary) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.setAttribute('style', [
          'padding:9px 16px', 'border:none', 'border-radius:999px', 'cursor:pointer',
          'font-size:13px', 'font-weight:600', 'font-family:inherit',
          primary ? 'background:var(--primary-color, #0A84FF);color:#fff;'
                  : 'background:transparent;color:inherit;opacity:0.65;'
        ].join(';'));
        return b;
      }

      var stopBtn = makeBtn('完成', true);
      var cancelBtn = makeBtn('取消', false);

      function paint() {
        var sec = Math.floor((Date.now() - startedAt) / 1000);
        label.textContent = ('0' + Math.floor(sec / 60)).slice(-2) + ':' + ('0' + (sec % 60)).slice(-2);
        dot.style.opacity = (Math.floor(sec * 2) % 2 === 0) ? '1' : '0.25';
      }

      function cleanup() {
        try { if (ticker) clearInterval(ticker); } catch (e) {}
        try { if (autoStop) clearTimeout(autoStop); } catch (e) {}
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { video.pause(); } catch (e) {}
        try { video.srcObject = null; } catch (e) {}
        try { if (mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
      }

      function settle(fn, arg) {
        if (settled) return;
        settled = true;
        cleanup();
        fn(arg);
      }

      function requestStop() {
        if (settled) return;
        try {
          if (rec.state !== 'inactive') rec.stop();
          else settle(reject, new Error('没有录到画面'));
        } catch (e) {
          settle(reject, new Error('停止录像失败: ' + ((e && e.message) || 'unknown')));
        }
      }

      rec.ondataavailable = function (e) {
        if (e && e.data && e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = function () {
        if (cancelled) { settle(reject, new Error('已取消录像')); return; }
        var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        if (!blob.size) { settle(reject, new Error('没有录到画面')); return; }
        settle(resolve, {
          blob: blob,
          duration: Date.now() - startedAt,
          mimeType: blob.type || mimeType || 'video/webm',
          hasAudio: withAudio
        });
      };

      rec.onerror = function (e) {
        settle(reject, new Error('录像出错: ' + ((e && e.error && e.error.message) || 'unknown')));
      };

      stopBtn.onclick = requestStop;
      cancelBtn.onclick = function () { cancelled = true; requestStop(); };

      hud.appendChild(dot);
      hud.appendChild(label);
      stage.appendChild(video);
      stage.appendChild(hud);
      footer.appendChild(cancelBtn);
      footer.appendChild(stopBtn);
      card.appendChild(stage);
      card.appendChild(footer);
      mask.appendChild(card);
      document.body.appendChild(mask);

      video.srcObject = stream;
      var play = video.play();
      if (play && typeof play.catch === 'function') play.catch(function () {});

      try {
        rec.start(200);
      } catch (e) {
        settle(reject, new Error('启动录像失败: ' + ((e && e.message) || 'unknown')));
        return;
      }

      paint();
      ticker = setInterval(paint, 250);
      autoStop = setTimeout(requestStop, maxDuration * 1000);
    });
  }).catch(function (err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error(withAudio ? '摄像头或麦克风权限被拒绝' : '摄像头权限被拒绝');
    }
    if (name === 'NotFoundError') {
      throw new Error('未找到可用的摄像头');
    }
    if (err && err.message) throw err;
    throw new Error('录像不可用: ' + (name || 'unknown'));
  });
}

// 主题便捷层：让文档里的 context.theme.current / getToken / subscribe 真实存在。
// 同时把 ThemeEngine 的原有方法透传出去——v1 应用里 context.theme.setTheme() 不能失效。
function createThemeApi(d) {
  var engine = d.themeEngine || null;
  var subs = [];

  function delegate(name) {
    return function() {
      if (!engine || typeof engine[name] !== 'function') return undefined;
      return engine[name].apply(engine, arguments);
    };
  }

  return {
    get current() {
      try {
        if (engine && typeof engine.getCurrentTheme === 'function') return engine.getCurrentTheme();
      } catch (e) {}
      return '';
    },
    getToken: function(name) {
      try {
        return (collectTokens() || {})[name] || '';
      } catch (e) { return ''; }
    },
    subscribe: function(fn) {
      if (typeof fn !== 'function' || !engine || typeof engine.subscribe !== 'function') {
        return function() {};
      }
      var stop = engine.subscribe(function(payload) {
        try { fn((payload && payload.id) || '', payload || {}); } catch (e) {}
      });
      subs.push(stop);
      return function() {
        try { stop(); } catch (e) {}
        var idx = subs.indexOf(stop);
        if (idx !== -1) subs.splice(idx, 1);
      };
    },
    // —— ThemeEngine 透传（向后兼容 v1）——
    setTheme: delegate('setTheme'),
    toggleColorScheme: delegate('toggleColorScheme'),
    setMotionEnabled: delegate('setMotionEnabled'),
    isMotionEnabled: delegate('isMotionEnabled'),
    listThemes: delegate('listThemes'),
    registerTheme: delegate('registerTheme'),
    __dispose: function() {
      for (var i = subs.length - 1; i >= 0; i--) {
        try { subs[i](); } catch (e) {}
      }
      subs = [];
    }
  };
}

// ============================================================
// 四、SDK 工厂
// ============================================================

// createContext 的依赖注入参数
// deps: {
//   api, realtime, router, store, themeEngine, eventBus, modal,
//   getAuditor, define   —— 见 main.js 的装配处
// }
function createContext(appName, deps) {
  var d = deps || {};

  // 确保 UI 片段的样式已注入
  try { ensureStyles(); } catch (e) {}

  // --- 清理函数登记表（context.app.onDestroy 的实现） ---
  var cleanups = [];
  var _disposed = false;

  // --- 订阅归属：本 context 经 eventBus 登记的订阅统一挂 'market:<appName>' ---
  // dispose 时自动 offOwner——第三方忘了退订也不再泄漏总线
  var BUS_OWNER = 'market:' + appName;
  var scopedEventBus = null;
  if (d.eventBus && typeof d.eventBus.on === 'function') {
    var rawBus = d.eventBus;
    scopedEventBus = {
      on: function(topic, fn) { return rawBus.on(topic, fn, BUS_OWNER); },
      once: function(topic, fn) {
        var wrapper = function() {
          rawBus.off(topic, wrapper);
          try { fn.apply(null, arguments); } catch (e) {}
        };
        return rawBus.on(topic, wrapper, BUS_OWNER);
      },
      off: function(topic, fn) { rawBus.off(topic, fn); return true; },
      emit: function(topic) { return rawBus.emit.apply(rawBus, arguments); },
      listenerCount: function(topic) { return rawBus.listenerCount(topic); }
    };
  }

  // 取当前应用的资源审计器（用于记录 storage 前缀）
  var auditor = null;
  try {
    if (typeof d.getAuditor === 'function') auditor = d.getAuditor(appName);
  } catch (e) { auditor = null; }

  // --- 生命周期（visibilitychange 统一驱动）---
  var pauseHandlers = [];
  var resumeHandlers = [];

  // --- 分享接收（manifest.shareTarget）---
  // 应用通过 ci_share=1&ci_share_text=... 被唤起；这里先把数据存下来，
  // 等应用调 onShare() 注册回调时再派发——注册总是晚于 context 创建。
  var shareHandlers = [];
  try {
    var _q = (d.router && d.router.currentRoute && d.router.currentRoute.query) || null;
    if (_q && String(_q.ci_share) === '1') {
      sharedIncoming = {
        at: Date.now(),
        data: {
          title: String(_q.ci_share_title || ''),
          text: String(_q.ci_share_text || ''),
          url: String(_q.ci_share_url || ''),
          // 从哪个应用分享过来的（便于目标应用回跳/致谢）
          from: String(_q.ci_share_from || '')
        }
      };
      // 参数用掉就清掉，避免刷新时重复派发。
      // ⚠️ 必须用 history.replaceState 直接改地址栏：走 router.replace 会触发路由变化，
      //    导致应用被重建、context 换新，而新 context 读到的 query 已空 —— 分享数据就丢了。
      try {
        if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
          var _search = '';
          try { _search = window.location.search || ''; } catch (e) {}
          if (_search) {
            var _parts = _search.replace(/^\?/, '').split('&');
            var _kept = [];
            for (var _k = 0; _k < _parts.length; _k++) {
              if (_parts[_k] && _parts[_k].indexOf('ci_share') !== 0) _kept.push(_parts[_k]);
            }
            window.history.replaceState(null, '',
              window.location.pathname + (_kept.length ? '?' + _kept.join('&') : '') + (window.location.hash || ''));
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  var _wasHidden = (typeof document !== 'undefined') && document.hidden;
  function _onVisibilityChange() {
    if (typeof document === 'undefined') return;
    var hidden = document.hidden;
    if (hidden === _wasHidden) return;
    _wasHidden = hidden;
    var list = hidden ? pauseHandlers : resumeHandlers;
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try { snapshot[i](); } catch (e) {}
    }
  }
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', _onVisibilityChange);
    }
  } catch (e) {}

  // --- context.app ---
  var appApi = {
    name: appName,
    version: d.appVersion || '0.0.0',
    manifest: d.manifest || null,
    // 注册清理函数：应用卸载时被调用（契约优于约定）
    onDestroy: function(fn) {
      if (typeof fn !== 'function') return;
      if (_disposed) {
        // 已卸载则立即执行，避免泄漏
        try { fn(); } catch (e) {}
        return;
      }
      cleanups.push(fn);
    },
    // 日志：统一前缀，便于第三方问题归因
    log: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.log.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    warn: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.warn.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    error: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.error.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    // 配置：从 manifest.config 读取（应用自定义配置的存放处）
    config: (d.manifest && d.manifest.config) || {},
    // 生命周期（对应 iOS viewWillDisappear / Android onPause）：
    // 页面切到后台 / 回到前台时触发；销毁时自动解绑。
    onPause: function(fn) {
      if (typeof fn === 'function') pauseHandlers.push(fn);
      return function() {
        var idx = pauseHandlers.indexOf(fn);
        if (idx !== -1) pauseHandlers.splice(idx, 1);
      };
    },
    onResume: function(fn) {
      if (typeof fn === 'function') resumeHandlers.push(fn);
      return function() {
        var idx = resumeHandlers.indexOf(fn);
        if (idx !== -1) resumeHandlers.splice(idx, 1);
      };
    },
    // 接收分享（需 manifest 声明 shareTarget）：别的应用 system.share 选了本应用时触发。
    // 若这次启动本身就是被分享唤起的，注册时会立刻补发一次，应用不必自己去读 URL。
    onShare: function(fn) {
      if (typeof fn !== 'function') return function() {};
      shareHandlers.push(fn);
      if (sharedIncoming && Date.now() - sharedIncoming.at < 5000) {
        var data = sharedIncoming.data;
        setTimeout(function() {
          try { fn(data); } catch (e) {}
        }, 0);
      }
      return function() {
        var idx = shareHandlers.indexOf(fn);
        if (idx !== -1) shareHandlers.splice(idx, 1);
      };
    }
  };

  // --- context.data ---
  // 服务端存储：跟账号走的 KV 与文件（换设备/重装都能拿回）
  // 与 data.storage 的分工：
  //   storage       = 本机缓存，卸载即清，不跨设备
  //   store / blob  = 服务端数据，按 (应用, 用户) 隔离，登录即可取回
  var storeBase = '/app-data/' + appName;
  var objectUrls = [];

  function apiReady() {
    return !!(d.api && typeof d.api.get === 'function');
  }

  var storeApi = {
    // 读一个键；不存在返回 null（不抛 404，省掉调用方一次 catch）
    get: function(key) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.get(storeBase + '/kv/' + encodeURIComponent(key)).then(function(res) {
        var body = res && res.data;
        return body && body.data ? body.data.value : null;
      }).catch(function(err) {
        if (err && err.response && err.response.status === 404) return null;
        throw err;
      });
    },
    set: function(key, value) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.put(storeBase + '/kv/' + encodeURIComponent(key), { value: value }).then(function() {
        return true;
      });
    },
    remove: function(key) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.delete(storeBase + '/kv/' + encodeURIComponent(key)).then(function(res) {
        return !!(res && res.data && res.data.data && res.data.data.removed);
      });
    },
    keys: function() {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.get(storeBase + '/kv').then(function(res) {
        var body = res && res.data;
        return body && body.data ? body.data.keys : [];
      });
    },
    // 一次取回全部（应用启动时同步用）
    all: function() {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.get(storeBase + '/kv/all').then(function(res) {
        var body = res && res.data;
        return body && body.data ? body.data.values : {};
      });
    },

    // ---- 文件 ----
    listBlobs: function() {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.get(storeBase + '/blobs').then(function(res) {
        var body = res && res.data;
        return body && body.data ? body.data.blobs : [];
      });
    },
    uploadBlob: function(name, file, mime) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      var type = mime || (file && file.type) || 'application/octet-stream';
      return d.api.put(storeBase + '/blobs/' + encodeURIComponent(name), file, {
        headers: { 'Content-Type': type }
      }).then(function(res) {
        var body = res && res.data;
        return body && body.data ? body.data : null;
      });
    },
    // 取可用的 object URL（<img> 不能带 Authorization，所以先下载再本地化）
    getBlobUrl: function(name) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.get(storeBase + '/blobs/' + encodeURIComponent(name), { responseType: 'blob' }).then(function(res) {
        var url = URL.createObjectURL(res.data);
        objectUrls.push(url);
        return url;
      });
    },
    deleteBlob: function(name) {
      if (!apiReady()) return Promise.reject(new Error('api 不可用'));
      return d.api.delete(storeBase + '/blobs/' + encodeURIComponent(name)).then(function(res) {
        return !!(res && res.data && res.data.data && res.data.data.removed);
      });
    }
  };

  var dataApi = {
    api: d.api || null,
    realtime: d.realtime || null,
    websocket: d.websocket || null,
    storage: createNamespacedStorage(appName, auditor),
    store: storeApi,
    // 便捷方法：拉取 JSON
    get: function(url, options) {
      if (d.api && typeof d.api.get === 'function') return d.api.get(url, options);
      return Promise.reject(new Error('api 不可用'));
    },
    post: function(url, body, options) {
      if (d.api && typeof d.api.post === 'function') return d.api.post(url, body, options);
      return Promise.reject(new Error('api 不可用'));
    }
  };

  // --- context.system ---
  var systemApi = {
    // 当前用户（响应式引用，而非快照）
    get user() {
      try {
        return (d.store && d.store.state && d.store.state.auth && d.store.state.auth.user) || null;
      } catch (e) { return null; }
    },
    get isLoggedIn() {
      try {
        return !!(d.store && d.store.state && d.store.state.auth && d.store.state.auth.token);
      } catch (e) { return false; }
    },
    // 路由
    get route() {
      try {
        return (d.router && d.router.currentRoute) || null;
      } catch (e) { return null; }
    },
    router: d.router || null,
    // 主题引擎
    theme: d.themeEngine || null,
    // 令牌读取
    getToken: function(name) {
      try {
        return (collectTokens() || {})[name] || '';
      } catch (e) { return ''; }
    },
    // 事件总线（scoped：订阅统一归属 market:<appName>，dispose 时自动整批退订）
    eventBus: scopedEventBus || d.eventBus || null,
    // 提示
    toast: {
      alert: function(options) {
        try {
          if (d.modal && typeof d.modal.alert === 'function') return d.modal.alert(options);
        } catch (e) {}
        return Promise.resolve(true);
      },
      confirm: function(options) {
        try {
          if (d.modal && typeof d.modal.confirm === 'function') return d.modal.confirm(options);
        } catch (e) {}
        return Promise.resolve(false);
      },
      prompt: function(options) {
        try {
          if (d.modal && typeof d.modal.prompt === 'function') return d.modal.prompt(options);
        } catch (e) {}
        return Promise.resolve(null);
      }
    },
    modal: d.modal || null,
    // 系统通知（capability: system.notification）。前台走宿主 Toast，后台走系统通知。
    // 用户拒绝通知权限时不 reject：降级为前台 Toast，别让应用的提示彻底失效。
    notify: function(title, body) {
      return ensurePermission(d, appName, 'system.notification').then(function() {
        return notifyUser(d, title, body);
      }).catch(function() {
        var t = String(title || '').slice(0, 80);
        var b = String(body || '').slice(0, 300);
        var ok = _showHostToast(d, t && b ? t + '：' + b : (t || b), 'info');
        return { channel: ok ? 'toast' : 'none', denied: true };
      });
    },
    // 剪贴板（capability: system.clipboard）。Chrome 80 无 clipboard API 时回落 execCommand。
    clipboard: {
      write: function(text) {
        return clipboardWrite(text);
      },
      read: function() {
        var supported = false;
        try {
          supported = !!(navigator.clipboard && typeof navigator.clipboard.readText === 'function');
        } catch (e) { supported = false; }
        if (!supported) return Promise.reject(new Error('当前浏览器不支持读取剪贴板'));
        return ensurePermission(d, appName, 'system.clipboard.read').then(function() {
          return clipboardRead();
        });
      }
    },
    // 分享（capability: system.share）。优先系统面板，其次宿主的「分享到应用」面板，
    // 最后退回复制到剪贴板。
    share: function(data) {
      return shareContent(d, appName, data);
    },
    // 桌面角标（capability: system.badge）。传 0 / '' / null 即清除。
    setBadge: function(value) {
      try {
        if (d.store && typeof d.store.commit === 'function') {
          d.store.commit('desktop/SET_APP_BADGE', { name: appName, value: value });
          return true;
        }
      } catch (e) {}
      return false;
    },
    // 打开另一个应用（capability: system.openApp）。params 作为 query 传给目标应用，
    // 目标侧用 context.system.route.query 读取。
    openApp: function(name, params) {
      if (typeof d.openApp === 'function') return d.openApp(name, params);
      return Promise.reject(new Error('openApp 不可用'));
    },
    // 搜索收录（capability: system.search）：让应用内容出现在全局搜索里。
    // provider = { id?, category?, search(query) => items[] | Promise<items[]> }
    // item = { id?, title, description?, icon?, action? }
    registerSearchProvider: function(provider) {
      if (!provider || typeof provider.search !== 'function') return function() {};
      var registry = d.searchRegistry;
      if (!registry || typeof registry.registerProvider !== 'function') return function() {};
      var localId = String(provider.id || 'main').slice(0, 24);

      function normalize(items) {
        var out = [];
        if (!Array.isArray(items)) return out;
        for (var i = 0; i < items.length && out.length < 10; i++) {
          var it = items[i] || {};
          var title = String(it.title || '').slice(0, 80);
          if (!title) continue;
          out.push({
            id: 'app:' + appName + ':' + localId + ':' + (it.id || i),
            title: title,
            description: String(it.description || '').slice(0, 120),
            icon: it.icon || 'fa-solid fa-magnifying-glass',
            iconColor: it.iconColor || '',
            action: typeof it.action === 'function' ? it.action : function() {}
          });
        }
        return out;
      }

      return registry.registerProvider({
        id: 'market:' + appName + ':' + localId,
        category: String(provider.category || appName).slice(0, 20),
        search: function(query) {
          try {
            var r = provider.search(query);
            if (r && typeof r.then === 'function') {
              return r.then(normalize).catch(function() { return []; });
            }
            return normalize(r);
          } catch (e) {
            return [];
          }
        }
      });
    },
    // 返回桌面（应用内提供「退出」入口时使用）
    goDesktop: function() {
      try {
        if (d.router) d.router.push({ name: 'Desktop' });
      } catch (e) {}
    },
    // 跳转路由
    navigate: function(location) {
      try {
        if (d.router) return d.router.push(location);
      } catch (e) {}
      return Promise.resolve();
    }
  };

  // --- context.compat ---
  var chromeVersion = detectChromeVersion();
  var compatApi = {
    chromeVersion: chromeVersion,
    isX5: detectIsX5(),
    // 能力探测：has('flex-gap') / has('backdrop-filter') ...
    has: function(name) {
      return detectCapability(name);
    },
    // 兼容提示：低于基线时给出统一建议
    isBelowBaseline: chromeVersion > 0 && chromeVersion < 80
  };

  // --- context.device ---
  var deviceApi = {
    info: deviceInfo,
    filePicker: function(options) {
      return pickFiles(appName, options);
    },
    camera: function(options) {
      return ensurePermission(d, appName, 'device.camera').then(function() {
        return capturePhoto(options);
      });
    },
    // 录音（capability: device.microphone）。返回 { blob, duration, mimeType }。
    // 自带录音条 UI，到 maxDuration（默认 120s）自动停止；取消则 reject。
    recordAudio: function(options) {
      return recordAudio(d, appName, options);
    },
    // 录像（capability: device.camera，带声音时还需 device.microphone）。
    // 返回 { blob, duration, mimeType, hasAudio }；自带预览窗口，默认最长 60s。
    recordVideo: function(options) {
      return recordVideo(d, appName, options);
    },
    // 触觉反馈（对应 iOS UIImpactFeedback / Android Vibrator）。不支持时静默返回 false。
    vibrate: function(pattern) {
      try {
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
        return navigator.vibrate(pattern === undefined ? 20 : pattern);
      } catch (e) { return false; }
    },
    // 网络状态（对应 iOS NWPathMonitor / Android ConnectivityManager）
    network: function() {
      var conn = null;
      try { conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null; } catch (e) {}
      return {
        online: (function() { try { return navigator.onLine !== false; } catch (e) { return true; } })(),
        type: conn && conn.effectiveType ? conn.effectiveType : 'unknown',
        downlinkMbps: conn && typeof conn.downlink === 'number' ? conn.downlink : null,
        rttMs: conn && typeof conn.rtt === 'number' ? conn.rtt : null,
        saveData: !!(conn && conn.saveData)
      };
    },
    // 屏幕信息（对应 iOS UIScreen / Android DisplayMetrics）
    screen: function() {
      var w = 0, h = 0, dpr = 1;
      try { w = window.innerWidth || 0; h = window.innerHeight || 0; dpr = window.devicePixelRatio || 1; } catch (e) {}
      var orientation = 'unknown';
      try {
        if (window.matchMedia) {
          orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
        }
      } catch (e) {}
      return { width: w, height: h, dpr: dpr, orientation: orientation };
    }
  };

  // --- context.theme ---
  var themeApi = createThemeApi(d);

  // --- context.ui ---
  // ⚠️ 直接继承 market-sdk-ui 的全部导出，不要逐个列举：
  // 曾因手写清单漏掉 navbar / sheet，导致 context.ui.navbar 是 undefined。
  // ui 模块本身就是对外 API 对象，整体继承后新增组件自动可用。
  var uiApi = Object.assign({}, ui);

  // hostNavbar：把内容注入「宿主」的统一导航栏（区别于 ui.navbar——
  // 那是在应用自己页面里画一条导航栏）。前提：manifest.layout.navbar
  // 不要设成 'custom'（custom = 隐藏宿主导航栏，注入了也看不见）。
  // 标题传空串表示交还 manifest.label；卸载时 MarketRuntime 会自动 clear。
  uiApi.hostNavbar = {
    setTitle: function(title) { navbarStore.setTitle(appName, title); },
    // 状态段（DOM 节点）注入标题右侧：如棋类的「轮到黑方 · 红方」灰色小字，
    // 节点仍归应用所有（appendChild 搬运，render 照常更新它）
    setStatus: function(element) { navbarStore.setStatus(appName, element); },
    setActions: function(actions) { navbarStore.setActions(appName, actions); },
    clear: function() { navbarStore.clear(appName); }
  };

  // --- 组装 context ---
  var context = {
    appName: appName,
    version: '1',
    ui: uiApi,
    data: dataApi,
    system: systemApi,
    device: deviceApi,
    theme: themeApi,
    app: appApi,
    compat: compatApi,

    // ---- 以下为向后兼容层（v1 旧字段），保证既有第三方应用不失效 ----
    // TODO: v2 移除
    get api() { return dataApi.api; },
    get websocket() { return dataApi.websocket; },
    get realtime() { return dataApi.realtime; },
    get realtimeEvents() { return dataApi.realtime; },
    get route() { return systemApi.route; },
    get router() { return systemApi.router; },
    get store() { return d.store || null; },
    get user() { return systemApi.user; },
    get eventBus() { return systemApi.eventBus; },
    get toast() { return systemApi.toast; },
    get modal() { return systemApi.modal; },

    // 内部 API：供 MarketRuntime 调用，第三方请勿依赖
    __internal: {
      isDisposed: function() { return _disposed; }
    }
  };

  // 销毁：执行所有注册的清理函数（幂等）
  context.__internal.dispose = function() {
    if (_disposed) return 0;
    _disposed = true;
    var count = 0;
    // 逆序执行（后注册的先清理）
    for (var i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
        count++;
      } catch (e) {
        try { console.error('[app:' + appName + '] onDestroy 清理失败:', e); } catch (_) {}
      }
    }
    cleanups = [];
    try {
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', _onVisibilityChange);
      }
    } catch (e) {}
    pauseHandlers = [];
    resumeHandlers = [];
    shareHandlers = [];
    // 主题订阅回收（context.theme.subscribe 的兜底）
    try { themeApi.__dispose(); } catch (e) {}
    // 释放 datastore 生成的 object URL（否则整页生命周期内一直占内存）
    try {
      for (var oi = 0; oi < objectUrls.length; oi++) URL.revokeObjectURL(objectUrls[oi]);
      objectUrls = [];
    } catch (e) {}
    // 订阅兜底退订：应用忘了退订的 eventBus 订阅按归属整批清理
    try {
      if (d.eventBus && typeof d.eventBus.offOwner === 'function') {
        d.eventBus.offOwner(BUS_OWNER);
      }
    } catch (e) {}
    return count;
  };

  return context;
}

export {
  createContext,
  createNamespacedStorage,
  detectChromeVersion,
  detectIsX5,
  detectCapability
};
