<template>
  <button
    class="app-icon"
    :class="{ 'app-icon--editing': editing, 'app-icon--pinned': pinned, 'app-icon--launching': launching }"
    @click="onClick"
  >
    <div class="app-icon-img-wrap">
      <img :src="resolveIcon(app)" :alt="app.label" loading="eager" draggable="false" />
      <span v-if="badge" class="app-icon-badge" :class="{ 'app-icon-badge--dot': badge === '●' }">
        {{ badge === '●' ? '' : badge }}
      </span>
      <!-- 固定图标：右下角小锁 -->
      <span v-if="pinned" class="app-icon-pin-lock" aria-label="已固定">
        <i class="fa-solid fa-lock"></i>
      </span>
    </div>
    <span v-if="showLabel" class="app-icon-label">{{ app.label }}</span>
  </button>
</template>

<script>
import { resolveAppIcon } from '@/utils/icon-resolver.js';

export default {
  name: 'AppIcon',
  props: {
    // 应用对象：{ name, label, icon, color, route }
    app: { type: Object, required: true },
    // 角标：数字字符串、'●' 表示红点
    badge: { type: [String, Number], default: '' },
    // 是否正在启动（触发 launching 动画）
    launching: { type: Boolean, default: false },
    // 是否处于编辑态（wiggle 抖动 + 显示删除按钮）
    editing: { type: Boolean, default: false },
    // 是否固定（显示锁图标，编辑态下不可删除/拖拽）
    pinned: { type: Boolean, default: false },
    // 是否显示文字标签（桌面图标默认 false，Dock 不显示，文件夹内显示）
    showLabel: { type: Boolean, default: true }
  },
  methods: {
    // 通过 icon-resolver 解析图标路径（为未来主题图标切换预留接入点）
    resolveIcon: function(app) {
      return resolveAppIcon(app);
    },
    onClick: function() {
      // 编辑态下点击图标不启动应用（仅 wiggle），符合 iPad 行为
      if (this.editing) return;
      this.$emit('launch', this.app);
    }
  }
};
</script>

<style scoped>
.app-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  transition: transform 0.15s var(--ease-standard);
}

.app-icon:active {
  transform: scale(0.94);
  opacity: 0.7;
}

/* 图标容器 */
.app-icon-img-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-xl);
  overflow: visible;  /* 允许角标溢出 */
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s var(--ease-standard);
}

.app-icon-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-xl);
  pointer-events: none;
  -webkit-user-drag: none;
}

/* 标签 */
.app-icon-label {
  font-size: 12px;
  color: var(--text-on-wallpaper, #fff);
  text-shadow: var(--text-shadow-wallpaper, 0 1px 3px rgba(0, 0, 0, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 76px;
  line-height: 1.2;
  pointer-events: none;
}

/* 角标 */
.app-icon-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--danger-color);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  z-index: 2;
}

.app-icon-badge--dot {
  min-width: 10px;
  height: 10px;
  padding: 0;
  top: 0;
  right: 0;
}

/* 编辑态 wiggle 抖动动画 */
.app-icon--editing {
  animation: appIconWiggle 0.25s var(--ease-standard) infinite alternate;
  cursor: grab;
  will-change: transform;
}

.app-icon--editing:active {
  cursor: grabbing;
  transform: scale(0.95);
}

.app-icon--editing .app-icon-img-wrap {
  transform: scale(1.05);
}

@keyframes appIconWiggle {
  0% { transform: rotate(-2deg); }
  100% { transform: rotate(2deg); }
}

/* 固定图标锁标记 */
.app-icon-pin-lock {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #fff;
  z-index: 2;
}

/* launching 启动动画 */
.app-icon--launching .app-icon-img-wrap {
  animation: appIconLaunch 0.25s var(--ease-standard) forwards;
}

@keyframes appIconLaunch {
  0% { transform: scale(1); opacity: 1; }
  40% { transform: scale(1.25); opacity: 0.9; }
  100% { transform: scale(0.7); opacity: 0.4; }
}

/* 小屏适配 */
@media (max-width: 520px), (max-height: 400px) {
  .app-icon-img-wrap {
    width: 60px;
    height: 60px;
  }
  .app-icon-label {
    font-size: 11px;
    max-width: 72px;
  }
}
</style>
