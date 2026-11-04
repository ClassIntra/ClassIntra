import api from '@/utils/api';
import { getWidget as getWidgetDef } from '@/core/widget-aggregator';
import { APP_REGISTRY } from '@/core/app-registry';

// APP_REGISTRY 现由 @/core/app-registry 从 apps/*/manifest.json 聚合产生
// 保留 export 供其他模块引用（如 Desktop.vue 中的 defaultApps）
// 网格规格
var MAX_PAGES = 9;
var MAX_DOCK = 12;  // Dock 可滚动扩展，上限 12
// 桌面网格：6 列固定，行数可变（4~7，随 layout.rows 持久化）
var GRID_COLS = 6;
var GRID_ROWS_MIN = 4;
var GRID_ROWS_MAX = 7;
// 兼容旧网格代码的最小页容量（6×4=24，与重构前常量同值）
var SLOTS_PER_PAGE = GRID_COLS * GRID_ROWS_MIN;

function layoutRows(layout) {
  var r = layout && parseInt(layout.rows, 10);
  if (!(r >= GRID_ROWS_MIN && r <= GRID_ROWS_MAX)) r = 4;
  return r;
}
function gridSlotCount(layout) { return GRID_COLS * layoutRows(layout); }
// 大文件夹尺寸 → 跨格数（'1x1' 不落字段，缺省 1×1）
function folderSpanWH(size) {
  if (size === '2x2') return { w: 2, h: 2 };
  if (size === '2x4') return { w: 4, h: 2 };
  return { w: 1, h: 1 };
}
// 计算一页内大文件夹覆盖的槽位索引（不含文件夹自身槽位）与跨度。
// folders 取 layout.folders（size 字段）；rows 为当前网格行数。
// 越界（右/下出网格）视为非法 → 该 folder 按 1×1 处理。
function pageFolderCoverage(page, folders, rows) {
  var covered = {};
  var spans = {};
  if (!page || !Array.isArray(page.slots)) return { covered: covered, spans: spans };
  for (var i = 0; i < page.slots.length; i++) {
    var s = page.slots[i];
    if (!s || s.type !== 'folder') continue;
    var f = folders && folders[s.id];
    var span = folderSpanWH(f && f.size);
    if (span.w < 2 && span.h < 2) continue;
    var c0 = i % GRID_COLS;
    var r0 = Math.floor(i / GRID_COLS);
    if (c0 + span.w > GRID_COLS || r0 + span.h > rows) continue;  // 越界 → 1×1
    spans[i] = { w: span.w, h: span.h };
    for (var dr = 0; dr < span.h; dr++) {
      for (var dc = 0; dc < span.w; dc++) {
        if (dr === 0 && dc === 0) continue;
        covered[i + dr * GRID_COLS + dc] = true;
      }
    }
  }
  return { covered: covered, spans: spans };
}

// localStorage 缓存键
var LS_CACHE_KEY = 'classintra_desktop_layout';

function getAppRegistry() {
  return APP_REGISTRY;
}

// 深拷贝布局（避免直接修改 state）
function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

// 恢复源位置：当拖拽目标不兼容时（如 folder 拖到 dock），把 movedItem 放回原处
// 避免文件夹等容器在非法落点被丢弃
function _restoreSource(layout, from, movedItem, srcAppName) {
  if (from.type === 'page') {
    if (layout.pages[from.pageIndex]) {
      layout.pages[from.pageIndex].slots[from.index] = movedItem;
    }
  } else if (from.type === 'dock') {
    layout.dock[from.index] = movedItem.name;
  } else if (from.type === 'folder') {
    if (layout.folders[from.folderId]) {
      layout.folders[from.folderId].apps.push(srcAppName);
    } else {
      // 文件夹已解散，放回第一页空槽
      if (layout.pages[0]) pushToFirstEmptySlot(layout.pages[0], srcAppName, layout.folders, gridSlotCount(layout));
    }
  }
}

// 根据 enabledAppNames 生成默认布局
// 默认 Dock: chat/community/notes/settings（若启用）；非 Dock 应用按顺序填 page-0
function buildDefaultLayout(enabledAppNames, rows) {
  rows = (rows >= GRID_ROWS_MIN && rows <= GRID_ROWS_MAX) ? rows : 4;
  var names = enabledAppNames || [];
  var dockCandidates = ['chat', 'community', 'notes', 'settings'];
  var dock = dockCandidates.filter(function(n) {
    return names.indexOf(n) !== -1;
  }).slice(0, MAX_DOCK);

  var nonDockApps = names.filter(function(n) {
    return dock.indexOf(n) === -1;
  });

  var slotCount = GRID_COLS * rows;
  var slots = new Array(slotCount).fill(null);
  for (var i = 0; i < nonDockApps.length && i < slotCount; i++) {
    slots[i] = { type: 'app', name: nonDockApps[i] };
  }

  return {
    version: 2,
    rows: rows,
    pages: [{ id: 'page-0', slots: slots }],
    dock: dock,
    pinnedApps: [],
    folders: {},
    widgets: {}  // 预留小组件系统：{ 'page-0': [{ id, type, slot, w, h }] }
  };
}

function cleanLayoutApps(layout, enabledAppNames) {
  if (!layout || !Array.isArray(enabledAppNames)) return layout;
  var enabled = {};
  enabledAppNames.forEach(function(name) { enabled[name] = true; });
  layout.pages.forEach(function(page) {
    page.slots = page.slots.map(function(slot) {
      if (slot && slot.type === 'app' && !enabled[slot.name]) return null;
      return slot;
    });
  });
  layout.dock = layout.dock.filter(function(name) { return enabled[name]; });
  layout.pinnedApps = layout.pinnedApps.filter(function(name) { return enabled[name]; });
  Object.keys(layout.folders).forEach(function(folderId) {
    var folder = layout.folders[folderId];
    folder.apps = (folder.apps || []).filter(function(name) { return enabled[name]; });
    if (!folder.apps.length) delete layout.folders[folderId];
  });
  Object.keys(layout.widgets).forEach(function(pageId) {
    layout.widgets[pageId] = (layout.widgets[pageId] || []).filter(function(widget) {
      return !widget.appName || enabled[widget.appName];
    });
  });
  return layout;
}

function normalizeLayout(serverLayout, enabledAppNames) {
  // 图标密度（行数）随布局持久化：旧布局无 rows 默认 4（6×4）
  var rows = (serverLayout && (serverLayout.rows === 4 || serverLayout.rows === 5 || serverLayout.rows === 6 || serverLayout.rows === 7)) ? serverLayout.rows : 4;
  var slotCount = GRID_COLS * rows;
  if (!serverLayout || typeof serverLayout !== 'object') {
    return buildDefaultLayout(enabledAppNames, rows);
  }
  // 基础校验，不合法则回退默认
  if (!Array.isArray(serverLayout.pages) || serverLayout.pages.length < 1) {
    return buildDefaultLayout(enabledAppNames, rows);
  }
  // 确保 pages 数量在 1-9
  var pages = serverLayout.pages.slice(0, MAX_PAGES);
  // 规范化每页 slots 长度（行数变化时旧布局自动补空行/截断）
  pages = pages.map(function(page, pi) {
    var slots = Array.isArray(page.slots) ? page.slots.slice(0, slotCount) : [];
    while (slots.length < slotCount) slots.push(null);
    return {
      id: typeof page.id === 'string' ? page.id : ('page-' + pi),
      slots: slots
    };
  });
  if (pages.length < 1) pages = [{ id: 'page-0', slots: new Array(slotCount).fill(null) }];

  var dock = Array.isArray(serverLayout.dock) ? serverLayout.dock.slice(0, MAX_DOCK).filter(function(n) { return n !== null && n; }) : [];
  // 旧版本默认 pinnedApps: ['settings']，现已取消该固定（让设置图标可拖动）
  // 此处迁移：移除 'settings'，对老用户布局即时生效
  var pinnedApps = Array.isArray(serverLayout.pinnedApps) ? serverLayout.pinnedApps.slice() : [];
  var settingsIdx = pinnedApps.indexOf('settings');
  if (settingsIdx !== -1) pinnedApps.splice(settingsIdx, 1);
  var folders = (serverLayout.folders && typeof serverLayout.folders === 'object') ? serverLayout.folders : {};

  cleanLayoutApps({ pages: pages, dock: dock, pinnedApps: pinnedApps, folders: folders, widgets: (serverLayout.widgets && typeof serverLayout.widgets === 'object') ? serverLayout.widgets : {} }, enabledAppNames);

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
          if (pushToFirstEmptySlot(pages[pp], appName, folders, slotCount)) { placed = true; break; }
        }
        if (!placed && pages.length < MAX_PAGES) {
          var newPage = { id: 'page-' + Date.now() + '-' + pages.length, slots: new Array(slotCount).fill(null) };
          pushToFirstEmptySlot(newPage, appName, folders, slotCount);
          pages.push(newPage);
        }
      }
    }
  }

  // 大文件夹合法性兜底：size 非法 / 覆盖格越界或被占 → 回退 1×1
  Object.keys(folders).forEach(function(fid) {
    var f = folders[fid];
    if (f.size && f.size !== '2x2' && f.size !== '2x4') delete f.size;
    if (!f.size) return;
    var span = folderSpanWH(f.size);
    var ok = false;
    for (var pi = 0; pi < pages.length && !ok; pi++) {
      var slots = pages[pi].slots;
      for (var si = 0; si < slots.length; si++) {
        var sl = slots[si];
        if (!sl || sl.type !== 'folder' || sl.id !== fid) continue;
        var c0 = si % GRID_COLS;
        var r0 = Math.floor(si / GRID_COLS);
        if (c0 + span.w > GRID_COLS || r0 + span.h > rows) break;
        ok = true;
        for (var dr = 0; dr < span.h && ok; dr++) {
          for (var dc = 0; dc < span.w && ok; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (slots[si + dr * GRID_COLS + dc] !== null) ok = false;
          }
        }
        if (ok) return;  // 该 folder 合法，保留 size
        break;
      }
    }
    if (!ok) delete f.size;  // 覆盖格被占/越界/槽位丢失 → 回退 1×1
  });

  return {
    version: 2,
    rows: rows,
    pages: pages,
    dock: dock,
    pinnedApps: pinnedApps,
    folders: folders,
    widgets: (serverLayout.widgets && typeof serverLayout.widgets === 'object') ? serverLayout.widgets : {}
  };
}

// 应用角标（对应 iOS badge / Android BadgeDrawable）：
// 第三方应用通过 context.system.setBadge(n) 写入，桌面图标与 Dock 同步显示。
// 持久化在 localStorage（键 ci:app-badge:<name>），刷新后仍在；应用写空字符串即清除。
var BADGE_PREFIX = 'ci:app-badge:';

function loadAppBadges() {
  var out = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(BADGE_PREFIX) === 0) {
        var name = key.slice(BADGE_PREFIX.length);
        var value = localStorage.getItem(key);
        if (name && value) out[name] = value;
      }
    }
  } catch (e) {}
  return out;
}

var state = {
  layout: null,             // null=未加载，对象=已加载
  currentPage: 0,          // 当前页索引
  isEditMode: false,        // 编辑态
  isDragging: false,        // 拖拽中
  draggingApp: null,        // 拖拽源信息 { type, pageIndex, index, folderId, appName }
  openFolderId: null,       // 当前打开的文件夹 id
  settingsPanelOpen: false,  // 捏合调出的桌面设置面板
  enabledApps: null,         // 应用管控：null=未加载（全部启用），数组=已启用的应用名列表
  widgetRefreshKey: 0,       // 自增 key，watch 此值的 widget 重新加载数据
  appBadges: loadAppBadges() // { appName: '3' | '99+' | '●' }
};

var getters = {
  // 应用元数据注册表
  appRegistry: function() { return getAppRegistry(); },
  // 根据 name 查应用元数据
  appByName: function() {
    return function(name) {
      var appRegistry = getAppRegistry();
      for (var i = 0; i < appRegistry.length; i++) {
        if (appRegistry[i].name === name) return appRegistry[i];
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
  // 图标密度（行数），列固定 6
  gridRows: function(state) { return layoutRows(state.layout); },
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
  settingsPanelOpen: function(state) { return state.settingsPanelOpen; },
  // 判断应用是否启用（对接应用管控：null=未加载时全部启用）
  isAppEnabled: function(state) {
    return function(name) {
      if (!state.enabledApps) return true;
      return state.enabledApps.indexOf(name) !== -1;
    };
  },
  // 指定页的小组件列表（预留小组件系统）
  widgetsByPage: function(state) {
    return function(pageId) {
      if (!state.layout || !state.layout.widgets) return [];
      return state.layout.widgets[pageId] || [];
    };
  }
};

var mutations = {
  // 设置/清除应用角标。用「整体替换对象」而不是逐键赋值，保证 Vue 2 能感知新增键。
  SET_APP_BADGE: function(state, payload) {
    var name = payload && payload.name;
    if (!name) return;
    var raw = payload.value;
    var value = (raw === null || raw === undefined || raw === 0 || raw === '' || raw === false)
      ? ''
      : String(raw).slice(0, 4);

    var next = {};
    var keys = Object.keys(state.appBadges || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== name) next[keys[i]] = state.appBadges[keys[i]];
    }
    if (value) next[name] = value;
    state.appBadges = next;

    try {
      if (value) localStorage.setItem(BADGE_PREFIX + name, value);
      else localStorage.removeItem(BADGE_PREFIX + name);
    } catch (e) {}
  },
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
  // 设置应用管控启用的应用列表（由 Desktop.vue 加载后注入）
  SET_ENABLED_APPS: function(state, apps) {
    state.enabledApps = Array.isArray(apps) ? apps : null;
  },

  // 移动应用/文件夹：from → to
  // from/to: { type: 'page'|'dock'|'folder', pageIndex?, index?, folderId?, appName? }
  // movedItem 概念：保存完整 slot 对象，支持 app 和 folder 两种可移动项
  //   - app slot: { type: 'app', name }
  //   - folder slot: { type: 'folder', id }
  // 文件夹只能落在 page 空槽位或与 page app 交换，不能进 dock/folder（不兼容时恢复源位置）
  MOVE_APP: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var from = payload.from;
    var to = payload.to;

    // 1. 从 from 取出 movedItem（完整 slot 对象），并清空 source
    var movedItem = null;
    var srcAppName = null;  // 仅 folder 类型 source 用（从文件夹拖出 app 时记录原名）

    if (from.type === 'page') {
      var srcPage = layout.pages[from.pageIndex];
      if (srcPage && srcPage.slots[from.index]) {
        movedItem = srcPage.slots[from.index];  // 完整 slot（app 或 folder）
        srcPage.slots[from.index] = null;
      }
    } else if (from.type === 'dock') {
      var dockName = layout.dock[from.index];
      if (dockName) {
        movedItem = { type: 'app', name: dockName };
        layout.dock[from.index] = null;
      }
    } else if (from.type === 'folder') {
      var f = layout.folders[from.folderId];
      if (f) {
        var idx = f.apps.indexOf(from.appName);
        if (idx !== -1) {
          srcAppName = from.appName;
          movedItem = { type: 'app', name: from.appName };
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

    if (!movedItem) {
      state.layout = layout;
      return;
    }

    // 2. 放入 to（根据 movedItem.type 和 to.type 组合处理）
    var isFolderItem = movedItem.type === 'folder';

    if (to.type === 'page') {
      var dstPage = layout.pages[to.pageIndex];
      if (dstPage) {
        var target = dstPage.slots[to.index];
        if (!target) {
          // 空槽位直接放（app 或 folder 均可）
          dstPage.slots[to.index] = movedItem;
        } else if (target.type === 'app' && !isFolderItem) {
          // app→app 交换（把目标的 app 放回 from 原位置）
          var swappedName = target.name;
          dstPage.slots[to.index] = movedItem;
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
              pushToFirstEmptySlot(layout.pages[state.currentPage], swappedName, layout.folders, gridSlotCount(layout));
            }
          }
        } else if (target.type === 'folder' && !isFolderItem) {
          // 目标是文件夹：app 并入（去重，避免拖入产生重复图标）
          if (layout.folders[target.id] && layout.folders[target.id].apps.indexOf(movedItem.name) === -1) {
            layout.folders[target.id].apps.push(movedItem.name);
          }
        } else if (target.type === 'folder' && isFolderItem) {
          // folder→folder 不允许（嵌套文件夹复杂度高）：恢复源位置
          _restoreSource(layout, from, movedItem, srcAppName);
        } else if (target.type === 'app' && isFolderItem) {
          // folder→app 交换：目标 app 放回 folder 原位置（page slot）
          var swappedApp = target.name;
          dstPage.slots[to.index] = movedItem;
          if (from.type === 'page') {
            layout.pages[from.pageIndex].slots[from.index] = { type: 'app', name: swappedApp };
          }
        }
      }
    } else if (to.type === 'dock') {
      // Dock 满载拦截已由 desktop-drag._onDragUp 处理（mutation 保持纯函数）
      // Dock 仅接受 app；folder 拖到 dock 恢复源位置
      if (isFolderItem) {
        _restoreSource(layout, from, movedItem, srcAppName);
      } else {
        layout.dock = layout.dock.filter(function(n) { return n !== null && n; });
        if (to.isAppend || to.index >= layout.dock.length) {
          // 追加到末尾（落点为 dock-bar 空白处 / append 标记）
          layout.dock.push(movedItem.name);
        } else {
          // 替换指定位置
          var oldDockApp = layout.dock[to.index];
          layout.dock[to.index] = movedItem.name;
          if (oldDockApp) {
            if (from.type === 'dock') {
              // Dock 内重排：旧应用回到拖拽来源位置（交换语义，避免被挤出到桌面）
              layout.dock[from.index] = oldDockApp;
            } else {
              // 跨区域：旧应用放回当前页空槽
              pushToFirstEmptySlot(layout.pages[state.currentPage], oldDockApp, layout.folders, gridSlotCount(layout));
            }
          }
        }
      }
    } else if (to.type === 'folder') {
      // folder 内仅接受 app；folder 拖到 folder 恢复源位置
      if (isFolderItem) {
        _restoreSource(layout, from, movedItem, srcAppName);
      } else {
        // 并入文件夹（去重，避免拖入产生重复图标）
        if (layout.folders[to.folderId] && layout.folders[to.folderId].apps.indexOf(movedItem.name) === -1) {
          layout.folders[to.folderId].apps.push(movedItem.name);
        }
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
  // payload: { pageIndex, index, targetAppName, newAppName, folderId, folderName, from }
  // from: { type: 'page'|'dock', pageIndex?, index? } —— newAppName 的原位置（清源避免图标双重显示）
  CREATE_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var fid = payload.folderId || ('folder-' + Date.now());
    var fname = payload.folderName || '文件夹';
    layout.folders[fid] = { id: fid, name: fname, apps: [payload.targetAppName, payload.newAppName] };
    layout.pages[payload.pageIndex].slots[payload.index] = { type: 'folder', id: fid };
    // 清除拖拽源原位置（避免图标在文件夹+桌面双重显示）
    if (payload.from) {
      if (payload.from.type === 'page' && layout.pages[payload.from.pageIndex]) {
        layout.pages[payload.from.pageIndex].slots[payload.from.index] = null;
      } else if (payload.from.type === 'dock') {
        layout.dock[payload.from.index] = null;
        layout.dock = layout.dock.filter(function(n) { return n !== null && n; });
      }
    }
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

  // ===== 小组件系统（桌面端由 Desktop.vue 模板 + desktop-drag.js 拖拽引擎消费）=====
  // 添加小组件到指定页
  // payload: { pageId, widget: { id, type, slot, w, h, config } }
  ADD_WIDGET: function(state, payload) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    if (!layout.widgets) layout.widgets = {};
    if (!layout.widgets[payload.pageId]) layout.widgets[payload.pageId] = [];
    layout.widgets[payload.pageId].push(payload.widget);
    state.layout = layout;
  },
  // 移除小组件
  // payload: { pageId, widgetId }
  REMOVE_WIDGET: function(state, payload) {
    if (!state.layout || !state.layout.widgets) return;
    var layout = cloneLayout(state.layout);
    var list = layout.widgets[payload.pageId];
    if (list) {
      layout.widgets[payload.pageId] = list.filter(function(w) {
        return w.id !== payload.widgetId;
      });
    }
    state.layout = layout;
  },
  // 更新小组件配置
  // payload: { pageId, widgetId, config }
  UPDATE_WIDGET: function(state, payload) {
    if (!state.layout || !state.layout.widgets) return;
    var layout = cloneLayout(state.layout);
    var list = layout.widgets[payload.pageId];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === payload.widgetId) {
          list[i].config = Object.assign({}, list[i].config, payload.config);
          break;
        }
      }
    }
    state.layout = layout;
  },
  // 调整小组件大小
  // payload: { pageId, widgetId, w, h }
  RESIZE_WIDGET: function(state, payload) {
    if (!state.layout || !state.layout.widgets) return;
    var layout = cloneLayout(state.layout);
    var list = layout.widgets[payload.pageId];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === payload.widgetId) {
          list[i].w = payload.w;
          list[i].h = payload.h;
          break;
        }
      }
    }
    state.layout = layout;
  },
  // 跨页移动小组件：从源页数组移除并追加到目标页数组
  // payload: { fromPageId, toPageId, widgetId }
  MOVE_WIDGET: function(state, payload) {
    if (!state.layout || !state.layout.widgets) return;
    if (payload.fromPageId === payload.toPageId) return; // 同页无需移动
    var layout = cloneLayout(state.layout);
    var fromList = layout.widgets[payload.fromPageId];
    if (!fromList) return;
    var widget = null;
    var remain = [];
    for (var i = 0; i < fromList.length; i++) {
      if (fromList[i].id === payload.widgetId) {
        widget = fromList[i];
      } else {
        remain.push(fromList[i]);
      }
    }
    if (!widget) return;
    layout.widgets[payload.fromPageId] = remain;
    if (!layout.widgets[payload.toPageId]) layout.widgets[payload.toPageId] = [];
    layout.widgets[payload.toPageId].push(widget);
    state.layout = layout;
  },
  // 设置小组件网格起始坐标（用于同页拖拽固定到指定格子）
  // payload: { pageId, widgetId, col, row } —— col/row 为 1-based grid 坐标
  // 配合 CSS grid-auto-flow: row dense，app 图标会自动避让显式定位的 widget
  SET_WIDGET_POSITION: function(state, payload) {
    if (!state.layout || !state.layout.widgets) return;
    var layout = cloneLayout(state.layout);
    var list = layout.widgets[payload.pageId];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === payload.widgetId) {
          list[i].col = payload.col;
          list[i].row = payload.row;
          break;
        }
      }
    }
    state.layout = layout;
  },
  // 触发所有 widget 刷新（自增 key，widget 组件 watch 此值重新加载数据）
  BUMP_WIDGET_REFRESH: function(state) {
    state.widgetRefreshKey++;
  },

  // 添加新页面
  ADD_PAGE: function(state) {
    if (!state.layout) return;
    if (state.layout.pages.length >= MAX_PAGES) return;
    var layout = cloneLayout(state.layout);
    var newId = 'page-' + Date.now();
    layout.pages.push({ id: newId, slots: new Array(gridSlotCount(layout)).fill(null) });
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

  // 重置为默认布局（保留图标密度——rows 是用户的空间偏好，不随重置丢失）
  RESET_LAYOUT: function(state, payload) {
    var enabled = payload && payload.enabled !== undefined ? payload.enabled : payload;
    var rows = payload && payload.rows;
    state.layout = buildDefaultLayout(enabled, rows);
    state.currentPage = 0;
    state.openFolderId = null;
    state.isEditMode = false;
    state.settingsPanelOpen = false;
    state.isDragging = false;
    state.draggingApp = null;
  },

  // 图标密度变更：payload 为已 regrid 的完整布局（含 rows）
  SET_GRID_ROWS: function(state, layout) {
    if (!layout || !layout.pages) return;
    state.layout = layout;
    state.currentPage = Math.min(state.currentPage, layout.pages.length - 1);
  },

  // 整理桌面：压缩当前页空缺（跳过大文件夹覆盖格——它们必须保持为空）
  TIDY_PAGE: function(state, pageIndex) {
    if (!state.layout) return;
    var layout = cloneLayout(state.layout);
    var page = layout.pages[pageIndex];
    if (page) {
      var cov = pageFolderCoverage(page, layout.folders, layoutRows(layout)).covered;
      var nonEmpty = [];
      for (var i = 0; i < page.slots.length; i++) {
        if (page.slots[i] !== null && !cov[i]) nonEmpty.push(page.slots[i]);
      }
      var newSlots = new Array(page.slots.length).fill(null);
      var filled = 0;
      for (var j = 0; j < newSlots.length && filled < nonEmpty.length; j++) {
        if (!cov[j]) {
          newSlots[j] = nonEmpty[filled];
          filled++;
        }
      }
      page.slots = newSlots;
      state.layout = layout;
    }
  },

  // 大文件夹尺寸循环（1x1 → 2x2 → 2x4 → 1x1）：
  // payload.nextSize 缺省时按顺序取下一档；覆盖格被占/越界则静默放弃（组件层负责校验与 toast）
  RESIZE_FOLDER: function(state, payload) {
    if (!state.layout) return;
    var folder = state.layout.folders && state.layout.folders[payload.folderId];
    if (!folder) return;
    var order = ['1x1', '2x2', '2x4'];
    var cur = order.indexOf(folder.size || '1x1');
    var nextSize = payload.nextSize || order[(cur + 1) % order.length];
    if (nextSize === (folder.size || '1x1')) return;
    var layout = cloneLayout(state.layout);
    var page = layout.pages[payload.pageIndex];
    if (!page || !Array.isArray(page.slots)) return;
    var folder2 = layout.folders[payload.folderId];
    if (!folder2) return;
    var span = folderSpanWH(nextSize);
    var idx = payload.index;
    var rows = layoutRows(layout);
    if (idx % GRID_COLS + span.w > GRID_COLS || Math.floor(idx / GRID_COLS) + span.h > rows) return;

    // 覆盖格被占 → 自动腾挪（HarmonyOS 语义）：容量预检保证原子性，优先挪到本页空位
    var occupied = [];
    for (var dr = 0; dr < span.h; dr++) {
      for (var dc = 0; dc < span.w; dc++) {
        if (dr === 0 && dc === 0) continue;
        var cell = idx + dr * GRID_COLS + dc;
        if (page.slots[cell]) occupied.push({ index: cell, slot: page.slots[cell] });
      }
    }
    if (occupied.length > 0) {
      var freeCount = 0;
      for (var pi = 0; pi < layout.pages.length; pi++) {
        var pg = layout.pages[pi];
        var cov2 = pageFolderCoverage(pg, layout.folders, rows).covered;
        for (var si = 0; si < pg.slots.length; si++) {
          if (!pg.slots[si] && !cov2[si]) freeCount++;
        }
      }
      if (freeCount < occupied.length) return;  // 全局无处腾挪 → 放弃
      for (var k = 0; k < occupied.length; k++) {
        page.slots[occupied[k].index] = null;
      }
      for (var k2 = 0; k2 < occupied.length; k2++) {
        // 容量已预检不会失败；兜底：放回原格
        if (!placeAppAnywhere(layout, occupied[k2].slot, payload.pageIndex)) {
          page.slots[occupied[k2].index] = occupied[k2].slot;
        }
      }
    }

    folder2.size = nextSize === '1x1' ? undefined : nextSize;
    for (var dr2 = 0; dr2 < span.h; dr2++) {
      for (var dc2 = 0; dc2 < span.w; dc2++) {
        if (dr2 === 0 && dc2 === 0) continue;
        page.slots[idx + dr2 * GRID_COLS + dc2] = null;
      }
    }
    state.layout = layout;
  }
};

// 辅助：把应用/文件夹引用推入页面第一个空槽位
// item 支持两种形式：
//   - 字符串（应用名）→ 包装为 {type:'app', name}
//   - 对象 {type, name|id}（已有 slot 引用）→ 直接放入
function pushToFirstEmptySlot(page, item, folders, slotCount) {
  if (!page || !item) return false;
  // 跳过大文件夹覆盖格（它们必须保持为空，否则 tile 会压住图标）
  var cov = (folders && slotCount) ? pageFolderCoverage(page, folders, Math.floor(slotCount / GRID_COLS)).covered : {};
  var limit = slotCount || page.slots.length;
  for (var i = 0; i < limit && i < page.slots.length; i++) {
    if (cov[i]) continue;
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
  var slotCount = gridSlotCount(layout);
  var folders = layout.folders;
  // 大文件夹引用落位兜底：放置后覆盖非法则回退 1×1
  var isFolderRef = item && typeof item === 'object' && item.type === 'folder';
  // 1. 优先放指定页
  if (preferPageIndex !== undefined && layout.pages[preferPageIndex]) {
    if (pushToFirstEmptySlot(layout.pages[preferPageIndex], item, folders, slotCount)) {
      if (isFolderRef) sanitizeLargeFolders(layout.pages, layout.folders, layoutRows(layout));
      return true;
    }
  }
  // 2. 尝试其他已有页面
  for (var i = 0; i < layout.pages.length; i++) {
    if (i === preferPageIndex) continue;
    if (pushToFirstEmptySlot(layout.pages[i], item, folders, slotCount)) {
      if (isFolderRef) sanitizeLargeFolders(layout.pages, layout.folders, layoutRows(layout));
      return true;
    }
  }
  // 3. 所有页面都满，新增页面
  if (layout.pages.length < MAX_PAGES) {
    var newPage = {
      id: 'page-' + Date.now() + '-' + layout.pages.length,
      slots: new Array(slotCount).fill(null)
    };
    pushToFirstEmptySlot(newPage, item, folders, slotCount);
    layout.pages.push(newPage);
    if (isFolderRef) sanitizeLargeFolders(layout.pages, layout.folders, layoutRows(layout));
    return true;
  }
  return false;  // 已达最大页数且无空槽
}

// 大文件夹合法性兜底（运行时腾挪路径复用）：覆盖越界/被占/size 非法 → 回退 1×1
function sanitizeLargeFolders(pages, folders, rows) {
  Object.keys(folders).forEach(function(fid) {
    var f = folders[fid];
    if (f.size && f.size !== '2x2' && f.size !== '2x4') delete f.size;
    if (!f.size) return;
    var span = folderSpanWH(f.size);
    var ok = false;
    for (var pi = 0; pi < pages.length && !ok; pi++) {
      var slots = pages[pi].slots;
      for (var si = 0; si < slots.length; si++) {
        var sl = slots[si];
        if (!sl || sl.type !== 'folder' || sl.id !== fid) continue;
        var c0 = si % GRID_COLS;
        var r0 = Math.floor(si / GRID_COLS);
        if (c0 + span.w > GRID_COLS || r0 + span.h > rows) break;
        ok = true;
        for (var dr = 0; dr < span.h && ok; dr++) {
          for (var dc = 0; dc < span.w && ok; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (slots[si + dr * GRID_COLS + dc] !== null) ok = false;
          }
        }
        if (ok) return;
        break;
      }
    }
    if (!ok) delete f.size;
  });
}

// 模块级 debounce 定时器
var _saveTimer = null;

// 布局保存失败重试（指数退避 2s → 8s，最多 2 次；成功清零，最终失败仅 toast 一次）
var _saveRetryCount = 0;
var _saveRetryTimer = null;
var _saveFailureNotified = false;

// 实际提交：始终 POST 最新 state.layout（重试时拿到的是当前布局而非过期快照）
function postLayoutSave(context) {
  var layout = context.state.layout;
  if (!layout) return;
  // 写 localStorage 缓存（服务端失败时的本地兜底，加载端有对应降级读取）
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(layout)); } catch (e) {}
  api.post('/user/settings', { desktop_layout: layout }).then(function() {
    _saveRetryCount = 0;
    _saveFailureNotified = false;
  }).catch(function(e) {
    console.error('[desktop] 保存布局失败:', e);
    scheduleLayoutSaveRetry(context);
  });
}

function scheduleLayoutSaveRetry(context) {
  if (_saveRetryCount >= 2) {
    // 重试耗尽：仅在本轮失败周期内提示一次，避免连续操作连环弹 toast
    if (!_saveFailureNotified) {
      _saveFailureNotified = true;
      try {
        context.commit('toast/SHOW_TOAST', {
          message: '桌面布局暂时未能同步到服务器，已在本机保存',
          type: 'info'
        }, { root: true });
      } catch (e) {}
    }
    return;
  }
  if (_saveRetryTimer) clearTimeout(_saveRetryTimer);
  var delay = _saveRetryCount === 0 ? 2000 : 8000;
  _saveRetryCount++;
  _saveRetryTimer = setTimeout(function() {
    _saveRetryTimer = null;
    postLayoutSave(context);
  }, delay);
}

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

  // 保存桌面布局到服务端（debounce 500ms；失败走重试队列，见 postLayoutSave）
  saveDesktopLayout: function(context) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      _saveTimer = null;
      postLayoutSave(context);
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
  // 重置布局并保存（保留当前密度）
  resetLayout: function(context, enabledAppNames) {
    context.commit('RESET_LAYOUT', { enabled: enabledAppNames, rows: layoutRows(context.state.layout) });
    context.dispatch('saveDesktopLayout');
  },

  // 调整图标密度（行数 4~7）：收缩时先腾挪溢出槽内容，扩张补空行。
  // 返回迁移的图标数（0 表示无迁移），供面板 toast
  setGridRows: function(context, rows) {
    rows = (rows >= GRID_ROWS_MIN && rows <= GRID_ROWS_MAX) ? rows : 4;
    var layout = context.state.layout;
    var curRows = layoutRows(layout);
    if (!layout || rows === curRows) return 0;
    var moved = 0;
    var clones = cloneLayout(layout);
    // 收缩：把每页溢出槽的非空内容先腾挪（folder 引用整槽迁移，迁移后覆盖非法自动回退 1×1）
    if (rows < curRows) {
      var keep = GRID_COLS * rows;
      for (var pi = 0; pi < clones.pages.length; pi++) {
        var slots = clones.pages[pi].slots;
        for (var si = keep; si < slots.length; si++) {
          var s = slots[si];
          if (!s) continue;
          slots[si] = null;
          if (placeAppAnywhere(clones, s, pi)) {
            moved++;
          } else {
            // 全局无处安放（极端满载）：放回原位，中止收缩
            slots[si] = s;
          }
        }
      }
      if (moved > 0) sanitizeLargeFolders(clones.pages, clones.folders, rows);
    }
    // regrid 到目标行数
    var target = GRID_COLS * rows;
    clones.rows = rows;
    for (var pj = 0; pj < clones.pages.length; pj++) {
      var arr = clones.pages[pj].slots.slice(0, target);
      while (arr.length < target) arr.push(null);
      clones.pages[pj].slots = arr;
    }
    context.commit('SET_GRID_ROWS', clones);
    try { localStorage.setItem('gridRows', String(rows)); } catch (e) {}
    context.dispatch('saveDesktopLayout');
    return moved;
  },
  // 删除页面并保存
  removePage: function(context, pageIndex) {
    context.commit('REMOVE_PAGE', pageIndex);
    context.dispatch('saveDesktopLayout');
  },
  // ===== 小组件系统 actions =====
  // 添加小组件到指定页
  // payload: { pageId, type, config, w, h }
  addWidget: function(context, payload) {
    var widgetDef = getWidgetDef(payload.type);
    var defaultSize = (widgetDef && widgetDef.defaultSize) || { w: 2, h: 2 };
    var maxSize = (widgetDef && widgetDef.maxSize) || { w: 4, h: 4 };
    // 防御性夹紧：显式 w/h 不得越过 maxSize（picker 的加宽选项已先行夹紧，此处兜底）
    var w = payload.w || defaultSize.w;
    var h = payload.h || defaultSize.h;
    w = Math.max(1, Math.min(w, maxSize.w));
    h = Math.max(1, Math.min(h, maxSize.h));
    var widget = {
      id: 'w_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: payload.type,
      // 来源应用（官方/市场 widget 聚合时都带 _app）：cleanLayoutApps
      // 据此在应用禁用/卸载后清掉布局里失效的 widget 引用
      appName: (widgetDef && widgetDef._app) || '',
      slot: 0,
      w: w,
      h: h,
      config: payload.config || {}
    };
    context.commit('ADD_WIDGET', { pageId: payload.pageId, widget: widget });
    context.dispatch('saveDesktopLayout');
  },
  // 移除小组件
  // payload: { pageId, widgetId }
  removeWidget: function(context, payload) {
    context.commit('REMOVE_WIDGET', { pageId: payload.pageId, widgetId: payload.widgetId });
    context.dispatch('saveDesktopLayout');
  },
  // 更新小组件配置
  // payload: { pageId, widgetId, config }
  updateWidgetConfig: function(context, payload) {
    context.commit('UPDATE_WIDGET', { pageId: payload.pageId, widgetId: payload.widgetId, config: payload.config });
    context.dispatch('saveDesktopLayout');
  },
  // 调整小组件大小（带边界校验）
  // payload: { pageId, widgetId, dw, dh } —— dw/dh 为增量（+1/-1）
  resizeWidget: function(context, payload) {
    var layout = context.state.layout;
    if (!layout || !layout.widgets) return;
    var list = layout.widgets[payload.pageId];
    if (!list) return;
    var widget = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === payload.widgetId) { widget = list[i]; break; }
    }
    if (!widget) return;
    // 从 WIDGET_REGISTRY 取 minSize/maxSize
    var def = getWidgetDef(widget.type);
    var minSize = (def && def.minSize) || { w: 1, h: 1 };
    var maxSize = (def && def.maxSize) || { w: 4, h: 4 };
    var newW = Math.max(minSize.w, Math.min(maxSize.w, widget.w + payload.dw));
    var newH = Math.max(minSize.h, Math.min(maxSize.h, widget.h + payload.dh));
    if (newW === widget.w && newH === widget.h) return;
    context.commit('RESIZE_WIDGET', { pageId: payload.pageId, widgetId: payload.widgetId, w: newW, h: newH });
    context.dispatch('saveDesktopLayout');
  },
  // 跨页移动小组件
  // payload: { fromPageId, toPageId, widgetId }
  moveWidget: function(context, payload) {
    if (payload.fromPageId === payload.toPageId) return; // 同页无需移动
    context.commit('MOVE_WIDGET', payload);
    context.dispatch('saveDesktopLayout');
  },
  // 设置小组件网格坐标（同页拖拽固定到指定格子）
  // payload: { pageId, widgetId, col, row }
  setWidgetPosition: function(context, payload) {
    context.commit('SET_WIDGET_POSITION', payload);
    context.dispatch('saveDesktopLayout');
  },
  // 刷新所有 widget（触发 widget 组件重新加载数据）
  refreshAllWidgets: function(context) {
    context.commit('BUMP_WIDGET_REFRESH');
  }
};

export default {
  namespaced: true,
  state: state,
  getters: getters,
  mutations: mutations,
  actions: actions
};

export { APP_REGISTRY, MAX_PAGES, MAX_DOCK, GRID_COLS, GRID_ROWS_MIN, GRID_ROWS_MAX };
