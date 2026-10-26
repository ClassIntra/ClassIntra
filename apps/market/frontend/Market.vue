<template>
  <div class="market-page">
    <AppNavBar title="应用市场" />
    <div class="market-content scrollbar-thin">
      <div class="market-toolbar">
        <div class="toolbar-row">
          <div class="toolbar-lead">
            <h1>应用市场</h1>
            <p>浏览、安装和管理 ClassIntra 应用与插件</p>
          </div>
          <div class="market-toolbar-actions">
            <!-- 源切换：按钮组（平板上原生 select 不显眼且体验差） -->
            <div class="source-chips" role="tablist" aria-label="市场源">
              <button
                v-for="source in sources"
                :key="source.id"
                type="button"
                class="source-chip"
                :class="{ 'source-chip--active': selectedSource === source.id }"
                role="tab"
                :aria-selected="selectedSource === source.id ? 'true' : 'false'"
                @click="selectedSource = source.id"
              >{{ source.label }}</button>
            </div>
            <button type="button" class="refresh-btn" :disabled="loading || actionLoading" @click="loadMarket">
              <i class="fa-solid fa-rotate" :class="{ spinning: loading }"></i>
              刷新
            </button>
          </div>
        </div>
        <div class="market-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input v-model="searchQuery" type="text" placeholder="搜索应用或插件…" />
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
        <!-- 分区标签栏：宽屏作分区导航，竖屏为顶部横向可滚动标签栏 -->
        <nav class="market-tabs" aria-label="市场分区">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="market-tab"
            :class="{ active: activeTab === tab.id }"
            :aria-pressed="activeTab === tab.id ? 'true' : 'false'"
            @click="activeTab = tab.id"
          >
            <i class="fa-solid" :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
            <span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
          </button>
        </nav>

        <!-- 搜索无结果：整页统一提示，避免各分区重复出现空状态 -->
        <div v-if="hasSearchQuery && activeTabMatchCount === 0" class="empty-state search-empty">
          <i class="fa-solid fa-magnifying-glass"></i>
          <p>未找到与「{{ searchQuery }}」匹配的应用或插件</p>
        </div>

        <section v-show="activeTab === 'apps' && showSection(filteredCatalog)" class="market-section">
          <div class="section-heading">
            <div>
              <h2>可安装应用</h2>
              <span class="section-meta">
                更新于 {{ catalogUpdatedAt }}
                <span v-if="verifiedLabel" class="verify-badge" :class="{ ok: catalogVerified === true }">
                  <i class="fa-solid" :class="catalogVerified === true ? 'fa-shield-halved' : 'fa-shield'"></i> {{ verifiedLabel }}
                </span>
              </span>
            </div>
            <span class="count-badge">{{ filteredCatalog.length }} 个应用</span>
          </div>
          <div v-if="filteredCatalog.length" class="app-grid">
            <article v-for="app in filteredCatalog" :key="app.name" class="app-card">
              <div class="app-card-header">
                <div class="app-icon" :style="{ background: app.color || '#5856D6' }">
                  <img v-if="app.icon && !iconErrors[app.name]" :src="app.icon" :alt="app.label" @error="onIconError(app)" />
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
                <span class="app-author">
                  {{ app.author || 'ClassIntra 社区' }}
                  <span v-if="installedMap[app.name]" class="installed-flag"><i class="fa-solid fa-circle-check"></i> 已安装</span>
                </span>
                <span class="footer-actions">
                  <button type="button" class="secondary-action" @click="openAppDetail(app)"><i class="fa-solid fa-circle-info"></i> 详情</button>
                  <button type="button" class="app-action" :disabled="actionLoading === app.name" @click="installApp(app)">
                    <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                    <span v-else>{{ installedMap[app.name] ? '重新安装' : '安装' }}</span>
                  </button>
                </span>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-store-slash"></i><p>当前市场源暂无应用</p></div>
        </section>

        <section v-show="activeTab === 'apps' && showSection(filteredInstalledApps)" class="market-section installed-section">
          <div class="section-heading sub-heading">
            <h2>已安装应用</h2>
            <span class="installed-heading-actions">
              <button
                v-if="Object.keys(appUpdateMap).length"
                type="button"
                class="secondary-action"
                :disabled="updateAllLoading"
                @click="updateAllApps"
              >
                <span v-if="updateAllLoading" class="mini-spinner"></span>
                <span v-else><i class="fa-solid fa-rotate"></i> 全部更新（{{ Object.keys(appUpdateMap).length }}）</span>
              </button>
              <span class="count-badge">{{ filteredInstalledApps.length }} 个应用</span>
            </span>
          </div>
          <div v-if="filteredInstalledApps.length" class="installed-list">
            <article v-for="app in filteredInstalledApps" :key="app.name" class="installed-card">
              <div class="app-icon small" :style="{ background: app.color || '#5856D6' }">
                <img v-if="app.icon && !iconErrors[app.name]" :src="app.icon" :alt="app.label" @error="onIconError(app)" />
                <i v-else class="fa-solid fa-puzzle-piece"></i>
              </div>
              <div class="installed-info">
                <div class="installed-title-row">
                  <h3>{{ app.label }}</h3>
                  <span v-if="appUpdateMap[app.name]" class="status-badge updatable">
                    <i class="fa-solid fa-arrow-up"></i> 可更新 v{{ appUpdateMap[app.name] }}
                  </span>
                  <span v-if="app.configMissing && app.configMissing.length" class="status-badge pending-config">
                    <i class="fa-solid fa-triangle-exclamation"></i> 待配置
                  </span>
                  <span class="status-badge" :class="app.enabled === false ? 'disabled' : 'enabled'">
                    {{ app.enabled === false ? '已暂停' : '已启用' }}
                  </span>
                </div>
                <p>{{ app.description || '暂无应用描述' }}</p>
                <span>当前版本 v{{ app.version || '0.0.0' }} · {{ app.author || 'ClassIntra 社区' }}</span>
                <small v-if="app.enabled === false" class="status-hint">暂停后全班成员都无法使用</small>
                <small v-else class="status-hint">对全班成员生效</small>
              </div>
              <div class="installed-actions">
                <button v-if="app.hasConfig" type="button" class="secondary-action" @click="openConfig(app)">
                  <i class="fa-solid fa-sliders"></i> 配置
                </button>
                <button type="button" class="control-action" :class="app.enabled === false ? 'enable' : 'disable'" :disabled="actionLoading === app.name" @click="toggleApp(app)">
                  <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                  <span v-else>{{ app.enabled === false ? '启用' : '暂停' }}</span>
                </button>
                <button type="button" class="secondary-action" :class="{ 'update-available': appUpdateMap[app.name] }" :disabled="actionLoading === app.name" @click="updateApp(app)">
                  <span v-if="actionLoading === app.name" class="mini-spinner"></span>
                  <span v-else><i class="fa-solid fa-arrow-up"></i> 更新</span>
                </button>
                <button type="button" class="danger-action" :disabled="actionLoading === app.name" @click="uninstallApp(app)">卸载</button>
              </div>
            </article>
            <!-- 应用配置面板（manifest.config 声明 → 安装时引导填写，值存数据库，保存后即时生效） -->
            <!-- 注意：面板在 v-for 外渲染，configEditing 归属判定用 configEditingIn，禁止引用 v-for 的 app 变量 -->
            <article v-if="configEditing && configEditingIn(installedApps)" :key="'cfg-' + configEditing" class="config-editor">
              <div v-if="configLoading" class="cfg-loading"><span class="mini-spinner"></span> 正在读取配置…</div>
              <template v-else>
                <div class="cfg-head">
                  <h4><i class="fa-solid fa-sliders"></i> 配置「{{ configLabel }}」</h4>
                  <button type="button" class="cfg-close" @click="closeConfig"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <p v-if="configMissing.length" class="cfg-warning">
                  <i class="fa-solid fa-triangle-exclamation"></i> 有 {{ configMissing.length }} 项必填配置未完成，应用可能无法正常工作。
                </p>
                <div class="cfg-row" v-for="item in configSchema" :key="item.key">
                  <label :for="'cfg-' + item.key">
                    {{ item.label }}<span v-if="item.required" class="cfg-required">*</span>
                    <code class="cfg-key">{{ item.key }}</code>
                  </label>
                  <input v-if="item.type === 'boolean'" type="checkbox" class="cfg-checkbox" :id="'cfg-' + item.key" v-model="configValues[item.key]" />
                  <input v-else class="cfg-input" :id="'cfg-' + item.key"
                         :type="item.type === 'secret' ? 'password' : (item.type === 'number' ? 'number' : 'text')"
                         v-model="configValues[item.key]" :placeholder="configPlaceholder(item)" autocomplete="off" />
                  <small v-if="item.description" class="cfg-desc">{{ item.description }}</small>
                </div>
                <div class="cfg-foot">
                  <small class="cfg-hint">配置保存在服务器数据库中，保存后即时生效，无需重启。</small>
                  <button type="button" class="primary-action" :disabled="configSaving" @click="saveConfig">
                    <span v-if="configSaving" class="mini-spinner"></span>
                    <span v-else>保存配置</span>
                  </button>
                </div>
              </template>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-box-open"></i><p>暂无已安装的第三方应用</p></div>
        </section>

        <section v-show="activeTab === 'plugins'" class="market-section plugins-section">
          <template v-if="showSection(filteredPlugins)">
            <div class="section-heading">
              <div>
                <h2>可安装插件</h2>
                <span class="section-meta">插件为服务端扩展，装好后可在下方随时启用或暂停</span>
              </div>
              <span class="count-badge">{{ filteredPlugins.length }} 个插件</span>
            </div>
            <div v-if="filteredPlugins.length" class="app-grid">
              <article v-for="plugin in filteredPlugins" :key="plugin.name" class="app-card">
                <div class="app-card-header">
                  <div class="app-icon plugin-icon"><i class="fa-solid fa-plug"></i></div>
                  <div class="app-title">
                    <h3>{{ plugin.label }}</h3>
                    <span>{{ plugin.name }} · v{{ plugin.version || '0.0.0' }}</span>
                  </div>
                </div>
                <p class="app-description">{{ plugin.description || '暂无插件描述' }}</p>
                <div class="app-card-footer">
                  <span class="app-author">
                    {{ plugin.author || 'ClassIntra 社区' }}
                    <span v-if="installedPluginMap[plugin.name]" class="installed-flag"><i class="fa-solid fa-circle-check"></i> 已安装</span>
                  </span>
                  <button type="button" class="app-action" :disabled="actionLoading === plugin.name" @click="installPlugin(plugin)">
                    <span v-if="actionLoading === plugin.name" class="mini-spinner"></span>
                    <span v-else>{{ installedPluginMap[plugin.name] ? '重新安装' : '安装' }}</span>
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="empty-state"><i class="fa-solid fa-plug"></i><p>当前市场源暂无插件</p></div>
          </template>

          <template v-if="showSection(filteredInstalledPlugins)">
            <div class="section-heading sub-heading">
              <h2>已安装插件</h2>
              <span class="count-badge">{{ filteredInstalledPlugins.length }} 个插件</span>
            </div>
          <div v-if="filteredInstalledPlugins.length" class="installed-list">
            <article v-for="plugin in filteredInstalledPlugins" :key="'ip-' + plugin.name" class="installed-card">
              <div class="app-icon small plugin-icon"><i class="fa-solid fa-plug"></i></div>
              <div class="installed-info">
                <div class="installed-title-row">
                  <h3>{{ plugin.label }}</h3>
                  <span v-if="pluginUpdateMap[plugin.name]" class="status-badge updatable">
                    <i class="fa-solid fa-arrow-up"></i> 可更新 v{{ pluginUpdateMap[plugin.name] }}
                  </span>
                  <span v-if="plugin.configMissing && plugin.configMissing.length" class="status-badge pending-config">
                    <i class="fa-solid fa-triangle-exclamation"></i> 待配置
                  </span>
                  <span v-if="plugin.canDisable === false" class="status-badge always-on">常开</span>
                  <span v-else class="status-badge" :class="plugin.enabled === false ? 'disabled' : 'enabled'">
                    {{ plugin.enabled === false ? '已暂停' : '已启用' }}
                  </span>
                </div>
                <p>{{ plugin.description || '暂无插件描述' }}</p>
                <span>当前版本 v{{ plugin.version || '0.0.0' }} · {{ plugin.author || 'ClassIntra 社区' }}</span>
                <small v-if="plugin.canDisable === false" class="status-hint">该插件声明为常开，不可暂停</small>
                <small v-else-if="plugin.enabled === false" class="status-hint">暂停后插件接口即时下线，无需重启</small>
                <small v-else class="status-hint">插件接口对全班成员开放</small>
              </div>
              <div class="installed-actions">
                <!-- 兼容模式使用管理：仅班管 / 管理员可见，只有插件启用时才有会话可管 -->
                <button v-if="plugin.name === 'web-proxy' && plugin.enabled !== false && isManager" type="button" class="secondary-action" @click="openProxyPanel">
                  <i class="fa-solid fa-users-viewfinder"></i> 管理
                </button>
                <button v-if="plugin.hasConfig" type="button" class="secondary-action" @click="openConfig(plugin)">
                  <i class="fa-solid fa-sliders"></i> 配置
                </button>
                <button v-if="plugin.canDisable !== false" type="button" class="control-action" :class="plugin.enabled === false ? 'enable' : 'disable'" :disabled="actionLoading === plugin.name" @click="togglePlugin(plugin)">
                  <span v-if="actionLoading === plugin.name" class="mini-spinner"></span>
                  <span v-else>{{ plugin.enabled === false ? '启用' : '暂停' }}</span>
                </button>
                <button type="button" class="secondary-action" :class="{ 'update-available': pluginUpdateMap[plugin.name] }" :disabled="actionLoading === plugin.name" @click="updatePlugin(plugin)">
                  <span v-if="actionLoading === plugin.name" class="mini-spinner"></span>
                  <span v-else><i class="fa-solid fa-arrow-up"></i> 更新</span>
                </button>
                <button type="button" class="danger-action" :disabled="actionLoading === plugin.name" @click="uninstallPlugin(plugin)">卸载</button>
              </div>
            </article>
            <!-- 插件配置面板（与已安装应用共用 config* 状态） -->
            <article v-if="configEditing && configEditingIn(installedPlugins)" :key="'cfgp-' + configEditing" class="config-editor">
              <div v-if="configLoading" class="cfg-loading"><span class="mini-spinner"></span> 正在读取配置…</div>
              <template v-else>
                <div class="cfg-head">
                  <h4><i class="fa-solid fa-sliders"></i> 配置「{{ configLabel }}」</h4>
                  <button type="button" class="cfg-close" @click="closeConfig"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <p v-if="configMissing.length" class="cfg-warning">
                  <i class="fa-solid fa-triangle-exclamation"></i> 有 {{ configMissing.length }} 项必填配置未完成，插件可能无法正常工作。
                </p>
                <div class="cfg-row" v-for="item in configSchema" :key="item.key">
                  <label :for="'cfg-' + item.key">
                    {{ item.label }}<span v-if="item.required" class="cfg-required">*</span>
                    <code class="cfg-key">{{ item.key }}</code>
                  </label>
                  <input v-if="item.type === 'boolean'" type="checkbox" class="cfg-checkbox" :id="'cfg-' + item.key" v-model="configValues[item.key]" />
                  <input v-else class="cfg-input" :id="'cfg-' + item.key"
                         :type="item.type === 'secret' ? 'password' : (item.type === 'number' ? 'number' : 'text')"
                         v-model="configValues[item.key]" :placeholder="configPlaceholder(item)" autocomplete="off" />
                  <small v-if="item.description" class="cfg-desc">{{ item.description }}</small>
                </div>
                <div class="cfg-foot">
                  <small class="cfg-hint">配置保存在服务器数据库中，保存后即时生效，无需重启。</small>
                  <button type="button" class="primary-action" :disabled="configSaving" @click="saveConfig">
                    <span v-if="configSaving" class="mini-spinner"></span>
                    <span v-else>保存配置</span>
                  </button>
                </div>
              </template>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-plug-circle-xmark"></i><p>暂无已安装的插件</p></div>
          </template>
        </section>

        <!-- ===== 主题分区：市场分发的纯数据 JSON 主题包，安装后全班主题选择中立即可见 ===== -->
        <section v-show="activeTab === 'themes' && showSection(filteredThemes)" class="market-section">
          <div class="section-heading">
            <div>
              <h2>可安装主题</h2>
              <span class="section-meta">安装后出现在全班成员的主题选择里；纯数据包，无脚本执行</span>
            </div>
            <span class="count-badge">{{ filteredThemes.length }} 个主题</span>
          </div>
          <div v-if="filteredThemes.length" class="app-grid">
            <article v-for="theme in filteredThemes" :key="theme.name" class="app-card">
              <div class="app-card-header">
                <div class="app-icon" :style="{ background: theme.color || (theme.type === 'dark' ? '#1C1C1E' : '#E8E8ED') }">
                  <i class="fa-solid fa-palette"></i>
                </div>
                <div class="app-title">
                  <h3>{{ theme.label }}</h3>
                  <span>{{ theme.name }} · v{{ theme.version || '0.0.0' }}</span>
                </div>
              </div>
              <p class="app-description">{{ theme.description || '暂无主题描述' }}</p>
              <div class="app-caps">
                <span class="cap-chip">
                  <i class="fa-solid" :class="theme.type === 'dark' ? 'fa-moon' : 'fa-sun'"></i>{{ theme.type === 'dark' ? '深色' : '浅色' }}
                </span>
                <span v-if="themeInstalledMap[theme.name]" class="cap-chip cap-chip-notice"><i class="fa-solid fa-circle-check"></i> 已安装</span>
              </div>
              <div class="app-card-footer">
                <span class="app-author">{{ theme.author || 'ClassIntra 社区' }}</span>
                <button type="button" class="app-action" :disabled="actionLoading === theme.name" @click="installTheme(theme)">
                  <span v-if="actionLoading === theme.name" class="mini-spinner"></span>
                  <span v-else>{{ themeInstalledMap[theme.name] ? '重新安装' : '安装' }}</span>
                </button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-palette"></i><p>当前市场源暂无主题</p></div>
        </section>

        <section v-show="activeTab === 'themes' && showSection(filteredInstalledThemes)" class="market-section installed-section">
          <div class="section-heading sub-heading">
            <h2>已安装主题</h2>
            <span class="count-badge">{{ filteredInstalledThemes.length }} 个主题</span>
          </div>
          <div v-if="filteredInstalledThemes.length" class="installed-list">
            <article v-for="theme in filteredInstalledThemes" :key="theme.id" class="installed-card">
              <div class="app-icon small" :style="{ background: theme.type === 'dark' ? '#1C1C1E' : '#E8E8ED' }">
                <i class="fa-solid fa-palette"></i>
              </div>
              <div class="installed-info">
                <div class="installed-title-row">
                  <h3>{{ theme.name }}</h3>
                  <span class="status-badge" :class="theme.type === 'dark' ? 'disabled' : 'enabled'">
                    {{ theme.type === 'dark' ? '深色' : '浅色' }}
                  </span>
                </div>
                <p>{{ theme.description || '暂无主题描述' }}</p>
                <span>当前版本 v{{ theme.version || '0.0.0' }} · {{ theme.author || 'ClassIntra 社区' }}</span>
                <small class="status-hint">全班成员的主题选择里可见</small>
              </div>
              <div class="installed-actions">
                <button type="button" class="danger-action" :disabled="actionLoading === theme.id" @click="uninstallTheme(theme)">卸载</button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><i class="fa-solid fa-palette"></i><p>暂无已安装的市场主题</p></div>
        </section>
      </template>
    </div>

    <!-- 应用详情弹窗：截图 / 更新日志 / 完整描述 / 能力清单 -->
    <div v-if="detailApp" class="proxy-overlay" @click.self="closeAppDetail">
      <div class="proxy-panel app-detail-panel" role="dialog" aria-modal="true" :aria-label="'应用详情 ' + (detailApp.label || detailApp.name)">
        <div class="proxy-head">
          <div class="proxy-head-text">
            <h3><i class="fa-solid fa-circle-info"></i> {{ detailApp.label || detailApp.name }}</h3>
            <p>v{{ detailApp.version || '0.0.0' }} · {{ detailApp.author || 'ClassIntra 社区' }}</p>
          </div>
          <button type="button" class="proxy-close" @click="closeAppDetail"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="app-detail-body">
          <div v-if="detailScreenshots.length" class="detail-screens">
            <img v-for="(src, idx) in detailScreenshots" :key="idx" :src="src" :alt="'截图 ' + (idx + 1)" loading="lazy" />
          </div>
          <p class="detail-desc">{{ detailApp.description || '暂无应用描述' }}</p>
          <div v-if="detailApp.capabilities && detailApp.capabilities.length" class="detail-caps">
            <span v-for="cap in describeCaps(detailApp.capabilities)" :key="cap.name" class="cap-chip" :class="{ 'cap-chip-notice': cap.level === 'notice' }" :title="cap.description">
              <i class="fa-solid" :class="cap.icon"></i>{{ cap.label }}
            </span>
          </div>
          <div v-if="detailApp.changelog && detailApp.changelog.length" class="detail-changelog">
            <h4><i class="fa-solid fa-list-check"></i> 更新日志</h4>
            <div v-for="(entry, idx) in detailApp.changelog" :key="idx" class="changelog-entry">
              <strong>v{{ entry.version }}</strong>
              <span v-if="entry.date" class="changelog-date">{{ entry.date }}</span>
              <p>{{ entry.notes }}</p>
            </div>
          </div>
        </div>
        <div class="app-detail-foot">
          <button type="button" class="app-action" :disabled="actionLoading === detailApp.name" @click="installApp(detailApp)">
            <span v-if="actionLoading === detailApp.name" class="mini-spinner"></span>
            <span v-else>{{ installedMap[detailApp.name] ? '重新安装' : '安装' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 兼容模式使用管理浮窗：班管查看谁在用、可断开单个或全部会话 -->
    <div v-if="proxyPanelOpen" class="proxy-overlay" @click.self="closeProxyPanel">
      <div class="proxy-panel" role="dialog" aria-modal="true" aria-label="兼容模式使用管理">
        <div class="proxy-head">
          <div class="proxy-head-text">
            <h3><i class="fa-solid fa-users-viewfinder"></i> 兼容模式使用管理</h3>
            <p>查看谁正在使用兼容模式浏览，并可随时断开会话</p>
          </div>
          <button type="button" class="proxy-close" @click="closeProxyPanel"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="proxy-meta">
          <span class="proxy-meta-item" :class="{ ok: proxyInfo.running }">
            <i class="fa-solid fa-signal"></i> 代理{{ proxyInfo.running ? '运行中' : '未运行' }}
          </span>
          <span class="proxy-meta-item">
            <i class="fa-solid fa-users"></i> 会话 {{ proxySessions.length }} / {{ proxyInfo.maxSessions || 0 }}
          </span>
          <span class="proxy-meta-item" :class="{ ok: proxyInfo.available }">
            <i class="fa-solid fa-desktop"></i> {{ proxyInfo.available ? '兼容浏览器可用' : '兼容浏览器不可用' }}
          </span>
        </div>

        <div v-if="proxyError" class="proxy-error">
          <i class="fa-solid fa-triangle-exclamation"></i> {{ proxyError }}
        </div>

        <!-- 可使用者：全班可用 / 仅指定成员（管理员与班管始终可用） -->
        <div class="proxy-access">
          <div class="proxy-access-head">
            <strong><i class="fa-solid fa-user-shield"></i> 可使用者</strong>
            <small>{{ proxyAccessDraft.mode === 'allowlist' ? '仅选中的成员可使用兼容模式' : '全班成员都能使用兼容模式' }}</small>
          </div>
          <div class="proxy-access-modes">
            <button
              type="button"
              class="proxy-mode-btn"
              :class="{ active: proxyAccessDraft.mode === 'all' }"
              @click="setProxyAccessMode('all')"
            >全部成员</button>
            <button
              type="button"
              class="proxy-mode-btn"
              :class="{ active: proxyAccessDraft.mode === 'allowlist' }"
              @click="setProxyAccessMode('allowlist')"
            >仅指定成员</button>
          </div>
          <div v-if="proxyAccessDraft.mode === 'allowlist'" class="proxy-access-body">
            <div class="proxy-user-search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input
                v-model="proxyUserQuery"
                type="text"
                placeholder="搜索成员昵称 / 姓名 / 学号"
                @input="onProxyUserQuery"
              />
              <span v-if="proxyUserSearching" class="mini-spinner"></span>
            </div>
            <div v-if="proxyUserResults.length" class="proxy-user-results">
              <button
                v-for="user in proxyUserResults"
                :key="user.id"
                type="button"
                class="proxy-user-result"
                :disabled="isProxyUserPicked(user.id)"
                @click="addProxyUser(user)"
              >
                <span class="proxy-user-name">{{ user.name || user.id }}</span>
                <small>{{ user.id }}</small>
                <i class="fa-solid" :class="isProxyUserPicked(user.id) ? 'fa-check' : 'fa-plus'"></i>
              </button>
            </div>
            <div class="proxy-picked">
              <span v-for="user in proxyAccessDraft.users" :key="user.id" class="proxy-picked-chip">
                {{ user.name || user.id }}
                <button type="button" @click="removeProxyUser(user.id)" aria-label="移除"><i class="fa-solid fa-xmark"></i></button>
              </span>
              <small v-if="!proxyAccessDraft.users.length" class="proxy-picked-empty">
                尚未选择成员；管理员与班管始终可用
              </small>
            </div>
          </div>
          <div class="proxy-access-foot">
            <small>保存后立即生效，已在使用的成员不受影响。</small>
            <button
              type="button"
              class="secondary-action"
              :disabled="!proxyAccessDirty || proxyAccessSaving"
              @click="saveProxyAccess"
            >
              <span v-if="proxyAccessSaving" class="mini-spinner"></span>
              <span v-else>保存</span>
            </button>
          </div>
        </div>

        <div v-if="proxyLoading && !proxySessions.length" class="proxy-empty">
          <span class="mini-spinner"></span> 正在读取使用情况…
        </div>
        <div v-else-if="!proxySessions.length" class="proxy-empty">
          <i class="fa-solid fa-mug-hot"></i>
          <p>当前没有人在使用兼容模式</p>
          <small>普通浏览不占用兼容会话，只有成员点「兼容模式」打开站点时才会出现在这里</small>
        </div>
        <div v-else class="proxy-sessions">
          <article v-for="sess in proxySessions" :key="sess.id" class="proxy-session">
            <div class="proxy-session-main">
              <div class="proxy-session-user">
                <i class="fa-solid fa-user"></i>
                <strong>{{ sess.user && sess.user.name ? sess.user.name : '未知用户' }}</strong>
                <span class="proxy-duration">{{ formatDuration(sess.duration) }}</span>
                <span v-if="sess.audioEnabled" class="proxy-chip audio"><i class="fa-solid fa-volume-high"></i> 声音开</span>
                <span v-else class="proxy-chip"><i class="fa-solid fa-volume-xmark"></i> 声音关</span>
              </div>
              <div class="proxy-session-url" :title="sess.url">{{ sess.url }}</div>
            </div>
            <button type="button" class="danger-action" :disabled="proxyClosing === sess.id" @click="closeProxySession(sess)">
              <span v-if="proxyClosing === sess.id" class="mini-spinner"></span>
              <span v-else>断开</span>
            </button>
          </article>
        </div>

        <div class="proxy-foot">
          <small>断开后对应成员需重新打开兼容模式；会话无操作 3 分钟会自动回收。</small>
          <button type="button" class="danger-action" :disabled="proxyClosing === 'all' || !proxySessions.length" @click="closeAllProxySessions">
            <span v-if="proxyClosing === 'all'" class="mini-spinner"></span>
            <span v-else>全部断开</span>
          </button>
        </div>
      </div>
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
      selectedSource: (function() {
        try { return localStorage.getItem('ci:market-source') || 'gitee'; } catch (e) { return 'gitee'; }
      })(),
      catalogApps: [],
      installedApps: [],
      searchQuery: '',
      catalogPlugins: [],
      installedPlugins: [],
      catalogThemes: [],
      installedThemes: [],
      // 目录验签状态：true / 'unsigned' / 'local'
      catalogVerified: 'unsigned',
      // 应用详情弹窗（目录条目：截图/更新日志/完整描述/能力清单）
      detailApp: null,
      // 「全部更新」进行中标记
      updateAllLoading: false,
      catalogUpdatedAt: '',
      activeSource: '',
      loading: true,
      // 当前分区标签：'apps'（应用）| 'plugins'（服务端插件）
      activeTab: 'apps',
      actionLoading: '',
      // 应用/插件配置面板状态（manifest.config 声明）
      configEditing: '',
      configLabel: '',
      configLoading: false,
      configSaving: false,
      configSchema: [],
      configValues: {},
      configConfigured: {},
      configMissing: [],
      // 图标加载失败记录（key: 应用名）→ 回落为占位图标
      iconErrors: {},
      actionStatus: '',
      error: '',
      // 兼容模式使用管理浮窗（web-proxy）
      proxyPanelOpen: false,
      proxyLoading: false,
      proxySessions: [],
      proxyInfo: {},
      proxyError: '',
      proxyClosing: '',
      proxyTimer: null,
      // 可使用者设置：服务端已保存值（proxyAccess）与编辑草稿（proxyAccessDraft）
      proxyAccess: { mode: 'all', users: [] },
      proxyAccessDraft: { mode: 'all', users: [] },
      proxyAccessDirty: false,
      proxyAccessSaving: false,
      proxyUserQuery: '',
      proxyUserResults: [],
      proxyUserSearching: false,
      proxyUserTimer: null
    };
  },
  computed: {
    // 分区标签（应用 / 插件）：count 显示在徽标中
    tabs: function() {
      return [
        { id: 'apps', label: '应用', icon: 'fa-puzzle-piece', count: this.catalogApps.length + this.installedApps.length },
        { id: 'themes', label: '主题', icon: 'fa-palette', count: this.catalogThemes.length + this.installedThemes.length },
        { id: 'plugins', label: '插件', icon: 'fa-plug', count: this.catalogPlugins.length + this.installedPlugins.length }
      ];
    },
    filteredCatalog: function() {
      return this.filterList(this.catalogApps);
    },
    filteredInstalledApps: function() {
      return this.filterList(this.installedApps);
    },
    filteredPlugins: function() {
      return this.filterList(this.catalogPlugins);
    },
    filteredInstalledPlugins: function() {
      return this.filterList(this.installedPlugins);
    },
    installedMap: function() {
      var result = {};
      this.installedApps.forEach(function(app) { result[app.name] = app; });
      return result;
    },
    installedPluginMap: function() {
      var result = {};
      this.installedPlugins.forEach(function(plugin) { result[plugin.name] = plugin; });
      return result;
    },
    // 是否存在搜索关键字（用于全局空状态与分组显隐）
    hasSearchQuery: function() {
      return !!String(this.searchQuery || '').trim();
    },
    // 当前分区在搜索命中的条目总数（用于判断整页是否无结果）
    activeTabMatchCount: function() {
      if (this.activeTab === 'plugins') return this.filteredPlugins.length + this.filteredInstalledPlugins.length;
      if (this.activeTab === 'themes') return this.filteredThemes.length + this.filteredInstalledThemes.length;
      return this.filteredCatalog.length + this.filteredInstalledApps.length;
    },
    // 目录验签徽章文案
    verifiedLabel: function() {
      if (this.catalogVerified === true) return '已验签';
      if (this.catalogVerified === 'local') return '本地源';
      return '未验签';
    },
    filteredThemes: function() {
      return this.filterList(this.catalogThemes);
    },
    filteredInstalledThemes: function() {
      return this.filterList(this.installedThemes);
    },
    themeInstalledMap: function() {
      var result = {};
      this.installedThemes.forEach(function(t) { result[t.id] = t; });
      return result;
    },
    // 详情弹窗：目录条目里的截图走服务器中转代理（同 catalog 图标策略）
    detailScreenshots: function() {
      var app = this.detailApp;
      if (!app || !Array.isArray(app.screenshots)) return [];
      var self = this;
      return app.screenshots.map(function(p) {
        return '/api/market/asset?source=' + encodeURIComponent(self.activeSource || self.selectedSource || 'gitee') +
          '&path=' + encodeURIComponent(p);
      });
    },
    // 已安装应用 → 目录中可更新版本（仅在目录版本更高时记录）
    appUpdateMap: function() {
      return this.buildUpdateMap(this.installedApps, this.catalogApps);
    },
    // 已安装插件 → 目录中可更新版本
    pluginUpdateMap: function() {
      return this.buildUpdateMap(this.installedPlugins, this.catalogPlugins);
    },
    // 班管 / 管理员：兼容模式使用管理入口只对他们展示
    isManager: function() {
      var user = (this.$store && this.$store.state && this.$store.state.auth && this.$store.state.auth.user) || {};
      return user.is_admin === 1 || user.is_admin === true
        || user.is_class_admin === 1 || user.is_class_admin === true
        || user.role === 'officer';
    }
  },
  watch: {
    selectedSource: function() {
      // 切源立即重拉目录（不受页面加载态限制——目录请求可重入）；
      // 失败必须显式提示，否则"切了没反应"会被当成切换失灵
      this.loadCatalog().catch(this.handleCatalogError.bind(this));
      try { localStorage.setItem('ci:market-source', this.selectedSource); } catch (e) {}
    }
  },
  mounted: function() {
    this.loadMarket();
  },
  beforeDestroy: function() {
    // 页面切走后停止轮询，避免对已卸载的组件继续写状态
    this.stopProxyPolling();
  },
  methods: {
    // 关键字过滤：按 label / name 匹配，空关键字返回原列表（应用与插件共用）
    filterList: function(list) {
      var q = String(this.searchQuery || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter(function (item) {
        return (item.label || '').toLowerCase().indexOf(q) > -1 || (item.name || '').toLowerCase().indexOf(q) > -1;
      });
    },
    // 搜索时零命中的分组整体隐藏（无搜索关键字时始终显示）
    showSection: function(list) {
      return !this.hasSearchQuery || (Array.isArray(list) && list.length > 0);
    },
    // 语义化版本比较：返回 1（a>b）/ -1（a<b）/ 0（相等）；非法版本按 0 处理
    compareVersion: function(a, b) {
      var pa = String(a || '0').split('.');
      var pb = String(b || '0').split('.');
      var len = Math.max(pa.length, pb.length);
      for (var i = 0; i < len; i++) {
        var na = parseInt(pa[i], 10); if (isNaN(na)) na = 0;
        var nb = parseInt(pb[i], 10); if (isNaN(nb)) nb = 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
      }
      return 0;
    },
    // 构建「可更新」映射：已安装项在目录中存在且目录版本更高时，记录 name → 目录版本
    buildUpdateMap: function(installedList, catalogList) {
      var self = this;
      var catalogMap = {};
      (catalogList || []).forEach(function(item) { catalogMap[item.name] = item; });
      var result = {};
      (installedList || []).forEach(function(item) {
        var latest = catalogMap[item.name];
        if (latest && latest.version && self.compareVersion(latest.version, item.version) > 0) {
          result[item.name] = latest.version;
        }
      });
      return result;
    },
    // 能力清单 → 展示元数据（模板里用，返回 [{name,label,icon,level,description}]）
    describeCaps: function(names) {
      return describeCapabilities(names);
    },
    loadMarket: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      Promise.all([self.loadSources(), self.loadInstalled(), self.loadCatalog(), self.loadInstalledPlugins(), self.loadInstalledThemes()]).catch(function(error) {
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
    // 目录加载失败的显式提示（含源名——切源失败与加载失败不再静默）
    handleCatalogError: function(error) {
      this.error = this.getErrorMessage(error, '市场目录加载失败') + '（源：' + (this.selectedSource || '?') + '）';
    },
    loadCatalog: function() {
      var self = this;
      return api.get('/market/catalog?source=' + encodeURIComponent(self.selectedSource || 'local')).then(function(response) {
        var data = response.data && response.data.data;
        var catalog = data && data.catalog;
        self.activeSource = data && data.source ? data.source : self.selectedSource;
        self.catalogApps = catalog && Array.isArray(catalog.apps) ? catalog.apps : [];
        self.catalogPlugins = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : [];
        self.catalogThemes = catalog && Array.isArray(catalog.themes) ? catalog.themes : [];
        self.catalogVerified = data && data.verified !== undefined ? data.verified : 'unsigned';
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
    // ===== 全部更新：把「可更新」的应用逐个更新（顺序执行，避免并发挤压服务器） =====
    updateAllApps: function() {
      var self = this;
      var names = Object.keys(this.appUpdateMap);
      if (!names.length || self.updateAllLoading) return;
      self.$modal.confirm({
        title: '全部更新',
        message: '将更新 ' + names.length + ' 个应用到最新版本（顺序执行，过程中请保持页面打开）。继续吗？',
        confirmText: '开始更新',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (!confirmed) return;
        self.updateAllLoading = true;
        var done = 0;
        var failed = 0;
        function next() {
          var name = names[done];
          self.actionStatus = '正在更新 ' + name + '（' + (done + 1) + '/' + names.length + '）…';
          return api.post('/market/update', { name: name, source: self.selectedSource || 'gitee' })
            .then(function() {
              done += 1;
              if (done < names.length) return next();
            })
            .catch(function() {
              failed += 1;
              done += 1;
              if (done < names.length) return next();
            });
        }
        return next().finally(function() {
          self.updateAllLoading = false;
          self.actionStatus = '';
          return Promise.all([self.loadInstalled(), self.refreshMarketRuntime()]).then(function() {
            self.$store.commit('toast/SHOW_TOAST', {
              message: failed ? ('全部更新完成，' + failed + ' 个失败，详情见页面提示') : ('已更新 ' + names.length + ' 个应用'),
              type: failed ? 'error' : 'success'
            });
          });
        });
      }).catch(function() {});
    },
    // ===== 主题市场 =====
    loadInstalledThemes: function() {
      var self = this;
      return api.get('/market/themes-installed').then(function(response) {
        var data = response.data && response.data.data;
        self.installedThemes = data && Array.isArray(data.themes) ? data.themes : [];
      });
    },
    installTheme: function(theme) {
      var self = this;
      if (self.actionLoading) return;
      self.actionLoading = theme.name;
      self.error = '';
      self.actionStatus = '正在下载并校验主题…';
      api.post('/market/install-theme', { name: theme.name, source: self.selectedSource || 'gitee' }).then(function() {
        return self.loadInstalledThemes();
      }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '主题安装成功，全班成员的主题选择里立即可见', type: 'success' });
      }).catch(function(error) {
        self.error = self.getErrorMessage(error, '主题安装失败');
      }).finally(function() {
        self.actionLoading = '';
        self.actionStatus = '';
      });
    },
    uninstallTheme: function(theme) {
      var self = this;
      var using = self.$store.state.settings.theme === theme.id;
      self.$modal.confirm({
        title: '卸载主题「' + (theme.name || theme.id) + '」',
        message: using ? '当前正在使用该主题，卸载后会回退到默认浅色主题。确定继续吗？' : '卸载后全班成员的主题选择中将不再出现该主题。确定继续吗？',
        confirmText: '卸载',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (!confirmed || self.actionLoading) return;
        self.actionLoading = theme.id;
        self.error = '';
        api.post('/market/uninstall-theme', { name: theme.id }).then(function() {
          return self.loadInstalledThemes();
        }).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '主题已卸载', type: 'success' });
        });
      }).catch(function(error) {
        if (error) self.error = self.getErrorMessage(error, '主题卸载失败');
      }).finally(function() {
        self.actionLoading = '';
      });
    },
    // ===== 应用详情弹窗（截图 / 更新日志 / 完整描述 / 能力清单） =====
    openAppDetail: function(app) {
      this.detailApp = app;
    },
    closeAppDetail: function() {
      this.detailApp = null;
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
    // 启用/暂停服务端插件（走 /market/plugin-toggle，请求期闸门即时生效）
    togglePlugin: function(plugin) {
      var self = this;
      var enabled = plugin.enabled === false;
      self.$modal.confirm({
        title: enabled ? '启用插件' : '暂停插件',
        message: enabled ? '启用后插件后端接口立即恢复对外服务。' : '暂停后插件后端接口立即下线，无需重启服务器。',
        confirmText: enabled ? '启用' : '暂停',
        cancelText: '取消'
      }).then(function(confirmed) {
        if (!confirmed || self.actionLoading) return;
        self.actionLoading = plugin.name;
        self.error = '';
        return api.post('/market/plugin-toggle', { name: plugin.name, enabled: enabled })
          .then(function() {
            plugin.enabled = enabled;
            self.$store.commit('toast/SHOW_TOAST', { message: enabled ? '插件已启用' : '插件已暂停', type: 'success' });
            return self.loadInstalledPlugins();
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
        message: '插件将以服务端扩展方式安装并热挂载后端接口。注意：市场分发的插件暂不支持前端页面，插件清单中的 frontend 声明不会生效——如需前端集成请在主仓内完成（详见 docs/ecosystem-design.md 的四类模块定位）。',
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
    // 更新插件：向市场源重新拉取该插件最新版本并热替换后端路由
    updatePlugin: function(plugin) {
      this.runPluginAction('/market/install-plugin', plugin, '插件更新成功');
    },
    runPluginAction: function(endpoint, plugin, successMessage) {
      var self = this;
      if (self.actionLoading) return;
      self.actionLoading = plugin.name;
      self.actionStatus = '正在下载并校验插件…';
      self.error = '';
      api.post(endpoint, { name: plugin.name, source: self.selectedSource || 'gitee' }).then(function(response) {
        var result = response.data && response.data.data;
        var note = result && result.requiresRebuild ? '（含 frontend 声明：市场插件的前端暂不生效，需主仓集成）' : '';
        return Promise.all([self.loadInstalledPlugins(), self.loadCatalog()]).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: successMessage + note, type: 'success' });
          self.promptMissingConfig(result);
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
          self.promptMissingConfig(result);
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
    onIconError: function(app) {
      // 加载失败不再静默隐藏（会留下空的色块），改回落为占位图标
      if (app && app.name) this.$set(this.iconErrors, app.name, true);
    },
    // ========== 应用/插件配置（manifest.config 声明） ==========
    // 安装/更新成功后：required 配置缺失时引导管理员立即配置
    promptMissingConfig: function(result) {
      var self = this;
      if (!result || !Array.isArray(result.configRequired) || !result.configRequired.length) return;
      var labels = result.configRequired.map(function(item) { return item.label; }).join('、');
      self.$modal.confirm({
        title: '应用需要配置',
        message: '「' + (result.label || result.name) + '」有 ' + result.configRequired.length + ' 项必填配置未完成：' + labels + '。现在去配置吗？',
        confirmText: '立即配置',
        cancelText: '稍后'
      }).then(function(confirmed) {
        if (confirmed) self.openConfig({ name: result.name, label: result.label });
      }).catch(function() {});
    },
    // 打开配置面板（再次点击同一项则收起）
    openConfig: function(item) {
      var self = this;
      if (!item || !item.name) return;
      if (self.configEditing === item.name) { self.closeConfig(); return; }
      self.configEditing = item.name;
      self.configLabel = item.label || item.name;
      self.configLoading = true;
      self.configSchema = [];
      self.configValues = {};
      self.configConfigured = {};
      self.configMissing = [];
      api.get('/market/app-config?name=' + encodeURIComponent(item.name)).then(function(response) {
        var data = response.data && response.data.data;
        if (!data) return;
        self.configSchema = Array.isArray(data.schema) ? data.schema : [];
        self.configConfigured = data.configured || {};
        self.configMissing = Array.isArray(data.missingRequired) ? data.missingRequired : [];
        var vals = {};
        self.configSchema.forEach(function(def) {
          var v = data.values && data.values[def.key];
          if (def.type === 'boolean') {
            vals[def.key] = v === true || v === 'true' || v === '1';
          } else {
            vals[def.key] = v !== undefined && v !== null ? v : '';
          }
        });
        self.configValues = vals;
      }).catch(function(error) {
        self.error = self.getErrorMessage(error, '读取配置失败');
        self.closeConfig();
      }).finally(function() {
        self.configLoading = false;
      });
    },
    closeConfig: function() {
      this.configEditing = '';
      this.configLabel = '';
      this.configSchema = [];
      this.configValues = {};
      this.configConfigured = {};
      this.configMissing = [];
    },
    // 配置面板当前编辑项是否属于给定列表（应用区/插件区各渲染一块面板，避免重复）
    configEditingIn: function(list) {
      if (!this.configEditing || !Array.isArray(list)) return false;
      return list.some(function(item) { return item.name === this.configEditing; }, this);
    },
    configPlaceholder: function(item) {
      if (item.type === 'secret') {
        return this.configConfigured[item.key] ? '已配置（留空保持不变）' : '未配置';
      }
      var current = this.configValues[item.key];
      if (current !== '' && current !== undefined && current !== null) return '';
      if (item.default !== undefined && String(item.default) !== '') return '默认: ' + item.default;
      return '未配置';
    },
    saveConfig: function() {
      var self = this;
      if (self.configSaving || !self.configEditing) return;
      var values = {};
      self.configSchema.forEach(function(def) {
        var val = self.configValues[def.key];
        if (def.type === 'boolean') {
          values[def.key] = val ? 'true' : 'false';
          return;
        }
        values[def.key] = val === undefined || val === null ? '' : String(val);
      });
      self.configSaving = true;
      api.post('/market/app-config', { name: self.configEditing, values: values }).then(function(response) {
        var data = response.data && response.data.data;
        var stillMissing = data && Array.isArray(data.missingRequired) ? data.missingRequired.length : 0;
        self.$store.commit('toast/SHOW_TOAST', {
          message: stillMissing > 0 ? '配置已保存，还有 ' + stillMissing + ' 项必填配置未完成' : '配置已保存，即时生效',
          type: stillMissing > 0 ? 'warning' : 'success'
        });
        self.closeConfig();
        return Promise.all([self.loadInstalled(), self.loadInstalledPlugins()]);
      }).catch(function(error) {
        self.error = self.getErrorMessage(error, '保存配置失败');
      }).finally(function() {
        self.configSaving = false;
      });
    },
    // ========== 兼容模式使用管理（web-proxy） ==========
    openProxyPanel: function() {
      var self = this;
      self.proxyPanelOpen = true;
      self.proxyError = '';
      self.proxyAccessDirty = false;
      self.proxyUserQuery = '';
      self.proxyUserResults = [];
      self.refreshProxySessions();
      self.stopProxyPolling();
      // 打开期间每 3 秒刷新：会话随时可能开始或结束
      self.proxyTimer = setInterval(function() {
        self.refreshProxySessions();
      }, 3000);
    },
    closeProxyPanel: function() {
      this.proxyPanelOpen = false;
      this.stopProxyPolling();
      this.proxySessions = [];
      this.proxyError = '';
      this.proxyClosing = '';
      this.proxyAccessDirty = false;
      this.proxyUserQuery = '';
      this.proxyUserResults = [];
      clearTimeout(this.proxyUserTimer);
      this.proxyUserTimer = null;
    },
    stopProxyPolling: function() {
      if (this.proxyTimer) {
        clearInterval(this.proxyTimer);
        this.proxyTimer = null;
      }
    },
    refreshProxySessions: function() {
      var self = this;
      if (!self.proxyPanelOpen || self.proxyLoading) return;
      self.proxyLoading = true;
      api.get('/web-proxy/sessions').then(function(response) {
        var data = response.data && response.data.data;
        if (!data) return;
        self.proxyInfo = data;
        self.proxySessions = Array.isArray(data.sessions) ? data.sessions : [];
        // 可使用者设置随会话列表一起下发；编辑中不覆盖用户未保存的改动
        if (data.access) {
          self.proxyAccess = data.access;
          if (!self.proxyAccessDirty) self.syncProxyAccessDraft();
        }
        self.proxyError = '';
      }).catch(function(error) {
        var status = error && error.response && error.response.status;
        self.proxyError = (status === 401 || status === 403)
          ? '仅班管 / 管理员可查看兼容模式使用情况'
          : self.getErrorMessage(error, '读取使用情况失败');
      }).finally(function() {
        self.proxyLoading = false;
      });
    },
    closeProxySession: function(sess) {
      var self = this;
      if (!sess || self.proxyClosing) return;
      self.proxyClosing = sess.id;
      api.post('/web-proxy/sessions/' + encodeURIComponent(sess.id) + '/close', {}).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '已断开该成员的兼容模式会话', type: 'success' });
        self.refreshProxySessions();
      }).catch(function(error) {
        self.proxyError = self.getErrorMessage(error, '断开失败');
      }).finally(function() {
        self.proxyClosing = '';
      });
    },
    closeAllProxySessions: function() {
      var self = this;
      if (self.proxyClosing || !self.proxySessions.length) return;
      self.proxyClosing = 'all';
      api.post('/web-proxy/sessions/close-all', {}).then(function(response) {
        var closed = (response.data && response.data.data && response.data.data.closed) || 0;
        self.$store.commit('toast/SHOW_TOAST', { message: '已断开全部兼容模式会话（' + closed + ' 个）', type: 'success' });
        self.proxySessions = [];
        self.refreshProxySessions();
      }).catch(function(error) {
        self.proxyError = self.getErrorMessage(error, '断开失败');
      }).finally(function() {
        self.proxyClosing = '';
      });
    },
    // ===== 可使用者设置 =====
    syncProxyAccessDraft: function() {
      this.proxyAccessDraft = {
        mode: this.proxyAccess.mode === 'allowlist' ? 'allowlist' : 'all',
        users: (this.proxyAccess.users || []).map(function(user) {
          return { id: user.id, name: user.name || '' };
        })
      };
      this.proxyAccessDirty = false;
    },
    setProxyAccessMode: function(mode) {
      if (this.proxyAccessDraft.mode === mode) return;
      this.proxyAccessDraft.mode = mode === 'allowlist' ? 'allowlist' : 'all';
      this.proxyAccessDirty = true;
      if (this.proxyAccessDraft.mode === 'allowlist' && !this.proxyUserResults.length) {
        this.searchProxyUsers();
      }
    },
    onProxyUserQuery: function() {
      var self = this;
      clearTimeout(self.proxyUserTimer);
      self.proxyUserTimer = setTimeout(function() {
        self.proxyUserTimer = null;
        self.searchProxyUsers();
      }, 300);
    },
    searchProxyUsers: function() {
      var self = this;
      if (self.proxyUserSearching) return;
      self.proxyUserSearching = true;
      var q = (self.proxyUserQuery || '').trim();
      api.get('/web-proxy/users?q=' + encodeURIComponent(q)).then(function(response) {
        var data = response.data && response.data.data;
        self.proxyUserResults = data && Array.isArray(data.users) ? data.users : [];
      }).catch(function(error) {
        self.proxyError = self.getErrorMessage(error, '搜索成员失败');
      }).finally(function() {
        self.proxyUserSearching = false;
      });
    },
    isProxyUserPicked: function(id) {
      return this.proxyAccessDraft.users.some(function(user) { return user.id === id; });
    },
    addProxyUser: function(user) {
      if (!user || !user.id || this.isProxyUserPicked(user.id)) return;
      this.proxyAccessDraft.users.push({ id: user.id, name: user.name || '' });
      this.proxyAccessDirty = true;
    },
    removeProxyUser: function(id) {
      this.proxyAccessDraft.users = this.proxyAccessDraft.users.filter(function(user) {
        return user.id !== id;
      });
      this.proxyAccessDirty = true;
    },
    saveProxyAccess: function() {
      var self = this;
      if (self.proxyAccessSaving) return;
      self.proxyAccessSaving = true;
      api.post('/web-proxy/access', {
        mode: self.proxyAccessDraft.mode,
        users: self.proxyAccessDraft.users
      }).then(function(response) {
        var data = response.data && response.data.data;
        if (data) {
          self.proxyAccess = data;
          self.syncProxyAccessDraft();
        }
        self.$store.commit('toast/SHOW_TOAST', {
          message: data && data.mode === 'allowlist' ? '已保存：仅指定成员可使用兼容模式' : '已保存：全班成员可使用兼容模式',
          type: 'success'
        });
      }).catch(function(error) {
        self.proxyError = self.getErrorMessage(error, '保存可使用者设置失败');
      }).finally(function() {
        self.proxyAccessSaving = false;
      });
    },

    formatDuration: function(ms) {
      var total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
      var h = Math.floor(total / 3600);
      var m = Math.floor((total % 3600) / 60);
      var s = total % 60;
      function pad(n) { return n < 10 ? '0' + n : String(n); }
      if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
      return pad(m) + ':' + pad(s);
    }
  }
};
</script>

<style scoped>
.market-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-color); }
.market-content { flex: 1; min-height: 0; padding: 28px 34px 48px; overflow-y: auto; }
.market-toolbar, .section-heading, .app-card-footer, .installed-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
/* 工具栏：上行标题 + 操作，下行整宽搜索框（信息层级更清晰，搜索空间更充裕） */
.market-toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 18px;
  background: var(--card-bg);
  border: 0.5px solid var(--border-color);
  border-radius: var(--radius-xl);
  padding: 20px 22px;
  margin-bottom: 24px;
}
.toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.toolbar-lead { min-width: 0; }

/* 分区标签栏（应用 / 插件）：宽屏为分区导航，窄屏/竖屏转为顶部横向可滚动标签栏 */
.market-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  padding-bottom: 2px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.market-tabs::-webkit-scrollbar { display: none; }
.market-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 9px 18px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}
.market-tab i { font-size: var(--font-size-sm); }
.market-tab.active { background: var(--primary-color); border-color: var(--primary-color); color: #fff; font-weight: 600; }
.tab-count { padding: 1px 8px; border-radius: var(--radius-pill); background: rgba(120, 120, 128, 0.14); color: var(--text-secondary); font-size: 11px; line-height: 1.6; }
.market-tab.active .tab-count { background: rgba(255, 255, 255, 0.25); color: #fff; }

.market-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0 16px;
  height: 44px;
  border-radius: var(--radius-pill);
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}
.market-search:focus-within { border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.12); }

.market-search i { color: var(--text-tertiary); font-size: var(--font-size-sm); }

.market-search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.market-section { position: relative; padding-left: 14px; }
.market-section::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--primary-color);
  opacity: 0.8;
}
h1, h2, h3, p { margin: 0; }
h1 { color: var(--text-primary); font-size: 28px; }
h2 { color: var(--text-primary); font-size: 20px; }
h3 { color: var(--text-primary); font-size: 16px; }
.market-toolbar p, .app-description, .installed-info p { color: var(--text-secondary); }
.market-toolbar p { margin-top: 6px; }
.market-toolbar-actions, .installed-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.source-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.source-chip {
  border: 1px solid var(--separator-color); border-radius: 999px;
  padding: 8px 16px; background: var(--card-bg); color: var(--text-primary);
  font-size: 13px; cursor: pointer; min-height: 36px;
  transition: background var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}
.source-chip--active { background: var(--primary-color, #0A84FF); border-color: var(--primary-color, #0A84FF); color: #fff; font-weight: 600; }
.source-chip:disabled { opacity: 0.5; }
.refresh-btn, .app-action, .secondary-action, .danger-action, .market-error button { border: 1px solid var(--separator-color); border-radius: var(--radius-md); padding: 9px 14px; background: var(--card-bg); color: var(--text-primary); cursor: pointer; }
.refresh-btn { background: var(--primary-color); color: #fff; border-color: var(--primary-color); }
button:disabled { opacity: .55; cursor: not-allowed; }
.market-error { display: flex; align-items: center; gap: 10px; padding: 14px 16px; margin-bottom: 24px; border-radius: var(--radius-md); background: rgba(255, 59, 48, .1); color: var(--danger-color); }
.market-error button { margin-left: auto; color: var(--danger-color); background: transparent; border-color: currentColor; }
.market-progress, .market-source-status { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 16px; border-radius: var(--radius-md); background: rgba(120,120,128,0.12); color: var(--text-secondary); font-size: 13px; }
.market-source-status { color: var(--success-color); }
.market-loading, .empty-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; min-height: 180px; color: var(--text-secondary); }
.market-section { margin-bottom: 32px; }
.section-heading { margin-bottom: 16px; }
/* 二级分组标题（如「已安装应用 / 已安装插件」）：与上方同级区块拉开层次，去掉左侧色条 */
.section-heading.sub-heading { margin-top: 24px; }
.section-meta, .count-badge, .installed-info span, .app-title span { color: var(--text-secondary); font-size: 12px; }
.section-meta { display: block; margin-top: 4px; }
.count-badge { padding: 5px 9px; border-radius: var(--radius-pill); background: rgba(120,120,128,0.12); }
.app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.app-card, .installed-card { background: var(--card-bg); border: 1px solid var(--separator-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.app-card { padding: 20px; min-height: 164px; display: flex; flex-direction: column; justify-content: flex-start; gap: 14px;   transition: transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}
.app-card:hover { box-shadow: var(--shadow-md); border-color: rgba(var(--primary-rgb), 0.4); }
.app-card:active { transform: scale(0.98); }
.app-card-header { display: flex; align-items: center; gap: 12px; }
.app-icon { width: 48px; height: 48px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; color: #fff; overflow: hidden; flex-shrink: 0; }
/* 圆角矩形（与桌面 AppIcon 的 --radius-lg 同语言），不用 --radius-pill：
   方形图标 + 全圆角在 48px 下会变成正圆，与系统其他位置的图标形状不一致 */
.app-icon.small { width: 42px; height: 42px; border-radius: var(--radius-md); }
.app-icon img { width: 100%; height: 100%; object-fit: cover; }
/* 插件卡图标：无自定义图标，统一用主题主色底衬 */
.plugin-icon { background: var(--primary-color); }
.app-title { min-width: 0; }
.app-title h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-title span { display: block; margin-top: 5px; }
.app-description { min-height: 36px; line-height: 1.5; font-size: 13px; }
/* 能力披露 chips：安装前让用户一眼看到应用会用到什么 */
.app-caps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cap-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: var(--radius-pill); background: rgba(120,120,128,0.12); color: var(--text-secondary); font-size: 11px; line-height: 1.4; white-space: nowrap; }
.cap-chip i { font-size: 10px; }
/* notice 级：需要用户留意的能力，用警示色轻描边区分 */
.cap-chip-notice { background: rgba(var(--warning-rgb, 255, 149, 0), 0.12); color: rgb(var(--warning-rgb, 255, 149, 0)); }
/* footer 用 margin-top:auto 钉在卡片底部，行内卡片等高、footer 对齐一致 */
.app-card-footer { border-top: 1px solid var(--separator-color); padding-top: 14px; margin-top: auto; }
.installed-label { color: var(--success-color); font-size: 12px; }
.app-author { color: var(--text-secondary); font-size: 12px; }
/* 应用/插件卡：作者名旁的「已安装」角标 */
.installed-flag { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; color: var(--success-color); }
.installed-flag i { font-size: 11px; }
.app-action { background: var(--primary-light); color: var(--primary-color); border-color: transparent; font-weight: 600; }
/* 配置面板主按钮（与卡片按钮同一语言，做强调态） */
.primary-action { border: 1px solid transparent; border-radius: var(--radius-md); padding: 9px 16px; background: var(--primary-color); color: #fff; font-weight: 600; cursor: pointer; }
.installed-list { display: flex; flex-direction: column; gap: 8px; }
/* 已安装卡：顶部对齐（内容高度不一时操作区不漂移），并补 hover 反馈与目录卡一致 */
.installed-card { padding: 14px 18px; align-items: flex-start; transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard); }
.installed-card:hover { border-color: rgba(var(--primary-rgb), 0.4); box-shadow: var(--shadow-sm); }
.installed-card .installed-actions { margin-top: 2px; }
.installed-info { flex: 1; min-width: 0; }
.installed-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.installed-info p { margin: 5px 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-badge { padding: 3px 7px; border-radius: var(--radius-pill); font-size: 11px; }
.status-badge.enabled { color: var(--success-color); background: rgba(52, 199, 89, .12); }
.status-badge.disabled { color: var(--danger-color); background: rgba(255, 59, 48, .12); }
.status-badge.always-on { color: var(--text-secondary); background: rgba(120, 120, 128, .14); }
/* 可更新徽标：用主色轻描边提示有新版本 */
.status-badge.updatable { display: inline-flex; align-items: center; gap: 4px; color: var(--primary-color); background: var(--primary-light); }
.status-badge.updatable i { font-size: 10px; }
.status-hint { display: block; margin-top: 5px; color: var(--text-secondary); font-size: 11px; }
.control-action { border: 1px solid transparent; border-radius: var(--radius-md); padding: 9px 12px; background: transparent; cursor: pointer; }
.control-action.enable { color: var(--success-color); border-color: rgba(52, 199, 89, .35); }
.control-action.disable { color: var(--danger-color); border-color: rgba(255, 59, 48, .25); }
.secondary-action { color: var(--primary-color); }
/* 有新版本可更新：更新按钮做强调态，与可更新徽标呼应 */
.secondary-action.update-available { background: var(--primary-light); border-color: transparent; font-weight: 600; }
/* 搜索无结果整页提示：比分区内的空状态更轻，避免视觉喧宾夺主 */
.empty-state.search-empty { min-height: 140px; margin-bottom: 24px; }
.empty-state.search-empty i { font-size: 26px; color: var(--text-tertiary); }
.danger-action { color: var(--danger-color); }
.spinner, .mini-spinner { border: 3px solid var(--separator-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
.spinner { width: 30px; height: 30px; }
.mini-spinner { display: inline-block; width: 13px; height: 13px; border-width: 2px; vertical-align: -2px; }
.spinning { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* 窄屏/竖屏降级：工具栏收窄内边距，操作区与已安装卡操作改为整行铺开 */
@media (max-width: 700px) {
  .market-content { padding: 20px 16px 32px; }
  .market-toolbar { padding: 16px; }
  .toolbar-row { gap: 12px; }
  .market-toolbar-actions { width: 100%; }
  .refresh-btn { flex: 1; }
  .installed-card { flex-wrap: wrap; }
  .installed-actions { width: 100%; justify-content: flex-end; margin-top: 10px; }
}

/* 应用/插件配置面板（manifest.config 声明 → 安装时引导填写） */
.status-badge.pending-config { color: var(--danger-color, #E8463A); background: rgba(232, 70, 58, 0.12); }
.config-editor { width: 100%; margin-top: 4px; padding: 16px 18px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 12px; }
.cfg-head { display: flex; align-items: center; justify-content: space-between; }
.cfg-head h4 { margin: 0; font-size: var(--font-size-md); color: var(--text-color); display: flex; align-items: center; gap: 8px; }
.cfg-close { border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-md); font-size: var(--font-size-md); }
.cfg-warning { margin: 0; padding: 8px 12px; border-radius: var(--radius-md); background: rgba(239, 170, 23, 0.12); color: var(--warning-color, #B7791F); font-size: var(--font-size-sm); display: flex; align-items: center; gap: 8px; }
.cfg-row { display: flex; flex-direction: column; gap: 6px; }
.cfg-row label { font-size: var(--font-size-sm); color: var(--text-color); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cfg-required { color: var(--danger-color, #E8463A); }
.cfg-key { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--text-tertiary); background: var(--card-bg); padding: 1px 6px; border-radius: var(--radius-sm); }
.cfg-input { height: 38px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--card-bg); color: var(--text-color); font-size: var(--font-size-sm); outline: none; }
.cfg-input:focus { border-color: var(--primary-color); }
.cfg-checkbox { width: 18px; height: 18px; accent-color: var(--primary-color); }
.cfg-desc { color: var(--text-tertiary); font-size: var(--font-size-xs); }
.cfg-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cfg-hint { color: var(--text-tertiary); font-size: var(--font-size-xs); }
.cfg-loading { display: flex; align-items: center; gap: 8px; color: var(--text-tertiary); font-size: var(--font-size-sm); padding: 8px 0; }

/* ===== 兼容模式使用管理浮窗（web-proxy） ===== */
.proxy-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(2px);
}
.proxy-panel {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(78vh, 640px);
  padding: 20px 22px;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg, var(--shadow-md));
}
.proxy-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.proxy-head h3 { display: flex; align-items: center; gap: 8px; font-size: 17px; color: var(--text-primary); }
.proxy-head p { margin-top: 4px; color: var(--text-secondary); font-size: 12px; }
.proxy-close { border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-md); font-size: 16px; }
.proxy-close:hover { background: rgba(120, 120, 128, 0.14); color: var(--text-primary); }
.proxy-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.proxy-meta-item { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-pill); background: rgba(120, 120, 128, 0.12); color: var(--text-secondary); font-size: 12px; }
.proxy-meta-item.ok { color: var(--success-color); background: rgba(52, 199, 89, 0.12); }
.proxy-error { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 9px 12px; border-radius: var(--radius-md); background: rgba(255, 59, 48, 0.12); color: var(--danger-color); font-size: 12px; }
.proxy-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 180px; color: var(--text-secondary); text-align: center; }
.proxy-empty i { font-size: 26px; color: var(--text-tertiary); }
.proxy-empty p { color: var(--text-primary); font-size: 14px; }
.proxy-empty small { max-width: 360px; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.proxy-sessions { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; margin: 0 -4px; padding: 0 4px; }
.proxy-session { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--separator-color); border-radius: var(--radius-md); background: var(--bg-color); }
.proxy-session-main { min-width: 0; flex: 1; }
.proxy-session-user { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--text-primary); }
.proxy-session-user i { color: var(--primary-color); font-size: 12px; }
.proxy-duration { padding: 1px 7px; border-radius: var(--radius-pill); background: rgba(120, 120, 128, 0.14); color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.proxy-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: var(--radius-pill); background: rgba(120, 120, 128, 0.14); color: var(--text-secondary); font-size: 11px; }
.proxy-chip.audio { color: var(--primary-color); background: var(--primary-light); }
.proxy-session-url { margin-top: 4px; color: var(--text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proxy-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--separator-color); }
.proxy-foot small { color: var(--text-tertiary); font-size: 11px; line-height: 1.5; }

/* 可使用者（白名单）区域：高度受限，搜索结果与已选成员各自滚动，避免把面板撑出屏幕 */
.proxy-access { flex: 0 0 auto; margin-bottom: 12px; padding: 12px; border: 1px solid var(--separator-color); border-radius: var(--radius-md); background: var(--bg-color); }
.proxy-access-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.proxy-access-head strong { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-primary); }
.proxy-access-head strong i { color: var(--primary-color); font-size: 12px; }
.proxy-access-head small { color: var(--text-tertiary); font-size: 11px; }
.proxy-access-modes { display: inline-flex; gap: 2px; margin-top: 10px; padding: 3px; border-radius: var(--radius-pill); background: rgba(120, 120, 128, 0.12); }
.proxy-mode-btn { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; padding: 5px 14px; border-radius: var(--radius-pill); cursor: pointer; transition: background 0.18s ease, color 0.18s ease; }
.proxy-mode-btn:hover { color: var(--text-primary); }
.proxy-mode-btn.active { background: var(--card-bg); color: var(--text-primary); box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.08)); }
.proxy-access-body { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.proxy-user-search { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--card-bg); }
.proxy-user-search:focus-within { border-color: var(--primary-color); }
.proxy-user-search i { color: var(--text-tertiary); font-size: 12px; }
.proxy-user-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--text-primary); font-size: 13px; }
.proxy-user-results { display: flex; flex-direction: column; gap: 4px; max-height: 148px; overflow-y: auto; }
.proxy-user-result { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 1px solid var(--separator-color); border-radius: var(--radius-sm); background: var(--card-bg); color: var(--text-primary); font-size: 13px; text-align: left; cursor: pointer; }
.proxy-user-result:hover:not(:disabled) { border-color: var(--primary-color); }
.proxy-user-result:disabled { opacity: 0.55; cursor: default; }
.proxy-user-result i { color: var(--primary-color); font-size: 11px; }
.proxy-user-result:disabled i { color: var(--success-color); }
.proxy-user-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proxy-user-result small { color: var(--text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.proxy-picked { display: flex; flex-wrap: wrap; gap: 6px; max-height: 86px; overflow-y: auto; }
.proxy-picked-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px 3px 10px; border-radius: var(--radius-pill); background: var(--primary-light); color: var(--primary-color); font-size: 12px; }
.proxy-picked-chip button { border: none; background: transparent; color: inherit; font-size: 10px; padding: 0 2px; cursor: pointer; opacity: 0.7; }
.proxy-picked-chip button:hover { opacity: 1; }
.proxy-picked-empty { color: var(--text-tertiary); font-size: 11px; }
.proxy-access-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.proxy-access-foot small { color: var(--text-tertiary); font-size: 11px; }
.proxy-access-foot button { min-width: 72px; }

@media (max-width: 700px) {
  .proxy-overlay { align-items: flex-end; padding: 0; }
  .proxy-panel { width: 100%; max-height: 82vh; border-radius: var(--radius-xl) var(--radius-xl) 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom, 0px)); }
  .proxy-foot { flex-direction: column; align-items: stretch; gap: 10px; }
  .proxy-foot button { width: 100%; }
  .proxy-access-foot { flex-direction: column; align-items: stretch; }
  .proxy-access-foot button { width: 100%; }
}

/* ===== 应用详情弹窗 + 卡片操作区 ===== */
.footer-actions { display: flex; align-items: center; gap: 8px; }
.installed-heading-actions { display: flex; align-items: center; gap: 10px; }
.verify-badge {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: 10px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; color: var(--text-tertiary, #999);
  background: var(--separator, rgba(0,0,0,0.08));
}
.verify-badge.ok { color: #34C759; background: rgba(52, 199, 89, 0.12); }
.app-detail-panel { max-width: 560px; max-height: 84vh; overflow: hidden; display: flex; flex-direction: column; }
.app-detail-body { overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 14px; }
.detail-screens { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.detail-screens img {
  height: 150px; border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--separator, rgba(0,0,0,0.08)); background: var(--bg-secondary);
  object-fit: cover; flex: 0 0 auto;
}
.detail-desc { color: var(--text-primary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.detail-caps { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-changelog h4 { margin: 0 0 8px; font-size: 13px; color: var(--text-primary); }
.changelog-entry { padding: 8px 0; border-top: 1px solid var(--separator, rgba(0,0,0,0.06)); }
.changelog-entry strong { font-size: 12px; color: var(--text-primary); }
.changelog-date { margin-left: 8px; font-size: 11px; color: var(--text-tertiary); }
.changelog-entry p { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); white-space: pre-wrap; }
.app-detail-foot { padding-top: 10px; border-top: 1px solid var(--separator, rgba(0,0,0,0.06)); display: flex; justify-content: flex-end; }
</style>
