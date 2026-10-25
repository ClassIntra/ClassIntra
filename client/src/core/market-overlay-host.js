// 前端核心：市场应用全局悬浮层宿主
// ============================================================
// 让「已安装且启用」的市场应用能够在任意页面挂载全局悬浮 UI（如桌宠、倒计时浮窗）。
//
// 契约（详见 docs/market-dev-guide.md）：
//   1. manifest 声明 frontend.overlay: "./frontend/overlay.js"（可选，缺省无悬浮层）
//   2. overlay.js 与 entry.js 同构：IIFE + window.ClassIntraMarket.defineOverlay({ name, mount, unmount })
//   3. mount(container, context) 收到的 container 满足：
//        position:fixed; inset:0; pointer-events:none; z-index:9400
//      应用需在自身根元素上设置 pointer-events:auto 才能接收交互；
//      容器本身不拦截页面其余部分的点击。
//   4. 挂载/摘除由宿主随市场清单同步（启动 + WS market_app_changed /
//      market_app_control_changed 驱动），应用无需自行管理生命周期
//   5. 应用卸载时，其 ci:app:<name>:* 本地数据由 market-registry 统一清除
//
// 层级依据 global.scss z-index 约定：低于 SuperIsland(10000) / Modal(10001) /
// Toast(99997) / 大字指令(50000) / 锁屏(99999)，高于桌面浮层(1100/1200)。
//
// 编码约定：var / function / 单引号（Chrome 80 基线）

import { getRuntimeKernel } from '@/core/runtime-kernel';
import { marketRegistry } from '@/core/market-registry';

var OVERLAY_Z_INDEX = 9400;
var OVERLAY_MAX_RETRIES = 3;   // 挂载失败自动重试次数（服务崩溃自动恢复的类比）
var OVERLAY_RETRY_BASE_MS = 15000;
var definitions = {};      // name -> { name, mount, unmount }
var containers = {};       // name -> 全屏悬浮容器 div
var loadedStyles = {};     // name -> <link> 元素（悬浮层样式）
var contexts = {};         // name -> 挂载时创建的 SDK context（销毁时只释放自己的）
var loadedScripts = {};    // name -> <script> 元素
var loadedVersions = {};   // name -> 已加载版本
var loading = {};          // name -> Promise
var loadGeneration = {};   // name -> 代数（dispose 时自增，使迟到的 onload 失效）
var mountRetries = {};     // name -> 已重试次数（成功后清零）

function registerOverlayDefinition(definition) {
  if (!definition || !definition.name || typeof definition.mount !== 'function') {
    throw new Error('市场悬浮层定义无效（需要 name 与 mount）');
  }
  definitions[definition.name] = definition;
  return definition;
}

function overlayUrl(app) {
  var entry = app && app.overlayEntry;
  if (!entry) return '';
  return '/market-static/' + app.name + '/' + String(entry).replace(/^\.\//, '');
}

// 摘除单个悬浮层：onDestroy 契约 → 应用 unmount → 资源审计回收 → 移除 DOM/script
function disposeOne(name) {
  loadGeneration[name] = (loadGeneration[name] || 0) + 1;
  var container = containers[name];
  // 1. 只释放本悬浮层创建的 context（同名应用的页面/小组件 context 不受影响；
  //    应用整体卸载时由 market-registry 走 disposeContext 兜底）
  var ctx = contexts[name];
  if (ctx && ctx.__internal && typeof ctx.__internal.dispose === 'function') {
    try { ctx.__internal.dispose(); } catch (e) {}
  }
  // 2. 应用定义的 unmount
  var def = definitions[name];
  if (def && typeof def.unmount === 'function' && container) {
    try { def.unmount(container); } catch (e) {}
  }
  // 3. 资源审计回收
  try {
    var kernel = getRuntimeKernel();
    var machine = kernel.getMachine(name);
    if (machine && machine.getState && machine.getState() !== 'idle') machine.unmount();
  } catch (e) {}
  if (container && container.parentNode) container.parentNode.removeChild(container);
  var script = loadedScripts[name];
  if (script && script.parentNode) script.parentNode.removeChild(script);
  var styleLink = loadedStyles[name];
  if (styleLink && styleLink.parentNode) styleLink.parentNode.removeChild(styleLink);
  delete containers[name];
  delete contexts[name];
  delete loadedScripts[name];
  delete loadedStyles[name];
  delete loadedVersions[name];
  delete loading[name];
  delete definitions[name];
  delete mountRetries[name];
}

// 挂载失败后的自动重试（指数退避：15s/30s/45s；代数变化即放弃）
function scheduleMountRetry(app, generation, retryCount) {
  var delay = OVERLAY_RETRY_BASE_MS * retryCount;
  var name = app.name;
  setTimeout(function() {
    if (generation !== (loadGeneration[name] || 0)) return;      // 已卸载/换代
    if (containers[name] || loading[name]) return;               // 已恢复
    var current = marketRegistry.getInstalled(name);             // 仍是已安装且启用的版本
    if (!current || !current.overlayEntry) return;
    console.warn('[market-overlay] 第 ' + retryCount + ' 次重试挂载悬浮层:', name);
    mountOne(current, generation, retryCount);
  }, delay);
}

function mountOne(app, generation, retryCount) {
  var url = overlayUrl(app);
  if (!url) return Promise.resolve(false);
  var retry = retryCount || 0;
  loading[app.name] = new Promise(function(resolve) {
    // 悬浮层样式：与脚本一同加载（缺失 = 悬浮层 DOM 无 position/尺寸，会被页面裁剪为不可见）
    if (app.frontendStyle) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/market-static/' + app.name + '/' + String(app.frontendStyle).replace(/^\.\//, '') +
        '?v=' + encodeURIComponent(app.version || '');
      link.dataset.marketOverlay = app.name;
      loadedStyles[app.name] = link;
      document.head.appendChild(link);
    }
    var script = document.createElement('script');
    script.src = url + '?v=' + encodeURIComponent(app.version || '');
    script.async = true;
    script.onload = function() {
      if (generation !== (loadGeneration[app.name] || 0)) return resolve(false);
      loadedScripts[app.name] = script;
      loadedVersions[app.name] = app.version || '';
      var def = definitions[app.name];
      if (!def) {
        console.error('[market-overlay] 悬浮层脚本未调用 defineOverlay:', app.name);
        resolve(false);
        return;
      }
      var container = document.createElement('div');
      container.className = 'ci-market-overlay-host';
      container.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;' +
        'pointer-events:none;z-index:' + OVERLAY_Z_INDEX + ';overflow:hidden;';
      container.dataset.marketOverlay = app.name;
      document.body.appendChild(container);
      containers[app.name] = container;
      var context = null;
      try {
        if (window.ClassIntraMarket && typeof window.ClassIntraMarket.createContext === 'function') {
          context = window.ClassIntraMarket.createContext(app.name, app);
        }
      } catch (e) {}
      contexts[app.name] = context;
      try {
        def.mount(container, context);
        mountRetries[app.name] = 0; // 成功即清零重试计数
      } catch (error) {
        console.error('[market-overlay] 悬浮层挂载失败:', app.name, error);
        disposeOne(app.name);
        if (retry < OVERLAY_MAX_RETRIES) {
          mountRetries[app.name] = retry + 1;
          scheduleMountRetry(app, generation, retry + 1);
        } else {
          console.error('[market-overlay] 悬浮层连续 ' + OVERLAY_MAX_RETRIES + ' 次挂载失败，放弃:', app.name);
        }
      }
      resolve(true);
    };
    script.onerror = function() {
      if (retry < OVERLAY_MAX_RETRIES) {
        console.warn('[market-overlay] 悬浮层脚本加载失败，将重试:', app.name);
        scheduleMountRetry(app, generation, retry + 1);
      } else {
        console.warn('[market-overlay] 悬浮层脚本加载失败（重试耗尽）:', app.name);
      }
      resolve(false);
    };
    document.head.appendChild(script);
  }).finally(function() {
    if (loading[app.name] && generation === (loadGeneration[app.name] || 0)) delete loading[app.name];
  });
  return loading[app.name];
}

// 与市场清单同步。apps = marketRegistry.refresh() 的返回值
//（已过滤为「已安装且启用」的应用列表，含 overlayEntry / version 字段）。
// 调用时机：启动 market 阶段 + App.vue syncMarketAppControl（WS 装卸/启停/更新）。
function syncOverlays(apps) {
  var list = Array.isArray(apps) ? apps : [];
  var wanted = {};
  for (var i = 0; i < list.length; i++) {
    var app = list[i];
    if (app && app.overlayEntry) wanted[app.name] = app;
  }
  // 摘除：已挂载但不再需要（卸载 / 停用 / 版本更新）
  Object.keys(containers).forEach(function(name) {
    var app = wanted[name];
    if (!app || (app.version || '') !== (loadedVersions[name] || '')) disposeOne(name);
  });
  // 挂载
  var jobs = [];
  Object.keys(wanted).forEach(function(name) {
    if (containers[name] || loading[name]) return;
    jobs.push(mountOne(wanted[name], loadGeneration[name] || 0));
  });
  return Promise.all(jobs).then(function() { return true; }).catch(function() { return false; });
}

export { registerOverlayDefinition, syncOverlays };
