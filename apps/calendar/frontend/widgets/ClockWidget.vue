<template>
  <div class="clock-widget">
    <div class="ck-content" :class="{ 'ck-content--wide': isWide }">
      <div class="ck-time">{{ timeText }}</div>
      <div class="ck-date">
        <div class="ck-date-main">{{ dateText }}</div>
        <div class="ck-week">{{ weekText }}</div>
      </div>
    </div>
  </div>
</template>

<script>
// 时钟小组件：纯前端走时（无 API），10s 对齐系统时钟
export default {
  name: 'ClockWidget',
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
      now: new Date(),
      isWide: false
    };
  },
  computed: {
    timeText: function() {
      var d = this.now;
      var p = function(n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes());
    },
    dateText: function() {
      var d = this.now;
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    weekText: function() {
      return '星期' + '日一二三四五六'.charAt(this.now.getDay());
    }
  },
  mounted: function() {
    var self = this;
    self.startTick();
    // 加宽布局判定：实测自身宽度（ResizeObserver，Chrome 67+；不可用时常按窄布局）
    if (typeof ResizeObserver !== 'undefined' && self.$el) {
      self._ro = new ResizeObserver(function(entries) {
        var w = entries && entries[0] ? entries[0].contentRect.width : 0;
        self.isWide = w >= 320;
      });
      self._ro.observe(self.$el);
    }
  },
  activated: function() {
    this.startTick();
  },
  beforeDestroy: function() {
    this.stopTick();
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  },
  deactivated: function() {
    this.stopTick();
  },
  methods: {
    startTick: function() {
      var self = this;
      self.stopTick();
      self.now = new Date();
      // 10s 粒度足够分钟级显示；对齐到整十秒，避免秒级漂移感
      self._tickTimer = setInterval(function() {
        self.now = new Date();
      }, 10000);
    },
    stopTick: function() {
      if (this._tickTimer) {
        clearInterval(this._tickTimer);
        this._tickTimer = null;
      }
    }
  }
};
</script>

<style scoped>
.clock-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
}

.ck-content {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}

.ck-time {
  font-size: 34px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: 1px;
  white-space: nowrap;
}

.ck-date {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ck-date-main {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ck-week {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
}

/* 加宽（4×2）：居中大字 */
.ck-content--wide {
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

.ck-content--wide .ck-time {
  font-size: 52px;
}

.ck-content--wide .ck-date {
  flex-direction: row;
  gap: 8px;
  align-items: baseline;
}
</style>
