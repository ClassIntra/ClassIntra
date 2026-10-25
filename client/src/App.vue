<template>
  <div id="app" :data-theme="theme" @click="handleGlobalTap">
    <SuperIsland ref="superIsland" v-show="!isLocked && !desktopSettingsPanelOpen" />
    <!-- 页面切换：保持与原版完全一致的结构（本系统数月的稳定基线）。
         应用打开动画不挂在这里 —— 由 appOpenTransition 在导航完成后以 WAAPI 播放
         （后置动画不可能阻塞导航；此前挂在 transition 钩子上曾导致真机卡死） -->
    <transition name="page-fade" mode="out-in">
      <ErrorBoundary>
        <router-view></router-view>
      </ErrorBoundary>
    </transition>
    <transition name="toast-fade">
      <div v-if="toast.show" class="global-toast" :class="toast.type" role="status" aria-live="polite">
        <i :class="toastIconClass" class="toast-icon" aria-hidden="true"></i>
        <span class="toast-text">{{ toast.message }}</span>
        <button type="button" class="toast-close" aria-label="关闭提示" @click.stop="$store.commit('toast/HIDE_TOAST')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </transition>
    <ModalDialog ref="modalDialog" />
    <GlobalSearch ref="globalSearch" />
    <BigTextOverlay ref="bigTextOverlay" />
    <transition name="lock-fade">
      <LockScreen v-if="isLocked" @unlock="unlockScreen" />
    </transition>
  </div>
</template>

<script>
import SuperIsland from '@/components/SuperIsland.vue';
import LockScreen from '@/components/LockScreen.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import BigTextOverlay from '@/components/BigTextOverlay.vue';
import api from '@/utils/api';
import updateChecker from '@/utils/update-checker';
import wsManager from '@/utils/websocket';
import commandInbox from '@/utils/command-inbox';
import audioManager from '@/utils/audio-manager';
import islandNotify from '@/utils/island-notify';
import reminderChecker from '@/utils/reminder-checker';
import { getThemeEngine } from '@/core/theme-engine';
import { getHotkeyManager } from '@/core/hotkey-manager';
import router from '@/router';
import { marketRegistry } from '@/core/market-registry';
import { syncOverlays } from '@/core/market-overlay-host';
import { syncMarketWidgets } from '@/core/widget-aggregator';
import { syncMarketThemes } from '@/core/theme-market';
import appOpenTransition from '@/core/app-open-transition';

export default {
  name: 'App',
  components: {
    SuperIsland: SuperIsland,
    LockScreen: LockScreen,
    GlobalSearch: GlobalSearch,
    BigTextOverlay: BigTextOverlay
  },
  data: function() {
    return {
      isLocked: localStorage.getItem('app_locked') === 'true',
      lockTapTimes: [],
      lockScreenEnabled: true,
      marketSyncPromise: null,
      marketSyncEventKey: ''
    };
  },
  watch: {
    // 应用打开动画（WAAPI 后置播放）：导航已完成才启动动画 —— 从结构上不可能阻塞导航。
    // （此前把动画挂在 transition 钩子上，真机时序竞态导致"卡在应用界面"，已彻底移除）
    '$route': function(to, from) {
      var self = this;
      if (!appOpenTransition.enabled()) return;
      var fromDesktop = !!from && (from.name === 'Desktop' || from.path === '/');
      var toDesktop = !to || to.name === 'Desktop' || to.path === '/';
      if (fromDesktop && !toDesktop && appOpenTransition.hasPendingOrigin()) {
        var o = appOpenTransition.consumeOrigin(to.fullPath);
        if (!o) return;
        this.$nextTick(function() {
          // 动画目标：路由页根元素（ErrorBoundary 的 $el 即 slot 内容根）
          var boundary = self.$refs.pageBoundary;
          var pageEl = boundary && boundary.$el;
          if (!pageEl || !pageEl.animate || !pageEl.getBoundingClientRect) return;
          try {
            var vw = window.innerWidth || 1;
            var vh = window.innerHeight || 1;
            pageEl.animate([
              { transform: 'translate(' + o.x + 'px, ' + o.y + 'px) scale(' + (o.w / vw).toFixed(4) + ', ' + (o.h / vh).toFixed(4) + ')', borderRadius: '28px', opacity: 0.3 },
              { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '0px', opacity: 1 }
            ], { duration: 320, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
          } catch (e) {}
        });
      }
    }
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
    },
    // 桌面设置面板打开时隐藏超能岛（面板全屏覆盖，避免顶部叠层冲突）
    desktopSettingsPanelOpen: function() {
      return this.$store.state.desktop && this.$store.state.desktop.settingsPanelOpen;
    }
  },
  methods: {
    handleGlobalTap: function() {
      if (this.isLocked) return;
      // 管理员在管控中心关闭锁屏功能后，锁屏手势不再生效
      if (!this.lockScreenEnabled) return;
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
    // 加载锁屏功能开关（由管理员在管控中心配置）
    // 复用 router.getAppControl() 的缓存：与路由守卫 / 桌面共享同一次 /system/app-control 请求，
    // 避免冷启动时同一接口被重复拉取（原先此处是裸 api.get，与守卫、桌面各拉一次）。
    loadLockScreenState: function() {
      var self = this;
      router.getAppControl().then(function(data) {
        if (data && typeof data.lock_screen !== 'undefined') {
          self.lockScreenEnabled = !!data.lock_screen;
        }
      }).catch(function() {
      });
    },
    syncMarketAppControl: function(appName, enabled, action) {
      var self = this;
      var eventKey = [appName || '', enabled ? 'enabled' : 'disabled', action || 'control'].join(':');
      if (self.marketSyncEventKey === eventKey && self.marketSyncPromise) {
        return self.marketSyncPromise;
      }
      self.marketSyncEventKey = eventKey;
      if (router.clearAppControlCache) router.clearAppControlCache();
      self.marketSyncPromise = api.get('/system/app-control').then(function(response) {
        var data = response.data.data || {};
        var enabledApps = Array.isArray(data.enabled_apps) ? data.enabled_apps : [];
        self.$store.commit('desktop/SET_ENABLED_APPS', enabledApps);
        return marketRegistry.refresh().then(function(apps) {
          if (router.registerMarketApps) router.registerMarketApps(apps);
          // 全局悬浮层 + 市场小组件随清单同步（安装/卸载/启停/更新都会走到这里）
          syncOverlays(apps);
          syncMarketWidgets(apps);
          return self.$store.dispatch('desktop/loadDesktopLayout', enabledApps).then(function() {
            var currentApp = self.$route.meta && self.$route.meta.appName;
            if ((!enabled || action === 'uninstalled') && currentApp === appName) {
              return self.$router.push({ name: 'Desktop' }).then(function() {
                self.$store.commit('toast/SHOW_TOAST', {
                  message: action === 'uninstalled' ? '应用已卸载，已返回桌面' : '应用已被班管暂停，已返回桌面',
                  type: 'info'
                });
                return apps;
              });
            }
            if (action === 'installed') {
              self.$store.commit('toast/SHOW_TOAST', { message: '班管已安装新应用，桌面已更新', type: 'info' });
            } else if (action === 'updated') {
              self.$store.commit('toast/SHOW_TOAST', { message: '应用已更新', type: 'success' });
            }
            return apps;
          });
        });
      }).catch(function(error) {
        self.$store.commit('toast/SHOW_TOAST', {
          message: error && error.message ? '应用状态同步失败，请刷新重试' : '应用状态同步失败，请刷新重试',
          type: 'error'
        });
        throw error;
      }).finally(function() {
        self.marketSyncPromise = null;
      });
      return self.marketSyncPromise;
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
        '.private-chat', '.group-chat',
        '.message-input', '.chat-input', '.chat-sidebar',
        '.community-sidebar', '.user-profile', '.profile-info'
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
    },

    /**
     * 统一落地的账号状态变更（封禁/解封）。
     * 三个来源共用：WS 实时消息、指令信箱补拉、check-status 的 403 响应。
     * 幂等：重复调用只会重复 set 同一个状态，不会叠加副作用。
     */
    applyAccountStatus: function(status, reason, banExpiresAt) {
      var self = this;
      var user = null;
      try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { user = null; }
      if (!user) return;

      if (status === 'disabled') {
        self.$store.commit('auth/SET_USER', Object.assign({}, user, {
          status: 'disabled',
          ban_reason: reason || '',
          ban_expires_at: banExpiresAt || null
        }));
        if (self.$route.name !== 'Banned') {
          self.$router.push({ name: 'Banned' });
        }
      } else if (status === 'active') {
        self.$store.commit('auth/SET_USER', Object.assign({}, user, {
          status: 'active',
          ban_reason: null,
          ban_expires_at: null
        }));
        // 若当前停在小黑屋页面，通知 Banned 组件解封
        if (self.$route.name === 'Banned') {
          window.dispatchEvent(new CustomEvent('classintra-unban'));
        }
      }
    },

    /**
     * 处理 /auth/check-status 的失败响应。
     * ⚠️ 此前所有调用点的 catch 都是空的 —— 服务端在账号被封时返回
     * code 403「该账号已被禁用」，axios 视为 error 走 catch，封禁信号被整个吞掉，
     * 设备要等到下一次偶然的推送才知道自己被封了。这是「封禁不及时」的第二大成因。
     */
    handleStatusCheckError: function(err) {
      // 服务端在账号被封时返回的是 **HTTP 200 + body.code 403**（见 routes/auth.js:230），
      // 所以 axios 走的是 .then 而不是 .catch。这个函数两种形态都接：
      // 既处理真正的网络错误（err.response.data），也处理 200 里的 403 body。
      var body = null;
      if (err && err.response && err.response.data) body = err.response.data;
      else if (err && err.data) body = err.data;
      else if (err && err.code !== undefined) body = err;
      if (body && body.code === 403 && body.message === '该账号已被禁用') {
        this.applyAccountStatus('disabled', body.ban_reason || '账号已被禁用', body.ban_expires_at || null);
      }
    },

    /** 指令信箱：大字显示 / 撤回 */
    handleBigTextCommand: function(payload) {
      if (this.$refs.bigTextOverlay) {
        this.$refs.bigTextOverlay.show(payload);
      }
    },

    handleBigTextRecallCommand: function(payload) {
      if (this.$refs.bigTextOverlay) {
        this.$refs.bigTextOverlay.hide(payload && payload.id);
      }
    },

    /** 指令信箱：账号状态（离线设备上线后补执行封禁/解封） */
    handleAccountStatusCommand: function(payload) {
      if (payload && payload.status) {
        this.applyAccountStatus(payload.status, payload.reason || '', payload.ban_expires_at || null);
      }
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
    // 深色为主基调：无历史偏好时默认深色
    var savedTheme = localStorage.getItem('theme') || 'dark';
    this.$store.commit('settings/SET_THEME', savedTheme);
    // 阶段 2：初始化动画开关（localStorage > prefers-reduced-motion > 默认启用）
    // 主题已由 SET_THEME 委托 ThemeEngine 应用，此处仅初始化动画降级
    try { getThemeEngine().initMotion(); } catch (e) {}
    var storedUser = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { localStorage.removeItem('user'); return null; } })();
    if (storedUser && self.$store.state.auth.token) {
      // 加载锁屏功能开关（管理员管控中心配置）
      self.loadLockScreenState();
      api.get('/auth/check-status').then(function(response) {
        if (response.data.code === 200 && response.data.data && response.data.data.user_info) {
          self.$store.commit('auth/SET_USER', response.data.data.user_info);
          if (response.data.data.token) {
            self.$store.commit('auth/SET_TOKEN', response.data.data.token);
          }
        }
        // 封禁是 200 + body.code 403，必须在 then 里接（catch 永远等不到）
        if (response.data.code === 403) self.handleStatusCheckError(response.data);
      }).catch(function(err) { self.handleStatusCheckError(err); });
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
          // 同步头像颜色到 localStorage（服务端优先）
          if (serverSettings.avatar_color) {
            var uid = (storedUser && storedUser.user_id) || '';
            if (uid) {
              localStorage.setItem('avatar_color_' + uid, serverSettings.avatar_color);
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
        if (isTargetUser) {
          self.applyAccountStatus(data.status, data.reason || '', data.ban_expires_at || null);
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
        // 天气预警以超能岛专用样式显示（滚动文字，两遍后自动关闭）
        if (self.$refs.superIsland && self.$refs.superIsland.showWeatherAlert) {
          var w = data;
          var hasWarning = !!(w.has_warning || w.alert_type === 'warning' || w.alert_type === 'both');
          var hasRain = !!(w.has_rain || w.alert_type === 'rain' || w.alert_type === 'both');
          var warningsArr = w.warnings || [];
          // 优先使用预警数组中的第一条（后端已映射为统一格式）
          if (hasWarning && warningsArr.length > 0) {
            self.$refs.superIsland.showWeatherAlert(warningsArr[0]);
          } else if (hasRain) {
            // 降雨提醒
            self.$refs.superIsland.showWeatherAlert({
              eventType: { name: '降雨提醒' },
              severity: 'minor',
              color: { red: 59, green: 130, blue: 246, alpha: 1 },
              headline: '降雨提醒',
              description: w.rain_text || '预计将有降雨，请注意出行安全'
            });
          }
        }
      }
      if (data.type === 'market_app_control_changed') {
        self.syncMarketAppControl(data.appName, !!data.enabled, 'control').catch(function() {});
      }
      if (data.type === 'market_app_changed') {
        self.syncMarketAppControl(data.appName, true, data.action).catch(function() {});
      }
      if (data.type === 'market_theme_changed') {
        // 市场主题安装/卸载：重同步主题注册（失败静默，仅影响新主题可见性）
        syncMarketThemes().catch(function() {});
      }
      if (data.type === 'lock_screen_changed') {
        // 管理员切换锁屏开关，实时生效
        self.lockScreenEnabled = !!data.enabled;
        // 关闭开关时，若当前处于手动锁屏状态则自动解锁（断网保护锁除外）
        if (!data.enabled && self.isLocked && !self._offlineLocked) {
          self.unlockScreen();
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
        // 登录成功后拉取锁屏功能开关
        self.loadLockScreenState();
      } else {
        updateChecker.stopPeriodicCheck();
        // 退出登录后恢复默认开启，避免影响下一次登录
        self.lockScreenEnabled = true;
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
        // 心跳同时检测封禁状态（200 + body.code 403）
        if (res.data && res.data.code === 403) self.handleStatusCheckError(res.data);
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
    // ⚠️ 此前 catch 是空的：被封时服务端返回 403，信号被整个吞掉。
    // 现在交给 handleStatusCheckError 识别并落地。
    self._onWsOpen = function() {
      api.get('/auth/check-status', { timeout: 3000 }).then(function(res) {
        if (res.data && res.data.code === 403) self.handleStatusCheckError(res.data);
      }).catch(function(err) {
        self.handleStatusCheckError(err);
      });
    };
    wsManager.on('_wsOpen', self._onWsOpen);

    // WebSocket断连检测：延迟验证，避免WS短暂重连误触发锁屏
    self._onWsClose = function() {
      if (self.$store.state.network.online && !self._offlineLocked) {
        // 延迟3秒验证，给WS重连时间
        setTimeout(function() {
          if (self.$store.state.network.online && !self._offlineLocked) {
            api.get('/auth/check-status', { timeout: 3000 }).then(function(res) {
              if (res.data && res.data.code === 403) self.handleStatusCheckError(res.data);
            }).catch(function(err) {
              if (!err.response) {
                self.$store.commit('network/SET_ONLINE', false);
                self._offlineLocked = true;
                self.lockForOffline();
                return;
              }
              self.handleStatusCheckError(err);
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
            return;
          }
          self.handleStatusCheckError(err);
        });
      }, 2000);
    };
    self._onBrowserOnline = function() {
      // 浏览器报告在线时，验证服务器可达性
      api.get('/auth/check-status', { timeout: 3000 }).then(function(res) {
        self.$store.commit('network/SET_ONLINE', true);
        self.restoreFromOffline();
        // 恢复在线时若发现账号已被封，同样要落地
        if (res.data && res.data.code === 403) self.handleStatusCheckError(res.data);
      }).catch(function(err) {
        // 浏览器说在线但服务器不可达，保持当前状态；
        // 但若服务器明确返回 403（已被封禁），仍需落地封禁状态。
        self.handleStatusCheckError(err);
      });
    };
    window.addEventListener('offline', self._onBrowserOffline);
    window.addEventListener('online', self._onBrowserOnline);
    // 注入灵动岛桥接 + 启动提醒检查器
    islandNotify.setSuperIslandRef(self.$refs.superIsland);
    reminderChecker.start();

    // ===== 设备指令信箱 =====
    // 控制类指令（封禁/解封、大字广播）的必达通道：
    // 在线走 WS 实时推送，离线则由上线/重连后的补拉兜底。
    commandInbox.registerHandler('big_text', function(payload) {
      self.handleBigTextCommand(payload);
    });
    commandInbox.registerHandler('big_text_recall', function(payload) {
      self.handleBigTextRecallCommand(payload);
    });
    commandInbox.registerHandler('account_status', function(payload) {
      self.handleAccountStatusCommand(payload);
    });
    commandInbox.start();
    // 从后台切回前台时立刻补拉一次（移动端切后台会挂起定时器）
    self._onVisibilityChange = function() {
      if (document.visibilityState === 'visible') {
        commandInbox.syncNow();
      }
    };
    document.addEventListener('visibilitychange', self._onVisibilityChange);

    // 任意接口返回「该账号已被禁用」时，api.js 会广播这个事件：
    // 统一走 applyAccountStatus，避免各页面各自静默降级成空数据
    self._onAccountDisabled = function(e) {
      var d = (e && e.detail) || {};
      self.applyAccountStatus('disabled', d.reason, d.expiresAt);
    };
    window.addEventListener('classintra-account-disabled', self._onAccountDisabled);

    // 阶段 5：注册 Ctrl+K 全局搜索快捷键（global: true，输入框中也触发）
    try {
      var hotkeyManager = getHotkeyManager();
      self._unregisterGlobalSearch = hotkeyManager.register({
        id: 'global-search',
        combo: 'Ctrl+K',
        description: '打开全局搜索',
        global: true,
        handler: function(e) {
          if (self.$refs.globalSearch) {
            self.$refs.globalSearch.open();
          }
        }
      });
    } catch (e) {
      console.warn('[App] 全局搜索快捷键注册失败:', e.message);
    }
  },
  beforeDestroy: function() {
    reminderChecker.stop();
    if (this._onAccountDisabled) {
      window.removeEventListener('classintra-account-disabled', this._onAccountDisabled);
    }
    commandInbox.stop();
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
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
    if (this._unregisterGlobalSearch) {
      this._unregisterGlobalSearch();
    }
    updateChecker.stopPeriodicCheck();
  },
};
</script>

<style>
/* ===== 应用打开/关闭过渡（安卓容器变换式，详见 core/app-open-transition.js）=====
   展开：before-enter 把容器定到图标 rect，这里驱动它过渡回自然态（全屏）；
   离开（app-open 的桌面退场）：桌面轻微缩小淡出，衬托新页展开。
   全程 transform/opacity/border-radius，合成层动画，Chrome 80 平板流畅。 */
.app-open-enter-active {
  transition:
    transform var(--duration-slow, 0.3s) var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
    opacity var(--duration-slow, 0.3s) var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
    border-radius var(--duration-slow, 0.3s) var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1));
  will-change: transform;
  z-index: 100;
}
.app-open-leave-active {
  transition:
    transform var(--duration-fast, 0.15s) var(--ease-accelerate, cubic-bezier(0.4, 0, 1, 1)),
    opacity var(--duration-fast, 0.15s) var(--ease-accelerate, cubic-bezier(0.4, 0, 1, 1));
  transform: scale(0.96);
  opacity: 0.6;
}
.app-open-leave-to { opacity: 0; }
/* 收缩（app-close）：before-leave 把图标 rect 写进 --ac-* 变量，纯 CSS 类驱动
   （Vue 原生 CSS 过渡检测，无 JS done 竞态）；终点 = 图标位置与大小 */
.app-close-leave-active {
  transition:
    transform var(--duration-slow, 0.3s) var(--ease-accelerate, cubic-bezier(0.4, 0, 1, 1)),
    opacity var(--duration-slow, 0.3s) var(--ease-accelerate, cubic-bezier(0.4, 0, 1, 1)),
    border-radius var(--duration-slow, 0.3s) var(--ease-accelerate, cubic-bezier(0.4, 0, 1, 1));
  transform-origin: 0 0;
  overflow: hidden;
}
.app-close-leave-to {
  transform: translate(var(--ac-x, 0px), var(--ac-y, 0px)) scale(var(--ac-sx, 1), var(--ac-sy, 1));
  opacity: 0;
  border-radius: 28px;
}
/* 桌面回场快速淡入 */
.app-close-enter-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-standard, ease);
}
.app-close-enter-from { opacity: 0; }
</style>
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

/* iPadOS 风格路由切换：从右滑入 + 微缩放（仿 iOS push view controller）
   - 进入：translateX(40px) + scale(0.96) → 0 + 1，--duration-normal + 强减速曲线
   - 离开：translateX(0) → translateX(-20px) + scale(0.98)，--duration-fast + 加速曲线
   - 注意：先离开再进入（mode="out-in"），避免两层重叠导致 backdrop-filter 性能问题。

   关键：out-in 是串行的——总观感时长 = leave + enter。
   若 leave 取 0.15s + enter 取 0.22s，则新页面要等 0.37s 才完全静止，
   期间屏幕处于「旧页已淡出、新页还在滑」的半空状态，这正是「切换太慢」的来源。
   因此把 leave 压到 instant 档（0.1s，纯让位，不需要被看清），
   enter 保留 normal（新内容需要被看清，且减速曲线前段位移大、观感本身就快）。
   调整后总时长约 0.32s，且「空白期」从 0.15s 降到 0.1s。 */
.page-fade-enter-active {
  transition: opacity var(--duration-normal) var(--ease-decelerate),
              transform var(--duration-normal) var(--ease-decelerate);
  /* 进入时提升合成层，避免 backdrop-filter 闪烁 */
  will-change: transform, opacity;
}
.page-fade-leave-active {
  transition: opacity var(--duration-instant) var(--ease-accelerate),
              transform var(--duration-instant) var(--ease-accelerate);
  will-change: transform, opacity;
}
.page-fade-enter {
  opacity: 0;
  /* 从右侧滑入 + 微缩放（emil-design：never animate from scale(0)，从 0.96 起步） */
  transform: translateX(40px) scale(0.96);
}
.page-fade-leave-to {
  opacity: 0;
  /* 向左轻推 + 微缩放，模拟被推走的页面 */
  transform: translateX(-20px) scale(0.98);
}

/* Reduced motion：纯淡入淡出，无位移与缩放 */
@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .page-fade-enter,
  .page-fade-leave-to {
    transform: none;
  }
}

.global-toast {
  position: fixed;
  /* 64px = 灵动岛常态（top 12 + 高 40）下方再留 12px 呼吸位。
     早先是 80px，配合当时偏低的 z-index(9999) 会被岛/模态盖住；
     现在层级提到 --z-toast(99997) 永不被挡，位置反而要贴着岛下沿，
     免得浮在岛的标题栏上挡它的关闭按钮。 */
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: var(--z-toast, 99997);
  box-shadow: var(--shadow-lg);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  backdrop-filter: var(--glass-blur-thin);
}
.global-toast.success {
  background: rgba(var(--success-rgb), 0.95);
  color: #fff;
}
.global-toast.error {
  background: rgba(var(--danger-rgb), 0.95);
  color: #fff;
}
.global-toast.info {
  background: rgba(var(--primary-rgb), 0.95);
  color: #fff;
}
.toast-icon {
  font-size: 16px;
}
.toast-text {
  white-space: normal;
  max-width: min(70vw, 420px);
}
.toast-close { border: 0; padding: 2px; color: inherit; background: transparent; opacity: .8; cursor: pointer; }
.toast-close:hover { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .toast-fade-enter-active,
  .toast-fade-leave-active { transition: opacity var(--duration-fast) var(--ease-standard); }
  .toast-fade-enter,
  .toast-fade-leave-to { transform: translateX(-50%); }
}
.toast-fade-enter-active {
  /* 弹层入场（iOS 语义）：snappy 利落收起，不用 bouncy 以免玩具感 */
  transition: opacity var(--duration-normal) var(--ease-emphasized), transform var(--duration-normal) var(--motion-spring-snappy);
}
.toast-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-emphasized), transform var(--duration-fast) var(--ease-accelerate);
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
  transition: opacity var(--duration-normal) var(--ease-standard);
}
.lock-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
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
