<template>
  <div class="countdown-widget" @click="goToApp">
    <div v-if="loading" class="cw-loading">
      <div class="cw-spinner"></div>
    </div>
    <div v-else-if="error" class="cw-error">
      <i class="fa-solid fa-circle-exclamation"></i>
      <span>加载失败</span>
    </div>
    <div v-else-if="!nearest" class="cw-empty">
      <i class="fa-solid fa-hourglass-half"></i>
      <span class="cw-empty-text">暂无倒数日</span>
    </div>
    <div v-else class="cw-content" :style="{ '--cw-color': color }">
      <div class="cw-icon">{{ icon }}</div>
      <div class="cw-info">
        <div class="cw-title">{{ nearest.title }}</div>
        <div class="cw-date">{{ dateLabel }}</div>
      </div>
      <div class="cw-days" :class="status">
        <template v-if="status === 'today'">
          <span class="cw-days-num">今天</span>
        </template>
        <template v-else>
          <span class="cw-days-num">{{ days }}</span>
          <span class="cw-days-unit">{{ status === 'future' ? '天后' : '天前' }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

// 分类预设（与 Countdown.vue 保持一致）
var CATEGORIES = {
  anniversary: { color: '#FF3B30', icon: '❤️' },
  birthday: { color: '#FF9500', icon: '🎂' },
  exam: { color: '#007AFF', icon: '📝' },
  festival: { color: '#34C759', icon: '🎉' },
  travel: { color: '#5856D6', icon: '✈️' },
  other: { color: '#8E8E93', icon: '📌' }
};

function findCategory(value) {
  return CATEGORIES[value] || CATEGORIES.other;
}

// 计算倒计时
function calcDays(dateStr) {
  if (!dateStr) return { days: 0, status: 'future' };
  var parts = dateStr.split('-');
  var target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = Math.round((target - today) / 86400000);
  if (diff > 0) return { days: diff, status: 'future' };
  if (diff === 0) return { days: 0, status: 'today' };
  return { days: -diff, status: 'past' };
}

export default {
  name: 'CountdownWidget',
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
      events: []
    };
  },
  watch: {
    // 监听 refreshKey 变化，触发数据重新加载
    refreshKey: function() {
      this.loadData();
    }
  },
  computed: {
    // 按 config.filter 过滤后的事件
    filteredEvents: function() {
      var filter = (this.config && this.config.filter) || 'all';
      if (filter === 'all') return this.events;
      var now = new Date();
      var todayStr = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' + (now.getMonth() + 1) : (now.getMonth() + 1)) + '-' + (now.getDate() < 10 ? '0' + now.getDate() : now.getDate());
      if (filter === 'pinned') {
        return this.events.filter(function(e) { return !!e.pinned; });
      }
      if (filter === 'today') {
        return this.events.filter(function(e) {
          var dateStr = e.next_date || e.target_date;
          return dateStr === todayStr;
        });
      }
      return this.events;
    },
    // 最近的事件：优先未来，其次今天，最后最近的过去
    nearest: function() {
      var events = this.filteredEvents;
      if (!events.length) return null;
      var future = [];
      var today = [];
      var past = [];
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var dateStr = ev.next_date || ev.target_date;
        var cd = calcDays(dateStr);
        if (cd.status === 'future') future.push({ ev: ev, cd: cd });
        else if (cd.status === 'today') today.push({ ev: ev, cd: cd });
        else past.push({ ev: ev, cd: cd });
      }
      if (future.length) {
        future.sort(function(a, b) { return a.cd.days - b.cd.days; });
        return { event: future[0].ev, countdown: future[0].cd };
      }
      if (today.length) return { event: today[0].ev, countdown: today[0].cd };
      if (past.length) {
        past.sort(function(a, b) { return a.cd.days - b.cd.days; });
        return { event: past[0].ev, countdown: past[0].cd };
      }
      return null;
    },
    days: function() {
      return this.nearest ? this.nearest.countdown.days : 0;
    },
    status: function() {
      return this.nearest ? this.nearest.countdown.status : 'future';
    },
    color: function() {
      if (!this.nearest) return '#007AFF';
      var ev = this.nearest.event;
      return ev.color || findCategory(ev.category).color;
    },
    icon: function() {
      if (!this.nearest) return '📌';
      var ev = this.nearest.event;
      return ev.icon || findCategory(ev.category).icon;
    },
    dateLabel: function() {
      if (!this.nearest) return '';
      var ev = this.nearest.event;
      var dateStr = ev.next_date || ev.target_date;
      if (!dateStr) return '';
      var parts = dateStr.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日 ' + weekdays[d.getDay()];
    }
  },
  mounted: function() {
    this.loadData();
  },
  activated: function() {
    this.loadData();
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      api.get('/countdown/events').then(function(res) {
        if (res.data && res.data.code === 200) {
          self.events = res.data.data || [];
        } else {
          self.error = true;
        }
      }).catch(function() {
        self.error = true;
      }).finally(function() {
        self.loading = false;
      });
    },
    goToApp: function() {
      if (this.$router) {
        this.$router.push('/countdown');
      }
    }
  }
};
</script>

<style scoped>
.countdown-widget {
  height: 100%;
  cursor: pointer;
  border-radius: 18px;
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s;
}
.countdown-widget:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.countdown-widget:active { transform: scale(0.98); }

/* 加载 */
.cw-loading, .cw-error, .cw-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
}
.cw-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: var(--primary-color);
  animation: cw-spin 0.9s linear infinite;
}
@keyframes cw-spin { to { transform: rotate(360deg); } }
.cw-error i, .cw-empty i { font-size: 22px; }
.cw-empty-text { font-size: var(--font-size-caption); }

/* 内容 */
.cw-content {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  position: relative;
  overflow: hidden;
}
.cw-content::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--cw-color);
}

.cw-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.cw-info {
  flex: 1;
  min-width: 0;
}
.cw-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cw-date {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cw-days {
  display: flex;
  align-items: baseline;
  gap: 2px;
  flex-shrink: 0;
}
.cw-days.future .cw-days-num { color: var(--primary-color); }
.cw-days.today .cw-days-num { color: var(--warning-color); font-size: var(--font-size-body); }
.cw-days.past .cw-days-num { color: var(--text-tertiary); }
.cw-days-num {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
}
.cw-days-unit {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
</style>
