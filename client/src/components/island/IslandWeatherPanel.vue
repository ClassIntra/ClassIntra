<template>
  <div class="island-body">
    <div class="weather-compact-content">
      <!-- 前方图标：天气 SVG 图标（无边框） 或 圆框感叹号 -->
      <WeatherIcon v-if="weatherCode" :code="weatherCode" :size="24" class="iw-weather-svg" />
      <i v-else class="fa-solid fa-circle-exclamation iw-start-exclaim" :style="{ color: alertColor }"></i>

      <!-- 单行滚动文字 -->
      <div class="iw-scroll-wrap">
        <span class="iw-scroll-text" ref="scrollText" :style="{ '--scroll-duration': scrollDuration + 'ms' }">{{ scrollContent }}</span>
      </div>

      <!-- 后方圆框感叹号：仅当前方有天气图标时 -->
      <i v-if="weatherCode" class="fa-solid fa-circle-exclamation iw-end-exclaim" :style="{ color: alertColor }"></i>

      <!-- 关闭按钮 -->
      <button class="iw-close" @click.stop="$emit('dismiss')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>
</template>

<script>
import WeatherIcon from '@/components/WeatherIcon.vue';

// 事件类型关键词 → 和风天气 icon 代码
var EVENT_CODE_MAP = {
  rain: '306',     // 雨
  snow: '400',     // 雪
  thunder: '302',  // 雷雨
  heat: '900',     // 高温
  cold: '901',     // 寒潮
  wind: '300',     // 大风/台风
  sand: '503',     // 沙尘
  fog: '500',      // 雾
  ice: '404'       // 冻雨/冰雪
};

function detectWeatherCode(eventName) {
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
  components: {
    WeatherIcon: WeatherIcon
  },
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
      // minor=蓝色  moderate=黄色  severe=橙色  extreme=红色
      var sevMap = { minor: '#3B82F6', moderate: '#F59E0B', severe: '#F97316', extreme: '#EF4444' };
      return sevMap[w.severity] || '#F59E0B';
    },

    // 天气图标代码（null = 无匹配，用感叹号）
    weatherCode: function() {
      var w = this.alert;
      var eventName = (w && w.eventType && w.eventType.name) || '';
      var key = detectWeatherCode(eventName);
      return key ? EVENT_CODE_MAP[key] : null;
    },

    // 滚动内容
    scrollContent: function() {
      var w = this.alert;
      if (!w) return '';
      var eventName = (w && w.eventType && w.eventType.name) || '天气预警';
      var desc = w.headline || w.description || '';
      if (desc === eventName) desc = '';
      var line = desc ? (eventName + '·' + desc) : eventName;
      return line + '          ' + line;
    }
  },
  mounted: function() {
    var self = this;
    var charWidth = 8;
    var singleLineLen = (self.scrollContent.length / 2) * charWidth;
    self.scrollDuration = Math.max(6000, singleLineLen / 30 * 1000);
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

/* 天气 SVG 图标（无边框） */
.iw-weather-svg {
  flex-shrink: 0;
}

/* 前方圆框感叹号 */
.iw-start-exclaim {
  flex-shrink: 0;
  font-size: 20px;
}

/* 后方圆框感叹号 */
.iw-end-exclaim {
  flex-shrink: 0;
  font-size: 16px;
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
  animation: iw-marquee var(--scroll-duration, 12s) linear forwards;
}

@keyframes iw-marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* 关闭按钮 */
.iw-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  padding: 0;
  margin-left: auto;
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
