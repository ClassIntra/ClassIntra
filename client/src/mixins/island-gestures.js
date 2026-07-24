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
     * FLIP 尺寸 morph 动画（transform 驱动，合成层，零 layout 回流）
     *
     * apple-design §11: 只动画 transform/opacity，绝不动画 width/height —— 后者每帧
     * 触发 layout recalculation 导致卡顿。FLIP 用 transform: scale() 模拟尺寸变化：
     *   1. 测量 first rect（当前视觉尺寸）
     *   2. class 切换后测量 last rect（目标尺寸）
     *   3. 用 scaleX/scaleY 反向缩放让元素看起来还是 first 尺寸
     *   4. 用 WAAPI animate transform → scale(1)，平滑 morph 到目标尺寸
     *
     * apple-design §3: 可中断 —— 新切换时 cancel 进行中的动画，从当前视觉状态继续。
     * apple-design §4: critically damped（damping 1.0）—— tap 触发无动量，不应 overshoot。
     */
    animateIslandHeight: function() {
      var self = this;
      var islandEl = self.$el && self.$el.querySelector('.island');
      if (!islandEl) return;

      // 低性能模式跳过动画
      var perfLevel = document.documentElement.getAttribute('data-perf');
      if (perfLevel === 'low') return;

      // 1. 测量 first rect（当前视觉尺寸，可能正处于上次动画中间）
      var firstRect = islandEl.getBoundingClientRect();
      if (firstRect.width === 0 || firstRect.height === 0) return;

      // 2. 取消进行中的 FLIP（可中断）—— apple-design §3
      if (self._flipAnimation) {
        self._flipAnimation.cancel();
        self._flipAnimation = null;
      }

      self.$nextTick(function() {
        if (self.isDismissing || self.isBouncing) {
          // 等待 dismissing/bouncing 结束后再执行，避免与 pop-in 冲突
          if (self._pendingAnimate) cancelAnimationFrame(self._pendingAnimate);
          self._pendingAnimate = requestAnimationFrame(function() {
            self._pendingAnimate = null;
            self.animateIslandHeight();
          });
          return;
        }

        var lastRect = islandEl.getBoundingClientRect();
        if (lastRect.width === 0 || lastRect.height === 0) return;

        var sx = lastRect.width > 0 ? firstRect.width / lastRect.width : 1;
        var sy = lastRect.height > 0 ? firstRect.height / lastRect.height : 1;

        // 尺寸变化过小，跳过动画
        if (Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) return;

        islandEl.style.transformOrigin = 'top center';
        islandEl.style.willChange = 'transform';

        // 3. WAAPI 动画：从反向 scale morph 到 scale(1)
        // 方向感知：展开（尺寸变大）稍长、收起更利落 —— apple-design §7 可逆过渡镜像
        // 容器尺寸 morph 保持 critically damped（无 overshoot）：overflow:hidden 下 overshoot 会
        // 裁切内容，灵动感由内容入场 spring 提供（见 SuperIsland.vue .island-content-enter-active）
        var isExpanding = (lastRect.width * lastRect.height) >= (firstRect.width * firstRect.height);
        var animation = islandEl.animate(
          [
            { transform: 'scaleX(' + sx + ') scaleY(' + sy + ')' },
            { transform: 'scaleX(1) scaleY(1)' }
          ],
          {
            duration: isExpanding ? 340 : 270,
            // apple-design §4: damping 1.0（无 overshoot），response 0.27~0.34s
            easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
            fill: 'backwards'
          }
        );
        self._flipAnimation = animation;

        // 4. 完成后清理 inline 样式，让 CSS 接管
        var cleanup = function() {
          if (self._flipAnimation === animation) {
            self._flipAnimation = null;
          }
          islandEl.style.transformOrigin = '';
          islandEl.style.willChange = '';
        };
        animation._cleanup = cleanup;
        animation.onfinish = cleanup;
        animation.oncancel = cleanup;

        // 5. 兜底：500ms 后强制清理（防止 onfinish/oncancel 未触发）
        if (self._flipFallbackTimer) clearTimeout(self._flipFallbackTimer);
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
