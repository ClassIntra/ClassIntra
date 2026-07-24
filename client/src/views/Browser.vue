<template>
  <div class="browser-page" :class="{ 'browser-fullscreen': isFullscreen }">
    <!-- iPadOS 顶部工具栏：毛玻璃 + 44pt 高度 + capsule 地址栏 + 图标按钮 -->
    <div v-if="!isFullscreen" class="browser-toolbar">
      <button class="icon-btn browser-btn" @click="goBack" title="返回" aria-label="返回">
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
        <button v-if="urlText" class="browser-url-clear" @click="urlText = ''" aria-label="清除">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <button v-if="!hideAddressBar" class="capsule-btn browser-go-btn" @click="navigateTo(urlText)" :disabled="!urlText.trim()" title="转到">
        <i class="fa-solid fa-arrow-right"></i>
      </button>
      <button v-if="!hideAddressBar" class="icon-btn browser-btn browser-bookmark-btn" :class="{ bookmarked: isBookmarked }" @click="toggleBookmark" title="收藏" aria-label="收藏">
        <i :class="isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
      </button>
      <button v-if="currentUrl" class="icon-btn browser-btn browser-share-btn" :class="{ active: showShareCapsule }" @click="toggleShareCapsule" title="分享" aria-label="分享">
        <i class="fa-solid fa-share-nodes"></i>
      </button>
      <button class="icon-btn browser-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'" :aria-label="isFullscreen ? '退出全屏' : '全屏'">
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
          <button v-if="homepage" class="icon-btn icon-btn--sm homepage-btn" @click="navigateTo(homepage)" title="打开首页" aria-label="打开首页">
            <i class="fa-solid fa-play"></i>
          </button>
          <button class="icon-btn icon-btn--sm homepage-btn" @click="showHomepageInput = !showHomepageInput" :title="homepage ? '修改首页' : '设置首页'" :aria-label="homepage ? '修改首页' : '设置首页'">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button v-if="homepage" class="icon-btn icon-btn--sm icon-btn--danger homepage-btn" @click="clearHomepage" title="清除首页" aria-label="清除首页">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div v-if="showHomepageInput" class="homepage-input-row">
        <input
          ref="homepageInput"
          v-model="homepageDraft"
          class="ios-input homepage-input"
          placeholder="输入首页网址，如 https://baidu.com"
          @keydown.enter="saveHomepage"
          @keydown.escape="showHomepageInput = false"
        />
        <button class="capsule-btn homepage-save-btn" @click="saveHomepage">保存</button>
      </div>

      <!-- 首页：历史 + 书签（iPadOS Segmented Control 风格） -->
      <div class="browser-tabs">
        <div class="segmented-control browser-segmented">
          <button class="segmented-control-item" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">
            <i class="fa-solid fa-clock"></i>
            <span>历史</span>
          </button>
          <button class="segmented-control-item" :class="{ active: activeTab === 'bookmarks' }" @click="activeTab = 'bookmarks'">
            <i class="fa-solid fa-star"></i>
            <span>书签</span>
          </button>
        </div>
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
            class="browser-list-item pressable"
            @click="navigateTo(item.url)"
          >
            <div class="browser-item-icon">
              <i class="fa-solid fa-globe"></i>
            </div>
            <div class="browser-item-info">
              <div class="browser-item-title">{{ item.title || item.url }}</div>
              <div class="browser-item-url">{{ item.url }}</div>
            </div>
            <button class="browser-item-del icon-btn icon-btn--sm icon-btn--danger" @click.stop="removeHistory(idx)" title="删除" aria-label="删除">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <button v-if="history.length > 0" class="browser-clear-btn capsule-btn" @click="clearHistory">清空历史记录</button>
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
            class="browser-list-item pressable"
            @click="navigateTo(item.url)"
          >
            <div class="browser-item-icon browser-item-icon--star">
              <i class="fa-solid fa-star"></i>
            </div>
            <div class="browser-item-info">
              <div class="browser-item-title">{{ item.title || item.url }}</div>
              <div class="browser-item-url">{{ item.url }}</div>
            </div>
            <button class="browser-item-del icon-btn icon-btn--sm icon-btn--danger" @click.stop="removeBookmark(idx)" title="取消收藏" aria-label="取消收藏">
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
import { mountBridge, unmountBridge, getCurrentBridge, ACTIONS_CHILD_TO_PARENT } from '@/integrations/campusbili-bridge-client';

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
    // 卸载桥接实例，移除 message 监听
    unmountBridge();
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
    // ===== CampusBili 桥接：通过插件桥接模块统一收发消息 =====
    // iframe 加载完成时挂载桥接实例并注册订阅
    // 身份注入 + request-mute + 握手（HELLO/WELCOME/READY）+ PING 兜底均由桥接内部完成
    onIframeLoad: function() {
      var self = this;
      var frame = self.$refs.browserFrame;
      if (!frame || !frame.contentWindow) return;
      var user = self.$store && self.$store.state && self.$store.state.auth && self.$store.state.auth.user;
      // 同源时读取 iframe 页面标题（跨域会抛异常，退化为空）
      try {
        self.pageTitle = (frame.contentDocument && frame.contentDocument.title) || '';
      } catch (e) {
        self.pageTitle = '';
      }
      // 挂载桥接实例（v1.1 起握手流程驱动身份注入，无需手动调用）
      var bridge = mountBridge(frame, { user: user });
      // 订阅子端上报事件（替代旧 onAction 单回调）
      bridge.on(ACTIONS_CHILD_TO_PARENT.BACK, function() {
        self.$router.push({ name: 'Desktop' }).catch(function() {});
      });
      bridge.on(ACTIONS_CHILD_TO_PARENT.SHARE_REQUEST, function(payload) {
        if (payload) islandNotify.showShareCapsule(payload);
      });
      bridge.on(ACTIONS_CHILD_TO_PARENT.PLAYBACK_STATUS, function(payload) {
        if (!payload) return;
        if (payload.ended) islandNotify.hideVideoIsland();
        else islandNotify.showVideoIsland(payload);
      });
      bridge.on(ACTIONS_CHILD_TO_PARENT.PAGE_INFO, function(payload) {
        if (payload && payload.title) self.pageTitle = payload.title;
      });
      // 用户体验：监听桥接错误，通过超能岛给用户友好反馈（避免静默失败）
      bridge.on('error', function(err) {
        var msg = (err && err.message) ? err.message : '未知错误';
        // 避免同源/跨域噪音：仅桥接协议相关错误上岛
        if (msg.indexOf('通道') !== -1 || msg.indexOf('握手') !== -1 || msg.indexOf('版本') !== -1) {
          islandNotify.notify({
            icon: 'fa-solid fa-triangle-exclamation',
            color: 'rgba(255, 159, 10, 0.25)',
            title: '联动异常',
            text: msg,
            type: 'system',
            category: 'bridge',
            priority: 'high'
          });
        }
        // 同时写入控制台，方便开发者排查
        console.warn('[campusbili-bridge] error:', msg, bridge.getDebugInfo ? bridge.getDebugInfo() : '');
      });
      bridge.on('ready', function() {
        // 握手成功：可在此触发 UI 反馈（当前保持静默，避免噪音）
      });
    },
    // 向 iframe 下发视频控制指令（超能岛 → Browser → 桥接 → iframe → CampusBili）
    sendToIframe: function(action, payload) {
      var bridge = getCurrentBridge();
      if (!bridge) return;
      // 仅支持 video-control（其他动作由桥接内部封装）
      if (action === 'video-control' && payload) {
        bridge.sendVideoControl(payload.command, payload.value);
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

/* ========== iPadOS 顶部工具栏（毛玻璃 + 44pt 高度 + 0.5px 分隔） ========== */
.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 6px;
  background: var(--nav-bg);
  -webkit-backdrop-filter: var(--glass-blur-nav);
  backdrop-filter: var(--glass-blur-nav);
  border-bottom: 0.5px solid var(--nav-border);
  flex-shrink: 0;
  min-height: 52px;  /* 44pt 内容 + 上下 padding */
}

/* 浏览器内 .browser-btn 复用全局 .icon-btn：仅在此处覆盖浏览器特定样式 */
.browser-btn {
  /* toolbar 内按钮密度更紧（toolbar 高度有限），用 --sm 尺寸 */
  width: 36px;
  height: 36px;
  font-size: 15px;
}
.browser-btn:active {
  transform: scale(0.94);  /* emil-design：图标按钮按压至 0.94-0.95 */
}

/* 转到按钮：胶囊形主色按钮（capsule-btn 已处理大部分样式，仅覆盖尺寸） */
.browser-go-btn {
  width: 36px;
  height: 32px;
  padding: 0;
  font-size: 13px;
}

/* 收藏按钮 */
.browser-bookmark-btn {
  margin-left: auto;  /* 推到右侧 */
  color: var(--text-tertiary);
}
.browser-bookmark-btn.bookmarked {
  color: var(--warning, #FF9500);
}

/* 分享按钮 */
.browser-share-btn {
  color: var(--text-tertiary);
}
.browser-share-btn.active {
  color: var(--primary-color);
  background: var(--primary-light);
}

/* ========== 地址栏（capsule + focus 光晕） ========== */
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
  transition: border-color 0.18s var(--ease-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              box-shadow 0.2s var(--ease-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              background-color 0.15s var(--ease-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}
.browser-url-wrap:focus-within {
  border-color: var(--primary-color);
  background: var(--card-bg);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb, 0, 122, 255), 0.12);
}

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
  font-feature-settings: 'tnum';  /* URL 等宽数字观感 */
}
.browser-url-input::placeholder {
  color: var(--text-tertiary);
  font-size: 13px;
}
.browser-url-clear {
  width: 20px;
  height: 20px;
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
  transition: opacity 0.15s var(--ease-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              transform 0.16s var(--ease-emphasized);
}
.browser-url-clear:hover {
  opacity: 0.8;
  transform: scale(1.05);
}
.browser-url-clear:active {
  transform: scale(0.9);
  transition-duration: 0.08s;
}

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

/* Segmented Control 容器 */
.browser-tabs {
  display: flex;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 0.5px solid var(--separator-color);
}
.browser-segmented {
  width: 100%;
  justify-content: stretch;
}
.browser-segmented .segmented-control-item {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.browser-segmented .segmented-control-item i {
  font-size: 13px;
}

/* ========== 列表区 ========== */
.browser-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 12px;
}
.browser-list-content {
  padding: 4px 0;
}

.browser-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 24px;
  color: var(--text-tertiary);
  font-size: 14px;
}
.browser-empty i {
  font-size: 40px;
  opacity: 0.35;
}

/* 列表项：iPadOS list 风格（毛玻璃卡片分组 + 0.5px 内分隔 + 圆角） */
.browser-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px var(--spacing-md);
  cursor: pointer;
  background: var(--card-bg);
  border-bottom: 0.5px solid var(--separator-color);
}
.browser-list-item:first-child {
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}
.browser-list-item:last-child {
  border-bottom: none;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}
.browser-list-item:only-child {
  border-radius: var(--radius-md);
}
.browser-list-item:hover {
  background: var(--bg-color);
}
.browser-list-item:active {
  /* .pressable 已处理 scale(0.97)，此处仅强调背景 */
  background: var(--primary-lighter);
}

.browser-item-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.browser-item-icon--star {
  background: rgba(255, 149, 0, 0.12);
  color: var(--warning, #FF9500);
}

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
  font-weight: var(--font-weight-medium, 500);
}
.browser-item-url {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  font-feature-settings: 'tnum';
}
.browser-item-del {
  /* 复用全局 .icon-btn.icon-btn--sm，此处仅覆盖大小 */
  width: 28px;
  height: 28px;
  font-size: 11px;
  margin-right: -4px;  /* 视觉对齐右侧 */
}

.browser-clear-btn {
  display: block;
  width: calc(100% - 24px);
  margin: 16px auto 8px;
  padding: 0 14px;
  height: 36px;
  background: transparent;
  color: var(--danger, #FF3B30);
  border: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: var(--font-weight-medium, 500);
}
.browser-clear-btn:hover {
  background: rgba(255, 59, 48, 0.06);
  border-color: var(--danger, #FF3B30);
}

/* ========== 首页设置栏 ========== */
.browser-homepage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
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
  font-feature-settings: 'tnum';
}
.homepage-hint {
  font-size: 13px;
  color: var(--text-tertiary);
}
.homepage-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  margin-left: 8px;
}
.homepage-btn {
  width: 30px;
  height: 30px;
  font-size: 12px;
}

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
  border-radius: var(--radius-md);
  font-size: 13px;
  min-width: 0;
}
.homepage-save-btn {
  white-space: nowrap;
  height: 36px;
  padding: 0 16px;
}

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

/* ========== 分享胶囊（iPadOS Sheet 风格） ========== */
.share-capsule {
  position: fixed;
  top: 52px;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: 340px;
  background: rgba(0, 0, 0, 0.25);
  z-index: 9998;
  -webkit-backdrop-filter: blur(4px) saturate(150%);
  backdrop-filter: blur(4px) saturate(150%);
}

.capsule-inner {
  margin: 12px;
  padding: 16px;
  background: var(--surface-elevated, var(--card-bg));
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.12);
  animation: capsule-pop 0.32s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  transform-origin: top right;
}

@keyframes capsule-pop {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.95);  /* emil-design: never from scale(0)，从 0.95 起步 */
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
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
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-feature-settings: 'tnum';
}

.capsule-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 分享胶囊内的动作按钮（覆盖全局 .capsule-btn 的主色，使用各自语义色） */
.capsule-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  height: auto;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: var(--font-weight-medium, 500);
  color: #fff;
  box-shadow: none;
}
.capsule-btn:hover {
  transform: none;  /* 分享按钮是动作按钮，不需要 lift 效果 */
  box-shadow: none;
}
.capsule-btn:active {
  transform: scale(0.97);
  opacity: 0.85;
  transition-duration: 0.08s;
}
.capsule-btn i {
  font-size: 15px;
}

.capsule-to-chat {
  background: var(--primary-color);
}
.capsule-to-chat:hover {
  background: var(--primary-hover);
}
.capsule-to-community {
  background: var(--success, #34C759);
}
.capsule-to-community:hover {
  background: var(--success-color);
  opacity: 1;
}

/* 胶囊入场过渡（v-if 切换） */
.capsule-slide-enter-active,
.capsule-slide-leave-active {
  transition: opacity 0.22s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1));
}
.capsule-slide-enter,
.capsule-slide-leave-to {
  opacity: 0;
}

/* ========== Reduced motion 降级 ========== */
@media (prefers-reduced-motion: reduce) {
  .capsule-inner {
    animation-duration: 0.01ms !important;
  }
  .capsule-slide-enter-active,
  .capsule-slide-leave-active {
    transition-duration: 0.01ms !important;
  }
  .browser-url-clear:hover,
  .browser-url-clear:active,
  .browser-btn:active,
  .browser-list-item:active,
  .capsule-btn:active {
    transform: none !important;
  }
}

/* ========== 触摸设备 hover 降级（避免悬停残留） ========== */
@media (hover: none) {
  .browser-list-item:hover {
    background: var(--card-bg);
  }
  .browser-url-clear:hover {
    transform: none;
    opacity: 0.5;
  }
  .browser-clear-btn:hover {
    background: transparent;
    border-color: var(--border-color);
  }
  .capsule-to-chat:hover,
  .capsule-to-community:hover {
    transform: none;
  }
}
</style>
