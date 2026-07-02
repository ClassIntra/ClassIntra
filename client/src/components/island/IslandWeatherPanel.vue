<template>
  <div class="island-body">
    <div class="weather-compact-content">
      <!-- 圆框感叹号（根据预警颜色） -->
      <i class="fa-solid fa-circle-exclamation iw-exclaim" :style="{ color: alertColor }"></i>

      <!-- 单行滚动文字 -->
      <div class="iw-scroll-wrap">
        <span class="iw-scroll-text" ref="scrollText" :style="{ '--scroll-duration': scrollDuration + 'ms' }">{{ scrollContent }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandWeatherPanel',
  props: {
    alert: { type: Object, default: null },
    startTime: { type: Number, default: 0 }
  },
  data: function() {
    return {
      scrollDuration: 0,
      _autoCloseTimer: null
    };
  },
  computed: {
    alertColor: function() {
      var w = this.alert;
      if (!w) return '#F59E0B';
      if (w.color) {
        var c = w.color;
        return 'rgba(' + c.red + ',' + c.green + ',' + c.blue + ',' + (c.alpha != null ? c.alpha : 1) + ')';
      }
      // minor=蓝色  moderate=黄色  severe=橙色  extreme=红色
      var sevMap = { minor: '#3B82F6', moderate: '#F59E0B', severe: '#F97316', extreme: '#EF4444' };
      return sevMap[w.severity] || '#F59E0B';
    },

    // 滚动内容：headline（预报台+发布时间+预警信号）+ description（详细内容）
    scrollContent: function() {
      var w = this.alert;
      if (!w) return '';
      var parts = [];
      if (w.headline) parts.push(w.headline);
      if (w.description && w.description !== w.headline) parts.push(w.description);
      if (parts.length === 0) {
        parts.push((w.eventType && w.eventType.name) || '天气预警');
      }
      var line = parts.join('  ');
      return line + '          ' + line;
    }
  },
  mounted: function() {
    var self = this;
    var charWidth = 8;
    var singleLineLen = (self.scrollContent.length / 2) * charWidth;
    var totalDuration = Math.max(6000, singleLineLen / 30 * 1000);
    // 若有 startTime，计算剩余时长（通知打断后恢复时不会从头开始）
    if (self.startTime) {
      var elapsed = Date.now() - self.startTime;
      self.scrollDuration = Math.max(1000, totalDuration - elapsed);
    } else {
      self.scrollDuration = totalDuration;
    }
    self._autoCloseTimer = setTimeout(function() {
      self.$emit('request-close');
    }, self.scrollDuration + 500);
  },
  beforeDestroy: function() {
    if (this._autoCloseTimer) {
      clearTimeout(this._autoCloseTimer);
      this._autoCloseTimer = null;
    }
  }
};
</script>

<style scoped>
.weather-compact-content {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

/* 圆框感叹号 */
.iw-exclaim {
  flex-shrink: 0;
  font-size: 18px;
}

/* 单行滚动 */
.iw-scroll-wrap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.iw-scroll-text {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  line-height: 40px;
  animation: iw-marquee var(--scroll-duration, 12s) linear forwards;
}

@keyframes iw-marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

@media (prefers-reduced-motion: reduce) {
  .iw-scroll-text { animation: none !important; }
}
</style>
