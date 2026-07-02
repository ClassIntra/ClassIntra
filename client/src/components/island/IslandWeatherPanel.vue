<template>
  <div class="island-body">
    <div class="weather-compact-content">
      <!-- 前方图标：天气图标 或 圆框感叹号 -->
      <div class="iw-icon-circle" :style="{ color: alertColor, borderColor: alertColor }">
        <i class="fa-solid" :class="startIcon"></i>
      </div>

      <!-- 单行滚动文字：事件类型·预警内容 -->
      <div class="iw-scroll-wrap">
        <span class="iw-scroll-text" ref="scrollText" :style="{ '--scroll-duration': scrollDuration + 'ms' }">{{ scrollContent }}</span>
      </div>

      <!-- 后方圆框感叹号：仅当前方是天气图标时显示 -->
      <div v-if="showEndExclamation" class="iw-icon-circle iw-icon-circle--end" :style="{ color: alertColor, borderColor: alertColor }">
        <i class="fa-solid fa-exclamation"></i>
      </div>

      <!-- 关闭按钮 -->
      <button class="iw-close" @click.stop="$emit('dismiss')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>
</template>

<script>
// 事件类型关键词 → 天气图标（有对应图标 = 前方用天气图标，后方加感叹号）
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

function detectWeatherIcon(eventName) {
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
    alert: { type: Object, default: null }
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
      var sevMap = { minor: '#3B82F6', moderate: '#F59E0B', severe: '#EF4444', extreme: '#9333EA' };
      return sevMap[w.severity] || '#F59E0B';
    },

    // 前方图标：有天气类型匹配 → 天气图标；否则 → 感叹号
    weatherIconKey: function() {
      var w = this.alert;
      var eventName = (w && w.eventType && w.eventType.name) || '';
      return detectWeatherIcon(eventName);
    },

    startIcon: function() {
      if (this.weatherIconKey) {
        return WEATHER_ICONS[this.weatherIconKey];
      }
      return 'fa-exclamation';
    },

    // 是否需要显示后方感叹号：仅当前方是天气图标时
    showEndExclamation: function() {
      return !!this.weatherIconKey;
    },

    // 滚动内容：事件类型·预警描述
    scrollContent: function() {
      var w = this.alert;
      if (!w) return '';
      var eventName = (w && w.eventType && w.eventType.name) || '天气预警';
      var desc = w.headline || w.description || '';
      // 如果描述和事件名相同则去重
      if (desc === eventName) desc = '';
      var line = desc ? (eventName + '·' + desc) : eventName;
      // 重复两遍拼接，中间加空格间隔
      return line + '          ' + line;
    }
  },
  mounted: function() {
    var self = this;
    // 计算滚动时长：根据文字长度动态
    var charWidth = 8; // 每个中文字大约 10px（font-size 11px 时）
    var singleLineLen = (self.scrollContent.length / 2) * charWidth;
    // 滚动速度：约 30px/s
    self.scrollDuration = Math.max(6000, singleLineLen / 30 * 1000);
    // 滚动两遍（translateX -50%）后自动关闭
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
}

/* ===== 圆形图标容器（匹配音乐封面圆框样式） ===== */
.iw-icon-circle {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.06) inset;
}

.iw-icon-circle--end {
  width: 22px;
  height: 22px;
  font-size: 10px;
}

/* ===== 单行滚动区域 ===== */
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
  animation: iw-marquee var(--scroll-duration, 12s) linear forwards;
}

@keyframes iw-marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* ===== 关闭按钮 ===== */
.iw-close {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.5);
  font-size: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  padding: 0;
}

.iw-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.8);
}

.iw-close:active {
  transform: scale(0.92);
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .iw-scroll-text { animation: none !important; }
}
</style>
