<template>
  <!-- 文件夹展开形态：全屏遮罩 + 卡片（槽位形态见 DesktopFolderTile.vue）。
       单根组件，直接作为 Desktop.vue 中 folder-expand transition 的根。 -->
  <div class="folder-expanded-overlay desktop-folder" @click.self="onClose">
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
        <!-- .folder-item 上的 4 个 data 属性是拖拽引擎从文件夹内拖出图标的源标识
             （desktop-drag.js _findSourceElement 的 folder 分支选择器）与 FLIP 键，勿移除/改名 -->
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
            :show-label="$store.state.settings.showIconLabels"
            @launch="onLaunchApp"
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
  name: 'DesktopFolderExpanded',
  components: { AppIcon: AppIcon },
  props: {
    // 文件夹对象：{ id, name, apps: [name...] }
    folder: { type: Object, required: true },
    // 是否编辑态
    editing: { type: Boolean, default: false }
  },
  data: function() {
    return {
      renaming: false
    };
  },
  computed: {
    // 过滤禁用应用后的可见列表（对接应用管控）。
    // 注意：与槽位 tile 预览（不过滤）的不对称是现状语义，勿顺手统一
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
    onClose: function() {
      this.$emit('close', this.folder);
    },
    onRemove: function() {
      this.$emit('remove', this.folder);
    },
    onLaunchApp: function(app, el) {
      // 透传图标元素：供容器变换过渡捕获展开起点
      this.$emit('launch-app', app && app.name, el);
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
.folder-expanded-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* 底层（壁纸/图标/Dock）的模糊全部由宿主 .desktop--folder-open 直接 filter 完成
     （不依赖 backdrop-filter：视频合成层采样不可靠，老内核/X5 也不稳），这里只叠轻遮罩 */
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  -webkit-tap-highlight-color: transparent;
  /* 遮罩淡入：与卡片 folderExpand 弹性浮现同步 */
  animation: folderOverlayIn 0.25s var(--ease-standard, ease) both;
}

@keyframes folderOverlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 无卡片（iPadOS 式）：内容容器透明，图标直接浮在强模糊壁纸上。
   保留 .folder-expanded-card 类名——openFolder 的原点写入与收起动画依赖它 */
.folder-expanded-card {
  width: 86%;
  max-width: 560px;
  background: transparent;
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
  padding: 0 4px 20px;
}

.folder-name-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 26px;
  font-weight: 700;
  color: var(--text-on-wallpaper, #fff);
  text-shadow: var(--text-shadow-wallpaper, 0 2px 8px rgba(0, 0, 0, 0.45));
  text-align: center;
  outline: none;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}

.folder-name-input:focus {
  background: rgba(255, 255, 255, 0.14);
}

.folder-name-input[readonly] {
  cursor: pointer;
}

/* 重命名按钮（编辑态显示，移动端可发现） */
.folder-rename-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-on-wallpaper, #fff);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  margin-left: 4px;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}
.folder-rename-btn:active {
  transform: scale(0.94);
}

.folder-close-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-pill);
  border: none;
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-on-wallpaper, #fff);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.folder-close-btn:active {
  background: rgba(255, 255, 255, 0.28);
  transform: scale(0.94);
}

.folder-expanded-body {
  padding: 8px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  justify-content: center;
  align-items: flex-start;
  max-height: 56vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.folder-item {
  flex: 0 0 auto;
  width: 84px;
}

.folder-empty-hint {
  width: 100%;
  text-align: center;
  color: var(--text-on-wallpaper, #fff);
  opacity: 0.85;
  font-size: var(--font-size-sm);
  padding: 40px 0;
}

.folder-expanded-footer {
  padding: 22px 0 0;
  text-align: center;
}

.folder-action-btn {
  border: none;
  background: rgba(255, 255, 255, 0.14);
  color: #FF6B6B;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.folder-action-btn:active {
  opacity: 0.6;
}
</style>
