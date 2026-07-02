/**
 * Island 手势与动画逻辑 Mixin
 *
 * 职责：
 * - 触摸事件处理（touchstart/move/end）
 * - 长按检测（500ms）
 * - 滑动手势（水平滑动关闭通知、上滑关闭音乐）
 * - 鼠标按下时间记录
 * - FLIP 高度过渡动画（Web Animations API）
 *
 * 依赖：无外部依赖，需要宿主组件提供 islandMode/goCompact 等方法
 * 注入到：SuperIsland.vue
 */

var LONG_PRESS_MS = 500;
var SWIPE_THRESHOLD = 50;

export default {
  data: function() {
    return {
      touchStartX: 0,
      touchStartY: 0,
      touchStartTime: 0,
      longPressTimer: null,
      isSwiping: false,
      swipeDy: 0,
      mouseDownTime: 0
    };
  },

  methods: {
    onTouchStart: function(e) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartTime = Date.now();
      this.isSwiping = false;
      this.swipeDy = 0;
      var self = this;
      this.longPressTimer = setTimeout(function() {
        self.onLongPress();
      }, LONG_PRESS_MS);
    },

    onTouchMove: function(e) {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      var dx = e.touches[0].clientX - this.touchStartX;
      var dy = e.touches[0].clientY - this.touchStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        this.isSwiping = true;
      }
      if ((this.islandMode === 'music-compact' || this.islandMode === 'music-expanded') && dy < -10) {
        this.swipeDy = dy;
        var islandEl = this.$el && this.$el.querySelector('.island');
        if (islandEl) {
          islandEl.style.transform = 'translateY(' + Math.min(0, dy) + 'px)';
          islandEl.style.transition = 'none';
          islandEl.style.opacity = Math.max(0.3, 1 + dy / 200);
        }
      }
    },

    onTouchEnd: function(e) {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      var islandEl = this.$el && this.$el.querySelector('.island');
      // 上滑关闭音乐岛
      if ((this.islandMode === 'music-compact' || this.islandMode === 'music-expanded') && this.swipeDy < -50) {
        if (islandEl) {
          islandEl.style.transition = 'transform 0.25s var(--ease-standard), opacity 0.25s var(--ease-standard)';
          islandEl.style.transform = 'translateY(-80px)';
          islandEl.style.opacity = '0';
        }
        var self = this;
        setTimeout(function() {
          self.islandMode = 'compact';
          self.musicIslandDismissed = true;
          self.swipeDy = 0;
          if (islandEl) {
            islandEl.style.transition = '';
            islandEl.style.transform = '';
            islandEl.style.opacity = '';
          }
        }, 260);
        this.isSwiping = false;
        return;
      }
      // 音乐岛未触发上滑，恢复样式
      if (islandEl && (this.islandMode === 'music-compact' || this.islandMode === 'music-expanded')) {
        islandEl.style.transition = 'transform 0.2s var(--ease-standard), opacity 0.2s var(--ease-standard)';
        islandEl.style.transform = '';
        islandEl.style.opacity = '';
        var cleanupEl = islandEl;
        setTimeout(function() {
          cleanupEl.style.transition = '';
        }, 220);
      }
      // 通知模式水平滑动关闭
      if (this.isSwiping && this.islandMode === 'notification') {
        var dx = e.changedTouches[0].clientX - this.touchStartX;
        if (Math.abs(dx) > SWIPE_THRESHOLD) {
          this.dismissNotification();
          return;
        }
      }
      this.isSwiping = false;
      this.swipeDy = 0;
    },

    onMouseDown: function() {
      this.mouseDownTime = Date.now();
    },

    onLongPress: function() {
      if (this.islandMode === 'notification') {
        if (this.notificationHistory.length > 0) {
          this.islandMode = 'history';
        }
      } else if (this.islandMode === 'compact' || this.islandMode === 'split') {
        if (this.isOnDesktop && this.browserEnabled) {
          this.islandMode = 'compact';
          this.$router.push({ name: 'Browser' }).catch(function() {});
        } else if (this.isOnDesktop) {
          this.$router.push('/announcements').catch(function() {});
        } else {
          this.islandMode = 'actions';
        }
      }
    },

    /**
     * FLIP 高度过渡动画
     * 在 islandMode 切换时平滑过渡 island 容器尺寸
     */
    animateIslandHeight: function() {
      var self = this;
      if (self.isDismissing || self.isBouncing) {
        if (self._pendingAnimate) cancelAnimationFrame(self._pendingAnimate);
        self._pendingAnimate = requestAnimationFrame(function() {
          self._pendingAnimate = null;
          self.animateIslandHeight();
        });
        return;
      }
      var islandEl = self.$el && self.$el.querySelector('.island');
      if (!islandEl) return;

      // 清理上一次动画
      if (self._flipAnimation) {
        if (self._flipAnimation._cleanup) self._flipAnimation._cleanup();
        self._flipAnimation.cancel();
        self._flipAnimation = null;
      }

      // 低性能模式跳过动画
      var perfLevel = document.documentElement.getAttribute('data-perf');
      if (perfLevel === 'low') return;

      var firstRect = islandEl.getBoundingClientRect();
      if (firstRect.height === 0) return;

      var isExpanding = true;
      var currentMode = self.islandMode;
      if (currentMode === 'compact' || currentMode === 'split' || currentMode === 'browser' || currentMode === 'music-compact') {
        isExpanding = false;
      }

      self.$nextTick(function() {
        var lastRect = islandEl.getBoundingClientRect();

        var sx = lastRect.width > 0 ? firstRect.width / lastRect.width : 1;
        var sy = lastRect.height > 0 ? firstRect.height / lastRect.height : 1;

        // 尺寸变化过小，跳过动画
        if (Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) {
          return;
        }

        islandEl.style.transformOrigin = 'top center';
        islandEl.style.willChange = 'transform';

        var keyframes;
        var timing;

        if (isExpanding) {
          keyframes = [
            { transform: 'scaleX(' + sx + ') scaleY(' + sy + ')', offset: 0 },
            { transform: 'scaleX(' + (1 + (1 - sx) * 0.2) + ') scaleY(' + (1 + (1 - sy) * 0.08) + ')', offset: 0.6 },
            { transform: 'scaleX(1) scaleY(1)', offset: 1 }
          ];
          timing = { duration: 350, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' };
        } else {
          keyframes = [
            { transform: 'scaleX(' + sx + ') scaleY(' + sy + ')', offset: 0 },
            { transform: 'scaleX(' + (sx + (1 - sx) * 0.5) + ') scaleY(' + (sy + (1 - sy) * 0.5) + ')', offset: 0.5 },
            { transform: 'scaleX(1) scaleY(1)', offset: 1 }
          ];
          timing = { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' };
        }

        var animation = islandEl.animate(keyframes, timing);
        self._flipAnimation = animation;

        var cleanup = function() {
          if (self._flipAnimation === animation) {
            self._flipAnimation = null;
          }
          islandEl.style.transformOrigin = '';
          islandEl.style.willChange = '';
        };

        animation._cleanup = cleanup;
        animation.onfinish = cleanup;
        self._flipFallbackTimer = setTimeout(function() {
          if (self._flipAnimation === animation) {
            animation.cancel();
            cleanup();
          }
        }, 500);
      });
    },

    cleanupGestureTimers: function() {
      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      if (this._pendingAnimate) cancelAnimationFrame(this._pendingAnimate);
      if (this._flipAnimation) {
        if (this._flipAnimation._cleanup) this._flipAnimation._cleanup();
        this._flipAnimation.cancel();
        this._flipAnimation = null;
      }
      if (this._flipFallbackTimer) clearTimeout(this._flipFallbackTimer);
    }
  }
};
