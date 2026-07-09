<template>
  <transition name="island-appear">
    <div v-if="shouldShow">
    <div class="island-wrapper" ref="islandEl">
    <div
      class="island"
      :class="islandClasses"
      @click="handleClick"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @mousedown="onMouseDown"
    >
      <transition name="island-content">
        <!-- Compact Mode -->
        <div v-if="islandMode === 'compact'" key="compact" class="island-body">
          <div class="compact-content">
            <span class="compact-icon" :class="{ 'compact-icon-pulse': hasLiveActivities }">
              <i :class="compactIcon"></i>
            </span>
            <span class="compact-text">{{ compactDisplayText }}</span>
          </div>
        </div>

        <!-- Split Mode -->
        <div v-else-if="islandMode === 'split'" key="split" class="island-body">
          <div class="split-content">
            <div class="split-half" @click.stop="expandActivity(0)">
              <i :class="activeActivities[0].icon" :style="{ color: activeActivities[0].color }"></i>
              <span class="split-text">{{ activeActivities[0].compactText }}</span>
            </div>
            <div class="split-sep"></div>
            <div class="split-half" @click.stop="expandActivity(1)">
              <i :class="activeActivities[1].icon" :style="{ color: activeActivities[1].color }"></i>
              <span class="split-text">{{ activeActivities[1].compactText }}</span>
            </div>
          </div>
        </div>

        <!-- Notification Mode -->
        <IslandNotificationPanel
          v-else-if="islandMode === 'notification'"
          key="notification"
          :notification="notification"
          :priority="notificationPriority"
          :timestamp="notificationTimestamp"
          :queue-count="queueCount"
          :is-bouncing="isBouncing"
          :progress-width="progressWidth"
        />

        <!-- Actions Mode -->
        <IslandActionsPanel
          v-else-if="islandMode === 'actions'"
          key="actions"
          @navigate="navigateTo"
          @open-browser="openBrowserMode"
        />

        <!-- History Mode -->
        <IslandHistoryPanel
          v-else-if="islandMode === 'history'"
          key="history"
          :history="notificationHistory"
          :filter="historyFilter"
          @update-filter="historyFilter = $event"
          @history-click="handleHistoryClick"
        />

        <!-- Browser Mode -->
        <IslandBrowserPanel
          v-else-if="islandMode === 'browser'"
          key="browser"
          ref="browserPanel"
          :url.sync="browserUrl"
          @submit="openBrowser"
          @cancel="goCompact"
        />

        <!-- Weather Compact Mode -->
        <IslandWeatherPanel
          v-else-if="islandMode === 'weather-compact'"
          key="weather-compact"
          :alert="currentWeatherAlert"
          :startTime="weatherAlertStartTime"
          @dismiss="dismissWeather"
          @request-close="dismissWeather"
        />

        <!-- Music Compact Mode -->
        <IslandMusicPanel
          v-else-if="islandMode === 'music-compact'"
          key="music-compact"
          mode="compact"
          :song="musicCurrentSong"
          :is-playing="musicIsPlaying"
        />

        <!-- Music Expanded Mode -->
        <IslandMusicPanel
          v-else-if="islandMode === 'music-expanded'"
          key="music-expanded"
          mode="expanded"
          :song="musicCurrentSong"
          :is-playing="musicIsPlaying"
          :current-lyric="musicCurrentLyric"
          :next-lyric="musicNextLyric"
          :progress-percent="musicProgressPercent"
          :formatted-time="musicFormattedTime"
          :formatted-duration="musicFormattedDuration"
          :play-mode-icon="playModeIcon"
          @go-to-music="goToMusic"
          @toggle-play-mode="togglePlayMode"
          @seek="onMusicProgressClick"
          @prev="musicPrev"
          @toggle="musicToggle"
          @next="musicNext"
        />
      </transition>
    </div>
    </div>
    </div>
  </transition>
</template>

<script>
import audioManager from '@/utils/audio-manager';
import islandNotificationsMixin from '@/mixins/island-notifications';
import islandGesturesMixin from '@/mixins/island-gestures';
import IslandNotificationPanel from './island/IslandNotificationPanel.vue';
import IslandHistoryPanel from './island/IslandHistoryPanel.vue';
import IslandActionsPanel from './island/IslandActionsPanel.vue';
import IslandBrowserPanel from './island/IslandBrowserPanel.vue';
import IslandMusicPanel from './island/IslandMusicPanel.vue';
import IslandWeatherPanel from './island/IslandWeatherPanel.vue';

export default {
  name: 'SuperIsland',
  components: {
    IslandNotificationPanel: IslandNotificationPanel,
    IslandHistoryPanel: IslandHistoryPanel,
    IslandActionsPanel: IslandActionsPanel,
    IslandBrowserPanel: IslandBrowserPanel,
    IslandMusicPanel: IslandMusicPanel,
    IslandWeatherPanel: IslandWeatherPanel
  },
  mixins: [islandNotificationsMixin, islandGesturesMixin],
  data: function() {
    return {
      // 模式状态机
      islandMode: 'compact',
      prevMode: 'compact',
      isDismissing: false,
      isBouncing: false,
      // 浏览器
      browserUrl: '',
      browserEnabled: false,
      // 音乐岛关闭标记
      musicIslandDismissed: false,
      // 天气预警
      currentWeatherAlert: null,
      weatherAlertStartTime: 0
    };
  },
  computed: {
    isOnDesktop: function() {
      return this.$route.path === '/';
    },
    currentRoute: function() {
      return this.$route.path;
    },
    currentChatId: function() {
      return this.$store.state.chat.currentChat;
    },
    activeActivities: function() {
      return this.$store.state.island.activities;
    },
    hasLiveActivities: function() {
      return this.activeActivities.length > 0;
    },
    shouldShow: function() {
      if (this.islandMode !== 'compact' && this.islandMode !== 'split') return true;
      if (this.isOnDesktop) return true;
      if (this.activeActivities.length > 0) return true;
      if (this.hasMusicPlaying && !this.musicIslandDismissed) return true;
      if (this.currentWeatherAlert) return true;
      return false;
    },
    compactIcon: function() {
      if (this.hasMusicPlaying && this.islandMode === 'compact' && !this.musicIslandDismissed) return 'fa-solid fa-music';
      if (this.isOnDesktop && this.broadcastText && this.activeActivities.length === 0) return 'fa-solid fa-bell';
      if (this.activeActivities.length > 0) return this.activeActivities[0].icon;
      return 'fa-solid fa-circle';
    },
    compactDisplayText: function() {
      if (this.hasMusicPlaying && this.islandMode === 'compact' && !this.musicIslandDismissed) return this.musicCurrentSong ? this.musicCurrentSong.title : '';
      if (this.isOnDesktop && this.broadcastText && this.activeActivities.length === 0) return this.broadcastText;
      if (this.activeActivities.length > 0) return this.activeActivities[0].compactText;
      if (this.isOnDesktop) return 'ClassIntra';
      return '';
    },
    islandClasses: function() {
      var cls = 'island-mode-' + this.islandMode;
      if (this.isDismissing) cls += ' island-dismissing';
      if (this.isBouncing) cls += ' island-bouncing';
      if (this.islandMode === 'notification') {
        if (this.notificationPriority === 'urgent') cls += ' island-urgent';
        else if (this.notificationPriority === 'normal') cls += ' island-normal';
        else cls += ' island-low';
      }
      return cls;
    },
    // ===== Music Computed =====
    musicCurrentSong: function() { return this.$store.state.music.currentSong; },
    musicIsPlaying: function() { return this.$store.state.music.isPlaying; },
    musicCurrentTime: function() { return this.$store.state.music.currentTime; },
    musicDuration: function() { return this.$store.state.music.duration; },
    musicCurrentLyric: function() {
      var lyrics = this.$store.state.music.lyrics;
      var idx = this.$store.state.music.currentLyricIndex;
      if (!lyrics || !lyrics.lines || idx < 0 || idx >= lyrics.lines.length) return '';
      return lyrics.lines[idx].text || '';
    },
    musicNextLyric: function() {
      var lyrics = this.$store.state.music.lyrics;
      var idx = this.$store.state.music.currentLyricIndex;
      if (!lyrics || !lyrics.lines || idx + 1 < 0 || idx + 1 >= lyrics.lines.length) return '';
      return lyrics.lines[idx + 1].text || '';
    },
    musicProgressPercent: function() {
      var d = this.$store.state.music.duration;
      var t = this.$store.state.music.currentTime;
      return d > 0 ? Math.min(100, (t / d) * 100) : 0;
    },
    musicFormattedTime: function() {
      var t = this.$store.state.music.currentTime || 0;
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    musicFormattedDuration: function() {
      var d = this.$store.state.music.duration || 0;
      var m = Math.floor(d / 60);
      var s = Math.floor(d % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    hasMusicPlaying: function() {
      if (this.$route && this.$route.path === '/music') return false;
      return !!this.$store.state.music.currentSong;
    },
    playModeIcon: function() {
      var mode = this.$store.state.music.playMode;
      if (mode === 'repeat-one') return 'fa-solid fa-repeat';
      if (mode === 'repeat-all') return 'fa-solid fa-repeat';
      if (mode === 'shuffle') return 'fa-solid fa-shuffle';
      return 'fa-solid fa-arrow-right-long';
    }
  },
  watch: {
    activeActivities: function(newVal) {
      if (this.islandMode === 'compact' || this.islandMode === 'split') {
        if (newVal.length >= 2) {
          this.islandMode = 'split';
        } else if (this.islandMode === 'split' && newVal.length < 2) {
          this.islandMode = (this.hasMusicPlaying && !this.musicIslandDismissed) ? 'music-compact' : 'compact';
        }
      }
    },
    islandMode: function(newMode, oldMode) {
      if (newMode !== oldMode) {
        this.animateIslandHeight();
      }
      // 展开模式（菜单/音乐/历史/浏览器）监听 document 点击，点击外部则收起
      var collapsibleModes = ['actions', 'music-expanded', 'history', 'browser'];
      var isNewCollapsible = collapsibleModes.indexOf(newMode) !== -1;
      var wasOldCollapsible = collapsibleModes.indexOf(oldMode) !== -1;
      if (isNewCollapsible && !wasOldCollapsible) {
        var self = this;
        self.$nextTick(function() {
          document.addEventListener('click', self.onDocumentClick);
        });
      } else if (!isNewCollapsible && wasOldCollapsible) {
        document.removeEventListener('click', this.onDocumentClick);
      }
    },
    hasMusicPlaying: function(val) {
      if (val && (this.islandMode === 'compact' || this.islandMode === 'split')) {
        this.musicIslandDismissed = false;
        if (this.activeActivities.length >= 2) {
          this.islandMode = 'split';
        } else {
          this.islandMode = 'music-compact';
        }
      } else if (!val && this.islandMode === 'music-compact') {
        this.islandMode = 'compact';
      } else if (!val && this.islandMode === 'music-expanded') {
        this.islandMode = 'compact';
      }
    },
    musicCurrentSong: function(newSong, oldSong) {
      if (newSong && (!oldSong || newSong.id !== oldSong.id)) {
        this.musicIslandDismissed = false;
      }
    }
  },
  created: function() {
    var self = this;
    var user = this.$store.state.auth.user;
    if (user && user.info && user.info.browser_enabled) {
      self.browserEnabled = true;
    }
    self.$store.watch(function(state) { return state.auth.user; }, function(newUser) {
      self.browserEnabled = !!(newUser && newUser.info && newUser.info.browser_enabled);
    });
  },
  mounted: function() {
    this.loadBroadcasts();
    this.connectWS();
  },
  beforeDestroy: function() {
    this.cleanupNotificationTimers();
    this.cleanupGestureTimers();
    this.cleanupWSListeners();
    document.removeEventListener('click', this.onDocumentClick);
  },
  methods: {
    goCompact: function() {
      if (this.islandMode === 'music-expanded') {
        this.islandMode = 'music-compact';
        return;
      }
      if (this.activeActivities.length >= 2) {
        this.islandMode = 'split';
      } else if (this.hasMusicPlaying && !this.musicIslandDismissed) {
        this.islandMode = 'music-compact';
      } else {
        this.islandMode = 'compact';
      }
    },
    onDocumentClick: function(e) {
      // 点击 island 外部区域时收起展开的菜单/面板
      var collapsibleModes = ['actions', 'music-expanded', 'history', 'browser'];
      if (collapsibleModes.indexOf(this.islandMode) === -1) return;
      var el = this.$refs.islandEl;
      if (el && !el.contains(e.target)) {
        this.goCompact();
      }
    },

    // ===== 天气预警 =====
    showWeatherAlert: function(alert) {
      // 已在显示天气预警中，不重复触发
      if (this.islandMode === 'weather-compact') return;
      this.currentWeatherAlert = alert;
      this.weatherAlertStartTime = Date.now();
      this.prevMode = this.islandMode;
      this.islandMode = 'weather-compact';
    },

    dismissWeather: function() {
      this.currentWeatherAlert = null;
      this.weatherAlertStartTime = 0;
      this.goCompact();
    },

    handleClick: function() {
      if (this.isDismissing) return;
      var self = this;
      if (self.islandMode === 'weather-compact') {
        // 点击天气预警岛 → 跳转天气页
        self.$router.push('/weather').catch(function() {});
        self.dismissWeather();
      } else if (self.islandMode === 'music-compact') {
        self.islandMode = 'music-expanded';
      } else if (self.islandMode === 'music-expanded') {
        self.islandMode = 'music-compact';
      } else if (self.islandMode === 'notification' && self.notification) {
        if (self.notification.route) {
          if (self.notification.chatId) {
            self.$store.commit('chat/SET_CURRENT_CHAT', self.notification.chatId);
            // 通过 query 传递 chatId，让 Chat.vue mounted 时自动打开对应会话
            self.$router.push({ path: self.notification.route, query: { chat: self.notification.chatId } }).catch(function() {});
          } else {
            self.$router.push(self.notification.route).catch(function() {});
          }
        }
        self.dismissNotification();
      } else if (self.islandMode === 'compact' || self.islandMode === 'split') {
        if (self.isOnDesktop && self.browserEnabled) {
          self.islandMode = 'actions';
        } else if (self.isOnDesktop) {
          self.islandMode = 'compact';
          self.$router.push('/announcements').catch(function() {});
        } else {
          self.islandMode = 'actions';
        }
      }
    },

    expandActivity: function(index) {
      var activity = this.activeActivities[index];
      if (!activity) return;
      if (activity.route) {
        this.$router.push(activity.route).catch(function() {});
      } else {
        this.islandMode = 'actions';
      }
    },

    navigateTo: function(route) {
      this.islandMode = 'compact';
      this.$router.push(route).catch(function() {});
    },

    openBrowserMode: function() {
      this.islandMode = 'compact';
      this.$router.push({ name: 'Browser' }).catch(function() {});
    },

    openBrowser: function() {
      var self = this;
      var url = self.browserUrl.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      self.islandMode = 'compact';
      self.$router.push({ name: 'Browser', query: { url: url } }).catch(function() {});
    },

    handleHistoryClick: function(item) {
      var self = this;
      self.islandMode = 'compact';
      if (item.route) {
        if (item.chatId) {
          self.$store.commit('chat/SET_CURRENT_CHAT', item.chatId);
          // 通过 query 传递 chatId，让 Chat.vue mounted 时自动打开对应会话
          self.$router.push({ path: item.route, query: { chat: item.chatId } }).catch(function() {});
        } else {
          self.$router.push(item.route).catch(function() {});
        }
      }
    },

    // ===== Music Controls =====
    goToMusic: function() {
      this.islandMode = this.hasMusicPlaying ? 'music-compact' : 'compact';
      this.$router.push('/music').catch(function() {});
    },
    musicToggle: function() {
      audioManager.toggle();
    },
    musicPrev: function() {
      this.$store.dispatch('music/prev');
    },
    musicNext: function() {
      this.$store.dispatch('music/next');
    },
    onMusicProgressClick: function(e) {
      var d = this.$store.state.music.duration;
      if (!d) return;
      var rect = e.currentTarget.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audioManager.seek(pct * d);
    },
    togglePlayMode: function() {
      var modes = ['sequence', 'repeat-all', 'repeat-one', 'shuffle'];
      var current = this.$store.state.music.playMode;
      var idx = modes.indexOf(current);
      var next = modes[(idx + 1) % modes.length];
      this.$store.commit('music/SET_PLAY_MODE', next);
    }
  }
};
</script>

<style scoped>
/* ===== Appear Transition ===== */
.island-appear-enter-active {
  transition: opacity 0.3s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)), transform 0.3s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1));
}
.island-appear-leave-active {
  transition: opacity 0.2s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)), transform 0.2s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1));
}
.island-appear-enter {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}
.island-appear-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}

/* ===== Island Container ===== */
.island-wrapper {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
}

.island {
  position: relative;
  overflow: hidden;
  background: var(--island-bg);
  backdrop-filter: var(--glass-blur-overlay);
  -webkit-backdrop-filter: var(--glass-blur-overlay);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(255, 255, 255, 0.08) inset;
  cursor: pointer;
  contain: layout style paint;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}

/* ===== Mode Sizes ===== */
.island-mode-compact {
  min-width: 120px;
  border-radius: 40px;
  padding: 0 20px;
  display: inline-flex;
  align-items: center;
}

.island-mode-compact:hover {
  transform: scale(1.03);
}

.island-mode-split {
  min-width: 220px;
  border-radius: 40px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
}

.island-mode-split:hover {
  transform: scale(1.02);
}

.island-mode-notification {
  min-width: 300px;
  border-radius: var(--radius-2xl);
  padding: 0 18px;
}

.island-mode-actions {
  min-width: 280px;
  border-radius: var(--radius-2xl);
  padding: 16px;
}

.island-mode-history {
  width: 340px;
  border-radius: var(--radius-2xl);
  padding: 0;
}

.island-mode-browser {
  min-width: 280px;
  border-radius: var(--radius-2xl);
  padding: 0 16px;
}

.island-mode-music-compact {
  min-width: 120px;
  max-width: 260px;
  height: 40px;
  border-radius: 40px;
  padding: 0 16px 0 4px;
  display: inline-flex;
  align-items: center;
  box-shadow: var(--shadow-lg), 0 0 0 0.5px var(--separator-color) inset;
}

.island-mode-music-compact:hover {
  transform: scale(1.03);
}

/* ===== Weather Compact ===== */
.island-mode-weather-compact {
  min-width: 120px;
  max-width: 320px;
  height: 40px;
  border-radius: 40px;
  padding: 0 16px 0 8px;
  display: inline-flex;
  align-items: center;
  box-shadow: var(--shadow-lg), 0 0 0 0.5px var(--separator-color) inset;
}

.island-mode-weather-compact:hover {
  transform: scale(1.03);
}

.island-mode-music-expanded {
  width: 280px;
  border-radius: var(--radius-2xl);
  padding: 12px 14px 10px;
}

/* ===== Priority States ===== */
.island-urgent {
  box-shadow: 0 4px 24px rgba(var(--danger-rgb), 0.35), 0 0 0 1px rgba(var(--danger-rgb), 0.15) inset;
  animation: island-urgent-glow 1.5s ease-in-out infinite;
}

.island-normal {
  box-shadow: 0 4px 24px rgba(var(--primary-rgb), 0.2), 0 0 0 1px rgba(var(--primary-rgb), 0.1) inset;
}

.island-low {
  box-shadow: 0 4px 24px var(--text-tertiary), 0 0 0 1px var(--text-tertiary) inset;
}

@keyframes island-urgent-glow {
  0% { box-shadow: 0 4px 24px rgba(var(--danger-rgb), 0.35), 0 0 0 1px rgba(var(--danger-rgb), 0.15) inset; }
  50% { box-shadow: 0 4px 32px rgba(var(--danger-rgb), 0.55), 0 0 0 2px rgba(var(--danger-rgb), 0.25) inset; }
  100% { box-shadow: 0 4px 24px rgba(var(--danger-rgb), 0.35), 0 0 0 1px rgba(var(--danger-rgb), 0.15) inset; }
}

.island-bouncing {
  animation: island-bounce 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards;
}

@keyframes island-bounce {
  0% { opacity: 0; transform: translateY(-16px) scale(0.85); }
  40% { opacity: 1; transform: translateY(4px) scale(1.04); }
  65% { transform: translateY(-2px) scale(0.98); }
  80% { transform: translateY(1px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.island-dismissing {
  opacity: 0.6;
  transform: translateY(-4px) scale(0.96);
  transition: opacity 0.2s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)), transform 0.2s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)) !important;
}

/* ===== Content Transition ===== */
.island-content-enter-active {
  transition: opacity 0.18s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)) 0.08s, transform 0.22s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) 0.08s;
}
.island-content-leave-active {
  transition: opacity 0.1s var(--ease-accelerate), transform 0.1s var(--ease-accelerate);
}
.island-content-enter {
  opacity: 0;
  transform: scale(0.9) translateY(-6px);
}
.island-content-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-3px);
}

.island-body {
  width: 100%;
  color: var(--island-text);
}

/* ===== Compact Mode ===== */
.compact-content {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  height: 40px;
}

.compact-icon {
  font-size: 13px;
  opacity: 0.8;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: opacity 0.3s;
}

.compact-icon-pulse {
  animation: compact-pulse 2s ease-in-out infinite;
}

@keyframes compact-pulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

.compact-text {
  font-size: var(--font-size-footnote);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* ===== Split Mode ===== */
.split-content {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
}

.split-half {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  min-height: 44px;
  border-radius: var(--radius-2xl);
  transition: background 0.2s;
  cursor: pointer;
}

.split-half:hover {
  background: rgba(255, 255, 255, 0.1);
}

.split-half i {
  font-size: var(--font-size-caption1);
}

.split-text {
  font-size: var(--font-size-caption1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.split-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

/* ===== Reduced Motion ===== */
@media (prefers-reduced-motion: reduce) {
  .island { transition: none !important; }
  .island-bouncing { animation: none !important; }
  .island-dismissing { transition: none !important; }
  .island-urgent { animation: none !important; }
  .compact-icon-pulse { animation: none !important; }
  .island-content-enter-active,
  .island-content-leave-active { transition: none !important; }
}

/* ===== Responsive ===== */
@media (max-width: 480px) {
  .island-mode-notification {
    min-width: 260px;
  }
  .island-mode-actions {
    min-width: 260px;
  }
  .island-mode-history {
    width: 300px;
  }
}

@media (min-width: 768px) {
  .island-mode-notification {
    min-width: 340px;
  }
  .island-mode-history {
    width: 380px;
  }
}

@media (max-height: 640px) {
  .island-wrapper {
    top: 6px;
  }
  .island-mode-compact {
    min-width: 100px;
    padding: 0 14px;
    font-size: var(--font-size-caption1);
  }
  .island-mode-music-compact {
    max-width: 180px;
  }
  .island-mode-music-expanded {
    width: 240px;
    padding: 10px 12px 8px;
  }
}
</style>
