<template>
  <div class="ai-usage-widget">
    <!-- 无权限态（防御性：用量接口仅 is_admin 可访问） -->
    <div v-if="!isAdmin" class="auw-error">
      <i class="fa-solid fa-lock"></i>
      <span>无权访问</span>
    </div>
    <!-- 加载态 -->
    <div v-else-if="loading && !rows.length" class="auw-loading">
      <div class="auw-spinner"></div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="auw-error">
      <i class="fa-solid fa-circle-exclamation"></i>
      <span>用量数据加载失败</span>
    </div>
    <!-- 未迁移态 -->
    <div v-else-if="unavailable" class="auw-error">
      <i class="fa-solid fa-database"></i>
      <span>用量流水表未就绪</span>
    </div>
    <!-- 主内容 -->
    <div v-else class="auw-content">
      <div class="auw-head">
        <div class="auw-icon">
          <i class="fa-solid fa-chart-pie"></i>
        </div>
        <div class="auw-info">
          <div class="auw-title">AI 用量</div>
          <div class="auw-sub">
            近 {{ days }} 天 · {{ totals.calls }} 次 · {{ fmtYuan(totals.cost_micro) }}
            <span v-if="totals.users"> · {{ totals.users }} 人</span>
          </div>
        </div>
        <button class="auw-refresh" :disabled="loading" @click="load" title="刷新">
          <i class="fa-solid fa-rotate" :class="{ spinning: loading }"></i>
        </button>
      </div>

      <!-- 14 天费用趋势（内联 SVG，零依赖：校园平板上不引第三方图表库） -->
      <div v-if="trend.length" class="auw-trend">
        <div class="auw-trend-head">
          <span class="auw-trend-title">近 {{ trend.length }} 天费用</span>
          <span class="auw-trend-sum">{{ fmtYuan(trendTotal) }}</span>
        </div>
        <svg class="auw-trend-svg" :viewBox="'0 0 ' + trendViewW + ' ' + trendViewH" preserveAspectRatio="none">
          <rect
            v-for="(d, i) in trend"
            :key="d.key"
            class="auw-trend-bar"
            :x="(i * (trendViewW / trend.length)) + (trendViewW / trend.length) * 0.18"
            :y="trendBarY(d.cost_micro)"
            :width="(trendViewW / trend.length) * 0.64"
            :height="Math.max(1, trendViewH - trendBarY(d.cost_micro))"
            :fill="i === trend.length - 1 ? '#AF52DE' : 'rgba(175,82,222,0.45)'"
          >
            <title>{{ d.key }}：{{ fmtYuan(d.cost_micro) }} · {{ d.calls }} 次</title>
          </rect>
          <line
            :x1="0" :x2="trendViewW"
            :y1="trendAvgY" :y2="trendAvgY"
            stroke="rgba(255,149,0,0.75)" stroke-width="1" stroke-dasharray="3 3"
          />
        </svg>
        <div class="auw-trend-x">
          <span>{{ trend[0].key.substring(5) }}</span>
          <span>{{ trend[trend.length - 1].key.substring(5) }}</span>
        </div>
      </div>

      <div class="auw-controls">
        <div class="auw-chips">
          <button
            v-for="d in dayChoices"
            :key="d"
            class="auw-chip"
            :class="{ active: days === d }"
            @click="setDays(d)"
          >{{ d }}天</button>
        </div>
        <div class="auw-chips">
          <button
            class="auw-chip"
            :class="{ active: group === 'user' }"
            @click="setGroup('user')"
          >用户</button>
          <button
            class="auw-chip"
            :class="{ active: group === 'model' }"
            @click="setGroup('model')"
          >模型</button>
        </div>
      </div>

      <div v-if="!topRows.length" class="auw-empty">
        <i class="fa-solid fa-inbox"></i>
        <span>该时间窗内还没有用量记录</span>
      </div>
      <div v-else class="auw-list">
        <div v-for="(r, i) in topRows" :key="r.key || i" class="auw-row">
          <div class="auw-row-main">
            <span class="auw-dot" :style="{ background: dotColor(r, i) }"></span>
            <span class="auw-name" :title="r.label">{{ r.label || r.key || '未知' }}</span>
            <span class="auw-cost">{{ fmtYuan(r.cost_micro) }}</span>
          </div>
          <div class="auw-bar">
            <div class="auw-bar-fill" :style="{ width: barWidth(r.cost_micro), background: dotColor(r, i) }"></div>
          </div>
          <div class="auw-meta">
            {{ r.calls }} 次 · {{ fmtTokens(r.total_tokens) }} tokens
            <span v-if="r.cache_hit_rate"> · 缓存命中 {{ r.cache_hit_rate }}%</span>
            <span v-if="r.search_credits"> · 联网 {{ r.search_credits }} 次</span>
            <span v-if="r.estimated_calls" class="auw-warn"> · {{ r.estimated_calls }} 次估算</span>
          </div>
        </div>
        <div v-if="moreCount > 0" class="auw-more">另有 {{ moreCount }} 项未展示</div>
      </div>

      <div class="auw-foot">
        <span>共 {{ totals.total_tokens.toLocaleString() }} tokens</span>
        <span v-if="totals.cache_hit_tokens">缓存命中 {{ cacheHitRate }}%</span>
        <span v-if="totals.estimated_calls" class="auw-warn">{{ totals.estimated_calls }} 次为估算</span>
        <button class="auw-csv" :disabled="exporting" @click="exportCsv" title="按当前时间窗导出 CSV（Excel 可直接打开）">
          <i class="fa-solid fa-file-csv"></i> CSV
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

var ROW_LIMIT = 5;

// 微元（1e-6 元）→ 元，按量级自适应小数位
function toYuan(micro) {
  var yuan = (micro || 0) / 1000000;
  if (yuan === 0) return '¥0';
  if (yuan >= 1) return '¥' + yuan.toFixed(2);
  if (yuan >= 0.01) return '¥' + yuan.toFixed(4);
  return '¥' + yuan.toFixed(6);
}

function toTokenText(n) {
  n = n || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

export default {
  name: 'AiUsagePanel',
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
      unavailable: false,
      days: 7,
      group: 'user',
      dayChoices: [1, 7, 30],
      rows: [],
      trend: [],          // 按天聚合：[{key:'2026-10-01', cost_micro, calls}]
      exporting: false,
      totals: {
        calls: 0, users: 0, prompt_tokens: 0, completion_tokens: 0,
        cache_hit_tokens: 0, total_tokens: 0, cost_micro: 0,
        search_credits: 0, estimated_calls: 0
      }
    };
  },
  computed: {
    isAdmin: function() {
      return this.$store.getters['auth/isAdmin'];
    },
    topRows: function() {
      return this.rows.slice(0, ROW_LIMIT);
    },
    moreCount: function() {
      return Math.max(0, this.rows.length - ROW_LIMIT);
    },
    maxCost: function() {
      var max = 0;
      for (var i = 0; i < this.rows.length; i++) {
        if ((this.rows[i].cost_micro || 0) > max) max = this.rows[i].cost_micro || 0;
      }
      return max;
    },
    cacheHitRate: function() {
      var p = this.totals.prompt_tokens || 0;
      if (!p) return 0;
      return Math.round((this.totals.cache_hit_tokens || 0) / p * 100);
    },
    trendViewW: function() { return 300; },
    trendViewH: function() { return 64; },
    trendTotal: function() {
      var s = 0;
      for (var i = 0; i < this.trend.length; i++) s += (this.trend[i].cost_micro || 0);
      return s;
    },
    trendMax: function() {
      var m = 0;
      for (var i = 0; i < this.trend.length; i++) {
        if ((this.trend[i].cost_micro || 0) > m) m = this.trend[i].cost_micro || 0;
      }
      return m;
    },
    trendAvgY: function() {
      // 平均值参考线：为 0 时贴底，别画在图外
      var avg = this.trendTotal / Math.max(1, this.trend.length);
      return this.trendBarY(avg);
    }
  },
  watch: {
    refreshKey: function() {
      this.load();
    }
  },
  mounted: function() {
    this.load();
  },
  activated: function() {
    this.load();
  },
  methods: {
    fmtYuan: toYuan,
    fmtTokens: toTokenText,
    load: function() {
      var self = this;
      if (!self.isAdmin) {
        self.loading = false;
        return;
      }
      self.loading = true;
      self.error = false;
      api.get('/ai-chat/admin/usage/summary', { params: { days: self.days, group: self.group } }).then(function(res) {
        var data = (res.data && res.data.data) || {};
        if (data.unavailable) {
          self.unavailable = true;
          self.rows = [];
          return;
        }
        self.unavailable = false;
        self.rows = data.rows || [];
        if (data.totals) self.totals = data.totals;
      }).catch(function() {
        self.error = true;
      }).finally(function() {
        self.loading = false;
      });
      self.loadTrend();
    },
    setDays: function(d) {
      if (this.days === d) return;
      this.days = d;
      this.load();
    },
    setGroup: function(g) {
      if (this.group === g) return;
      this.group = g;
      this.load();
    },
    // 柱高换算：cost=0 时贴底（height 由调用处兜底为 ≥1，保证 title 可见）
    trendBarY: function(cost) {
      var h = this.trendViewH;
      if (!this.trendMax || !cost) return h - 1;
      return h - Math.max(1, Math.round((cost / this.trendMax) * (h - 6)));
    },
    loadTrend: function() {
      var self = this;
      api.get('/ai-chat/admin/usage/summary', { params: { days: 14, group: 'day' } }).then(function(res) {
        var rows = (res.data && res.data.data && res.data.data.rows) || [];
        // 接口按天倒序返回，图上要正序（旧 → 今天）
        self.trend = rows.slice().reverse().map(function(r) {
          return { key: r.key, cost_micro: r.cost_micro || 0, calls: r.calls || 0 };
        });
      }).catch(function() { self.trend = []; });
    },
    exportCsv: function() {
      var self = this;
      if (self.exporting) return;
      self.exporting = true;
      // 用带鉴权的 blob 下载：直接 <a href> 不会带 Authorization 头
      api.get('/ai-chat/admin/usage/export.csv', {
        params: { days: self.days, group: self.group },
        responseType: 'blob',
        timeout: 60000
      }).then(function(res) {
        var blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ai-usage-' + self.group + '-' + self.days + 'd.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 3000);
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '导出失败', type: 'error' });
      }).finally(function() {
        self.exporting = false;
      });
    },
    dotColor: function(r, i) {
      if (r.color) return r.color;
      var palette = ['#AF52DE', '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5AC8FA'];
      return palette[i % palette.length];
    },
    barWidth: function(cost) {
      var max = this.maxCost;
      if (!max || !cost) return '0%';
      return Math.max(4, Math.round((cost / max) * 100)) + '%';
    }
  }
};
</script>

<style scoped>
.ai-usage-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-normal) var(--ease-standard);
}
.ai-usage-widget:hover { box-shadow: var(--shadow-md); }

.auw-loading, .auw-error {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-tertiary);
}
.auw-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: #AF52DE;
  animation: auw-spin 0.9s linear infinite;
}
@keyframes auw-spin { to { transform: rotate(360deg); } }
.auw-error i { font-size: 20px; }
.auw-error span { font-size: var(--font-size-caption); }

.auw-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  gap: 8px;
  position: relative;
  overflow: hidden;
}
.auw-content::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: #AF52DE;
}

.auw-head { display: flex; align-items: center; gap: 10px; }
.auw-icon {
  width: 34px; height: 34px;
  border-radius: var(--radius-sm);
  background: #AF52DE;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(175, 82, 222, 0.3);
}
.auw-info { flex: 1; min-width: 0; }
.auw-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.auw-sub {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.auw-refresh {
  width: 28px; height: 28px;
  border: none; border-radius: var(--radius-sm);
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.12));
  color: var(--text-secondary);
  cursor: pointer; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.auw-refresh:active { transform: scale(0.92); }
.auw-refresh .spinning { animation: auw-spin 0.9s linear infinite; display: inline-block; }

.auw-controls { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.auw-chips { display: flex; gap: 4px; }
.auw-chip {
  padding: 3px 8px;
  border: 1px solid var(--separator-color);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
}
.auw-chip.active { background: rgba(175, 82, 222, 0.14); border-color: #AF52DE; color: #AF52DE; }

.auw-empty {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}
.auw-empty i { font-size: 20px; }

.auw-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
.auw-row { display: flex; flex-direction: column; gap: 3px; }
.auw-row-main { display: flex; align-items: center; gap: 6px; }
.auw-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.auw-name {
  flex: 1; min-width: 0;
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.auw-cost { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.auw-bar { height: 4px; border-radius: 2px; background: var(--fill-quaternary, rgba(120, 120, 128, 0.12)); overflow: hidden; }
.auw-bar-fill { height: 100%; border-radius: 2px; transition: width var(--duration-normal) var(--ease-standard); }
.auw-meta { font-size: 11px; color: var(--text-tertiary); }
.auw-warn { color: var(--warning-color, #FF9500); }
.auw-more { font-size: 11px; color: var(--text-tertiary); text-align: center; padding-top: 2px; }

.auw-foot {
  display: flex; align-items: center; gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--separator-color);
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.auw-csv { margin-left: auto; }

/* ======== 14 天费用趋势 ======== */
.auw-trend {
  flex-shrink: 0;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
  padding: 6px 8px 4px;
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.06));
}
.auw-trend-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 2px;
}
.auw-trend-title { font-size: 11px; color: var(--text-tertiary); }
.auw-trend-sum { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.auw-trend-svg { display: block; width: 100%; height: 46px; }
.auw-trend-bar { transition: fill var(--duration-fast) var(--ease-standard); }
.auw-trend-x {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--text-tertiary);
  margin-top: 1px;
}
</style>
