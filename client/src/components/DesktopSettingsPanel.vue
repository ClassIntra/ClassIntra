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
      </div>
    </div>
  </transition>
</template>

<script>
import AppNavBar from './AppNavBar.vue';

export default {
  name: 'DesktopSettingsPanel',
  components: { AppNavBar: AppNavBar },
  props: {
    visible: { type: Boolean, default: false },
    totalPages: { type: Number, default: 1 },
    currentPage: { type: Number, default: 0 },
    maxPages: { type: Number, default: 9 }
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
        // 取消时不执行（confirm 的取消走 resolve(false)，不会进 catch）
        if (!result) return;
        self.$emit('reset');
      }).catch(function() {});
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
</style>
