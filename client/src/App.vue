<template>
  <div id="app" :data-theme="theme" @click="handleGlobalTap">
    <SuperIsland ref="superIsland" v-show="!isLocked" />
    <transition name="page-fade" mode="out-in">
      <ErrorBoundary><router-view></router-view></ErrorBoundary>
    </transition>
    <transition name="toast-fade">
      <div v-if="toast.show" class="global-toast" :class="toast.type">
        <i :class="toastIconClass" class="toast-icon"></i>
        <span class="toast-text">{{ toast.message }}</span>
      </div>
    </transition>
    <ModalDialog ref="modalDialog" />
    <transition name="lock-fade">
      <LockScreen v-if="isLocked" @unlock="unlockScreen" />
    </transition>
  </div>
</template>

<script>
import SuperIsland from '@/components/SuperIsland.vue';
import LockScreen from '@/components/LockScreen.vue';
import api from '@/utils/api';
import updateChecker from '@/utils/update-checker';
import wsManager from '@/utils/websocket';
import audioManager from '@/utils/audio-manager';

export default {
  name: 'App',
  components: {
    SuperIsland: SuperIsland,
    LockScreen: LockScreen
  },
  data: function() {
    return {
      isLocked: localStorage.getItem('app_locked') === 'true',
      lockTapTimes: []
    };
  },
  computed: {
    theme: function() {
      return this.$store.state.settings.theme;
    },
    toast: function() {
      return this.$store.state.toast || { show: false, message: '', type: 'info' };
    },
    toastIconClass: function() {
      if (this.toast.type === 'success') return 'fa-solid fa-circle-check';
      if (this.toast.type === 'error') return 'fa-solid fa-circle-xmark';
      return 'fa-solid fa-circle-info';
    },
    isBannedPage: function() {
      return this.$route.name === 'Banned';
    }
  },
  methods: {
    handleGlobalTap: function() {
      if (this.isLocked) return;
      var now = Date.now();
      this.lockTapTimes.push(now);
      if (this.lockTapTimes.length > 5) {
        this.lockTapTimes = this.lockTapTimes.slice(-5);
      }
      if (this.lockTapTimes.length === 5) {
        var diff = this.lockTapTimes[4] - this.lockTapTimes[0];
        if (diff < 1000) {
          this.lockScreen();
          this.lockTapTimes = [];
        }
      }
    },
    lockScreen: function() {
      this.isLocked = true;
      localStorage.setItem('app_locked', 'true');
      if (this.$store.state.music.isPlaying) {
        this._wasPlayingBeforeLock = true;
        audioManager.pause();
      } else {
        this._wasPlayingBeforeLock = false;
      }
      this._mutedBeforeLock = this.$store.state.music.isMuted;
      audioManager.getAudio().muted = true;
      this.$store.commit('music/SET_MUTED', true);
    },
    unlockScreen: function() {
      this.isLocked = false;
      localStorage.removeItem('app_locked');
      audioManager.getAudio().muted = !!this._mutedBeforeLock;
      this.$store.commit('music/SET_MUTED', !!this._mutedBeforeLock);
      if (this._wasPlayingBeforeLock) {
        audioManager.resume();
      }
    },
    // 断网时立即锁屏并隐藏敏感信息（同步执行，零延迟，不删除本地数据）
    lockForOffline: function() {
      if (this.isLocked && this._offlineLocked) return;
      // 第一步：同步隐藏所有内容（CSS优先，0ms生效）
      document.documentElement.classList.add('offline-secure');
      // 第二步：清除标题
      this._savedTitle = document.title;
      document.title = '';
      // 第三步：立即触发锁屏
      this.lockScreen();
      // 第四步：异步清空敏感DOM内容（防止查看源码泄露，不删除localStorage）
      var self = this;
      requestAnimationFrame(function() {
        self._clearSensitiveContent();
      });
    },
    // 恢复网络时解锁
    restoreFromOffline: function() {
      if (!this._offlineLocked) return;
      this._offlineLocked = false;
      this.isLocked = false;
      localStorage.removeItem('app_locked');
      document.documentElement.classList.remove('offline-secure');
      // 恢复标题
      if (this._savedTitle) {
        document.title = this._savedTitle;
        this._savedTitle = '';
      }
    },
    // 清空页面中所有敏感区域的DOM内容
    _clearSensitiveContent: function() {
      var sensitiveSelectors = [
        '.chat-page', '.chat-messages', '.message-list', '.message-item',
        '.community-page', '.post-list', '.post-content', '.post-card',
        '.comment-list', '.comment-item', '.comment-content',
        '.notes-page', '.editor-area', '.preview-area',
        '.private-chat', '.group-chat',
        '.message-input', '.chat-input', '.chat-sidebar',
        '.community-sidebar', '.user-profile', '.profile-info',
        '.ai-chat', '.ai-messages', '.ai-input'
      ];
      for (var i = 0; i < sensitiveSelectors.length; i++) {
        var els = document.querySelectorAll(sensitiveSelectors[i]);
        for (var j = 0; j < els.length; j++) {
          els[j].textContent = '';
        }
      }
    },
    detectPerformance: function() {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      var cores = navigator.hardwareConcurrency || 2;
      var memory = navigator.deviceMemory || 4;
      var isLow = cores <= 2 || memory <= 2;
      if (!gl) return 'low';
      if (isLow) return 'low';
      if (cores <= 4 && memory <= 4) return 'medium';
      return 'high';
    }
  },
  mounted: function() {
    var self = this;
    self._unwatchToken = null;
    if (self.$modal && self.$refs.modalDialog) {
      self.$modal._setInstance(self.$refs.modalDialog);
    }
    var perfLevel = self.detectPerformance();
    document.documentElement.setAttribute('data-perf', perfLevel);
    var savedTheme = localStorage.getItem('theme') || 'light';
    this.$store.commit('settings/SET_THEME', savedTheme);
    var storedUser = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { localStorage.removeItem('user'); return null; } })();
    if (storedUser && self.$store.state.auth.token) {
      api.get('/auth/check-status').then(function(response) {
        if (response.data.code === 200 && response.data.data && response.data.data.user_info) {
          self.$store.commit('auth/SET_USER', response.data.data.user_info);
          if (response.data.data.token) {
            self.$store.commit('auth/SET_TOKEN', response.data.data.token);
          }
        }
      }).catch(function() {});
      api.get('/user/settings').then(function(response) {
        if (response.data.code === 200 && response.data.data) {
          var serverSettings = response.data.data;
          if (serverSettings.wallpaper && serverSettings.wallpaper !== 'default') {
            var localWp = localStorage.getItem('wallpaper') || 'default';
            if (localWp !== serverSettings.wallpaper) {
              self.$store.commit('settings/SET_WALLPAPER', serverSettings.wallpaper);
            }
          }
          if (serverSettings.theme) {
            var localTheme = localStorage.getItem('theme');
            if (!localTheme) {
              self.$store.commit('settings/SET_THEME', serverSettings.theme);
            }
          }
        }
      }).catch(function() {});
    }
    self._banWsHandler = function(data) {
      if (data.type === 'admin_user_status_changed' || data.type === 'account_banned') {
        var user = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
        if (!user) return;
        // account_banned是直接发给本用户的，无需匹配user_id
        var isTargetUser = data.type === 'account_banned' || (data.user_id === user.user_id);
        if (isTargetUser && data.status === 'disabled') {
          var updatedUser = Object.assign({}, user, { status: 'disabled', ban_reason: data.reason || '', ban_expires_at: data.ban_expires_at || null });
          self.$store.commit('auth/SET_USER', updatedUser);
          self.$router.push({ name: 'Banned' });
        } else if (isTargetUser && data.status === 'active') {
          var activeUser = Object.assign({}, user, { status: 'active', ban_reason: null, ban_expires_at: null });
          self.$store.commit('auth/SET_USER', activeUser);
          // 如果当前在小黑屋页面，通过自定义事件通知Banned组件解封
          if (self.$route.name === 'Banned') {
            window.dispatchEvent(new CustomEvent('classnet-unban'));
          }
        }
      }
      if (data.type === 'app_update_available') {
        updateChecker.handleWsUpdateNotification(data);
      }
      if (data.type === 'officer_permissions_changed') {
        var curUser = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
        if (curUser && data.user_id === curUser.user_id) {
          var permUser = Object.assign({}, curUser, {
            role: data.role || curUser.role,
            officer_permissions: data.permissions ? JSON.stringify(data.permissions) : curUser.officer_permissions,
            officer_title: data.title !== undefined ? data.title : curUser.officer_title
          });
          self.$store.commit('auth/SET_USER', permUser);
        }
      }
      if (data.type === 'weather_alert') {
        // 天气预警集成进超能岛通知系统（位置/样式/动画与普通通知一致）
        if (self.$refs.superIsland && self.$refs.superIsland.enqueueNotification) {
          var w = data;
          var hasRain = !!(w.rain || w.has_rain || w.alert_type === 'rain' || w.alert_type === 'both');
          var hasWarning = !!(w.warning || w.has_warning || w.alert_type === 'warning' || w.alert_type === 'both');
          var parts = [];
          if (hasRain) {
            parts.push((w.rain && w.rain.description) || w.rain_text || '降雨提醒');
          }
          if (hasWarning) {
            var wt = (w.warning && w.warning.title) || (w.warnings && w.warnings[0] && (w.warnings[0].title || w.warnings[0].typeName)) || '天气预警';
            parts.push(wt);
          }
          self.$refs.superIsland.enqueueNotification({
            icon: hasRain ? 'fa-cloud-rain' : 'fa-triangle-exclamation',
            color: (hasRain && hasWarning) ? 'var(--color-orange)' : (hasWarning ? 'var(--color-red)' : 'var(--primary)'),
            title: '天气预警',
            text: parts.join(' · '),
            category: 'weather',
            priority: 'urgent'
          });
        }
      }
    };
    wsManager.on('_message', self._banWsHandler);

    self._updateUnsubscribe = updateChecker.onUpdateAvailable(function(event, info) {
      if (event === 'force_update') {
        self.$modal.alert({
          title: '应用需要更新',
          message: '检测到新版本 v' + info.serverVersion + '，当前版本过旧，需要更新后才能继续使用。',
          confirmText: '立即更新'
        }).then(function() {
          updateChecker.forceReload();
        });
      } else if (event === 'update_available' && updateChecker.shouldPromptUpdate()) {
        updateChecker.markPromptShown();
        self.$modal.confirm({
          title: '发现新版本',
          message: '新版本 v' + info.serverVersion + ' 已发布，是否立即更新？' + (info.changelog ? '\n\n更新内容: ' + info.changelog : ''),
          confirmText: '立即更新',
          cancelText: '稍后再说'
        }).then(function(result) {
          if (result) {
            updateChecker.forceReload();
          }
        }).catch(function() {});
      }
    });

    if (storedUser && self.$store.state.auth.token) {
      updateChecker.startPeriodicCheck();
    }

    self._unwatchToken = self.$store.watch(function(state) { return state.auth.token; }, function(token) {
      if (token) {
        updateChecker.startPeriodicCheck();
      } else {
        updateChecker.stopPeriodicCheck();
      }
    });

    // 心跳检测：2秒间隔，3秒超时，连续5次失败才触发锁屏（容忍PM2重启）
    self._heartbeatPending = false;
    self._heartbeatFailCount = 0;
    self._heartbeatTimer = setInterval(function() {
      // 未登录时不发送心跳，避免401把注册页用户踢回登录页
      if (!self.$store.state.auth.token) return;
      if (self._heartbeatPending) return;
      self._heartbeatPending = true;
      api.get('/auth/check-status', { timeout: 3000 }).then(function(res) {
        self._heartbeatPending = false;
        self._heartbeatFailCount = 0;
        if (!self.$store.state.network.online) {
          self.$store.commit('network/SET_ONLINE', true);
          self.restoreFromOffline();
        }
        // 心跳同时检测封禁状态
        if (res.data && res.data.code === 403) {
          var user = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
          if (user) {
            var banData = res.data || {};
            self.$store.commit('auth/SET_USER', Object.assign({}, user, { status: 'disabled', ban_reason: banData.ban_reason || '', ban_expires_at: banData.ban_expires_at || null }));
            self.$router.push({ name: 'Banned' });
          }
        }
      }).catch(function(err) {
        self._heartbeatPending = false;
        if (!err.response) {
          self._heartbeatFailCount++;
          // 连续5次失败才触发锁屏，容忍PM2重启（~10秒容错）
          if (self._heartbeatFailCount >= 5 && self.$store.state.network.online) {
            self.$store.commit('network/SET_ONLINE', false);
            self._offlineLocked = true;
            self.lockForOffline();
          }
        } else {
          // 有响应（如403/401/500），说明服务器在线，重置计数
          self._heartbeatFailCount = 0;
        }
      });
    }, 2000);

    // WebSocket重连后检查封禁状态
    self._onWsOpen = function() {
      api.get('/auth/check-status', { timeout: 3000 }).catch(function() {});
    };
    wsManager.on('_wsOpen', self._onWsOpen);

    // WebSocket断连检测：延迟验证，避免WS短暂重连误触发锁屏
    self._onWsClose = function() {
      if (self.$store.state.network.online && !self._offlineLocked) {
        // 延迟3秒验证，给WS重连时间
        setTimeout(function() {
          if (self.$store.state.network.online && !self._offlineLocked) {
            api.get('/auth/check-status', { timeout: 3000 }).catch(function(err) {
              if (!err.response) {
                self.$store.commit('network/SET_ONLINE', false);
                self._offlineLocked = true;
                self.lockForOffline();
              }
            });
          }
        }, 3000);
      }
    };
    self._onWsError = function() {
      // WS错误不立即触发锁屏，等onclose或心跳检测
    };
    wsManager.on('_wsClose', self._onWsClose);
    wsManager.on('_wsError', self._onWsError);

    // 浏览器网络事件监听
    self._onBrowserOffline = function() {
      // 浏览器报告离线，延迟验证避免误触发
      setTimeout(function() {
        api.get('/auth/check-status', { timeout: 3000 }).catch(function(err) {
          if (!err.response) {
            self.$store.commit('network/SET_ONLINE', false);
            self._offlineLocked = true;
            self.lockForOffline();
          }
        });
      }, 2000);
    };
    self._onBrowserOnline = function() {
      // 浏览器报告在线时，验证服务器可达性
      api.get('/auth/check-status', { timeout: 3000 }).then(function() {
        self.$store.commit('network/SET_ONLINE', true);
        self.restoreFromOffline();
      }).catch(function() {
        // 浏览器说在线但服务器不可达，保持当前状态
      });
    };
    window.addEventListener('offline', self._onBrowserOffline);
    window.addEventListener('online', self._onBrowserOnline);
  },
  beforeDestroy: function() {
    if (this._banWsHandler) {
      wsManager.off('_message', this._banWsHandler);
    }
    if (this._onWsClose) {
      wsManager.off('_wsClose', this._onWsClose);
    }
    if (this._onWsError) {
      wsManager.off('_wsError', this._onWsError);
    }
    if (this._onWsOpen) {
      wsManager.off('_wsOpen', this._onWsOpen);
    }
    if (this._unwatchToken) { this._unwatchToken(); }
    if (this._updateUnsubscribe) {
      this._updateUnsubscribe();
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
    if (this._onBrowserOffline) {
      window.removeEventListener('offline', this._onBrowserOffline);
    }
    if (this._onBrowserOnline) {
      window.removeEventListener('online', this._onBrowserOnline);
    }
    updateChecker.stopPeriodicCheck();
  },
};
</script>

<style>
#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

#app > .page-fade-enter-active,
#app > .page-fade-leave-active,
#app > .page-fade-enter,
#app > .page-fade-leave-to,
#app > .page-fade-enter-active > *,
#app > .page-fade-leave-active > * {
  height: 100%;
  width: 100%;
}

.page-fade-enter-active {
  transition: opacity 0.35s var(--ease-decelerate), transform 0.35s var(--ease-decelerate);
}
.page-fade-leave-active {
  transition: opacity 0.2s var(--ease-accelerate), transform 0.2s var(--ease-accelerate);
}
.page-fade-enter {
  opacity: 0;
  transform: translateX(30px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateX(-15px);
}

.global-toast {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 9999;
  box-shadow: var(--shadow-lg);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  backdrop-filter: var(--glass-blur-thin);
}
.global-toast.success {
  background: rgba(34, 197, 94, 0.95);
  color: #fff;
}
.global-toast.error {
  background: rgba(239, 68, 68, 0.95);
  color: #fff;
}
.global-toast.info {
  background: rgba(33, 150, 243, 0.95);
  color: #fff;
}
.toast-icon {
  font-size: 16px;
}
.toast-text {
  white-space: nowrap;
}
.toast-fade-enter-active {
  transition: opacity 0.3s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)), transform 0.4s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.toast-fade-leave-active {
  transition: opacity 0.2s var(--ease-standard, cubic-bezier(0.32, 0.72, 0, 1)), transform 0.15s var(--ease-accelerate);
}
.toast-fade-enter {
  opacity: 0;
  transform: translateX(-50%) translateY(-16px) scale(0.9);
}
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px) scale(0.95);
}

.lock-fade-enter-active {
  transition: opacity 0.4s var(--ease-standard);
}
.lock-fade-leave-active {
  transition: opacity 0.3s var(--ease-standard);
}
.lock-fade-enter,
.lock-fade-leave-to {
  opacity: 0;
}

/* 断网安全模式：同步隐藏所有页面内容，0ms生效 */
html.offline-secure {
  background: #000 !important;
}
html.offline-secure body {
  background: #000 !important;
  overflow: hidden !important;
}
html.offline-secure #app > *:not(.lock-screen) {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  left: -9999px !important;
}
html.offline-secure #app .lock-screen {
  visibility: visible !important;
  opacity: 1 !important;
  position: fixed !important;
  z-index: 99999 !important;
}
/* 断网时黑屏遮罩：在LockScreen渲染前立即覆盖 */
html.offline-secure::after {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  z-index: 99998;
}
html.offline-secure .lock-screen ~ * {
  display: none !important;
}
</style>
