<template>
  <div class="browser-page" :class="{ 'browser-fullscreen': isFullscreen }">
    <!-- 顶部工具栏：返回 + 地址栏 + 转到 + 收藏 + 全屏 -->
    <div v-if="!isFullscreen" class="browser-toolbar">
      <button class="browser-btn" @click="goBack" title="返回">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <div v-if="!hideAddressBar" class="browser-url-wrap">
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
      <button v-if="!hideAddressBar" class="browser-btn browser-go-btn" @click="navigateTo(urlText)" :disabled="!urlText.trim()" title="转到">
        <i class="fa-solid fa-arrow-right"></i>
      </button>
      <button v-if="!hideAddressBar" class="browser-btn browser-bookmark-btn" :class="{ bookmarked: isBookmarked }" @click="toggleBookmark" title="收藏">
        <i :class="isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
      </button>
      <button v-if="currentUrl" class="browser-btn browser-share-btn" :class="{ active: showShareCapsule }" @click="toggleShareCapsule" title="分享">
        <i class="fa-solid fa-share-nodes"></i>
      </button>
      <button class="browser-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
        <i :class="isFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
      </button>
    </div>

    <!-- 分享胶囊：快捷分享当前链接到聊天/社区 -->
    <transition name="capsule-slide">
      <div v-if="showShareCapsule && currentUrl" class="share-capsule" @click.self="showShareCapsule = false">
        <div class="capsule-inner">
          <div class="capsule-url" :title="currentUrl">{{ currentUrl }}</div>
          <div class="capsule-actions">
            <button class="capsule-btn capsule-to-chat" @click="shareToChat">
              <i class="fa-solid fa-comment-dots"></i>
              <span>分享到聊天</span>
            </button>
            <button class="capsule-btn capsule-to-community" @click="shareToCommunity">
              <i class="fa-solid fa-users"></i>
              <span>分享到社区</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 主内容区 -->
    <div v-if="currentUrl" class="browser-content">
      <!-- 正在浏览：iframe -->
      <iframe
        ref="browserFrame"
        :src="currentUrl"
        class="browser-iframe"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        @load="onIframeLoad"
      ></iframe>
    </div>
    <div v-else class="browser-home">
      <!-- 首页设置区 -->
      <div class="browser-homepage-bar">
        <div class="homepage-left">
          <i class="fa-solid fa-house"></i>
          <span v-if="homepage" class="homepage-url">{{ homepage }}</span>
          <span v-else class="homepage-hint">未设置首页</span>
        </div>
        <div class="homepage-actions">
          <button v-if="homepage" class="homepage-btn" @click="navigateTo(homepage)" title="打开首页">
            <i class="fa-solid fa-play"></i>
          </button>
          <button class="homepage-btn" @click="showHomepageInput = !showHomepageInput" :title="homepage ? '修改首页' : '设置首页'">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button v-if="homepage" class="homepage-btn homepage-btn--del" @click="clearHomepage" title="清除首页">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div v-if="showHomepageInput" class="homepage-input-row">
        <input
          ref="homepageInput"
          v-model="homepageDraft"
          class="homepage-input"
          placeholder="输入首页网址，如 https://baidu.com"
          @keydown.enter="saveHomepage"
          @keydown.escape="showHomepageInput = false"
        />
        <button class="homepage-save-btn" @click="saveHomepage">保存</button>
      </div>

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
import islandNotify from '@/utils/island-notify';

var HISTORY_KEY = 'browser_history';
var BOOKMARKS_KEY = 'browser_bookmarks';
var HOMEPAGE_KEY = 'browser_homepage';
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
      bookmarks: [],
      homepage: '',
      homepageDraft: '',
      showHomepageInput: false,
      isFullscreen: false,
      showShareCapsule: false,
      // 当前 iframe 页面标题（同源时可读取，跨域时为空）
      pageTitle: '',
      // 移动端边缘滑动手势状态（左边缘右滑返回）
      swipeState: null
    };
  },
  computed: {
    isBookmarked: function() {
      var self = this;
      if (!self.currentUrl) return false;
      return self.bookmarks.some(function(b) { return b.url === self.currentUrl; });
    },
    // 班管/班干无浏览器权限时隐藏地址栏（仅允许从社区链接进入浏览，不可自由输入网址）
    hideAddressBar: function() {
      return !!(this.$route && this.$route.query && this.$route.query.noaddr === '1');
    }
  },
  watch: {
    showHomepageInput: function(val) {
      if (val) {
        var self = this;
        self.homepageDraft = self.homepage;
        self.$nextTick(function() {
          if (self.$refs.homepageInput) self.$refs.homepageInput.focus();
        });
      }
    }
  },
  created: function() {
    var self = this;
    self.history = loadFromStorage(HISTORY_KEY);
    self.bookmarks = loadFromStorage(BOOKMARKS_KEY);
    self.homepage = localStorage.getItem(HOMEPAGE_KEY) || '';
    var url = self.$route.query.url || '';
    if (url) {
      self.navigateTo(url);
      // 通过超链接（聊天/社区）打开时隐藏地址栏
      if (self.$route.query.fullscreen === '1') {
        self.isFullscreen = true;
      }
    } else if (self.homepage) {
      self.navigateTo(self.homepage);
    }
  },
  mounted: function() {
    var self = this;
    // 监听子站点的 postMessage，支持"返回 ClassIntra"等桥接动作
    self._messageHandler = function(event) {
      var frame = self.$refs.browserFrame;
      // 仅处理来自当前 iframe 的消息，避免恶意页面伪造
      if (!frame || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      // 子站点请求返回 ClassIntra（如 campusbili 左上角返回按钮）
      // 直接退出浏览器回到桌面，而非 router.back()（避免返回到 campusbili 内部历史）
      if (data.action === 'classintra-back') {
        self.$router.push({ name: 'Desktop' }).catch(function() {});
      }
      // 子站点主动询问身份（解决时序问题：mounted 可能错过了 load 时的消息）
      if (data.action === 'classintra-ping') {
        self.onIframeLoad();
      }
      // CampusBili 分享请求：转发到超能岛，触发分享胶囊
      if (data.action === 'campusbili-share-request' && data.payload) {
        islandNotify.showShareCapsule(data.payload);
      }
      // CampusBili 视频播放状态同步：转发到超能岛，展示视频岛
      if (data.action === 'campusbili-playback-status' && data.payload) {
        if (data.payload.ended) {
          islandNotify.hideVideoIsland();
        } else {
          islandNotify.showVideoIsland(data.payload);
        }
      }
    };
    window.addEventListener('message', self._messageHandler);
    // 移动端边缘滑动手势（passive 不阻止 iframe 内部滚动）
    self._onSwipeStart = self.onSwipeStart.bind(self);
    self._onSwipeMove = self.onSwipeMove.bind(self);
    self._onSwipeEnd = self.onSwipeEnd.bind(self);
    document.addEventListener('touchstart', self._onSwipeStart, { passive: true });
    document.addEventListener('touchmove', self._onSwipeMove, { passive: true });
    document.addEventListener('touchend', self._onSwipeEnd, { passive: true });
    // 注册 browserRef，让超能岛可通过 island-notify 下发指令到 iframe
    islandNotify.setBrowserRef(self);
  },
  beforeDestroy: function() {
    islandNotify.setBrowserRef(null);
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    if (this._onSwipeStart) {
      document.removeEventListener('touchstart', this._onSwipeStart);
      document.removeEventListener('touchmove', this._onSwipeMove);
      document.removeEventListener('touchend', this._onSwipeEnd);
      this._onSwipeStart = null;
      this._onSwipeMove = null;
      this._onSwipeEnd = null;
    }
  },
  methods: {
    // 向 iframe 子站点下发指令（超能岛 → Browser → iframe → CampusBili）
    // action: 指令名称（如 'video-control'），payload: 指令数据
    sendToIframe: function(action, payload) {
      var frame = this.$refs.browserFrame;
      if (!frame || !frame.contentWindow) return;
      var origin = this._getFrameOrigin();
      try {
        frame.contentWindow.postMessage({
          source: 'classintra-browser',
          action: action,
          payload: payload,
          timestamp: Date.now()
        }, origin);
      } catch (e) {}
    },
    // iframe 加载完成：向子站点注入 ClassIntra 用户身份标识（插件可据此辨认 ClassIntra 环境）
    // 同时发送 request-mute 指令：请求子站点（如 CampusBili）默认静音视频播放器
    // 子站点需监听 source==='classintra-browser' 且 action==='request-mute' 并静音 video 元素
    onIframeLoad: function() {
      var self = this;
      var frame = self.$refs.browserFrame;
      if (!frame || !frame.contentWindow) return;
      var user = self.$store && self.$store.state && self.$store.state.auth && self.$store.state.auth.user;
      var origin = self._getFrameOrigin();
      // 同源时读取 iframe 页面标题（跨域会抛异常，退化为空）
      try {
        self.pageTitle = (frame.contentDocument && frame.contentDocument.title) || '';
      } catch (e) {
        self.pageTitle = '';
      }
      try {
        // 请求子站点默认静音视频（campusbili 等视频站点应监听此指令）
        frame.contentWindow.postMessage({ source: 'classintra-browser', action: 'request-mute', timestamp: Date.now() }, origin);
      } catch (e) {}
      if (!user) return;
      var payload = {
        source: 'classintra-browser',
        user: {
          user_id: user.user_id,
          net_name: user.net_name,
          is_admin: user.is_admin,
          role: user.role
        },
        timestamp: Date.now()
      };
      try {
        // targetOrigin 限定为 iframe 当前 URL 的 origin，避免消息泄漏到其他域
        frame.contentWindow.postMessage(payload, origin);
      } catch (e) {}
    },
    // 计算 iframe 的 origin（用于 postMessage targetOrigin）
    _getFrameOrigin: function() {
      try {
        var u = new URL(this.currentUrl);
        return u.origin;
      } catch (e) {
        return '*';
      }
    },
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
    },
    saveHomepage: function() {
      var self = this;
      var url = (self.homepageDraft || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      self.homepage = url;
      localStorage.setItem(HOMEPAGE_KEY, url);
      self.showHomepageInput = false;
    },
    clearHomepage: function() {
      this.homepage = '';
      this.homepageDraft = '';
      localStorage.removeItem(HOMEPAGE_KEY);
      this.showHomepageInput = false;
    },
    toggleFullscreen: function() {
      this.isFullscreen = !this.isFullscreen;
    },
    // ===== 分享胶囊（需求9）：快捷分享当前链接到聊天/社区 =====
    toggleShareCapsule: function() {
      this.showShareCapsule = !this.showShareCapsule;
    },
    // 分享当前链接到聊天：跳转 Chat 页面并预填输入框（用户选择会话后直接发送）
    // 有 pageTitle 时传递 title query，Chat.vue 生成 markdown 链接格式
    shareToChat: function() {
      var url = this.currentUrl;
      var query = { prefill: encodeURIComponent(url) };
      if (this.pageTitle) query.title = encodeURIComponent(this.pageTitle);
      this.showShareCapsule = false;
      this.$router.push({ name: 'Chat', query: query }).catch(function() {});
    },
    // 分享当前链接到社区：跳转 Community 页面并预填帖子内容
    // 有 pageTitle 时传递 title query，Community.vue 生成带标题的富文本帖子
    shareToCommunity: function() {
      var url = this.currentUrl;
      var query = { shareLink: encodeURIComponent(url) };
      if (this.pageTitle) query.title = encodeURIComponent(this.pageTitle);
      this.showShareCapsule = false;
      this.$router.push({ name: 'Community', query: query }).catch(function() {});
    },
    // ===== 移动端边缘滑动手势（需求8）=====
    // 左边缘右滑触发返回；全屏时顶部下滑退出全屏
    // 仅在边缘 24px 内起始才捕获，避免干扰 iframe 内部正常滚动
    onSwipeStart: function(e) {
      if (!e.touches || !e.touches.length) return;
      var t = e.touches[0];
      var startX = t.clientX;
      var startY = t.clientY;
      var fromLeftEdge = startX <= 24;
      var fromTopEdge = this.isFullscreen && startY <= 24;
      if (!fromLeftEdge && !fromTopEdge) return;
      this.swipeState = {
        startX: startX,
        startY: startY,
        fromLeftEdge: fromLeftEdge,
        fromTopEdge: fromTopEdge,
        triggered: false
      };
    },
    onSwipeMove: function(e) {
      if (!this.swipeState || this.swipeState.triggered) return;
      if (!e.touches || !e.touches.length) return;
      var t = e.touches[0];
      var dx = t.clientX - this.swipeState.startX;
      var dy = t.clientY - this.swipeState.startY;
      // 左边缘右滑 > 60px 且横向位移为主 → 返回
      if (this.swipeState.fromLeftEdge && dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.swipeState.triggered = true;
        this.goBack();
      }
      // 全屏时顶部下滑 > 60px 且纵向为主 → 退出全屏
      if (this.swipeState.fromTopEdge && dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        this.swipeState.triggered = true;
        this.isFullscreen = false;
      }
    },
    onSwipeEnd: function() {
      this.swipeState = null;
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
  /* 性能优化：隔离 iframe 渲染层，减少外部重排对视频播放的影响（50 并发场景） */
  contain: strict;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  will-change: transform;
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

/* ========== 首页设置栏 ========== */
.browser-homepage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--bg-color);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}
.homepage-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.homepage-left i {
  color: var(--primary-color);
  font-size: 14px;
  flex-shrink: 0;
}
.homepage-url {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.homepage-hint {
  font-size: 13px;
  color: var(--text-tertiary);
}
.homepage-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}
.homepage-btn {
  width: 30px; height: 30px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.homepage-btn:hover { background: var(--border-color); color: var(--primary-color); }
.homepage-btn--del:hover { color: #ef4444; }

.homepage-input-row {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-color);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}
.homepage-input {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  padding: 6px 12px;
  font-size: 13px;
  background: var(--card-bg);
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}
.homepage-input:focus { border-color: var(--primary-color); }
.homepage-save-btn {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.homepage-save-btn:hover { background: var(--primary-hover); }

/* ========== CSS 全屏模式 ========== */
.browser-fullscreen .browser-content {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 10000;
  background: #000;
}
.browser-fullscreen .browser-iframe {
  width: 100%;
  height: 100%;
}

/* ========== 分享胶囊（需求9）========== */
.browser-share-btn { color: var(--text-tertiary); font-size: 15px; }
.browser-share-btn.active { color: var(--primary-color); background: var(--primary-light); }

.share-capsule {
  position: fixed;
  top: 48px;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: 320px;
  background: rgba(0, 0, 0, 0.25);
  z-index: 9998;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

.capsule-inner {
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  animation: capsule-pop 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes capsule-pop {
  from { opacity: 0; transform: translateY(-8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.capsule-url {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 8px 12px;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
  font-family: -apple-system, sans-serif;
}

.capsule-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capsule-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  transition: -webkit-transform 0.15s, transform 0.15s, opacity 0.15s;
  color: #fff;
  font-weight: 500;
}

.capsule-btn:active { -webkit-transform: scale(0.96); transform: scale(0.96); opacity: 0.85; }
.capsule-btn i { font-size: 15px; }

.capsule-to-chat { background: var(--primary-color); }
.capsule-to-chat:hover { background: var(--primary-hover); }
.capsule-to-community { background: #34c759; }
.capsule-to-community:hover { opacity: 0.9; }

/* 胶囊入场过渡 */
.capsule-slide-enter-active, .capsule-slide-leave-active {
  transition: opacity 0.2s ease;
}
.capsule-slide-enter, .capsule-slide-leave-to {
  opacity: 0;
}</style>
