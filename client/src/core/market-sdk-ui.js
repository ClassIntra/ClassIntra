// 前端核心：市场 SDK —— UI 预制片段
// ============================================================
// 定位（详见 docs/ecosystem-design.md §1.5、§4.2）：
//   组件（component）是系统内部资产，不对外分发。第三方应用无法 import Vue SFC，
//   因此本模块把 iOS 组件的视觉规范以「原生 DOM 片段」的形式暴露给第三方。
//
//   每个片段返回 { root, update, destroy }：
//     root    —— 可直接 appendChild 的根元素
//     update  —— 局部更新内容（避免重建）
//     destroy —— 解绑事件、清理引用
//
// 视觉一致性保证：片段使用的类名与 client/src/components/ios/*.vue 的 <style> 一致，
//   并通过读取 CSS 变量（--ci-* / 旧别名）获得主题跟随。
//
// 编码约定：全文件使用 var / function / 单引号 / 2 空格缩进（Chrome 80 兼容基线，
//   第三方不过构建，必须避免 const/let/箭头函数/模板字符串）

var _seq = 0;

function _nextId(prefix) {
  _seq++;
  return 'ci-' + prefix + '-' + _seq;
}

function _el(tag, className, attrs) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    Object.keys(attrs).forEach(function(k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === 'text') {
        node.textContent = attrs[k];
      } else if (k === 'html') {
        node.innerHTML = attrs[k];
      } else if (k.indexOf('data-') === 0 || k.indexOf('aria-') === 0) {
        node.setAttribute(k, attrs[k]);
      } else {
        node.setAttribute(k, attrs[k]);
      }
    });
  }
  return node;
}

// 收集销毁函数
function _makeFragment(root, cleanups) {
  return {
    root: root,
    update: function(fn) {
      if (typeof fn === 'function') fn(root);
    },
    destroy: function() {
      (cleanups || []).forEach(function(fn) {
        try { fn(); } catch (e) {}
      });
      if (root && root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }
  };
}

// ============================================================
// 片段实现
// ============================================================

// 按钮：options = { label, variant: 'filled'|'tinted'|'plain'|'destructive', size:'sm'|'md'|'lg', icon, onClick, disabled }
function button(options) {
  var opts = options || {};
  var variant = opts.variant || 'filled';
  var size = opts.size || 'md';
  var btn = _el('button', 'ios-btn ios-btn-' + variant + ' ios-btn-' + size, {
    type: 'button'
  });
  btn.textContent = opts.label || '';
  if (opts.disabled) btn.disabled = true;

  var cleanups = [];
  if (typeof opts.onClick === 'function') {
    var handler = function(e) { opts.onClick(e); };
    btn.addEventListener('click', handler);
    cleanups.push(function() { btn.removeEventListener('click', handler); });
  }

  return _makeFragment(btn, cleanups);
}

// 卡片：options = { title, subtitle, padded: true, content: Node|string }
function card(options) {
  var opts = options || {};
  var wrap = _el('div', 'ios-card' + (opts.padded === false ? '' : ' ios-card-padded'));
  var titleEl = null, subEl = null, bodyEl = null;

  if (opts.title) {
    titleEl = _el('div', 'ios-card-title', { text: opts.title });
    wrap.appendChild(titleEl);
  }
  if (opts.subtitle) {
    subEl = _el('div', 'ios-card-subtitle', { text: opts.subtitle });
    wrap.appendChild(subEl);
  }

  bodyEl = _el('div', 'ios-card-body');
  if (opts.content) {
    if (typeof opts.content === 'string') {
      bodyEl.textContent = opts.content;
    } else if (opts.content.nodeType === 1 || opts.content.nodeName) {
      // 判断是否为 DOM 节点：优先 nodeType，其次 nodeName（增强兼容）
      bodyEl.appendChild(opts.content);
    }
  }
  wrap.appendChild(bodyEl);

  return _makeFragment(wrap, [], { title: titleEl, subtitle: subEl, body: bodyEl });
}

// 列表：options = { items: [{ title, subtitle, value, icon, onClick, chevron }] }
function list(options) {
  var opts = options || {};
  var items = opts.items || [];
  var wrap = _el('div', 'ios-list');
  var cleanups = [];

  items.forEach(function(item) {
    var row = _el('div', 'ios-list-item' + (item.onClick ? ' ios-list-item-tappable' : ''));

    var main = _el('div', 'ios-list-item-main');
    if (item.icon) {
      var ic = _el('i', item.icon + ' ios-list-item-icon');
      main.appendChild(ic);
    }
    var textWrap = _el('div', 'ios-list-item-text');
    textWrap.appendChild(_el('div', 'ios-list-item-title', { text: item.title || '' }));
    if (item.subtitle) {
      textWrap.appendChild(_el('div', 'ios-list-item-subtitle', { text: item.subtitle }));
    }
    main.appendChild(textWrap);
    row.appendChild(main);

    var right = _el('div', 'ios-list-item-right');
    if (item.value !== undefined && item.value !== null) {
      right.appendChild(_el('span', 'ios-list-item-value', { text: String(item.value) }));
    }
    if (item.chevron !== false) {
      right.appendChild(_el('i', 'fa-solid fa-chevron-right ios-list-item-chevron'));
    }
    row.appendChild(right);

    if (typeof item.onClick === 'function') {
      var h = (function(fn) {
        return function(e) { fn(e); };
      })(item.onClick);
      row.addEventListener('click', h);
      cleanups.push(function() { row.removeEventListener('click', h); });
    }

    wrap.appendChild(row);
  });

  return _makeFragment(wrap, cleanups);
}

// 徽标：options = { text, variant: 'default'|'success'|'warning'|'danger' }
function badge(options) {
  var opts = options || {};
  var el = _el('span', 'ios-badge ios-badge-' + (opts.variant || 'default'), {
    text: opts.text || ''
  });
  return _makeFragment(el, []);
}

// 分段控件：options = { segments: [{label, value}], value, onChange }
function segmented(options) {
  var opts = options || {};
  var segments = opts.segments || [];
  var current = opts.value;
  var wrap = _el('div', 'ios-segmented');
  var cleanups = [];
  var buttons = [];

  function select(value) {
    current = value;
    buttons.forEach(function(b) {
      if (b.getAttribute('data-value') === String(value)) {
        b.classList.add('is-active');
      } else {
        b.classList.remove('is-active');
      }
    });
    if (typeof opts.onChange === 'function') {
      opts.onChange(value);
    }
  }

  segments.forEach(function(seg) {
    var b = _el('button', 'ios-segmented-item', {
      type: 'button',
      text: seg.label || '',
      'data-value': String(seg.value)
    });
    var h = (function(val) {
      return function() { select(val); };
    })(seg.value);
    b.addEventListener('click', h);
    cleanups.push(function() { b.removeEventListener('click', h); });
    if (String(seg.value) === String(current)) b.classList.add('is-active');
    buttons.push(b);
    wrap.appendChild(b);
  });

  return _makeFragment(wrap, cleanups);
}

// 开关：options = { checked, label, onChange }
function toggle(options) {
  var opts = options || {};
  var checked = !!opts.checked;
  var wrap = _el('label', 'ios-switch-wrap');
  var input = _el('input', 'ios-switch-input', { type: 'checkbox' });
  input.checked = checked;
  var track = _el('span', 'ios-switch-track');
  var knob = _el('span', 'ios-switch-knob');
  track.appendChild(knob);

  var cleanups = [];
  if (typeof opts.onChange === 'function') {
    var h = function(e) {
      checked = input.checked;
      opts.onChange(checked, e);
    };
    input.addEventListener('change', h);
    cleanups.push(function() { input.removeEventListener('change', h); });
  }

  wrap.appendChild(input);
  wrap.appendChild(track);
  if (opts.label) {
    wrap.appendChild(_el('span', 'ios-switch-label', { text: opts.label }));
  }

  return _makeFragment(wrap, cleanups);
}

// 搜索栏：options = { placeholder, value, onInput, onSearch }
function searchBar(options) {
  var opts = options || {};
  var wrap = _el('div', 'ios-search-bar');
  wrap.appendChild(_el('i', 'fa-solid fa-magnifying-glass ios-search-bar-icon'));
  var input = _el('input', 'ios-search-bar-input', {
    type: 'search',
    placeholder: opts.placeholder || '搜索'
  });
  if (opts.value) input.value = opts.value;

  var cleanups = [];
  if (typeof opts.onInput === 'function') {
    var hi = function(e) { opts.onInput(input.value, e); };
    input.addEventListener('input', hi);
    cleanups.push(function() { input.removeEventListener('input', hi); });
  }
  if (typeof opts.onSearch === 'function') {
    var hs = function(e) { opts.onSearch(input.value, e); };
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') hs(e);
    });
  }

  wrap.appendChild(input);
  return _makeFragment(wrap, cleanups);
}

// 空状态：options = { icon, title, description, actionLabel, onAction }
function emptyState(options) {
  var opts = options || {};
  var wrap = _el('div', 'ios-empty-state');
  if (opts.icon) {
    wrap.appendChild(_el('i', opts.icon + ' ios-empty-state-icon'));
  }
  if (opts.title) {
    wrap.appendChild(_el('div', 'ios-empty-state-title', { text: opts.title }));
  }
  if (opts.description) {
    wrap.appendChild(_el('div', 'ios-empty-state-desc', { text: opts.description }));
  }
  var cleanups = [];
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    var b = button({ label: opts.actionLabel, variant: 'tinted', onClick: opts.onAction });
    wrap.appendChild(b.root);
    cleanups.push(b.destroy);
  }
  return _makeFragment(wrap, cleanups);
}

// 加载指示器：options = { text }
function spinner(options) {
  var opts = options || {};
  var wrap = _el('div', 'ios-spinner-wrap');
  wrap.appendChild(_el('div', 'ios-spinner'));
  if (opts.text) {
    wrap.appendChild(_el('div', 'ios-spinner-text', { text: opts.text }));
  }
  return _makeFragment(wrap, []);
}

// 提示条：options = { text, variant }
function toast(options) {
  var opts = options || {};
  var el = _el('div', 'ios-toast ios-toast-' + (opts.variant || 'default'), {
    text: opts.text || ''
  });
  return _makeFragment(el, []);
}

// 区块标题：options = { text }
function sectionTitle(options) {
  var opts = options || {};
  var el = _el('div', 'ios-section-title', { text: opts.text || '' });
  return _makeFragment(el, []);
}

// 工具栏：options = { items: [{ icon, label, onClick, active }] }
function toolbar(options) {
  var opts = options || {};
  var items = opts.items || [];
  var wrap = _el('div', 'ios-toolbar');
  var cleanups = [];

  items.forEach(function(item) {
    var b = _el('button', 'ios-toolbar-item' + (item.active ? ' is-active' : ''), { type: 'button' });
    if (item.icon) b.appendChild(_el('i', item.icon));
    if (item.label) b.appendChild(_el('span', 'ios-toolbar-label', { text: item.label }));
    if (typeof item.onClick === 'function') {
      var h = (function(fn) { return function(e) { fn(e); }; })(item.onClick);
      b.addEventListener('click', h);
      cleanups.push(function() { b.removeEventListener('click', h); });
    }
    wrap.appendChild(b);
  });

  return _makeFragment(wrap, cleanups);
}

// ============================================================
// 样式注入：把片段的样式以 <style> 注入到 document.head（只注入一次）
// 说明：片段样式使用 --ci-* / 旧别名变量，因此自动跟随主题。
//       第三方无需引入任何 CSS 文件。
// ============================================================
var _styleInjected = false;

function ensureStyles() {
  if (_styleInjected || typeof document === 'undefined') return;
  if (document.getElementById('ci-sdk-ui-styles')) {
    _styleInjected = true;
    return;
  }
  var css = [
    /* 按钮 */
    '.ios-btn{border:0;cursor:pointer;font-family:var(--font-family);font-weight:var(--font-weight-semibold);border-radius:var(--radius-sm);transition:opacity var(--duration-fast) var(--ease-standard);-webkit-tap-highlight-color:transparent}',
    '.ios-btn:active{opacity:.7}',
    '.ios-btn:disabled{opacity:.4;cursor:not-allowed}',
    '.ios-btn-sm{padding:6px 12px;font-size:var(--font-size-footnote)}',
    '.ios-btn-md{padding:10px 16px;font-size:var(--font-size-body)}',
    '.ios-btn-lg{padding:14px 22px;font-size:var(--font-size-headline)}',
    '.ios-btn-filled{background:var(--primary-color);color:#fff}',
    '.ios-btn-tinted{background:var(--secondary-bg);color:var(--primary-color)}',
    '.ios-btn-plain{background:transparent;color:var(--primary-color)}',
    '.ios-btn-destructive{background:transparent;color:#ff3b30}',
    /* 卡片 */
    '.ios-card{background:var(--card-bg,var(--secondary-bg));border-radius:var(--radius-lg);overflow:hidden}',
    '.ios-card-padded{padding:var(--spacing-md)}',
    '.ios-card-title{font-size:var(--font-size-headline);font-weight:var(--font-weight-semibold);color:var(--text-primary)}',
    '.ios-card-subtitle{font-size:var(--font-size-footnote);color:var(--text-secondary);margin-top:2px}',
    '.ios-card-body{margin-top:var(--spacing-sm);color:var(--text-primary);font-size:var(--font-size-body)}',
    /* 列表 */
    '.ios-list{background:var(--card-bg,var(--secondary-bg));border-radius:var(--radius-lg);overflow:hidden}',
    '.ios-list-item{display:flex;align-items:center;justify-content:space-between;padding:12px var(--spacing-md);border-bottom:.5px solid var(--separator-color);min-height:44px}',
    '.ios-list-item:last-child{border-bottom:0}',
    '.ios-list-item-tappable{cursor:pointer}',
    '.ios-list-item-tappable:active{background:var(--hover-bg,rgba(0,0,0,.04))}',
    '.ios-list-item-main{display:flex;align-items:center;min-width:0;flex:1}',
    '.ios-list-item-icon{margin-right:10px;color:var(--primary-color);font-size:16px;width:20px;text-align:center}',
    '.ios-list-item-text{min-width:0;flex:1}',
    '.ios-list-item-title{font-size:var(--font-size-body);color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ios-list-item-subtitle{font-size:var(--font-size-footnote);color:var(--text-secondary);margin-top:2px}',
    '.ios-list-item-right{display:flex;align-items:center;flex-shrink:0}',
    '.ios-list-item-right>*+*{margin-left:6px}',
    '.ios-list-item-value{font-size:var(--font-size-body);color:var(--text-secondary)}',
    '.ios-list-item-chevron{font-size:12px;color:var(--text-tertiary,#c7c7cc)}',
    /* 徽标 */
    '.ios-badge{display:inline-block;padding:2px 8px;border-radius:var(--radius-pill,9999px);font-size:var(--font-size-caption1);font-weight:var(--font-weight-medium)}',
    '.ios-badge-default{background:var(--secondary-bg);color:var(--text-secondary)}',
    '.ios-badge-success{background:rgba(52,199,89,.15);color:#34c759}',
    '.ios-badge-warning{background:rgba(255,149,0,.15);color:#ff9500}',
    '.ios-badge-danger{background:rgba(255,59,48,.15);color:#ff3b30}',
    /* 分段控件 */
    '.ios-segmented{display:inline-flex;background:var(--secondary-bg);border-radius:var(--radius-sm);padding:2px}',
    '.ios-segmented-item{border:0;background:transparent;padding:6px 14px;font-size:var(--font-size-footnote);font-family:var(--font-family);color:var(--text-primary);cursor:pointer;border-radius:calc(var(--radius-sm) - 2px);transition:background var(--duration-fast) var(--ease-standard)}',
    '.ios-segmented-item.is-active{background:var(--card-bg,#fff);font-weight:var(--font-weight-semibold);box-shadow:0 1px 3px rgba(0,0,0,.1)}',
    /* 开关 */
    '.ios-switch-wrap{display:inline-flex;align-items:center;cursor:pointer}',
    '.ios-switch-wrap>*+*{margin-left:8px}',
    '.ios-switch-input{position:absolute;opacity:0;width:0;height:0}',
    '.ios-switch-track{position:relative;display:inline-block;width:51px;height:31px;background:var(--separator-color);border-radius:var(--radius-pill,9999px);transition:background var(--duration-normal) var(--ease-standard)}',
    '.ios-switch-knob{position:absolute;top:2px;left:2px;width:27px;height:27px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform var(--duration-normal) var(--ease-standard)}',
    '.ios-switch-input:checked+.ios-switch-track{background:#34c759}',
    '.ios-switch-input:checked+.ios-switch-track .ios-switch-knob{transform:translateX(20px)}',
    '.ios-switch-label{font-size:var(--font-size-body);color:var(--text-primary)}',
    /* 搜索栏 */
    '.ios-search-bar{display:flex;align-items:center;background:var(--input-bg,var(--secondary-bg));border-radius:var(--radius-sm);padding:8px 12px}',
    '.ios-search-bar>*+*{margin-left:8px}',
    '.ios-search-bar-icon{color:var(--text-tertiary,#c7c7cc);font-size:14px}',
    '.ios-search-bar-input{flex:1;border:0;background:transparent;outline:none;font-size:var(--font-size-body);font-family:var(--font-family);color:var(--text-primary)}',
    /* 空状态 */
    '.ios-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center}',
    '.ios-empty-state-icon{font-size:40px;color:var(--text-tertiary,#c7c7cc);margin-bottom:12px}',
    '.ios-empty-state-title{font-size:var(--font-size-headline);font-weight:var(--font-weight-semibold);color:var(--text-primary);margin-bottom:6px}',
    '.ios-empty-state-desc{font-size:var(--font-size-footnote);color:var(--text-secondary);margin-bottom:16px;max-width:280px}',
    /* 加载：循环动画用 linear（§5.5.1 第 9 项豁免）——匀速旋转才自然，缓动会「一冲一停」 */
    '.ios-spinner-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}',
    '.ios-spinner-wrap>*+*{margin-top:10px}',
    '.ios-spinner{width:28px;height:28px;border:3px solid var(--separator-color);border-top-color:var(--primary-color);border-radius:50%;animation:ci-sdk-spin .8s linear infinite}',
    '.ios-spinner-text{font-size:var(--font-size-footnote);color:var(--text-secondary)}',
    '@keyframes ci-sdk-spin{to{transform:rotate(360deg)}}',
    /* 提示条 */
    '.ios-toast{display:inline-block;padding:8px 14px;border-radius:var(--radius-sm);font-size:var(--font-size-footnote);background:var(--secondary-bg);color:var(--text-primary)}',
    '.ios-toast-success{background:rgba(52,199,89,.15);color:#34c759}',
    '.ios-toast-warning{background:rgba(255,149,0,.15);color:#ff9500}',
    '.ios-toast-danger{background:rgba(255,59,48,.15);color:#ff3b30}',
    /* 区块标题 */
    '.ios-section-title{font-size:var(--font-size-footnote);font-weight:var(--font-weight-medium);color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;padding:0 var(--spacing-xs);margin-bottom:6px}',
    /* 工具栏 */
    '.ios-toolbar{display:flex;align-items:center;padding:6px;background:var(--nav-bg);border-top:.5px solid var(--separator-color)}',
    '.ios-toolbar>*+*{margin-left:4px}',
    '.ios-toolbar-item{flex:1;display:flex;flex-direction:column;align-items:center;border:0;background:transparent;padding:6px;cursor:pointer;color:var(--text-secondary);font-family:var(--font-family);font-size:var(--font-size-caption2)}',
    '.ios-toolbar-item>*+*{margin-top:2px}',
    '.ios-toolbar-item.is-active{color:var(--primary-color)}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'ci-sdk-ui-styles';
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
  _styleInjected = true;
}

// 对外 API
var ui = {
  button: button,
  card: card,
  list: list,
  badge: badge,
  segmented: segmented,
  toggle: toggle,
  searchBar: searchBar,
  emptyState: emptyState,
  spinner: spinner,
  toast: toast,
  sectionTitle: sectionTitle,
  toolbar: toolbar,
  // 逃生舱：允许直接创建元素（高级用法）
  el: _el,
  ensureStyles: ensureStyles
};

export {
  ui,
  ensureStyles
};
