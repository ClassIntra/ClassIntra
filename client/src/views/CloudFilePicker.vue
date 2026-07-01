<template>
  <div class="cloud-file-picker">
    <AppNavBar title="选择云盘文件">
      <template slot="actions">
        <button class="nav-action-btn" @click="toggleSelectMode" v-if="!selectMode" title="多选">
          <i class="fa-solid fa-list-check"></i>
        </button>
        <button class="nav-action-btn" @click="exitSelectMode" v-else>取消</button>
      </template>
    </AppNavBar>

    <!-- 搜索栏 -->
    <div class="picker-search-bar">
      <i class="fa-solid fa-magnifying-glass search-icon"></i>
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索文件..."
        @input="onSearch"
      />
      <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- 类型筛选 + 分组筛选 -->
    <div class="picker-filter-row">
      <div class="filter-tabs">
        <button class="filter-tab" :class="{ active: mediaFilter === 'all' }" @click="mediaFilter = 'all'">全部</button>
        <button class="filter-tab" :class="{ active: mediaFilter === 'image' }" @click="mediaFilter = 'image'"><i class="fa-solid fa-image"></i> 图片</button>
        <button class="filter-tab" :class="{ active: mediaFilter === 'video' }" @click="mediaFilter = 'video'"><i class="fa-solid fa-video"></i> 视频</button>
        <button class="filter-tab" :class="{ active: mediaFilter === 'audio' }" @click="mediaFilter = 'audio'"><i class="fa-solid fa-music"></i> 音频</button>
      </div>
      <select v-model="folderFilter" class="folder-select" @change="loadFiles">
        <option value="">全部分组</option>
        <option value="__root__">未分组</option>
        <option v-for="f in folders" :key="f.id" :value="f.name">{{ f.name }} ({{ f.file_count }})</option>
      </select>
    </div>

    <!-- 选中计数条 -->
    <div v-if="selectMode && selectedHashes.length > 0" class="select-bar">
      <span>已选 {{ selectedHashes.length }} 个</span>
      <button class="select-confirm-btn" @click="confirmSelection">确认选择</button>
    </div>

    <!-- 文件网格 -->
    <div class="picker-body">
      <div v-if="loading" class="state-wrap">
        <i class="fa-solid fa-spinner fa-spin state-icon"></i>
        <span>加载中...</span>
      </div>
      <div v-else-if="filteredFiles.length === 0" class="state-wrap">
        <i class="fa-solid fa-cloud state-icon"></i>
        <span>{{ searchQuery ? '无匹配文件' : '云盘为空' }}</span>
      </div>
      <div v-else class="picker-grid">
        <div
          v-for="file in filteredFiles"
          :key="file.hash || file.name"
          class="picker-card"
          :class="{ selected: isSelected(file) }"
          @click="onFileClick(file)"
        >
          <div v-if="selectMode" class="card-check">
            <i :class="isSelected(file) ? 'fa-solid fa-circle-check checked' : 'fa-regular fa-circle'"></i>
          </div>
          <div class="card-preview">
            <img v-if="getFileType(file) === 'image'" :src="file.url" :alt="file.name" loading="lazy" />
            <div v-else-if="getFileType(file) === 'video'" class="card-icon video-icon">
              <i class="fa-solid fa-play"></i>
            </div>
            <div v-else-if="getFileType(file) === 'audio'" class="card-icon audio-icon">
              <i class="fa-solid fa-music"></i>
            </div>
            <div v-else class="card-icon other-icon">
              <i class="fa-solid fa-file"></i>
            </div>
            <span v-if="getFileType(file) === 'video' || getFileType(file) === 'audio'" class="card-duration" v-text="getFileType(file) === 'video' ? '视频' : '音频'"></span>
          </div>
          <div class="card-info">
            <span class="card-name">{{ file.display_name || file.name }}</span>
            <span class="card-size">{{ formatSize(file.size) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';

export default {
  name: 'CloudFilePicker',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      files: [],
      folders: [],
      loading: true,
      searchQuery: '',
      mediaFilter: 'all',
      folderFilter: '',
      selectMode: false,
      selectedHashes: []
    };
  },
  computed: {
    filteredFiles: function() {
      var self = this;
      var result = self.files;
      if (self.mediaFilter !== 'all') {
        result = result.filter(function(file) {
          return self.getFileType(file) === self.mediaFilter;
        });
      }
      if (self.searchQuery) {
        var query = self.searchQuery.toLowerCase();
        result = result.filter(function(file) {
          var name = (file.display_name || file.name || '').toLowerCase();
          return name.indexOf(query) > -1;
        });
      }
      return result;
    }
  },
  mounted: function() {
    this.loadFiles();
    this.loadFolders();
    // 检查是否有上次的选择结果需要清理
    sessionStorage.removeItem('__cloudPickerFile');
  },
  methods: {
    loadFiles: function() {
      var self = this;
      self.loading = true;
      var params = {};
      if (self.folderFilter) params.folder = self.folderFilter;
      api.get('/cloud/files', { params: params }).then(function(res) {
        self.files = res.data.data.files || [];
        self.loading = false;
      }).catch(function() {
        self.loading = false;
      });
    },
    loadFolders: function() {
      var self = this;
      api.get('/cloud/folders').then(function(res) {
        self.folders = res.data.data.folders || [];
      }).catch(function() {});
    },
    getFileType: function(file) {
      if (file && file.mime_type) {
        if (file.mime_type.indexOf('image/') === 0) return 'image';
        if (file.mime_type.indexOf('video/') === 0) return 'video';
        if (file.mime_type.indexOf('audio/') === 0) return 'audio';
      }
      var name = (file && (file.name || file.display_name)) || '';
      var lower = name.toLowerCase();
      if (lower.indexOf('__audio') > -1) return 'audio';
      if (lower.indexOf('__video') > -1) return 'video';
      if (lower.indexOf('__image') > -1) return 'image';
      var VID_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
      var AUD_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];
      var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      for (var v = 0; v < VID_EXTS.length; v++) { if (lower.indexOf(VID_EXTS[v]) > -1) return 'video'; }
      for (var a = 0; a < AUD_EXTS.length; a++) { if (lower.indexOf(AUD_EXTS[a]) > -1) return 'audio'; }
      for (var i = 0; i < IMG_EXTS.length; i++) { if (lower.indexOf(IMG_EXTS[i]) > -1) return 'image'; }
      return 'other';
    },

    // 多选
    toggleSelectMode: function() { this.selectMode = true; this.selectedHashes = []; },
    exitSelectMode: function() { this.selectMode = false; this.selectedHashes = []; },
    isSelected: function(file) {
      return this.selectedHashes.indexOf(file.hash || file.name) !== -1;
    },
    onFileClick: function(file) {
      var self = this;
      if (self.selectMode) {
        var id = file.hash || file.name;
        var idx = self.selectedHashes.indexOf(id);
        if (idx === -1) {
          self.selectedHashes.push(id);
        } else {
          self.selectedHashes.splice(idx, 1);
        }
      } else {
        // 单选：直接返回
        self.emitAndGoBack(file);
      }
    },
    confirmSelection: function() {
      var self = this;
      if (self.selectedHashes.length === 0) return;
      // 多选：返回第一个选中的文件（大多数场景只需一个文件）
      var firstHash = self.selectedHashes[0];
      var file = self.files.find(function(f) { return (f.hash || f.name) === firstHash; });
      if (file) self.emitAndGoBack(file);
    },
    emitAndGoBack: function(file) {
      // 通过 sessionStorage 传递结果
      sessionStorage.setItem('__cloudPickerFile', JSON.stringify({
        hash: file.hash,
        name: file.display_name || file.name,
        display_name: file.display_name || file.name,
        url: file.url,
        size: file.size,
        mime_type: file.mime_type
      }));
      this.$router.go(-1);
    },
    onSearch: function() { /* 即时过滤，由 computed 处理 */ },
    formatSize: function(bytes) {
      if (!bytes) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }
  }
};
</script>

<style scoped>
.cloud-file-picker {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}
.nav-action-btn {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-callout);
  color: var(--primary-color);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.nav-action-btn:hover { background: var(--primary-light); }
.nav-action-btn:active { transform: scale(0.92); opacity: 0.7; }

/* 搜索栏 */
.picker-search-bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  gap: 10px;
}
.search-icon {
  color: var(--text-tertiary);
  font-size: 16px;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  outline: none;
}
.search-input::placeholder { color: var(--text-tertiary); }
.search-clear {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}

/* 筛选行 */
.picker-filter-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  gap: 8px;
}
.filter-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.filter-tabs::-webkit-scrollbar { display: none; }
.filter-tab {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  background: var(--bg-color);
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.filter-tab.active { background: var(--primary-color); color: #fff; }
.filter-tab i { margin-right: 2px; }
.folder-select {
  flex-shrink: 0;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-caption2);
  max-width: 120px;
  outline: none;
}

/* 选中栏 */
.select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--primary-light);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-size-body);
  color: var(--primary-color);
}
.select-confirm-btn {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

/* 文件区域 */
.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  -webkit-overflow-scrolling: touch;
}
.state-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-tertiary);
  font-size: 15px;
}
.state-icon { font-size: 40px; }
.picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
@media (min-width: 500px) {
  .picker-grid { grid-template-columns: repeat(4, 1fr); }
}
@media (min-width: 768px) {
  .picker-grid { grid-template-columns: repeat(5, 1fr); }
}
@media (min-width: 1024px) {
  .picker-grid { grid-template-columns: repeat(6, 1fr); }
}

.picker-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  position: relative;
  box-shadow: var(--shadow-sm);
}
.picker-card:active { transform: scale(0.97); }
.picker-card.selected { box-shadow: 0 0 0 3px var(--primary-color); }
.card-check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  font-size: 20px;
  color: var(--text-tertiary);
}
.card-check .checked { color: var(--primary-color); background: #fff; border-radius: 50%; }
.card-preview {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-color-secondary);
  overflow: hidden;
  position: relative;
}
.card-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
}
.video-icon { background: linear-gradient(135deg, #2c3e50, #34495e); color: #fff; }
.audio-icon { background: linear-gradient(135deg, #8e44ad, #9b59b6); color: #fff; }
.other-icon { background: linear-gradient(135deg, #7f8c8d, #95a5a6); color: #fff; }
.card-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  padding: 2px 6px;
  background: rgba(0,0,0,0.6);
  color: #fff;
  font-size: 10px;
  border-radius: 4px;
}
.card-info {
  padding: 8px;
}
.card-name {
  display: block;
  font-size: var(--font-size-caption2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}
.card-size {
  font-size: var(--font-size-caption3);
  color: var(--text-secondary);
}
</style>
