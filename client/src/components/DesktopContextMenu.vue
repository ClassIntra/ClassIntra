<template>
  <!-- 桌面右键菜单：按光标定位，视口边缘自动收拢；点击任意处/Esc 关闭（由宿主管理） -->
  <transition name="ctx-menu">
    <div
      v-if="visible"
      class="desktop-ctx-menu"
      :style="menuStyle"
      @click.stop
      @mousedown.stop
      @contextmenu.prevent.stop
    >
      <button
        v-for="(item, i) in items"
        :key="i"
        class="ctx-item"
        :class="{ 'ctx-item--danger': item.danger }"
        @click="$emit('select', i)"
      >
        <i class="ctx-icon" :class="item.icon"></i>
        <span class="ctx-label">{{ item.label }}</span>
      </button>
    </div>
  </transition>
</template>

<script>
export default {
  name: 'DesktopContextMenu',
  props: {
    visible: { type: Boolean, default: false },
    // 光标坐标（视口系）
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    // 菜单项：{ icon, label, danger? }
    items: { type: Array, default: function() { return []; } }
  },
  computed: {
    // 视口边缘 clamp：菜单预估宽 200 / 单项高 40 + 内边距
    menuStyle: function() {
      var W = 200;
      var H = this.items.length * 40 + 12;
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      var left = Math.min(this.x, vw - W - 8);
      if (left < 8) left = 8;
      var top = Math.min(this.y, vh - H - 8);
      if (top < 8) top = 8;
      return { left: left + 'px', top: top + 'px' };
    }
  }
};
</script>

<style scoped>
.desktop-ctx-menu {
  position: fixed;
  z-index: 1200;
  min-width: 180px;
  padding: 6px;
  background: var(--surface-elevated, rgba(28, 28, 30, 0.92));
  -webkit-backdrop-filter: var(--glass-blur-thick, blur(20px));
  backdrop-filter: var(--glass-blur-thick, blur(20px));
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  -webkit-tap-highlight-color: transparent;
}

.ctx-item {
  width: 100%;
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard);
}

.ctx-item:active {
  background: var(--separator-color);
}

@media (hover: hover) and (pointer: fine) {
  .ctx-item:hover {
    background: var(--separator-color);
  }
}

.ctx-icon {
  width: 18px;
  margin-right: 9px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}

.ctx-item--danger,
.ctx-item--danger .ctx-icon {
  color: var(--danger-color);
}

/* 进出：轻缩放 + 淡入，transform-origin 从光标角展开 */
.ctx-menu-enter-active {
  transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-spring);
}
.ctx-menu-leave-active {
  transition: opacity var(--duration-instant) var(--ease-accelerate);
}
.ctx-menu-enter,
.ctx-menu-leave-to {
  opacity: 0;
}
.ctx-menu-enter {
  transform: scale(0.92);
}
</style>
