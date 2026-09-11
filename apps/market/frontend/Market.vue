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
              <div v-if="app.capabilities && app.capabilities.length" class="app-caps">
                <span
                  v-for="cap in describeCaps(app.capabilities)"
                  :key="cap.name"
                  class="cap-chip"
                  :class="{ 'cap-chip-notice': cap.level === 'notice' }"
                  :title="cap.description"
                >
                  <i class="fa-solid" :class="cap.icon"></i>{{ cap.label }}
                </span>
              </div>
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

        <section class="market-section plugins-section">
          <div class="section-header">
            <h2><i class="fa-solid fa-plug"></i> 服务端插件</h2>
            <span class="count-badge">{{ catalogPlugins.length }} 个插件</span>
          </div>
          <div v-if="catalogPlugins.length" class="app-grid">
            <article v-for="plugin in catalogPlugins" :key="plugin.name" class="app-card">
              <div class="app-head">
                <div class="app-icon placeholder-icon"><i class="fa-solid fa-plug"></i></div>
                <div class="app-titles">
                  <h3>{{ plugin.label }}</h3>
                  <small>{{ plugin.name }} · v{{ plugin.version }}</small>
                </div>
              </div>
              <p class="app-desc">{{ plugin.description }}</p>
              <div class="app-foot">
                <span v-if="installedPluginMap[plugin.name]" class="installed-label"><i class="fa-solid fa-circle-check"></i> 已安装 v{{ installedPluginMap[plugin.name].version }}</span>
                <button type="button" class="primary-action" :disabled="actionLoading === plugin.name" @click="installPlugin(plugin)">
                  <span v-if="actionLoading === plugin.name" class="mini-spinner"></span>
                  <span v-else>{{ installedPluginMap[plugin.name] ? '重新安装' : '安装' }}</span>
                </button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-plug"></i><p>市场目录中暂无插件</p></div>
          <div v-if="installedPlugins.length" class="installed-list" style="margin-top: 12px;">
            <article v-for="plugin in installedPlugins" :key="'ip-' + plugin.name" class="installed-card">
              <div class="installed-info">
                <div class="installed-title-row">
                  <strong><i class="fa-solid fa-plug"></i> {{ plugin.label }}</strong>
                  <small>v{{ plugin.version }}</small>
                </div>
                <small class="status-hint">{{ plugin.name }}</small>
              </div>
              <div class="installed-actions">
                <button type="button" class="danger-action" :disabled="actionLoading === plugin.name" @click="uninstallPlugin(plugin)">卸载</button>
              </div>
            </article>
          </div>
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
import { describeCapabilities, countNotices } from '@shared/capability-catalog';
import { escapeHtml } from '@shared/html';

export default {
  name: 'Market',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      sources: [],
      selectedSource: 'gitee',
      catalogApps: [],
      installedApps: [],
      catalogPlugins: [],
      installedPlugins: [],
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
    },
    installedPluginMap: function() {
      var result = {};
      this.installedPlugins.forEach(function(plugin) { result[plugin.name] = plugin; });
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
    // 能力清单 → 展示元数据（模板里用，返回 [{name,label,icon,level,description}]）
    describeCaps: function(names) {
      return describeCapabilities(names);
    },
    loadMarket: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      Promise.all([self.loadSources(), self.loadInstalled(), self.loadCatalog(), self.loadInstalledPlugins()]).catch(function(error) {
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
        self.catalogPlugins = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : [];
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
      var caps = Array.isArray(app.capabilities) ? app.capabilities : [];

      // 无能力声明：保持原有一键安装流程，不额外打扰用户
      if (!caps.length) {
        self.runAction('/market/install', app, '安装成功');
        return;
      }

      // 有能力声明：先展示「这个应用会用到什么」，确认后再安装。
      // 走 $modal.confirm 的 html 能力（原生 DOM 字符串，非 Vue 组件）。
      self.$modal.confirm({
        title: '安装「' + (app.label || app.name) + '」',
        html: self.buildCapabilityHtml(app, caps),
        confirmText: '安装',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (!confirmed || self.actionLoading) return;
        self.runAction('/market/install', app, '安装成功');
      });
    },
    // 渲染能力披露清单（返回 HTML 字符串，供 $modal 使用）
    buildCapabilityHtml: function(app, caps) {
      var items = describeCapabilities(caps);
      var rows = items.map(function(item) {
        var cls = item.level === 'notice' ? 'ci-cap-item ci-cap-notice' : 'ci-cap-item';
        var badge = item.known ? '' : '<span class="ci-cap-unknown">未登记</span>';
        return '<div class="' + cls + '">' +
                 '<i class="fa-solid ' + item.icon + '"></i>' +
                 '<div class="ci-cap-body">' +
                   '<strong>' + escapeHtml(item.label) + badge + '</strong>' +
                   '<span>' + escapeHtml(item.description) + '</span>' +
                 '</div>' +
               '</div>';
      }).join('');

      var noticeCount = countNotices(caps);
      var headNote = noticeCount > 0
        ? '<p class="ci-cap-head">此应用将使用以下能力，其中 <strong>' + noticeCount + '</strong> 项需要你留意：</p>'
        : '<p class="ci-cap-head">此应用将使用以下能力：</p>';

      var version = app.version ? 'v' + app.version : '';
      var author = app.author || 'ClassIntra 社区';
      var meta = '<p class="ci-cap-meta">' + escapeHtml(author) +
                 (version ? ' · ' + escapeHtml(version) : '') + '</p>';

      return '<div class="ci-cap-wrapper">' + headNote + meta +
             '<div class="ci-cap-list">' + rows + '</div>' +
             '<p class="ci-cap-foot">应用安装后即可对全班成员开放。你随时可以在已安装列表中卸载它。</p>' +
             '</div>';
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
    // ========== 服务端插件 ==========
    loadInstalledPlugins: function() {
      var self = this;
      // 旧版服务端无此端点时静默降级（插件目录为可选能力）
      return api.get('/market/plugins-installed').then(function(response) {
        var data = response.data && response.data.data;
        self.installedPlugins = data && Array.isArray(data) ? data : [];
      }).catch(function() {});
    },
    installPlugin: function(plugin) {
      var self = this;
      self.$modal.confirm({
        title: '安装插件「' + (plugin.label || plugin.name) + '」',
        message: '插件将以服务端扩展方式安装并热挂载后端接口；含前端文件的插件需要重新构建客户端后才会生效。',
        confirmText: '安装',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (confirmed) self.runPluginAction('/market/install-plugin', plugin, '插件安装成功');
      }).catch(function() {});
    },
    uninstallPlugin: function(plugin) {
      var self = this;
      self.$modal.confirm({ title: '卸载插件', message: '确定要卸载插件「' + plugin.label + '」吗？其后端接口将立即下线。', confirmText: '卸载', cancelText: '取消' }).then(function(confirmed) {
        if (confirmed) self.runPluginAction('/market/uninstall-plugin', plugin, '插件卸载成功');
      }).catch(function() {});
    },
    runPluginAction: function(endpoint, plugin, successMessage) {
      var self = this;
      if (self.actionLoading) return;
      self.actionLoading = plugin.name;
      self.actionStatus = '正在下载并校验插件…';
      self.error = '';
      api.post(endpoint, { name: plugin.name, source: self.selectedSource || 'gitee' }).then(function(response) {
        var result = response.data && response.data.data;
        var note = result && result.requiresRebuild ? '（含前端文件，需重新构建客户端后生效）' : '';
        return Promise.all([self.loadInstalledPlugins(), self.loadCatalog()]).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: successMessage + note, type: 'success' });
        });
      }).catch(function(error) {
        self.error = self.getErrorMessage(error, successMessage.replace('成功', '失败'));
      }).finally(function() {
        self.actionLoading = '';
        self.actionStatus = '';
      });
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
.count-badge { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--secondary-bg); }
.app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.app-card, .installed-card { background: var(--card-bg); border: 1px solid var(--separator-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.app-card { padding: 18px; min-height: 160px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; }
.app-card-header { display: flex; align-items: center; gap: 12px; }
.app-icon { width: 48px; height: 48px; border-radius: var(--radius-pill); display: flex; align-items: center; justify-content: center; color: #fff; overflow: hidden; flex-shrink: 0; }
.app-icon.small { width: 42px; height: 42px; border-radius: var(--radius-md); }
.app-icon img { width: 100%; height: 100%; object-fit: cover; }
.app-title { min-width: 0; }
.app-title h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-title span { display: block; margin-top: 5px; }
.app-description { min-height: 36px; line-height: 1.5; font-size: 13px; }
/* 能力披露 chips：安装前让用户一眼看到应用会用到什么 */
.app-caps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cap-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: var(--radius-pill); background: var(--secondary-bg); color: var(--text-secondary); font-size: 11px; line-height: 1.4; white-space: nowrap; }
.cap-chip i { font-size: 10px; }
/* notice 级：需要用户留意的能力，用警示色轻描边区分 */
.cap-chip-notice { background: rgba(var(--warning-rgb, 255, 149, 0), 0.12); color: rgb(var(--warning-rgb, 255, 149, 0)); }
.app-card-footer { border-top: 1px solid var(--separator-color); padding-top: 14px; }
.installed-label { color: #34c759; font-size: 12px; }
.app-author { color: var(--text-secondary); font-size: 12px; }
.app-action { background: var(--primary-light); color: var(--primary-color); border-color: transparent; font-weight: 600; }
.installed-list { display: flex; flex-direction: column; gap: 10px; }
.installed-card { padding: 14px 18px; }
.installed-info { flex: 1; min-width: 0; }
.installed-title-row { display: flex; align-items: center; gap: 8px; }
.installed-info p { margin: 5px 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-badge { padding: 3px 7px; border-radius: var(--radius-pill); font-size: 11px; }
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
