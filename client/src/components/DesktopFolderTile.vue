<template>
  <!-- 文件夹槽位形态：在网格中显示为文件夹图标（展开形态见 DesktopFolderExpanded.vue） -->
  <button
    class="desktop-folder-tile desktop-folder"
    :class="{ 'desktop-folder-tile--editing': editing }"
    @click="onTileClick"
  >
    <div class="folder-tile-icon" :data-src-type="null">
      <div class="folder-tile-grid">
        <div
          v-for="name in displayApps"
          :key="name"
          class="folder-tile-app"
        >
          <img :src="appMeta(name).icon" :alt="appMeta(name).label" draggable="false" />
        </div>
        <!-- 空位占位 -->
        <div v-for="n in emptySlots" :key="'empty-' + n" class="folder-tile-app folder-tile-app--empty"></div>
      </div>
    </div>
    <!-- 编辑态删除按钮（解散文件夹） -->
    <button
      v-if="editing"
      class="folder-tile-remove"
      @click.stop="onRemove"
      aria-label="解散文件夹"
    >
      <i class="fa-solid fa-xmark"></i>
    </button>
  </button>
</template>

<script>
// 单根组件。attrs 透传契约：Desktop.vue 传入的 data-src-type/page/idx/app 与 data-flip-key
// 经 fallthrough 落到根 button——desktop-drag.js 的源选择器（_findSourceElement 的 page 分支按
// flip-key="page-folder-<id>" 定位）、让位动画（查 .desktop-folder-tile）与 FLIP 均依赖这些
// 类名/属性名，勿改动。
export default {
  name: 'DesktopFolderTile',
  props: {
    // 文件夹对象：{ id, name, apps: [name...] }
    folder: { type: Object, required: true },
    // 是否编辑态
    editing: { type: Boolean, default: false }
  },
  computed: {
    // 显示前 9 个应用（3×3）。注意：预览不过滤禁用应用（与展开层的 visibleApps 不对称是现状语义）
    displayApps: function() {
      return (this.folder.apps || []).slice(0, 9);
    },
    // 空位数量（补齐到 9 的倍数，视觉对齐）
    emptySlots: function() {
      var count = 9 - this.displayApps.length;
      return count > 0 ? count : 0;
    }
  },
  methods: {
    // 从 store 获取应用元数据
    appMeta: function(name) {
      return this.$store.getters['desktop/appByName'](name) || {
        name: name, label: name, icon: '', color: '#8E8E93', route: ''
      };
    },
    onTileClick: function() {
      if (this.editing) return;  // 编辑态下不打开
      this.$emit('open', this.folder);
    },
    onRemove: function() {
      this.$emit('remove', this.folder);
    }
  }
};
</script>

<style scoped>
.desktop-folder-tile {
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
  transition: transform var(--duration-fast) var(--ease-standard);
}

.desktop-folder-tile:active {
  transform: scale(0.94);
}

.desktop-folder-tile--editing {
  animation: folderWiggle 0.25s var(--ease-standard) infinite alternate;
  cursor: grab;
}

@keyframes folderWiggle {
  0% { transform: rotate(-2deg); }
  100% { transform: rotate(2deg); }
}

/* 文件夹图标容器（圆角矩形 + 毛玻璃） */
.folder-tile-icon {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-thin);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.desktop-folder-tile--editing .folder-tile-icon {
  transform: scale(1.05);
}

/* 文件夹内 3×3 小图标网格 */
.folder-tile-grid {
  width: 46px;
  height: 46px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  grid-gap: 2px;
}

.folder-tile-app {
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-tile-app img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
}

.folder-tile-app--empty {
  background: transparent;
}

/* 编辑态删除按钮 */
.folder-tile-remove {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--danger-color);
  color: #fff;
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  z-index: 3;
  box-shadow: var(--shadow-sm);
  -webkit-tap-highlight-color: transparent;
}

.folder-tile-remove:active {
  transform: scale(0.85);
}
</style>
