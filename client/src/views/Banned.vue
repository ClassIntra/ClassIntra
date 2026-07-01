<template>
  <div class="banned-page">
    <div class="banned-card">
      <div class="banned-icon">
        <i class="fa-solid fa-lock"></i>
      </div>
      <h1 class="banned-title">账号已被封禁</h1>
      <p class="banned-desc">您的账号已被管理员封禁，暂时无法使用系统功能。</p>
      <div v-if="banInfo" class="ban-details">
        <div v-if="banInfo.ban_reason" class="ban-detail-item">
          <span class="ban-detail-label">封禁原因</span>
          <span class="ban-detail-value">{{ banInfo.ban_reason }}</span>
        </div>
        <div v-if="banInfo.ban_expires_at" class="ban-detail-item">
          <span class="ban-detail-label">解封时间</span>
          <span class="ban-detail-value">{{ formatBanTime(banInfo.ban_expires_at) }}</span>
          <span class="ban-countdown" v-if="remainingTime">{{ remainingTime }}</span>
        </div>
        <div v-else class="ban-detail-item">
          <span class="ban-detail-label">封禁类型</span>
          <span class="ban-detail-value permanent">永久封禁</span>
        </div>
      </div>
      <div class="banned-actions">
        <button class="btn-check" @click="checkBanStatus" :disabled="checking" title="检查封禁状态">
          <i class="fa-solid fa-arrows-rotate" :class="{ 'fa-spin': checking }"></i>
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
      checking: false
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
      this.remainingTime = hours + '时' + mins + '分' + secs + '秒';
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
.banned-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
  padding: var(--spacing-lg);
}
.banned-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 48px 40px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: var(--shadow-lg);
}
.banned-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto var(--spacing-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--danger-rgb), 0.15);
  border-radius: 50%;
  font-size: var(--font-size-title1);
  color: var(--danger-color);
}
.banned-title {
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0 0 12px;
}
.banned-desc {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  margin: 0 0 28px;
  line-height: var(--line-height-relaxed);
}
.ban-details {
  background: var(--bg-color);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 28px;
  text-align: left;
}
.ban-detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}
.ban-detail-item:last-child {
  margin-bottom: 0;
}
.ban-detail-label {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ban-detail-value {
  font-size: var(--font-size-body);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
}
.ban-detail-value.permanent {
  color: var(--danger-color);
}
.ban-countdown {
  font-size: var(--font-size-sm);
  color: var(--warning-color);
  margin-top: 2px;
}
.banned-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.btn-check {
  min-width: 44px;
  min-height: 44px;
  padding: 12px 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}
.btn-check:hover {
  background: var(--bg-color);
  border-color: var(--separator-color);
}
.btn-check:active {
  transform: scale(0.92);
  opacity: 0.7;
}
.btn-check:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
