<template>
  <transition name="settings-panel">
    <div v-if="visible" class="desktop-settings-overlay">
      <div class="desktop-settings-panel">
        <!-- 顶部导航栏：复用 AppNavBar，标题位置与其他应用一致 -->
        <AppNavBar title="桌面设置" :show-back="false">
          <template #actions>
            <button class="settings-done-link" @click="onDone">完成</button>
          </template>
        </AppNavBar>
        <div class="settings-panel-body">
          <div class="settings-content">
            <!-- 桌面布局分组 -->
            <div class="settings-section">
              <div class="settings-section-title">桌面布局</div>
              <div class="settings-card">
                <div class="settings-switch-row">
                  <i class="fa-solid fa-table-cells-large action-icon"></i>
                  <span class="action-text">布局模式</span>
                  <div class="size-segmented">
                    <button
                      class="size-seg-btn"
                      :class="{ 'size-seg-btn--active': desktopLayout === 'grid' }"
                      @click="onSelectLayout('grid')"
                    >网格</button>
                    <button
                      class="size-seg-btn"
                      :class="{ 'size-seg-btn--active': desktopLayout === 'dock' }"
                      @click="onSelectLayout('dock')"
                    >仅 Dock</button>
                  </div>
                </div>
                <div class="settings-action-divider" style="margin-left: 16px;"></div>
                <div class="settings-switch-row">
                  <i class="fa-solid fa-table-columns action-icon"></i>
                  <span class="action-text">图标密度</span>
                  <div class="size-segmented">
                    <button
                      v-for="opt in densityOptions"
                      :key="opt.value"
                      class="size-seg-btn"
                      :class="{ 'size-seg-btn--active': gridRows === opt.value }"
                      @click="onSelectDensity(opt.value)"
                    >{{ opt.label }}</button>
                  </div>
                </div>
              </div>
              <p class="settings-section-tip">密度为 6 列 × 行数；行数较多时建议搭配小图标。收缩时放不下的图标会自动移往其他位置。</p>
            </div>

            <!-- 桌面操作分组 -->
            <div class="settings-section">
              <div class="settings-section-title">桌面页面</div>
              <div class="settings-card">
                <button class="settings-action-btn" @click="onAddPage" :disabled="totalPages >= maxPages">
                  <i class="fa-solid fa-plus action-icon"></i>
                  <span class="action-text">添加桌面页</span>
                  <span class="action-hint">{{ totalPages }} / {{ maxPages }}</span>
                </button>
                <div class="settings-action-divider"></div>
                <button class="settings-action-btn" @click="onRemovePage" :disabled="totalPages <= 1">
                  <i class="fa-solid fa-minus action-icon"></i>
                  <span class="action-text">删除当前页</span>
                  <span class="action-hint">第 {{ currentPage + 1 }} 页</span>
                </button>
                <div class="settings-action-divider"></div>
                <button class="settings-action-btn" @click="onTidy">
                  <i class="fa-solid fa-broom action-icon"></i>
                  <span class="action-text">整理当前页</span>
                </button>
              </div>
            </div>

            <!-- 小组件分组 -->
            <div class="settings-section">
              <div class="settings-section-title">小组件</div>
              <div class="settings-card">
                <button class="settings-action-btn" @click="showWidgetPicker = true">
                  <i class="fa-solid fa-grip action-icon action-icon--blue"></i>
                  <span class="action-text">添加小组件</span>
                  <span class="action-hint">第 {{ currentPage + 1 }} 页</span>
                </button>
                <template v-if="currentWidgets.length > 0">
                  <div class="settings-action-divider"></div>
                  <div class="widget-list">
                    <div v-for="w in currentWidgets" :key="w.id" class="widget-list-item">
                      <i class="fa-solid fa-grip-vertical widget-list-icon"></i>
                      <span class="widget-list-name">{{ getWidgetName(w.type) }}</span>
                      <span class="widget-list-size">{{ w.w }}×{{ w.h }}</span>
                      <button class="widget-list-remove" @click="onRemoveWidget(w.id)">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </template>
              </div>
              <p class="settings-section-tip" v-if="currentWidgets.length === 0">
                当前页暂无小组件，点击"添加小组件"选择。
              </p>
            </div>

            <!-- 桌面外观分组 -->
            <div class="settings-section">
              <div class="settings-section-title">桌面外观</div>
              <div class="settings-card">
                <div class="settings-switch-row">
                  <i class="fa-solid fa-tag action-icon"></i>
                  <span class="action-text">显示图标标签</span>
                  <IOSSwitch :value="showIconLabels" @input="onToggleIconLabels" />
                </div>
                <div class="settings-action-divider" style="margin-left: 16px;"></div>
                <div class="settings-switch-row">
                  <i class="fa-solid fa-up-right-and-down-left-from-center action-icon"></i>
                  <span class="action-text">图标大小</span>
                  <div class="size-segmented">
                    <button
                      v-for="opt in iconSizeOptions"
                      :key="opt.value"
                      class="size-seg-btn"
                      :class="{ 'size-seg-btn--active': iconSize === opt.value }"
                      @click="onSelectIconSize(opt.value)"
                    >{{ opt.label }}</button>
                  </div>
                </div>
              </div>
              <p class="settings-section-tip">开启后桌面图标下方显示应用名称；图标大小即时生效（Dock 不受影响）。</p>
            </div>

            <!-- 主题分组（架构预留） -->
            <div class="settings-section">
              <div class="settings-section-title">主题</div>
              <div class="settings-card">
                <div v-for="theme in availableThemes" :key="theme.id" class="theme-item">
                  <button
                    class="settings-action-btn theme-btn"
                    :class="{ 'theme-btn--active': theme.id === currentThemeId }"
                    @click="onSelectTheme(theme.id)"
                  >
                    <i
                      class="action-icon"
                      :class="theme.type === 'dark' ? 'fa-solid fa-moon theme-icon--dark' : 'fa-solid fa-sun theme-icon--light'"
                      
                    ></i>
                    <span class="action-text">{{ theme.name }}</span>
                    <i v-if="theme.id === currentThemeId" class="fa-solid fa-check theme-check"></i>
                  </button>
                  <div v-if="theme.id !== availableThemes[availableThemes.length - 1].id" class="settings-action-divider"></div>
                </div>
              </div>
              <p class="settings-section-tip">主题选择即时生效；应用市场安装的主题包也会出现在这里。</p>
            </div>

            <!-- 危险操作分组 -->
            <div class="settings-section">
              <div class="settings-section-title">高级</div>
              <div class="settings-card">
                <button class="settings-action-btn settings-action-btn--danger" @click="onReset">
                  <i class="fa-solid fa-rotate-left action-icon"></i>
                  <span class="action-text">重置桌面布局</span>
                </button>
              </div>
              <p class="settings-section-tip">重置将清除所有图标位置和文件夹，恢复默认布局。</p>
            </div>
          </div>
        </div>

        <!-- 小组件选择器弹窗 -->
        <transition name="picker-slide">
          <div v-if="showWidgetPicker" class="widget-picker-overlay" @click.self="showWidgetPicker = false">
            <div class="widget-picker">
              <div class="widget-picker-header">
                <span class="widget-picker-title">添加小组件</span>
                <button class="widget-picker-close" @click="showWidgetPicker = false">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
              <div class="widget-picker-body">
                <div v-if="availableWidgets.length === 0" class="widget-picker-empty">
                  暂无可用小组件
                </div>
                <div
                  v-for="w in availableWidgets"
                  :key="w.id"
                  class="widget-picker-item"
                  @click="onAddWidget(w.id)"
                >
                  <div class="widget-picker-icon">
                    <i class="fa-solid fa-grip"></i>
                  </div>
                  <div class="widget-picker-info">
                    <span class="widget-picker-name">{{ w.name }}</span>
                    <span class="widget-picker-desc">{{ w.description }}</span>
                    <span class="widget-picker-size">
                      默认 {{ w.defaultSize.w }}×{{ w.defaultSize.h }}<template v-if="w.widenable"> · 可加宽至 {{ widenSize(w).w }}×{{ w.defaultSize.h }}</template>
                    </span>
                  </div>
                  <div class="widget-picker-actions">
                    <button
                      v-if="w.widenable"
                      class="widget-picker-wide"
                      @click.stop="onAddWidget(w.id, { wide: true })"
                    >
                      <i class="fa-solid fa-arrows-left-right"></i> 加宽
                    </button>
                    <i class="fa-solid fa-plus widget-picker-add"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </transition>
</template>

<script>
import AppNavBar from './AppNavBar.vue';
import IOSSwitch from './ios/IOSSwitch.vue';
import { listWidgets, getWidget as getWidgetDef } from '@/core/widget-aggregator';
import { listThemes } from '@/core/theme-engine';

export default {
  name: 'DesktopSettingsPanel',
  components: { AppNavBar: AppNavBar, IOSSwitch: IOSSwitch },
  props: {
    visible: { type: Boolean, default: false },
    totalPages: { type: Number, default: 1 },
    currentPage: { type: Number, default: 0 },
    maxPages: { type: Number, default: 9 }
  },
  data: function() {
    return {
      showWidgetPicker: false,
      iconSizeOptions: [
        { value: 'small', label: '小' },
        { value: 'standard', label: '标准' },
        { value: 'large', label: '大' }
      ],
      densityOptions: [
        { value: 4, label: '6×4' },
        { value: 5, label: '6×5' },
        { value: 6, label: '6×6' },
        { value: 7, label: '6×7' }
      ]
    };
  },
  computed: {
    // 当前页的 pageId（从 store 获取实际 id）
    currentPageId: function() {
      var layout = this.$store.state.desktop.layout;
      if (!layout || !layout.pages || !layout.pages[this.currentPage]) return 'page-0';
      return layout.pages[this.currentPage].id;
    },
    // 当前页的小组件列表
    currentWidgets: function() {
      return this.$store.getters['desktop/widgetsByPage'](this.currentPageId);
    },
    // 可用小组件列表（按当前用户权限过滤）
    availableWidgets: function() {
      var all = listWidgets();
      var self = this;
      return all.filter(function(w) {
        if (!w.permission) return true;
        return self.$store.getters['auth/canManage'](w.permission);
      });
    },
    // 当前主题 ID
    currentThemeId: function() {
      return this.$store.state.settings.theme || 'light';
    },
    // 可用主题列表
    availableThemes: function() {
      return listThemes();
    },
    // 桌面网格图标是否显示文字标签
    showIconLabels: function() {
      return this.$store.state.settings.showIconLabels;
    },
    // 图标尺寸档位
    iconSize: function() {
      return this.$store.state.settings.iconSize;
    },
    // 桌面布局模式（grid / dock）
    desktopLayout: function() {
      return this.$store.state.settings.desktopLayout;
    },
    // 图标密度（行数）
    gridRows: function() {
      return this.$store.getters['desktop/gridRows'];
    }
  },
  methods: {
    onClose: function() {
      this.$emit('close');
    },
    onDone: function() {
      this.$emit('done');
    },
    onAddPage: function() {
      if (this.totalPages >= this.maxPages) return;
      this.$emit('add-page');
    },
    onRemovePage: function() {
      if (this.totalPages <= 1) return;
      this.$emit('remove-page');
    },
    onTidy: function() {
      this.$emit('tidy');
    },
    onReset: function() {
      var self = this;
      this.$modal.confirm({
        title: '重置桌面布局',
        message: '将清除所有图标位置和文件夹，恢复默认布局。确定继续吗？',
        confirmText: '重置',
        cancelText: '取消'
      }).then(function(result) {
        if (!result) return;
        self.$emit('reset');
      }).catch(function() {});
    },
    // ===== 小组件 =====
    getWidgetName: function(type) {
      var def = getWidgetDef(type);
      return def ? def.name : type;
    },
    onAddWidget: function(type, opts) {
      var payload = { pageId: this.currentPageId, type: type };
      // 加宽 2×（widenable widget）：宽度翻倍并夹紧 maxSize，高度维持默认
      if (opts && opts.wide) {
        payload.w = this.widenSize(getWidgetDef(type)).w;
      }
      this.$store.dispatch('desktop/addWidget', payload);
      this.showWidgetPicker = false;
    },
    // 加宽后的尺寸：默认宽 ×2 夹紧 maxSize
    widenSize: function(def) {
      if (!def) return { w: 4, h: 2 };
      var maxW = (def.maxSize && def.maxSize.w) || 4;
      return { w: Math.min((def.defaultSize.w || 2) * 2, maxW), h: def.defaultSize.h || 2 };
    },
    onRemoveWidget: function(widgetId) {
      this.$store.dispatch('desktop/removeWidget', {
        pageId: this.currentPageId,
        widgetId: widgetId
      });
    },
    // ===== 主题 =====
    onSelectTheme: function(themeId) {
      this.$store.dispatch('settings/setTheme', themeId);
    },
    // ===== 桌面外观 =====
    onToggleIconLabels: function(val) {
      this.$store.commit('settings/SET_SHOW_ICON_LABELS', val);
    },
    onSelectIconSize: function(size) {
      this.$store.commit('settings/SET_ICON_SIZE', size);
    },
    // ===== 桌面布局 =====
    onSelectLayout: function(mode) {
      this.$store.commit('settings/SET_DESKTOP_LAYOUT', mode);
    },
    // 图标密度（行数）：收缩时自动腾挪放不下的图标（返回迁移数供 toast）
    onSelectDensity: function(rows) {
      var self = this;
      this.$store.dispatch('desktop/setGridRows', rows).then(function(moved) {
        if (moved > 0 && self.$store.state.toast) {
          self.$store.commit('toast/SHOW_TOAST', { message: '已将 ' + moved + ' 个图标移往其他位置', type: 'info' });
        }
      });
    }
  }
};
</script>

<style scoped>
/* 全屏覆盖层：不透明背景，按深浅切换（与 Settings 页面一致） */
.desktop-settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-color);
  z-index: 1100;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
}

/* 进出动画：从右侧滑入（iPadOS 设置页风格） */
.settings-panel-enter-active {
  transition: transform var(--duration-normal) var(--ease-spring), opacity var(--duration-normal) var(--ease-standard);
}
.settings-panel-leave-active {
  transition: transform var(--duration-normal) var(--ease-accelerate), opacity var(--duration-normal) var(--ease-standard);
}
.settings-panel-enter,
.settings-panel-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.desktop-settings-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  position: relative;
}

/* 顶部"完成"按钮（AppNavBar 右侧 slot） */
.settings-done-link {
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.settings-done-link:active {
  opacity: 0.5;
}

/* 内容滚动区 */
.settings-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.settings-content {
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.settings-section {
  margin-bottom: 28px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding: 0 4px;
}

.settings-section-tip {
  margin: 8px 4px 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  line-height: 1.4;
}

/* iOS 风格卡片分组 */
.settings-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: none;
}

/* 操作按钮（iOS list item 风格） */
.settings-action-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
  text-align: left;
}

.settings-action-btn:active {
  background: var(--separator-color);
}

.settings-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.settings-action-divider {
  height: 0.5px;
  background: var(--separator-color);
  margin-left: 48px;
}

/* 开关行（iOS 设置列表样式：图标 + 文案 + 右侧拨动/分段） */
.settings-switch-row {
  display: flex;
  align-items: center;
  padding: 10px 16px;
}

/* 图标大小三段选择器（iOS segmented control） */
.size-segmented {
  display: flex;
  background: var(--separator-color);
  border-radius: var(--radius-pill);
  padding: 2px;
  flex-shrink: 0;
}

.size-seg-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.size-seg-btn--active {
  background: var(--card-bg);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm);
}

.action-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #fff;
  background: var(--primary-color);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.action-icon--blue {
  background: var(--primary-color);
}

.action-text {
  flex: 1;
  text-align: left;
}

.action-hint {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.settings-action-btn--danger .action-icon {
  background: var(--danger-color);
}

.settings-action-btn--danger .action-text {
  color: var(--danger-color);
}

/* ===== 小组件列表 ===== */
.widget-list {
  padding: 4px 0;
}
.widget-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}
.widget-list-icon {
  width: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
.widget-list-name {
  flex: 1;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}
.widget-list-size {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.widget-list-remove {
  border: none;
  background: transparent;
  color: var(--danger-color);
  font-size: 14px;
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-sm);
  -webkit-tap-highlight-color: transparent;
}
.widget-list-remove:active {
  background: rgba(var(--danger-rgb), 0.1);
}

/* ===== 主题选择 ===== */
/* 主题图标：写实呈现目标主题观感（深色=暗底黄月 / 浅色=黄底白日） */
.theme-icon--dark {
  background: #1C1C1E;
  color: #FFD60A;
}

.theme-icon--light {
  background: #FFD60A;
  color: #FFFFFF;
}

.theme-item {
  display: block;
}
.theme-btn--active .action-text {
  font-weight: var(--font-weight-semibold);
}
.theme-check {
  color: var(--primary-color);
  font-size: 14px;
  margin-right: 4px;
}

/* ===== 小组件选择器弹窗 ===== */
.widget-picker-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1200;
  -webkit-tap-highlight-color: transparent;
}
.widget-picker {
  background: var(--bg-color);
  width: 100%;
  max-width: 640px;
  max-height: 70%;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.widget-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--separator-color);
  flex-shrink: 0;
}
.widget-picker-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}
.widget-picker-close {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  -webkit-tap-highlight-color: transparent;
}
.widget-picker-close:active {
  background: var(--separator-color);
}
.widget-picker-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 0;
}
.widget-picker-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
.widget-picker-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
  -webkit-tap-highlight-color: transparent;
}
.widget-picker-item:active {
  background: var(--separator-color);
}
.widget-picker-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--primary-light);
  color: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.widget-picker-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.widget-picker-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}
.widget-picker-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.widget-picker-size {
  font-size: 11px;
  color: var(--text-tertiary);
  opacity: 0.7;
}
.widget-picker-add {
  color: var(--primary-color);
  font-size: 16px;
}

.widget-picker-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.widget-picker-wide {
  border: 1px solid var(--separator-color);
  background: transparent;
  color: var(--primary-color);
  font-size: var(--font-size-caption1, 12px);
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  margin-right: 10px;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
}

.widget-picker-wide:active {
  background: var(--separator-color);
}

/* 选择器滑入动画 */
.picker-slide-enter-active,
.picker-slide-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
}
.picker-slide-enter-active .widget-picker,
.picker-slide-leave-active .widget-picker {
  transition: transform var(--duration-normal) var(--ease-spring);
}
.picker-slide-enter,
.picker-slide-leave-to {
  opacity: 0;
}
.picker-slide-enter .widget-picker,
.picker-slide-leave-to .widget-picker {
  transform: translateY(100%);
}
</style>
