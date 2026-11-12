import api from '@/utils/api';
import { getRuntimeKernel } from '@/core/runtime-kernel';

var installedApps = [];
// 开发预览（devkit preview 免安装挂载）：与已装应用合并参与路由/桌面/悬浮层，
// 但独立保存——不进 knownNames（预览注销不清本地数据），资源随 syncPreviews 单独清理。
var previewApps = [];
var definitions = {};
var loadedScripts = {};
var loadedStyles = {};
var loading = {};
var loadedVersions = {};
var mountedRuntimes = {};
var loadGeneration = {};
var listeners = [];
// 曾出现在完整清单中的应用名（含停用者）——用于识别「卸载」：
// 停用的应用仍在完整清单里（只是 enabled=false），卸载的则彻底消失。
var knownNames = {};

function getEntry(app) {
  return app.frontendEntry || 'frontend/entry.js';
}

function getStyle(app) {
  return app.frontendStyle || '';
}

function emit() {
  var merged = allApps();
  listeners.slice().forEach(function(listener) {
    try { listener(merged); } catch (e) {}
  });
}

// 对外清单 = 已安装 + 开发预览。消费方（路由注册/桌面/悬浮层/小组件）无需感知预览概念。
function allApps() {
  return previewApps.length ? installedApps.concat(previewApps) : installedApps;
}

function onChange(listener) {
  if (typeof listener !== 'function') return function() {};
  listeners.push(listener);
  return function() {
    var index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
  };
}

function define(definition) {
  if (!definition || !definition.name || typeof definition.mount !== 'function') {
    throw new Error('市场应用入口定义无效');
  }
  if (definitions[definition.name] && definitions[definition.name] !== definition) {
    unmount(definition.name);
  }
  definitions[definition.name] = definition;
  return definition;
}

// 预览应用的静态资源走服务端 /market-static-dev/ 前缀（manifest 带 _staticBase 透传）；
// 正常安装一律同源 /market-static/。
function staticBase(app) {
  return app._staticBase || ('/market-static/' + app.name + '/');
}

// 缓存击穿参数：正常安装按版本号；预览按挂载时间戳（devkit 重挂会刷新 _previewAt，
// 改完文件刷新页面即拿到新资源；服务端对该前缀 always no-store 兜底）。
function bustValue(app) {
  return app._preview ? String(app._previewAt || '') : (app.version || '');
}

function bustParam(app) {
  return (app._preview ? 't=' : 'v=') + encodeURIComponent(bustValue(app));
}

function scriptUrl(app) {
  return staticBase(app) + getEntry(app).replace(/^\.\//, '');
}

function styleUrl(app) {
  if (!getStyle(app)) return '';
  return staticBase(app) + getStyle(app).replace(/^\.\//, '');
}

function loadScript(app) {
  if (loadedScripts[app.name]) return Promise.resolve();
  var generation = loadGeneration[app.name] || 0;
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = scriptUrl(app) + '?' + bustParam(app);
    script.async = true;
    script.onload = function() {
      if (generation !== (loadGeneration[app.name] || 0) || getInstalled(app.name) !== app) {
        reject(new Error('应用已卸载'));
        return;
      }
      loadedScripts[app.name] = script;
      resolve();
    };
    script.onerror = function() { reject(new Error('应用入口加载失败')); };
    document.head.appendChild(script);
  });
}

function loadStyle(app) {
  var url = styleUrl(app);
  if (!url || loadedStyles[app.name]) return;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url + '?' + bustParam(app);
  link.dataset.marketApp = app.name;
  loadedStyles[app.name] = link;
  document.head.appendChild(link);
}

function unmount(appName, container) {
  var runtime = mountedRuntimes[appName];
  if (!runtime || (container && runtime.container !== container)) return;

  // 1. 只销毁本页面容器自己的 context。
  //    绝不能调宿主 disposeContext(appName) 全清——同名应用的悬浮层/小组件上下文
  //    会被一并误杀（症状：从应用返回桌面后桌宠等 overlay 消失且不再复活）
  try {
    if (runtime.context && runtime.context.__internal && typeof runtime.context.__internal.dispose === 'function') {
      runtime.context.__internal.dispose();
    }
  } catch (e) {
    console.error('[market-registry] 页面 context 销毁失败:', appName, e);
  }

  // 2. 调用应用定义的 unmount
  if (runtime.definition && typeof runtime.definition.unmount === 'function') {
    try { runtime.definition.unmount(runtime.container); } catch (e) {}
  }

  // 3. 释放资源审计（回收挂载期遗留的计时器与监听器）
  try {
    var kernel = getRuntimeKernel();
    var machine = kernel.getMachine(appName);
    if (machine && machine.getState() !== 'idle') {
      machine.unmount();
    }
  } catch (e) {}

  delete mountedRuntimes[appName];
}

function unloadAssets(appName) {
  unmount(appName);
  loadGeneration[appName] = (loadGeneration[appName] || 0) + 1;
  delete loading[appName];
  var script = loadedScripts[appName];
  if (script && script.parentNode) script.parentNode.removeChild(script);
  var style = loadedStyles[appName];
  if (style && style.parentNode) style.parentNode.removeChild(style);
  delete loadedScripts[appName];
  delete loadedStyles[appName];
  delete loadedVersions[appName];
  delete definitions[appName];
}

// 卸载（而非停用/更新）时的彻底清除：不留任何本地残留。
// 停用与更新不走到这里 —— 重新启用/重装后数据仍在。
function purgeAppData(appName) {
  // 1. 命名空间 localStorage：ci:app:<name>:*（SDK storage 的强制前缀）
  try {
    var prefix = 'ci:app:' + appName + ':';
    var doomed = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) doomed.push(k);
    }
    doomed.forEach(function(k) { localStorage.removeItem(k); });
  } catch (e) {}
  // 2. SDK 全局登记表（definition 闭包滞留会占内存）
  try {
    if (window.ClassIntraMarket && window.ClassIntraMarket.apps) {
      delete window.ClassIntraMarket.apps[appName];
    }
  } catch (e) {}
  // 3. 统一模块注册表（否则诊断摘要里永久显示已卸载应用）
  try {
    var kernel = getRuntimeKernel();
    // 3a. 生命周期机与审计器（内核 _machines/_auditors 登记项，含包装器栈出栈）
    if (typeof kernel.detachLifecycle === 'function') kernel.detachLifecycle(appName);
    if (kernel.modules && typeof kernel.modules.remove === 'function') {
      kernel.modules.remove('app', appName);
    }
  } catch (e) {}
}

function reload(name) {
  var active = getInstalled(name);
  if (!active) return Promise.reject(new Error('应用未安装'));
  unloadAssets(name);
  return ensureLoaded(name);
}

function syncInstalled(apps) {
  var raw = Array.isArray(apps) ? apps : [];
  var next = raw.filter(function(app) {
    return app && app.name && app.enabled !== false;
  });
  var active = {};
  next.forEach(function(app) {
    if (app && app.name) active[app.name] = app;
  });
  // 预览应用不在已装清单里，资源清理判定必须一并计入，否则每次 syncInstalled
  // 都会把预览应用的脚本/样式误卸载
  previewApps.forEach(function(app) {
    if (app && app.name) active[app.name] = app;
  });
  var rawNames = {};
  raw.forEach(function(app) {
    if (app && app.name) rawNames[app.name] = true;
  });
  // 卸载识别：曾出现在完整清单、这次连完整清单都没有 → 彻底清除本地数据
  //（停用者仍在完整清单中，只做资源卸载，不 purge —— 重新启用后数据还在）
  var purged = [];
  Object.keys(knownNames).forEach(function(name) {
    if (!rawNames[name]) {
      purgeAppData(name);
      delete knownNames[name];
      purged.push(name);
    }
  });
  var resources = {};
  Object.keys(loadedScripts).forEach(function(name) { resources[name] = true; });
  Object.keys(loadedStyles).forEach(function(name) { resources[name] = true; });
  Object.keys(loading).forEach(function(name) { resources[name] = true; });
  Object.keys(mountedRuntimes).forEach(function(name) { resources[name] = true; });
  Object.keys(resources).forEach(function(name) {
    if (!active[name]) unloadAssets(name);
  });
  raw.forEach(function(app) {
    if (app && app.name) knownNames[app.name] = true;
  });
  installedApps = next.slice();
  emit();
  if (purged.length) console.log('[market-registry] 已彻底清除已卸载应用的本地数据:', purged.join(', '));
  return installedApps.slice();
}

function fetchInstalled() {
  return api.get('/market/installed').then(function(response) {
    return syncInstalled((response.data && response.data.data && response.data.data.apps) || []);
  });
}

// 本地会话是否班管/管理员（与 routes/market.js /installed 的判定口径一致）。
// 预览是开发期特性：学生端不发注定 403 的请求，也不响应预览 WS 推送。
function localSessionIsAdmin() {
  try {
    var user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user) return true; // 登录信息缺失时无法判定 → 仍尝试（服务端闸门兜底）
    return user.is_admin === 1 || user.is_admin === true || user.is_class_admin === true;
  } catch (e) {
    return true;
  }
}

// 开发预览清单（仅班管会话能拉到；403 = 非班管或服务端未开 CLASSINTRA_DEV_PREVIEW，
// 静默清空——预览是开发期特性，不能给普通用户制造噪音）。
function syncPreviews(apps) {
  var raw = Array.isArray(apps) ? apps : [];
  var next = raw.filter(function(app) { return app && app.name && app._preview; });
  var active = {};
  next.forEach(function(app) { active[app.name] = app; });
  previewApps.forEach(function(app) {
    if (app && app.name && !active[app.name]) unloadAssets(app.name);
  });
  previewApps = next;
  emit();
  return previewApps.slice();
}

function fetchPreviews() {
  if (!localSessionIsAdmin()) {
    if (previewApps.length) syncPreviews([]);
    return Promise.resolve([]);
  }
  return api.get('/market/dev-preview').then(function(response) {
    return syncPreviews((response.data && response.data.data && response.data.data.apps) || []);
  }).catch(function() {
    if (previewApps.length) syncPreviews([]);
    return [];
  });
}

function getInstalled(name) {
  for (var i = 0; i < installedApps.length; i++) {
    if (installedApps[i].name === name) return installedApps[i];
  }
  for (var j = 0; j < previewApps.length; j++) {
    if (previewApps[j].name === name) return previewApps[j];
  }
  return null;
}

// semver 比较：host >= min 返回 true（只比 x.y.z 数值段，忽略 prerelease 后缀）
function hostSatisfies(host, min) {
  var a = String(host).replace(/^v/, '').split('.');
  var b = String(min).replace(/^v/, '').split('.');
  for (var i = 0; i < 3; i++) {
    var x = parseInt(a[i], 10) || 0;
    var y = parseInt(b[i], 10) || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function ensureLoaded(name) {
  var app = getInstalled(name);
  if (!app) return Promise.reject(new Error('应用未安装'));
  // minHostVersion 挂载闸（第二道；第一道在服务端安装/预览时）：
  // 宿主版本已知且不满足 → 明确拒绝，不给用户天书报错。版本未知（接口失败/旧宿主）→ 放行。
  var minHost = app.minHostVersion;
  if (minHost && window.ClassIntraMarket && typeof window.ClassIntraMarket.getHostVersion === 'function') {
    var hostVersion = window.ClassIntraMarket.getHostVersion();
    if (hostVersion && !hostSatisfies(hostVersion, minHost)) {
      return Promise.reject(new Error('此应用要求 ClassIntra ≥ v' + minHost + '，当前宿主为 v' + hostVersion + '——请升级宿主后再使用'));
    }
  }
  // 预览以 _previewAt 参与失效判定：devkit 重挂后版本号不变但时间戳变了，必须重新加载
  if (loadedVersions[name] !== undefined && loadedVersions[name] !== bustValue(app)) {
    unloadAssets(name);
  }
  if (loading[name]) return loading[name];
  var generation = loadGeneration[name] || 0;
  loading[name] = loadScript(app).then(function() {
    loadStyle(app);
    loadedVersions[name] = bustValue(app);
    var definition = definitions[name] || (window.ClassIntraMarket && window.ClassIntraMarket.apps && window.ClassIntraMarket.apps[name]);
    if (!definition) throw new Error('应用未注册运行时入口');
    if (generation !== (loadGeneration[name] || 0) || getInstalled(name) !== app) {
      throw new Error('应用已卸载');
    }
    return { app: app, definition: definition };
  }).finally(function() {
    if (loading[name]) delete loading[name];
  });
  return loading[name];
}

function mount(name, container, definition) {
  if (!container || !definition || typeof definition.mount !== 'function') return false;
  var app = getInstalled(name);
  if (app === null) return false;

  // 构造 SDK 上下文（五大命名空间；manifest 一并传入供 context.app.manifest 使用）
  var manifest = definition.manifest || app;
  var context = window.ClassIntraMarket.createContext(name, manifest);
  if (!context || !context.data) return false;

  try {
    definition.mount(container, context);
  } catch (error) {
    console.error('[MarketRuntime] 应用挂载失败:', name, error);
    // 挂载失败时只释放页面自己刚建的 context（不能全清 appName——会误杀悬浮层等同名上下文）
    try {
      if (context && context.__internal && typeof context.__internal.dispose === 'function') {
        context.__internal.dispose();
      }
    } catch (e) {}
    throw error;
  }
  mountedRuntimes[name] = { container: container, definition: definition, context: context };
  return true;
}

function refresh() {
  // 预览清单并入同一次刷新：main.js 启动期 registerMarketApps 拿到的列表必须
  // 已含预览应用，否则刷新页面打开预览路由会 404 兜底回桌面（WS 推送救不了首屏）。
  // 非班管会话 fetchPreviews 403 静默清空，不阻断已装应用流程。
  return Promise.all([fetchInstalled(), fetchPreviews()]).then(function() {
    return allApps();
  });
}

var registry = {
  define: define,
  onChange: onChange,
  refresh: refresh,
  getInstalled: getInstalled,
  ensureLoaded: ensureLoaded,
  mount: mount,
  unmount: unmount,
  unloadAssets: unloadAssets,
  reload: reload,
  syncInstalled: syncInstalled,
  syncPreviews: syncPreviews,
  fetchPreviews: fetchPreviews,
  getLoadedVersion: function(name) { return loadedVersions[name] || ''; },
  getInstalledApps: function() { return allApps().slice(); }
};

export { registry as marketRegistry, define };
