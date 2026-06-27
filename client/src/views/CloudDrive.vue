<template>
  <div class="cloud-drive">
    <AppNavBar title="我的云盘">
      <template slot="actions">
        <button class="nav-action-btn" @click="triggerUpload" title="上传">
          <i class="fa-solid fa-cloud-arrow-up"></i>
        </button>
      </template>
    </AppNavBar>

    <div class="cloud-content">
      <!-- 上传码模块 -->
      <div class="upload-code-card">
        <div class="upload-code-header">
          <div class="upload-code-title">
            <i class="fa-solid fa-key"></i>
            <span>跨浏览器上传码</span>
          </div>
          <button class="code-refresh-btn" :disabled="codeRefreshing" @click="refreshUploadCode">
            <i class="fa-solid fa-rotate" :class="{ 'fa-spin': codeRefreshing }"></i>
            <span>刷新</span>
          </button>
        </div>
        <div class="upload-code-display">
          <span v-if="codeLoading" class="code-loading">加载中...</span>
          <span v-else class="code-value">{{ uploadCode }}</span>
        </div>
        <div class="upload-code-meta" v-if="uploadCodeCreatedAt">
          生成时间：{{ formatCodeTime(uploadCodeCreatedAt) }}
        </div>
        <div class="upload-code-tips">
          <i class="fa-solid fa-circle-info"></i>
          <div class="tips-content">
            <p>在其他设备/浏览器的登录页点击「快捷上传」，输入此上传码即可向您云盘上传文件。</p>
            <p class="tips-warn">上传码仅手动刷新才会变更，请妥善保管，避免被他人滥用。</p>
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="skeleton-pulse"></div>
      </div>

      <div v-else-if="files.length === 0" class="empty-state">
        <i class="fa-solid fa-cloud"></i>
        <p>云盘为空</p>
        <button class="upload-btn" @click="triggerUpload">上传文件</button>
      </div>

      <div v-else class="file-grid">
        <div v-for="file in files" :key="file.name" class="file-card">
          <div class="file-preview" @click="previewFile(file)">
            <!-- 图片 -->
            <img v-if="getMediaType(file.name) === 'image'" :src="file.url" :alt="file.name" loading="lazy" />
            <!-- 视频 -->
            <div v-else-if="getMediaType(file.name) === 'video'" class="media-thumb video-thumb">
              <i class="fa-solid fa-play"></i>
              <span class="media-thumb-label">视频</span>
            </div>
            <!-- 音频 -->
            <div v-else-if="getMediaType(file.name) === 'audio'" class="media-thumb audio-thumb">
              <i class="fa-solid fa-music"></i>
              <span class="media-thumb-label">音频</span>
            </div>
            <!-- 其他 -->
            <div v-else class="media-thumb other-thumb">
              <i class="fa-solid fa-file"></i>
              <span class="media-thumb-label">文件</span>
            </div>
          </div>
          <div class="file-info">
            <span class="file-name">{{ file.name }}</span>
            <span class="file-size">{{ formatSize(file.size) }}</span>
          </div>
          <button class="file-delete" @click="deleteFile(file)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 媒体预览 -->
    <div v-if="previewFile_data" class="preview-overlay" @click.self="closePreview">
      <img v-if="previewFile_data.type === 'image'" :src="previewFile_data.url" class="preview-img" />
      <video v-else-if="previewFile_data.type === 'video'" :src="previewFile_data.url" class="preview-video" controls autoplay></video>
      <div v-else-if="previewFile_data.type === 'audio'" class="preview-audio-wrap">
        <div class="audio-icon"><i class="fa-solid fa-music"></i></div>
        <audio :src="previewFile_data.url" controls autoplay></audio>
      </div>
      <button class="preview-close" @click="closePreview"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';

var IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
var VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
var AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];

function getMediaType(name) {
  if (!name) return 'other';
  var lower = name.toLowerCase();
  // 优先解析文件名中的类型标记（新格式：<userId>_<ts>_<rand>__audio.webm）
  // 解决 .webm/.mp4 扩展名歧义：录音产出 audio/webm 也带 .webm 后缀
  if (lower.indexOf('__audio') > -1) return 'audio';
  if (lower.indexOf('__video') > -1) return 'video';
  if (lower.indexOf('__image') > -1) return 'image';
  // 回退到扩展名（旧文件兼容）
  var ext = '';
  var idx = name.lastIndexOf('.');
  if (idx > -1) ext = name.substring(idx).toLowerCase();
  if (IMAGE_EXTS.indexOf(ext) > -1) return 'image';
  if (VIDEO_EXTS.indexOf(ext) > -1) return 'video';
  if (AUDIO_EXTS.indexOf(ext) > -1) return 'audio';
  return 'other';
}

export default {
  name: 'CloudDrive',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      files: [],
      loading: true,
      previewFile_data: null,
      // 上传码相关
      uploadCode: '',
      uploadCodeCreatedAt: '',
      codeLoading: true,
      codeRefreshing: false
    };
  },
  mounted: function() {
    this.loadFiles();
    this.loadUploadCode();
  },
  methods: {
    loadFiles: function() {
      var self = this;
      self.loading = true;
      api.get('/cloud/files').then(function(res) {
        self.files = res.data.data.files || [];
        self.loading = false;
      }).catch(function() {
        self.loading = false;
      });
    },
    loadUploadCode: function() {
      var self = this;
      self.codeLoading = true;
      api.get('/cloud/upload-code').then(function(res) {
        if (res.data.code === 200 && res.data.data) {
          self.uploadCode = res.data.data.code || '';
          self.uploadCodeCreatedAt = res.data.data.created_at || '';
        }
        self.codeLoading = false;
      }).catch(function() {
        self.codeLoading = false;
      });
    },
    refreshUploadCode: function() {
      var self = this;
      self.codeRefreshing = true;
      api.post('/cloud/upload-code').then(function(res) {
        if (res.data.code === 200 && res.data.data) {
          self.uploadCode = res.data.data.code || '';
          self.uploadCodeCreatedAt = res.data.data.created_at || '';
          self.$store.commit('toast/SHOW_TOAST', { message: '上传码已刷新', type: 'success' });
        }
        self.codeRefreshing = false;
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '刷新失败，请重试', type: 'error' });
        self.codeRefreshing = false;
      });
    },
    formatCodeTime: function(ts) {
      if (!ts) return '';
      var s = String(ts);
      if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
      if (s.indexOf('Z') === -1 && s.indexOf('+') === -1) s = s + 'Z';
      var d = new Date(s);
      if (isNaN(d.getTime())) return '';
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    getMediaType: function(name) {
      return getMediaType(name);
    },
    triggerUpload: function() {
      // 跳转到快捷上传页面（支持录音/录像/文件上传）
      this.$router.push('/cloud-upload');
    },
    deleteFile: function(file) {
      var self = this;
      self.$modal.confirm({ message: '确认删除此文件？' }).then(function(result) {
        if (!result) return;
        api.delete('/cloud/files/' + encodeURIComponent(file.name)).then(function(res) {
          if (res.data.code === 200) {
            self.files = self.files.filter(function(f) { return f.name !== file.name; });
            self.$store.commit('toast/SHOW_TOAST', { message: '删除成功', type: 'success' });
          }
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '删除失败', type: 'error' });
        });
      });
    },
    previewFile: function(file) {
      var type = getMediaType(file.name);
      if (type === 'other') {
        this.$store.commit('toast/SHOW_TOAST', { message: '暂不支持预览此文件类型', type: 'info' });
        return;
      }
      this.previewFile_data = { url: file.url, type: type, name: file.name };
    },
    closePreview: function() {
      this.previewFile_data = null;
    },
    formatSize: function(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }
  }
};
</script>

<style scoped>
.cloud-drive {
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
.cloud-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
}

/* 上传码卡片 */
.upload-code-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.upload-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.upload-code-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}
.upload-code-title i {
  color: var(--primary-color);
}
.code-refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--primary-light);
  color: var(--primary-color);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  min-height: 32px;
  transition: opacity 0.15s, transform 0.15s;
}
.code-refresh-btn:active { transform: scale(0.92); opacity: 0.7; }
.code-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.upload-code-display {
  text-align: center;
  padding: 16px 0;
  background: var(--bg-color-secondary);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}
.code-loading {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
}
.code-value {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--primary-color);
}
.upload-code-meta {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-align: center;
}
.upload-code-tips {
  display: flex;
  gap: 8px;
  padding: 10px;
  background: var(--bg-color-secondary);
  border-radius: var(--radius-sm);
}
.upload-code-tips > i {
  color: var(--primary-color);
  font-size: var(--font-size-sm);
  margin-top: 2px;
}
.tips-content {
  flex: 1;
}
.tips-content p {
  margin: 0 0 4px 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}
.tips-warn {
  color: var(--warning-color, #ff9500) !important;
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}
.skeleton-pulse {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent-resource, #5856D6);
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  color: var(--text-color-secondary);
}
.empty-state i {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.3;
}
.upload-btn {
  margin-top: 16px;
  padding: 10px 24px;
  background: var(--accent-resource, #5856D6);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  cursor: pointer;
}
.upload-btn:active { transform: scale(0.95); opacity: 0.8; }
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.file-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow-sm);
}
.file-preview {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-color-secondary);
  cursor: pointer;
  overflow: hidden;
}
.file-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.media-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.video-thumb { background: linear-gradient(135deg, #2c3e50, #34495e); color: #fff; }
.audio-thumb { background: linear-gradient(135deg, #8e44ad, #9b59b6); color: #fff; }
.other-thumb { background: linear-gradient(135deg, #7f8c8d, #95a5a6); color: #fff; }
.media-thumb i {
  font-size: 36px;
  opacity: 0.9;
}
.media-thumb-label {
  font-size: var(--font-size-caption2);
  opacity: 0.8;
}
.file-info {
  padding: 8px;
}
.file-name {
  display: block;
  font-size: var(--font-size-caption2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-size {
  font-size: var(--font-size-caption2);
  color: var(--text-color-secondary);
}
.file-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  color: #fff;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}
.file-card:active .file-delete { opacity: 1; }
.preview-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.9);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-img {
  max-width: 95%;
  max-height: 95%;
  object-fit: contain;
}
.preview-video {
  max-width: 95%;
  max-height: 95%;
}
.preview-audio-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}
.audio-icon {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8e44ad, #9b59b6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 40px;
}
.preview-audio-wrap audio {
  width: 320px;
  max-width: 90vw;
}
.preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  color: #fff;
  border: none;
  font-size: 20px;
  cursor: pointer;
}
.upload-progress {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 100;
}
.upload-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--separator-color);
  border-top-color: var(--accent-resource, #5856D6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
