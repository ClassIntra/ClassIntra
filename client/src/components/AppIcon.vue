<template>
  <button
    class="app-icon"
    :class="{ 'app-icon--launching': launching }"
    @click="onClick"
  >
    <div class="app-icon-img-wrap" :style="{ background: app.color }">
      <img :src="app.icon" :alt="app.label" loading="eager" draggable="false" />
      <span v-if="badge" class="app-icon-badge" :class="{ 'app-icon-badge--dot': badge === '●' }">
        {{ badge === '●' ? '' : badge }}
      </span>
    </div>
    <span class="app-icon-label">{{ app.label }}</span>
  </button>
</template>

<script>
export default {
  name: 'AppIcon',
  props: {
    // 应用对象：{ name, label, icon, color, route }
    app: { type: Object, required: true },
    // 角标：数字字符串、'●' 表示红点
    badge: { type: [String, Number], default: '' },
    // 是否正在启动（触发 launching 动画）
    launching: { type: Boolean, default: false }
  },
  methods: {
    onClick: function() {
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
  transition: transform 0.15s var(--ease-standard);
}

.app-icon:active {
  transform: scale(0.92);
  opacity: 0.85;
}

/* 图标容器 */
.app-icon-img-wrap {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s var(--ease-standard), box-shadow 0.2s var(--ease-standard);
}

.app-icon-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
}

/* 标签 */
.app-icon-label {
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
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
  border-radius: 9999px;
  background: var(--danger-color);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  border: 1.5px solid rgba(0, 0, 0, 0.15);
}

.app-icon-badge--dot {
  min-width: 10px;
  height: 10px;
  padding: 0;
  top: 0;
  right: 0;
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
    width: 52px;
    height: 52px;
  }
  .app-icon-label {
    font-size: 11px;
    max-width: 64px;
  }
}
</style>
