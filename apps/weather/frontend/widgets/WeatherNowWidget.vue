<template>
  <div class="weather-now-widget">
    <!-- 加载 -->
    <div v-if="loading" class="wn-state">
      <div class="wn-spinner"></div>
    </div>
    <!-- 错误：外部 API / 服务不可用 -->
    <div v-else-if="error" class="wn-state">
      <i class="fa-solid fa-cloud-showers-heavy"></i>
      <span>天气服务暂不可用</span>
    </div>
    <!-- 无数据 -->
    <div v-else-if="!now" class="wn-state">
      <i class="fa-solid fa-cloud"></i>
      <span>暂无天气数据</span>
    </div>
    <!-- 内容 -->
    <div v-else class="wn-content" :class="{ 'wn-content--wide': isWide }">
      <div class="wn-main">
        <i class="wn-icon" :class="iconFa"></i>
        <div class="wn-temp">{{ now.temp }}°</div>
      </div>
      <div class="wn-info">
        <div class="wn-text">{{ now.text }} · {{ cityName }}</div>
        <div class="wn-extra">体感 {{ now.feelsLikeTemp || now.temp }}°</div>
        <div v-if="isWide" class="wn-extra">湿度 {{ now.humidity || '-' }}% · {{ now.windDir || '-' }} {{ now.windScale ? now.windScale + '级' : '' }}</div>
      </div>
    </div>
  </div>
</template>

<script>
// 实时天气小组件：走后端 QWeather 代理（key 不出服务端），15min 内存缓存与天气应用一致
import api from '@/utils/api';
import apiCache from '@/utils/api-cache';

var CACHE_CURRENT = 15 * 60 * 1000;

export default {
  name: 'WeatherNowWidget',
  props: {
    config: {
      type: Object,
      default: function() { return {}; }
    },
    refreshKey: {
      type: Number,
      default: 0
    }
  },
  data: function() {
    return {
      loading: true,
      error: false,
      now: null,
      isWide: false
    };
  },
  computed: {
    cityName: function() {
      return (this.config && this.config.city) || '庐江';
    },
    // QWeather icon 代码段 → Font Awesome（100 晴 / 101-103 多云 / 104 阴 / 3xx 雨 / 4xx 雪 / 5xx 雾霾）
    iconFa: function() {
      var code = parseInt((this.now && this.now.icon) || '', 10);
      if (isNaN(code)) return 'fa-solid fa-cloud';
      if (code === 100 || code === 150) return 'fa-solid fa-sun';
      if ((code >= 101 && code <= 103) || (code >= 151 && code <= 153)) return 'fa-solid fa-cloud-sun';
      if (code === 104 || code === 154) return 'fa-solid fa-cloud';
      if (code >= 300 && code < 400) return 'fa-solid fa-cloud-showers-heavy';
      if (code >= 400 && code < 500) return 'fa-solid fa-snowflake';
      if (code >= 500 && code < 600) return 'fa-solid fa-smog';
      return 'fa-solid fa-cloud';
    }
  },
  mounted: function() {
    var self = this;
    self.loadData();
    if (typeof ResizeObserver !== 'undefined' && self.$el) {
      self._ro = new ResizeObserver(function(entries) {
        var w = entries && entries[0] ? entries[0].contentRect.width : 0;
        self.isWide = w >= 320;
      });
      self._ro.observe(self.$el);
    }
  },
  activated: function() {
    this.loadData();
  },
  beforeDestroy: function() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      self.error = false;
      var cached = apiCache.get('weather_current');
      var req;
      if (cached) {
        req = Promise.resolve(cached);
      } else {
        req = api.get('/weather/current', { timeout: 12000 }).then(function(res) {
          var data = (res.data && res.data.code === 200) ? res.data.data : null;
          if (data) apiCache.set('weather_current', data, CACHE_CURRENT);
          return data;
        });
      }
      req.then(function(data) {
        self.now = data && data.now ? data.now : null;
        self.error = !self.now;
        self.loading = false;
      }).catch(function() {
        self.error = true;
        self.loading = false;
      });
    }
  }
};
</script>

<style scoped>
.weather-now-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
}

.wn-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.wn-state i { font-size: 22px; }

.wn-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: var(--primary-color);
  animation: wn-spin 0.9s linear infinite;
}
@keyframes wn-spin { to { transform: rotate(360deg); } }

.wn-content {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.wn-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.wn-icon {
  font-size: 34px;
  color: var(--primary-color);
}

.wn-temp {
  font-size: 38px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.wn-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.wn-text {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wn-extra {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 加宽（4×2）：加大图标与温度 */
.wn-content--wide .wn-icon { font-size: 44px; }
.wn-content--wide .wn-temp { font-size: 48px; }
.wn-content--wide .wn-info { gap: 5px; }
</style>
