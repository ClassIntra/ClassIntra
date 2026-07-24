<template>
  <div class="announcements-page">
    <!-- iPadOS 毛玻璃导航栏 -->
    <header class="ann-nav">
      <button class="ann-back" @click="$router.go(-1)" aria-label="返回">
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        <span class="ann-back-text">返回</span>
      </button>
      <h1 class="ann-nav-title">公告中心</h1>
    </header>

    <!-- iPadOS 大标题 + segmented control -->
    <div class="ann-large-header">
      <h2 class="ann-large-title">公告</h2>
      <div class="segmented-control" role="tablist" aria-label="公告筛选">
        <div class="segment-indicator" :style="indicatorStyle" aria-hidden="true"></div>
        <button
          v-for="(tab, idx) in tabs"
          :key="tab.key"
          class="segment-btn"
          :class="{ active: activeFilter === tab.key }"
          role="tab"
          :aria-selected="activeFilter === tab.key"
          @click="activeFilter = tab.key; activeIndex = idx"
          ref="segmentBtns"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 列表：iPadOS 风格 inset list + stagger 入场 -->
    <div class="ann-list scrollbar-thin" ref="listEl">
      <transition-group name="list-stagger" tag="div" class="ann-list-inner">
        <div v-if="filteredAnnouncements.length === 0" key="empty" class="ann-empty">
          <div class="ann-empty-icon" aria-hidden="true">
            <i class="fa-solid fa-bullhorn"></i>
          </div>
          <p class="ann-empty-title">暂无公告</p>
          <p class="ann-empty-desc">这里的公告会显示在这里</p>
        </div>

        <div
          v-for="(item, idx) in filteredAnnouncements"
          :key="item.id"
          class="ann-card"
          :class="{ pinned: item.pinned }"
          :style="{ '--stagger-index': idx }"
        >
          <div class="ann-card-header">
            <div class="ann-card-badges">
              <span v-if="item.pinned" class="ann-badge pin-badge">
                <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
                <span>置顶</span>
              </span>
              <span class="ann-badge" :class="item.type === 'homework' ? 'hw-badge' : 'notice-badge'">
                <i :class="item.type === 'homework' ? 'fa-solid fa-book' : 'fa-solid fa-bullhorn'" aria-hidden="true"></i>
                <span>{{ item.type === 'homework' ? '作业' : '公告' }}</span>
              </span>
            </div>
            <span class="ann-card-time">{{ formatTime(item.created_at) }}</span>
          </div>
          <h3 class="ann-card-title">{{ item.title }}</h3>
          <div class="ann-card-content">{{ item.content }}</div>
          <div class="ann-card-footer">
            <span class="ann-card-author">
              <i class="fa-solid fa-user" aria-hidden="true"></i>
              <span>{{ item.author_name || '管理员' }}</span>
            </span>
          </div>
        </div>
      </transition-group>
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
      activeFilter: 'all',
      activeIndex: 0,
      tabs: [
        { key: 'all', label: '全部' },
        { key: 'notice', label: '公告' },
        { key: 'homework', label: '作业' }
      ]
    };
  },
  computed: {
    filteredAnnouncements: function() {
      var self = this;
      if (self.activeFilter === 'all') return self.announcements;
      return self.announcements.filter(function(a) { return a.type === self.activeFilter; });
    },
    indicatorStyle: function() {
      // 滑动指示器：通过 translateX 移动到当前 tab 位置
      // width 由 CSS 中 calc(33.333% - 1.33px) 处理，避免覆盖
      return {
        transform: 'translateX(' + (this.activeIndex * 100) + '%)'
      };
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
/* ========== 页面容器 ========== */
.announcements-page {
  height: 100%;
  background: var(--bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ========== 毛玻璃导航栏 ========== */
.ann-nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-nav);
  -webkit-backdrop-filter: var(--glass-blur-nav);
  border-bottom: 0.5px solid var(--separator-color);
  position: sticky;
  top: 0;
  z-index: 10;
  min-height: 44px;
}

.ann-back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 0 8px 0 4px;
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: opacity 0.15s var(--ease-standard, ease), transform 0.15s var(--ease-standard, ease);
}

.ann-back:hover {
  opacity: 0.7;
}

.ann-back:active {
  transform: scale(0.97);
  opacity: 0.6;
}

.ann-back i {
  font-size: 17px;
  margin-right: 2px;
}

.ann-back-text {
  font-weight: var(--font-weight-normal);
}

.ann-nav-title {
  flex: 1;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  text-align: center;
  /* 大标题可见时，nav 标题隐藏 */
  opacity: 0;
  transition: opacity 0.2s var(--ease-standard, ease);
}

/* ========== 大标题区（iPadOS Large Title pattern） ========== */
.ann-large-header {
  padding: 8px var(--spacing-lg) 12px;
  background: var(--bg-color);
  position: relative;
  z-index: 5;
  border-bottom: 0.5px solid var(--separator-color);
}

.ann-large-title {
  font-size: 34px;
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  letter-spacing: -0.5px;
  margin: 0 0 12px;
  line-height: 1.1;
}

/* ========== Segmented control：iPadOS 风格带滑动指示器 ========== */
.segmented-control {
  position: relative;
  display: flex;
  background: rgba(118, 118, 128, 0.12);
  border-radius: var(--radius-sm, 9px);
  padding: 2px;
  overflow: hidden;
}

[data-theme="dark"] .segmented-control {
  background: rgba(118, 118, 128, 0.24);
}

.segment-indicator {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(33.333% - 1.33px);
  background: var(--card-bg, #fff);
  border-radius: 7px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.04);
  transition: transform 0.3s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1));
  z-index: 0;
}

[data-theme="dark"] .segment-indicator {
  background: var(--card-bg, #1c1c1e);
}

.segment-btn {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 32px;
  padding: var(--spacing-sm) 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-footnote, 13px);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: color 0.2s var(--ease-standard, ease);
  display: flex;
  align-items: center;
  justify-content: center;
}

.segment-btn:not(.active) {
  color: var(--text-secondary);
}

[data-theme="dark"] .segment-btn:not(.active) {
  color: rgba(235, 235, 245, 0.6);
}

.segment-btn:active {
  opacity: 0.7;
}

/* ========== 列表容器 ========== */
.ann-list {
  flex: 1;
  padding: var(--spacing-md) var(--spacing-lg) var(--spacing-xl);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.ann-list-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ========== 空状态 ========== */
.ann-empty {
  text-align: center;
  padding: var(--spacing-xxl, 64px) var(--spacing-lg);
  color: var(--text-tertiary);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ann-empty-icon {
  width: 72px;
  height: 72px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(120, 120, 128, 0.08);
  border-radius: 50%;
  color: var(--text-tertiary);
  font-size: 28px;
}

[data-theme="dark"] .ann-empty-icon {
  background: rgba(120, 120, 128, 0.16);
}

.ann-empty-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.ann-empty-desc {
  font-size: var(--font-size-footnote);
  color: var(--text-tertiary);
  margin: 0;
}

/* ========== 卡片：iPadOS 风格 ========== */
.ann-card {
  background: var(--card-bg);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-lg, 14px);
  padding: var(--spacing-md);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: transform 0.15s var(--ease-standard, ease),
              box-shadow 0.15s var(--ease-standard, ease);
}

.ann-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ann-card:active {
  transform: scale(0.99);
}

.ann-card.pinned {
  background: linear-gradient(135deg, rgba(var(--primary-rgb, 0, 122, 255), 0.06) 0%, var(--card-bg) 60%);
  border-color: rgba(var(--primary-rgb, 0, 122, 255), 0.2);
}

.ann-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 8px;
}

.ann-card-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ann-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-pill, 9999px);
  font-size: var(--font-size-caption2, 11px);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.2px;
}

.pin-badge {
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.12);
  color: var(--primary-color, #007AFF);
}

.notice-badge {
  background: rgba(var(--primary-rgb, 0, 122, 255), 0.1);
  color: var(--info-color, #5AC8FA);
}

.hw-badge {
  background: rgba(var(--warning-rgb, 255, 149, 10), 0.12);
  color: var(--warning-color, #FF9500);
}

.ann-card-time {
  font-size: var(--font-size-caption, 12px);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  white-space: nowrap;
}

.ann-card-title {
  font-size: var(--font-size-callout, 16px);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-card-content {
  font-size: var(--font-size-sm, 14px);
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ann-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 0.5px solid var(--separator-color);
}

.ann-card-author {
  font-size: var(--font-size-caption, 12px);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.ann-card-author i {
  font-size: 10px;
}

/* ========== Stagger 入场动画（每条卡片错峰 30ms） ========== */
.list-stagger-enter-active {
  transition: opacity 0.35s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
              transform 0.35s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1));
  transition-delay: calc(var(--stagger-index, 0) * 30ms);
}
.list-stagger-leave-active {
  transition: opacity 0.2s var(--ease-accelerate, ease-in);
  position: absolute;
  width: 100%;
}
.list-stagger-enter {
  opacity: 0;
  transform: translateY(8px);
}
.list-stagger-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.list-stagger-move {
  transition: transform 0.3s var(--ease-standard, ease);
}

/* ========== Reduced motion ========== */
@media (prefers-reduced-motion: reduce) {
  .segment-indicator,
  .ann-card,
  .list-stagger-enter-active,
  .list-stagger-leave-active,
  .list-stagger-move {
    transition: opacity 0.15s ease;
    transform: none !important;
  }
}

/* ========== 响应式：宽屏（iPad 横屏） ========== */
@media (min-width: 768px) {
  .ann-list-inner {
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }
  .ann-large-header {
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }
}
</style>
