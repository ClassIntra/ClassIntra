<template>
  <div class="weather-page" :style="pageBackground">
    <WeatherAnimation :category="weatherCategory" :weather-code="current ? current.icon : ''" :is-night="isNight" />
    <AppNavBar title="天气">
      <template slot="actions">
        <button class="nav-btn" @click="refreshAll" :disabled="loading">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'spin': loading }"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
      </template>
    </AppNavBar>

    <div v-if="loading && !current" class="loading-state">
      <div class="skeleton-pulse"></div>
    </div>

    <div v-else-if="error && !current" class="error-state">
      <i class="fa-solid fa-cloud-bolt"></i>
      <p>{{ error }}</p>
      <button class="btn-retry" @click="refreshAll">重试</button>
    </div>

    <div v-else class="weather-main" :class="{ 'show': contentVisible }">
      <div class="scroll-all">
        <div class="hero">
          <div class="hero-location">庐江</div>
          <div class="hero-temp">{{ current ? parseInt(current.temp, 10) : '--' }}°</div>
          <div class="hero-range" v-if="daily.length">
            最高 {{ parseInt(daily[0].tempMax, 10) }}° &nbsp;&nbsp; 最低 {{ parseInt(daily[0].tempMin, 10) }}°
          </div>
          <div class="hero-condition">{{ current ? current.text : '--' }}</div>
        </div>

        <RainAlert :data="minutelyData" :current-code="current ? current.icon : ''" />

        <div class="cards-grid">
          <div class="left-col">
            <div class="card daily-card">
              <div class="card-label">7日天气预报</div>
              <div class="daily-item" v-for="(d, i) in daily" :key="i">
                <span class="d-day">{{ formatDailyDate(d.fxDate, i) }}</span>
                <WeatherIcon :code="d.iconDay" :size="16" />
                <span class="d-lo">{{ parseInt(d.tempMin, 10) }}°</span>
                <span class="d-bar"><span class="d-bar-fill" :style="tempBarStyle(d)"></span></span>
                <span class="d-hi">{{ parseInt(d.tempMax, 10) }}°</span>
              </div>
            </div>

            <div class="card warning-card-wrap" :class="{ 'no-warning': !warningData.alerts || !warningData.alerts.length }">
              <div class="card-label">天气预警</div>
              <WarningCard :alerts="warningData.alerts || []" />
            </div>
          </div>

          <div class="right-col">
            <div class="card hourly-card">
              <div class="card-label">每小时天气预报</div>
              <div class="hourly-scroll">
                <div class="hourly-item" v-for="(h, i) in hourly" :key="i" :class="{ now: i === 0 }">
                  <span class="h-time">{{ formatHourTime(h.fxTime, i) }}</span>
                  <WeatherIcon :code="h.icon" :size="22" :isNight="isHourNight(h.fxTime)" />
                  <span class="h-temp">{{ parseInt(h.temp, 10) }}°</span>
                </div>
              </div>
            </div>

            <AirQuality :data="airData" class="card air-card" />
            <LifeIndex :data="indicesData" class="card life-card" />
          </div>
        </div>

        <div class="partial-errors" v-if="failedApis.length">
          <span v-for="key in failedApis" :key="key" class="err-tag">
            <i class="fa-solid fa-circle-exclamation"></i> {{ apiDisplayName(key) }}加载失败
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import WeatherIcon from '@/components/WeatherIcon.vue';
import AirQuality from '@/components/AirQuality.vue';
import LifeIndex from '@/components/LifeIndex.vue';
import WarningCard from '@/components/WarningCard.vue';
import RainAlert from '@/components/RainAlert.vue';
import AppNavBar from '@/components/AppNavBar.vue';
import WeatherAnimation from '@/components/WeatherAnimation.vue';
import api from '@/utils/api';
import apiCache from '@/utils/api-cache';

var CACHE_CURRENT = 15 * 60 * 1000;
var CACHE_HOURLY = 30 * 60 * 1000;
var CACHE_DAILY = 60 * 60 * 1000;
var CACHE_AIR = 30 * 60 * 1000;
var CACHE_INDICES = 6 * 60 * 60 * 1000;
var CACHE_WARNING = 10 * 60 * 1000;
var CACHE_MINUTELY = 5 * 60 * 1000;

var DAY_GRADIENTS = {
  sunny: 'linear-gradient(160deg, #2b5c9e 0%, #4a82ba 35%, #72a8d4 65%, #9ec9ea 100%)',
  cloudy: 'linear-gradient(160deg, #3f4f5f 0%, #5a6d7d 35%, #7d92a3 70%, #a5b9c8 100%)',
  overcast: 'linear-gradient(160deg, #2d3741 0%, #3d4a57 40%, #506070 75%, #8899aa 100%)',
  rain: 'linear-gradient(160deg, #1a2332 0%, #27374a 35%, #3a4d63 65%, #52687f 100%)',
  thunder: 'linear-gradient(160deg, #101520 0%, #1a2535 30%, #283848 60%, #3d5065 100%)',
  snow: 'linear-gradient(160deg, #506578 0%, #7a93a8 45%, #a8becf 80%, #cddae8 100%)',
  fog: 'linear-gradient(160deg, #3d4f5f 0%, #56697a 40%, #738899 75%, #95a8b8 100%)'
};

var NIGHT_GRADIENTS = {
  clear: 'linear-gradient(160deg, #0a1035 0%, #151b5e 25%, #22307a 50%, #334da8 80%, #536ebe 100%)',
  cloudy: 'linear-gradient(160deg, #11162d 0%, #1a2055 30%, #283474 60%, #445577 100%)',
  overcast: 'linear-gradient(160deg, #0d121f 0%, #182033 35%, #28354a 65%, #405068 100%)',
  rain: 'linear-gradient(160deg, #080c14 0%, #101c2e 30%, #1c304d 60%, #305070 100%)',
  thunder: 'linear-gradient(160deg, #05080d 0%, #0c1420 30%, #182430 60%, #283848 100%)',
  snow: 'linear-gradient(160deg, #151b44 0%, #264088 40%, #4864b8 70%, #6e89cc 100%)',
  fog: 'linear-gradient(160deg, #101420 0%, #1a2538 35%, #2d3d52 65%, #4a5c73 100%)'
};

var API_NAMES = {
  current: '实时天气',
  hourly: '逐时预报',
  daily: '每日预报',
  air: '空气质量',
  indices: '生活指数',
  warning: '天气预警',
  minutely: '分钟降水'
};

var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getWeatherCategory(code) {
  var num = parseInt(code, 10);
  if (isNaN(num)) return 'cloudy';
  if (num === 100 || num === 150) return 'sunny';
  if (num >= 101 && num <= 103) return 'cloudy';
  if (num >= 151 && num <= 153) return 'cloudy';
  if (num === 104 || num === 154) return 'overcast';
  if (num >= 300 && num <= 399) return 'rain';
  if (num >= 200 && num <= 299) return 'thunder';
  if (num >= 400 && num <= 499) return 'snow';
  if (num >= 500 && num <= 599) return 'fog';
  return 'cloudy';
}

export default {
  name: 'Weather',
  components: { WeatherIcon, AirQuality, LifeIndex, WarningCard, RainAlert, AppNavBar, WeatherAnimation },
  data: function() {
    return {
      loading: false,
      error: '',
      current: null,
      hourly: [],
      daily: [],
      airData: { indexes: [], pollutants: [] },
      indicesData: [],
      warningData: { alerts: [] },
      minutelyData: { summary: '', minutely: [] },
      refreshTimers: [],
      currentTime: new Date(),
      lastUpdateTime: null,
      contentVisible: false,
      failedApis: [],
      retryTimers: []
    };
  },
  computed: {
    isNight: function() {
      if (this.current) {
        var code = parseInt(this.current.icon, 10);
        if (code >= 150 && code < 200) return true;
      }
      if (this.sunrise && this.sunset) {
        var now = new Date();
        var cur = now.getHours() * 60 + now.getMinutes();
        var sr = this.sunrise.split(':');
        var ss = this.sunset.split(':');
        var srMin = parseInt(sr[0], 10) * 60 + parseInt(sr[1], 10);
        var ssMin = parseInt(ss[0], 10) * 60 + parseInt(ss[1], 10);
        return cur < srMin || cur >= ssMin;
      }
      var h = new Date().getHours();
      return h < 6 || h >= 18;
    },
    sunrise: function() {
      return this.daily && this.daily.length > 0 ? this.daily[0].sunrise || '' : '';
    },
    sunset: function() {
      return this.daily && this.daily.length > 0 ? this.daily[0].sunset || '' : '';
    },
    weatherCategory: function() {
      if (!this.current) return 'cloudy';
      return getWeatherCategory(this.current.icon);
    },
    pageBackground: function() {
      var cat = this.weatherCategory;
      if (this.isNight) {
        var nk = cat === 'sunny' ? 'clear' : cat;
        return { background: NIGHT_GRADIENTS[nk] || NIGHT_GRADIENTS.clear };
      }
      return { background: DAY_GRADIENTS[cat] || DAY_GRADIENTS.cloudy };
    }
  },
  mounted: function() {
    this.loadAll();
    this.startAutoRefresh();
    this._clock = setInterval(function() { this.currentTime = new Date(); }.bind(this), 30000);
    var self = this;
    this._visibilityHandler = function() {
      if (document.hidden) {
        self.stopAutoRefresh();
      } else {
        self.refreshAll();
        self.startAutoRefresh();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  },
  beforeDestroy: function() {
    this.stopAutoRefresh();
    clearInterval(this._clock);
    this.clearRetryTimers();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
  },
  methods: {
    apiDisplayName: function(key) { return API_NAMES[key] || key; },
    fetchWithCache: function(url, cacheKey, ttl) {
      var cached = apiCache.get(cacheKey);
      if (cached) return Promise.resolve(cached);
      return api.get(url, { timeout: 12000 }).then(function(res) {
        var data = res.data.data;
        apiCache.set(cacheKey, data, ttl);
        return data;
      });
    },
    loadAll: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      self.failedApis = [];

      self.fetchWithCache('/weather/current', 'weather_current', CACHE_CURRENT).then(function(data) {
        self.current = data.now || null;
        self.loading = false;
        self.$nextTick(function() { self.contentVisible = true; });
      }).catch(function() {
        self.failedApis.push('current');
        self.loading = false;
      });

      self.fetchWithCache('/weather/hourly', 'weather_hourly', CACHE_HOURLY).then(function(data) {
        self.hourly = data.hourly || [];
      }).catch(function() { self.failedApis.push('hourly'); });

      self.fetchWithCache('/weather/daily', 'weather_daily', CACHE_DAILY).then(function(data) {
        self.daily = data.daily || [];
      }).catch(function() { self.failedApis.push('daily'); });

      self.fetchWithCache('/weather/air', 'weather_air', CACHE_AIR).then(function(data) {
        self.airData = data || { indexes: [], pollutants: [] };
      }).catch(function() { self.failedApis.push('air'); });

      self.fetchWithCache('/weather/indices', 'weather_indices', CACHE_INDICES).then(function(data) {
        self.indicesData = data.daily || [];
      }).catch(function() { self.failedApis.push('indices'); });

      self.fetchWithCache('/weather/warning', 'weather_warning', CACHE_WARNING).then(function(data) {
        self.warningData = data || { alerts: [] };
      }).catch(function() { self.failedApis.push('warning'); });

      self.fetchWithCache('/weather/minutely', 'weather_minutely', CACHE_MINUTELY).then(function(data) {
        self.minutelyData = data || { summary: '', minutely: [] };
      }).catch(function() { self.failedApis.push('minutely'); });

      setTimeout(function() {
        self.lastUpdateTime = Date.now();
        if (!self.current && !self.hourly.length && !self.daily.length) {
          self.error = '无法获取天气数据';
        }
        if (self.failedApis.length > 0 && self.failedApis.length < 5) {
          self.scheduleRetries();
        }
      }, 8000);
    },
    scheduleRetries: function() {
      var self = this;
      self.clearRetryTimers();
      var copy = self.failedApis.slice();
      for (var i = 0; i < copy.length; i++) {
        (function(k, d) {
          self.retryTimers.push(setTimeout(function() { self.retrySingle(k); }, d));
        })(copy[i], 3000 * (i + 1));
      }
    },
    retrySingle: function(apiKey) {
      var self = this;
      var urls = { current: '/weather/current', hourly: '/weather/hourly', daily: '/weather/daily', air: '/weather/air', indices: '/weather/indices', warning: '/weather/warning', minutely: '/weather/minutely' };
      var keys = { current: 'weather_current', hourly: 'weather_hourly', daily: 'weather_daily', air: 'weather_air', indices: 'weather_indices', warning: 'weather_warning', minutely: 'weather_minutely' };
      var ttls = { current: CACHE_CURRENT, hourly: CACHE_HOURLY, daily: CACHE_DAILY, air: CACHE_AIR, indices: CACHE_INDICES, warning: CACHE_WARNING, minutely: CACHE_MINUTELY };
      var setters = {
        current: function(d) { self.current = d.now || null; },
        hourly: function(d) { self.hourly = d.hourly || []; },
        daily: function(d) { self.daily = d.daily || []; },
        air: function(d) { self.airData = d || { indexes: [], pollutants: [] }; },
        indices: function(d) { self.indicesData = d.daily || []; },
        warning: function(d) { self.warningData = d || { alerts: [] }; },
        minutely: function(d) { self.minutelyData = d || { summary: '', minutely: [] }; }
      };
      apiCache.invalidate(keys[apiKey]);
      self.fetchWithCache(urls[apiKey], keys[apiKey], ttls[apiKey]).then(function(data) {
        setters[apiKey](data);
        var idx = self.failedApis.indexOf(apiKey);
        if (idx !== -1) self.failedApis.splice(idx, 1);
        self.lastUpdateTime = Date.now();
      }).catch(function() {});
    },
    clearRetryTimers: function() {
      for (var i = 0; i < this.retryTimers.length; i++) clearTimeout(this.retryTimers[i]);
      this.retryTimers = [];
    },
    refreshAll: function() {
      ['weather_current', 'weather_hourly', 'weather_daily', 'weather_air', 'weather_indices', 'weather_warning', 'weather_minutely'].forEach(function(k) { apiCache.invalidate(k); });
      this.contentVisible = false;
      this.clearRetryTimers();
      this.loadAll();
    },
    startAutoRefresh: function() {
      var self = this;
      var configs = [
        { url: '/weather/current', key: 'weather_current', ttl: CACHE_CURRENT, setter: function(d) { self.current = d.now || null; } },
        { url: '/weather/hourly', key: 'weather_hourly', ttl: CACHE_HOURLY, setter: function(d) { self.hourly = d.hourly || []; } },
        { url: '/weather/daily', key: 'weather_daily', ttl: CACHE_DAILY, setter: function(d) { self.daily = d.daily || []; } },
        { url: '/weather/air', key: 'weather_air', ttl: CACHE_AIR, setter: function(d) { self.airData = d || { indexes: [], pollutants: [] }; } },
        { url: '/weather/indices', key: 'weather_indices', ttl: CACHE_INDICES, setter: function(d) { self.indicesData = d.daily || []; } },
        { url: '/weather/warning', key: 'weather_warning', ttl: CACHE_WARNING, setter: function(d) { self.warningData = d || { alerts: [] }; } },
        { url: '/weather/minutely', key: 'weather_minutely', ttl: CACHE_MINUTELY, setter: function(d) { self.minutelyData = d || { summary: '', minutely: [] }; } }
      ];
      configs.forEach(function(c) {
        self.refreshTimers.push(setInterval(function() {
          apiCache.invalidate(c.key);
          self.fetchWithCache(c.url, c.key, c.ttl).then(function(data) {
            c.setter(data);
            self.lastUpdateTime = Date.now();
          }).catch(function() {});
        }, c.ttl));
      });
    },
    stopAutoRefresh: function() {
      this.refreshTimers.forEach(clearInterval);
      this.refreshTimers = [];
    },
    formatHourTime: function(fxTime, idx) {
      if (idx === 0) return '现在';
      if (!fxTime) return '';
      return (new Date(fxTime).getHours() < 10 ? '0' : '') + new Date(fxTime).getHours() + ':00';
    },
    isHourNight: function(fxTime) {
      if (!fxTime) return false;
      if (this.sunrise && this.sunset) {
        var d = new Date(fxTime);
        var t = d.getHours() * 60 + d.getMinutes();
        var sr = this.sunrise.split(':');
        var ss = this.sunset.split(':');
        return t < parseInt(sr[0], 10) * 60 + parseInt(sr[1], 10) || t >= parseInt(ss[0], 10) * 60 + parseInt(ss[1], 10);
      }
      var h = new Date(fxTime).getHours();
      return h < 6 || h >= 18;
    },
    formatDailyDate: function(fxDate, idx) {
      if (idx === 0) return '今天';
      if (!fxDate) return '';
      return WEEKDAYS[new Date(fxDate).getDay()];
    },
    tempBarStyle: function(day) {
      var allMin = 100, allMax = -100;
      for (var i = 0; i < this.daily.length; i++) {
        var lo = parseInt(this.daily[i].tempMin, 10);
        var hi = parseInt(this.daily[i].tempMax, 10);
        if (!isNaN(lo) && lo < allMin) allMin = lo;
        if (!isNaN(hi) && hi > allMax) allMax = hi;
      }
      var range = allMax - allMin || 1;
      var lo = parseInt(day.tempMin, 10);
      var hi = parseInt(day.tempMax, 10);
      if (isNaN(lo)) lo = allMin;
      if (isNaN(hi)) hi = allMax;
      var left = ((lo - allMin) / range) * 100;
      var width = Math.max(((hi - lo) / range) * 100, 4);
      return { left: left + '%', width: width + '%' };
    }
  }
};
</script>

<style scoped>
.weather-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background 2s var(--ease-standard);
  color: #fff;
  position: relative;
  isolation: isolate;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: rgba(255,255,255,0.8);
  transition: background 0.2s, transform 0.15s, opacity 0.15s;
}
.nav-btn:hover { background: rgba(255,255,255,0.15); }
.nav-btn:disabled { opacity: 0.4; }
.nav-btn:active { transform: scale(0.92); opacity: 0.7; }
.spin { animation: spin 0.8s var(--ease-standard) infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.skeleton-pulse {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0.7;
}
.error-state i { font-size: 40px; }
.btn-retry {
  padding: 6px 16px;
  min-height: 44px;
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: var(--radius-xl);
  color: #fff;
  font-size: var(--font-size-sm);
  transition: background 0.2s, transform 0.15s, opacity 0.15s;
}
.btn-retry:hover { background: rgba(255,255,255,0.25); }
.btn-retry:active { transform: scale(0.92); opacity: 0.7; }

.weather-main {
  flex: 1;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.6s var(--ease-standard);
}
.weather-main.show { opacity: 1; }

.scroll-all {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 14px 6px;
}
.scroll-all::-webkit-scrollbar { width: 2px; }
.scroll-all::-webkit-scrollbar-track { background: transparent; }
.scroll-all::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 1px; }

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 0 22px;
  min-height: 42vh;
}

.hero-location {
  font-size: var(--font-size-subheadline);
  font-weight: 300;
  letter-spacing: 5px;
  margin-bottom: 12px;
  opacity: 0.8;
}

.hero-temp {
  font-size: 108px;
  font-weight: 100;
  line-height: 1;
  letter-spacing: -6px;
}

.hero-range {
  font-size: var(--font-size-sm);
  font-weight: 300;
  opacity: 0.45;
  margin-top: 8px;
  letter-spacing: 2px;
}

.hero-condition {
  font-size: var(--font-size-subheadline);
  font-weight: 300;
  margin-top: 6px;
  opacity: 0.7;
}

.cards-grid {
  display: grid;
  grid-template-columns: 0.7fr 1.3fr;
  gap: 8px;
  overflow: hidden;
}

.left-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.right-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.card {
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 0.5px solid rgba(255,255,255,0.15);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  min-width: 0;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.12);
}

.card-label {
  font-size: var(--font-size-caption2);
  font-weight: 400;
  opacity: 0.3;
  margin-bottom: 3px;
  letter-spacing: 0.5px;
}

.hourly-scroll {
  display: flex;
  gap: 0;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}
.hourly-scroll::-webkit-scrollbar { height: 2px; }
.hourly-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 1px; }

.hourly-item {
  flex-shrink: 0;
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 2px;
  border-radius: var(--radius-md);
  transition: background 0.2s;
}
.hourly-item.now { background: rgba(255,255,255,0.07); }
.h-time { font-size: var(--font-size-caption2); opacity: 0.4; }
.h-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.h-temp { font-size: var(--font-size-caption); font-weight: 500; }

.daily-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 0.5px solid rgba(255,255,255,0.06);
}
.daily-item:last-child { border-bottom: none; }
.d-day { width: 26px; font-size: var(--font-size-caption2); font-weight: 400; flex-shrink: 0; }
.d-lo { width: 20px; font-size: var(--font-size-caption2); flex-shrink: 0; text-align: right; opacity: 0.42; }
.d-bar {
  flex: 1;
  height: 2.5px;
  background: rgba(255,255,255,0.07);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
  min-width: 12px;
}
.d-bar-fill {
  position: absolute;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, #64B5F6, #FFB74D);
  border-radius: 2px;
}
.d-hi { width: 22px; font-size: var(--font-size-caption2); font-weight: 500; flex-shrink: 0; }

.daily-card {
  padding: 6px 8px;
  flex-shrink: 0;
}

.air-card, .life-card {
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 0.5px solid rgba(255,255,255,0.15);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  min-width: 0;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.12);
}

.warning-card-wrap {
  background: rgba(var(--danger-rgb), 0.12);
  border: 0.5px solid rgba(var(--danger-rgb), 0.2);
}
.warning-card-wrap.no-warning {
  background: rgba(255,255,255,0.1);
  border: 0.5px solid rgba(255,255,255,0.12);
  flex: 1;
}

.partial-errors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 0 4px;
}
.err-tag {
  font-size: var(--font-size-caption2);
  color: rgba(255,200,100,0.8);
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(255,200,100,0.05);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
}
.err-tag i { font-size: var(--font-size-caption2); }

@media (max-height: 640px) {
  .scroll-all { padding: 0 10px 4px; }
  .hero { padding: 16px 0 12px; min-height: 36vh; }
  .hero-location { font-size: var(--font-size-body); margin-bottom: 8px; letter-spacing: 3px; }
  .hero-temp { font-size: 80px; letter-spacing: -4px; }
  .hero-range { font-size: var(--font-size-caption); margin-top: 5px; }
  .hero-condition { font-size: var(--font-size-sm); margin-top: 4px; }
  .card { padding: 8px 10px; border-radius: var(--radius-md); min-width: 0; overflow: hidden; }
  .card-label { font-size: var(--font-size-caption2); margin-bottom: 2px; }
  .cards-grid { gap: 6px; }
  .left-col { gap: 6px; min-width: 0; overflow: hidden; }
  .right-col { gap: 6px; min-width: 0; overflow: hidden; }
  .hourly-item { width: 38px; padding: 2px 1px; gap: 1px; }
  .h-time { font-size: var(--font-size-caption2); }
  .h-temp { font-size: var(--font-size-caption2); }
  .daily-item { padding: 2px 0; gap: 3px; }
  .d-day { width: 20px; font-size: var(--font-size-caption2); }
  .d-lo { width: 15px; font-size: var(--font-size-caption2); }
  .d-hi { width: 17px; font-size: var(--font-size-caption2); }
  .daily-card { padding: 4px 6px; }
  .air-card, .life-card { padding: 8px 10px; border-radius: var(--radius-md); min-width: 0; overflow: hidden; }
}

@media (max-width: 700px) {
  .scroll-all { padding: 0 12px 12px; }
  .hero { padding: 24px 0 18px; min-height: 40vh; }
  .hero-temp { font-size: 96px; }
  .cards-grid { grid-template-columns: 1fr; }
}
</style>
