<template>
  <div class="market-page">
    <AppNavBar title="应用市场" />
    <div class="market-content scrollbar-thin">
      <div class="market-toolbar">
        <div>
          <h1>应用市场</h1>
          <p>浏览、安装和管理 ClassIntra 应用</p>
        </div>
        <div class="market-toolbar-actions">
          <select v-model="selectedSource" class="source-select" :disabled="loading || actionLoading">
            <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option>
          </select>
          <button type="button" class="refresh-btn" :disabled="loading || actionLoading" @click="loadMarket">
            <i class="fa-solid fa-rotate" :class="{ spinning: loading }"></i>
            刷新
          </button>
        </div>
      </div>

      <div v-if="error" class="market-error" role="alert">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>{{ error }}</span>
        <button type="button" @click="loadMarket">重试</button>
      </div>

      <div v-if="loading" class="market-loading" role="status" aria-live="polite">
        <div class="spinner"></div>
        <p>正在加载市场目录...</p>
        <small v-if="activeSource">当前尝试：{{ sourceLabel(activeSource) }}</small>
      </div>
      <div v-if="actionStatus" class="market-progress" role="status" aria-live="polite">
        <span class="mini-spinner"></span>
        <span>{{ actionStatus }}</span>
      </div>
      <div v-if="activeSource && !loading" class="market-source-status" role="status">
        <i class="fa-solid fa-cloud-check"></i>
        <span>当前下载源：{{ sourceLabel(activeSource) }}</span>
      </div>

      <template v-if="!loading">
        <section class="market-section">
          <div class="section-heading">
            <div>
              <h2>市场目录</h2>
              <span v-if="catalogUpdatedAt" class="section-meta">更新于 {{ catalogUpdatedAt }}</span>
            </div>
            <span class="count-badge">{{ catalogApps.length }} 个应用</span>
          </div>
          <div v-if="catalogApps.length" class="app-grid">
            <article v-for="app in catalogApps" :key="app.name" class="app-card">
              <div class="app-card-header">
                <div class="app-icon" :style="{ background: app.color || '#5856D6' }">
                  <img v-if="app.icon" :src="app.icon" :alt="app.label" @error="onIconError" />
                  <i v-else class="fa-solid fa-puzzle-piece"></i>
                </div>
                <div class="app-title">
                  <h3>{{ app.label }}</h3>
                  <span>{{ app.name }} · v{{ app.version || '0.0.0' }}</span>
                </div>
              </div>
              <p class="app-description">{{ app.description || '暂无应用描述' }}</p>
              <div class="app-card-footer">
                <span v-if="installedMap[app.name]" class="installed-label"><i class="fa-solid fa-circle-check"></i> 已安装</span>
                <span v-else class="app-author">{{ app.author || 'ClassIntra 社区' }}</span>
                <button type="button" class="app-action" :disabled="actionLoading === app.name" @click="installApp(app)">
                  <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                  <span v-else>{{ installedMap[app.name] ? '重新安装' : '安装' }}</span>
                </button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-store-slash"></i><p>当前市场源暂无应用</p></div>
        </section>

        <section class="market-section installed-section">
          <div class="section-heading">
            <h2>已安装应用</h2>
            <span class="count-badge">{{ installedApps.length }} 个应用</span>
          </div>
          <div v-if="installedApps.length" class="installed-list">
            <article v-for="app in installedApps" :key="app.name" class="installed-card">
              <div class="app-icon small" :style="{ background: app.color || '#5856D6' }">
                <img v-if="app.icon" :src="app.icon" :alt="app.label" @error="onIconError" />
                <i v-else class="fa-solid fa-puzzle-piece"></i>
              </div>
              <div class="installed-info">
                <div class="installed-title-row">
                  <h3>{{ app.label }}</h3>
                  <span class="status-badge" :class="app.enabled === false ? 'disabled' : 'enabled'">
                    {{ app.enabled === false ? '已暂停' : '已启用' }}
                  </span>
                </div>
                <p>{{ app.description || '暂无应用描述' }}</p>
                <span>当前版本 v{{ app.version || '0.0.0' }}</span>
                <small v-if="app.enabled === false" class="status-hint">暂停后全班成员都无法使用</small>
                <small v-else class="status-hint">对全班成员生效</small>
              </div>
              <div class="installed-actions">
                <button type="button" class="control-action" :class="app.enabled === false ? 'enable' : 'disable'" :disabled="actionLoading === app.name" @click="toggleApp(app)">
                  <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                  <span v-else>{{ app.enabled === false ? '启用' : '暂停' }}</span>
                </button>
                <button type="button" class="secondary-action" :disabled="actionLoading === app.name" @click="updateApp(app)">
                  <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                  <span v-else><i class="fa-solid fa-arrow-up"></i> 更新</span>
                </button>
                <button type="button" class="danger-action" :disabled="actionLoading === app.name" @click="uninstallApp(app)">卸载</button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-box-open"></i><p>暂无已安装的第三方应用</p></div>
        </section>
      </template>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';
import router from '@/router';
import { marketRegistry } from '@/core/market-registry';

export default {
  name: 'Market',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      sources: [],
      selectedSource: 'gitee',
      catalogApps: [],
      installedApps: [],
      catalogUpdatedAt: '',
      activeSource: '',
      loading: true,
      actionLoading: '',
      actionStatus: '',
      error: ''
    };
  },
  computed: {
    installedMap: function() {
      var result = {};
      this.installedApps.forEach(function(app) { result[app.name] = app; });
      return result;
    }
  },
  watch: {
    selectedSource: function() {
      if (!this.loading) this.loadCatalog();
    }
  },
  mounted: function() {
    this.loadMarket();
  },
  methods: {
    loadMarket: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      Promise.all([self.loadSources(), self.loadInstalled(), self.loadCatalog()]).catch(function(error) {
        self.error = self.getErrorMessage(error, '市场数据加载失败');
      }).finally(function() {
        self.loading = false;
      });
    },
    loadSources: function() {
      var self = this;
      return api.get('/market/sources').then(function(response) {
        var data = response.data && response.data.data;
        self.sources = data && Array.isArray(data.sources) ? data.sources : [];
        if (self.sources.length && !self.sources.some(function(source) { return source.id === self.selectedSource; })) {
          self.selectedSource = self.sources[0].id;
        }
      });
    },
    loadCatalog: function() {
      var self = this;
      return api.get('/market/catalog?source=' + encodeURIComponent(self.selectedSource || 'local')).then(function(response) {
        var data = response.data && response.data.data;
        var catalog = data && data.catalog;
        self.activeSource = data && data.source ? data.source : self.selectedSource;
        self.catalogApps = catalog && Array.isArray(catalog.apps) ? catalog.apps : [];
        self.catalogUpdatedAt = catalog && catalog.updated_at ? self.formatDate(catalog.updated_at) : '';
      });
    },
    loadInstalled: function() {
      var self = this;
      return api.get('/market/installed').then(function(response) {
        var data = response.data && response.data.data;
        self.installedApps = data && Array.isArray(data.apps) ? data.apps : [];
      });
    },
    installApp: function(app) {
      var self = this;
      self.runAction('/market/install', app, '安装成功');
    },
    updateApp: function(app) {
      this.runAction('/market/update', app, '更新成功');
    },
    toggleApp: function(app) {
      var self = this;
      var enabled = app.enabled === false;
      var message = enabled ? '启用后全班成员都可以使用此应用。' : '暂停后全班成员都将无法使用此应用。';
      self.$modal.confirm({
        title: enabled ? '启用应用' : '暂停应用',
        message: message,
        confirmText: enabled ? '启用' : '暂停',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (!confirmed || self.actionLoading) return;
        self.actionLoading = app.name;
        self.error = '';
        return api.put('/admin/app-control/' + encodeURIComponent(app.name), { enabled: enabled })
          .then(function() {
            app.enabled = enabled;
            self.$store.commit('toast/SHOW_TOAST', { message: enabled ? '应用已启用，全班已同步' : '应用已暂停，全班已同步', type: 'success' });
            return self.refreshMarketRuntime();
          });
      }).catch(function(error) {
        if (error) self.error = self.getErrorMessage(error, enabled ? '启用失败' : '暂停失败');
      }).finally(function() {
        self.actionLoading = '';
      });
    },
    uninstallApp: function(app) {
      var self = this;
      self.$modal.confirm({ title: '卸载应用', message: '确定要卸载“' + app.label + '”吗？', confirmText: '卸载', cancelText: '取消' }).then(function(confirmed) {
        if (confirmed) self.runAction('/market/uninstall', app, '卸载成功');
      }).catch(function() {});
    },
    runAction: function(endpoint, app, successMessage) {
      var self = this;
      if (self.actionLoading) return;
      self.actionLoading = app.name;
      self.actionStatus = endpoint.indexOf('/update') !== -1 ? '正在检查更新并准备安装…' : '正在下载并校验应用…';
      self.error = '';
      api.post(endpoint, { name: app.name, source: self.selectedSource || 'gitee' }).then(function(response) {
        var result = response.data && response.data.data;
        var source = result && result.source ? self.sourceLabel(result.source) : '';
        return self.refreshMarketRuntime().then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: source ? successMessage + '（使用' + source + '）' : successMessage, type: 'success' });
        });
      }).catch(function(error) {
        self.error = self.getErrorMessage(error, successMessage.replace('成功', '失败'));
      }).finally(function() {
        self.actionLoading = '';
        self.actionStatus = '';
      });
    },
    refreshMarketRuntime: function() {
      var self = this;
      return marketRegistry.refresh().then(function(apps) {
        if (router.registerMarketApps) router.registerMarketApps(apps);
        if (self.$store && self.$store.dispatch) self.$store.dispatch('desktop/refreshAllWidgets');
        if (window.ClassIntraMarket) window.ClassIntraMarket.apps = window.ClassIntraMarket.apps || {};
        window.dispatchEvent(new CustomEvent('classintra-market-refresh', { detail: apps }));
        return Promise.all([self.loadInstalled(), self.loadCatalog()]);
      });
    },
    sourceLabel: function(sourceId) {
      var source = this.sources.find(function(item) { return item.id === sourceId; });
      return source ? source.label.replace('官方市场（', '').replace('）', '') : sourceId;
    },
    getErrorMessage: function(error, fallback) {
      var response = error && error.response && error.response.data;
      return response && response.message ? response.message : (error && error.message ? error.message : fallback);
    },
    formatDate: function(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return value;
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    },
    onIconError: function(event) {
      event.target.style.display = 'none';
    }
  }
};
</script>

<style scoped>
.market-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-color); }
.market-content { flex: 1; min-height: 0; padding: 28px 34px 48px; overflow-y: auto; }
.market-toolbar, .section-heading, .app-card-footer, .installed-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.market-toolbar { margin-bottom: 26px; }
h1, h2, h3, p { margin: 0; }
h1 { color: var(--text-primary); font-size: 28px; }
h2 { color: var(--text-primary); font-size: 20px; }
h3 { color: var(--text-primary); font-size: 16px; }
.market-toolbar p, .app-description, .installed-info p { color: var(--text-secondary); }
.market-toolbar p { margin-top: 6px; }
.market-toolbar-actions, .installed-actions { display: flex; align-items: center; gap: 10px; }
.source-select, .refresh-btn, .app-action, .secondary-action, .danger-action, .market-error button { border: 1px solid var(--separator-color); border-radius: var(--radius-md); padding: 9px 14px; background: var(--card-bg); color: var(--text-primary); cursor: pointer; }
.refresh-btn { background: var(--primary-color); color: #fff; border-color: var(--primary-color); }
button:disabled { opacity: .55; cursor: not-allowed; }
.market-error { display: flex; align-items: center; gap: 10px; padding: 14px 16px; margin-bottom: 24px; border-radius: var(--radius-md); background: rgba(255, 59, 48, .1); color: #ff3b30; }
.market-error button { margin-left: auto; color: #ff3b30; background: transparent; border-color: currentColor; }
.market-progress, .market-source-status { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 16px; border-radius: var(--radius-md); background: var(--secondary-bg); color: var(--text-secondary); font-size: 13px; }
.market-source-status { color: #248a3d; }
.market-loading, .empty-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; min-height: 180px; color: var(--text-secondary); }
.market-section { margin-bottom: 34px; }
.section-heading { margin-bottom: 14px; }
.section-meta, .count-badge, .installed-info span, .app-title span { color: var(--text-secondary); font-size: 12px; }
.section-meta { display: block; margin-top: 4px; }
.count-badge { padding: 5px 9px; border-radius: 999px; background: var(--secondary-bg); }
.app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.app-card, .installed-card { background: var(--card-bg); border: 1px solid var(--separator-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.app-card { padding: 18px; min-height: 160px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; }
.app-card-header { display: flex; align-items: center; gap: 12px; }
.app-icon { width: 48px; height: 48px; border-radius: 13px; display: flex; align-items: center; justify-content: center; color: #fff; overflow: hidden; flex-shrink: 0; }
.app-icon.small { width: 42px; height: 42px; border-radius: 11px; }
.app-icon img { width: 100%; height: 100%; object-fit: cover; }
.app-title { min-width: 0; }
.app-title h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-title span { display: block; margin-top: 5px; }
.app-description { min-height: 36px; line-height: 1.5; font-size: 13px; }
.app-card-footer { border-top: 1px solid var(--separator-color); padding-top: 14px; }
.installed-label { color: #34c759; font-size: 12px; }
.app-author { color: var(--text-secondary); font-size: 12px; }
.app-action { background: var(--primary-light); color: var(--primary-color); border-color: transparent; font-weight: 600; }
.installed-list { display: flex; flex-direction: column; gap: 10px; }
.installed-card { padding: 14px 18px; }
.installed-info { flex: 1; min-width: 0; }
.installed-title-row { display: flex; align-items: center; gap: 8px; }
.installed-info p { margin: 5px 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-badge { padding: 3px 7px; border-radius: 999px; font-size: 11px; }
.status-badge.enabled { color: #248a3d; background: rgba(52, 199, 89, .12); }
.status-badge.disabled { color: #b42318; background: rgba(255, 59, 48, .12); }
.status-hint { display: block; margin-top: 5px; color: var(--text-secondary); font-size: 11px; }
.control-action { border: 1px solid transparent; border-radius: var(--radius-md); padding: 9px 12px; background: transparent; cursor: pointer; }
.control-action.enable { color: #248a3d; border-color: rgba(52, 199, 89, .35); }
.control-action.disable { color: #b42318; border-color: rgba(255, 59, 48, .25); }
.secondary-action { color: var(--primary-color); }
.danger-action { color: #ff3b30; }
.spinner, .mini-spinner { border: 3px solid var(--separator-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
.spinner { width: 30px; height: 30px; }
.mini-spinner { display: inline-block; width: 13px; height: 13px; border-width: 2px; vertical-align: -2px; }
.spinning { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .market-content { padding: 20px 16px 32px; } .market-toolbar { align-items: flex-start; flex-direction: column; } .market-toolbar-actions { width: 100%; } .source-select, .refresh-btn { flex: 1; } .installed-card { align-items: flex-start; flex-wrap: wrap; } .installed-actions { width: 100%; justify-content: flex-end; } }
</style>
