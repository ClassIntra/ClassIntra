<template>
  <div
    class="desktop"
    :class="{ 'desktop-enter': entered }"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
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

    <div class="dock-bar">
      <div
        v-for="app in visibleDockApps"
        :key="app.name"
        class="dock-item"
        :class="{ 'dock-launching': launchingApp === app.name }"
        @click="launchApp(app)"
      >
        <div class="dock-icon">
          <img :src="app.icon" :alt="app.label" loading="eager">
        </div>
        <span v-if="appBadges[app.name]" class="dock-badge" :class="{ 'dock-badge-dot': appBadges[app.name] === '●' }">{{ appBadges[app.name] === '●' ? '' : appBadges[app.name] }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import updateChecker from '@/utils/update-checker';

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
      dockApps: [
        { name: 'chat', label: '聊天', icon: '/resources/public/icons/Chat.svg', color: '#007AFF', route: '/chat' },
        { name: 'community', label: '社区', icon: '/resources/public/icons/Community.svg', color: '#FF9500', route: '/community' },
        { name: 'ai-chat', label: 'AI', icon: '/resources/public/icons/AI-Chat.svg', color: '#AF52DE', route: '/ai-chat' },
        { name: 'notes', label: '笔记', icon: '/resources/public/icons/Note.svg', color: '#FFCC00', route: '/notes' },
        { name: 'resource', label: '资源', icon: '/resources/public/icons/Files.svg', color: '#5856D6', route: '/resource' },
        { name: 'weather', label: '天气', icon: '/resources/public/icons/Weather.svg', color: '#5AC8FA', route: '/weather' },
        { name: 'music', label: '音乐', icon: '/resources/public/icons/Music.svg', color: '#FF2D55', route: '/music' },
        { name: 'settings', label: '设置', icon: '/resources/public/icons/Settings.svg', color: '#8E8E93', route: '/settings' }
      ],
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
      // 新版本角标
      if (this.newVersionAvailable) {
        badges['settings'] = '●';
      }
      return badges;
    },
    // 根据后端应用管控状态过滤出启用的应用
    visibleDockApps: function() {
      var self = this;
      // 未加载时显示全部（避免闪烁），加载后过滤
      if (self.enabledApps === null) return self.dockApps;
      return self.dockApps.filter(function(app) {
        return self.enabledApps.indexOf(app.name) !== -1;
      });
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
    onTouchStart: function(e) {
      if (e.touches && e.touches.length > 0) {
        this.touchStartY = e.touches[0].clientY;
      }
    },
    onTouchEnd: function() {},
    onMouseDown: function(e) {
      this.mouseStartY = e.clientY;
    },
    onMouseUp: function() {},
    launchApp: function(app) {
      var self = this;
      // 打开设置时清除新版本角标
      if (app.name === 'settings') {
        self.markVersionSeen();
      }
      self.launchingApp = app.name;
      setTimeout(function() {
        self.launchingApp = '';
        self.$router.push(app.route).catch(function() {});
      }, 250);
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
          var stored = localStorage.getItem('classnet_read_announcements');
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
      }).catch(function() {
        // 降级：全部启用
        self.enabledApps = self.dockApps.map(function(app) { return app.name; });
      });
    },
    // 检查新版本角标（复用 update-checker 模块）
    checkVersionUpdate: function() {
      var self = this;
      // 如果 update-checker 已检测到更新，直接显示角标
      if (updateChecker.isUpdateAvailable()) {
        var info = updateChecker.getCurrentVersionInfo();
        if (info) {
          var storedVersion = localStorage.getItem('classnet_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.version, storedVersion) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.version;
          }
        }
      }
      // 监听后续的更新通知（WebSocket 推送或定时检查），保存取消订阅函数
      self._updateUnsubscribe = updateChecker.onUpdateAvailable(function(event, info) {
        if (info && info.serverVersion) {
          var storedVer = localStorage.getItem('classnet_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.serverVersion, storedVer) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.serverVersion;
          }
        }
      });
    },
    // 用户点击设置时清除新版本角标
    markVersionSeen: function() {
      if (this.newVersionAvailable && this.latestVersion) {
        localStorage.setItem('classnet_seen_version', this.latestVersion);
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
        var stored = localStorage.getItem('classnet_read_announcements');
        if (stored) {
          readIds = JSON.parse(stored);
        }
      } catch (e) {
        readIds = [];
      }
      if (readIds.indexOf(current.id) === -1) {
        readIds.push(current.id);
      }
      localStorage.setItem('classnet_read_announcements', JSON.stringify(readIds));
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
        var stored = localStorage.getItem('classnet_read_announcements');
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
      localStorage.setItem('classnet_read_announcements', JSON.stringify(readIds));
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

.dock-item {
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
}

.dock-item:hover {
  -webkit-transform: scale(1.15) translateY(-6px);
  transform: scale(1.15) translateY(-6px);
}

.dock-item:active {
  -webkit-transform: scale(0.92) translateY(0);
  transform: scale(0.92) translateY(0);
  transition-duration: 0.12s;
}

.dock-item.dock-launching {
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
  -webkit-box-shadow: var(--shadow-sm);
  box-shadow: var(--shadow-sm);
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

/* 纯红点角标（新版本提示） */
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

/* 小屏适配 - 保持 iPad 比例 */
@media (max-height: 400px), (max-width: 520px) {
  .dock-bar {
    bottom: 8px;
    padding: 8px 16px;
    border-radius: var(--radius-lg);
  }
  .dock-item {
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

/* Announcement Float */
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
</style>
