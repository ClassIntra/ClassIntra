<template>
  <div class="user-ban-widget">
    <!-- 加载态 -->
    <div v-if="loading" class="ubw-loading">
      <div class="ubw-spinner"></div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="ubw-error">
      <i class="fa-solid fa-circle-exclamation"></i>
      <span>加载失败</span>
    </div>
    <!-- 无权限态（防御性：即便绕过 picker 添加也展示提示） -->
    <div v-else-if="!canManage" class="ubw-error">
      <i class="fa-solid fa-lock"></i>
      <span>无权访问</span>
    </div>
    <!-- 主内容 -->
    <div v-else class="ubw-content">
      <div class="ubw-head">
        <div class="ubw-icon">
          <i class="fa-solid fa-users-gear"></i>
        </div>
        <div class="ubw-info">
          <div class="ubw-title">用户管控</div>
          <div class="ubw-sub">本班 {{ total }} 人 · 已封禁 {{ banned }} 人</div>
        </div>
      </div>
      <div class="ubw-actions">
        <button
          class="ubw-btn ubw-btn--ban"
          :disabled="operating || total === 0"
          @click.stop="onBatchDisable"
        >
          <i class="fa-solid fa-ban"></i>
          <span>封禁</span>
        </button>
        <button
          class="ubw-btn ubw-btn--enable"
          :disabled="operating || total === 0"
          @click.stop="onBatchEnable"
        >
          <i class="fa-solid fa-circle-check"></i>
          <span>启用</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'UserBanWidget',
  props: {
    config: {
      type: Object,
      default: function() { return {}; }
    },
    refreshKey: {
      type: Number,
      default: 0
    }
  },
  data: function() {
    return {
      loading: true,
      error: false,
      operating: false,
      total: 0,
      banned: 0,
      active: 0
    };
  },
  computed: {
    // 权限检查：班管或拥有 manage_users 权限的班干
    canManage: function() {
      return this.$store.getters['auth/canManage']('manage_users');
    }
  },
  watch: {
    // 监听 refreshKey 变化，触发数据重新加载
    refreshKey: function() {
      this.loadData();
    }
  },
  mounted: function() {
    this.loadData();
  },
  activated: function() {
    this.loadData();
  },
  methods: {
    // 显示 toast 提示（复用全局 toast store）
    showToast: function(message, type) {
      this.$store.commit('toast/SHOW_TOAST', { message: message, type: type || 'info' });
    },
    // 加载本班用户统计（复用 /api/admin/users 列表接口，limit 拉满）
    loadData: function() {
      var self = this;
      if (!self.canManage) {
        self.loading = false;
        return;
      }
      self.loading = true;
      api.get('/admin/users', { params: { limit: 10000 } }).then(function(res) {
        if (res.data && res.data.code === 200) {
          var users = res.data.data.users || [];
          self.total = users.length;
          self.banned = 0;
          self.active = 0;
          for (var i = 0; i < users.length; i++) {
            if (users[i].status === 'disabled') self.banned++;
            else self.active++;
          }
        } else {
          self.error = true;
        }
      }).catch(function() {
        self.error = true;
      }).finally(function() {
        self.loading = false;
      });
    },
    // 一键封禁：直接调用批量接口（无需二次确认）
    onBatchDisable: function() {
      var self = this;
      if (self.total === 0) return;
      self.operating = true;
      api.post('/admin/users/batch-status', {
        status: 'disabled',
        reason: '一键封禁（桌面小组件）'
      }).then(function(res) {
        if (res.data && res.data.code === 200) {
          var affected = (res.data.data && res.data.data.affected) || 0;
          self.showToast('已封禁 ' + affected + ' 人', 'success');
          self.loadData();
        } else {
          self.showToast((res.data && res.data.message) || '操作失败', 'error');
        }
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '操作失败';
        self.showToast(msg, 'error');
      }).finally(function() {
        self.operating = false;
      });
    },
    // 一键启用：直接调用批量接口（无需二次确认）
    onBatchEnable: function() {
      var self = this;
      if (self.total === 0) return;
      self.operating = true;
      api.post('/admin/users/batch-status', {
        status: 'active'
      }).then(function(res) {
        if (res.data && res.data.code === 200) {
          var affected = (res.data.data && res.data.data.affected) || 0;
          self.showToast('已启用 ' + affected + ' 人', 'success');
          self.loadData();
        } else {
          self.showToast((res.data && res.data.message) || '操作失败', 'error');
        }
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '操作失败';
        self.showToast(msg, 'error');
      }).finally(function() {
        self.operating = false;
      });
    }
  }
};
</script>

<style scoped>
.user-ban-widget {
  height: 100%;
  border-radius: 18px;
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s;
}
.user-ban-widget:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.user-ban-widget:active { transform: scale(0.98); }

/* 加载 / 错误 / 无权限 态 */
.ubw-loading, .ubw-error {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-tertiary);
}
.ubw-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: #FF3B30;
  animation: ubw-spin 0.9s linear infinite;
}
@keyframes ubw-spin { to { transform: rotate(360deg); } }
.ubw-error i { font-size: 20px; }
.ubw-error span { font-size: var(--font-size-caption); }

/* 主内容：横向布局（图标信息 + 操作按钮） */
.ubw-content {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  position: relative;
  overflow: hidden;
}
.ubw-content::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: #FF3B30;
}

.ubw-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.ubw-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #FF3B30, #FF6B6B);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(255, 59, 48, 0.3);
}
.ubw-info {
  flex: 1;
  min-width: 0;
}
.ubw-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ubw-sub {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 操作按钮组 */
.ubw-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.ubw-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: var(--font-size-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s var(--ease-standard), opacity 0.15s;
  min-width: 44px;
}
.ubw-btn i { font-size: 14px; }
.ubw-btn:active { transform: scale(0.92); }
.ubw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ubw-btn--ban {
  background: linear-gradient(135deg, #FF3B30, #FF6B6B);
  box-shadow: 0 2px 6px rgba(255, 59, 48, 0.25);
}
.ubw-btn--enable {
  background: linear-gradient(135deg, #34C759, #5AD679);
  box-shadow: 0 2px 6px rgba(52, 199, 89, 0.25);
}
</style>
