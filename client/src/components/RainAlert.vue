<template>
  <div class="rain-alert" v-if="hasRain">
    <div class="rain-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="16" x2="8" y2="20"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="16" y1="16" x2="16" y2="20"/></svg>
    </div>
    <div class="rain-text">
      <span class="rain-summary">{{ rainLine }}</span>
    </div>
  </div>
</template>

<script>
var PRECIP_THRESHOLD = 0.1;
var NOW_PRECIP_THRESHOLD = 0.3;

function getIntensityLabel(maxPrecip, isSnow) {
  if (isSnow) {
    if (maxPrecip < 0.1) return '小雪';
    if (maxPrecip < 2.5) return '小雪';
    if (maxPrecip < 8.0) return '中雪';
    if (maxPrecip < 16.0) return '大雪';
    return '暴雪';
  }
  if (maxPrecip < 0.1) return '毛毛雨';
  if (maxPrecip < 2.5) return '小雨';
  if (maxPrecip < 8.0) return '中雨';
  if (maxPrecip < 16.0) return '大雨';
  return '暴雨';
}

export default {
  name: 'RainAlert',
  props: {
    data: {
      type: Object,
      default: function() { return { summary: '', minutely: [] }; }
    },
    currentCode: {
      type: String,
      default: ''
    }
  },
  computed: {
    isCurrentlySnowing: function() {
      var num = parseInt(this.currentCode, 10);
      if (isNaN(num)) return false;
      if (num >= 400 && num <= 499) return true;
      return false;
    },
    hasRain: function() {
      var m = this.data.minutely;
      if (!m || !m.length) return false;
      for (var i = 0; i < m.length; i++) {
        if (parseFloat(m[i].precip) >= PRECIP_THRESHOLD) return true;
      }
      return false;
    },
    rainInfo: function() {
      var m = this.data.minutely;
      if (!m || !m.length) return null;
      var now = Date.now();
      var startIdx = -1;
      var endIdx = -1;
      var maxPrecip = 0;
      var currentPrecip = 0;
      var hasMinutelyNow = false;
      for (var i = 0; i < m.length; i++) {
        var p = parseFloat(m[i].precip);
        var t = new Date(m[i].fxTime).getTime();
        if (t <= now + 300000) hasMinutelyNow = true;
        if (p >= PRECIP_THRESHOLD) {
          if (startIdx === -1) startIdx = i;
          endIdx = i;
          if (p > maxPrecip) maxPrecip = p;
        }
        if (t <= now && p > currentPrecip) {
          currentPrecip = p;
        }
      }
      if (startIdx === -1) return null;
      var startTime = new Date(m[startIdx].fxTime).getTime();
      var endTime = new Date(m[endIdx].fxTime).getTime();
      var startMin = Math.round((startTime - now) / 60000);
      var durationMin = Math.round((endTime - startTime) / 60000) + 5;
      var isNow = false;
      var hasCurrentPrecip = false;
      if (hasMinutelyNow) {
        isNow = currentPrecip >= NOW_PRECIP_THRESHOLD;
        hasCurrentPrecip = currentPrecip >= PRECIP_THRESHOLD;
      }
      var isSnow = this.isCurrentlySnowing;
      return {
        startMin: startMin,
        durationMin: durationMin,
        maxPrecip: maxPrecip,
        isNow: isNow,
        hasCurrentPrecip: hasCurrentPrecip,
        isSnow: isSnow,
        intensityLabel: getIntensityLabel(maxPrecip, isSnow)
      };
    },
    rainLine: function() {
      var info = this.rainInfo;
      if (!info) return '';
      var parts = [];
      if (info.isNow) {
        parts.push('正在下' + info.intensityLabel);
      } else if (info.hasCurrentPrecip) {
        parts.push('当前有轻微降水');
      } else if (info.startMin > 0 && info.startMin < 60) {
        parts.push(info.startMin + '分钟后开始下' + info.intensityLabel);
      } else if (info.startMin >= 60) {
        var h = Math.floor(info.startMin / 60);
        var m = info.startMin % 60;
        if (m > 0) {
          parts.push(h + '小时' + m + '分钟后开始下' + info.intensityLabel);
        } else {
          parts.push(h + '小时后开始下' + info.intensityLabel);
        }
      } else {
        parts.push('预计有' + info.intensityLabel);
      }
      if (info.durationMin > 0 && info.durationMin < 1440) {
        if (info.durationMin < 60) {
          parts.push('持续约' + info.durationMin + '分钟');
        } else {
          var dh = Math.floor(info.durationMin / 60);
          var dm = info.durationMin % 60;
          if (dm > 0) {
            parts.push('持续约' + dh + '小时' + dm + '分钟');
          } else {
            parts.push('持续约' + dh + '小时');
          }
        }
      }
      if (info.maxPrecip >= 0.1) {
        parts.push('最大降水量 ' + info.maxPrecip.toFixed(1) + 'mm');
      }
      return parts.join('  ·  ');
    }
  }
};
</script>

<style scoped>
.rain-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(100, 181, 246, 0.12);
  border: 1px solid rgba(100, 181, 246, 0.18);
  border-radius: var(--radius-md);
  margin-bottom: 4px;
  min-width: 0;
  overflow: hidden;
}

.rain-icon {
  color: #64B5F6;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.rain-text {
  min-width: 0;
  overflow: hidden;
}

.rain-summary {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255,255,255,0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
