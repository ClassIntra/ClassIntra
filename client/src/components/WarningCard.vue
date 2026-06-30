<template>
  <div class="warning-card">
    <div class="no-warning" v-if="!alerts || !alerts.length">
      <svg class="no-warning-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span class="no-warning-text">当前无天气预警</span>
    </div>
    <div class="warning-item" v-for="(w, i) in alerts" :key="i" v-else>
      <div class="w-header">
        <span class="w-dot" :style="{ backgroundColor: severityColor(w) }"></span>
        <span class="w-type">{{ w.eventType ? w.eventType.name : '--' }}</span>
        <span class="w-level" :style="{ color: severityColor(w) }">{{ severityLabel(w) }}</span>
        <span class="w-time" v-if="w.effectiveTime">{{ formatTime(w.effectiveTime) }}</span>
      </div>
      <div class="w-headline" v-if="w.headline">{{ w.headline }}</div>
      <div class="w-desc" v-if="w.description">{{ w.description }}</div>
    </div>
  </div>
</template>

<script>
var SEVERITY_COLORS = {
  minor: '#3B82F6',
  moderate: '#F59E0B',
  severe: '#EF4444',
  extreme: '#9333EA'
};

var SEVERITY_LABELS = {
  minor: '蓝色预警',
  moderate: '黄色预警',
  severe: '橙色预警',
  extreme: '红色预警'
};

export default {
  name: 'WarningCard',
  props: {
    alerts: {
      type: Array,
      default: function() { return []; }
    }
  },
  methods: {
    severityColor: function(w) {
      if (w.color) {
        var c = w.color;
        return 'rgba(' + c.red + ',' + c.green + ',' + c.blue + ',' + (c.alpha != null ? c.alpha : 1) + ')';
      }
      return SEVERITY_COLORS[w.severity] || '#9E9E9E';
    },
    severityLabel: function(w) {
      if (w.color && w.color.code) {
        var map = { blue: '蓝色预警', yellow: '黄色预警', orange: '橙色预警', red: '红色预警' };
        return map[w.color.code] || SEVERITY_LABELS[w.severity] || '预警';
      }
      return SEVERITY_LABELS[w.severity] || '预警';
    },
    formatTime: function(t) {
      if (!t) return '';
      var d = new Date(t);
      var m = d.getMonth() + 1;
      var day = d.getDate();
      var h = d.getHours() < 10 ? '0' + d.getHours() : d.getHours();
      var min = d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes();
      return m + '/' + day + ' ' + h + ':' + min;
    },
    truncate: function(str, len) {
      if (!str) return '';
      return str.length > len ? str.substring(0, len) + '...' : str;
    }
  }
};
</script>

<style scoped>
.warning-card {
  min-width: 0;
  overflow: hidden;
}

.no-warning {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 0;
  flex: 1;
}

.no-warning-icon {
  color: #4ADE80;
  flex-shrink: 0;
}

.no-warning-text {
  font-size: 11px;
  opacity: 0.4;
}

.warning-item {
  padding: 6px 0;
  border-bottom: 0.5px solid rgba(255,255,255,0.06);
}
.warning-item:last-child { border-bottom: none; }

.w-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.w-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.w-type {
  font-size: 12px;
  font-weight: 500;
}

.w-level {
  font-size: 10px;
  font-weight: 500;
}

.w-time {
  font-size: 9px;
  opacity: 0.35;
  margin-left: auto;
}

.w-headline {
  font-size: 11px;
  opacity: 0.7;
  line-height: 1.4;
  margin-bottom: 2px;
}

.w-desc {
  font-size: 10px;
  opacity: 0.4;
  line-height: 1.4;
  word-break: break-word;
  white-space: normal;
}
</style>
