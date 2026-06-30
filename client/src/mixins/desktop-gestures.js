// 桌面手势 mixin
// 提供三种手势：
//   1. 长按 500ms 进入编辑态（非编辑态下）
//   2. 双指捏合调出桌面设置面板
//   3. 单指横滑切换桌面页面（非编辑态、非拖拽中）
// 与 desktop-drag.js 协作：编辑态下单指事件由 drag 处理，本 mixin 不干预

var LONG_PRESS_MS = 500;
var LONG_PRESS_MOVE_THRESHOLD = 10;  // 移动超过 10px 取消长按
var PINCH_TRIGGER_SCALE = 0.85;      // 缩放到 0.85 触发设置面板
var PAGE_SWIPE_THRESHOLD = 60;       // 横滑超过 60px 切页

export default {
  data: function() {
    return {
      _gestureLongPressTimer: null,
      _gestureTouchStartX: 0,
      _gestureTouchStartY: 0,
      _gesturePinchStartDist: 0,
      _gesturePinchTriggered: false,
      _gesturePageSwipeStartX: 0,
      _gesturePageSwipeActive: false
    };
  },
  methods: {
    // 容器 touchstart：由 Desktop.vue 在 @touchstart 调用
    onDesktopGestureTouchStart: function(e) {
      var isDragging = this.$store.state.desktop.isDragging;
      if (isDragging) return;  // 拖拽中不处理手势

      var touchCount = e.touches ? e.touches.length : 1;

      if (touchCount === 2) {
        // 双指：捏合检测
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
        // 单指：检查是否超过长按移动阈值
        var touch = e.touches[0];
        var dx = touch.clientX - this._gestureTouchStartX;
        var dy = touch.clientY - this._gestureTouchStartY;
        if (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD) {
          this._cancelLongPress();
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
        // 全部手指离开：判断横滑切页
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

    // 处理横滑切页
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
        }
      } else {
        // 右滑：上一页
        if (currentPage > 0) {
          this.$store.commit('desktop/SET_CURRENT_PAGE', currentPage - 1);
        }
      }
    }
  },
  beforeDestroy: function() {
    this._cancelLongPress();
  }
};
