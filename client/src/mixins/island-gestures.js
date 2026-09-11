/**
 * Island 手势与动画逻辑 Mixin
 *
 * 职责：
 * - 触摸事件处理（touchstart/move/end）
 * - 长按检测（500ms）
 * - 滑动手势（水平滑动关闭通知、上滑关闭音乐）
 * - 鼠标按下时间记录 / 右键
 * - FLIP 高度过渡动画（Web Animations API）
 *
 * 长按语义（第十三轮扩充，入口从 1 条扩到 4 条）：
 *   1. 通知展示时长按    → 进入历史（原有）
 *   2. 任意模式长按      → 直接进入历史（新增，用户的「长按超能岛」）
 *   3. 快捷操作面板      → 面板内「通知记录」按钮（新增，见 IslandActionsPanel）
 *   4. 桌面空白双击      → 进入历史（新增，见 Desktop.vue）
 *   5. 右键 / 长按鼠标   → 桌面环境下等效长按（新增）
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
      mouseDownTime: 0,
      // 长按已触发标记：用于抑制随后的 click（避免长按后又走一遍 handleClick）
      longPressFired: false
    };
  },

  methods: {
    onTouchStart: function(e) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartTime = Date.now();
      this.isSwiping = false;
      this.swipeDy = 0;
      this.longPressFired = false;
      var self = this;
      this.longPressTimer = setTimeout(function() {
        self.longPressFired = true;
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
      // 长按已触发时，300ms 内抑制 click（浏览器仍会补发 click）
      if (this.longPressFired) {
        var guard = this;
        setTimeout(function() { guard.longPressFired = false; }, 320);
      }
    },

    onMouseDown: function() {
      this.mouseDownTime = Date.now();
      // 桌面端没有 touchstart，用 mousedown 计时补上长按能力
      var self = this;
      this.longPressFired = false;
      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(function() {
        self.longPressFired = true;
        self.onLongPress();
      }, LONG_PRESS_MS);
    },

    onMouseUp: function() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (this.longPressFired) {
        var guard = this;
        setTimeout(function() { guard.longPressFired = false; }, 320);
      }
    },

    // 右键 / 长按鼠标 → 历史（桌面端主要入口）
    onContextMenu: function(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      this.openHistory();
    },

    /**
     * 统一的「唤出通知历史」入口。
     * 无论当前处于哪个模式，都能一步进入历史面板 —— 这是本轮扩充的核心。
     * 无历史记录时给出提示而非静默失败（否则用户以为没反应）。
     */
    openHistory: function() {
      if (!this.notificationHistory || this.notificationHistory.length === 0) {
        // 无记录时给反馈而非静默返回；空态本身也会在面板里展示入口说明。
        if (this.$store) {
          this.$store.commit('toast/SHOW_TOAST', { message: '暂无通知记录', type: 'info' });
        }
        return;
      }
      // 已是历史模式则不重复切换（避免 FLIP 抖动）
      if (this.islandMode === 'history') return;
      this.prevMode = this.islandMode;
      this.islandMode = 'history';
    },

    onLongPress: function() {
      // 任意模式长按 === 唤出通知历史。
      // 原实现只在 notification 模式生效，导致通知收起后没有任何回看入口（第十三轮修复）。
      // 例外：浏览器/分享胶囊等有自身输入语义的面板，长按不劫持。
      var passthrough = ['browser', 'share-capsule'];
      if (passthrough.indexOf(this.islandMode) !== -1) return;
      this.openHistory();
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
