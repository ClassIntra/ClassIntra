// 前端核心：SearchRegistry 全局搜索注册表
// 参考 Ditto packages/services/src/search/store.ts
//
// 设计要点：
// 1. 三种搜索源：应用（来自 APP_REGISTRY）+ 命令（registerCommand）+ Provider（registerProvider，自定义搜索）
// 2. 每个 Provider 在独立 try/catch 中执行，异常不中断其他搜索
// 3. 结果统一格式：{ id, title, description, icon, category, action }
// 4. 最近搜索历史存 localStorage（前缀 classintra:search:recent）
// 5. 单例模式 getSearchRegistry()

import { APP_REGISTRY } from './app-registry';
import { getDefaultStore } from './persistence-store';

var STORAGE_KEY_RECENT = 'classintra:search:recent';
var MAX_RECENT = 10;

function SearchRegistry() {
  this._providers = [];   // [{ id, category, search(query) → Promise<result[]>|result[] }]
  this._commands = [];    // [{ id, title, description, icon, keywords, action }]
  this._recentSearches = [];
  this._loadRecent();
}

// ========== Provider 管理 ==========
// provider: { id, category, search(query) }
//   - id: 唯一标识
//   - category: 分组名（如 '笔记'、'社区'）
//   - search: function(query) → 返回 result[] 或 Promise<result[]>
SearchRegistry.prototype.registerProvider = function(provider) {
  if (!provider || !provider.id || typeof provider.search !== 'function') return function() {};
  // 去重：同 id 替换
  var existing = this._providers.findIndex(function(p) { return p.id === provider.id; });
  if (existing !== -1) {
    this._providers[existing] = provider;
  } else {
    this._providers.push(provider);
  }
  var self = this;
  return function() { self.unregisterProvider(provider.id); };
};

SearchRegistry.prototype.unregisterProvider = function(id) {
  var idx = this._providers.findIndex(function(p) { return p.id === id; });
  if (idx !== -1) this._providers.splice(idx, 1);
};

// ========== Command 管理 ==========
// command: { id, title, description, icon, keywords, action }
//   - keywords: 字符串数组，用于匹配
//   - action: function() 执行命令
SearchRegistry.prototype.registerCommand = function(command) {
  if (!command || !command.id || !command.title) return function() {};
  var existing = this._commands.findIndex(function(c) { return c.id === command.id; });
  if (existing !== -1) {
    this._commands[existing] = command;
  } else {
    this._commands.push(command);
  }
  var self = this;
  return function() { self.unregisterCommand(command.id); };
};

SearchRegistry.prototype.unregisterCommand = function(id) {
  var idx = this._commands.findIndex(function(c) { return c.id === id; });
  if (idx !== -1) this._commands.splice(idx, 1);
};

// ========== 搜索主入口 ==========
// 返回 Promise<{ groups: [{ category, items: [result] }], total }>
SearchRegistry.prototype.search = function(query) {
  var q = (query || '').trim().toLowerCase();
  if (!q) {
    return Promise.resolve({ groups: [], total: 0 });
  }

  var self = this;
  var groups = [];
  var total = 0;

  // 1. 应用搜索
  var appResults = this._searchApps(q);
  if (appResults.length > 0) {
    groups.push({ category: '应用', items: appResults });
    total += appResults.length;
  }

  // 2. 命令搜索
  var cmdResults = this._searchCommands(q);
  if (cmdResults.length > 0) {
    groups.push({ category: '命令', items: cmdResults });
    total += cmdResults.length;
  }

  // 3. Provider 搜索（异步聚合）
  var providerPromises = this._providers.map(function(p) {
    try {
      var r = p.search(q);
      if (r && typeof r.then === 'function') {
        return r.then(function(items) {
          return { category: p.category || p.id, items: items || [] };
        }).catch(function(e) {
          console.error('[SearchRegistry] provider "' + p.id + '" 搜索失败:', e);
          return { category: p.category || p.id, items: [] };
        });
      }
      return Promise.resolve({ category: p.category || p.id, items: r || [] });
    } catch (e) {
      console.error('[SearchRegistry] provider "' + p.id + '" 异常:', e);
      return Promise.resolve({ category: p.category || p.id, items: [] });
    }
  });

  return Promise.all(providerPromises).then(function(providerResults) {
    for (var i = 0; i < providerResults.length; i++) {
      var pr = providerResults[i];
      if (pr.items.length > 0) {
        groups.push(pr);
        total += pr.items.length;
      }
    }
    return { groups: groups, total: total };
  });
};

// 应用搜索：匹配 name/label
SearchRegistry.prototype._searchApps = function(q) {
  var results = [];
  for (var i = 0; i < APP_REGISTRY.length; i++) {
    var app = APP_REGISTRY[i];
    var name = (app.name || '').toLowerCase();
    var label = (app.label || '').toLowerCase();
    if (name.indexOf(q) !== -1 || label.indexOf(q) !== -1) {
      results.push({
        id: 'app:' + app.name,
        title: app.label || app.name,
        description: '打开应用',
        icon: app.icon || '',
        iconColor: app.color || '',
        category: '应用',
        action: function(route) {
          return function() {
            if (route && window.__router) {
              window.__router.push(route);
            }
          };
        }(app.route)
      });
    }
  }
  return results;
};

// 命令搜索：匹配 title/keywords
SearchRegistry.prototype._searchCommands = function(q) {
  var results = [];
  for (var i = 0; i < this._commands.length; i++) {
    var cmd = this._commands[i];
    var title = (cmd.title || '').toLowerCase();
    var keywords = (cmd.keywords || []).join(' ').toLowerCase();
    var desc = (cmd.description || '').toLowerCase();
    if (title.indexOf(q) !== -1 || keywords.indexOf(q) !== -1 || desc.indexOf(q) !== -1) {
      results.push({
        id: 'cmd:' + cmd.id,
        title: cmd.title,
        description: cmd.description || '',
        icon: cmd.icon || '',
        iconColor: '',
        category: '命令',
        action: cmd.action
      });
    }
  }
  return results;
};

// ========== 最近搜索历史 ==========
SearchRegistry.prototype.addRecentSearch = function(query) {
  var q = (query || '').trim();
  if (!q) return;
  // 去重：已存在则移到最前
  var idx = this._recentSearches.indexOf(q);
  if (idx !== -1) this._recentSearches.splice(idx, 1);
  this._recentSearches.unshift(q);
  if (this._recentSearches.length > MAX_RECENT) {
    this._recentSearches = this._recentSearches.slice(0, MAX_RECENT);
  }
  this._saveRecent();
};

SearchRegistry.prototype.clearRecentSearches = function() {
  this._recentSearches = [];
  this._saveRecent();
};

SearchRegistry.prototype.getRecentSearches = function() {
  return this._recentSearches.slice();
};

SearchRegistry.prototype._loadRecent = function() {
  try {
    var store = getDefaultStore();
    var raw = store.get('search:recent');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this._recentSearches = parsed.slice(0, MAX_RECENT);
      }
    }
  } catch (e) {
    // persistence-store 不可用时降级到 localStorage
    try {
      var raw2 = localStorage.getItem(STORAGE_KEY_RECENT);
      if (raw2) {
        var parsed2 = JSON.parse(raw2);
        if (Array.isArray(parsed2)) {
          this._recentSearches = parsed2.slice(0, MAX_RECENT);
        }
      }
    } catch (e2) {}
  }
};

SearchRegistry.prototype._saveRecent = function() {
  var json = JSON.stringify(this._recentSearches);
  try {
    var store = getDefaultStore();
    store.set('search:recent', json);
  } catch (e) {
    try {
      localStorage.setItem(STORAGE_KEY_RECENT, json);
    } catch (e2) {}
  }
};

// ========== 单例 ==========
var _instance = null;
function getSearchRegistry() {
  if (!_instance) {
    _instance = new SearchRegistry();
  }
  return _instance;
}

export {
  SearchRegistry,
  getSearchRegistry
};
