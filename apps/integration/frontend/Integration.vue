<template>
  <div class="integration-page">
    <div class="page-header">
      <h1 class="page-title">
        <i class="fa-solid fa-plug"></i>
        集成管理
      </h1>
      <p class="page-subtitle">管理外部系统与 ClassIntra 的集成连接</p>
    </div>

    <div v-if="!isAdmin" class="permission-denied">
      <i class="fa-solid fa-lock"></i>
      <p>仅管理员可访问此页面</p>
    </div>

    <div v-else class="integration-content">
      <!-- 签发新 token -->
      <section class="card section-card">
        <h2 class="section-title">
          <i class="fa-solid fa-plus-circle"></i>
          签发新集成
        </h2>
        <div class="form-grid">
          <div class="form-item">
            <label>名称</label>
            <input v-model="newIntegration.name" type="text" placeholder="如：学校官网" />
          </div>
          <div class="form-item">
            <label>Webhook URL</label>
            <input v-model="newIntegration.webhookUrl" type="text" placeholder="https://example.com/webhook" />
          </div>
          <div class="form-item form-item-full">
            <label>Origin 白名单（每行一个）</label>
            <textarea v-model="newIntegration.originsText" rows="3" placeholder="https://school.example.com"></textarea>
          </div>
          <div class="form-item form-item-full">
            <label>权限范围</label>
            <div class="scopes-grid">
              <label v-for="scope in availableScopes" :key="scope" class="scope-checkbox">
                <input type="checkbox" :value="scope" v-model="newIntegration.scopes" />
                <span>{{ scope }}</span>
              </label>
            </div>
          </div>
          <div class="form-item">
            <label>有效期（天）</label>
            <input v-model.number="newIntegration.ttlDays" type="number" min="1" max="365" />
          </div>
        </div>
        <button class="btn-primary" @click="issueToken" :disabled="issuing">
          <i class="fa-solid fa-key"></i>
          {{ issuing ? '签发中...' : '签发 Token' }}
        </button>
      </section>

      <!-- 新签发的 token（仅显示一次） -->
      <section v-if="lastIssued" class="card section-card token-display">
        <h2 class="section-title">
          <i class="fa-solid fa-exclamation-circle"></i>
          Token 已签发（请立即保存，Secret 仅显示一次）
        </h2>
        <div class="token-fields">
          <div class="token-field">
            <label>Token</label>
            <code>{{ lastIssued.token }}</code>
          </div>
          <div class="token-field">
            <label>Secret</label>
            <code>{{ lastIssued.secret }}</code>
          </div>
          <div class="token-field">
            <label>过期时间</label>
            <code>{{ lastIssued.expiresAt }}</code>
          </div>
        </div>
        <button class="btn-secondary" @click="lastIssued = null">
          <i class="fa-solid fa-check"></i>
          已保存
        </button>
      </section>

      <!-- 集成列表 -->
      <section class="card section-card">
        <h2 class="section-title">
          <i class="fa-solid fa-list"></i>
          已有集成（{{ integrations.length }}）
        </h2>
        <div v-if="loadingList" class="loading-state">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="integrations.length === 0" class="empty-state">
          <i class="fa-solid fa-inbox"></i>
          <p>暂无集成</p>
        </div>
        <div v-else class="integration-list">
          <div v-for="item in integrations" :key="item.id" class="integration-item" :class="{ inactive: !item.active }">
            <div class="item-header">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-status" :class="{ active: item.active }">
                {{ item.active ? '活跃' : '已撤销' }}
              </span>
            </div>
            <div class="item-details">
              <div class="detail-row">
                <span class="detail-label">Token:</span>
                <code class="detail-value">{{ item.token.substring(0, 16) }}...{{ item.token.substring(item.token.length - 8) }}</code>
              </div>
              <div class="detail-row">
                <span class="detail-label">Webhook:</span>
                <span class="detail-value">{{ item.webhookUrl || '未配置' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Origins:</span>
                <span class="detail-value">{{ item.origins.length > 0 ? item.origins.join(', ') : '未配置' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Scopes:</span>
                <span class="detail-value">{{ item.scopes.length > 0 ? item.scopes.join(', ') : '无' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">过期:</span>
                <span class="detail-value">{{ item.expiresAt || '永久' }}</span>
              </div>
            </div>
            <div class="item-actions" v-if="item.active">
              <button class="btn-icon" @click="regenerateSecret(item)" title="重新生成 Secret">
                <i class="fa-solid fa-rotate"></i>
              </button>
              <button class="btn-icon btn-danger-icon" @click="revokeIntegration(item)" title="撤销">
                <i class="fa-solid fa-ban"></i>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'Integration',
  data: function() {
    return {
      loadingList: true,
      issuing: false,
      integrations: [],
      lastIssued: null,
      availableScopes: [
        'app:read', 'app:write',
        'user:read', 'user:write',
        'notification:write',
        'data:read', 'data:write',
        'calendar:read', 'calendar:write',
        'countdown:read',
        'message:read', 'message:write',
        'community:read', 'community:write'
      ],
      newIntegration: {
        name: '',
        webhookUrl: '',
        originsText: '',
        scopes: [],
        ttlDays: 30
      }
    };
  },
  computed: {
    isAdmin: function() {
      var user = this.$store.state.auth.user;
      return user && (user.is_admin === 1 || user.is_class_admin);
    }
  },
  mounted: function() {
    if (this.isAdmin) {
      this.loadIntegrations();
    }
  },
  methods: {
    loadIntegrations: function() {
      var self = this;
      self.loadingList = true;
      api.get('/api/integrations/tokens').then(function(res) {
        if (res.data && res.data.code === 200) {
          self.integrations = res.data.data || [];
        }
      }).catch(function(err) {
        self.$toast && self.$toast.error('加载集成列表失败');
        console.error('[integration] 加载列表失败:', err);
      }).then(function() {
        self.loadingList = false;
      });
    },
    issueToken: function() {
      var self = this;
      if (!self.newIntegration.name) {
        self.$modal.alert({ title: '提示', message: '请填写名称' });
        return;
      }
      var origins = self.newIntegration.originsText
        .split('\n')
        .map(function(s) { return s.trim(); })
        .filter(function(s) { return s.length > 0; });

      self.issuing = true;
      api.post('/api/integrations/tokens', {
        name: self.newIntegration.name,
        webhookUrl: self.newIntegration.webhookUrl,
        origins: origins,
        scopes: self.newIntegration.scopes,
        ttlDays: self.newIntegration.ttlDays
      }).then(function(res) {
        if (res.data && res.data.code === 200 && res.data.data) {
          self.lastIssued = res.data.data;
          self.newIntegration = { name: '', webhookUrl: '', originsText: '', scopes: [], ttlDays: 30 };
          self.loadIntegrations();
        } else {
          self.$modal.alert({ title: '失败', message: res.data.message || '签发失败' });
        }
      }).catch(function(err) {
        self.$modal.alert({ title: '失败', message: err.message || '签发失败' });
      }).then(function() {
        self.issuing = false;
      });
    },
    regenerateSecret: function(item) {
      var self = this;
      self.$modal.confirm({
        title: '重新生成 Secret',
        message: '确定要重新生成 "' + item.name + '" 的 Secret 吗？旧 Secret 将立即失效。'
      }).then(function(result) {
        if (!result) return;
        api.post('/api/integrations/tokens/' + item.id + '/regenerate-secret').then(function(res) {
          if (res.data && res.data.code === 200 && res.data.data) {
            self.$modal.alert({
              title: '新 Secret（请立即保存）',
              message: '新 Secret: ' + res.data.data.secret
            });
          }
        }).catch(function(err) {
          self.$modal.alert({ title: '失败', message: err.message || '重生成失败' });
        });
      });
    },
    revokeIntegration: function(item) {
      var self = this;
      self.$modal.confirm({
        title: '撤销集成',
        message: '确定要撤销 "' + item.name + '" 吗？此操作不可逆。'
      }).then(function(result) {
        if (!result) return;
        api.delete('/api/integrations/tokens/' + item.id).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.loadIntegrations();
          }
        }).catch(function(err) {
          self.$modal.alert({ title: '失败', message: err.message || '撤销失败' });
        });
      });
    }
  }
};
</script>

<style scoped>
.integration-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}

.page-header {
  margin-bottom: 24px;
}
.page-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.page-title i {
  color: var(--primary-color);
}
.page-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 0;
}

.permission-denied {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-secondary);
}
.permission-denied i {
  font-size: 48px;
  margin-bottom: 16px;
  display: block;
}

.section-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
}
.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title i {
  color: var(--primary-color);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-item-full {
  grid-column: 1 / -1;
}
.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.form-item input,
.form-item textarea {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: 14px;
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
}
.form-item input:focus,
.form-item textarea:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-light);
}

.scopes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.scope-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  background: var(--bg-color);
}
.scope-checkbox:hover {
  background: var(--primary-lighter);
}

.token-display {
  border: 2px solid var(--warning-color);
}
.token-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}
.token-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.token-field label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.token-field code {
  background: var(--bg-color);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  border: 1px solid var(--border-color);
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.empty-state i {
  font-size: 36px;
  opacity: 0.5;
}

.integration-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.integration-item {
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 16px;
  border: 1px solid var(--border-color);
  transition: border-color 0.15s var(--ease-standard);
}
.integration-item:hover {
  border-color: var(--primary-color);
}
.integration-item.inactive {
  opacity: 0.55;
}
.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.item-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.item-status {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--border-color);
  color: var(--text-secondary);
}
.item-status.active {
  background: rgba(var(--success-rgb), 0.15);
  color: var(--success-color);
}
.item-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-row {
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.detail-label {
  color: var(--text-secondary);
  min-width: 70px;
  flex-shrink: 0;
}
.detail-value {
  color: var(--text-primary);
  word-break: break-all;
}
.item-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}
.btn-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--primary-light);
  color: var(--primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s var(--ease-standard);
}
.btn-icon:hover {
  background: rgba(var(--primary-rgb), 0.18);
}
.btn-danger-icon {
  background: rgba(var(--danger-rgb), 0.12);
  color: var(--danger-color);
}
.btn-danger-icon:hover {
  background: rgba(var(--danger-rgb), 0.2);
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
