<template>
  <div class="island-body">
    <div class="panel-head">
      <span class="panel-title">通知记录</span>
    </div>
    <div class="htabs">
      <button class="htab" :class="{ active: filter === 'all' }" @click.stop="$emit('update-filter', 'all')">全部</button>
      <button class="htab" :class="{ active: filter === 'chat' }" @click.stop="$emit('update-filter', 'chat')">聊天</button>
      <button class="htab" :class="{ active: filter === 'community' }" @click.stop="$emit('update-filter', 'community')">社区</button>
      <button class="htab" :class="{ active: filter === 'system' }" @click.stop="$emit('update-filter', 'system')">系统</button>
    </div>
    <div class="hlist scrollbar-thin">
      <div
        v-for="(item, idx) in filteredHistory"
        :key="idx"
        class="hitem"
        @click.stop="$emit('history-click', item)"
      >
        <div class="hitem-icon" :style="{ background: item.color || 'rgba(59,130,246,0.2)' }">
          <i :class="item.icon || 'fa-solid fa-bell'"></i>
        </div>
        <div class="hitem-body">
          <div class="hitem-title">
            <span v-if="item.priority === 'urgent'" class="ptag ptag-urgent">紧急</span>
            <span v-if="item.priority === 'low'" class="ptag ptag-low">低</span>
            {{ item.title }}
          </div>
          <div class="hitem-text">{{ item.text }}</div>
        </div>
        <div class="hitem-time">{{ formatTime(item.timestamp) }}</div>
      </div>
      <div v-if="filteredHistory.length === 0" class="hlist-empty">暂无通知记录</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandHistoryPanel',
  props: {
    history: { type: Array, default: function() { return []; } },
    filter: { type: String, default: 'all' }
  },
  computed: {
    filteredHistory: function() {
      var self = this;
      if (self.filter === 'all') return self.history;
      return self.history.filter(function(item) {
        return item.category === self.filter;
      });
    }
  },
  methods: {
    formatTime: function(ts) {
      if (!ts) return '';
      var diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      return Math.floor(diff / 86400000) + '天前';
    }
  }
};
</script>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 14px;
  padding-top: 14px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--island-text);
}

.htabs {
  display: flex;
  padding: 0 14px 6px;
  gap: 4px;
}

.htab {
  flex: 1;
  padding: 6px 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--island-text);
  opacity: 0.5;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.htab:hover {
  background: rgba(255, 255, 255, 0.06);
  opacity: 0.7;
}

.htab.active {
  background: rgba(59, 130, 246, 0.2);
  opacity: 1;
  font-weight: 600;
}

.hlist {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 10px 10px;
}

.hitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.hitem:hover {
  background: rgba(255, 255, 255, 0.06);
}

.hitem-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
  color: var(--island-text);
}

.hitem-body {
  flex: 1;
  min-width: 0;
}

.hitem-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--island-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hitem-text {
  font-size: 12px;
  color: var(--island-text);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hitem-time {
  font-size: 11px;
  color: var(--island-text);
  opacity: 0.4;
  flex-shrink: 0;
}

.hlist-empty {
  text-align: center;
  padding: 30px 0;
  font-size: 13px;
  opacity: 0.4;
}

.ptag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  line-height: 1.5;
  margin-right: 4px;
  vertical-align: middle;
}

.ptag-urgent {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.ptag-low {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}

.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 2px; }

@media (max-width: 480px) {
  .hlist { max-height: 280px; }
}
</style>
