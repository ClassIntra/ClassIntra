import api from '@/utils/api';

// 应用元数据注册表：单一数据源，store 和组件均引用
// 字段：name（唯一标识）、label、icon、color、route
var APP_REGISTRY = [
  { name: 'chat', label: '聊天', icon: '/resources/public/icons/Chat.svg', color: '#007AFF', route: '/chat' },
  { name: 'community', label: '社区', icon: '/resources/public/icons/Community.svg', color: '#FF9500', route: '/community' },
  { name: 'ai-chat', label: 'AI', icon: '/resources/public/icons/AI-Chat.svg', color: '#AF52DE', route: '/ai-chat' },
  { name: 'notes', label: '笔记', icon: '/resources/public/icons/Note.svg', color: '#FFCC00', route: '/notes' },
  { name: 'resource', label: '资源', icon: '/resources/public/icons/Files.svg', color: '#5856D6', route: '/resource' },
  { name: 'weather', label: '天气', icon: '/resources/public/icons/Weather.svg', color: '#5AC8FA', route: '/weather' },
  { name: 'music', label: '音乐', icon: '/resources/public/icons/Music.svg', color: '#FF2D55', route: '/music' },
  { name: 'settings', label: '设置', icon: '/resources/public/icons/Settings.svg', color: '#8E8E93', route: '/settings' }
];

// 网格规格
var MAX_PAGES = 9;
var MAX_DOCK = 4;
var SLOTS_PER_PAGE = 24;

// localStorage 缓存键
var LS_CACHE_KEY = 'classnet_desktop_layout';

// 深拷贝布局（避免直接修改 state）
function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

// 根据 enabledAppNames 生成默认布局
// 默认 Dock: chat/community/notes/settings（若启用）；非 Dock 应用按顺序填 page-0
function buildDefaultLayout(enabledAppNames) {
  var names = enabledAppNames || [];
  var dockCandidates = ['chat', 'community', 'notes', 'settings'];
  var dock = dockCandidates.filter(function(n) {
    return names.indexOf(n) !== -1;
  }).slice(0, MAX_DOCK);

  var nonDockApps = names.filter(function(n) {
    return dock.indexOf(n) === -1;
  });

  var slots = new Array(SLOTS_PER_PAGE).fill(null);
  for (var i = 0; i < nonDockApps.length && i < SLOTS_PER_PAGE; i++) {
    slots[i] = { type: 'app', name: nonDockApps[i] };
  }

  return {
    version: 1,
    pages: [{ id: 'page-0', slots: slots }],
    dock: dock,
    pinnedApps: ['settings'],
    folders: {}
  };
}

// 合并服务端布局与默认布局，确保结构完整
function normalizeLayout(serverLayout, enabledAppNames) {
  if (!serverLayout || typeof serverLayout !== 'object') {
    return buildDefaultLayout(enabledAppNames);
  }
  // 基础校验，不合法则回退默认
  if (!Array.isArray(serverLayout.pages) || serverLayout.pages.length < 1) {
    return buildDefaultLayout(enabledAppNames);
  }
  // 确保 pages 数量在 1-9
  var pages = serverLayout.pages.slice(0, MAX_PAGES);
  // 规范化每页 slots 长度
  pages = pages.map(function(page, pi) {
    var slots = Array.isArray(page.slots) ? page.slots.slice(0, SLOTS_PER_PAGE) : [];
    while (slots.length < SLOTS_PER_PAGE) slots.push(null);
    return {
      id: typeof page.id === 'string' ? page.id : ('page-' + pi),
      slots: slots
    };
  });
  if (pages.length < 1) pages = [{ id: 'page-0', slots: new Array(SLOTS_PER_PAGE).fill(null) }];

  var dock = Array.isArray(serverLayout.dock) ? serverLayout.dock.slice(0, MAX_DOCK).filter(function(n) { return n !== null && n; }) : [];
  var pinnedApps = Array.isArray(serverLayout.pinnedApps) ? serverLayout.pinnedApps : ['settings'];
  var folders = (serverLayout.folders && typeof serverLayout.folders === 'object') ? serverLayout.folders : {};

  // 补全 enabledAppNames 中缺失的应用（新启用应用自动出现在桌面）
  if (Array.isArray(enabledAppNames) && enabledAppNames.length > 0) {
    var existingApps = {};
    for (var pi = 0; pi < pages.length; pi++) {
      for (var si = 0; si < pages[pi].slots.length; si++) {
        var s = pages[pi].slots[si];
        if (s && s.type === 'app') existingApps[s.name] = true;
      }
    }
    for (var di = 0; di < dock.length; di++) { existingApps[dock[di]] = true; }
    var folderKeys = Object.keys(folders);
    for (var fi = 0; fi < folderKeys.length; fi++) {
      var folderApps = folders[folderKeys[fi]].apps || [];
      for (var fa = 0; fa < folderApps.length; fa++) { existingApps[folderApps[fa]] = true; }
    }
    for (var ei = 0; ei < enabledAppNames.length; ei++) {
      var appName = enabledAppNames[ei];
      if (!existingApps[appName]) {
        var placed = false;
        for (var pp = 0; pp < pages.length; pp++) {
          if (pushToFirstEmptySlot(pages[pp], appName)) { placed = true; break; }
        }
        if (!placed && pages.length < MAX_PAGES) {
          var newPage = { id: 'page-' + Date.now() + '-' + pages.length, slots: new Array(SLOTS_PER_PAGE).fill(null) };
          pushToFirstEmptySlot(newPage, appName);
          pages.push(newPage);
        }
      }
    }
  }

  return {
    version: typeof serverLayout.version === 'number' ? serverLayout.version : 1,
    pages: pages,
    dock: dock,
    pinnedApps: pinnedApps,
    folders: folders
  };
}

var state = {
  layout: null,             // null=未加载，对象=已加载
  currentPage: 0,          // 当前页索引
  isEditMode: false,        // 编辑态
  isDragging: false,        // 拖拽中
  draggingApp: null,        // 拖拽源信息 { type, pageIndex, index, folderId, appName }
  openFolderId: null,       // 当前打开的文件夹 id
  settingsPanelOpen: false   // 捏合调出的桌面设置面板
};

var getters = {
  // 应用元数据注册表
  appRegistry: function() { return APP_REGISTRY; },
  // 根据 name 查应用元数据
  appByName: function() {
    return function(name) {
      for (var i = 0; i < APP_REGISTRY.length; i++) {
        if (APP_REGISTRY[i].name === name) return APP_REGISTRY[i];
      }
      return null;
    };
  },
  // 布局是否已加载
  isLoaded: function(state) { return state.layout !== null; },
  // 总页数
  totalPages: function(state) {
    return state.layout ? state.layout.pages.length : 0;
  },
  // 当前页
  currentPage: function(state) { return state.currentPage; },
  // 当前页 slots
  currentPageSlots: function(state) {
    if (!state.layout || !state.layout.pages[state.currentPage]) return [];
    return state.layout.pages[state.currentPage].slots;
  },
  // 指定页 slots
  pageSlots: function(state) {
    return function(pageIndex) {
      if (!state.layout || !state.layout.pages[pageIndex]) return [];
      return state.layout.pages[pageIndex].slots;
    };
  },
  // Dock 应用名列表
  dockApps: function(state) {
    return state.layout ? state.layout.dock : [];
  },
  // 固定应用名列表
  pinnedApps: function(state) {
    return state.layout ? state.layout.pinnedApps : [];
  },
  // 根据 id 查文件夹
  folderById: function(state) {
    return function(fid) {
      return (state.layout && state.layout.folders && state.layout.folders[fid]) || null;
    };
  },
  // 是否编辑态
  isEditMode: function(state) { return state.isEditMode; },
  // 是否拖拽中
  isDragging: function(state) { return state.isDragging; },
  draggingApp: function(state) { return state.draggingApp; },
  openFolderId: function(state) { return state.openFolderId; },
  settingsPanelOpen: function(state) { return state.settingsPanelOpen; }
};

var mutations = {
  SET_LAYOUT: function(state, layout) {
    state.layout = layout;
  },
  SET_CURRENT_PAGE: function(state, page) {
    if (state.layout && page >= 0 && page < state.layout.pages.length) {
      state.currentPage = page;
    }
  },
  SET_EDIT_MODE: function(state, val) {
    state.isEditMode = !!val;
    if (!val) {
      // 退出编辑态时关闭设置面板
      state.settingsPanelOpen = false;
    }
  },
  SET_DRAGGING: function(state, info) {
    state.isDragging = !!info;
    state.draggingApp = info || null;
  },
  SET_OPEN_FOLDER: function(state, fid) {
    state.openFolderId = fid || null;
  },
  SET_SETTINGS_PANEL: function(state, val) {
    state.settingsPanelOpen = !!val;
  },

  // 移动应用：from → to
  // from/to: { type: 'page'|'dock'|'folder', pageIndex?, index?, folderId? }
  MOVE_APP: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var from = payload.from;
    var to = payload.to;

    // 1. 从 from 取出应用名，并清空 source
    var appName = null;
    if (from.type === 'page') {
      var srcPage = layout.pages[from.pageIndex];
      if (srcPage && srcPage.slots[from.index]) {
        appName = srcPage.slots[from.index].name;
        srcPage.slots[from.index] = null;
      }
    } else if (from.type === 'dock') {
      appName = layout.dock[from.index];
      layout.dock[from.index] = null;  // 置空，后续清理
    } else if (from.type === 'folder') {
      var f = layout.folders[from.folderId];
      if (f) {
        var idx = f.apps.indexOf(from.appName);
        if (idx !== -1) {
          appName = from.appName;
          f.apps.splice(idx, 1);
          // 文件夹空了自动解散
          if (f.apps.length === 0) {
            delete layout.folders[from.folderId];
            // 清理 pages 中对该文件夹的引用
            layout.pages.forEach(function(p) {
              p.slots.forEach(function(s, si) {
                if (s && s.type === 'folder' && s.id === from.folderId) {
                  p.slots[si] = null;
                }
              });
            });
          }
        }
      }
    }
    if (!appName) {
      state.layout = layout;
      return;
    }

    // 2. 放入 to
    if (to.type === 'page') {
      var dstPage = layout.pages[to.pageIndex];
      if (dstPage) {
        var target = dstPage.slots[to.index];
        if (!target) {
          // 空槽位直接放
          dstPage.slots[to.index] = { type: 'app', name: appName };
        } else if (target.type === 'app') {
          // 目标有应用：交换（把目标的 app 放回 from 原位置）
          var swappedName = target.name;
          dstPage.slots[to.index] = { type: 'app', name: appName };
          if (from.type === 'page') {
            layout.pages[from.pageIndex].slots[from.index] = { type: 'app', name: swappedName };
          } else if (from.type === 'dock') {
            layout.dock[from.index] = swappedName;
          } else if (from.type === 'folder') {
            // 放回原文件夹（若还存在）
            if (layout.folders[from.folderId]) {
              layout.folders[from.folderId].apps.push(swappedName);
            } else {
              // 文件夹已解散，放回当前页末尾空槽
              pushToFirstEmptySlot(layout.pages[state.currentPage], swappedName);
            }
          }
        } else if (target.type === 'folder') {
          // 目标是文件夹：并入
          if (layout.folders[target.id]) {
            layout.folders[target.id].apps.push(appName);
          }
        }
      }
    } else if (to.type === 'dock') {
      // Dock 满则末尾弹出回当前页
      layout.dock = layout.dock.filter(function(n) { return n !== null; });
      if (layout.dock.length >= MAX_DOCK) {
        var popped = layout.dock.pop();
        if (popped) pushToFirstEmptySlot(layout.pages[state.currentPage], popped);
      }
      // 替换或追加到指定位置
      if (to.index < layout.dock.length) {
        var oldDockApp = layout.dock[to.index];
        layout.dock[to.index] = appName;
        if (oldDockApp) {
          pushToFirstEmptySlot(layout.pages[state.currentPage], oldDockApp);
        }
      } else {
        layout.dock.push(appName);
      }
    } else if (to.type === 'folder') {
      if (layout.folders[to.folderId]) {
        layout.folders[to.folderId].apps.push(appName);
      }
    }

    // 清理 dock 中的 null
    layout.dock = layout.dock.filter(function(n) { return n !== null && n; });

    state.layout = layout;
  },

  // 从桌面移除应用（直接置空槽位，不移动到其他位置）
  // payload: { type: 'page'|'dock'|'folder', pageIndex?, index?, folderId?, appName? }
  REMOVE_APP: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var from = payload;
    if (from.type === 'page') {
      var srcPage = layout.pages[from.pageIndex];
      if (srcPage && srcPage.slots[from.index]) {
        srcPage.slots[from.index] = null;
      }
    } else if (from.type === 'dock') {
      if (from.index < layout.dock.length) {
        layout.dock.splice(from.index, 1);
      }
    } else if (from.type === 'folder') {
      var f = layout.folders[from.folderId];
      if (f && from.appName) {
        var idx = f.apps.indexOf(from.appName);
        if (idx !== -1) f.apps.splice(idx, 1);
        // 文件夹空了自动解散
        if (f.apps.length === 0) {
          delete layout.folders[from.folderId];
          layout.pages.forEach(function(p) {
            p.slots.forEach(function(s, si) {
              if (s && s.type === 'folder' && s.id === from.folderId) {
                p.slots[si] = null;
              }
            });
          });
          if (state.openFolderId === from.folderId) state.openFolderId = null;
        }
      }
    }
    state.layout = layout;
  },

  // 创建文件夹：在指定页/槽位，将 targetAppName 与 newAppName 合并为文件夹
  // payload: { pageIndex, index, targetAppName, newAppName, folderId, folderName }
  CREATE_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var fid = payload.folderId || ('folder-' + Date.now());
    var fname = payload.folderName || '文件夹';
    layout.folders[fid] = { id: fid, name: fname, apps: [payload.targetAppName, payload.newAppName] };
    layout.pages[payload.pageIndex].slots[payload.index] = { type: 'folder', id: fid };
    state.layout = layout;
    state.openFolderId = fid;  // 自动打开供重命名
  },

  // 添加应用到文件夹
  ADD_TO_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    if (layout.folders[payload.folderId]) {
      // 避免重复
      if (layout.folders[payload.folderId].apps.indexOf(payload.appName) === -1) {
        layout.folders[payload.folderId].apps.push(payload.appName);
      }
      state.layout = layout;
    }
  },

  // 从文件夹移除应用（返回到当前页空槽位；当前页满则尝试其他页或新增页）
  REMOVE_FROM_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var f = layout.folders[payload.folderId];
    if (f) {
      var idx = f.apps.indexOf(payload.appName);
      if (idx !== -1) {
        f.apps.splice(idx, 1);
        placeAppAnywhere(layout, payload.appName, state.currentPage);
        // 文件夹空了自动解散
        if (f.apps.length === 0) {
          delete layout.folders[payload.folderId];
          layout.pages.forEach(function(p) {
            p.slots.forEach(function(s, si) {
              if (s && s.type === 'folder' && s.id === payload.folderId) {
                p.slots[si] = null;
              }
            });
          });
          if (state.openFolderId === payload.folderId) state.openFolderId = null;
        }
      }
      state.layout = layout;
    }
  },

  // 重命名文件夹
  RENAME_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    if (layout.folders[payload.folderId]) {
      layout.folders[payload.folderId].name = payload.name;
      state.layout = layout;
    }
  },

  // 解散文件夹（应用放回当前页；当前页满则尝试其他页或新增页）
  DELETE_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var f = layout.folders[payload.folderId];
    if (f) {
      // 应用放回任意空槽位（优先当前页）
      for (var i = 0; i < f.apps.length; i++) {
        placeAppAnywhere(layout, f.apps[i], state.currentPage);
      }
      delete layout.folders[payload.folderId];
      // 清理 pages 中对该文件夹的引用
      layout.pages.forEach(function(p) {
        p.slots.forEach(function(s, si) {
          if (s && s.type === 'folder' && s.id === payload.folderId) {
            p.slots[si] = null;
          }
        });
      });
      if (state.openFolderId === payload.folderId) state.openFolderId = null;
      state.layout = layout;
    }
  },

  // 同页内交换两个槽位
  SWAP_SLOTS: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var page = layout.pages[payload.pageIndex];
    if (page) {
      var tmp = page.slots[payload.indexA];
      page.slots[payload.indexA] = page.slots[payload.indexB];
      page.slots[payload.indexB] = tmp;
      state.layout = layout;
    }
  },

  // 添加新页面
  ADD_PAGE: function(state) {
    if (!state.layout) return;
    if (state.layout.pages.length >= MAX_PAGES) return;
    var layout = cloneLayout(state.layout);
    var newId = 'page-' + Date.now();
    layout.pages.push({ id: newId, slots: new Array(SLOTS_PER_PAGE).fill(null) });
    state.layout = layout;
    state.currentPage = layout.pages.length - 1;
  },

  // 删除页面（应用迁移到其他页空槽位；页满则自动新增页，受 MAX_PAGES 限制）
  REMOVE_PAGE: function(state, pageIndex) {
    if (!state.layout) return;
    if (state.layout.pages.length <= 1) return;  // 只有一页不允许删除
    var layout = cloneLayout(state.layout);
    var removingPage = layout.pages[pageIndex];
    // 先从 pages 中移除被删页，剩余页面用于接收迁移应用
    layout.pages.splice(pageIndex, 1);
    var preferPage = Math.max(0, pageIndex - 1);
    if (preferPage >= layout.pages.length) preferPage = layout.pages.length - 1;
    // 迁移被删页所有非空槽位到其他页（优先 preferPage，满则其他页，再满则新增页）
    for (var i = 0; i < removingPage.slots.length; i++) {
      var slot = removingPage.slots[i];
      if (!slot) continue;
      placeAppAnywhere(layout, slot, preferPage);
    }
    // 限制最大页数（placeAppAnywhere 可能新增页面）
    if (layout.pages.length > MAX_PAGES) {
      layout.pages = layout.pages.slice(0, MAX_PAGES);
    }
    if (state.currentPage >= layout.pages.length) {
      state.currentPage = layout.pages.length - 1;
    }
    state.layout = layout;
  },

  // 切换固定状态
  TOGGLE_PIN: function(state, appName) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var idx = layout.pinnedApps.indexOf(appName);
    if (idx === -1) {
      layout.pinnedApps.push(appName);
    } else {
      layout.pinnedApps.splice(idx, 1);
    }
    state.layout = layout;
  },

  // 重置为默认布局
  RESET_LAYOUT: function(state, enabledAppNames) {
    state.layout = buildDefaultLayout(enabledAppNames);
    state.currentPage = 0;
    state.openFolderId = null;
    state.isEditMode = false;
    state.settingsPanelOpen = false;
    state.isDragging = false;
    state.draggingApp = null;
  },

  // 整理桌面：压缩当前页空缺
  TIDY_PAGE: function(state, pageIndex) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var page = layout.pages[pageIndex];
    if (page) {
      var nonEmpty = page.slots.filter(function(s) { return s !== null; });
      var newSlots = new Array(SLOTS_PER_PAGE).fill(null);
      for (var i = 0; i < nonEmpty.length; i++) {
        newSlots[i] = nonEmpty[i];
      }
      page.slots = newSlots;
      state.layout = layout;
    }
  }
};

// 辅助：把应用/文件夹引用推入页面第一个空槽位
// item 支持两种形式：
//   - 字符串（应用名）→ 包装为 {type:'app', name}
//   - 对象 {type, name|id}（已有 slot 引用）→ 直接放入
function pushToFirstEmptySlot(page, item) {
  if (!page || !item) return false;
  for (var i = 0; i < page.slots.length; i++) {
    if (page.slots[i] === null) {
      if (typeof item === 'object') {
        page.slots[i] = item;
      } else {
        page.slots[i] = { type: 'app', name: item };
      }
      return true;
    }
  }
  return false;  // 无空槽位
}

// 辅助：把应用/文件夹引用放到布局任意空槽位
// 优先尝试指定页 → 其他页 → 不够则新增页面（受 MAX_PAGES 限制）
// 返回 true 表示成功放置
function placeAppAnywhere(layout, item, preferPageIndex) {
  if (!layout || !item) return false;
  // 1. 优先放指定页
  if (preferPageIndex !== undefined && layout.pages[preferPageIndex]) {
    if (pushToFirstEmptySlot(layout.pages[preferPageIndex], item)) return true;
  }
  // 2. 尝试其他已有页面
  for (var i = 0; i < layout.pages.length; i++) {
    if (i === preferPageIndex) continue;
    if (pushToFirstEmptySlot(layout.pages[i], item)) return true;
  }
  // 3. 所有页面都满，新增页面
  if (layout.pages.length < MAX_PAGES) {
    var newPage = {
      id: 'page-' + Date.now() + '-' + layout.pages.length,
      slots: new Array(SLOTS_PER_PAGE).fill(null)
    };
    pushToFirstEmptySlot(newPage, item);
    layout.pages.push(newPage);
    return true;
  }
  return false;  // 已达最大页数且无空槽
}

// 模块级 debounce 定时器
var _saveTimer = null;

var actions = {
  // 加载桌面布局：优先服务端，降级 localStorage，再降级默认
  loadDesktopLayout: function(context, enabledAppNames) {
    return api.get('/user/settings').then(function(response) {
      var serverLayout = null;
      if (response.data.code === 200 && response.data.data && response.data.data.desktop_layout) {
        serverLayout = response.data.data.desktop_layout;
      }
      var layout = normalizeLayout(serverLayout, enabledAppNames);
      context.commit('SET_LAYOUT', layout);
      // 写 localStorage 缓存
      try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(layout)); } catch (e) {}
      // 若服务端无布局，立即保存默认布局到服务端
      if (!serverLayout) {
        context.dispatch('saveDesktopLayout');
      }
    }).catch(function() {
      // 降级 1：localStorage
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(LS_CACHE_KEY) || 'null'); } catch (e) { cached = null; }
      var layout = normalizeLayout(cached, enabledAppNames);
      context.commit('SET_LAYOUT', layout);
    });
  },

  // 保存桌面布局到服务端（debounce 500ms）
  saveDesktopLayout: function(context) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      var layout = context.state.layout;
      if (!layout) return;
      // 写 localStorage 缓存
      try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(layout)); } catch (e) {}
      // POST 到服务端
      api.post('/user/settings', { desktop_layout: layout }).catch(function(e) {
        console.error('[desktop] 保存布局失败:', e);
      });
    }, 500);
  },

  enterEditMode: function(context) {
    context.commit('SET_EDIT_MODE', true);
  },
  exitEditMode: function(context) {
    context.commit('SET_EDIT_MODE', false);
  },
  toggleEditMode: function(context) {
    context.commit('SET_EDIT_MODE', !context.state.isEditMode);
  },
  // 重置布局并保存
  resetLayout: function(context, enabledAppNames) {
    context.commit('RESET_LAYOUT', enabledAppNames);
    context.dispatch('saveDesktopLayout');
  },
  // 删除页面并保存
  removePage: function(context, pageIndex) {
    context.commit('REMOVE_PAGE', pageIndex);
    context.dispatch('saveDesktopLayout');
  }
};

export default {
  namespaced: true,
  state: state,
  getters: getters,
  mutations: mutations,
  actions: actions
};

export { APP_REGISTRY, MAX_PAGES, MAX_DOCK, SLOTS_PER_PAGE };
