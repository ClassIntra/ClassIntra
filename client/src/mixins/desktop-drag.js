// 桌面拖拽引擎 mixin
// 提供图标拖拽能力：ghost 跟随、落点检测、FLIP 动画、文件夹创建（拖拽悬停 500ms）
// 使用方式：在 Desktop.vue 中 mixins: [desktopDrag]，容器绑定 @touchstart/@mousedown="onPointerDown"
// 依赖：组件 this.$store 有 desktop 模块

var DRAG_THRESHOLD = 5;        // 移动超过 5px 才正式开始拖拽
var FOLDER_HOVER_MS = 500;     // 拖拽悬停 500ms 创建文件夹
var FLIP_DURATION = 300;       // FLIP 动画时长
var FLIP_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';  // iOS 弹性曲线

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
        lastTargetKey: ''
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

      // 未正式开始：检查阈值
      if (!this.dragState.started) {
        var dx = point.x - this.dragState.startX;
        var dy = point.y - this.dragState.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        // 超过阈值，正式开始拖拽
        this._beginDrag(e);
      }

      // 阻止默认行为（防止滚动）
      if (e.cancelable) e.preventDefault();

      // 更新 ghost 位置
      this._updateGhost(point.x, point.y);

      // 落点检测
      var targetInfo = this._findDropTarget(point.x, point.y);
      this._updateDropHighlight(targetInfo);
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
    _createGhost: function(source) {
      var appMeta = this.$store.getters['desktop/appByName'](source.appName);
      var ghost = document.createElement('div');
      ghost.className = 'desktop-drag-ghost';
      var imgSrc = appMeta ? appMeta.icon : '';
      var bgColor = appMeta ? appMeta.color : '#8E8E93';
      ghost.innerHTML =
        '<div class="desktop-drag-ghost-img" style="background:' + bgColor + '">' +
        '<img src="' + imgSrc + '" draggable="false" />' +
        '</div>';
      // 样式
      ghost.style.position = 'fixed';
      ghost.style.left = '0';
      ghost.style.top = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      ghost.style.transform = 'translate(' + this.dragState.startX + 'px,' + this.dragState.startY + 'px)';
      ghost.style.transition = 'transform 0.05s linear';
      return ghost;
    },

    // 更新 ghost 位置（中心对齐指针）
    _updateGhost: function(x, y) {
      if (!this.dragState.ghostEl) return;
      // ghost 60px，偏移 -30 使中心对齐指针
      this.dragState.ghostEl.style.transform = 'translate(' + (x - 30) + 'px,' + (y - 30) + 'px) scale(1.1)';
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
      if (dock !== null) target.index = parseInt(dock, 10);
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
        return layout.dock[target.index] ? { type: 'app', name: layout.dock[target.index] } : null;
      }
      if (target.type === 'folder') {
        return target.folderId;  // 文件夹本身
      }
      return null;
    },

    // 更新落点高亮 + 文件夹悬停计时
    _updateDropHighlight: function(targetInfo) {
      // 清除旧高亮
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

      this.dragState.targetInfo = targetInfo;
      this.dragState.lastTargetKey = newKey;

      // 应用新高亮
      if (targetInfo && targetInfo.element) {
        targetInfo.element.classList.add('slot--drop-target');
      }
    },

    // 清除所有落点高亮
    _clearDropHighlight: function() {
      var highlighted = document.querySelectorAll('.slot--drop-target');
      for (var i = 0; i < highlighted.length; i++) {
        highlighted[i].classList.remove('slot--drop-target');
      }
    },

    // 悬停超时：创建文件夹
    _createFolderFromHover: function(targetInfo) {
      var targetApp = targetInfo.slotContent.name;
      var draggedApp = this.dragState.source.appName;
      if (!targetApp || !draggedApp || targetApp === draggedApp) return;

      // 记录 FLIP 前位置
      var oldRects = this._captureIconRects();

      this.$store.commit('desktop/CREATE_FOLDER', {
        pageIndex: targetInfo.pageIndex,
        index: targetInfo.index,
        targetAppName: targetApp,
        newAppName: draggedApp,
        folderName: '文件夹'
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

      // 记录 FLIP 前位置
      var oldRects = this._captureIconRects();

      var target = this.dragState.targetInfo;
      if (target) {
        // 提交 MOVE_APP
        this.$store.commit('desktop/MOVE_APP', {
          from: this.dragState.source,
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
  }
};
