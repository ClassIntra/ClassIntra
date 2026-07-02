<template>
  <!-- 槽位形态：在网格中显示为文件夹图标 -->
  <button
    v-if="!expanded"
    class="desktop-folder-tile desktop-folder"
    :class="{ 'desktop-folder-tile--editing': editing }"
    @click="onTileClick"
  >
    <div class="folder-tile-icon" :data-src-type="null">
      <div class="folder-tile-grid">
        <div
          v-for="(name, i) in displayApps"
          :key="name"
          class="folder-tile-app"
          :style="tileAppStyle(i)"
        >
          <img :src="appMeta(name).icon" :alt="appMeta(name).label" draggable="false" />
        </div>
        <!-- 空位占位 -->
        <div v-for="n in emptySlots" :key="'empty-' + n" class="folder-tile-app folder-tile-app--empty"></div>
      </div>
    </div>
    <!-- 文件夹名标签已移除：仅保留纯图标展示，展开态头部仍可重命名 -->
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

  <!-- 展开形态：全屏遮罩 + 卡片 -->
  <div
    v-else
    class="folder-expanded-overlay desktop-folder"
    @click.self="onClose"
  >
    <div class="folder-expanded-card">
      <div class="folder-expanded-header">
        <input
          ref="nameInput"
          class="folder-name-input"
          :value="folder.name"
          :readonly="!renaming"
          :placeholder="'文件夹'"
          @dblclick="startRename"
          @blur="commitRename"
          @keyup.enter="commitRename"
        />
        <button v-if="editing && !renaming" class="folder-rename-btn" @click.stop="startRename" aria-label="重命名">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="folder-close-btn" @click="onClose" aria-label="关闭">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="folder-expanded-body">
        <div
          v-for="name in visibleApps"
          :key="name"
          class="folder-item"
          :data-src-type="'folder'"
          :data-src-folder="folder.id"
          :data-src-app="name"
          :data-flip-key="'folder-item-' + name"
        >
          <AppIcon
            :app="appMeta(name)"
            :editing="editing"
            :show-label="false"
            @launch="onLaunchApp(name)"
          />
        </div>
        <div v-if="visibleApps.length === 0" class="folder-empty-hint">
          文件夹为空
        </div>
      </div>
      <div v-if="editing" class="folder-expanded-footer">
        <button class="folder-action-btn" @click="onRemove">
          <i class="fa-solid fa-trash"></i> 解散文件夹
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import AppIcon from '@/components/AppIcon.vue';

export default {
  name: 'DesktopFolder',
  components: { AppIcon: AppIcon },
  props: {
    // 文件夹对象：{ id, name, apps: [name...] }
    folder: { type: Object, required: true },
    // 是否展开（false=槽位形态，true=展开形态）
    expanded: { type: Boolean, default: false },
    // 是否编辑态
    editing: { type: Boolean, default: false }
  },
  data: function() {
    return {
      renaming: false
    };
  },
  computed: {
    // 显示前 9 个应用（3×3）
    displayApps: function() {
      return (this.folder.apps || []).slice(0, 9);
    },
    // 空位数量（补齐到 9 的倍数，视觉对齐）
    emptySlots: function() {
      var count = 9 - this.displayApps.length;
      return count > 0 ? count : 0;
    },
    // 过滤禁用应用后的可见列表（对接应用管控）
    visibleApps: function() {
      var self = this;
      var isAppEnabled = this.$store.getters['desktop/isAppEnabled'];
      return (this.folder.apps || []).filter(function(name) {
        return isAppEnabled(name);
      });
    }
  },
  methods: {
    // 从 store 获取应用元数据
    appMeta: function(name) {
      return this.$store.getters['desktop/appByName'](name) || {
        name: name, label: name, icon: '', color: '#8E8E93', route: ''
      };
    },
    // 槽位内小图标定位（3×3 网格）
    tileAppStyle: function(i) {
      return {};
    },
    onTileClick: function() {
      if (this.editing) return;  // 编辑态下不打开
      this.$emit('open', this.folder);
    },
    onClose: function() {
      this.$emit('close', this.folder);
    },
    onRemove: function() {
      this.$emit('remove', this.folder);
    },
    onLaunchApp: function(name) {
      this.$emit('launch-app', name);
    },
    startRename: function() {
      this.renaming = true;
      var self = this;
      this.$nextTick(function() {
        if (self.$refs.nameInput) {
          self.$refs.nameInput.focus();
          self.$refs.nameInput.select();
        }
      });
    },
    commitRename: function() {
      if (!this.renaming) return;
      this.renaming = false;
      var newName = this.$refs.nameInput ? this.$refs.nameInput.value.trim() : '';
      if (newName && newName !== this.folder.name) {
        this.$emit('rename', { folder: this.folder, name: newName });
      }
    }
  }
};
</script>

<style scoped>
/* ===== 槽位形态 ===== */
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
  transition: transform 0.15s var(--ease-standard);
}

.desktop-folder-tile:active {
  transform: scale(0.92);
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
  width: 72px;
  height: 72px;
  border-radius: var(--radius-xl);
  background: rgba(255, 255, 255, 0.45);
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
  width: 56px;
  height: 56px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  grid-gap: 2px;
}

.folder-tile-app {
  border-radius: 6px;
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

/* 文件夹名标签已移除（.folder-tile-name CSS 同步删除） */

/* 编辑态删除按钮 */
.folder-tile-remove {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
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

/* ===== 展开形态 ===== */
.folder-expanded-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  -webkit-tap-highlight-color: transparent;
}

.folder-expanded-card {
  width: 80%;
  max-width: 480px;
  background: var(--glass-bg, rgba(255, 255, 255, 0.85));
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: folderExpand 0.3s var(--ease-spring) forwards;
}

@keyframes folderExpand {
  0% { opacity: 0; transform: scale(0.92) translateY(8px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

.folder-expanded-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 0.5px solid var(--separator-color);
}

.folder-name-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  text-align: center;
  outline: none;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.folder-name-input:focus {
  background: rgba(0, 0, 0, 0.05);
}

.folder-name-input[readonly] {
  cursor: pointer;
}

/* 重命名按钮（编辑态显示，移动端可发现） */
.folder-rename-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--primary-light);
  color: var(--primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  margin-left: 4px;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s var(--ease-standard);
}
.folder-rename-btn:active {
  transform: scale(0.92);
}

.folder-close-btn {
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
  transition: background 0.15s var(--ease-standard);
}

.folder-close-btn:active {
  background: rgba(0, 0, 0, 0.15);
}

.folder-expanded-body {
  padding: 24px 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: flex-start;
  align-items: flex-start;
  max-height: 60vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.folder-item {
  flex: 0 0 auto;
  width: 76px;
}

.folder-empty-hint {
  width: 100%;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  padding: 40px 0;
}

.folder-expanded-footer {
  padding: 12px 20px 16px;
  text-align: center;
  border-top: 0.5px solid var(--separator-color);
}

.folder-action-btn {
  border: none;
  background: transparent;
  color: var(--danger-color);
  font-size: var(--font-size-sm);
  padding: 8px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.folder-action-btn:active {
  opacity: 0.6;
}
</style>
