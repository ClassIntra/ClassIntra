// 桌面手势 mixin
// 提供四种手势：
//   1. 长按 500ms 进入编辑态（非编辑态下）
//   2. 双指捏合调出桌面设置面板
//   3. 单指横滑跟手翻页：实时位移跟随（首/尾页橡皮筋阻尼），
//      松手按「位移过页宽 1/3 或瞬时速度超阈值」判定翻页，否则回弹
//   4. 快速轻扫兜底：未激活跟手的区域（widget/dock 等）沿用 60px 阈值一次性判定
// 与 desktop-drag.js 协作：编辑态下单指事件由 drag 处理，本 mixin 不干预

var LONG_PRESS_MS = 500;
var LONG_PRESS_MOVE_THRESHOLD = 10;  // 移动超过 10px 取消长按
var PINCH_TRIGGER_SCALE = 0.85;      // 缩放到 0.85 触发设置面板
var PAGE_SWIPE_THRESHOLD = 60;       // 兜底横滑：超过 60px 切页
var PAGE_DRAG_SLOP = 10;             // 跟手激活：横向位移阈值
var PAGE_DRAG_VERTICAL_RATIO = 1.2;  // 横向意图：|dx| 需大于 |dy| × 1.2
var PAGE_COMMIT_RATIO = 1 / 3;       // 松手翻页：位移超过页宽 1/3
var PAGE_FLING_VELOCITY = 0.5;       // 松手翻页：瞬时速度阈值（px/ms）
var PAGE_EDGE_RESISTANCE = 0.35;     // 首/尾页反向拖拽的橡皮筋阻尼

export default {
  data: function() {
    return {
      // 注：跟手位移不再放响应式 data（曾用 pageDragOffset）——逐帧响应式更新会让
      // 整个桌面组件重渲染。位移走实例字段 _dragOffsetPx，DOM 直写。
      _gestureLongPressTimer: null,
      _gestureTouchStartX: 0,
      _gestureTouchStartY: 0,
      _gesturePinchStartDist: 0,
      _gesturePinchTriggered: false,
      _gesturePageSwipeStartX: 0,
      _gesturePageSwipeActive: false,
      _gesturePageDragActive: false,
      _gesturePageDragAllow: false,
      _gesturePageDragLastX: 0,
      _gesturePageDragLastT: 0,
      _gesturePageDragVelocity: 0,
      _gesturePageDragPending: 0,
      _gesturePageDragRaf: 0,
      _dragGlassTimer: null
    };
  },
  methods: {
    // 容器 touchstart：由 Desktop.vue 在 @touchstart 调用
    onDesktopGestureTouchStart: function(e) {
      var isDragging = this.$store.state.desktop.isDragging;
      if (isDragging) return;  // 拖拽中不处理手势

      var touchCount = e.touches ? e.touches.length : 1;

      if (touchCount >= 2) {
        // 第二指落下：跟手翻页立即让位（复位偏移，交还捏合/多指状态机）
        if (this._gesturePageDragActive) {
          this._cancelPageDrag();
        }
        this._cancelLongPress();
        this._gesturePinchStartDist = this._getTouchDist(e.touches);
        this._gesturePinchTriggered = false;
        this._gesturePageSwipeActive = false;
      } else if (touchCount === 1) {
        // 单指
        var touch = e.touches[0];
        this._gestureTouchStartX = touch.clientX;
        this._gestureTouchStartY = touch.clientY;
        this._gesturePageSwipeStartX = touch.clientX;
        this._gesturePageSwipeActive = true;
        this._gesturePinchTriggered = true;  // 单指时屏蔽捏合

        // 跟手翻页：复位拖页状态，记录起点区域是否允许跟手
        this._gesturePageDragActive = false;
        this._gesturePageDragAllow = this._isPageDragAllowedTarget(e);
        this._gesturePageDragLastX = touch.clientX;
        this._gesturePageDragLastT = e.timeStamp || Date.now();
        this._gesturePageDragVelocity = 0;

        // 非编辑态下启动长按计时
        if (!this.$store.state.desktop.isEditMode) {
          this._startLongPress();
        }
      }
    },

    // 容器 touchmove：由 Desktop.vue 在 @touchmove 调用
    onDesktopGestureTouchMove: function(e) {
      var isDragging = this.$store.state.desktop.isDragging;
      if (isDragging) return;

      var touchCount = e.touches ? e.touches.length : 1;

      if (touchCount === 2 && this._gesturePinchStartDist > 0) {
        // 双指捏合
        var dist = this._getTouchDist(e.touches);
        var scale = dist / this._gesturePinchStartDist;
        if (scale < PINCH_TRIGGER_SCALE && !this._gesturePinchTriggered) {
          this._gesturePinchTriggered = true;
          this._triggerSettingsPanel();
        }
        return;
      }

      if (touchCount === 1) {
        var touch = e.touches[0];
        var dx = touch.clientX - this._gestureTouchStartX;
        var dy = touch.clientY - this._gestureTouchStartY;

        if (this._gesturePageDragActive) {
          // 已跟手：屏蔽浏览器原生手势（横滑历史导航/滚动），位移实时跟随
          if (e.cancelable) e.preventDefault();
          this._updatePageDrag(touch);
          return;
        }

        // 单指：检查是否超过长按移动阈值
        if (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD) {
          this._cancelLongPress();
        }

        // 横向意图确认 → 激活跟手翻页
        if (
          this._gesturePageDragAllow &&
          Math.abs(dx) > PAGE_DRAG_SLOP &&
          Math.abs(dx) > Math.abs(dy) * PAGE_DRAG_VERTICAL_RATIO
        ) {
          this._startPageDrag();
        }
      }
    },

    // 容器 touchend：由 Desktop.vue 在 @touchend 调用
    onDesktopGestureTouchEnd: function(e) {
      this._cancelLongPress();

      // 捏合结束：重置
      var endTouchCount = e.touches ? e.touches.length : 0;
      if (endTouchCount === 0) {
        this._gesturePinchStartDist = 0;
        this._gesturePinchTriggered = false;
        // 全部手指离开：跟手翻页收尾（翻页或回弹）
        if (this._gesturePageDragActive) {
          this._finishPageDrag(e);
          this._gesturePageSwipeActive = false;
          return;
        }
        // 兜底：一次性判定横滑切页（未激活跟手的场景，如 widget/dock 上快速轻扫）
        if (this._gesturePageSwipeActive) {
          var changedTouch = e.changedTouches && e.changedTouches[0];
          var endX = changedTouch ? changedTouch.clientX : this._gesturePageSwipeStartX;
          this._handlePageSwipe(endX - this._gesturePageSwipeStartX);
          this._gesturePageSwipeActive = false;
        }
      } else if (endTouchCount === 1) {
        // 从双指变单指：保持捏合已触发状态，重置横滑起点
        var t = e.touches[0];
        this._gesturePageSwipeStartX = t.clientX;
        this._gesturePageSwipeActive = true;
      }
    },

    // 启动长按计时
    _startLongPress: function() {
      this._cancelLongPress();
      var self = this;
      this._gestureLongPressTimer = setTimeout(function() {
        self._onLongPressTriggered();
      }, LONG_PRESS_MS);
    },

    // 取消长按计时
    _cancelLongPress: function() {
      if (this._gestureLongPressTimer) {
        clearTimeout(this._gestureLongPressTimer);
        this._gestureLongPressTimer = null;
      }
    },

    // 长按触发：进入编辑态
    _onLongPressTriggered: function() {
      if (this.$store.state.desktop.isEditMode) return;
      this.$store.dispatch('desktop/enterEditMode');
      // 触觉反馈
      if (navigator.vibrate) navigator.vibrate(15);
    },

    // 计算双指距离
    _getTouchDist: function(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    },

    // 触发设置面板
    _triggerSettingsPanel: function() {
      this.$store.commit('desktop/SET_SETTINGS_PANEL', true);
      // 触觉反馈
      if (navigator.vibrate) navigator.vibrate(20);
    },

    // ===== 跟手翻页 =====

    // 触摸起点是否允许跟手：白名单收紧为页面容器内部——
    // dock、页码指示器、公告浮窗、各弹窗浮层都在 .desktop-pages 之外，自动排除；
    // 容器内的小组件不抢手势（widget 可能有横向滚动/交互）
    _isPageDragAllowedTarget: function(e) {
      var el = e && e.target;
      if (!el || !el.closest) return false;
      return !!el.closest('.desktop-pages') && !el.closest('.desktop-widget');
    },

    // 激活跟手（前置条件与兜底横滑一致，另加设置面板）
    _startPageDrag: function() {
      if (this.$store.state.desktop.isEditMode) return;
      if (this.$store.state.desktop.openFolderId) return;
      if (this.$store.state.desktop.settingsPanelOpen) return;
      if (this.$store.getters['desktop/totalPages'] < 2) return;
      this._gesturePageDragActive = true;
      this._dragOffsetPx = 0;
      this._setPagingAttr(true);
      this._setDragGlassFlat(true);
    },

    // 实时更新拖页位移与瞬时速度（速度供松手 fling 判定）
    _updatePageDrag: function(touch) {
      var dx = touch.clientX - this._gestureTouchStartX;
      var totalPages = this.$store.getters['desktop/totalPages'];
      var currentPage = this.$store.state.desktop.currentPage;
      // 首/尾页反向拖拽：橡皮筋阻尼
      if ((currentPage === 0 && dx > 0) || (currentPage === totalPages - 1 && dx < 0)) {
        dx = dx * PAGE_EDGE_RESISTANCE;
      }
      this._setPageDragOffset(dx);

      // 瞬时速度用原始手指位移（不受阻尼影响），指数平滑抗抖
      var now = touch.timeStamp || Date.now();
      var dt = now - this._gesturePageDragLastT;
      if (dt > 0) {
        var instV = (touch.clientX - this._gesturePageDragLastX) / dt;
        this._gesturePageDragVelocity = (this._gesturePageDragVelocity || 0) * 0.6 + instV * 0.4;
      }
      this._gesturePageDragLastX = touch.clientX;
      this._gesturePageDragLastT = now;
    },

    // 位移写入 DOM（不经 Vue）：拖拽中每帧更新响应式 offset 会让整个桌面组件
    // 逐帧重渲染（三页图标全量 diff），在安卓 9 上是滑页掉帧的主要来源之一。
    // rAF 合帧后直写 transform + 页码指示器内部变量，Vue 只在松手翻页时参与一次。
    _setPageDragOffset: function(offset) {
      var self = this;
      this._gesturePageDragPending = offset;
      if (this._gesturePageDragRaf) return;
      this._gesturePageDragRaf = requestAnimationFrame(function() {
        self._gesturePageDragRaf = 0;
        if (!self._gesturePageDragActive) return;
        var dx = self._gesturePageDragPending || 0;
        self._dragOffsetPx = dx;
        var el = self.$refs.pagesEl;
        if (el) {
          var page = self.$store.state.desktop.currentPage;
          el.style.transform = 'translateX(calc(-' + (page * 100) + '% + ' + dx.toFixed(1) + 'px))';
        }
        var pager = self.$refs.pager;
        if (pager && pager.setDragProgress) {
          var w = window.innerWidth || 1;
          pager.setDragProgress(Math.max(-1, Math.min(1, -dx / w)));
        }
      });
    },

    // 跟手期间关闭 .desktop-pages 的过渡（[data-paging] 由 Desktop.vue scoped 样式消费）
    _setPagingAttr: function(on) {
      if (typeof document === 'undefined') return;
      var root = document.documentElement;
      if (on) {
        root.setAttribute('data-paging', '1');
      } else {
        root.removeAttribute('data-paging');
      }
    },

    // 滑页期间临时平化毛玻璃（[data-dragging="1"] 由 _motion.scss 消费）：
    // 页面在手指下移动时，dock/island 的 backdrop-filter 每帧都要重算背后画面 =
    // 滑页掉帧主源。松手后延迟恢复（覆盖翻页/回弹的 transform 过渡），静止观感不变。
    _setDragGlassFlat: function(on, restoreDelay) {
      if (typeof document === 'undefined') return;
      var root = document.documentElement;
      if (this._dragGlassTimer) {
        clearTimeout(this._dragGlassTimer);
        this._dragGlassTimer = null;
      }
      if (on) {
        root.setAttribute('data-dragging', '1');
        return;
      }
      var self = this;
      this._dragGlassTimer = setTimeout(function() {
        self._dragGlassTimer = null;
        root.removeAttribute('data-dragging');
      }, restoreDelay || 0);
    },

    // 松手收尾：按位移/速度判定翻页，否则回弹（恢复 transition 后由 CSS 补间）
    _finishPageDrag: function(e) {
      var active = this._gesturePageDragActive;
      var offset = this._dragOffsetPx || 0;
      var velocity = this._gesturePageDragVelocity || 0;
      this._gesturePageDragActive = false;
      this._gesturePageDragVelocity = 0;
      this._dragOffsetPx = 0;
      this._setPagingAttr(false);          // 先恢复 transition，下面的位置变更才有补间
      this._setDragGlassFlat(false, 320);  // 翻页/回弹过渡结束后恢复玻璃

      var pager = this.$refs.pager;
      if (pager && pager.clearDragProgress) pager.clearDragProgress();

      // 显著位移时抑制合成 click，防止滑页误启动图标（2px：封掉轻微滑动的残余误触）
      if (active && Math.abs(offset) > 2 && e && e.cancelable) {
        e.preventDefault();
      }

      var el = this.$refs.pagesEl;
      if (!active || !el) return;  // 没真正拖动过（点击/长按），不碰 DOM

      var width = window.innerWidth || 1;
      var totalPages = this.$store.getters['desktop/totalPages'];
      var currentPage = this.$store.state.desktop.currentPage;
      var forward = offset < 0;  // 左滑 → 下一页
      var crossed = Math.abs(offset) > width * PAGE_COMMIT_RATIO;
      var fling = Math.abs(velocity) > PAGE_FLING_VELOCITY && (forward ? velocity < 0 : velocity > 0);
      var target = currentPage + (forward ? 1 : -1);
      var willFlip = (crossed || fling) && target >= 0 && target <= totalPages - 1;

      if (willFlip) {
        // 提交页码：Vue 把 transform 写成新页位置，CSS transition 从当前拖动位置补间过去
        this.$store.commit('desktop/SET_CURRENT_PAGE', target);
        if (navigator.vibrate) navigator.vibrate(8);
      } else {
        // 回弹：把内联位移收敛回当前页位置，transition 自动补间
        el.style.transform = 'translateX(-' + (currentPage * 100) + '%)';
      }
    },

    // 中途取消跟手（第二指落下等）：立即复位偏移
    _cancelPageDrag: function() {
      this._gesturePageDragActive = false;
      this._gesturePageDragVelocity = 0;
      if (this._gesturePageDragRaf) {
        cancelAnimationFrame(this._gesturePageDragRaf);
        this._gesturePageDragRaf = 0;
      }
      this._dragOffsetPx = 0;
      this._setPagingAttr(false);
      var pager = this.$refs.pager;
      if (pager && pager.clearDragProgress) pager.clearDragProgress();
      var el = this.$refs.pagesEl;
      if (el) {
        var page = this.$store.state.desktop.currentPage;
        el.style.transform = 'translateX(-' + (page * 100) + '%)';
      }
      this._setDragGlassFlat(false, 320);  // 取消也可能伴随回弹过渡，同样等过渡结束
    },

    // 处理横滑切页（兜底路径）
    _handlePageSwipe: function(deltaX) {
      if (Math.abs(deltaX) < PAGE_SWIPE_THRESHOLD) return;
      // 编辑态下不切页
      if (this.$store.state.desktop.isEditMode) return;
      // 文件夹打开时不切页
      if (this.$store.state.desktop.openFolderId) return;

      var totalPages = this.$store.getters['desktop/totalPages'];
      var currentPage = this.$store.state.desktop.currentPage;
      if (deltaX < 0) {
        // 左滑：下一页
        if (currentPage < totalPages - 1) {
          this.$store.commit('desktop/SET_CURRENT_PAGE', currentPage + 1);
          if (navigator.vibrate) navigator.vibrate(8);  // 与跟手翻页路径保持一致
        }
      } else {
        // 右滑：上一页
        if (currentPage > 0) {
          this.$store.commit('desktop/SET_CURRENT_PAGE', currentPage - 1);
          if (navigator.vibrate) navigator.vibrate(8);
        }
      }
    }
  },
  beforeDestroy: function() {
    this._cancelLongPress();
    this._cancelPageDrag();
    this._setDragGlassFlat(false, 0);  // 离场兜底：避免 data-dragging 残留
  }
};
