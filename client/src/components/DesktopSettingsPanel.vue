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
                      :class="theme.type === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'"
                      :style="{ background: theme.type === 'dark' ? '#1C1C1E' : '#FFD60A', color: theme.type === 'dark' ? '#FFD60A' : '#fff' }"
                    ></i>
                    <span class="action-text">{{ theme.name }}</span>
                    <i v-if="theme.id === currentThemeId" class="fa-solid fa-check theme-check"></i>
                  </button>
                  <div v-if="theme.id !== availableThemes[availableThemes.length - 1].id" class="settings-action-divider"></div>
                </div>
              </div>
              <p class="settings-section-tip">主题系统架构预留，后续支持主题包导入。</p>
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
                    <span class="widget-picker-size">默认 {{ w.defaultSize.w }}×{{ w.defaultSize.h }}</span>
                  </div>
                  <i class="fa-solid fa-plus widget-picker-add"></i>
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
import { listWidgets, getWidget as getWidgetDef } from '@/widgets/index.js';
import { listThemes } from '@/themes/index.js';

export default {
  name: 'DesktopSettingsPanel',
  components: { AppNavBar: AppNavBar },
  props: {
    visible: { type: Boolean, default: false },
    totalPages: { type: Number, default: 1 },
    currentPage: { type: Number, default: 0 },
    maxPages: { type: Number, default: 9 }
  },
  data: function() {
    return {
      showWidgetPicker: false
    };
  },
  computed: {
    // 当前页的 pageId（从 store 获取实际 id）
    currentPageId: function() {
      var pages = this.$store.state.desktop.pages;
      if (!pages || !pages[this.currentPage]) return 'page-0';
      return pages[this.currentPage].id;
    },
    // 当前页的小组件列表
    currentWidgets: function() {
      return this.$store.getters['desktop/widgetsByPage'](this.currentPageId);
    },
    // 可用小组件列表
    availableWidgets: function() {
      return listWidgets();
    },
    // 当前主题 ID
    currentThemeId: function() {
      return this.$store.state.settings.theme || 'light';
    },
    // 可用主题列表
    availableThemes: function() {
      return listThemes();
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
    onAddWidget: function(type) {
      this.$store.dispatch('desktop/addWidget', {
        pageId: this.currentPageId,
        type: type
      });
      this.showWidgetPicker = false;
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
  transition: transform 0.35s var(--ease-spring), opacity 0.35s var(--ease-standard);
}
.settings-panel-leave-active {
  transition: transform 0.25s var(--ease-accelerate), opacity 0.25s var(--ease-standard);
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
  transition: opacity 0.15s var(--ease-standard);
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
  transition: background 0.15s var(--ease-standard);
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

.action-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #fff;
  background: var(--primary-color);
  border-radius: 6px;
  flex-shrink: 0;
}
.action-icon--blue {
  background: #007AFF;
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
  border-radius: 6px;
  -webkit-tap-highlight-color: transparent;
}
.widget-list-remove:active {
  background: rgba(255, 69, 58, 0.1);
}

/* ===== 主题选择 ===== */
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
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 -4px 30px rgba(0, 0, 0, 0.2);
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
  border-radius: 6px;
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
  transition: background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.widget-picker-item:active {
  background: var(--separator-color);
}
.widget-picker-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(0, 122, 255, 0.12);
  color: #007AFF;
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

/* 选择器滑入动画 */
.picker-slide-enter-active,
.picker-slide-leave-active {
  transition: opacity 0.25s var(--ease-standard);
}
.picker-slide-enter-active .widget-picker,
.picker-slide-leave-active .widget-picker {
  transition: transform 0.3s var(--ease-spring);
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
