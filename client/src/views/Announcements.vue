<template>
  <div class="announcements-page">
    <div class="ann-header">
      <button class="ann-back" @click="$router.go(-1)">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <h2 class="ann-title">公告中心</h2>
      <div class="ann-tabs">
        <button class="ann-tab" :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">全部</button>
        <button class="ann-tab" :class="{ active: activeFilter === 'notice' }" @click="activeFilter = 'notice'">公告</button>
        <button class="ann-tab" :class="{ active: activeFilter === 'homework' }" @click="activeFilter = 'homework'">作业</button>
      </div>
    </div>

    <div class="ann-list scrollbar-thin">
      <div v-if="filteredAnnouncements.length === 0" class="ann-empty">
        <i class="fa-solid fa-bullhorn"></i>
        <p>暂无公告</p>
      </div>

      <div
        v-for="item in filteredAnnouncements"
        :key="item.id"
        class="ann-card"
        :class="{ pinned: item.pinned }"
      >
        <div class="ann-card-header">
          <div class="ann-card-badges">
            <span v-if="item.pinned" class="ann-badge pin-badge">
              <i class="fa-solid fa-thumbtack"></i> 置顶
            </span>
            <span class="ann-badge" :class="item.type === 'homework' ? 'hw-badge' : 'notice-badge'">
              <i :class="item.type === 'homework' ? 'fa-solid fa-book' : 'fa-solid fa-bullhorn'"></i>
              {{ item.type === 'homework' ? '作业' : '公告' }}
            </span>
          </div>
          <span class="ann-card-time">{{ formatTime(item.created_at) }}</span>
        </div>
        <h3 class="ann-card-title">{{ item.title }}</h3>
        <div class="ann-card-content">{{ item.content }}</div>
        <div class="ann-card-footer">
          <span class="ann-card-author">
            <i class="fa-solid fa-user"></i> {{ item.author_name || '管理员' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'Announcements',
  data: function() {
    return {
      announcements: [],
      activeFilter: 'all'
    };
  },
  computed: {
    filteredAnnouncements: function() {
      var self = this;
      if (self.activeFilter === 'all') return self.announcements;
      return self.announcements.filter(function(a) { return a.type === self.activeFilter; });
    }
  },
  mounted: function() {
    this.loadAnnouncements();
  },
  methods: {
    loadAnnouncements: function() {
      var self = this;
      api.get('/assets/announcements').then(function(response) {
        self.announcements = response.data.data || [];
      }).catch(function() {
        self.announcements = [];
      });
    },
    formatTime: function(dateStr) {
      if (!dateStr) return '';
      var d = new Date(dateStr);
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
      var month = d.getMonth() + 1;
      var day = d.getDate();
      return month + '月' + day + '日';
    }
  }
};
</script>

<style scoped>
.announcements-page {
  height: 100%;
  background: var(--bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ann-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-nav);
  -webkit-backdrop-filter: var(--glass-blur-nav);
  border-bottom: 0.5px solid var(--separator-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.ann-back {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--bg-color);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  transition: transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.ann-back:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
}

.ann-back:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.ann-title {
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-tabs {
  display: flex;
  gap: 2px;
  background: rgba(118, 118, 128, 0.12);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.ann-tab {
  padding: var(--spacing-xs) 14px;
  border-radius: var(--radius-xs);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
  font-weight: var(--font-weight-regular);
  min-height: 40px;
  display: flex;
  align-items: center;
}

.ann-tab.active {
  background: var(--card-bg);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm);
}

.ann-tab:hover:not(.active) {
  color: var(--text-primary);
}

.ann-tab:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.ann-list {
  flex: 1;
  padding: var(--spacing-md) var(--spacing-lg);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.ann-empty {
  text-align: center;
  padding: var(--spacing-xxl) var(--spacing-lg);
  color: var(--text-tertiary);
}

.ann-empty i {
  font-size: 40px;
  margin-bottom: var(--spacing-md);
  display: block;
  opacity: 0.3;
}

.ann-card {
  background: var(--card-bg);
  border: none;
  border-radius: var(--radius-md);
  padding: var(--spacing-md) var(--spacing-lg);
  transition: box-shadow var(--transition-fast);
}

.ann-card:hover {
  box-shadow: var(--shadow-md);
}

.ann-card.pinned {
  border: none;
  background: var(--primary-lighter);
}

.ann-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.ann-card-badges {
  display: flex;
  gap: var(--spacing-xs);
}

.ann-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 2px var(--spacing-sm);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-semibold);
}

.pin-badge {
  background: var(--primary-lighter);
  color: var(--primary-color);
}

.notice-badge {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--info-color);
}

.hw-badge {
  background: rgba(var(--warning-rgb), 0.1);
  color: var(--warning-color);
}

.ann-card-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.ann-card-title {
  font-size: var(--font-size-callout);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
  line-height: var(--line-height-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-card-content {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: var(--line-height-relaxed);
  white-space: pre-wrap;
  word-break: break-word;
}

.ann-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 0.5px solid var(--separator-color);
}

.ann-card-author {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}
</style>
