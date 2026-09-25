<template>
  <div class="lock-screen" @click="handleTap" @touchend.prevent="handleTap">
    <!-- 壁纸层：与桌面同一张壁纸（视频壁纸在锁屏退化为静态渐变，省电省性能） -->
    <div class="lock-wallpaper" :style="wallpaperStyle" aria-hidden="true"></div>
    <div class="lock-scrim" aria-hidden="true"></div>

    <div class="lock-content">
      <i class="fa-solid fa-lock lock-glyph" aria-hidden="true"></i>
      <div class="lock-time" role="timer">{{ timeText }}</div>
      <div class="lock-date">{{ dateText }}</div>
      <div class="lock-caption">已锁定</div>
    </div>

    <!-- 解锁手势反馈：右上角连点时浮现进度点（平时不可见，不破坏防误触设计） -->
    <div class="lock-taps" :class="{ 'lock-taps-on': tapHintVisible }" aria-hidden="true">
      <span
        v-for="n in 10"
        :key="n"
        class="lock-tap-dot"
        :class="{ 'lock-tap-dot-on': n <= tapTimes.length }"
      ></span>
    </div>

    <div class="lock-footer">
      <span class="lock-footer-item">{{ classInfo }}</span>
    </div>
  </div>
</template>

<script>
import { resolveWallpaper } from '@/utils/wallpaper-bg';

export default {
  name: 'LockScreen',
  data: function() {
    return {
      tapTimes: [],
      tapHintVisible: false,
      classInfo: '',
      timeText: '',
      dateText: '',
      _clockTimer: null,
      _hintTimer: null
    };
  },
  computed: {
    wallpaperResolved: function() {
      return resolveWallpaper(this.$store.state.settings.wallpaper);
    },
    // 锁屏直接用桌面壁纸的静态形态；视频壁纸退化为默认渐变（锁屏不做视频解码）
    wallpaperStyle: function() {
      var resolved = this.wallpaperResolved;
      if (resolved.type === 'video' || !resolved.style) {
        return resolveWallpaper('default').style;
      }
      return resolved.style;
    }
  },
  created: function() {
    this.classInfo = '智慧课堂 · ' + (window.location.hostname || '本机');
    this.updateClock();
    // 分钟级时钟：每 15 秒对齐一次，避免跨分钟闪烁
    var self = this;
    this._clockTimer = setInterval(function() {
      self.updateClock();
    }, 15000);
  },
  beforeDestroy: function() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
  },
  methods: {
    updateClock: function() {
      var now = new Date();
      var h = String(now.getHours()).padStart(2, '0');
      var m = String(now.getMinutes()).padStart(2, '0');
      this.timeText = h + ':' + m;
      try {
        this.dateText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
      } catch (e) {
        this.dateText = (now.getMonth() + 1) + '月' + now.getDate() + '日';
      }
    },
    handleTap: function(e) {
      var x = e.clientX;
      var y = e.clientY;
      if (e.changedTouches && e.changedTouches.length > 0) {
        x = e.changedTouches[0].clientX;
        y = e.changedTouches[0].clientY;
      }
      var w = window.innerWidth;
      var h = window.innerHeight;
      // 解锁手势保留原设计：右上角区域（x>70% 且 y<30%）3 秒内连点 10 次
      if (x < w * 0.7 || y > h * 0.3) return;
      var now = Date.now();
      // 超过 3 秒间隔则重新计数
      var times = this.tapTimes;
      if (times.length > 0 && now - times[times.length - 1] > 3000) {
        this.tapTimes = [];
      }
      this.tapTimes.push(now);
      if (this.tapTimes.length > 10) {
        this.tapTimes = this.tapTimes.slice(-10);
      }
      // 进度点反馈：显示当前计数，1.4 秒无操作后淡出
      this.tapHintVisible = true;
      var self = this;
      if (this._hintTimer) clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(function() {
        self.tapHintVisible = false;
        self.tapTimes = [];
      }, 1400);
      if (this.tapTimes.length === 10) {
        var diff = this.tapTimes[9] - this.tapTimes[0];
        if (diff < 3000) {
          this.tapTimes = [];
          this.tapHintVisible = false;
          this.$emit('unlock');
        }
      }
    }
  }
};
</script>

<style scoped>
/* ============================================================
   锁屏 = iPadOS 锁屏语言：全屏壁纸 + 重压暗 + 大时钟 + 日期
   解锁手势（右上角连点 10 次）保持隐蔽，仅以进度点做点击反馈
   Chrome 80 基线：不使用 gap / inset / :is() / aspect-ratio
   ============================================================ */
.lock-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99999;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
  background: #000;
  color: #fff;
}

.lock-wallpaper {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
}

/* 压暗蒙版：底部更深，让页脚信息可读 */
.lock-scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.42) 0%, rgba(0, 0, 0, 0.5) 62%, rgba(0, 0, 0, 0.68) 100%);
}

/* ---------- 主内容：锁图标 + 大时钟 + 日期 ---------- */
.lock-content {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 轻微上移，视觉重心与 iPadOS 锁屏一致 */
  padding-bottom: 6vh;
  box-sizing: border-box;
  animation: lock-in 0.6s cubic-bezier(0, 0, 0.2, 1) both;
}

@keyframes lock-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.lock-glyph {
  font-size: 17px;
  color: rgba(255, 255, 255, 0.66);
  margin-bottom: 18px;
}

.lock-time {
  font-size: 84px;
  font-weight: 500;
  line-height: 1.05;
  letter-spacing: 2px;
  color: #fff;
  text-shadow: 0 2px 28px rgba(0, 0, 0, 0.45);
  font-variant-numeric: tabular-nums;
}

.lock-date {
  margin-top: 8px;
  font-size: 17px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.82);
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.4);
}

.lock-caption {
  margin-top: 22px;
  padding: 6px 16px;
  border-radius: var(--radius-pill, 9999px);
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
  letter-spacing: 3px;
  text-indent: 3px;
  color: rgba(255, 255, 255, 0.7);
}

/* ---------- 解锁进度点：右上角 ---------- */
.lock-taps {
  position: absolute;
  top: 22px;
  right: 26px;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}

.lock-taps.lock-taps-on {
  opacity: 1;
}

.lock-tap-dot {
  width: 7px;
  height: 7px;
  margin-left: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  transition: background-color 0.12s ease;
}

.lock-tap-dot:first-child {
  margin-left: 0;
}

.lock-tap-dot-on {
  background: #fff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
}

/* ---------- 页脚 ---------- */
.lock-footer {
  position: absolute;
  bottom: 18px;
  left: 28px;
  right: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lock-footer-item {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  letter-spacing: 0.5px;
}

/* ---------- 低性能设备：去掉阴影开销（本组件无模糊，主要省文本阴影） ---------- */
[data-perf="low"] .lock-time,
[data-perf="low"] .lock-date {
  text-shadow: none;
}

/* ---------- 减弱动画 ---------- */
@media (prefers-reduced-motion: reduce) {
  .lock-content {
    animation: none;
  }
}
</style>
