<template>
  <div class="calendar-today-widget">
    <!-- 加载 -->
    <div v-if="loading" class="ct-state">
      <div class="ct-spinner"></div>
    </div>
    <!-- 错误 -->
    <div v-else-if="error" class="ct-state">
      <i class="fa-solid fa-calendar-xmark"></i>
      <span>日程加载失败</span>
    </div>
    <!-- 内容 -->
    <div v-else class="ct-content">
      <div class="ct-header">
        <i class="fa-solid fa-calendar-day ct-header-icon"></i>
        <span class="ct-date">{{ dateText }}</span>
        <span class="ct-count">{{ events.length }} 项</span>
      </div>
      <div v-if="events.length === 0" class="ct-empty">
        <i class="fa-solid fa-mug-hot"></i>
        <span>今天没有日程</span>
      </div>
      <div v-else class="ct-list">
        <div v-for="ev in events" :key="ev.id" class="ct-item">
          <span class="ct-item-time">{{ ev.timeText }}</span>
          <span class="ct-item-title">{{ ev.title }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// 今日日程小组件：走后端专用端点（重复事件已在服务端按实例展开）
import api from '@/utils/api';

export default {
  name: 'CalendarTodayWidget',
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
  computed: {
    dateText: function() {
      var d = new Date();
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + '日一二三四五六'.charAt(d.getDay());
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
      self.error = false;
      api.get('/calendar/events/today').then(function(res) {
        var list = (res.data && res.data.code === 200 && Array.isArray(res.data.data)) ? res.data.data : [];
        // 全天排最前，其余按开始时间升序
        list.sort(function(a, b) {
          var at = a.start_time || '00:00';
          var bt = b.start_time || '00:00';
          var aAllDay = !a.start_time;
          var bAllDay = !b.start_time;
          if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
          return at < bt ? -1 : (at > bt ? 1 : 0);
        });
        self.events = list.map(function(ev) {
          return {
            id: ev.id,
            title: ev.title || '未命名日程',
            timeText: ev.start_time ? String(ev.start_time).slice(0, 5) : '全天'
          };
        });
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
.calendar-today-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
}

.ct-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.ct-state i { font-size: 22px; }

.ct-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: var(--primary-color);
  animation: ct-spin 0.9s linear infinite;
}
@keyframes ct-spin { to { transform: rotate(360deg); } }

.ct-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  overflow: hidden;
}

.ct-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}

.ct-header-icon {
  font-size: 13px;
  color: var(--primary-color);
}

.ct-date {
  flex: 1;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ct-count {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.ct-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.ct-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding-top: 6px;
}

.ct-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  min-width: 0;
}

.ct-item + .ct-item {
  border-top: 0.5px solid var(--separator-color);
}

.ct-item-time {
  font-size: var(--font-size-caption);
  color: var(--primary-color);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  width: 42px;
}

.ct-item-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-body);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
