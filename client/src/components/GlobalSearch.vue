<template>
  <div v-if="visible" class="global-search-overlay" @click.self="close" role="dialog" aria-modal="true" aria-label="全局搜索">
    <div class="global-search-modal" :class="{ 'is-dark': isDark }">
      <!-- 搜索框 -->
      <div class="search-input-wrap">
        <i class="fas fa-search search-icon" aria-hidden="true"></i>
        <input
          ref="input"
          v-model="query"
          type="text"
          class="search-input"
          placeholder="搜索应用、命令…（Ctrl+K 唤起）"
          autocomplete="off"
          spellcheck="false"
          @input="onInput"
          @keydown="onKeydown"
        />
        <button v-if="query" class="clear-btn" @click="clearQuery" aria-label="清空">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
        <kbd class="esc-hint">ESC</kbd>
      </div>

      <!-- 搜索结果 / 最近搜索 -->
      <div class="search-body" ref="body">
        <!-- 加载中 -->
        <div v-if="loading" class="search-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <span>搜索中…</span>
        </div>

        <!-- 无查询时显示最近搜索 -->
        <div v-else-if="!query" class="recent-section">
          <div v-if="recentSearches.length > 0" class="section-header">
            <span class="section-title">最近搜索</span>
            <button class="clear-recent-btn" @click="clearRecent">清空</button>
          </div>
          <div v-if="recentSearches.length > 0" class="recent-list">
            <button
              v-for="(item, idx) in recentSearches"
              :key="'recent-' + idx"
              class="recent-item"
              :class="{ active: idx === selectedIndex }"
              @click="searchRecent(item)"
              @mouseenter="selectedIndex = idx"
            >
              <i class="fas fa-clock-rotate-left recent-icon" aria-hidden="true"></i>
              <span class="recent-text">{{ item }}</span>
            </button>
          </div>
          <div v-else class="empty-hint">
            <i class="fas fa-magnifying-glass hint-icon" aria-hidden="true"></i>
            <span>输入关键词开始搜索</span>
          </div>
        </div>

        <!-- 搜索结果 -->
        <div v-else-if="flatResults.length > 0" class="results-section">
          <div
            v-for="group in groups"
            :key="group.category"
            class="result-group"
          >
            <div class="group-header">{{ group.category }}</div>
            <button
              v-for="item in group.items"
              :key="item.id"
              class="result-item"
              :class="{ active: getFlatIndex(item.id) === selectedIndex }"
              @click="executeResult(item)"
              @mouseenter="selectedIndex = getFlatIndex(item.id)"
            >
              <div class="result-icon-wrap" :style="item.iconColor ? { background: item.iconColor } : {}">
                <img v-if="item.icon && item.icon.startsWith('/') && !item.icon.endsWith('.png')" :src="item.icon" class="result-icon-img" alt="" />
                <img v-else-if="item.icon && item.icon.startsWith('/')" :src="item.icon" class="result-icon-img" alt="" />
                <i v-else-if="item.icon" :class="item.icon" class="result-icon-fa" aria-hidden="true"></i>
                <i v-else class="fas fa-arrow-right result-icon-fa" aria-hidden="true"></i>
              </div>
              <div class="result-content">
                <div class="result-title">{{ item.title }}</div>
                <div v-if="item.description" class="result-desc">{{ item.description }}</div>
              </div>
            </button>
          </div>
        </div>

        <!-- 无结果 -->
        <div v-else class="empty-hint">
          <i class="fas fa-magnifying-glass hint-icon" aria-hidden="true"></i>
          <span>未找到 "{{ query }}" 的相关结果</span>
        </div>
      </div>

      <!-- 底部提示 -->
      <div class="search-footer">
        <span class="footer-hint">
          <kbd>↑</kbd><kbd>↓</kbd> 导航
          <kbd>↵</kbd> 执行
          <kbd>ESC</kbd> 关闭
        </span>
        <span class="footer-count" v-if="query && flatResults.length > 0">{{ flatResults.length }} 个结果</span>
      </div>
    </div>
  </div>
</template>

<script>
import { getSearchRegistry } from '@/core/search-registry';

var DEBOUNCE_MS = 300;

export default {
  name: 'GlobalSearch',
  data: function() {
    return {
      visible: false,
      query: '',
      loading: false,
      groups: [],
      selectedIndex: 0,
      recentSearches: [],
      isDark: false,
      _debounceTimer: null,
      _searchRegistry: null,
      _themeUnsub: null
    };
  },
  computed: {
    flatResults: function() {
      var flat = [];
      for (var i = 0; i < this.groups.length; i++) {
        var items = this.groups[i].items;
        for (var j = 0; j < items.length; j++) {
          flat.push(items[j]);
        }
      }
      return flat;
    }
  },
  created: function() {
    this._searchRegistry = getSearchRegistry();
    this.recentSearches = this._searchRegistry.getRecentSearches();
    this._updateTheme();
  },
  mounted: function() {
    var self = this;
    // 监听主题变化
    try {
      var themeEngine = this.$services ? this.$services.resolve('themeEngine') : null;
      if (themeEngine && typeof themeEngine.subscribe === 'function') {
        this._themeUnsub = themeEngine.subscribe(function() {
          self._updateTheme();
        });
      }
    } catch (e) {}
    this._updateTheme();
  },
  beforeDestroy: function() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    if (this._themeUnsub) {
      try { this._themeUnsub(); } catch (e) {}
    }
  },
  methods: {
    open: function() {
      this.visible = true;
      this.query = '';
      this.groups = [];
      this.selectedIndex = 0;
      this.recentSearches = this._searchRegistry.getRecentSearches();
      var self = this;
      this.$nextTick(function() {
        if (self.$refs.input) {
          self.$refs.input.focus();
        }
      });
    },
    close: function() {
      this.visible = false;
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
    },
    clearQuery: function() {
      this.query = '';
      this.groups = [];
      this.selectedIndex = 0;
      if (this.$refs.input) {
        this.$refs.input.focus();
      }
    },
    onInput: function() {
      var self = this;
      this.selectedIndex = 0;
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
      }
      if (!this.query.trim()) {
        this.groups = [];
        this.loading = false;
        return;
      }
      this.loading = true;
      this._debounceTimer = setTimeout(function() {
        self._doSearch();
      }, DEBOUNCE_MS);
    },
    _doSearch: function() {
      var self = this;
      var q = this.query.trim();
      if (!q) {
        this.groups = [];
        this.loading = false;
        return;
      }
      this._searchRegistry.search(q).then(function(result) {
        self.groups = result.groups;
        self.selectedIndex = 0;
        self.loading = false;
      }).catch(function(e) {
        console.error('[GlobalSearch] 搜索失败:', e);
        self.groups = [];
        self.loading = false;
      });
    },
    searchRecent: function(item) {
      this.query = item;
      this.onInput();
    },
    onKeydown: function(e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.flatResults.length - 1);
        this._scrollToSelected();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this._scrollToSelected();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.flatResults.length > 0) {
          var item = this.flatResults[this.selectedIndex];
          if (item) this.executeResult(item);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    },
    executeResult: function(item) {
      if (!item) return;
      // 记录最近搜索
      this._searchRegistry.addRecentSearch(this.query.trim());
      this.recentSearches = this._searchRegistry.getRecentSearches();
      // 执行 action
      if (typeof item.action === 'function') {
        try {
          item.action();
        } catch (e) {
          console.error('[GlobalSearch] 执行结果失败:', e);
        }
      }
      this.close();
    },
    getFlatIndex: function(id) {
      for (var i = 0; i < this.flatResults.length; i++) {
        if (this.flatResults[i].id === id) return i;
      }
      return -1;
    },
    clearRecent: function() {
      this._searchRegistry.clearRecentSearches();
      this.recentSearches = [];
    },
    _scrollToSelected: function() {
      var self = this;
      this.$nextTick(function() {
        if (!self.$refs.body) return;
        var active = self.$refs.body.querySelector('.result-item.active, .recent-item.active');
        if (active) {
          active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    },
    _updateTheme: function() {
      try {
        var themeEngine = this.$services ? this.$services.resolve('themeEngine') : null;
        if (themeEngine && typeof themeEngine.getCurrentThemeType === 'function') {
          this.isDark = themeEngine.getCurrentThemeType() === 'dark';
          return;
        }
      } catch (e) {}
      // 降级：检查 data-theme 属性
      this.isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    }
  }
};
</script>

<style scoped>
/* ============================================================
   全局搜索（Ctrl+K）：系统浮层面板配方
   --surface-elevated + --glass-blur-thick + --radius-2xl + --shadow-xl
   深浅主题由令牌随 data-theme 自动跟随，不再手写 is-dark 覆写副本
   ============================================================ */
.global-search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: var(--glass-blur-thin);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  animation: gs-fade-in 0.18s ease-out;
}

@keyframes gs-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.global-search-modal {
  width: 90%;
  max-width: 640px;
  max-height: 70vh;
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: gs-slide-in 0.22s var(--motion-spring-snappy, cubic-bezier(0.32, 1.28, 0.5, 1));
}

@keyframes gs-slide-in {
  from { opacity: 0; transform: translateY(-20px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* ========== 搜索框 ========== */
.search-input-wrap {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
}

.search-icon {
  font-size: 18px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-size-md);
  color: var(--text-primary);
  font-family: inherit;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* iOS systemFill：无对应令牌，全站统一使用该字面量（与 Settings 一致） */
.clear-btn {
  border: none;
  background: rgba(120, 120, 128, 0.12);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption2);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.clear-btn:hover {
  background: rgba(120, 120, 128, 0.2);
  transform: scale(1.08);
}

.esc-hint {
  font-size: var(--font-size-caption2);
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-secondary);
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}

/* ========== 搜索主体 ========== */
.search-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

/* ========== 最近搜索 ========== */
.recent-section {
  padding: 8px 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  margin-bottom: 4px;
}

.section-title {
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.clear-recent-btn {
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: var(--font-size-caption1);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  transition: background var(--duration-fast) var(--ease-standard);
}

.clear-recent-btn:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  text-align: left;
  width: 100%;
  transition: background var(--duration-fast) var(--ease-standard);
}

.recent-item.active,
.recent-item:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.recent-icon {
  color: var(--text-secondary);
  font-size: var(--font-size-footnote);
  width: 16px;
  text-align: center;
}

.recent-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 搜索结果 ========== */
.results-section {
  padding: 8px 12px;
}

.result-group {
  margin-bottom: 8px;
}

.group-header {
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 8px 4px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
  text-align: left;
  width: 100%;
  transition: background var(--duration-fast) var(--ease-standard);
}

.result-item.active,
.result-item:hover {
  background: rgba(var(--primary-rgb), 0.1);
}

.result-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: rgba(120, 120, 128, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.result-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

.result-icon-fa {
  font-size: var(--font-size-footnote);
  color: var(--text-tertiary);
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-desc {
  font-size: var(--font-size-caption1);
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 空状态 ========== */
.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 20px;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.hint-icon {
  font-size: 32px;
  opacity: 0.5;
}

/* ========== 底部 ========== */
.search-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  border-top: 1px solid var(--border-color);
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
}

.footer-hint {
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-hint kbd {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: rgba(120, 120, 128, 0.12);
  font-family: ui-monospace, monospace;
  font-size: var(--font-size-caption2);
  margin: 0 2px;
}

.footer-count {
  font-weight: var(--font-weight-medium);
}

/* ========== 滚动条：中性灰，深浅主题通用 ========== */
.search-body::-webkit-scrollbar {
  width: 6px;
}

.search-body::-webkit-scrollbar-thumb {
  background: rgba(120, 120, 128, 0.35);
  border-radius: var(--radius-xs);
}

.search-body::-webkit-scrollbar-track {
  background: transparent;
}
</style>
