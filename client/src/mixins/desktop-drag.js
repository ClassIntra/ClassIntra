// 桌面拖拽引擎 mixin
// 提供图标拖拽能力：ghost 跟随、落点检测、FLIP 动画、文件夹创建（拖拽悬停 500ms）
// 使用方式：在 Desktop.vue 中 mixins: [desktopDrag]，容器绑定 @touchstart/@mousedown="onPointerDown"
// 依赖：组件 this.$store 有 desktop 模块

var DRAG_THRESHOLD = 5;        // 移动超过 5px 才正式开始拖拽
var FOLDER_HOVER_MS = 500;     // 拖拽悬停 500ms 创建文件夹
var FLIP_DURATION = 300;       // FLIP 动画时长
var FLIP_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';  // iOS 弹性曲线
var PAGE_EDGE_THRESHOLD = 36;  // 距屏幕左/右边缘多少像素触发跨页切换
var PAGE_SWITCH_DELAY = 450;   // 边缘停留多久后切页（ms）
var PAGE_SWITCH_COOLDOWN = 600; // 切页后冷却（ms），避免连续切页过快

export default {
  data: function() {
    return {
      // 拖拽状态：null 表示未拖拽
      // 结构：{ source, startX, startY, currentX, currentY, started, ghostEl, targetInfo, folderHoverTimer, lastTargetKey }
      dragState: null
    };
  },
  methods: {
    // 指针按下（touch 或 mouse）：记录预备拖拽
    // 由容器 @touchstart/@mousedown 调用，通过事件委托识别被拖图标
    onPointerDown: function(e, forcedSource) {
      // 仅编辑态下响应拖拽
      if (!this.$store.state.desktop.isEditMode) return;
      // dock-only 模式下禁用拖拽：effectiveDockApps 是聚合视图，与 layout.dock 索引不对应，
      // 拖拽会导致数据错乱；切回 grid 模式可正常重排（layout 未被修改，自然还原）
      if (this.$store.getters['settings/desktopLayout'] === 'dock') return;
      if (this.$store.state.desktop.isDragging) return;

      var source = forcedSource;
      if (!source) {
        // 事件委托：从 e.target 向上找 [data-src-type]
        var target = e.target;
        var el = target && target.closest ? target.closest('[data-src-type]') : null;
        if (!el) return;
        source = this._readSourceFromElement(el);
      }
      if (!source) return;

      // 固定图标不可拖拽
      var pinnedApps = this.$store.getters['desktop/pinnedApps'];
      if (source.appName && pinnedApps.indexOf(source.appName) !== -1) return;

      var point = this._getPoint(e);
      this.dragState = {
        source: source,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        started: false,
        ghostEl: null,
        targetInfo: null,
        folderHoverTimer: null,
        lastTargetKey: '',
        pageSwitchTimer: null,      // 跨页切页计时器
        lastPageSwitchAt: 0,        // 上次切页时间戳（冷却用）
        pageEdgeDir: 0              // 当前边缘方向：0 无 / -1 左 / 1 右
      };

      // 绑定文档级监听（确保离开元素仍能跟踪）
      var isTouch = e.type === 'touchstart';
      this._dragMoveEvent = isTouch ? 'touchmove' : 'mousemove';
      this._dragUpEvent = isTouch ? 'touchend' : 'mouseup';
      this._onDragMoveBound = this._onDragMove.bind(this);
      this._onDragUpBound = this._onDragUp.bind(this);
      document.addEventListener(this._dragMoveEvent, this._onDragMoveBound, { passive: false });
      document.addEventListener(this._dragUpEvent, this._onDragUpBound);
    },

    // 从元素 data-* 属性读取 source 信息
    _readSourceFromElement: function(el) {
      var type = el.getAttribute('data-src-type');
      if (!type) return null;
      var source = { type: type };
      var page = el.getAttribute('data-src-page');
      var idx = el.getAttribute('data-src-idx');
      var dock = el.getAttribute('data-src-dock');
      var folder = el.getAttribute('data-src-folder');
      var app = el.getAttribute('data-src-app');
      if (page !== null) source.pageIndex = parseInt(page, 10);
      if (idx !== null) source.index = parseInt(idx, 10);
      if (dock !== null) source.index = parseInt(dock, 10);
      if (folder !== null) source.folderId = folder;
      if (app !== null) source.appName = app;
      return source;
    },

    // 获取指针坐标（兼容 touch/mouse）
    _getPoint: function(e) {
      if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      if (e.changedTouches && e.changedTouches.length > 0) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    },

    // 文档级移动处理
    _onDragMove: function(e) {
      if (!this.dragState) return;
      var point = this._getPoint(e);
      this.dragState.currentX = point.x;
      this.dragState.currentY = point.y;

      // 未正式开始：检查阈值（立即响应，不节流）
      if (!this.dragState.started) {
        var dx = point.x - this.dragState.startX;
        var dy = point.y - this.dragState.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        // 超过阈值，正式开始拖拽
        this._beginDrag(e);
      }

      // 阻止默认行为（防止滚动，立即执行）
      if (e.cancelable) e.preventDefault();

      // rAF 节流：ghost 位置更新 + 落点检测 + 跨页边缘检测（这三步较重，每帧执行一次即可）
      if (this.dragState._rafScheduled) return;
      this.dragState._rafScheduled = true;
      var self = this;
      this._rafId = requestAnimationFrame(function() {
        if (!self.dragState) return;
        self.dragState._rafScheduled = false;
        self._updateGhost(self.dragState.currentX, self.dragState.currentY);
        var targetInfo = self._findDropTarget(self.dragState.currentX, self.dragState.currentY);
        self._updateDropHighlight(targetInfo);
        // 跨页拖拽：检测指针是否接近屏幕左/右边缘，触发自动切页
        self._checkPageEdgeSwitch(self.dragState.currentX, self.dragState.currentY);
      });
    },

    // 跨页拖拽：边缘检测 + 自动切页
    // 当指针接近屏幕左/右边缘并停留 PAGE_SWITCH_DELAY 后，切换到上/下一页
    // 切页后进入 PAGE_SWITCH_COOLDOWN 冷却，避免连续切页过快
    // 仅 grid 布局生效（dock-only 模式单页视图无需切页）
    _checkPageEdgeSwitch: function(x, y) {
      if (!this.dragState || !this.dragState.started) return;
      // dock-only 模式单页视图，不切页
      var layoutMode = this.$store.getters['settings/desktopLayout'];
      if (layoutMode === 'dock') return;

      var winW = window.innerWidth;
      var dir = 0;
      if (x <= PAGE_EDGE_THRESHOLD) dir = -1;        // 左边缘 → 上一页
      else if (x >= winW - PAGE_EDGE_THRESHOLD) dir = 1; // 右边缘 → 下一页

      // 方向变化：清除旧计时器，记录新方向
      if (dir !== this.dragState.pageEdgeDir) {
        if (this.dragState.pageSwitchTimer) {
          clearTimeout(this.dragState.pageSwitchTimer);
          this.dragState.pageSwitchTimer = null;
        }
        this.dragState.pageEdgeDir = dir;
        if (dir !== 0) {
          // 启动切页计时
          var self = this;
          this.dragState.pageSwitchTimer = setTimeout(function() {
            self._doPageSwitch(dir);
          }, PAGE_SWITCH_DELAY);
        }
      }
    },

    // 执行切页（已通过边缘停留检测）
    _doPageSwitch: function(dir) {
      if (!this.dragState) return;
      this.dragState.pageSwitchTimer = null;
      // 冷却期检查
      var now = Date.now();
      if (now - this.dragState.lastPageSwitchAt < PAGE_SWITCH_COOLDOWN) {
        // 冷却中：重新排队一次
        var self = this;
        this.dragState.pageSwitchTimer = setTimeout(function() {
          self._doPageSwitch(dir);
        }, PAGE_SWITCH_COOLDOWN - (now - this.dragState.lastPageSwitchAt));
        return;
      }

      var totalPages = this.$store.getters['desktop/totalPages'];
      var currentPage = this.$store.state.desktop.currentPage;
      var newPage = currentPage + dir;
      if (newPage < 0 || newPage >= totalPages) {
        // 边界：无法继续切，重置方向让用户回到边缘时能再次触发
        this.dragState.pageEdgeDir = 0;
        return;
      }

      // 切页前清除当前落点高亮和让位动画（旧页面元素即将移出视口）
      this._clearDropHighlight();
      // 重置 lastTargetKey，让切页后落点检测重新生效
      this.dragState.lastTargetKey = '';
      // 清除文件夹悬停计时（切页不应触发文件夹创建）
      if (this.dragState.folderHoverTimer) {
        clearTimeout(this.dragState.folderHoverTimer);
        this.dragState.folderHoverTimer = null;
      }

      // 提交切页
      this.$store.commit('desktop/SET_CURRENT_PAGE', newPage);
      this.dragState.lastPageSwitchAt = Date.now();
      this.dragState.pageEdgeDir = 0;  // 重置方向，需要再次进入边缘才继续切
      // 触觉反馈
      if (navigator.vibrate) navigator.vibrate(8);
    },

    // 正式开始拖拽：创建 ghost、提交 SET_DRAGGING
    _beginDrag: function(e) {
      this.dragState.started = true;
      // 隐藏原占位的指针事件，避免干扰命中检测
      var sourceEl = this._findSourceElement(this.dragState.source);
      if (sourceEl) {
        sourceEl.style.visibility = 'hidden';
        this._dragSourceEl = sourceEl;
      }
      // 创建 ghost
      var ghost = this._createGhost(this.dragState.source);
      document.body.appendChild(ghost);
      this.dragState.ghostEl = ghost;

      this.$store.commit('desktop/SET_DRAGGING', this.dragState.source);
    },

    // 根据 source 找到原始 DOM 元素
    _findSourceElement: function(source) {
      var selector;
      if (source.type === 'page') {
        selector = '[data-src-type="page"][data-src-page="' + source.pageIndex + '"][data-src-idx="' + source.index + '"]';
      } else if (source.type === 'dock') {
        selector = '[data-src-type="dock"][data-src-dock="' + source.index + '"]';
      } else if (source.type === 'folder') {
        selector = '[data-src-type="folder"][data-src-folder="' + source.folderId + '"][data-src-app="' + source.appName + '"]';
      }
      return selector ? document.querySelector(selector) : null;
    },

    // 创建 ghost 元素（克隆图标视觉）
    // ghost 被 append 到 document.body，尺寸/圆角由 global.scss 的 .desktop-drag-ghost* 全局样式控制
    // （scoped 样式不作用于 body 上的元素，否则 img 会按自然尺寸 512px 放大）
    // 支持 app 和 folder 两种源：folder tile 的 data-src-type 是 'page'，需读实际 slot 判断类型
    _createGhost: function(source) {
      var ghost = document.createElement('div');
      ghost.className = 'desktop-drag-ghost';
      var innerHtml = '';

      // 判断拖拽源是 app 还是 folder（folder tile 的 source.type 也是 'page'）
      var slotContent = null;
      if (source.type === 'page') {
        var layout = this.$store.state.desktop.layout;
        if (layout && layout.pages[source.pageIndex]) {
          slotContent = layout.pages[source.pageIndex].slots[source.index];
        }
      }

      if (slotContent && slotContent.type === 'folder') {
        // folder 拖拽 ghost：显示文件夹缩略图（3×3 网格）
        var folder = this.$store.getters['desktop/folderById'](slotContent.id);
        var apps = folder ? folder.apps.slice(0, 9) : [];
        var gridHtml = '';
        for (var i = 0; i < apps.length; i++) {
          var meta = this.$store.getters['desktop/appByName'](apps[i]);
          gridHtml += '<div class="ghost-folder-cell"><img src="' + (meta ? meta.icon : '') + '" draggable="false"/></div>';
        }
        innerHtml = '<div class="desktop-drag-ghost-folder">' + gridHtml + '</div>';
      } else {
        // app 拖拽 ghost：显示应用图标（移除彩色背景，图标自带不透明底）
        var appMeta = this.$store.getters['desktop/appByName'](source.appName);
        var imgSrc = appMeta ? appMeta.icon : '';
        innerHtml = '<div class="desktop-drag-ghost-img"><img src="' + imgSrc + '" draggable="false"/></div>';
      }

      ghost.innerHTML = innerHtml;
      // 样式
      ghost.style.position = 'fixed';
      ghost.style.left = '0';
      ghost.style.top = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      // 中心对齐指针（ghost 72px，偏移 -36）；scale(1.08) 模拟 iPadOS 拖起放大反馈
      // transform-origin 默认 center，scale 不改变视觉中心，仍对齐指针
      ghost.style.transform = 'translate(' + (this.dragState.startX - 36) + 'px,' + (this.dragState.startY - 36) + 'px) scale(1.08)';
      return ghost;
    },

    // 更新 ghost 位置（中心对齐指针）
    _updateGhost: function(x, y) {
      if (!this.dragState.ghostEl) return;
      // ghost 72px，偏移 -36 使中心对齐指针；scale(1.08) 拖起放大
      this.dragState.ghostEl.style.transform = 'translate(' + (x - 36) + 'px,' + (y - 36) + 'px) scale(1.08)';
    },

    // 落点检测：用 elementFromPoint 找目标槽位
    _findDropTarget: function(x, y) {
      // 暂时隐藏 ghost 以便 elementFromPoint 命中下层元素
      var ghost = this.dragState.ghostEl;
      var prevDisplay = ghost ? ghost.style.display : '';
      if (ghost) ghost.style.display = 'none';

      var el = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = prevDisplay;

      if (!el) return null;
      // 查找最近的槽位标识元素
      var slotEl = el.closest('[data-dst-type]');
      if (!slotEl) return null;

      var type = slotEl.getAttribute('data-dst-type');
      var target = { type: type };
      var page = slotEl.getAttribute('data-dst-page');
      var idx = slotEl.getAttribute('data-dst-idx');
      var dock = slotEl.getAttribute('data-dst-dock');
      var folder = slotEl.getAttribute('data-dst-folder');
      if (page !== null) target.pageIndex = parseInt(page, 10);
      if (idx !== null) target.index = parseInt(idx, 10);
      // dock="append" 表示落点为 dock-bar 空白处（追加到末尾），用 isAppend 标志显式处理
      if (dock === 'append') {
        target.isAppend = true;
        target.index = null;
      } else if (dock !== null) {
        target.index = parseInt(dock, 10);
      }
      if (folder !== null) target.folderId = folder;

      // 读取目标槽位当前内容（用于判断空/交换/并入文件夹）
      target.element = slotEl;
      target.slotContent = this._readSlotContent(target);
      return target;
    },

    // 读取目标槽位当前内容
    _readSlotContent: function(target) {
      var layout = this.$store.state.desktop.layout;
      if (!layout) return null;
      if (target.type === 'page') {
        var page = layout.pages[target.pageIndex];
        if (!page) return null;
        return page.slots[target.index] || null;
      }
      if (target.type === 'dock') {
        // append 落点视为空（用于追加），不读取现有内容
        if (target.isAppend) return null;
        return layout.dock[target.index] ? { type: 'app', name: layout.dock[target.index] } : null;
      }
      if (target.type === 'folder') {
        return target.folderId;  // 文件夹本身
      }
      return null;
    },

    // 更新落点高亮 + 文件夹悬停计时 + 让位动画
    _updateDropHighlight: function(targetInfo) {
      // 清除旧高亮和旧让位
      this._clearDropHighlight();

      var newKey = targetInfo ? (targetInfo.type + ':' + (targetInfo.pageIndex !== undefined ? targetInfo.pageIndex : '') + ':' + (targetInfo.index !== undefined ? targetInfo.index : '') + ':' + (targetInfo.folderId || '')) : '';

      // 文件夹创建检测：目标是 app 类型槽位时启动悬停计时
      if (targetInfo && targetInfo.type === 'page' && targetInfo.slotContent && targetInfo.slotContent.type === 'app') {
        // 不能拖到自己原来的位置
        var src = this.dragState.source;
        var isSameSlot = src.type === 'page' && src.pageIndex === targetInfo.pageIndex && src.index === targetInfo.index;
        if (!isSameSlot) {
          if (this.dragState.lastTargetKey !== newKey) {
            // 重置计时
            if (this.dragState.folderHoverTimer) clearTimeout(this.dragState.folderHoverTimer);
            var self = this;
            this.dragState.folderHoverTimer = setTimeout(function() {
              self._createFolderFromHover(targetInfo);
            }, FOLDER_HOVER_MS);
          }
        }
      } else {
        if (this.dragState.folderHoverTimer) {
          clearTimeout(this.dragState.folderHoverTimer);
          this.dragState.folderHoverTimer = null;
        }
      }

      // 目标变化时触觉反馈（手机桌面标准行为）
      var targetChanged = newKey && newKey !== this.dragState.lastTargetKey;
      this.dragState.targetInfo = targetInfo;
      this.dragState.lastTargetKey = newKey;

      // 应用新高亮
      if (targetInfo && targetInfo.element) {
        targetInfo.element.classList.add('slot--drop-target');
        this._lastHighlightEl = targetInfo.element;
        if (targetChanged && navigator.vibrate) navigator.vibrate(8);
      }

      // 应用让位动画（目标图标向被拖图标原位置方向位移，给出"让位"视觉提示）
      this._applyShoveAnimation(targetInfo);
    },

    // 清除所有落点高亮 + 让位动画
    _clearDropHighlight: function() {
      if (this._lastHighlightEl) {
        this._lastHighlightEl.classList.remove('slot--drop-target');
        this._lastHighlightEl = null;
      }
      this._clearShoveAnimation();
    },

    // 让位动画：目标槽位图标向被拖图标原位置方向位移（模拟交换预览）
    // 纯视觉效果，不移动数据；拖拽结束时由 MOVE_APP + FLIP 完成实际移动
    _applyShoveAnimation: function(targetInfo) {
      this._clearShoveAnimation();
      if (!targetInfo || !targetInfo.element) return;
      // 空槽位/append 落点没有图标可推
      if (!targetInfo.slotContent) return;
      // 文件夹创建悬停场景不施让位（交给文件夹创建逻辑）
      if (targetInfo.type === 'folder') return;

      var src = this.dragState.source;
      // 不能对自己让位
      if (src.type === 'page' && targetInfo.type === 'page' &&
          src.pageIndex === targetInfo.pageIndex && src.index === targetInfo.index) return;
      if (src.type === 'dock' && targetInfo.type === 'dock' && src.index === targetInfo.index) return;

      // 找到目标槽位内的图标元素
      var slotEl = targetInfo.element;
      var iconEl = slotEl.querySelector('.app-icon') ||
                   slotEl.querySelector('.desktop-folder-tile') ||
                   slotEl.querySelector('.dock-icon');
      if (!iconEl) return;

      // 获取被拖图标原位置
      var srcEl = this._findSourceElement(src);
      if (!srcEl) return;
      var srcRect = srcEl.getBoundingClientRect();
      var tgtRect = slotEl.getBoundingClientRect();

      // 方向：从目标指向源（目标图标向源位置位移，模拟"去交换"）
      var dx = srcRect.left - tgtRect.left;
      var dy = srcRect.top - tgtRect.top;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) return;

      // 位移量：最大 22px，距离近时按比例缩小
      var shove = Math.min(dist * 0.35, 22);
      var tx = (dx / dist) * shove;
      var ty = (dy / dist) * shove;

      iconEl.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)';
      iconEl.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(0.92)';
      iconEl.style.zIndex = '5';
      this._lastShoveEl = iconEl;
    },

    // 清除让位动画
    _clearShoveAnimation: function() {
      if (this._lastShoveEl) {
        var el = this._lastShoveEl;
        el.style.transform = '';
        el.style.zIndex = '';
        // 延迟清除 transition，让恢复有平滑动画
        setTimeout(function() {
          if (el) el.style.transition = '';
        }, 240);
        this._lastShoveEl = null;
      }
    },

    // 悬停超时：创建文件夹
    _createFolderFromHover: function(targetInfo) {
      var targetApp = targetInfo.slotContent.name;
      var draggedApp = this.dragState.source.appName;
      if (!targetApp || !draggedApp || targetApp === draggedApp) return;

      // 记录 FLIP 前位置
      var oldRects = this._captureIconRects();
      var src = this.dragState.source;

      // 构造 from：newAppName 的原位置（用于清源，避免图标在文件夹+桌面双重显示）
      // 注意：folder 内拖出创建文件夹的场景不存在（folder 内 app 拖到 page 是 MOVE_APP，不触发 CREATE_FOLDER）
      var fromPayload = null;
      if (src.type === 'page') {
        fromPayload = { type: 'page', pageIndex: src.pageIndex, index: src.index };
      } else if (src.type === 'dock') {
        fromPayload = { type: 'dock', index: src.index };
      }

      this.$store.commit('desktop/CREATE_FOLDER', {
        pageIndex: targetInfo.pageIndex,
        index: targetInfo.index,
        targetAppName: targetApp,
        newAppName: draggedApp,
        folderName: '文件夹',
        from: fromPayload
      });

      // 拖拽结束（图标已并入文件夹）
      this._cleanupDrag();
      this.$store.dispatch('desktop/saveDesktopLayout');

      // FLIP 动画
      this._runFlipAnimation(oldRects);

      // 触觉反馈
      if (navigator.vibrate) navigator.vibrate(15);
    },

    // 文档级松开处理
    _onDragUp: function(e) {
      if (!this.dragState) return;

      // 未正式开始：清理预备状态
      if (!this.dragState.started) {
        this._cleanupDrag();
        return;
      }

      var target = this.dragState.targetInfo;
      var source = this.dragState.source;

      // Dock 满载拦截：追加到 Dock 且已满 12 且来源非 Dock → 提示并取消
      // （mutation 保持纯函数，拦截逻辑放在此处；Dock 内重排不受限）
      if (target && target.type === 'dock' && target.isAppend) {
        var layout = this.$store.state.desktop.layout;
        var dockLen = layout && layout.dock ? layout.dock.length : 0;
        if (dockLen >= 12 && source.type !== 'dock') {
          if (this.$store.state.toast) {
            this.$store.commit('toast/SHOW_TOAST', { message: 'Dock 已满（12/12）', type: 'info' });
          }
          this._cleanupDrag();
          return;
        }
      }

      // 记录 FLIP 前位置
      var oldRects = this._captureIconRects();

      if (target) {
        // 提交 MOVE_APP
        this.$store.commit('desktop/MOVE_APP', {
          from: source,
          to: target
        });
      }
      this._cleanupDrag();
      this.$store.dispatch('desktop/saveDesktopLayout');

      // FLIP 动画
      this._runFlipAnimation(oldRects);

      // 触觉反馈
      if (navigator.vibrate) navigator.vibrate(10);
    },

    // 清理拖拽状态
    _cleanupDrag: function() {
      // 取消 rAF 避免悬挂回调
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      // 清除高亮
      this._clearDropHighlight();
      // 恢复原元素可见性
      if (this._dragSourceEl) {
        this._dragSourceEl.style.visibility = '';
        this._dragSourceEl = null;
      }
      // 移除 ghost
      if (this.dragState && this.dragState.ghostEl) {
        if (this.dragState.ghostEl.parentNode) {
          this.dragState.ghostEl.parentNode.removeChild(this.dragState.ghostEl);
        }
      }
      // 清除文件夹悬停计时
      if (this.dragState && this.dragState.folderHoverTimer) {
        clearTimeout(this.dragState.folderHoverTimer);
      }
      // 清除跨页切页计时
      if (this.dragState && this.dragState.pageSwitchTimer) {
        clearTimeout(this.dragState.pageSwitchTimer);
      }
      // 移除文档监听
      if (this._dragMoveEvent) {
        document.removeEventListener(this._dragMoveEvent, this._onDragMoveBound);
        document.removeEventListener(this._dragUpEvent, this._onDragUpBound);
      }
      this.dragState = null;
      this._dragMoveEvent = null;
      this._dragUpEvent = null;
      this._onDragMoveBound = null;
      this._onDragUpBound = null;
      // 重置 store 拖拽状态
      this.$store.commit('desktop/SET_DRAGGING', null);
    },

    // 记录所有图标元素的当前 boundingRect（用于 FLIP）
    _captureIconRects: function() {
      var rects = {};
      var icons = document.querySelectorAll('[data-flip-key]');
      for (var i = 0; i < icons.length; i++) {
        var key = icons[i].getAttribute('data-flip-key');
        rects[key] = icons[i].getBoundingClientRect();
      }
      return rects;
    },

    // FLIP 动画：DOM 更新后，从旧位置过渡到新位置
    _runFlipAnimation: function(oldRects) {
      var self = this;
      this.$nextTick(function() {
        var icons = document.querySelectorAll('[data-flip-key]');
        for (var i = 0; i < icons.length; i++) {
          var el = icons[i];
          var key = el.getAttribute('data-flip-key');
          var oldRect = oldRects[key];
          if (!oldRect) continue;
          var newRect = el.getBoundingClientRect();
          var dx = oldRect.left - newRect.left;
          var dy = oldRect.top - newRect.top;
          if (dx === 0 && dy === 0) continue;
          el.style.willChange = 'transform';
          (function(elRef) {
            var anim = elRef.animate(
              [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' },
               { transform: 'translate(0,0)' }],
              { duration: FLIP_DURATION, easing: FLIP_EASING }
            );
            anim.onfinish = function() { elRef.style.willChange = ''; };
          })(el);
        }
      });
    },

    // 供模板调用：判断某槽位是否为当前拖拽目标（用于额外高亮）
    isDropTarget: function(type, pageIndex, index) {
      if (!this.dragState || !this.dragState.targetInfo) return false;
      var t = this.dragState.targetInfo;
      if (t.type !== type) return false;
      if (type === 'page') return t.pageIndex === pageIndex && t.index === index;
      if (type === 'dock') return t.index === index;
      return false;
    }
  },
  beforeDestroy: function() {
    // 清理文档级监听（防止内存泄漏）
    if (this._onDragMoveBound) {
      document.removeEventListener(this._dragMoveEvent, this._onDragMoveBound);
      document.removeEventListener(this._dragUpEvent, this._onDragUpBound);
    }
    if (this.dragState && this.dragState.ghostEl && this.dragState.ghostEl.parentNode) {
      this.dragState.ghostEl.parentNode.removeChild(this.dragState.ghostEl);
    }
    if (this.dragState && this.dragState.folderHoverTimer) {
      clearTimeout(this.dragState.folderHoverTimer);
    }
    if (this.dragState && this.dragState.pageSwitchTimer) {
      clearTimeout(this.dragState.pageSwitchTimer);
    }
  }
};
