<template>
  <div class="air-quality">
    <div class="aqi-row">
      <span class="aqi-val">{{ aqiValue }}</span>
      <span class="aqi-badge" :style="badgeStyle">{{ category }}</span>
    </div>
    <div class="aqi-bar">
      <div class="aqi-track">
        <div class="seg s1"></div>
        <div class="seg s2"></div>
        <div class="seg s3"></div>
        <div class="seg s4"></div>
        <div class="seg s5"></div>
        <div class="seg s6"></div>
      </div>
      <div class="aqi-dot" :style="{ transform: 'translateX(calc(' + indicatorPosition + '% - 50%))' }"></div>
    </div>
    <div class="pollutants" v-if="topPollutants.length">
      <div class="p-row" v-for="p in topPollutants" :key="p.code">
        <span class="p-name">{{ p.name }}</span>
        <span class="p-val">{{ p.displayValue }}</span>
      </div>
    </div>
    <div class="health-tip" v-if="healthAdvice">{{ healthAdvice }}</div>
  </div>
</template>

<script>
var FALLBACK_COLORS = {
  '\u4F18': '#34C759',
  '\u826F': '#FFCC00',
  '\u8F7B\u5EA6\u6C61\u67D3': '#FF9500',
  '\u4E2D\u5EA6\u6C61\u67D3': '#FF3B30',
  '\u91CD\u5EA6\u6C61\u67D3': '#AF52DE',
  '\u4E25\u91CD\u6C61\u67D3': '#7e0023',
  'Good': '#34C759',
  'Moderate': '#FFCC00',
  'Unhealthy for Sensitive Groups': '#FF9500',
  'Unhealthy': '#FF3B30',
  'Very Unhealthy': '#AF52DE',
  'Hazardous': '#7e0023',
  'Excellent': '#34C759'
};

var POLLUTANT_PRIORITY = ['pm2p5', 'pm10', 'o3', 'no2', 'so2', 'co', 'pm2v5'];

export default {
  name: 'AirQuality',
  props: {
    data: {
      type: Object,
      default: function() {
        return { indexes: [], pollutants: [] };
      }
    }
  },
  computed: {
    primaryIndex: function() {
      var indexes = this.data.indexes;
      if (!indexes || !indexes.length) return null;
      for (var i = 0; i < indexes.length; i++) {
        if (indexes[i].code === 'cn-mee' || indexes[i].code === 'cn-mep') return indexes[i];
      }
      for (var j = 0; j < indexes.length; j++) {
        if (indexes[j].code === 'qaqi') return indexes[j];
      }
      for (var k = 0; k < indexes.length; k++) {
        if (indexes[k].code === 'us-epa') return indexes[k];
      }
      return indexes[0];
    },
    aqiValue: function() {
      if (!this.primaryIndex || this.primaryIndex.aqi == null) return '--';
      return this.primaryIndex.aqi;
    },
    category: function() {
      if (!this.primaryIndex || !this.primaryIndex.category) return '--';
      return this.primaryIndex.category;
    },
    badgeStyle: function() {
      return { backgroundColor: this.categoryColor };
    },
    categoryColor: function() {
      if (this.primaryIndex && this.primaryIndex.color) {
        var c = this.primaryIndex.color;
        return 'rgba(' + c.red + ',' + c.green + ',' + c.blue + ',' + (c.alpha != null ? c.alpha : 1) + ')';
      }
      return FALLBACK_COLORS[this.category] || '#9E9E9E';
    },
    indicatorPosition: function() {
      var aqi = parseInt(this.aqiValue, 10);
      if (isNaN(aqi)) return 0;
      var pos = (aqi / 500) * 100;
      if (pos > 100) pos = 100;
      return pos;
    },
    topPollutants: function() {
      var raw = this.data.pollutants;
      if (!raw || !raw.length) return [];
      var sorted = [];
      for (var i = 0; i < POLLUTANT_PRIORITY.length; i++) {
        for (var j = 0; j < raw.length; j++) {
          if (raw[j].code === POLLUTANT_PRIORITY[i]) {
            var val = '--';
            if (raw[j].concentration) {
              val = raw[j].concentration.value + (raw[j].concentration.unit ? raw[j].concentration.unit : '');
            }
            sorted.push({ code: raw[j].code, name: raw[j].name || raw[j].code, displayValue: val });
            break;
          }
        }
        if (sorted.length >= 3) break;
      }
      if (sorted.length === 0) {
        sorted = raw.slice(0, 3).map(function(p) {
          var val = '--';
          if (p.concentration) {
            val = p.concentration.value + (p.concentration.unit ? p.concentration.unit : '');
          }
          return { code: p.code, name: p.name || p.code, displayValue: val };
        });
      }
      return sorted;
    },
    healthAdvice: function() {
      if (!this.primaryIndex || !this.primaryIndex.health) return '';
      var h = this.primaryIndex.health;
      if (h.advice && h.advice.generalPopulation) return h.advice.generalPopulation;
      if (h.generalPopulation) return h.generalPopulation;
      return '';
    }
  }
};
</script>

<style scoped>
.air-quality {
  color: #fff;
  min-width: 0;
  overflow: hidden;
}

.aqi-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.aqi-val {
  font-size: 32px;
  font-weight: 200;
  line-height: 1;
  letter-spacing: -1px;
}

.aqi-badge {
  padding: 2px 8px;
  border-radius: var(--radius-md);
  font-size: 11px;
  font-weight: 500;
  color: #fff;
}

.aqi-bar {
  position: relative;
  margin-bottom: 10px;
}

.aqi-track {
  display: flex;
  height: 3px;
  border-radius: var(--radius-xs);
  overflow: hidden;
}

.seg { flex: 1; }
.s1 { background: #34C759; }
.s2 { background: #FFCC00; }
.s3 { background: #FF9500; }
.s4 { background: #FF3B30; }
.s5 { background: #AF52DE; }
.s6 { background: #7e0023; }

.aqi-dot {
  position: absolute;
  top: -4px;
  left: 0;                 /* 定位基准归零，位移全部交给 transform */
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0,0,0,0.12);
  /* 用 transform 位移替代 left（§5.5.2）：跳过布局阶段，只在合成器上完成 */
  transition: transform var(--duration-slow) var(--ease-standard);
  box-shadow: var(--shadow-sm);
}

.pollutants {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 8px;
}

.p-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.p-name {
  font-size: 11px;
  opacity: 0.5;
}

.p-val {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.85;
}

.health-tip {
  font-size: 10px;
  line-height: 1.5;
  opacity: 0.35;
  padding-top: 6px;
  border-top: 0.5px solid rgba(255,255,255,0.06);
}

@media (max-height: 640px) {
  .aqi-row { margin-bottom: 7px; gap: 6px; }
  .aqi-val { font-size: 26px; }
  .aqi-badge { font-size: 10px; padding: 2px 7px; }
  .aqi-bar { margin-bottom: 7px; }
  .aqi-dot { width: 8px; height: 8px; top: -3px; }
  .pollutants { gap: 4px; margin-bottom: 6px; }
  .p-name { font-size: 10px; }
  .p-val { font-size: 11px; }
  .health-tip { font-size: 9px; padding-top: 5px; }
}
</style>
