<template>
  <div class="browser-page">
    <!-- 顶部工具栏：返回 + 地址栏 + 转到 + 收藏 -->
    <div class="browser-toolbar">
      <button class="browser-btn" @click="goBack" title="返回">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <div class="browser-url-wrap">
        <i class="fa-solid fa-globe browser-url-icon"></i>
        <input
          ref="urlInput"
          v-model="urlText"
          class="browser-url-input"
          placeholder="输入网址或搜索..."
          @keydown.enter="navigateTo(urlText)"
        />
        <button v-if="urlText" class="browser-url-clear" @click="urlText = ''">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <button class="browser-btn browser-go-btn" @click="navigateTo(urlText)" :disabled="!urlText.trim()" title="转到">
        <i class="fa-solid fa-arrow-right"></i>
      </button>
      <button class="browser-btn browser-bookmark-btn" :class="{ bookmarked: isBookmarked }" @click="toggleBookmark" title="收藏">
        <i :class="isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
      </button>
    </div>

    <!-- 主内容区 -->
    <div v-if="currentUrl" class="browser-content">
      <!-- 正在浏览：iframe -->
      <iframe
        ref="browserFrame"
        :src="currentUrl"
        class="browser-iframe"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>
    <div v-else class="browser-home">
      <!-- 首页：历史 + 书签 -->
      <div class="browser-tabs">
        <button class="browser-tab" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">
          <i class="fa-solid fa-clock"></i> 历史
        </button>
        <button class="browser-tab" :class="{ active: activeTab === 'bookmarks' }" @click="activeTab = 'bookmarks'">
          <i class="fa-solid fa-star"></i> 书签
        </button>
      </div>
      <div class="browser-list">
        <!-- 历史记录列表 -->
        <div v-if="activeTab === 'history'" class="browser-list-content">
          <div v-if="history.length === 0" class="browser-empty">
            <i class="fa-solid fa-clock"></i>
            <span>暂无浏览记录</span>
          </div>
          <div
            v-for="(item, idx) in history"
            :key="'h-' + idx"
            class="browser-list-item"
            @click="navigateTo(item.url)"
          >
            <div class="browser-item-icon">
              <i class="fa-solid fa-globe"></i>
            </div>
            <div class="browser-item-info">
              <div class="browser-item-title">{{ item.title || item.url }}</div>
              <div class="browser-item-url">{{ item.url }}</div>
            </div>
            <button class="browser-item-del" @click.stop="removeHistory(idx)" title="删除">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <button v-if="history.length > 0" class="browser-clear-btn" @click="clearHistory">清空历史记录</button>
        </div>
        <!-- 书签列表 -->
        <div v-if="activeTab === 'bookmarks'" class="browser-list-content">
          <div v-if="bookmarks.length === 0" class="browser-empty">
            <i class="fa-regular fa-star"></i>
            <span>暂无书签，浏览网页时点击 ☆ 收藏</span>
          </div>
          <div
            v-for="(item, idx) in bookmarks"
            :key="'b-' + idx"
            class="browser-list-item"
            @click="navigateTo(item.url)"
          >
            <div class="browser-item-icon browser-item-icon--star">
              <i class="fa-solid fa-star"></i>
            </div>
            <div class="browser-item-info">
              <div class="browser-item-title">{{ item.title || item.url }}</div>
              <div class="browser-item-url">{{ item.url }}</div>
            </div>
            <button class="browser-item-del" @click.stop="removeBookmark(idx)" title="取消收藏">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
var HISTORY_KEY = 'browser_history';
var BOOKMARKS_KEY = 'browser_bookmarks';
var MAX_HISTORY = 100;

function loadFromStorage(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {}
}

export default {
  name: 'Browser',
  data: function() {
    return {
      currentUrl: '',
      urlText: '',
      activeTab: 'history',
      history: [],
      bookmarks: []
    };
  },
  computed: {
    isBookmarked: function() {
      var self = this;
      if (!self.currentUrl) return false;
      return self.bookmarks.some(function(b) { return b.url === self.currentUrl; });
    }
  },
  created: function() {
    var self = this;
    self.history = loadFromStorage(HISTORY_KEY);
    self.bookmarks = loadFromStorage(BOOKMARKS_KEY);
    var url = self.$route.query.url || '';
    if (url) {
      self.navigateTo(url);
    }
  },
  methods: {
    navigateTo: function(url) {
      var self = this;
      var raw = (url || '').trim();
      if (!raw) return;
      // 自动补全 https://
      if (!/^https?:\/\//i.test(raw)) {
        raw = 'https://' + raw;
      }
      self.currentUrl = raw;
      self.urlText = raw;
      // 添加到历史记录
      self.addHistory(raw);
      // 聚焦输入框
      self.$nextTick(function() {
        if (self.$refs.urlInput) self.$refs.urlInput.blur();
      });
    },
    addHistory: function(url) {
      var self = this;
      // 去重：移除已存在的相同 URL
      self.history = self.history.filter(function(h) { return h.url !== url; });
      self.history.unshift({ url: url, title: '', time: Date.now() });
      if (self.history.length > MAX_HISTORY) self.history = self.history.slice(0, MAX_HISTORY);
      saveToStorage(HISTORY_KEY, self.history);
    },
    removeHistory: function(idx) {
      this.history.splice(idx, 1);
      saveToStorage(HISTORY_KEY, this.history);
    },
    clearHistory: function() {
      this.history = [];
      saveToStorage(HISTORY_KEY, []);
    },
    toggleBookmark: function() {
      var self = this;
      if (!self.currentUrl) return;
      var idx = -1;
      for (var i = 0; i < self.bookmarks.length; i++) {
        if (self.bookmarks[i].url === self.currentUrl) { idx = i; break; }
      }
      if (idx > -1) {
        self.bookmarks.splice(idx, 1);
      } else {
        self.bookmarks.unshift({ url: self.currentUrl, title: '', time: Date.now() });
      }
      saveToStorage(BOOKMARKS_KEY, self.bookmarks);
    },
    removeBookmark: function(idx) {
      this.bookmarks.splice(idx, 1);
      saveToStorage(BOOKMARKS_KEY, this.bookmarks);
    },
    stopBrowsing: function() {
      this.currentUrl = '';
      this.activeTab = 'history';
    },
    goBack: function() {
      if (this.currentUrl) {
        this.stopBrowsing();
      } else {
        this.$router.push({ name: 'Desktop' }).catch(function() {});
      }
    }
  }
};
</script>

<style scoped>
/* ========== 页面容器 ========== */
.browser-page {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  z-index: 9999;
}

/* ========== 顶部工具栏 ========== */
.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--nav-bg);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  height: 48px;
}

.browser-btn {
  width: 36px; height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--primary-color);
  cursor: pointer;
  flex-shrink: 0;
  border: none;
  background: transparent;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}
.browser-btn:hover { background: var(--primary-light); }
.browser-btn:active { transform: scale(0.92); opacity: 0.7; }
.browser-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.browser-go-btn {
  background: var(--primary-color);
  color: #fff;
  width: 34px; height: 34px;
  border-radius: var(--radius-pill);
  font-size: 13px;
}
.browser-go-btn:hover { background: var(--primary-hover); opacity: 1; }

.browser-bookmark-btn { margin-left: auto; color: var(--text-tertiary); font-size: 15px; }
.browser-bookmark-btn.bookmarked { color: #f59e0b; }

/* URL 输入框 */
.browser-url-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-color);
  padding: 0 12px;
  border-radius: var(--radius-pill);
  height: 36px;
  min-width: 0;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}
.browser-url-wrap:focus-within { border-color: var(--primary-color); }

.browser-url-icon {
  color: var(--text-tertiary);
  font-size: 13px;
  flex-shrink: 0;
}
.browser-url-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}
.browser-url-input::placeholder { color: var(--text-tertiary); font-size: 13px; }
.browser-url-clear {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: var(--text-tertiary);
  color: #fff;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s;
}
.browser-url-clear:hover { opacity: 0.8; }

/* ========== 浏览区 (iframe) ========== */
.browser-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.browser-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--card-bg);
}

/* ========== 首页 ========== */
.browser-home {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.browser-tabs {
  display: flex;
  gap: 0;
  padding: 0 16px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}
.browser-tab {
  padding: 12px 20px;
  font-size: 14px;
  color: var(--text-secondary);
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.browser-tab:hover { color: var(--text-primary); }
.browser-tab.active { color: var(--primary-color); border-bottom-color: var(--primary-color); }
.browser-tab i { font-size: 13px; }

/* ========== 列表区 ========== */
.browser-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.browser-list-content {
  padding: 8px 0;
}

.browser-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 24px;
  color: var(--text-tertiary);
  font-size: 14px;
}
.browser-empty i { font-size: 36px; opacity: 0.4; }

.browser-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.1s;
  border-radius: 0;
}
.browser-list-item:hover { background: var(--bg-color); }
.browser-list-item:active { opacity: 0.7; }

.browser-item-icon {
  width: 36px; height: 36px;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.browser-item-icon--star { background: rgba(245,158,11,0.1); color: #f59e0b; }

.browser-item-info {
  flex: 1;
  min-width: 0;
}
.browser-item-title {
  font-size: 14px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browser-item-url {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.browser-item-del {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.browser-item-del:hover { background: var(--bg-color); color: #ef4444; }

.browser-clear-btn {
  display: block;
  width: calc(100% - 32px);
  margin: 12px 16px;
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.browser-clear-btn:hover { color: #ef4444; border-color: #ef4444; }
</style>
