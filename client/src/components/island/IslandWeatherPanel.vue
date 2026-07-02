<template>
  <div class="island-body">
    <div class="weather-compact-content">
      <!-- 前方图标：天气图标 或 圆框感叹号 -->
      <i v-if="weatherIcon" class="fa-solid iw-icon" :class="weatherIcon" :style="{ color: alertColor }"></i>
      <i v-else class="fa-solid fa-circle-exclamation iw-icon" :style="{ color: alertColor }"></i>

      <!-- 单行滚动文字 -->
      <div class="iw-scroll-wrap">
        <span class="iw-scroll-text" ref="scrollText" :style="{ '--scroll-duration': scrollDuration + 'ms' }">{{ scrollContent }}</span>
      </div>

      <!-- 后方感叹号：仅当前方是天气图标时 -->
      <i v-if="weatherIcon" class="fa-solid fa-circle-exclamation iw-end" :style="{ color: alertColor }"></i>
    </div>
  </div>
</template>

<script>
// 事件类型关键词 → FontAwesome 天气图标
var WEATHER_ICONS = {
  rain: 'fa-cloud-rain',
  snow: 'fa-snowflake',
  thunder: 'fa-bolt',
  heat: 'fa-temperature-high',
  cold: 'fa-temperature-low',
  wind: 'fa-wind',
  sand: 'fa-tornado',
  fog: 'fa-smog',
  ice: 'fa-icicles'
};

function detectWeather(eventName) {
  var name = (eventName || '').toLowerCase();
  if (name.indexOf('雨') > -1 || name.indexOf('rain') > -1) return 'rain';
  if (name.indexOf('雪') > -1 || name.indexOf('snow') > -1) return 'snow';
  if (name.indexOf('雷') > -1 || name.indexOf('thunder') > -1) return 'thunder';
  if (name.indexOf('高温') > -1 || name.indexOf('热') > -1 || name.indexOf('heat') > -1) return 'heat';
  if (name.indexOf('寒') > -1 || name.indexOf('冷') > -1 || name.indexOf('霜冻') > -1 || name.indexOf('cold') > -1) return 'cold';
  if (name.indexOf('风') > -1 || name.indexOf('wind') > -1 || name.indexOf('台风') > -1 || name.indexOf('飓风') > -1) return 'wind';
  if (name.indexOf('沙') > -1 || name.indexOf('尘') > -1 || name.indexOf('dust') > -1 || name.indexOf('sand') > -1) return 'sand';
  if (name.indexOf('雾') > -1 || name.indexOf('霾') > -1 || name.indexOf('fog') > -1 || name.indexOf('haze') > -1) return 'fog';
  if (name.indexOf('冰') > -1 || name.indexOf('ice') > -1) return 'ice';
  return null;
}

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

    // 天气图标：根据事件类型匹配（雨/雪/雷/风/雾/沙/冰/高低温），无匹配返回 null → 用感叹号
    weatherIcon: function() {
      var w = this.alert;
      var eventName = (w && w.eventType && w.eventType.name) || '';
      var key = detectWeather(eventName);
      return key ? WEATHER_ICONS[key] : null;
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

/* 前方图标（天气图标 或 感叹号） */
.iw-icon {
  flex-shrink: 0;
  font-size: 18px;
}

/* 后方感叹号 */
.iw-end {
  flex-shrink: 0;
  font-size: 14px;
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
