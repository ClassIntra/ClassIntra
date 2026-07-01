<template>
  <transition name="settings-panel">
    <div v-if="visible" class="desktop-settings-overlay" @click.self="onClose">
      <div class="desktop-settings-panel">
        <div class="settings-panel-header">
          <h3 class="settings-panel-title">桌面设置</h3>
          <button class="settings-panel-close" @click="onClose" aria-label="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="settings-panel-body">
          <!-- 壁纸选择 -->
          <div class="settings-section">
            <div class="settings-section-title">壁纸</div>
            <div class="wallpaper-grid">
              <button
                v-for="wp in wallpapers"
                :key="wp.key"
                class="wallpaper-thumb"
                :class="{ 'wallpaper-thumb--active': currentWallpaper === wp.key }"
                :style="{ background: wp.value }"
                @click="onSelectWallpaper(wp.key)"
                :aria-label="wp.label"
              ></button>
            </div>
          </div>

          <!-- 桌面操作 -->
          <div class="settings-section">
            <div class="settings-section-title">桌面</div>
            <button class="settings-action-btn" @click="onAddPage" :disabled="totalPages >= maxPages">
              <i class="fa-solid fa-plus action-icon"></i>
              <span class="action-text">添加桌面页</span>
              <span class="action-hint">{{ totalPages }} / {{ maxPages }}</span>
            </button>
            <button class="settings-action-btn" @click="onRemovePage" :disabled="totalPages <= 1">
              <i class="fa-solid fa-minus action-icon"></i>
              <span class="action-text">删除当前页</span>
              <span class="action-hint">第 {{ currentPage + 1 }} 页</span>
            </button>
            <button class="settings-action-btn" @click="onTidy">
              <i class="fa-solid fa-broom action-icon"></i>
              <span class="action-text">整理当前页</span>
            </button>
            <button class="settings-action-btn settings-action-btn--danger" @click="onReset">
              <i class="fa-solid fa-rotate-left action-icon"></i>
              <span class="action-text">重置桌面布局</span>
            </button>
          </div>
        </div>
        <div class="settings-panel-footer">
          <button class="settings-done-btn" @click="onDone">
            <i class="fa-solid fa-check"></i> 完成
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
// 壁纸映射（与 Desktop.vue 保持一致）
var WALLPAPER_MAP = {
  'default': { label: '默认', value: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 50%, #BFEEFF 100%)' },
  'ocean': { label: '海洋', value: 'linear-gradient(135deg, #003D7A 0%, #007AFF 50%, #5AC8FA 100%)' },
  'sky': { label: '天空', value: 'linear-gradient(135deg, #0A84FF 0%, #5AC8FA 40%, #BFEEFF 100%)' },
  'night': { label: '夜晚', value: 'linear-gradient(135deg, #000000 0%, #1C1C1E 50%, #2C2C2E 100%)' },
  'dawn': { label: '黎明', value: 'linear-gradient(135deg, #FF9500 0%, #FF2D55 30%, #FFCC00 100%)' },
  'arctic': { label: '极地', value: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 50%, #90CAF9 100%)' }
};

export default {
  name: 'DesktopSettingsPanel',
  props: {
    visible: { type: Boolean, default: false },
    totalPages: { type: Number, default: 1 },
    currentPage: { type: Number, default: 0 },
    maxPages: { type: Number, default: 9 }
  },
  computed: {
    wallpapers: function() {
      return Object.keys(WALLPAPER_MAP).map(function(key) {
        return { key: key, label: WALLPAPER_MAP[key].label, value: WALLPAPER_MAP[key].value };
      });
    },
    currentWallpaper: function() {
      return this.$store.state.settings.wallpaper;
    }
  },
  methods: {
    onClose: function() {
      this.$emit('close');
    },
    onDone: function() {
      this.$emit('done');
    },
    onSelectWallpaper: function(key) {
      this.$store.commit('settings/SET_WALLPAPER', key);
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
      }).then(function() {
        self.$emit('reset');
      }).catch(function() {});
    }
  }
};
</script>

<style scoped>
.desktop-settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1100;
  -webkit-tap-highlight-color: transparent;
}

/* 进出动画：从底部弹出 */
.settings-panel-enter-active {
  animation: panelUp 0.35s var(--ease-spring) forwards;
}
.settings-panel-leave-active {
  animation: panelUp 0.25s var(--ease-accelerate) reverse forwards;
}
@keyframes panelUp {
  0% { transform: translateY(100%); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

.settings-panel-enter-active .desktop-settings-panel,
.settings-panel-leave-active .desktop-settings-panel {
  animation: none;
}

.desktop-settings-panel {
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 0.5px solid var(--separator-color);
}

.settings-panel-title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.settings-panel-close {
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: none;
  background: rgba(0, 0, 0, 0.08);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.settings-panel-close:active {
  background: rgba(0, 0, 0, 0.15);
}

.settings-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding: 20px;
}

.settings-section {
  margin-bottom: 24px;
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
  margin-bottom: 12px;
}

/* 壁纸网格 */
.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-gap: 12px;
}

.wallpaper-thumb {
  width: 100%;
  height: 84px;
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s var(--ease-standard), border-color 0.15s var(--ease-standard);
}

.wallpaper-thumb:active {
  transform: scale(0.95);
}

.wallpaper-thumb--active {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--primary-light);
}

/* 操作按钮 */
.settings-action-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  cursor: pointer;
  margin-bottom: 8px;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s var(--ease-standard);
}

.settings-action-btn:last-child {
  margin-bottom: 0;
}

.settings-action-btn:active {
  background: rgba(0, 0, 0, 0.08);
}

.settings-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-icon {
  width: 20px;
  text-align: center;
  color: var(--primary-color);
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
  color: var(--danger-color);
}

.settings-action-btn--danger .action-text {
  color: var(--danger-color);
}

.settings-panel-footer {
  padding: 16px 20px;
  border-top: 0.5px solid var(--separator-color);
}

.settings-done-btn {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s var(--ease-standard);
}

.settings-done-btn:active {
  transform: scale(0.97);
}
</style>
