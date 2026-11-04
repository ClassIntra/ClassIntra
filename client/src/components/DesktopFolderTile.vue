<template>
  <!-- 文件夹槽位形态：1×1 为 3×3 预览（点击打开）；
       大文件夹（size≠'1x1'）撑满跨格 slot，mini 图标直接点击启动（HarmonyOS 语义） -->
  <button
    class="desktop-folder-tile desktop-folder"
    :class="{ 'desktop-folder-tile--editing': editing, 'folder-tile--large': isLarge, 'folder-tile--wide': isWide }"
    @click="onTileClick"
  >
    <div class="folder-tile-icon" :data-src-type="null">
      <div class="folder-tile-grid">
        <div
          v-for="name in displayApps"
          :key="name"
          class="folder-tile-app"
          :class="{ 'folder-tile-app--launch': isLarge }"
          :title="isLarge ? appMeta(name).label : null"
          @click.stop="onMiniClick(name)"
        >
          <img :src="iconUrl(name)" :alt="appMeta(name).label" draggable="false" />
        </div>
        <!-- 空位占位（仅 1×1 形态；大形态留白即打开入口） -->
        <div v-for="n in emptySlots" :key="'empty-' + n" class="folder-tile-app folder-tile-app--empty"></div>
      </div>
    </div>
    <!-- 编辑态控制：尺寸循环 + 解散 -->
    <button
      v-if="editing"
      class="folder-tile-size"
      @click.stop="$emit('resize', folder)"
      aria-label="调整大小"
      :title="'尺寸：' + sizeLabel"
    >
      <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
    </button>
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
import { resolveAppIcon } from '@/utils/icon-resolver.js';

export default {
  name: 'DesktopFolderTile',
  props: {
    // 文件夹对象：{ id, name, apps: [name...] }
    folder: { type: Object, required: true },
    // 是否编辑态
    editing: { type: Boolean, default: false }
  },
  computed: {
    // 大文件夹形态：'2x2'（4 格）| '2x4'（8 格横排）
    isLarge: function() {
      return this.folder && (this.folder.size === '2x2' || this.folder.size === '2x4');
    },
    isWide: function() {
      return this.folder && this.folder.size === '2x4';
    },
    sizeLabel: function() {
      return this.folder && this.folder.size === '2x2' ? '2×2' : (this.folder && this.folder.size === '2x4' ? '2×4' : '1×1');
    },
    // 预览应用：1×1 显示前 9 个（3×3）；2×2 显示 4 个；2×4 显示 8 个。
    // 注意：预览不过滤禁用应用（与展开层的 visibleApps 不对称是现状语义）
    displayApps: function() {
      var apps = this.folder.apps || [];
      if (this.folder.size === '2x2') return apps.slice(0, 4);
      if (this.folder.size === '2x4') return apps.slice(0, 8);
      return apps.slice(0, 9);
    },
    // 空位数量（仅 1×1 形态补齐 9 格；大形态留白即打开入口）
    emptySlots: function() {
      if (this.isLarge) return 0;
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
    // 图标 URL：走解析器（DPR≤2 取 120px 变体）
    iconUrl: function(name) {
      return resolveAppIcon(this.appMeta(name));
    },
    // 大文件夹：mini 图标直接启动（不打开文件夹）
    onMiniClick: function(name) {
      if (!this.isLarge || this.editing) return;
      this.$emit('launch-app', name);
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

/* 文件夹图标容器：主题感知毛玻璃（深色模式深玻璃/浅色模式浅玻璃），3×3 图标带内边距 */
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

/* 文件夹内 3×3 迷你图标：54px 网格居中（四周 3px 内边距，不贴边） */
.folder-tile-grid {
  width: 54px;
  height: 54px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  grid-gap: 2px;
}

.folder-tile-app {
  border-radius: var(--radius-xs, 3px);
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

/* ===== 大文件夹形态（2×2 / 2×4）：撑满跨格 slot，mini 图标直接点击启动 ===== */
.folder-tile--large {
  padding: 0;
  width: 100%;
  height: 100%;
}

.folder-tile--large .folder-tile-icon {
  width: 100%;
  height: 100%;
}

.folder-tile--large .folder-tile-grid {
  width: 100%;
  height: 100%;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  grid-gap: 3px;
  padding: 4px;
}

.folder-tile--wide .folder-tile-grid {
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(2, 1fr);
}

.folder-tile--large .folder-tile-app {
  border-radius: var(--radius-xs, 6px);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.folder-tile--large .folder-tile-app:active {
  transform: scale(0.92);
  background: rgba(255, 255, 255, 0.18);
}

/* 编辑态尺寸循环按钮（与解散按钮对称，右上角） */
.folder-tile-size {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--primary-color);
  color: #fff;
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  cursor: pointer;
  padding: 0;
  z-index: 3;
  box-shadow: var(--shadow-sm);
  -webkit-tap-highlight-color: transparent;
}

.folder-tile-size:active {
  transform: scale(0.85);
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
