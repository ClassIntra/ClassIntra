<template>
  <div
    class="desktop"
    :class="{ 'desktop-enter': entered, 'desktop--editing': isEditMode, 'desktop--dragging': isDragging, 'desktop--grid': isGridLayout }"
    @touchstart="onDesktopTouchStart"
    @touchmove="onDesktopTouchMove"
    @touchend="onDesktopTouchEnd"
    @mousedown="onDesktopMouseDown"
  >
    <template v-if="videoWallpaperSrc && !videoWallpaperFailed">
      <video
        ref="videoA"
        class="desktop-video-wallpaper"
        :class="{ 'video-active': activeVideo === 'A' }"
        :src="videoWallpaperSrc"
        preload="none"
        autoplay
        muted
        playsinline
        loop
        disablePictureInPicture
        @loadedmetadata="onVideoMeta"
        @waiting="onVideoWaiting"
        @playing="onVideoPlaying"
        @canplay="onVideoCanPlay"
        @error="onVideoError"
      ></video>
    </template>
    <div v-else class="desktop-static-wallpaper" :style="staticWallpaperStyle"></div>

    <transition name="announcement-float">
      <div
        v-if="showAnnouncementFloat && hasUnreadAnnouncements && currentAnnouncement"
        class="announcement-float"
      >
        <div class="announcement-float-header">
          <div class="announcement-float-badge">
            <i class="fa-solid fa-bullhorn"></i>
            <span>新公告</span>
          </div>
          <button class="announcement-float-close" @click="dismissAllAnnouncements">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="announcement-float-body">
          <h4 class="announcement-float-title">{{ currentAnnouncement.title }}</h4>
          <p class="announcement-float-content">
            {{ currentAnnouncement.content && currentAnnouncement.content.length > 100 ? currentAnnouncement.content.substring(0, 100) + '...' : currentAnnouncement.content }}
          </p>
        </div>
        <div class="announcement-float-footer">
          <span class="announcement-float-indicator">
            {{ currentAnnouncementIndex + 1 }} / {{ unreadAnnouncements.length }}
          </span>
          <div class="announcement-float-actions">
            <button class="announcement-float-btn announcement-float-btn-view" @click="goToAnnouncements">
              <i class="fa-solid fa-list"></i> 查看全部
            </button>
            <button class="announcement-float-btn announcement-float-btn-dismiss" @click="dismissAnnouncement">
              <i class="fa-solid fa-check"></i> 已读
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- iPad 桌面模式：多页面容器 + 4×6 网格 -->
    <div v-if="isGridLayout && isLoaded" class="desktop-pages" :style="pagesTransformStyle">
      <div
        v-for="(page, pageIndex) in pages"
        :key="page.id"
        class="desktop-page"
      >
        <div class="desktop-grid">
          <div
            v-for="(slot, index) in page.slots"
            :key="index"
            class="desktop-slot"
            :class="{
              'slot--empty': !slot,
              'slot--drop-target': isDropTarget('page', pageIndex, index)
            }"
            :data-dst-type="'page'"
            :data-dst-page="pageIndex"
            :data-dst-idx="index"
          >
            <template v-if="slot">
              <AppIcon
                v-if="slot.type === 'app'"
                :app="appMeta(slot.name) || placeholderApp(slot.name)"
                :badge="appBadges[slot.name] || ''"
                :launching="launchingApp === slot.name"
                :editing="isEditMode"
                :pinned="pinnedAppNames.indexOf(slot.name) !== -1"
                :show-label="false"
                :data-src-type="'page'"
                :data-src-page="pageIndex"
                :data-src-idx="index"
                :data-src-app="slot.name"
                :data-flip-key="'page-app-' + slot.name"
                @launch="launchApp"
                @remove="onRemoveApp(pageIndex, index)"
              />
              <DesktopFolder
                v-else
                :folder="folderById(slot.id) || { id: slot.id, name: '文件夹', apps: [] }"
                :editing="isEditMode"
                :data-src-type="'page'"
                :data-src-page="pageIndex"
                :data-src-idx="index"
                :data-src-app="slot.id"
                :data-flip-key="'page-folder-' + slot.id"
                @open="openFolder(slot.id)"
                @remove="onDeleteFolder(slot.id)"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页点指示器 -->
    <DesktopPageIndicator
      v-if="isGridLayout && isLoaded"
      :total="totalPages"
      :current="currentPage"
      :max-pages="9"
      @jump="setCurrentPage"
      @add-page="addPage"
    />

    <!-- Dock 栏（transition-group 实现图标进出动画 + 自动扩展/缩减） -->
    <!-- dock-bar 本身作为 "append" 追加落点（拖到 Dock 空白处即追加到末尾） -->
    <transition-group
      name="dock-slot"
      tag="div"
      class="dock-bar"
      :class="{ 'dock-bar--editing': isEditMode, 'dock-bar--empty': effectiveDockApps.length === 0 }"
      :data-dst-type="isGridLayout ? 'dock' : null"
      :data-dst-dock="isGridLayout ? 'append' : null"
    >
      <div v-if="effectiveDockApps.length === 0" key="dock-empty" class="dock-empty-hint">
        暂无可用应用
      </div>
      <div
        v-for="(name, i) in effectiveDockApps"
        :key="'dock-' + name"
        class="dock-slot"
        :class="{ 'dock-slot--launching': launchingApp === name, 'slot--drop-target': isDropTarget('dock', null, i) }"
        :data-dst-type="isGridLayout ? 'dock' : null"
        :data-dst-dock="isGridLayout ? i : null"
        :data-src-type="isGridLayout ? 'dock' : null"
        :data-src-dock="isGridLayout ? i : null"
        :data-src-app="isGridLayout ? name : null"
        :data-flip-key="'dock-' + name"
        @click="launchApp(dockAppMeta(name))"
      >
        <div class="dock-icon">
          <img :src="dockAppMeta(name).icon" :alt="dockAppMeta(name).label" loading="eager">
        </div>
        <span v-if="appBadges[name]" class="dock-badge" :class="{ 'dock-badge-dot': appBadges[name] === '●' }">{{ appBadges[name] === '●' ? '' : appBadges[name] }}</span>
      </div>
    </transition-group>

    <!-- 文件夹展开层 -->
    <transition name="folder-expand">
      <DesktopFolder
        v-if="openFolderId"
        :folder="folderById(openFolderId)"
        :expanded="true"
        :editing="isEditMode"
        @close="closeFolder"
        @rename="onRenameFolder"
        @remove="onDeleteFolder(openFolderId)"
        @launch-app="launchAppByName"
        @remove-app="onRemoveAppFromFolder"
      />
    </transition>

    <!-- 捏合调出的设置面板 -->
    <DesktopSettingsPanel
      :visible="settingsPanelOpen"
      :total-pages="totalPages"
      :current-page="currentPage"
      :max-pages="9"
      @close="closeSettingsPanel"
      @done="onSettingsDone"
      @add-page="addPage"
      @remove-page="removePage"
      @tidy="tidyCurrentPage"
      @reset="resetLayout"
    />
  </div>
</template>

<script>
import api from '@/utils/api';
import updateChecker from '@/utils/update-checker';
import AppIcon from '@/components/AppIcon.vue';
import DesktopFolder from '@/components/DesktopFolder.vue';
import DesktopPageIndicator from '@/components/DesktopPageIndicator.vue';
import DesktopSettingsPanel from '@/components/DesktopSettingsPanel.vue';
import desktopDrag from '@/mixins/desktop-drag.js';
import desktopGestures from '@/mixins/desktop-gestures.js';
import { APP_REGISTRY } from '@/store/modules/desktop.js';

var WALLPAPER_MAP = {
  'default': 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 50%, #BFEEFF 100%)',
  'ocean': 'linear-gradient(135deg, #003D7A 0%, #007AFF 50%, #5AC8FA 100%)',
  'sky': 'linear-gradient(135deg, #0A84FF 0%, #5AC8FA 40%, #BFEEFF 100%)',
  'night': 'linear-gradient(135deg, #000000 0%, #1C1C1E 50%, #2C2C2E 100%)',
  'dawn': 'linear-gradient(135deg, #FF9500 0%, #FF2D55 30%, #FFCC00 100%)',
  'arctic': 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 50%, #90CAF9 100%)'
};

var VIDEO_EXTS = ['.mp4', '.webm', '.mov'];
var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

function isVideoWallpaper(wp) {
  if (!wp) return false;
  for (var i = 0; i < VIDEO_EXTS.length; i++) {
    if (wp.endsWith(VIDEO_EXTS[i])) return true;
  }
  return false;
}

function isImageFile(wp) {
  if (!wp) return false;
  for (var i = 0; i < IMAGE_EXTS.length; i++) {
    if (wp.endsWith(IMAGE_EXTS[i])) return true;
  }
  return false;
}

export default {
  name: 'Desktop',
  components: {
    AppIcon: AppIcon,
    DesktopFolder: DesktopFolder,
    DesktopPageIndicator: DesktopPageIndicator,
    DesktopSettingsPanel: DesktopSettingsPanel
  },
  mixins: [desktopDrag, desktopGestures],
  data: function() {
    return {
      entered: false,
      launchingApp: '',
      touchStartY: 0,
      mouseStartY: 0,
      videoBuffering: false,
      videoWallpaperFailed: false,
      videoPerformanceLevel: 2,
      videoStallCount: 0,
      videoLastStallTime: 0,
      videoRetryCount: 0,
      performanceCheckTimer: null,
      activeVideo: 'A',
      unreadAnnouncements: [],
      showAnnouncementFloat: false,
      currentAnnouncementIndex: 0,
      newVersionAvailable: false,
      latestVersion: '',
      // 应用元数据（从 APP_REGISTRY 引用，作为降级备份）
      dockApps: APP_REGISTRY,
      enabledApps: null  // null=未加载，数组=已加载的启用应用名列表
    };
  },
  computed: {
    wallpaper: function() {
      return this.$store.state.settings.wallpaper;
    },
    videoWallpaperSrc: function() {
      var wp = this.wallpaper;
      if (!wp) return '';
      if (isVideoWallpaper(wp)) {
        if (wp.startsWith('/') || wp.startsWith('http')) return wp;
        return '/resources/public/wallpaper/' + wp;
      }
      return '';
    },
    staticWallpaperStyle: function() {
      var wp = this.wallpaper || 'default';
      if (wp.startsWith('/') || wp.startsWith('http')) {
        return {
          backgroundImage: 'url(' + wp + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        };
      }
      if (isImageFile(wp)) {
        return {
          backgroundImage: 'url(/resources/public/wallpaper/' + wp + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        };
      }
      if (WALLPAPER_MAP[wp]) {
        return { background: WALLPAPER_MAP[wp] };
      }
      return { background: WALLPAPER_MAP['default'] };
    },
    appBadges: function() {
      var badges = {};
      var unread = this.$store.state.chat.unread || {};
      var totalChat = 0;
      var keys = Object.keys(unread);
      for (var i = 0; i < keys.length; i++) {
        totalChat += unread[keys[i]] || 0;
      }
      if (totalChat > 0) {
        badges['chat'] = totalChat > 99 ? '99+' : totalChat;
      }
      if (this.newVersionAvailable) {
        badges['settings'] = '●';
      }
      return badges;
    },
    // 桌面布局是否已加载
    isLoaded: function() {
      return this.$store.getters['desktop/isLoaded'];
    },
    // 桌面布局模式：'grid'（iPad 桌面图标）| 'dock'（仅 Dock）
    isGridLayout: function() {
      return this.$store.getters['settings/desktopLayout'] === 'grid';
    },
    // 所有页面
    pages: function() {
      var layout = this.$store.state.desktop.layout;
      return layout ? layout.pages : [];
    },
    // 当前页索引
    currentPage: function() {
      return this.$store.state.desktop.currentPage;
    },
    // 页面容器 transform
    pagesTransformStyle: function() {
      return { transform: 'translateX(-' + (this.currentPage * 100) + '%)' };
    },
    // 总页数
    totalPages: function() {
      return this.$store.getters['desktop/totalPages'];
    },
    // 是否编辑态
    isEditMode: function() {
      return this.$store.getters['desktop/isEditMode'];
    },
    // 是否拖拽中
    isDragging: function() {
      return this.$store.getters['desktop/isDragging'];
    },
    // Dock 应用名列表
    dockAppNames: function() {
      var dockNames = this.$store.getters['desktop/dockApps'];
      // 应用管控过滤：未加载时全显示，加载后过滤禁用的
      if (this.enabledApps === null) return dockNames;
      return dockNames.filter(function(name) {
        return this.enabledApps.indexOf(name) !== -1;
      }.bind(this));
    },
    // Dock 实际渲染应用列表：
    //   grid 模式 → 仅 layout.dock（过滤禁用应用）
    //   dock-only 模式 → 聚合 pinned + dock + 所有 page app + 所有 folder app，去重，按启用列表过滤
    // dock-only 模式下布局数据不动，切回 grid 自然还原页面/文件夹
    effectiveDockApps: function() {
      if (this.isGridLayout) return this.dockAppNames;
      var layout = this.$store.state.desktop.layout;
      if (!layout) return [];
      var enabled = this.enabledApps;
      var ready = enabled !== null;
      var seen = {};
      var result = [];
      function push(name) {
        if (!name) return;
        if (ready && enabled.indexOf(name) === -1) return;
        if (seen[name]) return;
        seen[name] = true;
        result.push(name);
      }
      // 1. pinned 优先（固定应用恒定首位）
      (layout.pinnedApps || []).forEach(push);
      // 2. Dock 原有顺序
      layout.dock.forEach(push);
      // 3. 所有页面 app（按页序、slot 序）
      layout.pages.forEach(function(p) {
        p.slots.forEach(function(s) {
          if (s && s.type === 'app') push(s.name);
        });
      });
      // 4. 所有文件夹内 app（按 folder id 序）
      Object.keys(layout.folders).sort().forEach(function(fid) {
        (layout.folders[fid].apps || []).forEach(push);
      });
      return result;
    },
    // 固定应用名列表
    pinnedAppNames: function() {
      return this.$store.getters['desktop/pinnedApps'];
    },
    // 当前打开的文件夹 id
    openFolderId: function() {
      return this.$store.getters['desktop/openFolderId'];
    },
    // 设置面板是否打开
    settingsPanelOpen: function() {
      return this.$store.getters['desktop/settingsPanelOpen'];
    },
    hasUnreadAnnouncements: function() {
      return this.unreadAnnouncements.length > 0;
    },
    currentAnnouncement: function() {
      if (this.unreadAnnouncements.length === 0) return null;
      return this.unreadAnnouncements[this.currentAnnouncementIndex] || null;
    }
  },
  mounted: function() {
    var self = this;
    self.detectPerformanceLevel();
    self.$nextTick(function() {
      self.entered = true;
      self.playVideoWallpaper();
    });
    self.loadUnreadAnnouncements();
    self.loadEnabledApps();
    self.checkVersionUpdate();
  },
  beforeDestroy: function() {
    if (this._updateUnsubscribe) {
      this._updateUnsubscribe();
      this._updateUnsubscribe = null;
    }
    if (this.performanceCheckTimer) {
      clearInterval(this.performanceCheckTimer);
      this.performanceCheckTimer = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    var video = this.$refs.videoA;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },
  watch: {
    videoWallpaperSrc: function() {
      var self = this;
      self.videoStallCount = 0;
      self.$nextTick(function() {
        self.playVideoWallpaper();
      });
    }
  },
  methods: {
    detectPerformanceLevel: function() {
      var self = this;
      var existingPerf = document.documentElement.getAttribute('data-perf');
      if (existingPerf === 'high') {
        self.videoPerformanceLevel = 3;
      } else if (existingPerf === 'medium') {
        self.videoPerformanceLevel = 2;
      } else if (existingPerf === 'low') {
        self.videoPerformanceLevel = 1;
      } else {
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        var cores = navigator.hardwareConcurrency || 2;
        var memory = navigator.deviceMemory || 4;
        var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        var dpr = window.devicePixelRatio || 1;
        var pixels = window.screen.width * window.screen.height * dpr * dpr;

        var score = 0;
        if (cores >= 8) score += 3;
        else if (cores >= 4) score += 2;
        else score += 1;

        if (memory >= 8) score += 3;
        else if (memory >= 4) score += 2;
        else score += 1;

        if (gl) {
          var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            var renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
            if (renderer.indexOf('nvidia') !== -1 || renderer.indexOf('radeon') !== -1 || renderer.indexOf('apple') !== -1) {
              score += 3;
            } else if (renderer.indexOf('intel') !== -1 || renderer.indexOf('adreno') !== -1 || renderer.indexOf('mali') !== -1) {
              score += 1;
            } else {
              score += 2;
            }
          } else {
            score += 2;
          }
        }

        if (isMobile) score -= 2;
        if (pixels > 4000000) score -= 1;
        if (pixels > 8000000) score -= 1;

        if (score >= 7) self.videoPerformanceLevel = 3;
        else if (score >= 4) self.videoPerformanceLevel = 2;
        else self.videoPerformanceLevel = 1;

        var perfLevel = self.videoPerformanceLevel === 3 ? 'high' : (self.videoPerformanceLevel === 2 ? 'medium' : 'low');
        document.documentElement.setAttribute('data-perf', perfLevel);
      }

      self.performanceCheckTimer = setInterval(function() {
        self.checkVideoHealth();
      }, 10000);
    },
    checkVideoHealth: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;
      if (video.paused && !video.ended && video.readyState >= 3) {
        video.play().catch(function() {});
      }
    },
    onVideoMeta: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;

      var vw = video.videoWidth || 0;
      var vh = video.videoHeight || 0;

      if (vw > 0 && vh > 0) {
        var sw = window.screen.width;
        var sh = window.screen.height;
        var videoRatio = vw / vh;
        var screenRatio = sw / sh;
        if (Math.abs(videoRatio - screenRatio) > 0.5) {
          video.style.objectFit = 'cover';
        }
      }

      if (self.videoPerformanceLevel <= 1 && vw > 1920) {
        video.style.maxWidth = '1920px';
        video.style.maxHeight = '1080px';
      }
    },
    onVideoCanPlay: function() {
      // 视频就绪，无需额外处理
    },
    onVideoWaiting: function() {
      var self = this;
      self.videoBuffering = true;
      var now = Date.now();
      if (now - self.videoLastStallTime > 5000) {
        self.videoStallCount++;
        self.videoLastStallTime = now;
      }
      if (self.videoStallCount >= 3 && self.videoPerformanceLevel > 1) {
        self.videoPerformanceLevel--;
        self.videoStallCount = 0;
        self.applyPerformanceOptimizations();
      }
    },
    onVideoPlaying: function() {
      this.videoBuffering = false;
      this.videoRetryCount = 0;
    },
    onVideoError: function() {
      var self = this;
      self.videoBuffering = false;
      if (self.videoRetryCount < 3) {
        self.videoRetryCount++;
        if (self._retryTimer) clearTimeout(self._retryTimer);
        self._retryTimer = setTimeout(function() {
          self._retryTimer = null;
          self.retryVideoPlayback();
        }, 2000 * self.videoRetryCount);
      } else {
        self.videoWallpaperFailed = true;
      }
    },
    retryVideoPlayback: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;
      video.load();
      video.play().catch(function() {});
    },
    applyPerformanceOptimizations: function() {
      var video = this.$refs.videoA;
      if (!video) return;
      if (this.videoPerformanceLevel <= 1) {
        video.playbackRate = 0.75;
      } else if (this.videoPerformanceLevel === 2) {
        video.playbackRate = 0.9;
      } else {
        video.playbackRate = 1.0;
      }
    },
    // ===== 桌面手势入口（转发到 mixin）=====
    onDesktopTouchStart: function(e) {
      this.onDesktopGestureTouchStart(e);
      // 编辑态下转发到拖拽引擎
      if (this.isEditMode) {
        this.onPointerDown(e);
      }
    },
    onDesktopTouchMove: function(e) {
      this.onDesktopGestureTouchMove(e);
    },
    onDesktopTouchEnd: function(e) {
      this.onDesktopGestureTouchEnd(e);
    },
    onDesktopMouseDown: function(e) {
      if (this.isEditMode) {
        this.onPointerDown(e);
      }
    },
    // ===== 应用元数据 =====
    appMeta: function(name) {
      return this.$store.getters['desktop/appByName'](name);
    },
    placeholderApp: function(name) {
      return { name: name, label: name, icon: '', color: '#8E8E93', route: '' };
    },
    // 根据 id 查文件夹对象（委托 store getter，修复模板调用 folderById is not a function）
    folderById: function(fid) {
      return this.$store.getters['desktop/folderById'](fid);
    },
    // ===== 文件夹操作 =====
    openFolder: function(folderId) {
      this.$store.commit('desktop/SET_OPEN_FOLDER', folderId);
    },
    closeFolder: function() {
      this.$store.commit('desktop/SET_OPEN_FOLDER', null);
    },
    onRenameFolder: function(payload) {
      this.$store.commit('desktop/RENAME_FOLDER', { folderId: payload.folder.id, name: payload.name });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    onDeleteFolder: function(folderId) {
      this.$store.commit('desktop/DELETE_FOLDER', { folderId: folderId });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    onRemoveAppFromFolder: function(payload) {
      this.$store.commit('desktop/REMOVE_FROM_FOLDER', { folderId: payload.folder.id, appName: payload.appName });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    // ===== 桌面图标移除 =====
    onRemoveApp: function(pageIndex, index) {
      var self = this;
      var slot = this.pages[pageIndex].slots[index];
      if (!slot || slot.type !== 'app') return;
      var appName = slot.name;
      var label = (this.appMeta(appName) || {}).label || appName;
      this.$modal.confirm({
        title: '移除应用',
        message: '将"' + label + '"从桌面移除？可在设置中重置布局恢复。',
        confirmText: '移除',
        cancelText: '取消'
      }).then(function() {
        self.$store.commit('desktop/REMOVE_APP', { type: 'page', pageIndex: pageIndex, index: index });
        self.$store.dispatch('desktop/saveDesktopLayout');
      }).catch(function() {});
    },
    // 从 Dock 移除应用（拖到 Dock 删除区或编辑态删除）
    onRemoveDockApp: function(index) {
      var self = this;
      var name = this.dockAppNames[index];
      if (!name) return;
      var label = (this.appMeta(name) || {}).label || name;
      this.$modal.confirm({
        title: '移除应用',
        message: '将"' + label + '"从 Dock 移除？可在设置中重置布局恢复。',
        confirmText: '移除',
        cancelText: '取消'
      }).then(function() {
        self.$store.commit('desktop/REMOVE_APP', { type: 'dock', index: index });
        self.$store.dispatch('desktop/saveDesktopLayout');
      }).catch(function() {});
    },
    // ===== 页面管理 =====
    setCurrentPage: function(pageIndex) {
      this.$store.commit('desktop/SET_CURRENT_PAGE', pageIndex);
    },
    addPage: function() {
      this.$store.commit('desktop/ADD_PAGE');
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    // 删除当前桌面页（仅允许 > 1 页时删除）
    removePage: function() {
      var self = this;
      if (this.totalPages <= 1) {
        if (this.$store.state.toast) {
          this.$store.commit('toast/SHOW_TOAST', { message: '至少保留一个桌面', type: 'info' });
        }
        return;
      }
      this.$modal.confirm({
        title: '删除桌面页',
        message: '将删除第 ' + (this.currentPage + 1) + ' 页，页内图标会迁移到其他页面。确定继续吗？',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function() {
        self.$store.dispatch('desktop/removePage', self.currentPage);
      }).catch(function() {});
    },
    tidyCurrentPage: function() {
      this.$store.commit('desktop/TIDY_PAGE', this.currentPage);
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    resetLayout: function() {
      this.$store.dispatch('desktop/resetLayout', this.enabledApps || []);
      if (this.$store.state.toast) {
        this.$store.commit('toast/SHOW_TOAST', { message: '桌面布局已重置', type: 'success' });
      }
    },
    // ===== 设置面板 =====
    closeSettingsPanel: function() {
      this.$store.commit('desktop/SET_SETTINGS_PANEL', false);
    },
    onSettingsDone: function() {
      this.$store.commit('desktop/SET_SETTINGS_PANEL', false);
      this.$store.dispatch('desktop/exitEditMode');
    },
    // ===== 启动应用 =====
    launchApp: function(app) {
      var self = this;
      if (!app) return;
      if (app.name === 'settings') {
        self.markVersionSeen();
      }
      self.launchingApp = app.name;
      setTimeout(function() {
        self.launchingApp = '';
        self.$router.push(app.route).catch(function() {});
      }, 250);
    },
    launchAppByName: function(name) {
      var meta = this.appMeta(name);
      if (meta) {
        this.closeFolder();
        this.launchApp(meta);
      }
    },
    playVideoWallpaper: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;
      self.activeVideo = 'A';
      self.applyPerformanceOptimizations();
      video.play().catch(function() {
        video.addEventListener('canplay', function onCanPlay() {
          video.removeEventListener('canplay', onCanPlay);
          video.play().catch(function() {});
        });
      });
    },
    loadUnreadAnnouncements: function() {
      var self = this;
      api.get('/assets/announcements').then(function(response) {
        var announcements = response.data.data || [];
        var readIds = [];
        try {
          var stored = localStorage.getItem('classintra_read_announcements');
          if (stored) {
            readIds = JSON.parse(stored);
          }
        } catch (e) {
          readIds = [];
        }
        self.unreadAnnouncements = announcements.filter(function(a) {
          return readIds.indexOf(a.id) === -1;
        });
        if (self.unreadAnnouncements.length > 0) {
          self.currentAnnouncementIndex = 0;
          self.showAnnouncementFloat = true;
        }
      }).catch(function() {
        self.unreadAnnouncements = [];
      });
    },
    // 加载后端应用管控状态，过滤桌面禁用的应用
    loadEnabledApps: function() {
      var self = this;
      api.get('/system/app-control').then(function(response) {
        var data = response.data.data || {};
        self.enabledApps = data.enabled_apps || [];
        // 加载桌面布局（传入启用的应用列表用于默认布局生成）
        self.$store.dispatch('desktop/loadDesktopLayout', self.enabledApps);
      }).catch(function() {
        // 降级：全部启用
        self.enabledApps = self.dockApps.map(function(app) { return app.name; });
        self.$store.dispatch('desktop/loadDesktopLayout', self.enabledApps);
      });
    },
    checkVersionUpdate: function() {
      var self = this;
      if (updateChecker.isUpdateAvailable()) {
        var info = updateChecker.getCurrentVersionInfo();
        if (info) {
          var storedVersion = localStorage.getItem('classintra_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.version, storedVersion) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.version;
          }
        }
      }
      self._updateUnsubscribe = updateChecker.onUpdateAvailable(function(event, info) {
        if (info && info.serverVersion) {
          var storedVer = localStorage.getItem('classintra_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.serverVersion, storedVer) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.serverVersion;
          }
        }
      });
    },
    markVersionSeen: function() {
      if (this.newVersionAvailable && this.latestVersion) {
        localStorage.setItem('classintra_seen_version', this.latestVersion);
        this.newVersionAvailable = false;
        this.latestVersion = '';
      }
    },
    dismissAnnouncement: function() {
      var self = this;
      var current = self.currentAnnouncement;
      if (!current) return;
      var readIds = [];
      try {
        var stored = localStorage.getItem('classintra_read_announcements');
        if (stored) {
          readIds = JSON.parse(stored);
        }
      } catch (e) {
        readIds = [];
      }
      if (readIds.indexOf(current.id) === -1) {
        readIds.push(current.id);
      }
      localStorage.setItem('classintra_read_announcements', JSON.stringify(readIds));
      self.unreadAnnouncements.splice(self.currentAnnouncementIndex, 1);
      if (self.unreadAnnouncements.length === 0) {
        self.showAnnouncementFloat = false;
        self.currentAnnouncementIndex = 0;
      } else if (self.currentAnnouncementIndex >= self.unreadAnnouncements.length) {
        self.currentAnnouncementIndex = self.unreadAnnouncements.length - 1;
      }
    },
    dismissAllAnnouncements: function() {
      var self = this;
      var readIds = [];
      try {
        var stored = localStorage.getItem('classintra_read_announcements');
        if (stored) {
          readIds = JSON.parse(stored);
        }
      } catch (e) {
        readIds = [];
      }
      for (var i = 0; i < self.unreadAnnouncements.length; i++) {
        var id = self.unreadAnnouncements[i].id;
        if (readIds.indexOf(id) === -1) {
          readIds.push(id);
        }
      }
      localStorage.setItem('classintra_read_announcements', JSON.stringify(readIds));
      self.unreadAnnouncements = [];
      self.showAnnouncementFloat = false;
      self.currentAnnouncementIndex = 0;
    },
    goToAnnouncements: function() {
      var self = this;
      self.showAnnouncementFloat = false;
      self.$router.push('/announcements').catch(function() {});
    }
  }
};
</script>

<style scoped>
.desktop {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #0a0a1a;
}

.desktop-video-wallpaper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -o-object-fit: cover;
  object-fit: cover;
  z-index: 0;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  will-change: transform, opacity;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  opacity: 0;
  transition: opacity 0.8s var(--ease-standard);
}

.desktop-video-wallpaper.video-active {
  opacity: 1;
}

.desktop-static-wallpaper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

/* ===== 多页面容器 ===== */
.desktop-pages {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 130px;
  display: -webkit-flex;
  display: flex;
  z-index: 1;
  transition: transform 0.35s var(--ease-decelerate);
  will-change: transform;
}

.desktop-page {
  min-width: 100%;
  -webkit-flex: 0 0 100%;
  flex: 0 0 100%;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  padding: 0 32px;
}

/* ===== 4×6 网格 ===== */
.desktop-grid {
  width: 100%;
  max-width: 760px;
  height: 100%;
  max-height: 440px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(4, 1fr);
  grid-gap: 12px;
}

.desktop-slot {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  position: relative;
  border-radius: var(--radius-lg);
  transition: background 0.15s var(--ease-standard), box-shadow 0.15s var(--ease-standard);
}

/* 落点高亮 */
.slot--drop-target {
  background: rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
}

/* 编辑态空槽位虚线提示 */
.desktop--editing .slot--empty::after {
  content: '';
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(255, 255, 255, 0.25);
}

.desktop--editing .desktop-slot {
  cursor: grab;
}
.desktop--dragging {
  cursor: grabbing;
}

/* ===== Dock 栏 ===== */
.dock-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  -webkit-transform: translateX(-50%);
  transform: translateX(-50%);
  z-index: 999;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  padding: 12px 24px;
  background: var(--dock-bg);
  -webkit-backdrop-filter: var(--glass-blur-container);
  backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-2xl);
  border: none;
  -webkit-box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06);
  transition: background 0.3s var(--ease-standard), box-shadow 0.3s var(--ease-standard);
}

.dock-bar--editing {
  -webkit-animation: dockWiggle 0.25s var(--ease-standard) infinite alternate;
  animation: dockWiggle 0.25s var(--ease-standard) infinite alternate;
}

@-webkit-keyframes dockWiggle {
  0% { -webkit-transform: translateX(-50%) rotate(-1deg); }
  100% { -webkit-transform: translateX(-50%) rotate(1deg); }
}
@keyframes dockWiggle {
  0% { transform: translateX(-50%) rotate(-1deg); }
  100% { transform: translateX(-50%) rotate(1deg); }
}

.dock-slot {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  -webkit-align-items: center;
  align-items: center;
  cursor: pointer;
  position: relative;
  margin: 0 9px;
  -webkit-transition: -webkit-transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  border-radius: var(--radius-xl);
}

.dock-slot:hover {
  -webkit-transform: scale(1.15) translateY(-6px);
  transform: scale(1.15) translateY(-6px);
}

.dock-slot:active {
  -webkit-transform: scale(0.92) translateY(0);
  transform: scale(0.92) translateY(0);
  transition-duration: 0.12s;
}

/* transition-group：Dock 图标进出动画（自动扩展/缩减） */
.dock-slot-move {
  -webkit-transition: -webkit-transform 0.35s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  transition: transform 0.35s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.dock-slot-enter-active {
  -webkit-transition: opacity 0.3s var(--ease-standard), -webkit-transform 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  transition: opacity 0.3s var(--ease-standard), transform 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.dock-slot-leave-active {
  -webkit-transition: opacity 0.25s var(--ease-accelerate), -webkit-transform 0.25s var(--ease-accelerate);
  transition: opacity 0.25s var(--ease-accelerate), transform 0.25s var(--ease-accelerate);
  position: absolute;
}

.dock-slot-enter {
  opacity: 0;
  -webkit-transform: scale(0.4);
  transform: scale(0.4);
}

.dock-slot-leave-to {
  opacity: 0;
  -webkit-transform: scale(0.4);
  transform: scale(0.4);
}

.dock-slot.dock-slot--launching {
  -webkit-animation: dockLaunch 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards;
  animation: dockLaunch 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards;
}

@-webkit-keyframes dockLaunch {
  0% { -webkit-transform: scale(1); }
  35% { -webkit-transform: scale(1.25) translateY(-10px); }
  100% { -webkit-transform: scale(0.7) translateY(0); opacity: 0.4; }
}
@keyframes dockLaunch {
  0% { transform: scale(1); }
  35% { transform: scale(1.25) translateY(-10px); }
  100% { transform: scale(0.7) translateY(0); opacity: 0.4; }
}

.dock-icon {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-xl);
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  overflow: hidden;
}

.dock-icon img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.dock-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--danger-color);
  border-radius: 10px;
  padding: 0 5px;
  -webkit-box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  border: 2px solid var(--dock-bg);
}

.dock-badge-dot {
  min-width: 10px;
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
  line-height: 0;
  font-size: 0;
  top: -3px;
  right: -3px;
}

/* 注：拖拽 ghost 样式已迁移到 global.scss（ghost 被 append 到 document.body，scoped 样式不生效） */

/* ===== 小屏适配 ===== */
@media (max-height: 400px), (max-width: 520px) {
  .desktop-pages {
    top: 50px;
    bottom: 110px;
  }
  .desktop-grid {
    grid-gap: 8px;
    max-height: 360px;
  }
  .dock-bar {
    bottom: 8px;
    padding: 8px 16px;
    border-radius: var(--radius-lg);
  }
  .dock-slot {
    margin: 0 6px;
  }
  .dock-icon {
    width: 52px;
    height: 52px;
    border-radius: var(--radius-md);
  }
  .dock-badge {
    min-width: 18px;
    height: 18px;
    line-height: 18px;
    font-size: 10px;
    top: -3px;
    right: -3px;
    padding: 0 4px;
    border-width: 2px;
  }
}

/* ===== Announcement Float ===== */
.announcement-float {
  position: fixed;
  top: 24px;
  right: 24px;
  max-width: 360px;
  width: calc(100vw - 48px);
  z-index: 900;
  background: var(--nav-bg);
  -webkit-backdrop-filter: var(--glass-blur-container);
  backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.12);
  -webkit-box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  overflow: hidden;
  color: var(--text-primary, #e0e0e0);
}

.announcement-float-header {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.announcement-float-badge {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption1);
  font-weight: 600;
  color: var(--primary-color);
  letter-spacing: 0.3px;
}

.announcement-float-badge i {
  font-size: var(--font-size-footnote);
}

.announcement-float-close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e0e0e0);
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  font-size: 14px;
  -webkit-transition: background 0.2s var(--ease-standard), color 0.2s var(--ease-standard);
  transition: background 0.2s var(--ease-standard), color 0.2s var(--ease-standard);
}

.announcement-float-close:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.announcement-float-body {
  padding: 0 16px 12px;
}

.announcement-float-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  line-height: 1.4;
}

.announcement-float-content {
  margin: 0;
  font-size: var(--font-size-footnote);
  line-height: 1.6;
  color: var(--text-secondary, rgba(224, 224, 224, 0.7));
  word-break: break-word;
}

.announcement-float-footer {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  padding: 10px 16px 14px;
  border-top: 0.5px solid rgba(255, 255, 255, 0.06);
}

.announcement-float-indicator {
  font-size: 11px;
  color: var(--text-secondary, rgba(224, 224, 224, 0.5));
  font-weight: 500;
}

.announcement-float-actions {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 8px;
}

.announcement-float-btn {
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: var(--font-size-caption1);
  font-weight: 500;
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 4px;
  -webkit-transition: background 0.2s var(--ease-standard), opacity 0.2s var(--ease-standard);
  transition: background 0.2s var(--ease-standard), opacity 0.2s var(--ease-standard);
}

.announcement-float-btn i {
  font-size: 11px;
}

.announcement-float-btn-view {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--primary-color);
}

.announcement-float-btn-view:hover {
  background: rgba(var(--primary-rgb), 0.35);
}

.announcement-float-btn-dismiss {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, rgba(224, 224, 224, 0.7));
}

.announcement-float-btn-dismiss:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-primary, #e0e0e0);
}

/* Announcement Float Transition */
.announcement-float-enter-active {
  -webkit-transition: opacity 0.4s var(--ease-standard), -webkit-transform 0.4s var(--ease-spring);
  transition: opacity 0.4s var(--ease-standard), transform 0.4s var(--ease-spring);
}

.announcement-float-leave-active {
  -webkit-transition: opacity 0.3s var(--ease-standard), -webkit-transform 0.3s var(--ease-accelerate);
  transition: opacity 0.3s var(--ease-standard), transform 0.3s var(--ease-accelerate);
}

.announcement-float-enter {
  opacity: 0;
  -webkit-transform: translateX(60px);
  transform: translateX(60px);
}

.announcement-float-leave-to {
  opacity: 0;
  -webkit-transform: translateX(60px);
  transform: translateX(60px);
}

/* 文件夹展开过渡 */
.folder-expand-enter-active {
  -webkit-transition: opacity 0.25s var(--ease-standard);
  transition: opacity 0.25s var(--ease-standard);
}
.folder-expand-leave-active {
  -webkit-transition: opacity 0.2s var(--ease-accelerate);
  transition: opacity 0.2s var(--ease-accelerate);
}
.folder-expand-enter, .folder-expand-leave-to {
  opacity: 0;
}
</style>
