<template>
  <div class="banned-page" :class="{ 'page-enter': entered }">
    <!-- 装饰光晕：与 Login 一致的视觉语言，但用警告色调（红/橙）传达"封禁"状态 -->
    <div class="banned-aurora" aria-hidden="true">
      <div class="aurora-blob aurora-blob-1"></div>
      <div class="aurora-blob aurora-blob-2"></div>
      <div class="aurora-blob aurora-blob-3"></div>
    </div>

    <div class="banned-card">
      <!-- 顶部图标：带 subtle pulse 提醒状态 -->
      <div class="banned-icon-wrap" aria-hidden="true">
        <div class="banned-icon-glow"></div>
        <div class="banned-icon">
          <i class="fa-solid fa-lock"></i>
        </div>
      </div>

      <h1 class="banned-title">账号已被封禁</h1>
      <p class="banned-desc">您的账号已被管理员封禁，暂时无法使用系统功能。</p>

      <!-- 封禁详情：iPadOS 风格 inset list（圆角分组 + 分隔线） -->
      <div v-if="banInfo" class="ban-details">
        <div v-if="banInfo.ban_reason" class="ban-row">
          <span class="ban-row-label">封禁原因</span>
          <span class="ban-row-value">{{ banInfo.ban_reason }}</span>
        </div>
        <div v-if="banInfo.ban_expires_at" class="ban-row ban-row-with-countdown">
          <div class="ban-row-main">
            <span class="ban-row-label">解封时间</span>
            <span class="ban-row-value">{{ formatBanTime(banInfo.ban_expires_at) }}</span>
          </div>
          <div v-if="remainingTime" class="ban-countdown">
            <i class="fa-solid fa-hourglass-half countdown-icon" aria-hidden="true"></i>
            <span class="countdown-text">{{ remainingTime }}</span>
          </div>
        </div>
        <div v-else class="ban-row">
          <span class="ban-row-label">封禁类型</span>
          <span class="ban-row-value ban-row-value-danger">永久封禁</span>
        </div>
      </div>

      <!-- 操作区：iPadOS 风格按钮（44x44 触摸目标） -->
      <div class="banned-actions">
        <button class="btn-check" @click="checkBanStatus" :disabled="checking" :aria-label="checking ? '正在检查封禁状态' : '检查封禁状态'">
          <i class="fa-solid fa-arrows-rotate" :class="{ 'fa-spin': checking }" aria-hidden="true"></i>
          <span class="btn-check-text">{{ checking ? '检查中' : '重新检查' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'Banned',
  data: function() {
    return {
      banInfo: null,
      remainingTime: '',
      countdownTimer: null,
      checking: false,
      entered: false
    };
  },
  beforeMount: function() {
    var self = this;
    var originalPush = this.$router.push.bind(this.$router);
    var originalReplace = this.$router.replace.bind(this.$router);
    this._guarded = true;
    this.$router.push = function() {
      if (self._guarded) return self.$router.replace({ name: 'Banned' });
      return originalPush.apply(this, arguments);
    };
    this.$router.replace = function(location) {
      if (self._guarded && (typeof location === 'object' && location.name !== 'Banned')) {
        return originalReplace.call(self.$router, { name: 'Banned' });
      }
      return originalReplace.apply(this, arguments);
    };
    this._originalPush = originalPush;
    this._originalReplace = originalReplace;
  },
  mounted: function() {
    this.loadBanInfo();
    var self = this;
    this._keydownHandler = function(e) {
      if (e.altKey || (e.ctrlKey && (e.key === 'w' || e.key === 'W' || e.key === 't' || e.key === 'T' || e.key === 'n' || e.key === 'N' || e.key === 'l' || e.key === 'L'))) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this._keydownHandler);
    // 允许外部（App.vue）通过自定义事件触发解封
    this._unbanHandler = function() {
      self._guarded = false;
      self.$router.push({ name: 'Desktop' });
    };
    window.addEventListener('classintra-unban', this._unbanHandler);
    // 自动轮询解封状态（5秒间隔）
    this._banCheckTimer = setInterval(function() {
      self.loadBanInfo();
    }, 5000);
    // 入场动画
    this.$nextTick(function() {
      requestAnimationFrame(function() {
        self.entered = true;
      });
    });
  },
  beforeDestroy: function() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    if (this._banCheckTimer) {
      clearInterval(this._banCheckTimer);
    }
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._unbanHandler) {
      window.removeEventListener('classintra-unban', this._unbanHandler);
    }
    this._guarded = false;
    if (this._originalPush) {
      this.$router.push = this._originalPush;
    }
    if (this._originalReplace) {
      this.$router.replace = this._originalReplace;
    }
  },
  methods: {
    loadBanInfo: function() {
      if (this.checking) return;
      var self = this;
      self.checking = true;
      var user = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
      if (!user || !user.user_id) { self.checking = false; return; }
      api.get('/auth/ban-info', { params: { user_id: user.user_id } }).then(function(response) {
        self.checking = false;
        var data = response.data.data;
        if (data && data.banned) {
          self.banInfo = data;
          if (data.ban_expires_at) {
            self.startCountdown(data.ban_expires_at);
          }
        } else {
          // 解封：先解除路由守卫，再跳转
          self._guarded = false;
          self.$store.commit('auth/SET_USER', Object.assign({}, user, { status: 'active', ban_reason: null, ban_expires_at: null }));
          self.$router.push({ name: 'Desktop' });
        }
      }).catch(function() {
        self.checking = false;
        self.banInfo = {
          ban_reason: '无法获取封禁详情',
          ban_expires_at: null
        };
      });
    },
    checkBanStatus: function() {
      this.loadBanInfo();
    },
    startCountdown: function(expiresAt) {
      var self = this;
      self.updateCountdown(expiresAt);
      self.countdownTimer = setInterval(function() {
        self.updateCountdown(expiresAt);
      }, 1000);
    },
    updateCountdown: function(expiresAt) {
      var expires = new Date(expiresAt + (expiresAt.indexOf('Z') === -1 && expiresAt.indexOf('+') === -1 ? 'Z' : ''));
      var now = new Date();
      var diff = expires - now;
      if (diff <= 0) {
        this.remainingTime = '即将解封...';
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
        }
        var self = this;
        setTimeout(function() {
          self._guarded = false;
          self.loadBanInfo();
        }, 2000);
        return;
      }
      var hours = Math.floor(diff / 3600000);
      var mins = Math.floor((diff % 3600000) / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      // 使用 tabular numbers：两位数补零，避免抖动
      this.remainingTime = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    },
    formatBanTime: function(timeStr) {
      if (!timeStr) return '';
      var str = String(timeStr);
      if (str.indexOf('T') === -1) str = str.replace(' ', 'T');
      if (str.indexOf('Z') === -1 && str.indexOf('+') === -1) str = str + 'Z';
      var d = new Date(str);
      if (isNaN(d.getTime())) return timeStr;
      var y = d.getFullYear();
      var m = (d.getMonth() + 1).toString().padStart(2, '0');
      var day = d.getDate().toString().padStart(2, '0');
      var h = d.getHours().toString().padStart(2, '0');
      var min = d.getMinutes().toString().padStart(2, '0');
      return y + '-' + m + '-' + day + ' ' + h + ':' + min;
    }
  }
};
</script>

<style scoped>
/* ========== 页面容器：与 Login 一致的多层背景，但用封禁色调 ========== */
.banned-page {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 警告色渐变：深红 → 橙 → 暖黄，传达"封禁"状态 */
  background: linear-gradient(135deg, #2a0808 0%, #8B1A1A 45%, #C2410C 100%);
  isolation: isolate;
}

/* 装饰光晕 */
.banned-aurora {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.aurora-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.5;
  will-change: transform;
}
.aurora-blob-1 {
  width: 520px;
  height: 520px;
  left: -120px;
  top: -140px;
  background: radial-gradient(circle, rgba(255, 69, 58, 0.6), transparent 70%);
  animation: aurora-drift-1 20s ease-in-out infinite alternate;
}
.aurora-blob-2 {
  width: 460px;
  height: 460px;
  right: -100px;
  bottom: -120px;
  background: radial-gradient(circle, rgba(255, 159, 10, 0.45), transparent 70%);
  animation: aurora-drift-2 24s ease-in-out infinite alternate;
}
.aurora-blob-3 {
  width: 380px;
  height: 380px;
  left: 40%;
  bottom: 10%;
  background: radial-gradient(circle, rgba(88, 86, 214, 0.35), transparent 70%);
  animation: aurora-drift-3 28s ease-in-out infinite alternate;
}

@keyframes aurora-drift-1 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(60px, 80px) scale(1.1); }
}
@keyframes aurora-drift-2 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(-80px, -60px) scale(1.05); }
}
@keyframes aurora-drift-3 {
  from { transform: translate(0, 0) scale(0.95); }
  to   { transform: translate(-40px, 50px) scale(1.1); }
}

/* ========== 卡片：与 Login 一致的真毛玻璃 ========== */
.banned-card {
  position: relative;
  z-index: 1;
  width: 460px;
  max-width: calc(100vw - 32px);
  background: var(--surface-elevated);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--radius-3xl);
  padding: 40px 36px 32px;
  box-shadow: var(--shadow-xl), inset 0 0 0 0.5px rgba(255, 255, 255, 0.18);
  text-align: center;
  /* 入场动画 */
  opacity: 0;
  transform: scale(0.95) translateY(12px);
  transition: opacity 0.5s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
              transform 0.6s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.banned-page.page-enter .banned-card {
  opacity: 1;
  transform: scale(1) translateY(0);
}

/* ========== 顶部图标：iPadOS 风格大圆图标 ========== */
.banned-icon-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  margin: 0 auto 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.banned-icon-glow {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 69, 58, 0.35), transparent 70%);
  filter: blur(12px);
  /* subtle pulse：呼吸般提醒状态 */
  animation: icon-pulse 2.4s ease-in-out infinite;
}

@keyframes icon-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.92); }
  50%      { opacity: 0.8; transform: scale(1.08); }
}

.banned-icon {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #FF453A 0%, #FF6961 100%);
  border-radius: 50%;
  font-size: 32px;
  color: #fff;
  box-shadow: 0 12px 28px rgba(255, 69, 58, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.banned-title {
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0 0 8px;
  letter-spacing: -0.5px;
}

.banned-desc {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  margin: 0 0 28px;
  line-height: var(--line-height-relaxed);
}

/* ========== 封禁详情：iPadOS 风格 inset list ========== */
.ban-details {
  background: rgba(120, 120, 128, 0.08);
  border-radius: var(--radius-xl);
  padding: 4px 16px;
  margin-bottom: 24px;
  text-align: left;
}

[data-theme="dark"] .ban-details {
  background: rgba(120, 120, 128, 0.16);
}

.ban-row {
  padding: 14px 0;
  border-bottom: 0.5px solid var(--separator-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ban-row:last-child {
  border-bottom: none;
}

.ban-row-with-countdown {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.ban-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ban-row-label {
  font-size: var(--font-size-subheadline);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

.ban-row-value {
  font-size: var(--font-size-subheadline);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  text-align: right;
  word-break: break-word;
}

.ban-row-value-danger {
  color: var(--danger-color, #FF3B30);
}

/* 倒计时：iPadOS 风格 inline chip + tabular numbers */
.ban-countdown {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-end;
  padding: 4px 10px;
  background: rgba(var(--warning-rgb, 255, 149, 10), 0.14);
  border: 0.5px solid rgba(var(--warning-rgb, 255, 149, 10), 0.25);
  border-radius: var(--radius-pill);
  color: var(--warning-color, #FF9500);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-semibold);
}

.countdown-icon {
  font-size: 11px;
}

/* tabular numbers：避免数字宽度变化造成抖动 */
.countdown-text {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}

/* ========== 操作区按钮：iPadOS 风格 ========== */
.banned-actions {
  display: flex;
  justify-content: center;
}

.btn-check {
  min-height: 44px;
  padding: var(--spacing-sm) var(--spacing-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(120, 120, 128, 0.08);
  color: var(--text-primary);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: background-color 0.15s var(--ease-standard, ease),
              transform 0.15s var(--ease-standard, ease),
              border-color 0.15s var(--ease-standard, ease);
}

[data-theme="dark"] .btn-check {
  background: rgba(120, 120, 128, 0.16);
}

.btn-check:hover {
  background: rgba(120, 120, 128, 0.16);
  border-color: var(--separator-color);
}

[data-theme="dark"] .btn-check:hover {
  background: rgba(120, 120, 128, 0.24);
}

.btn-check:active {
  transform: scale(0.97);
  background: rgba(120, 120, 128, 0.22);
}

.btn-check:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.btn-check-text {
  font-variant-numeric: tabular-nums;
}

/* ========== Reduced motion ========== */
@media (prefers-reduced-motion: reduce) {
  .aurora-blob,
  .banned-icon-glow {
    animation: none;
  }
  .banned-card {
    transition: opacity 0.2s ease;
    transform: none;
  }
  .banned-page.page-enter .banned-card {
    transform: none;
  }
  .btn-check:active {
    transform: none;
  }
}

/* ========== 响应式：窄屏适配 ========== */
@media (max-width: 480px) {
  .banned-card {
    padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-lg);
  }
  .banned-icon-wrap {
    width: 80px;
    height: 80px;
  }
  .banned-icon {
    width: 68px;
    height: 68px;
    font-size: 28px;
  }
}
</style>
