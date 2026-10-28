<template>
  <div class="browser-page" :class="{ 'browser-fullscreen': isFullscreen }">
    <!-- iPadOS 顶部工具栏：毛玻璃 + 44pt 高度 + capsule 地址栏 + 图标按钮 -->
    <div v-if="!isFullscreen" class="browser-toolbar">
      <button class="icon-btn browser-btn" @click="goBack" title="返回" aria-label="返回">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <!-- 代理状态提示：当前页面经网页代理转发加速时给出明确标识，
           避免用户无法判断代理是否生效（此前提到的「看不出网址有没有变」） -->
      <span
        v-if="isProxied"
        class="browser-proxy-chip"
        title="该页面经网页代理转发：已透传压缩、复用上游连接并支持条件缓存"
      >
        <i class="fa-solid fa-bolt"></i>
        <span>加速</span>
      </span>
      <!-- 兼容模式标识：由服务器端真实浏览器渲染后以画面流回传 -->
      <span
        v-if="compatMode"
        class="browser-proxy-chip browser-compat-chip"
        title="兼容模式：页面由服务器端真实浏览器渲染，可绕过部分站点的脚本挑战"
      >
        <i class="fa-solid fa-shield-halved"></i>
        <span>兼容</span>
      </span>
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
      <button v-if="!hideAddressBar" class="capsule-btn browser-go-btn" @click="onCompatGo" :disabled="!urlText.trim()" :title="compatReloadMode ? '刷新' : '转到'">
        <i :class="compatReloadMode ? 'fa-solid fa-rotate-right' : 'fa-solid fa-arrow-right'"></i>
      </button>
      <button v-if="!hideAddressBar" class="icon-btn browser-btn browser-bookmark-btn" :class="{ bookmarked: isBookmarked }" @click="toggleBookmark" title="收藏" aria-label="收藏">
        <i :class="isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
      </button>
      <button v-if="currentUrl" class="icon-btn browser-btn browser-share-btn" :class="{ active: showShareCapsule }" @click="toggleShareCapsule" title="分享" aria-label="分享">
        <i class="fa-solid fa-share-nodes"></i>
      </button>
      <!-- 兼容模式入口：仅当服务端具备无头渲染能力时出现。
           用于少数被脚本挑战 / WAF 拦截、普通改写无法正常打开的站点 -->
      <button v-if="compatCapable" class="icon-btn browser-btn browser-compat-btn" :class="{ active: compatMode }" @click="toggleCompat" :title="compatMode ? '退出兼容模式' : '兼容模式（真实浏览器渲染，适合被拦截的站点）'" :aria-label="compatMode ? '退出兼容模式' : '兼容模式'">
        <i class="fa-solid fa-shield-halved"></i>
      </button>
      <!-- 兼容模式声音开关：默认关闭。开启后服务端采集页面声音（含 CDN 音源）经通道回传，
           有声音时按钮会轻微脉动，便于确认「确实在出声」 -->
      <button v-if="compatMode" class="icon-btn browser-btn browser-audio-btn" :class="{ active: compatAudio, pulsing: compatAudioActive }" :disabled="!compatAudioSupported" @click="toggleCompatAudio" :title="compatAudioSupported ? (compatAudio ? '关闭声音' : '开启声音') : '当前页面无法采集声音'" :aria-label="compatAudio ? '关闭声音' : '开启声音'" :aria-pressed="compatAudio ? 'true' : 'false'">
        <i :class="compatAudio ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'"></i>
      </button>
      <!-- 云游戏画质：高分辨率 / 高码率 / 恒 60fps，适合串流游戏与视频。
           默认关闭（编码 CPU 与带宽开销明显更大） -->
      <button v-if="compatMode" class="icon-btn browser-btn browser-game-btn" :class="{ active: compatGame }" :disabled="compatGameBusy" @click="toggleCompatGame" :title="compatGame ? '退出云游戏画质' : '云游戏画质（高分辨率 / 高码率 / 60fps）'" :aria-label="compatGame ? '退出云游戏画质' : '云游戏画质'" :aria-pressed="compatGame ? 'true' : 'false'">
        <i class="fa-solid fa-gauge-high"></i>
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
    <div v-if="currentUrl" ref="browserContent" class="browser-content">
      <!-- 兼容模式：服务器端无头浏览器渲染的画面流（canvas 承载，输入回灌） -->
      <canvas
        v-if="compatMode"
        ref="compatCanvas"
        class="browser-iframe browser-compat-canvas"
        tabindex="0"
        @mousemove="onCompatMouseMove"
        @mousedown="onCompatMouseDown"
        @mouseup="onCompatMouseUp"
        @wheel.prevent="onCompatWheel"
        @keydown="onCompatKeyDown"
        @touchstart.prevent="onCompatTouchStart"
        @touchmove.prevent="onCompatTouchMove"
        @touchend.prevent="onCompatTouchEnd"
        @touchcancel.prevent="onCompatTouchCancel"
      ></canvas>
      <!-- 正在浏览：iframe -->
      <iframe
        v-else
        ref="browserFrame"
        :src="frameSrc || currentUrl"
        class="browser-iframe"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        @load="onIframeLoad"
      ></iframe>
      <!-- 兼容模式异常提示：只影响兼容模式，可直接退出回到普通浏览 -->
      <div v-if="compatMode && compatError" class="browser-compat-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>{{ compatError }}</span>
        <button class="capsule-btn browser-compat-exit" @click="exitCompat">退出兼容模式</button>
      </div>
      <!-- 云游戏画质切换回执：点完按钮立刻显示实际编码尺寸 / 帧率，
           避免「点了没反应」的错觉（服务端无响应时也会明确提示） -->
      <div v-if="compatMode && compatGameTip" class="browser-compat-error browser-game-tip">
        <i class="fa-solid fa-gauge-high"></i>
        <span>{{ compatGameTip }}</span>
      </div>
      <!-- 移动端文字输入：画面流无法唤起系统键盘，用悬浮按钮 + 输入条代劳 -->
      <template v-if="compatMode && compatTouch">
        <button
          v-if="!compatKeyboardOpen"
          class="browser-compat-kbd-btn"
          title="输入文字"
          aria-label="输入文字"
          @click="toggleCompatKeyboard"
        >
          <i class="fa-solid fa-keyboard"></i>
        </button>
        <div v-else class="browser-compat-inputbar">
          <input
            ref="compatTextInput"
            v-model="compatText"
            class="browser-compat-text"
            type="text"
            placeholder="输入后发送到网页…"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            @input="onCompatTextInput"
            @keydown="onCompatTextKeydown"
            @compositionstart="onCompatCompositionStart"
            @compositionend="onCompatCompositionEnd"
          />
          <button class="browser-compat-kbd-send" title="发送" aria-label="发送" @click="onCompatTextSend">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="browser-compat-kbd-close" title="收起" aria-label="收起键盘" @click="toggleCompatKeyboard">
            <i class="fa-solid fa-keyboard"></i>
          </button>
        </div>
      </template>
      <!-- 加载指示器：外网站点走代理转发，首次加载需要与目标站点建连，
          期间 iframe 为空白，这里给出进度反馈，避免被误认为「白屏卡死」 -->
      <div v-if="iframeLoading" class="browser-loading">
        <div class="browser-loading-spinner"></div>
        <div class="browser-loading-text">{{ iframeSlow ? '外网站点加载较慢，正在与目标站点建立连接…' : '正在加载…' }}</div>
        <!-- 显示目标站点与已等待秒数：让「慢」可被感知为「仍在进行」，而非卡死 -->
        <div v-if="currentHost" class="browser-loading-host">
          {{ currentHost }}<span v-if="iframeSlow"> · 已等待 {{ loadSeconds }}s</span>
        </div>
      </div>
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
            <span>暂无书签，浏览网页时点击地址栏的星标即可收藏</span>
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
import api from '@/utils/api';
import { mountBridge, unmountBridge, ACTIONS_CHILD_TO_PARENT, CAMPUSBILI_BRIDGE_AVAILABLE } from '@/integrations/campusbili-bridge-client';
import {
  mountBridge as mountWebProxyBridge,
  unmountBridge as unmountWebProxyBridge,
  ACTIONS_CHILD_TO_PARENT as WEB_PROXY_ACTIONS,
  WEB_PROXY_BRIDGE_AVAILABLE
} from '@/integrations/web-proxy-client';

// 旧版本把历史/收藏/主页存在全局键上，同一台设备切换账号后会互相看到记录。
// 现改为按账号命名空间存储；旧数据在首次读取时迁移给当前登录账号后删除旧键。
var LEGACY_HISTORY_KEY = 'browser_history';
var LEGACY_BOOKMARKS_KEY = 'browser_bookmarks';
var LEGACY_HOMEPAGE_KEY = 'browser_homepage';
var MAX_HISTORY = 100;

// 当前账号的存储前缀；未登录时统一落到 guest 命名空间
function browserScope() {
  var user = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { user = null; }
  var uid = user && (user.user_id || user.id);
  return uid ? 'browser:' + uid + ':' : 'browser:guest:';
}

function scopedKey(name) {
  return browserScope() + name;
}

// 旧版全局数据迁移：仅当当前账号还没有对应数据时接管，随后删除旧键，避免继续共享
function migrateLegacyData() {
  var pairs = [
    { legacy: LEGACY_HISTORY_KEY, name: 'history' },
    { legacy: LEGACY_BOOKMARKS_KEY, name: 'bookmarks' }
  ];
  for (var i = 0; i < pairs.length; i++) {
    try {
      var target = scopedKey(pairs[i].name);
      if (localStorage.getItem(target) !== null) continue;
      var raw = localStorage.getItem(pairs[i].legacy);
      if (raw === null) continue;
      localStorage.setItem(target, raw);
      localStorage.removeItem(pairs[i].legacy);
    } catch (e) {}
  }
  try {
    var hpTarget = scopedKey('homepage');
    var hpLegacy = localStorage.getItem(LEGACY_HOMEPAGE_KEY);
    if (localStorage.getItem(hpTarget) === null && hpLegacy !== null) {
      localStorage.setItem(hpTarget, hpLegacy);
      localStorage.removeItem(LEGACY_HOMEPAGE_KEY);
    }
  } catch (e) {}
}

// 读取网页代理状态（由 index.html 预取写入 window.__WEB_PROXY__）
// 插件未安装 / 未就绪 → 返回 null，浏览行为保持不变（直连）
function getWebProxyInfo() {
  var info = (typeof window !== 'undefined' && window.__WEB_PROXY__) || null;
  if (!info || !info.ready || !info.enabled || !info.base) return null;
  return info;
}

// 判断是否局域网 / 本机 / 内网短主机名 —— 这类地址应当直连，不要绕代理。
// 原因：一是局域网地址经代理转发时，实际由服务器所在网络去访问，
// 可能指向学生自己的设备（如 192.168.x 的打印机、投屏）而无法到达；
// 二是直连明显更快，绕一层纯属浪费。
function isLanHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || /\.localhost$/.test(h)) return true;
  // IPv6：环回、链路本地 fe80::、唯一本地 fc00::/7
  if (h === '[::1]' || h === '::1') return true;
  if (/^\[?fe80:/i.test(h) || /^\[?f[cd][0-9a-f]{2}:/i.test(h)) return true;
  // 单标签主机名（无点）通常是内网主机名，如 nas、server、print
  if (h.indexOf('.') < 0 && h.indexOf(':') < 0) return true;
  // 内网保留域名后缀
  if (/(\.local|\.lan|\.internal|\.home|\.corp|\.intranet|\.localdomain|\.home\.arpa)$/.test(h)) return true;
  // IPv4 私有 / 环回 / 链路本地 / 运营商级 NAT
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  var a = parseInt(m[1], 10);
  var b = parseInt(m[2], 10);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// 判断某个绝对 URL 是否需要改走网页代理
// 规则（与插件 README 一致）：仅 http/https 外网站点走代理；
// CampusBili（含 9002 端口）、与 ClassIntra 同主机名的内网页面、已是代理地址 → 均直连
function shouldProxyUrl(url) {
  var info = getWebProxyInfo();
  if (!info) return false;
  if (!/^https?:\/\//i.test(url || '')) return false;
  var parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (/campusbili/i.test(parsed.hostname) || parsed.port === '9002') return false;
  if (typeof location !== 'undefined' && location.hostname && parsed.hostname === location.hostname) return false;
  // 局域网 / 本机 / 内网主机名一律直连（代理反而是绕远路，且可能根本到不了）
  if (isLanHost(parsed.hostname)) return false;
  if (url.indexOf(info.base + '/') === 0) return false;
  return true;
}

// 把真实 URL 转成代理 URL：http://<host>:<port>/<scheme>/<host><path><search><hash>
function buildProxyUrl(url) {
  var info = getWebProxyInfo();
  if (!info) return url;
  var parsed;
  try { parsed = new URL(url); } catch (e) { return url; }
  var scheme = parsed.protocol === 'https:' ? 'https' : 'http';
  return info.base + '/' + scheme + '/' + parsed.host
    + (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
}

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

// 服务端按账号保存浏览器数据（历史 / 收藏 / 首页）：同一账号在手机 / 平板 / 教室电脑
// 登录后看到同一份记录。localStorage 仍保留作为本地缓存，断网或插件未安装时不丢数据。
var SYNC_DEBOUNCE_MS = 1200;
var MAX_BOOKMARKS = 200;

// 当前登录账号 ID；未登录返回空串（此时只走本地存储，不参与同步）
function currentAccountId() {
  var user = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { user = null; }
  return String((user && (user.user_id || user.id)) || '');
}

// 合并两组记录：按 url 去重。preferNewer=true 取较新的时间（历史），
// false 取较早的时间（收藏，保留最初收藏时间），结果按时间倒序截断。
function mergeBrowserEntries(local, remote, preferNewer, limit) {
  var map = {};
  var list = (Array.isArray(local) ? local : []).concat(Array.isArray(remote) ? remote : []);
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || !e.url) continue;
    var item = { url: String(e.url), title: String(e.title || ''), time: Number(e.time) || 0 };
    var prev = map[item.url];
    if (!prev) { map[item.url] = item; continue; }
    if (preferNewer) {
      if (item.time > prev.time) map[item.url] = item;
    } else if (item.time && (!prev.time || item.time < prev.time)) {
      map[item.url] = item;
    }
  }
  var out = [];
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  }
  out.sort(function(x, y) { return (y.time || 0) - (x.time || 0); });
  return out.slice(0, limit);
}

// 只保留某个时间点之后产生的记录：服务端在别的设备上被改过（可能删了条目）时，
// 用这个过滤本机旧数据，避免把别处已删除的记录又合并回来。本机断网期间新产生的
// 记录（时间更新）会被保留并补传，不会丢。
function entriesAfter(list, time) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e && e.url && (Number(e.time) || 0) > time) out.push(e);
  }
  return out;
}

// 是否为触摸设备：决定兼容模式走触摸仿真（移动 UA + 窄视口）还是桌面鼠标键盘
// 以「主指针是否为粗略指针」为准，避免带触屏的笔记本被误判成手机布局
function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
}

export default {
  name: 'Browser',
  data: function() {
    return {
      currentUrl: '',
      // iframe 实际 src：外网站点可能为代理地址，内网/直连站点等于 currentUrl
      // currentUrl 始终保存原始 URL（供地址栏输入、历史、书签使用）
      frameSrc: '',
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
      // 页面加载指示器状态
      iframeLoading: false,
      iframeSlow: false,
      // 加载已等待秒数（慢速阶段展示，帮助用户判断「仍在进行」而非卡死）
      loadSeconds: 0,
      // 兼容模式：服务器端无头浏览器渲染（canvas 画面流 + 输入回灌）
      compatMode: false,
      compatError: '',
      // 兼容模式视口（CSS 像素）与触摸能力，由服务端 ready 消息下发
      compatViewW: 0,
      compatViewH: 0,
      // 画布可用尺寸（CSS 像素）：它同时就是服务端的排版视口宽度（云游戏也不改排版）
      compatBaseW: 0,
      compatBaseH: 0,
      // 帧的真实像素尺寸（云游戏为 2 倍）：仅用于画质提示，坐标换算一律以 compatViewW/H 为准
      compatFrameW: 0,
      compatFrameH: 0,
      compatTouch: false,
      // 兼容模式页面自身的历史状态：决定顶部返回是「页内后退」还是「退出浏览」
      compatCanBack: false,
      compatCanForward: false,
      // 移动端文字输入条：画面流无法唤起系统键盘，需要这个中转输入框
      compatKeyboardOpen: false,
      compatText: '',
      // 兼容模式声音：默认关闭，开启后服务端采集页面音频并经通道回传，前端用 Web Audio 直接播放
      compatAudio: false,
      // 是否真的在出流（收到音频分片后短暂置真，供按钮脉动反馈）
      compatAudioActive: false,
      // 服务端确认当前页面环境可用采集（false 时按钮禁用并给出提示）
      compatAudioSupported: true,
      // 云游戏画质：高分辨率 / 高码率 / 恒 60fps（按账号记忆偏好）
      compatGame: false,
      // 切换请求已发出、等待服务端回执时禁用按钮，避免连点
      compatGameBusy: false,
      // 画质切换的临时回执（实际编码尺寸 / 帧率 / 失败提示），几秒后自动消失
      compatGameTip: '',
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
    },
    // 当前页面是否经网页代理转发（frameSrc 与原始 URL 不同即已改走代理）
    // 兼容模式下页面由服务端浏览器渲染，不走代理改写，因此不显示「加速」标识
    isProxied: function() {
      var self = this;
      if (self.compatMode) return false;
      if (!self.currentUrl || self.frameSrc === self.currentUrl) return false;
      return shouldProxyUrl(self.currentUrl);
    },
    // 兼容模式下地址栏地址未变化时，「转到」按钮转为「刷新」，避免额外占用工具栏
    compatReloadMode: function() {
      if (!this.compatMode) return false;
      var text = (this.urlText || '').trim();
      if (!text) return false;
      if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
      return text === this.currentUrl;
    },
    // 当前页面主机名（加载提示用）
    currentHost: function() {
      var self = this;
      if (!self.currentUrl) return '';
      try { return new URL(self.currentUrl).host; } catch (e) { return ''; }
    },
    // 服务端是否具备兼容模式能力（无头浏览器可用）
    renderAvailable: function() {
      var info = getWebProxyInfo();
      return !!(info && info.render && info.render.available);
    },
    // 是否允许对当前页面启用兼容模式：外网 http(s) 站点才需要（局域网/本机直连即可）
    compatCapable: function() {
      if (!this.renderAvailable || !this.currentUrl) return false;
      try {
        var u = new URL(this.currentUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        if (isLanHost(u.hostname)) return false;
        return true;
      } catch (e) {
        return false;
      }
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
    },
    // 同一页面内切换账号（登出再登录）时，立即切到新账号的数据，避免残留上一个账号的记录
    '$store.state.auth.user': function(nv, ov) {
      var a = (nv && (nv.user_id || nv.id)) || '';
      var b = (ov && (ov.user_id || ov.id)) || '';
      if (String(a) !== String(b)) {
        this.reloadBrowserData();
        // 换号后立刻拉取新账号在服务端的记录（同账号换设备登录时即为跨设备同步）
        this.syncBrowserData();
      }
    }
  },
  created: function() {
    var self = this;
    migrateLegacyData();
    self.history = loadFromStorage(scopedKey('history'));
    self.bookmarks = loadFromStorage(scopedKey('bookmarks'));
    self.homepage = localStorage.getItem(scopedKey('homepage')) || '';
    // 云游戏画质偏好按账号记忆：同一台设备切号不会互相影响
    try { self.compatGame = localStorage.getItem(scopedKey('compat-game')) === '1'; } catch (e) {}
    // 登录账号：先渲染本地缓存，再异步拉服务端数据合并（同一账号跨设备同步）
    self.syncBrowserData();
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
    // 页面切后台 / 手机锁屏时暂停兼容模式的帧流与声音，回到前台再恢复
    self._onVisibilityChange = self.onCompatVisibility.bind(self);
    document.addEventListener('visibilitychange', self._onVisibilityChange);
    // 核心兜底：CampusBili 主动联动不要求安装桥接插件。
    // 未装插件时，「返回 ClassIntra」由这里直接接管；装了插件则交给桥接处理，避免重复导航。
    self._onCampusBiliCoreMessage = self.onCampusBiliCoreMessage.bind(self);
    window.addEventListener('message', self._onCampusBiliCoreMessage);
    // 从后台 / 其它标签页切回来时拉一次服务端数据：
    // 另一台设备刚加的收藏 / 历史 / 首页会立即出现在当前设备（5 秒节流，避免频繁请求）
    self._onWindowFocus = function() {
      var now = Date.now();
      if (now - (self._lastBrowserSync || 0) < 5000) return;
      self._lastBrowserSync = now;
      self.syncBrowserData();
    };
    window.addEventListener('focus', self._onWindowFocus);
  },
  beforeDestroy: function() {
    // 清理加载指示器定时器
    clearTimeout(this._slowTimer);
    clearTimeout(this._loadTimer);
    clearInterval(this._tickTimer);
    // 关闭兼容模式渲染会话（否则服务端标签页会一直占用内存）
    this.disconnectCompat();
    // 释放音频上下文（suspend 只是暂停，close 后才真正释放音频线程资源）
    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch (e) {}
      this._audioCtx = null;
      // 上下文关闭后主增益节点随之失效，必须清空引用，下次进入重新创建
      this._audioGain = null;
      this._audioSrcs = [];
    }
    // 卸载桥接实例，移除 message 监听
    unmountBridge();
    // 卸载网页代理桥接（若存在）
    if (this._webProxyBridge) {
      unmountWebProxyBridge(this._webProxyBridge);
      this._webProxyBridge = null;
    }
    if (this._onSwipeStart) {
      document.removeEventListener('touchstart', this._onSwipeStart);
      document.removeEventListener('touchmove', this._onSwipeMove);
      document.removeEventListener('touchend', this._onSwipeEnd);
      this._onSwipeStart = null;
      this._onSwipeMove = null;
      this._onSwipeEnd = null;
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._onCampusBiliCoreMessage) {
      window.removeEventListener('message', this._onCampusBiliCoreMessage);
      this._onCampusBiliCoreMessage = null;
    }
    if (this._onWindowFocus) {
      window.removeEventListener('focus', this._onWindowFocus);
      this._onWindowFocus = null;
    }
    // 清理浏览器数据同步的待发送队列
    clearTimeout(this._browserDataTimer);
    this._browserDataTimer = null;
    this._browserDataPatch = null;
    // 取消尚未发出的输入合并帧
    if (this._mouseRaf) { cancelAnimationFrame(this._mouseRaf); this._mouseRaf = 0; }
    if (this._wheelRaf) { cancelAnimationFrame(this._wheelRaf); this._wheelRaf = 0; }
  },
  methods: {
    // 开始加载：立刻显示指示器，5 秒后升级为慢速提示，60 秒兜底收起
    // （iframe 因网络层错误不触发 load 时，避免指示器永久转圈）
    startLoading: function() {
      var self = this;
      self.iframeLoading = true;
      self.iframeSlow = false;
      self.loadSeconds = 0;
      clearTimeout(self._slowTimer);
      clearTimeout(self._loadTimer);
      clearInterval(self._tickTimer);
      self._slowTimer = setTimeout(function() { self.iframeSlow = true; }, 5000);
      self._loadTimer = setTimeout(function() {
        self.iframeLoading = false;
        self.loadSeconds = 0;
      }, 60000);
      // 每秒累加等待时长（仅慢速阶段展示，成本极低）
      self._tickTimer = setInterval(function() {
        self.loadSeconds = self.loadSeconds + 1;
      }, 1000);
    },
    stopLoading: function() {
      clearTimeout(this._slowTimer);
      clearTimeout(this._loadTimer);
      clearInterval(this._tickTimer);
      this.iframeLoading = false;
      this.iframeSlow = false;
      this.loadSeconds = 0;
    },
    // 无插件时的核心兜底：CampusBili 主动发来的「返回 ClassIntra」信号。
    // 只接受当前 iframe 发出的消息（按 event.source 精确比对），防止页面内其它窗口伪造。
    // 插件存在时交给桥接实例处理，这里直接跳过，避免同一次点击触发两次导航。
    onCampusBiliCoreMessage: function(event) {
      if (CAMPUSBILI_BRIDGE_AVAILABLE) return;
      var frame = this.$refs.browserFrame;
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.action !== 'classintra-back') return;
      this.$router.push({ name: 'Desktop' }).catch(function() {});
    },
    // ===== CampusBili 桥接：通过插件桥接模块统一收发消息 =====
    // iframe 加载完成时挂载桥接实例并注册订阅
    // 身份注入 + request-mute + 握手（HELLO/WELCOME/READY）+ PING 兜底均由桥接内部完成
    onIframeLoad: function() {
      var self = this;
      self.stopLoading();
      var frame = self.$refs.browserFrame;
      if (!frame || !frame.contentWindow) return;
      // 每次加载先卸载上一次的网页代理桥接，避免 message 监听器泄漏
      if (self._webProxyBridge) {
        unmountWebProxyBridge(self._webProxyBridge);
        self._webProxyBridge = null;
      }
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

      // ===== 网页代理桥接：iframe 为代理页时，接收被代理页面真实地址 / 标题上报 =====
      // 仅当 frameSrc 与 currentUrl 不一致（说明已走代理）且插件桥接可用时挂载
      if (WEB_PROXY_BRIDGE_AVAILABLE && self.frameSrc && self.frameSrc !== self.currentUrl) {
        var proxyBridge = mountWebProxyBridge(frame, {
          allowedChannels: ['handshake', 'page-info', 'proxy-status', 'ping']
        });
        proxyBridge.on(WEB_PROXY_ACTIONS.PAGE_INFO, function(payload) {
          if (payload && payload.url) self.urlText = payload.url;
          if (payload && payload.title) self.pageTitle = payload.title;
        });
        self._webProxyBridge = proxyBridge;
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
       // 仅为 CampusBili 添加内嵌标记，避免污染其他第三方网站的 URL。
       try {
         var embeddedUrl = new URL(raw);
         var isCampusBili = /campusbili/i.test(embeddedUrl.hostname) || embeddedUrl.port === '9002';
         if (isCampusBili) {
           embeddedUrl.searchParams.set('classintra', '1');
           raw = embeddedUrl.toString();
         }
       } catch (e) {}
      // 兼容模式下的导航：复用同一条渲染会话跳转，保留页内历史，比重新建会话快
      if (self.compatMode) {
        var same = raw === self.currentUrl;
        self.currentUrl = raw;
        self.urlText = raw;
        if (!same) self.addHistory(raw);
        self.compatError = '';
        if (same) {
          self.reloadCompat();
        } else if (self._compatWs && self._compatWs.readyState === 1) {
          self._compatFrameShown = false;
          self.startLoading();
          self.sendCompatInput({ type: 'navigate', url: raw });
        } else {
          self.startLoading();
          self.$nextTick(function() {
            self.connectCompat(raw);
          });
        }
        return;
      }
      // 外网站点改走网页代理（插件就绪时）；内网 / CampusBili / 已是代理地址均直连
      var nextFrameSrc = shouldProxyUrl(raw) ? buildProxyUrl(raw) : raw;
      // 重复导航到同一地址时 iframe 不会重新加载（也就不会触发 load），此时不显示指示器
      if (nextFrameSrc !== self.frameSrc || raw !== self.currentUrl) {
        self.startLoading();
      }
      self.currentUrl = raw;
      self.frameSrc = nextFrameSrc;
      self.urlText = raw;
      // 添加到历史记录
      self.addHistory(raw);
      // 聚焦输入框
      self.$nextTick(function() {
        if (self.$refs.urlInput) self.$refs.urlInput.blur();
      });
    },
    // ===== 兼容模式：服务器端无头浏览器渲染（WS 画面流 + 输入回灌）=====
    toggleCompat: function() {
      var self = this;
      if (self.compatMode) {
        self.exitCompat();
        return;
      }
      if (!self.currentUrl) return;
      self.compatMode = true;
      self.startLoading();
      self.$nextTick(function() {
        self.connectCompat(self.currentUrl);
      });
    },
    // 画质切换的临时回执：给出「确实变了」的可见反馈，几秒后自动收起
    flashCompatGameTip: function(text, ms) {
      var self = this;
      self.compatGameTip = text || '';
      clearTimeout(self._compatGameTipTimer);
      if (!text) return;
      self._compatGameTipTimer = setTimeout(function() {
        self._compatGameTipTimer = null;
        self.compatGameTip = '';
      }, ms || 2600);
    },
    // 云游戏画质开关：运行中切换，不重建会话（保留页面与滚动位置）
    toggleCompatGame: function() {
      var self = this;
      if (!self.compatMode || self.compatGameBusy) return;
      var next = !self.compatGame;
      self.compatGameBusy = true;
      self.compatGame = next;
      try { localStorage.setItem(scopedKey('compat-game'), next ? '1' : '0'); } catch (e) {}
      // 云游戏的清晰度来自服务端 2 倍合成表面（帧像素翻倍），页面排版宽度保持不变；
      // dpr 只影响站点是否用 2 倍图，上限 2
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      self.flashCompatGameTip(next ? '正在切换云游戏画质…' : '正在恢复普通画质…', 8000);
      self.sendCompatInput({ type: 'mode', game: next, dpr: dpr });
      // 回执迟迟不来时解除按钮禁用，避免一直卡在禁用态
      clearTimeout(self._compatGameTimer);
      self._compatGameTimer = setTimeout(function() {
        self._compatGameTimer = null;
        self.compatGameBusy = false;
        if (self.compatGameTip) {
          self.flashCompatGameTip('画质切换无响应：插件后端需重启后生效', 4000);
        }
      }, 3000);
    },
    exitCompat: function() {
      this.compatMode = false;
      // 先通知服务端停止采集，再断开通道
      this.stopCompatAudio();
      this.disconnectCompat();
      this.stopLoading();
      // 退出兼容模式后回到普通 iframe：按原规则重新计算 frameSrc
      var url = this.currentUrl;
      if (url) this.frameSrc = shouldProxyUrl(url) ? buildProxyUrl(url) : url;
    },
    // 地址栏按钮：兼容模式下地址未变即刷新，否则按新地址跳转
    onCompatGo: function() {
      if (this.compatMode && this.compatReloadMode) {
        this.reloadCompat();
        return;
      }
      this.navigateTo(this.urlText);
    },
    // 兼容模式刷新：保留会话与页内历史；通道已断开时重新建会话
    reloadCompat: function() {
      var self = this;
      if (!self._compatWs || self._compatWs.readyState !== 1) {
        self.startLoading();
        self.$nextTick(function() {
          self.connectCompat(self.currentUrl);
        });
        return;
      }
      self._compatFrameShown = false;
      self.startLoading();
      self.sendCompatInput({ type: 'reload' });
    },
    // 建立渲染通道；失败只影响兼容模式，不影响普通浏览
    connectCompat: function(url) {
      var self = this;
      var info = getWebProxyInfo();
      if (!info || !info.render || !info.render.available) {
        self.compatError = '服务端未启用兼容模式';
        self.stopLoading();
        return;
      }
      self.disconnectCompat();
      // disconnectCompat 会把通道标记为「主动关闭」，这里建立新通道后解除，
      // 否则后续真正的异常断开不会触发自动重连
      self._compatClosing = false;
      self.compatError = '';
      self._compatFrameShown = false;
      self.compatKeyboardOpen = false;
      self.compatText = '';
      self.compatCanBack = false;
      self.compatCanForward = false;
      // 新会话从「音频关闭」开始（ready 后会按用户偏好重新申请开启）
      self.compatAudioSupported = true;
      self.compatAudioActive = false;
      self._audioNext = 0;
      // 视口按当前可用区域下发：移动端用窄视口 + 触摸仿真 + 移动 UA，
      // 否则服务端仍按 1280×800 桌面视口渲染，手机上只能看到缩小后的桌面版。
      var box = self.$refs.browserContent;
      var rect = box ? box.getBoundingClientRect() : null;
      var w = Math.round(rect && rect.width ? rect.width : window.innerWidth);
      var h = Math.round(rect && rect.height ? rect.height : window.innerHeight);
      // 云游戏的清晰度来自服务端 2 倍合成表面（帧像素翻倍），页面排版宽度保持不变；
      // dpr 只影响站点是否用 2 倍图，上限 2
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var touch = isTouchDevice();
      // 带上使用者身份：班管在应用市场的兼容模式管理浮窗里需要知道是谁在用
      var user = (self.$store && self.$store.state && self.$store.state.auth && self.$store.state.auth.user) || {};
      var uname = user.nickname || user.username || user.name || '';
      // 带上登录 token：服务端据此取真实 user_id 并校验「可使用者」白名单。
      // 渲染通道在独立端口，浏览器不会自动带 cookie，只能放在 query 里。
      var token = '';
      try { token = localStorage.getItem('token') || ''; } catch (e) {}
      var wsUrl = 'ws://' + location.hostname + ':' + info.port + '/__render__?url=' + encodeURIComponent(url)
        + '&w=' + w + '&h=' + h + '&dpr=' + dpr + '&touch=' + (touch ? '1' : '0')
        + '&uid=' + encodeURIComponent(user.user_id || user.id || '')
        + '&uname=' + encodeURIComponent(uname)
        + '&token=' + encodeURIComponent(token)
        + '&mode=' + (self.compatGame ? 'game' : 'normal');
      var ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        self.compatError = e.message || '兼容模式连接失败';
        self.stopLoading();
        return;
      }
      self._compatWs = ws;
      // 画面帧为二进制 JPEG：省掉 JSON.parse 与 base64 转换
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function(ev) {
        if (typeof ev.data !== 'string') {
          self.drawCompatFrame({ buffer: ev.data });
          return;
        }
        self.onCompatMessage(ev);
      };
      ws.onerror = function() {
        if (self._compatWs === ws) {
          self.compatError = '兼容模式连接失败';
          self.stopLoading();
        }
      };
      ws.onclose = function() {
        if (self._compatWs !== ws) return;
        self._compatWs = null;
        self._compatBusy = false;
        self._compatPending = null;
        self.stopLoading();
        // 非主动断开（网络抖动 / 切网 / 服务端回收）时自动重建会话，
        // 避免画面停在最后一帧、还要用户手动刷新。最多连续重试两次。
        if (self._compatClosing || !self.compatMode || !self.currentUrl) return;
        // 页面在后台时不重建：等服务端回收也无所谓，回到前台由可见性回调重新连接
        if (document.hidden) return;
        if (self._compatRetryTimer || self._compatRetry >= 2) return;
        self._compatRetry = (self._compatRetry || 0) + 1;
        var delay = self._compatRetry === 1 ? 600 : 2500;
        self._compatRetryTimer = setTimeout(function() {
          self._compatRetryTimer = null;
          if (!self.compatMode || !self.currentUrl || self._compatWs) return;
          self._compatFrameShown = false;
          self.startLoading();
          self.connectCompat(self.currentUrl);
        }, delay);
      };
    },
    disconnectCompat: function() {
      var ws = this._compatWs;
      this._compatWs = null;
      this._compatBusy = false;
      this._compatPending = null;
      // 主动关闭：抑制 onclose 里的自动重连，并清掉待执行的重连定时器
      this._compatClosing = true;
      clearTimeout(this._compatRetryTimer);
      this._compatRetryTimer = null;
      this.compatCanBack = false;
      this.compatCanForward = false;
      // 取消尚未发出的输入合并帧，避免断开后还往废弃通道发消息
      if (this._mouseRaf) { cancelAnimationFrame(this._mouseRaf); this._mouseRaf = 0; }
      if (this._wheelRaf) { cancelAnimationFrame(this._wheelRaf); this._wheelRaf = 0; }
      // 长按计时器与触摸状态一并清空：通道已废弃，继续发消息没有意义
      this.clearCompatLongPress();
      this._compatHoldPending = false;
      this._compatHoldFired = false;
      // 画质回执只对当次切换有意义，断开时一并清掉
      clearTimeout(this._compatGameTipTimer);
      this._compatGameTipTimer = null;
      this.compatGameTip = '';
      this._compatTouch = null;
      this._compatPinch = null;
      this._compatMulti = false;
      this._compatTouchCount = 0;
      this._compatTouchDown = false;
      this._compatBusyAt = 0;
      // 通道关闭后声音必然中断：停掉本地播放，但保留用户的开关偏好（重连时恢复）
      this.haltCompatAudio();
      this.teardownCompatResize();
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
    },
    // ===== 视口自适应：容器尺寸变化（手机旋转 / 窗口缩放）时同步无头浏览器 =====
    setupCompatResize: function() {
      var self = this;
      self.teardownCompatResize();
      if (typeof ResizeObserver === 'undefined') return;
      var box = self.$refs.browserContent;
      if (!box) return;
      self._compatResizeObs = new ResizeObserver(function() {
        clearTimeout(self._compatResizeTimer);
        // 旋转/拖拽会产生连续回调，防抖后再下发，避免频繁重开 screencast
        self._compatResizeTimer = setTimeout(function() {
          self.syncCompatSize();
        }, 260);
      });
      self._compatResizeObs.observe(box);
    },
    teardownCompatResize: function() {
      clearTimeout(this._compatResizeTimer);
      this._compatResizeTimer = null;
      if (this._compatResizeObs) {
        try { this._compatResizeObs.disconnect(); } catch (e) {}
        this._compatResizeObs = null;
      }
    },
    // 只在尺寸真正变化时下发，避免无意义的视口重设与帧流重启
    syncCompatSize: function() {
      var self = this;
      if (!self.compatMode) return;
      var box = self.$refs.browserContent;
      var rect = box ? box.getBoundingClientRect() : null;
      if (!rect || !rect.width || !rect.height) return;
      var w = Math.round(rect.width);
      var h = Math.round(rect.height);
      // 与服务端记录的「画布可用尺寸」比较：它同时就是排版视口，云游戏不会改变它
      var baseW = self.compatBaseW || self.compatViewW;
      var baseH = self.compatBaseH || self.compatViewH;
      if (Math.abs(w - baseW) < 2 && Math.abs(h - baseH) < 2) return;
      self.sendCompatInput({ type: 'resize', width: w, height: h });
    },
    // 页面可见性变化：隐藏时通知服务端停掉帧流与声音采集，回到前台再恢复。
    // 既省服务端 CPU / 带宽，也避免离开页面后还在出声。
    onCompatVisibility: function() {
      var self = this;
      if (!self.compatMode) return;
      var ws = self._compatWs;
      if (!ws || ws.readyState > 1) {
        // 后台停留过久被服务端回收、或通道已断：回到前台立即重建会话，
        // 而不是把最后一帧冻在屏幕上等用户手动刷新
        if (!document.hidden && self.currentUrl && !self._compatRetryTimer) {
          self._compatFrameShown = false;
          self.startLoading();
          self.connectCompat(self.currentUrl);
        }
        return;
      }
      // 握手进行中：等 ready 回调里按 document.hidden 统一处理
      if (ws.readyState !== 1) return;
      if (document.hidden) {
        self.sendCompatInput({ type: 'pause' });
        self.compatAudioActive = false;
        self._audioNext = 0;
        if (self._audioCtx) {
          try { self._audioCtx.suspend(); } catch (e) {}
        }
      } else {
        self.sendCompatInput({ type: 'resume' });
        if (self.compatAudio && self._audioCtx) {
          try { self._audioCtx.resume(); } catch (e) {}
          self._audioNext = 0;
        }
      }
    },
    onCompatMessage: function(ev) {
      var self = this;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'ready') {
        // 服务端确认的视口尺寸（CSS 像素）与触摸能力：坐标换算与键盘按钮都依赖它
        self.compatViewW = Number(msg.width) || 0;
        self.compatViewH = Number(msg.height) || 0;
        self.compatBaseW = Number(msg.baseWidth) || self.compatViewW;
        self.compatBaseH = Number(msg.baseHeight) || self.compatViewH;
        self.compatFrameW = Number(msg.frameWidth) || self.compatViewW;
        self.compatFrameH = Number(msg.frameHeight) || self.compatViewH;
        self.compatTouch = !!msg.touch;
        // 服务端回传的画质模式：重连后与本地偏好对齐（避免显示与实际不一致）
        if (typeof msg.game === 'boolean') self.compatGame = msg.game;
        self.compatGameBusy = false;
        // 通道就绪后再挂视口监听：此时容器尺寸才是最终可用区域
        self.setupCompatResize();
        // 通道恢复正常：重置自动重连计数，下次异常断开重新从第一次开始
        self._compatRetry = 0;
        // 会话重建（刷新 / 重连）后恢复用户的声音偏好
        if (self.compatAudio && self.compatAudioSupported) {
          self._audioNext = 0;
          self.sendCompatInput({ type: 'audio', enabled: true });
        }
        // 后台自动重建的会话要立刻暂停，避免屏幕没亮着却还在跑帧流
        if (document.hidden) self.sendCompatInput({ type: 'pause' });
        return;
      }
      if (msg.type === 'history') {
        // 页面自身的导航历史：决定顶部返回是页内后退还是退出浏览
        self.compatCanBack = !!msg.canBack;
        self.compatCanForward = !!msg.canForward;
        if (msg.title) self.pageTitle = msg.title;
        return;
      }
      if (msg.type === 'title') {
        // 兼容模式页面标题（分享到聊天/社区时带上）
        if (msg.title) self.pageTitle = msg.title;
        return;
      }
      if (msg.type === 'resized') {
        // 服务端已按新视口重设画面，后续帧按新尺寸下发
        self.compatViewW = Number(msg.width) || self.compatViewW;
        self.compatViewH = Number(msg.height) || self.compatViewH;
        self.compatBaseW = Number(msg.baseWidth) || self.compatBaseW;
        self.compatBaseH = Number(msg.baseHeight) || self.compatBaseH;
        if (msg.frameWidth) self.compatFrameW = Number(msg.frameWidth) || self.compatFrameW;
        if (msg.frameHeight) self.compatFrameH = Number(msg.frameHeight) || self.compatFrameH;
        return;
      }
      if (msg.type === 'audio') {
        self.enqueueCompatAudio(msg.data, Number(msg.rate) || 24000);
        return;
      }
      if (msg.type === 'audio-state') {
        // 服务端回执：页面环境无法采集时把按钮复位并禁用
        if (msg.available === false) {
          self.compatAudioSupported = false;
          self.compatAudio = false;
          self.haltCompatAudio();
        } else {
          self.compatAudioSupported = true;
        }
        return;
      }
      if (msg.type === 'mode-state') {
        // 服务端已按新模式重设帧流：以回执为准更新开关、视口尺寸与坐标换算基准
        self.compatGame = !!msg.game;
        if (msg.width) self.compatViewW = Number(msg.width) || self.compatViewW;
        if (msg.height) self.compatViewH = Number(msg.height) || self.compatViewH;
        if (msg.baseWidth) self.compatBaseW = Number(msg.baseWidth) || self.compatBaseW;
        if (msg.baseHeight) self.compatBaseH = Number(msg.baseHeight) || self.compatBaseH;
        if (msg.frameWidth) self.compatFrameW = Number(msg.frameWidth) || self.compatFrameW;
        if (msg.frameHeight) self.compatFrameH = Number(msg.frameHeight) || self.compatFrameH;
        self.compatGameBusy = false;
        clearTimeout(self._compatGameTimer);
        self._compatGameTimer = null;
        var fw = self.compatFrameW || self.compatViewW;
        var fh = self.compatFrameH || self.compatViewH;
        self.flashCompatGameTip(msg.game
          ? '云游戏画质已开启 · 帧 ' + fw + '×' + fh + ' · 60fps'
          : '已恢复普通画质 · 帧 ' + fw + '×' + fh);
        return;
      }
      if (msg.type === 'focus') {
        // 页面内输入框获得焦点：移动端没有系统键盘可唤起，自动展开输入条
        if (msg.input && self.compatTouch) {
          self.compatKeyboardOpen = true;
          self.$nextTick(function() {
            if (self.$refs.compatTextInput) self.$refs.compatTextInput.focus();
          });
        }
        return;
      }
      if (msg.type === 'longpress-state') {
        // 服务端回执：真的补出了右键菜单，后续 touchend 用 cancel 收尾，
        // 否则合成的点击会落在菜单上把它关掉；没补则恢复移动转发，手指仍是自由拖动。
        if (msg.fired) {
          self._compatHoldFired = true;
        } else {
          self._compatHoldPending = false;
        }
        return;
      }
      if (msg.type === 'frame') {
        this.drawCompatFrame(msg);
        return;
      }
      if (msg.type === 'loaded') {
        this.stopLoading();
        return;
      }
      if (msg.type === 'url') {
        // 无头浏览器内的跳转：同步到地址栏与历史（保持单一地址来源）
        if (msg.url && /^https?:\/\//i.test(msg.url)) {
          this.currentUrl = msg.url;
          this.urlText = msg.url;
          this.addHistory(msg.url);
        }
        return;
      }
      if (msg.type === 'error') {
        this.compatError = msg.message || '兼容模式异常';
        // 会话不可用时停止声音，避免按钮停留在「开启」状态却收不到数据
        this.compatAudio = false;
        this.haltCompatAudio();
        this.stopLoading();
        return;
      }
      if (msg.type === 'closed') {
        this.compatAudio = false;
        this.haltCompatAudio();
        this.stopLoading();
      }
    },
    // 逐帧绘制：同一时刻只解码一张图，避免高帧率下堆积造成卡顿。
    // 优先 Blob + createImageBitmap：JPEG 解码在浏览器解码线程完成，不阻塞主线程绘制；
    // 老内核不支持时回退到 Image + data URL。
    drawCompatFrame: function(msg) {
      var self = this;
      var canvas = self.$refs.compatCanvas;
      if (!canvas) return;
      if (!msg.buffer && !msg.data) return;
      if (self._compatBusy) {
        // 只保留最新一帧：解码跟不上时旧帧没有价值
        self._compatPending = msg;
        // 解码看门狗：个别内核上 createImageBitmap 可能迟迟不回调，
        // 忙标志一旦卡住，画面会永久停在上一帧（表现为「卡住、滑不动」）。
        if (Date.now() - (self._compatBusyAt || 0) > 1200) {
          self._compatBusy = false;
          self._compatBusyAt = 0;
          self.drawCompatFrame(msg);
        }
        return;
      }
      self._compatBusy = true;
      self._compatBusyAt = Date.now();
      // 画布尺寸按图片真实像素设置（含 dpr），坐标换算另用 viewWidth/viewHeight
      var paint = function(source, cw, ch) {
        try {
          cw = cw || source.naturalWidth || source.videoWidth;
          ch = ch || source.naturalHeight || source.videoHeight;
          if (canvas.width !== cw) canvas.width = cw;
          if (canvas.height !== ch) canvas.height = ch;
          canvas.getContext('2d').drawImage(source, 0, 0);
        } catch (e) {}
        // 收到首帧即视为「已经能看了」：收起加载遮罩，否则页面迟迟不触发 load
        // 时会一直盖在画布上，导致触摸和点击全部被遮罩吞掉。
        if (!self._compatFrameShown) {
          self._compatFrameShown = true;
          self.stopLoading();
        }
      };
      var next = function() {
        self._compatBusy = false;
        self._compatBusyAt = 0;
        if (self._compatPending) {
          var pending = self._compatPending;
          self._compatPending = null;
          self.drawCompatFrame(pending);
        }
      };
      // 二进制帧直接包成 Blob；旧协议的 base64 帧走兜底转换
      var makeBlob = function() {
        if (typeof Blob === 'undefined') return null;
        if (msg.buffer) {
          try { return new Blob([msg.buffer], { type: 'image/jpeg' }); } catch (e) { return null; }
        }
        try {
          var bin = atob(msg.data);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Blob([bytes], { type: 'image/jpeg' });
        } catch (e) { return null; }
      };
      if (!self._compatUseImg && window.createImageBitmap) {
        var blob = makeBlob();
        if (blob) {
          createImageBitmap(blob).then(function(bmp) {
            paint(bmp, bmp.width, bmp.height);
            try { if (bmp.close) bmp.close(); } catch (e) {}
            next();
          }).catch(function() {
            // 个别内核的解码器不接受 Blob JPEG：回退并记住，后续直接走 Image
            self._compatUseImg = true;
            self._compatBusy = false;
            self._compatBusyAt = 0;
            self.drawCompatFrame(msg);
          });
          return;
        }
      }
      var img = new Image();
      var url = '';
      var isObjectUrl = false;
      if (msg.buffer) {
        var fallbackBlob = makeBlob();
        if (fallbackBlob) {
          try {
            url = URL.createObjectURL(fallbackBlob);
            isObjectUrl = true;
          } catch (e) { url = ''; }
        }
      } else if (msg.data) {
        url = 'data:image/jpeg;base64,' + msg.data;
      }
      if (!url) {
        next();
        return;
      }
      img.onload = function() {
        paint(img);
        if (isObjectUrl) { try { URL.revokeObjectURL(url); } catch (e) {} }
        next();
      };
      img.onerror = function() {
        if (isObjectUrl) { try { URL.revokeObjectURL(url); } catch (e) {} }
        next();
      };
      img.src = url;
    },
    sendCompatInput: function(msg) {
      var ws = this._compatWs;
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify(msg)); } catch (e) {}
    },
    // ===== 兼容模式声音：服务端采集 PCM 分片，前端按块排期播放 =====
    toggleCompatAudio: function() {
      var self = this;
      if (!self.compatMode || !self.compatAudioSupported) return;
      if (self.compatAudio) {
        self.stopCompatAudio();
        return;
      }
      // 点击本身就是合法用户手势：此时创建 / 恢复 AudioContext，后续声音不会被自动播放策略拦截
      self.compatAudio = true;
      try {
        if (!self._audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) self._audioCtx = new AC();
        }
        // 主音量节点：静音时把增益压到 0。只靠 ctx.suspend() 在部分 WebView / iOS 内核上
        // 对已排期的 buffer 不立即生效，用户感受就是「点了静音还有声音」。
        if (self._audioCtx && !self._audioGain) {
          self._audioGain = self._audioCtx.createGain();
          self._audioGain.connect(self._audioCtx.destination);
        }
        if (self._audioGain) self._audioGain.gain.value = 1;
        if (self._audioCtx && self._audioCtx.state === 'suspended') self._audioCtx.resume();
      } catch (e) {}
      self._audioNext = 0;
      self.sendCompatInput({ type: 'audio', enabled: true });
    },
    stopCompatAudio: function() {
      this.compatAudio = false;
      this.haltCompatAudio();
      this.sendCompatInput({ type: 'audio', enabled: false });
    },
    // 只停播放（通道重建 / 退出时用），不改变用户的声音偏好
    haltCompatAudio: function() {
      var self = this;
      self.compatAudioActive = false;
      clearTimeout(self._audioPulseTimer);
      self._audioNext = 0;
      // 双保险：先把主增益压到 0，并逐个 stop() 已排期的音源。
      // 某些内核 suspend() 是异步的，已经排进音频线程的 buffer 还会响一小段，
      // 必须显式静音，否则「点了静音还能听到声音」。
      if (self._audioGain) {
        try { self._audioGain.gain.value = 0; } catch (e) {}
      }
      var srcs = self._audioSrcs || [];
      for (var i = 0; i < srcs.length; i++) {
        try { srcs[i].stop(); } catch (e) {}
      }
      self._audioSrcs = [];
      if (self._audioCtx) {
        try { self._audioCtx.suspend(); } catch (e) {}
      }
    },
    // PCM 分片（16 位小端单声道）→ AudioBuffer 排期播放；断档落后时直接对齐到当前时刻
    enqueueCompatAudio: function(b64, rate) {
      var self = this;
      if (!self.compatAudio || !b64 || !self._audioCtx) return;
      var ctx = self._audioCtx;
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) {}
      }
      var bin;
      try { bin = atob(b64); } catch (e) { return; }
      var n = bin.length >> 1;
      if (!n) return;
      var buf;
      try { buf = ctx.createBuffer(1, n, rate || 24000); } catch (e) { return; }
      var ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) {
        var v = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
        ch[i] = v / 32768;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      // 统一经主增益节点出声：静音时只需把增益压到 0，无需依赖内核 suspend() 的时效
      try { src.connect(self._audioGain || ctx.destination); } catch (e) { return; }
      var now = ctx.currentTime;
      // 缓冲区断档（页面静音 / 切后台 / 网络抖动）后重新对齐，避免声音越拖越晚
      if (!self._audioNext || self._audioNext < now - 0.1 || self._audioNext > now + 1.2) {
        self._audioNext = now + 0.06;
      }
      try { src.start(self._audioNext); } catch (e) { return; }
      // 记录在播音源：静音时逐个 stop()，保证已排期的声音立刻中断
      if (!self._audioSrcs) self._audioSrcs = [];
      self._audioSrcs.push(src);
      src.onended = function() {
        var k = self._audioSrcs ? self._audioSrcs.indexOf(src) : -1;
        if (k >= 0) self._audioSrcs.splice(k, 1);
      };
      self._audioNext += buf.duration;
      self.compatAudioActive = true;
      clearTimeout(self._audioPulseTimer);
      self._audioPulseTimer = setTimeout(function() { self.compatAudioActive = false; }, 600);
    },
    // 把画布内的 CSS 坐标换算成无头浏览器的视口坐标（CSS 像素）
    // 画布以 object-fit: contain 居中缩放，两侧/上下可能有留白，需要按实际绘制区域换算。
    // 注意：canvas.width/height 是物理像素（含 dpr），Input.* 需要 CSS 像素，
    // 所以必须用服务端下发的 viewWidth/viewHeight 换算，否则高 dpr 下坐标会偏移一倍。
    compatPointFromClient: function(clientX, clientY) {
      var canvas = this.$refs.compatCanvas;
      if (!canvas) return { x: 0, y: 0 };
      var rect = canvas.getBoundingClientRect();
      var vw = this.compatViewW || 1280;
      var vh = this.compatViewH || 800;
      var scale = Math.min(rect.width / vw, rect.height / vh);
      if (!scale || scale <= 0) return { x: 0, y: 0 };
      var offsetX = (rect.width - vw * scale) / 2;
      var offsetY = (rect.height - vh * scale) / 2;
      var x = (clientX - rect.left - offsetX) / scale;
      var y = (clientY - rect.top - offsetY) / scale;
      return {
        x: Math.round(Math.max(0, Math.min(vw - 1, x))),
        y: Math.round(Math.max(0, Math.min(vh - 1, y)))
      };
    },
    compatPoint: function(e) {
      return this.compatPointFromClient(e.clientX, e.clientY);
    },
    // 指针移动按帧合并：高频 mousemove（120Hz 触控板）不必逐条走 WS，只发最新位置
    onCompatMouseMove: function(e) {
      var self = this;
      self._mousePos = self.compatPoint(e);
      self._mouseButtons = e.buttons || 0;
      if (self._mouseRaf) return;
      self._mouseRaf = requestAnimationFrame(function() {
        self._mouseRaf = 0;
        var p = self._mousePos;
        if (!p || !self.compatMode) return;
        self.sendCompatInput({ type: 'mouse', event: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: self._mouseButtons || 0 });
      });
    },
    onCompatMouseDown: function(e) {
      // 取消尚未发出的移动合并帧，避免按下用的是旧坐标
      if (this._mouseRaf) { cancelAnimationFrame(this._mouseRaf); this._mouseRaf = 0; }
      var p = this.compatPoint(e);
      var canvas = this.$refs.compatCanvas;
      if (canvas) canvas.focus();
      this.sendCompatInput({ type: 'mouse', event: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    },
    onCompatMouseUp: function(e) {
      var p = this.compatPoint(e);
      this.sendCompatInput({ type: 'mouse', event: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    },
    // 滚轮按帧合并增量：触控板一帧内可能来多个事件，合并后总位移不变、WS 消息量大幅下降
    onCompatWheel: function(e) {
      var self = this;
      self._wheelPos = self.compatPoint(e);
      self._wheelDx = (self._wheelDx || 0) + (e.deltaX || 0);
      self._wheelDy = (self._wheelDy || 0) + (e.deltaY || 0);
      if (self._wheelRaf) return;
      self._wheelRaf = requestAnimationFrame(function() {
        self._wheelRaf = 0;
        var p = self._wheelPos;
        var dx = self._wheelDx || 0;
        var dy = self._wheelDy || 0;
        self._wheelDx = 0;
        self._wheelDy = 0;
        if (!p || !self.compatMode || (!dx && !dy)) return;
        // 云游戏只提高帧像素、不改排版视口，滚轮增量（CSS 像素）无需换算
        self.sendCompatInput({ type: 'wheel', x: p.x, y: p.y, deltaX: dx, deltaY: dy });
      });
    },
    // ===== 触摸：1~2 指原样转发为 CDP 触摸序列，3 指及以上才转为浏览器原生缩放 =====
    // 把当前手指集合换算成 CDP 触摸点列表。
    // id 直接取 touch.identifier：同一根手指在整个按下期间保持不变。
    // 注意抬起时要用 touchend 的 changedTouches 指明「哪一根被抬起」——
    // CDP 的 touchEnd 语义是 touchPoints 即本次抬起的触点，传剩余点会抬错手指。
    compatTouchPoints: function(list) {
      var pts = [];
      if (!list) return pts;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var p = this.compatPointFromClient(t.clientX, t.clientY);
        // Chrome 的 touch.identifier 从 0 开始，而服务端会把 0 归一成 1，
        // 与第一根手指撞号导致多指被当成同一指，所以统一 +1 得到 1..N
        var id = (typeof t.identifier === 'number' ? t.identifier : i) + 1;
        pts.push({ x: p.x, y: p.y, id: id });
      }
      return pts;
    },
    // 开始一段多指序列前，把单指状态清干净（长按计时、采样都作废）
    startCompatMultiTouch: function() {
      this.clearCompatLongPress();
      this._compatTouch = null;
      this._compatMulti = true;
    },
    // 长按兜底：单指按住 600ms 且位移不超过原生 touch slop（8 px）才算长按。
    // 无头浏览器不一定把合成触摸识别成 GestureLongPress，页面就收不到 contextmenu；
    // 这里主动把长按上报给服务端，由服务端补一次右键（页面已自己响应过则不会重复发）。
    armCompatLongPress: function(p) {
      var self = this;
      self.clearCompatLongPress();
      self._compatHoldPending = false;
      self._compatHoldFired = false;
      self._compatHoldTimer = setTimeout(function() {
        self._compatHoldTimer = null;
        if (!self._compatTouchDown || self._compatMulti || self._compatPinch) return;
        if (!self._compatTouch || self._compatTouch.id !== p.id) return;
        // 按住期间不再转发移动：否则菜单刚弹出就被后续 move 拖走
        self._compatHoldPending = true;
        self.sendCompatInput({ type: 'longpress', x: p.x, y: p.y });
      }, 600);
    },
    clearCompatLongPress: function() {
      if (this._compatHoldTimer) {
        clearTimeout(this._compatHoldTimer);
        this._compatHoldTimer = null;
      }
    },
    onCompatTouchStart: function(e) {
      var self = this;
      if (!e.touches || !e.touches.length) return;
      // 点画面即收起输入条，避免系统键盘一直占着半屏
      if (self.compatKeyboardOpen) self.compatKeyboardOpen = false;
      self._compatTouchCount = e.touches.length;
      self._compatTouchDown = true;
      // 3 指及以上才是页面缩放。2 指以内必须原样转发：
      // 云游戏要「左手摇杆 + 右手按键」同时按住，此前把双指直接吞成捏合，
      // 页面从未收到第二根手指，表现就是「不支持多点触摸」。
      if (e.touches.length >= 3) {
        if (self._compatTouch || self._compatMulti) {
          self.startCompatMultiTouch();
          self.sendCompatInput({ type: 'touch', event: 'cancel', points: [] });
        }
        self.startCompatPinch(e);
        return;
      }
      var pts = self.compatTouchPoints(e.touches);
      if (pts.length === 1) {
        self._compatMulti = false;
        self._compatTouch = {
          id: pts[0].id,
          lastX: pts[0].x,
          lastY: pts[0].y,
          // 手势起点：长按判定只用「按下点 → 当前点」的位移，避免抖动累积误判
          originX: pts[0].x,
          originY: pts[0].y
        };
        self.armCompatLongPress(pts[0]);
      } else {
        // 第二根手指落下：单指采样 / 长按计时让位给多指直通
        self.startCompatMultiTouch();
      }
      self.sendCompatInput({ type: 'touch', event: 'start', points: pts });
    },
    // 触摸移动必须逐条转发：合并到 requestAnimationFrame 后，
    // 重载页面上帧回调迟迟不来，慢速小位移就发不出去，表现就是「手指在滑、页面不动」。
    onCompatTouchMove: function(e) {
      var self = this;
      if (!e.touches || !e.touches.length) return;
      if (self._compatPinch) {
        if (e.touches.length >= 3) self.moveCompatPinch(e);
        return;
      }
      var pts = self.compatTouchPoints(e.touches);
      self._compatTouchCount = pts.length;
      // 多指：每帧上报全部点，任何一根移动都要带上其余点，否则服务端会漏合成其它手指
      if (pts.length > 1) {
        self.sendCompatInput({ type: 'touch', event: 'move', points: pts });
        return;
      }
      var p = pts[0];
      var st = self._compatTouch;
      // 状态丢失（例如另一根手指刚抬起）时按当前位置接续，别把这次滑动丢掉
      if (!st || st.id !== p.id) {
        st = { id: p.id, lastX: p.x, lastY: p.y, originX: p.x, originY: p.y };
        self._compatTouch = st;
      }
      // 位移超过原生 touch slop 就说明用户是在拖，不是在长按
      if (self._compatHoldTimer &&
          (Math.abs(p.x - st.originX) > 8 || Math.abs(p.y - st.originY) > 8)) {
        self.clearCompatLongPress();
      }
      // 长按已触发：这一段手势的移动不再转发，否则会把弹出的菜单 / 选中状态拖掉
      if (self._compatHoldPending) return;
      // 阈值只用来过滤原地抖动：宁可多转发，也不能吞掉慢速滑动
      if (Math.abs(p.x - st.lastX) < 1 && Math.abs(p.y - st.lastY) < 1) return;
      st.lastX = p.x;
      st.lastY = p.y;
      self.sendCompatInput({ type: 'touch', event: 'move', points: [{ x: p.x, y: p.y, id: st.id }] });
    },
    // 多指缩放：记录起始指距（取前两指），之后按增量下发原生 pinch 手势（浏览器级缩放，非页面手势）
    startCompatPinch: function(e) {
      var a = e.touches[0];
      var b = e.touches[1];
      var pa = this.compatPointFromClient(a.clientX, a.clientY);
      var pb = this.compatPointFromClient(b.clientX, b.clientY);
      var dist = Math.sqrt(Math.pow(pa.x - pb.x, 2) + Math.pow(pa.y - pb.y, 2)) || 1;
      this._compatPinch = { startDist: dist, lastScale: 1, lastAt: 0 };
    },
    moveCompatPinch: function(e) {
      var p = this._compatPinch;
      if (!p) return;
      var a = e.touches[0];
      var b = e.touches[1];
      var pa = this.compatPointFromClient(a.clientX, a.clientY);
      var pb = this.compatPointFromClient(b.clientX, b.clientY);
      var dist = Math.sqrt(Math.pow(pa.x - pb.x, 2) + Math.pow(pa.y - pb.y, 2)) || 1;
      var scale = dist / p.startDist;
      // 累计变化不足 2% 或距上次下发不足 50ms 就先攒着，避免小抖动打满输入队列
      if (Math.abs(scale / p.lastScale - 1) < 0.02) return;
      var now = Date.now();
      if (now - p.lastAt < 50) return;
      p.lastAt = now;
      var inc = scale / p.lastScale;
      p.lastScale = scale;
      this.sendCompatInput({
        type: 'pinch',
        x: Math.round((pa.x + pb.x) / 2),
        y: Math.round((pa.y + pb.y) / 2),
        scaleFactor: inc
      });
    },
    onCompatTouchEnd: function(e) {
      var self = this;
      var left = e && e.touches ? e.touches.length : 0;
      // 缩放过程中：仍有三指以上就继续；降到两指以内则结束缩放，剩下的手指接着用
      if (self._compatPinch) {
        if (left >= 3) return;
        self._compatPinch = null;
        self.clearCompatLongPress();
        self._compatHoldPending = false;
        self._compatHoldFired = false;
        if (!left) {
          self._compatTouchCount = 0;
          self._compatTouchDown = false;
          return;
        }
        var rest = self.compatTouchPoints(e.touches);
        self._compatTouchCount = rest.length;
        self._compatMulti = rest.length > 1;
        self._compatTouch = rest.length === 1 ? {
          id: rest[0].id,
          lastX: rest[0].x,
          lastY: rest[0].y,
          originX: rest[0].x,
          originY: rest[0].y
        } : null;
        self.sendCompatInput({ type: 'touch', event: 'start', points: rest });
        return;
      }
      // 还有手指按着：只上报本次被抬起的那几根（取 changedTouches）。
      // 实测：CDP touchEnd 的 touchPoints 就是「要抬起的点」，传剩余点会抬错手指——
      // 按住摇杆再点攻击键时反而会松开摇杆，这正是「不能同时按攻击键和方向键」的原因。
      if (left > 0) {
        self.clearCompatLongPress();
        self._compatHoldPending = false;
        self._compatHoldFired = false;
        var released = self.compatTouchPoints(e.changedTouches);
        var pts = self.compatTouchPoints(e.touches);
        self._compatTouchCount = pts.length;
        self._compatMulti = pts.length > 1;
        self._compatTouch = pts.length === 1 ? {
          id: pts[0].id,
          lastX: pts[0].x,
          lastY: pts[0].y,
          originX: pts[0].x,
          originY: pts[0].y
        } : null;
        // changedTouches 为空属于异常事件，宁可不下发也不能误抬全部手指
        if (released.length) {
          self.sendCompatInput({ type: 'touch', event: 'end', points: released });
        }
        return;
      }
      self.clearCompatLongPress();
      self._compatTouchCount = 0;
      self._compatTouchDown = false;
      var fired = self._compatHoldFired;
      self._compatHoldPending = false;
      self._compatHoldFired = false;
      self._compatTouch = null;
      self._compatMulti = false;
      // 不要在前端补「甩动惯性」：CDP 触摸序列在页面里会由浏览器自己算出惯性，
      // 前端再补一段 6 步补间就会叠加成「划一点却滑出去很远」的飘移感。
      // 长按已触发（服务端补了右键）时用 cancel 收尾，避免 touchend 再合成一次点击把菜单点掉。
      self.sendCompatInput({ type: 'touch', event: fired ? 'cancel' : 'end', points: [] });
    },
    onCompatTouchCancel: function() {
      this.clearCompatLongPress();
      this._compatHoldPending = false;
      this._compatHoldFired = false;
      this._compatPinch = null;
      // 多指序列没有 _compatTouch，必须靠计数判断是否需要通知服务端取消，
      // 否则页面会以为手指还按着（摇杆卡死在推满状态）
      var active = this._compatTouchDown || this._compatTouchCount > 0;
      this._compatTouch = null;
      this._compatMulti = false;
      this._compatTouchCount = 0;
      this._compatTouchDown = false;
      if (!active) return;
      this.sendCompatInput({ type: 'touch', event: 'cancel', points: [] });
    },
    // ===== 移动端文字输入：把输入条里的内容插入无头浏览器的焦点元素 =====
    toggleCompatKeyboard: function() {
      var self = this;
      self.compatKeyboardOpen = !self.compatKeyboardOpen;
      if (self.compatKeyboardOpen) {
        self.$nextTick(function() {
          if (self.$refs.compatTextInput) self.$refs.compatTextInput.focus();
        });
      }
    },
    onCompatTextInput: function(e) {
      // 输入法组合期间不转发，等 compositionend 一次性发送最终文本
      if (this._compatComposing) return;
      var value = e && e.target ? e.target.value : this.compatText;
      this.flushCompatText(value);
    },
    onCompatCompositionStart: function() {
      this._compatComposing = true;
    },
    onCompatCompositionEnd: function(e) {
      this._compatComposing = false;
      var value = e && e.target ? e.target.value : this.compatText;
      this.flushCompatText(value);
    },
    flushCompatText: function(value) {
      var text = typeof value === 'string' ? value : this.compatText;
      if (!text) return;
      this.compatText = '';
      this.sendCompatInput({ type: 'text', text: text });
    },
    onCompatTextSend: function() {
      if (this.compatText) {
        var text = this.compatText;
        this.compatText = '';
        this.sendCompatInput({ type: 'text', text: text });
      }
      this.sendCompatInput({ type: 'key', key: 'Enter', event: 'down' });
    },
    onCompatTextKeydown: function(e) {
      if (this._compatComposing || e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.onCompatTextSend();
        return;
      }
      // 输入框已空时的退格才转发给页面（有内容时由输入框自己删）
      if (e.key === 'Backspace' && !this.compatText) {
        e.preventDefault();
        this.sendCompatInput({ type: 'key', key: 'Backspace', event: 'down' });
      }
    },
    // 键盘：功能键走 key 事件，可打印字符走 insertText（避免输入法与组合键问题）
    onCompatKeyDown: function(e) {
      var key = e.key;
      if (!key) return;
      // 组合键交给浏览器自身处理（复制粘贴等），不转发以免与服务端状态错乱
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'Enter' || key === 'Backspace' || key === 'Tab' || key === 'Escape' ||
          key === 'Delete' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' ||
          key === 'ArrowRight' || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') {
        e.preventDefault();
        this.sendCompatInput({ type: 'key', key: key, event: 'down' });
        return;
      }
      if (key.length === 1) {
        e.preventDefault();
        this.sendCompatInput({ type: 'text', text: key });
      }
    },
    // 从服务端拉取当前账号的浏览器数据，与本地合并后写回（多设备同步的核心）。
    // 本地还有未上传改动时跳过本次拉取，避免刚加的历史被远端旧数据覆盖。
    syncBrowserData: function() {
      var self = this;
      if (self._browserDataPending) return;
      if (!currentAccountId()) return;
      api.get('/web-proxy/browser-data').then(function(response) {
        var data = response && response.data && response.data.data;
        if (!data) return;
        var localHistory = loadFromStorage(scopedKey('history'));
        var localBookmarks = loadFromStorage(scopedKey('bookmarks'));
        var localHomepage = localStorage.getItem(scopedKey('homepage')) || '';
        var remoteHistory = Array.isArray(data.history) ? data.history : [];
        var remoteBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
        var serverAt = Number(data.updatedAt) || 0;
        var lastSeen = Number(localStorage.getItem(scopedKey('serverAt'))) || 0;
        // 服务端在别的设备上被改过（含删除）：以服务端为准，本机只保留那次改动之后
        // 新产生的记录。否则本机缓存的旧条目会把别处刚删掉的记录又带回来。
        var remoteChanged = lastSeen > 0 && serverAt > lastSeen;
        var history = mergeBrowserEntries(
          remoteChanged ? entriesAfter(localHistory, serverAt) : localHistory,
          remoteHistory, true, MAX_HISTORY);
        var bookmarks = mergeBrowserEntries(
          remoteChanged ? entriesAfter(localBookmarks, serverAt) : localBookmarks,
          remoteBookmarks, false, MAX_BOOKMARKS);
        // 首页：服务端改过就以服务端为准（含被清空），否则本地有值时兜底
        var homepage = remoteChanged ? (data.homepage || '') : (data.homepage || localHomepage);
        self.history = history;
        self.bookmarks = bookmarks;
        self.homepage = homepage;
        saveToStorage(scopedKey('history'), history);
        saveToStorage(scopedKey('bookmarks'), bookmarks);
        if (homepage) localStorage.setItem(scopedKey('homepage'), homepage);
        else if (remoteChanged) localStorage.removeItem(scopedKey('homepage'));
        localStorage.setItem(scopedKey('serverAt'), String(serverAt));
        // 本机有、服务端还没有的记录（首次接管 / 断网期间的浏览）补传上去，
        // 否则这些数据永远只留在本机，换设备看不到。
        var seed = {};
        if (history.length > remoteHistory.length) seed.history = history;
        if (bookmarks.length > remoteBookmarks.length) seed.bookmarks = bookmarks;
        if (homepage && homepage !== data.homepage) seed.homepage = homepage;
        if (seed.history || seed.bookmarks || seed.homepage) self.pushBrowserData(seed);
      }).catch(function() {
        // 插件未安装 / 未登录 / 断网：保持本地数据，不影响正常浏览
      });
    },
    // 本地变更后上传（防抖合并）：只提交本次变动的字段，服务端按 url 合并而不是整包覆盖
    pushBrowserData: function(patch) {
      var self = this;
      if (!currentAccountId() || !patch) return;
      var merged = {};
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
      }
      var prev = self._browserDataPatch || {};
      for (var p in prev) {
        if (Object.prototype.hasOwnProperty.call(prev, p) && !Object.prototype.hasOwnProperty.call(merged, p)) {
          merged[p] = prev[p];
        }
      }
      self._browserDataPatch = merged;
      self._browserDataPending = true;
      clearTimeout(self._browserDataTimer);
      self._browserDataTimer = setTimeout(function() {
        self._browserDataTimer = null;
        var body = self._browserDataPatch || {};
        self._browserDataPatch = null;
        api.post('/web-proxy/browser-data', body).then(function(response) {
          // 记下服务端本次的时间戳：下次拉取时用它判断「别处是否改过」，
          // 避免本机旧缓存把别处已删除的记录合并回来。
          var saved = response && response.data && response.data.data;
          if (saved && saved.updatedAt) {
            localStorage.setItem(scopedKey('serverAt'), String(saved.updatedAt));
          }
          self._browserDataPending = false;
        }).catch(function() {
          // 失败不重试轰炸：等下一次变更 / 回到前台再补传
          self._browserDataPending = false;
        });
      }, SYNC_DEBOUNCE_MS);
    },
    addHistory: function(url) {
      var self = this;
      // 去重：移除已存在的相同 URL
      self.history = self.history.filter(function(h) { return h.url !== url; });
      self.history.unshift({ url: url, title: '', time: Date.now() });
      if (self.history.length > MAX_HISTORY) self.history = self.history.slice(0, MAX_HISTORY);
      saveToStorage(scopedKey('history'), self.history);
      self.pushBrowserData({ history: self.history });
    },
    // 按当前账号重新载入历史 / 收藏 / 主页（账号切换时调用）
    reloadBrowserData: function() {
      migrateLegacyData();
      this.history = loadFromStorage(scopedKey('history'));
      this.bookmarks = loadFromStorage(scopedKey('bookmarks'));
      this.homepage = localStorage.getItem(scopedKey('homepage')) || '';
    },
    removeHistory: function(idx) {
      this.history.splice(idx, 1);
      saveToStorage(scopedKey('history'), this.history);
      // replaceHistory：删除提交的是「删后的完整列表」，语义是以这份为准，
      // 否则服务端并集合并会把刚删掉的记录又合回来。
      this.pushBrowserData({ history: this.history, replaceHistory: true });
    },
    clearHistory: function() {
      this.history = [];
      saveToStorage(scopedKey('history'), []);
      this.pushBrowserData({ history: [], replaceHistory: true });
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
        saveToStorage(scopedKey('bookmarks'), self.bookmarks);
        // 取消收藏同删除：以「删后的完整列表」为准，避免被并集合并复活
        self.pushBrowserData({ bookmarks: self.bookmarks, replaceBookmarks: true });
        return;
      }
      self.bookmarks.unshift({ url: self.currentUrl, title: '', time: Date.now() });
      saveToStorage(scopedKey('bookmarks'), self.bookmarks);
      // 新增收藏走并集：本机还没同步到的其他设备收藏不会被覆盖
      self.pushBrowserData({ bookmarks: self.bookmarks });
    },
    removeBookmark: function(idx) {
      this.bookmarks.splice(idx, 1);
      saveToStorage(scopedKey('bookmarks'), this.bookmarks);
      this.pushBrowserData({ bookmarks: this.bookmarks, replaceBookmarks: true });
    },
    stopBrowsing: function() {
      this.stopLoading();
      // 退出兼容模式：关闭渲染会话，释放服务端浏览器
      this.compatMode = false;
      this.disconnectCompat();
      this.currentUrl = '';
      this.frameSrc = '';
      this.activeTab = 'history';
    },
    goBack: function() {
      if (!this.currentUrl) {
        this.$router.push({ name: 'Desktop' }).catch(function() {});
        return;
      }
      // 兼容模式：页面自身还有历史时先页内后退，退到首站才退出浏览
      if (this.compatMode && this.compatCanBack) {
        this._compatFrameShown = false;
        this.startLoading();
        this.sendCompatInput({ type: 'back' });
        return;
      }
      this.stopBrowsing();
    },
    saveHomepage: function() {
      var self = this;
      var url = (self.homepageDraft || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      self.homepage = url;
      localStorage.setItem(scopedKey('homepage'), url);
      self.pushBrowserData({ homepage: url });
      self.showHomepageInput = false;
    },
    clearHomepage: function() {
      this.homepage = '';
      this.homepageDraft = '';
      localStorage.removeItem(scopedKey('homepage'));
      this.pushBrowserData({ homepage: '' });
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
      // 兼容模式画布内的滑动属于网页自身滚动，不参与「边缘右滑返回」
      // （iframe 会拦下触摸事件，canvas 不会冒泡到这里，必须显式过滤）
      var target = e.target;
      if (target && target.classList && target.classList.contains('browser-compat-canvas')) return;
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

/* 代理状态提示：小胶囊，仅用主色文字 + 描边，随主题自动适配 */
.browser-proxy-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1;
  color: var(--primary-color);
  white-space: nowrap;
}
.browser-proxy-chip i {
  font-size: 11px;
}
/* 兼容模式标识：用警示色区分「已切到服务端渲染」 */
.browser-compat-chip {
  color: var(--warning-color);
  border-color: var(--warning-color);
}
/* 兼容模式开关按钮 */
.browser-compat-btn.active {
  color: var(--warning-color);
}
/* 兼容模式声音按钮：开启为主色；有声音在播时轻微脉动，给「确实出声」的可见反馈 */
.browser-audio-btn {
  color: var(--text-tertiary);
}
.browser-audio-btn.active {
  color: var(--primary-color);
}
.browser-audio-btn.pulsing {
  animation: browser-audio-pulse 0.6s ease-out;
}
.browser-audio-btn:disabled {
  opacity: 0.4;
}
@keyframes browser-audio-pulse {
  0% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 0, 122, 255), 0.32); }
  100% { box-shadow: 0 0 0 9px rgba(var(--primary-rgb, 0, 122, 255), 0); }
}
/* 窄屏下只保留闪电图标并压缩按钮密度：兼容模式会多出声音按钮，
   手机上地址栏可用宽度有限，不收紧间距会挤出可视区 */
@media (max-width: 560px) {
  .browser-toolbar { gap: 4px; padding-left: 8px; padding-right: 8px; }
  .browser-btn { width: 32px; height: 32px; font-size: 14px; }
  .browser-proxy-chip { padding: 0 8px; }
  .browser-proxy-chip span { display: none; }
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
  color: var(--warning-color);
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
  transition: border-color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard),
              background-color var(--duration-fast) var(--ease-standard);
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
  transition: opacity var(--duration-fast) var(--ease-standard),
              transform var(--duration-fast) var(--ease-emphasized);
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
  position: relative;
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

/* 兼容模式画布：等比缩放显示服务端渲染画面（留白居中，不拉伸变形） */
.browser-compat-canvas {
  object-fit: contain;
  object-position: center center;
  background: #fff;
  outline: none;
  cursor: default;
  /* 触摸事件全部由 JS 转发给服务端（含滚动），禁用浏览器默认手势避免双重滚动/缩放 */
  touch-action: none;
  /* 避免手机下拉刷新 / 长按弹出系统菜单抢占手势 */
  overscroll-behavior: contain;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
/* 兼容模式异常提示：底部悬浮条，避免整页被错误态占满 */
.browser-compat-error {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 32px);
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 13px;
  color: var(--text-secondary);
  z-index: 3;
}
.browser-compat-error i {
  color: var(--warning-color);
}
/* 云游戏画质回执：非错误提示，用主色；不拦截触摸，避免挡住画面操作 */
.browser-game-tip {
  pointer-events: none;
  z-index: 4;
}
.browser-game-tip i {
  color: var(--primary-color);
}
.browser-compat-exit {
  flex-shrink: 0;
}
/* 移动端键盘按钮：画面流无法唤起系统键盘，点此展开中转输入条 */
.browser-compat-kbd-btn {
  position: absolute;
  right: 14px;
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  z-index: 3;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: var(--card-bg);
  color: var(--text-secondary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  font-size: 16px;
}
.browser-compat-kbd-btn:active {
  transform: scale(0.94);
}
/* 移动端输入条：输入内容通过 CDP 插入页面焦点元素 */
.browser-compat-inputbar {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 22px;
  background: var(--card-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.browser-compat-text {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
}
.browser-compat-kbd-send,
.browser-compat-kbd-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary-color);
  font-size: 13px;
}
.browser-compat-kbd-close {
  background: var(--bg-color);
  color: var(--text-tertiary);
}

/* ========== 加载指示器（覆盖在 iframe 之上，避免加载期白屏无反馈） ========== */
.browser-loading {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  background: var(--card-bg);
  z-index: 3;
}
.browser-loading-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  animation: browser-loading-spin 0.8s linear infinite;
}
.browser-loading-text {
  max-width: 320px;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  color: var(--text-secondary);
}
/* 目标站点 + 已等待秒数：弱化显示，提供「仍在进行」的确定性反馈 */
.browser-loading-host {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  color: var(--text-tertiary);
  word-break: break-all;
}
@keyframes browser-loading-spin {
  to { transform: rotate(360deg); }
}
/* 减弱动效偏好下放慢旋转，避免眩晕 */
@media (prefers-reduced-motion: reduce) {
  .browser-loading-spinner { animation-duration: 2.4s; }
  .browser-audio-btn.pulsing { animation: none; }
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
  color: var(--warning-color);
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
  color: var(--danger-color);
  border: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: var(--font-weight-medium, 500);
}
.browser-clear-btn:hover {
  background: rgba(255, 59, 48, 0.06);
  border-color: var(--danger-color);
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
  background: var(--surface-elevated);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.12);
  animation: capsule-pop 0.32s var(--ease-spring);
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
  background: var(--success-color);
}
.capsule-to-community:hover {
  background: var(--success-color);
  opacity: 1;
}

/* 胶囊入场过渡（v-if 切换） */
.capsule-slide-enter-active,
.capsule-slide-leave-active {
  transition: opacity var(--duration-fast) var(--ease-decelerate);
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
