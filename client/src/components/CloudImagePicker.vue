<template>
  <div class="cloud-picker-overlay" @click.self="$emit('close')">
    <div class="cloud-picker-sheet">
      <div class="picker-header">
        <span>选择云盘文件</span>
        <button class="picker-close" @click="$emit('close')"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="picker-search">
        <i class="fa-solid fa-magnifying-glass picker-search-icon"></i>
        <input v-model="searchQuery" class="picker-search-input" placeholder="搜索文件..." />
      </div>
      <div class="picker-tabs">
        <button class="picker-tab" :class="{ active: mediaFilter === 'all' }" @click="mediaFilter = 'all'">全部</button>
        <button class="picker-tab" :class="{ active: mediaFilter === 'image' }" @click="mediaFilter = 'image'"><i class="fa-solid fa-image"></i> 图片</button>
        <button class="picker-tab" :class="{ active: mediaFilter === 'video' }" @click="mediaFilter = 'video'"><i class="fa-solid fa-video"></i> 视频</button>
        <button class="picker-tab" :class="{ active: mediaFilter === 'audio' }" @click="mediaFilter = 'audio'"><i class="fa-solid fa-music"></i> 音频</button>
      </div>
      <div class="picker-content">
        <div v-if="loading" class="picker-loading">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>加载中...</span>
        </div>
        <div v-else-if="filteredFiles.length === 0" class="picker-empty">
          <i class="fa-solid fa-cloud"></i>
          <span>{{ searchQuery ? '无匹配文件' : '云盘无文件' }}</span>
        </div>
        <div v-else class="picker-grid">
          <div
            v-for="file in filteredFiles"
            :key="file.name"
            class="picker-item"
            @click="selectFile(file)"
          >
            <img v-if="getFileType(file.name) === 'image'" :src="file.url" :alt="file.name" loading="lazy" class="picker-img" />
            <div v-else-if="getFileType(file.name) === 'video'" class="picker-icon-card">
              <i class="fa-solid fa-video"></i>
            </div>
            <div v-else-if="getFileType(file.name) === 'audio'" class="picker-icon-card picker-audio-card">
              <i class="fa-solid fa-music"></i>
            </div>
            <div class="picker-name">{{ file.name }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'CloudImagePicker',
  data: function() {
    return {
      files: [],
      loading: true,
      searchQuery: '',
      mediaFilter: 'all'
    };
  },
  computed: {
    filteredFiles: function() {
      var self = this;
      var result = self.files;
      // 类型筛选
      if (self.mediaFilter !== 'all') {
        result = result.filter(function(file) {
          return self.getFileType(file.name) === self.mediaFilter;
        });
      }
      // 搜索筛选
      if (self.searchQuery) {
        var query = self.searchQuery.toLowerCase();
        result = result.filter(function(file) {
          return file.name.toLowerCase().indexOf(query) > -1;
        });
      }
      return result;
    }
  },
  mounted: function() {
    this.loadFiles();
  },
  methods: {
    loadFiles: function() {
      var self = this;
      self.loading = true;
      api.get('/cloud/files').then(function(res) {
        self.files = res.data.data.files || [];
        self.loading = false;
      }).catch(function(err) {
        console.error('加载云盘文件失败:', err);
        self.loading = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '加载云盘文件失败', type: 'error' });
      });
    },
    getFileType: function(name) {
      var lower = (name || '').toLowerCase();
      var VID_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
      var AUD_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];
      var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      if (lower.indexOf('__audio') > -1) return 'audio';
      if (lower.indexOf('__video') > -1) return 'video';
      if (lower.indexOf('__image') > -1) return 'image';
      for (var v = 0; v < VID_EXTS.length; v++) { if (lower.indexOf(VID_EXTS[v]) > -1) return 'video'; }
      for (var a = 0; a < AUD_EXTS.length; a++) { if (lower.indexOf(AUD_EXTS[a]) > -1) return 'audio'; }
      for (var i = 0; i < IMG_EXTS.length; i++) { if (lower.indexOf(IMG_EXTS[i]) > -1) return 'image'; }
      return 'other';
    },
    selectFile: function(file) {
      this.$emit('select', file);
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.cloud-picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10002;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.cloud-picker-sheet {
  background: var(--card-bg);
  width: 100%;
  max-width: 500px;
  max-height: 70vh;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.picker-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 20px;
  padding: 4px;
  cursor: pointer;
  transition: color 0.15s;
}

.picker-close:hover {
  color: var(--text-primary);
}

.picker-search {
  padding: 12px 20px;
  position: relative;
}

.picker-search-icon {
  position: absolute;
  left: 32px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  font-size: 14px;
}

.picker-search-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: 14px;
  transition: border-color 0.15s;
}

.picker-search-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

/* 类型筛选标签 */
.picker-tabs {
  display: flex; gap: 6px; padding: 8px 20px;
  border-bottom: 1px solid var(--border-color);
}
.picker-tab {
  padding: 6px 12px; border-radius: var(--radius-pill);
  font-size: 12px; color: var(--text-secondary);
  background: var(--bg-color); border: none; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.picker-tab.active {
  background: var(--primary-color); color: #fff;
}
.picker-tab i { margin-right: 3px; }

/* 视频/音频图标卡片 */
.picker-icon-card {
  width: 100%; aspect-ratio: 1;
  border-radius: var(--radius-sm); background: var(--bg-color);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; color: var(--text-secondary);
}
.picker-audio-card { background: linear-gradient(135deg, rgba(var(--primary-rgb),0.08), rgba(var(--primary-rgb),0.02)); }

.picker-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.picker-loading,
.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--text-tertiary);
  font-size: 14px;
}

.picker-loading i,
.picker-empty i {
  font-size: 32px;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.picker-item {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.picker-item:hover {
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.picker-img {
  width: 100%;
  height: 80px;
  object-fit: cover;
  background: var(--border-color);
}

.picker-name {
  padding: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
</style>