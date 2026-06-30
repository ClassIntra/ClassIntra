<template>
  <div class="island-body">
    <div class="weather-compact-content">
      <!-- 天气预警图标 -->
      <div class="iw-icon" :style="{ color: alertColor }">
        <i class="fa-solid" :class="alertIcon"></i>
      </div>
      <!-- 标题 + 滚动文字 -->
      <div class="iw-text-area">
        <div class="iw-title">{{ alertTitle }}</div>
        <div class="iw-scroll-wrap">
          <div class="iw-scroll-text">{{ scrollText }}</div>
        </div>
      </div>
      <!-- 关闭按钮 -->
      <button class="iw-close" @click.stop="$emit('dismiss')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>
</template>

<script>
// 严重程度 → 颜色映射
var SEVERITY_COLORS = {
  minor: '#3B82F6',
  moderate: '#F59E0B',
  severe: '#EF4444',
  extreme: '#9333EA'
};

// 严重程度 → 中文标签
var SEVERITY_LABELS = {
  minor: '蓝色预警',
  moderate: '黄色预警',
  severe: '橙色预警',
  extreme: '红色预警'
};

// 事件类型关键词 → 图标映射
function getIconByEvent(eventName) {
  var name = (eventName || '').toLowerCase();
  if (name.indexOf('雨') > -1 || name.indexOf('rain') > -1) return 'fa-cloud-rain';
  if (name.indexOf('雪') > -1 || name.indexOf('snow') > -1) return 'fa-snowflake';
  if (name.indexOf('雷') > -1 || name.indexOf('thunder') > -1) return 'fa-bolt';
  if (name.indexOf('高温') > -1 || name.indexOf('热') > -1 || name.indexOf('heat') > -1) return 'fa-temperature-high';
  if (name.indexOf('寒') > -1 || name.indexOf('冷') > -1 || name.indexOf('cold') > -1 || name.indexOf('霜冻') > -1) return 'fa-temperature-low';
  if (name.indexOf('风') > -1 || name.indexOf('wind') > -1) return 'fa-wind';
  if (name.indexOf('沙') > -1 || name.indexOf('尘') > -1 || name.indexOf('dust') > -1 || name.indexOf('sand') > -1) return 'fa-tornado';
  if (name.indexOf('雾') > -1 || name.indexOf('霾') > -1 || name.indexOf('fog') > -1 || name.indexOf('haze') > -1) return 'fa-smog';
  if (name.indexOf('冰') > -1 || name.indexOf('ice') > -1) return 'fa-icicles';
  return 'fa-triangle-exclamation';
}

export default {
  name: 'IslandWeatherPanel',
  props: {
    // 天气预警对象，结构同 WarningCard 的 w：{ eventType:{name}, severity, color:{red,green,blue,alpha,code}, headline, description }
    alert: { type: Object, default: null }
  },
  data: function() {
    return {
      // 滚动动画时长（毫秒），两遍内容
      scrollDuration: 30000,
      _autoCloseTimer: null
    };
  },
  computed: {
    // 预警颜色
    alertColor: function() {
      var w = this.alert;
      if (!w) return '#F59E0B';
      if (w.color) {
        var c = w.color;
        return 'rgba(' + c.red + ',' + c.green + ',' + c.blue + ',' + (c.alpha != null ? c.alpha : 1) + ')';
      }
      return SEVERITY_COLORS[w.severity] || '#F59E0B';
    },
    // 预警图标
    alertIcon: function() {
      var w = this.alert;
      var eventName = (w && w.eventType && w.eventType.name) || '';
      return getIconByEvent(eventName);
    },
    // 预警标题：事件类型 + 等级
    alertTitle: function() {
      var w = this.alert;
      if (!w) return '天气预警';
      var eventName = (w.eventType && w.eventType.name) || '天气预警';
      var label = '';
      if (w.color && w.color.code) {
        var codeMap = { blue: '蓝色预警', yellow: '黄色预警', orange: '橙色预警', red: '红色预警' };
        label = codeMap[w.color.code] || SEVERITY_LABELS[w.severity] || '预警';
      } else {
        label = SEVERITY_LABELS[w.severity] || '预警';
      }
      return eventName + ' ' + label;
    },
    // 滚动文字：headline + description，重复两遍拼接（中间用空格分隔）
    scrollText: function() {
      var w = this.alert;
      if (!w) return '';
      var parts = [];
      if (w.headline) parts.push(w.headline);
      if (w.description) parts.push(w.description);
      if (parts.length === 0) return '天气预警';
      var oneLine = parts.join('  ');
      // 重复两遍，中间加足够空格作为视觉间隔
      return oneLine + '          ' + oneLine;
    }
  },
  mounted: function() {
    var self = this;
    // 滚动两遍后自动关闭
    self._autoCloseTimer = setTimeout(function() {
      self.$emit('request-close');
    }, self.scrollDuration);
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

/* 天气图标 */
.iw-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
}

/* 文本区域 */
.iw-text-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.iw-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

/* 滚动文字容器 */
.iw-scroll-wrap {
  overflow: hidden;
  white-space: nowrap;
  line-height: 1.2;
}

.iw-scroll-text {
  display: inline-block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  animation: iw-marquee 30s linear forwards;
  padding-right: 40px;
}

/* 滚动动画：从 0 到 -50%，因为文字重复两遍，-50% 刚好滚完一遍 */
@keyframes iw-marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* 关闭按钮 */
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
