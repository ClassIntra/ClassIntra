import api from '@/utils/api';

var installedApps = [];
var definitions = {};
var loadedScripts = {};
var loadedStyles = {};
var loading = {};
var loadedVersions = {};
var mountedRuntimes = {};
var loadGeneration = {};
var listeners = [];

function getEntry(app) {
  return app.frontendEntry || 'frontend/entry.js';
}

function getStyle(app) {
  return app.frontendStyle || '';
}

function emit() {
  listeners.slice().forEach(function(listener) {
    try { listener(installedApps.slice()); } catch (e) {}
  });
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

function scriptUrl(app) {
  return '/market-static/' + app.name + '/' + getEntry(app).replace(/^\.\//, '');
}

function styleUrl(app) {
  if (!getStyle(app)) return '';
  return '/market-static/' + app.name + '/' + getStyle(app).replace(/^\.\//, '');
}

function loadScript(app) {
  if (loadedScripts[app.name]) return Promise.resolve();
  var generation = loadGeneration[app.name] || 0;
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = scriptUrl(app) + '?v=' + encodeURIComponent(app.version || '');
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
  link.href = url + '?v=' + encodeURIComponent(app.version || '');
  link.dataset.marketApp = app.name;
  loadedStyles[app.name] = link;
  document.head.appendChild(link);
}

function unmount(appName, container) {
  var runtime = mountedRuntimes[appName];
  if (!runtime || (container && runtime.container !== container)) return;
  if (runtime.definition && typeof runtime.definition.unmount === 'function') {
    try { runtime.definition.unmount(runtime.container); } catch (e) {}
  }
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

function reload(name) {
  var active = getInstalled(name);
  if (!active) return Promise.reject(new Error('应用未安装'));
  unloadAssets(name);
  return ensureLoaded(name);
}

function syncInstalled(apps) {
  var next = (Array.isArray(apps) ? apps : []).filter(function(app) {
    return app && app.name && app.enabled !== false;
  });
  var active = {};
  next.forEach(function(app) {
    if (app && app.name) active[app.name] = app;
  });
  var resources = {};
  Object.keys(loadedScripts).forEach(function(name) { resources[name] = true; });
  Object.keys(loadedStyles).forEach(function(name) { resources[name] = true; });
  Object.keys(loading).forEach(function(name) { resources[name] = true; });
  Object.keys(mountedRuntimes).forEach(function(name) { resources[name] = true; });
  Object.keys(resources).forEach(function(name) {
    if (!active[name]) unloadAssets(name);
  });
  installedApps = next.slice();
  emit();
  return installedApps.slice();
}

function fetchInstalled() {
  return api.get('/market/installed').then(function(response) {
    return syncInstalled((response.data && response.data.data && response.data.data.apps) || []);
  });
}

function getInstalled(name) {
  for (var i = 0; i < installedApps.length; i++) {
    if (installedApps[i].name === name) return installedApps[i];
  }
  return null;
}

function ensureLoaded(name) {
  var app = getInstalled(name);
  if (!app) return Promise.reject(new Error('应用未安装'));
  if (loadedVersions[name] !== undefined && loadedVersions[name] !== (app.version || '')) {
    unloadAssets(name);
  }
  if (loading[name]) return loading[name];
  var generation = loadGeneration[name] || 0;
  loading[name] = loadScript(app).then(function() {
    loadStyle(app);
    loadedVersions[name] = app.version || '';
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
  if (getInstalled(name) === null) return false;
  definition.mount(container, window.ClassIntraMarket.createContext(name));
  mountedRuntimes[name] = { container: container, definition: definition };
  return true;
}

function refresh() {
  return fetchInstalled();
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
  getLoadedVersion: function(name) { return loadedVersions[name] || ''; },
  getInstalledApps: function() { return installedApps.slice(); }
};

export { registry as marketRegistry, define };
