<template>
  <div class="resource-page">
    <AppNavBar title="资源仓库">
      <template slot="actions">
        <button class="nav-action-btn" @click="$router.push('/cloud')" title="我的云盘">
          <i class="fa-solid fa-cloud"></i>
        </button>
        <button class="nav-action-btn" @click="toggleSearch" title="搜索">
          <i class="fa-solid fa-magnifying-glass"></i>
        </button>
        <button class="nav-action-btn" @click="showHistory = !showHistory" title="历史记录">
          <i class="fa-solid fa-clock-rotate-left"></i>
        </button>
        <button v-if="isAdmin" class="nav-action-btn" @click="showCreateFolder = true" title="新建文件夹">
          <i class="fa-solid fa-folder-plus"></i>
        </button>
      </template>
    </AppNavBar>

    <div class="resource-body">
      <div v-if="searchActive" class="search-bar">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass search-icon"></i>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索文件或文件夹..."
            class="search-input"
            @keyup.enter="doSearch"
            ref="searchInput"
          />
          <select v-model="searchType" class="search-type-select">
            <option value="">全部类型</option>
            <option value="folder">文件夹</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="image">图片</option>
            <option value="document">文档</option>
            <option value="text">文本</option>
            <option value="archive">压缩包</option>
          </select>
          <button class="search-go-btn" @click="doSearch">搜索</button>
          <button class="search-close-btn" @click="closeSearch"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>

      <div class="breadcrumb-bar">
        <button class="breadcrumb-crumb" @click="navigateTo('')">
          <i class="fa-solid fa-house"></i>
        </button>
        <template v-for="(crumb, idx) in breadcrumbs" :key="'crumb-' + idx">
          <span class="breadcrumb-sep"><i class="fa-solid fa-chevron-right"></i></span>
          <button
            class="breadcrumb-crumb"
            :class="{ active: idx === breadcrumbs.length - 1 }"
            @click="navigateTo(crumb.path)"
          >{{ crumb.name }}</button>
        </template>
      </div>

      <div v-if="loading" class="loading-area">
        <div class="loading-spinner"></div>
        <span>加载中...</span>
      </div>

      <div v-else-if="error" class="error-area">
        <div class="error-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <p>{{ error }}</p>
        <button class="btn-primary" @click="loadFiles(currentPath)">重试</button>
      </div>

      <div v-else-if="searchResults !== null" class="file-list-area scrollbar-thin">
        <div class="search-header">
          <span>搜索结果：{{ searchResults.length }} 项</span>
          <button class="btn-text" @click="closeSearch">返回目录</button>
        </div>
        <div v-if="searchResults.length === 0" class="empty-state">
          <div class="empty-state-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
          <span class="empty-state-text">未找到匹配项</span>
        </div>
        <div v-else class="file-grid file-grid-search">
          <div
            v-for="(item, idx) in searchResults"
            :key="'sr-' + idx"
            class="file-item"
            @click="handleItemClick(item)"
          >
            <div class="file-icon" :class="item.fileType">
              <i :class="getIconClass(item)"></i>
            </div>
            <div class="file-info">
              <div class="file-name" :title="item.name">
                <span v-if="item.is_dir" class="folder-badge">文件夹</span>
                {{ item.name }}
              </div>
              <div class="file-meta">
                <span v-if="item.path" class="file-path">{{ item.path }}</span>
                <span v-else>{{ item.sizeFormatted }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="file-list-area scrollbar-thin">
        <div v-if="files.length === 0" class="empty-state">
          <div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div>
          <span class="empty-state-text">此目录为空</span>
        </div>
        <div v-else class="file-grid">
          <transition-group name="res-list" tag="div" class="file-grid-inner">
            <div
              v-for="(item, idx) in files"
              :key="item.name + '-' + idx"
              class="file-item"
              @click="handleItemClick(item)"
            >
              <div class="file-icon" :class="item.fileType">
                <i :class="getIconClass(item)"></i>
              </div>
              <div class="file-info">
                <div class="file-name" :title="item.name">{{ item.name }}</div>
                <div class="file-meta">
                  <span class="file-type-label" :class="item.fileType">{{ getTypeLabel(item) }}</span>
                  <span class="file-size">{{ item.sizeFormatted }}</span>
                  <span class="file-date">{{ formatDate(item.modified) }}</span>
                </div>
              </div>
              <div class="file-actions" @click.stop>
                <button v-if="!item.is_dir" class="action-icon-btn" @click="downloadFile(item)" title="下载">
                  <i class="fa-solid fa-download"></i>
                </button>
              </div>
            </div>
          </transition-group>
        </div>
      </div>
    </div>

    <transition name="slide-right">
      <div v-if="showHistory" class="history-panel">
        <div class="history-header">
          <h3><i class="fa-solid fa-clock-rotate-left"></i> 访问历史</h3>
          <button class="action-icon-btn" @click="showHistory = false"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div v-if="historyList.length === 0" class="empty-state" style="padding: 30px 10px;">
          <span class="empty-state-text">暂无历史记录</span>
        </div>
        <div v-else class="history-list scrollbar-thin">
          <div
            v-for="(h, idx) in historyList"
            :key="idx"
            class="history-item"
            @click="navigateTo(h.path)"
          >
            <div class="history-icon"><i class="fa-solid fa-folder"></i></div>
            <div class="history-info">
              <div class="history-name">{{ h.name || '根目录' }}</div>
              <div class="history-path">{{ h.path || '/' }}</div>
            </div>
            <div class="history-count">{{ h.count }}次</div>
          </div>
        </div>
        <div class="history-footer">
          <button class="btn-secondary" style="width:100%" @click="clearHistory">清除历史</button>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="previewVisible && previewType !== 'html'" class="preview-overlay">
        <!-- 视频预览：全屏无标题栏 -->
        <template v-if="previewType === 'video'">
          <div class="video-fullscreen-wrap">
            <button class="video-back-btn" @click="closePreview" title="返回"><i class="fa-solid fa-arrow-left"></i></button>
            <div v-if="previewLoading" class="loading-area">
              <div class="loading-spinner"></div>
              <span>加载预览...</span>
            </div>
            <div v-else ref="videoContainer" class="video-js-container"></div>
          </div>
        </template>
        <!-- 非视频预览 -->
        <template v-else>
          <div class="preview-fullscreen-panel">
            <div class="preview-header">
              <span class="preview-title">{{ previewItem ? previewItem.name : '' }}</span>
              <div class="preview-actions">
                <button v-if="previewType === 'image'" class="action-icon-btn" @click="zoomIn" title="放大"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <button v-if="previewType === 'image'" class="action-icon-btn" @click="zoomOut" title="缩小"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                <button v-if="previewType === 'image'" class="action-icon-btn" @click="rotateImage" title="旋转"><i class="fa-solid fa-rotate-right"></i></button>
                <button v-if="previewType === 'image'" class="action-icon-btn" @click="resetImageTransform" title="重置"><i class="fa-solid fa-expand"></i></button>
                <button class="action-icon-btn" @click="downloadFile(previewItem)" title="下载"><i class="fa-solid fa-download"></i></button>
                <button class="action-icon-btn" @click="closePreview" title="关闭"><i class="fa-solid fa-xmark"></i></button>
              </div>
            </div>
            <div class="preview-body" ref="previewBody">
              <div v-if="previewLoading" class="loading-area">
                <div class="loading-spinner"></div>
                <span>加载预览...</span>
              </div>
              <template v-else>
                <div v-if="previewType === 'image'" class="preview-image-wrap" @wheel.prevent="onImageWheel">
                  <img :src="previewUrl" class="preview-img" :style="imageTransformStyle" @mousedown="startImageDrag" />
                </div>
                <div v-else-if="previewType === 'audio'" class="preview-audio-wrap">
                  <div class="audio-visual"><i class="fa-solid fa-music"></i></div>
                  <div class="audio-info">{{ previewItem ? previewItem.name : '' }}</div>
                  <audio :src="previewUrl" controls class="preview-audio" preload="metadata"></audio>
                </div>
                <div v-else-if="previewType === 'markdown'" class="preview-markdown" v-html="previewMarkdownHtml"></div>
                <div v-else-if="previewType === 'text'" class="preview-text"><pre>{{ previewTextContent }}</pre></div>
                <div v-else class="preview-unsupported">
                  <i class="fa-solid fa-file-circle-question"></i>
                  <p>此文件类型暂不支持预览</p>
                  <button class="btn-primary" @click="downloadFile(previewItem)">下载文件</button>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showCreateFolder" class="modal-overlay" @click.self="showCreateFolder = false">
        <div class="modal-card">
          <h3 class="modal-title">新建文件夹</h3>
          <input v-model="newFolderName" type="text" placeholder="文件夹名称" class="modal-input" @keyup.enter="createFolder" />
          <div class="modal-actions">
            <button class="btn-secondary" @click="showCreateFolder = false">取消</button>
            <button class="btn-primary" @click="createFolder">创建</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';
import { marked } from 'marked';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import 'videojs-mobile-ui/dist/videojs-mobile-ui.css';
import 'videojs-mobile-ui';
import '@videojs/http-streaming';

var HISTORY_KEY = 'resource_visit_history';

function loadHistory() {
  try {
    var raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {}
}

export default {
  name: 'Resource',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      currentPath: '',
      files: [],
      breadcrumbs: [],
      loading: false,
      error: '',
      searchActive: false,
      searchQuery: '',
      searchType: '',
      searchResults: null,
      previewVisible: false,
      previewItem: null,
      previewFilePath: '',
      previewType: '',
      previewUrl: '',
      previewTextContent: '',
      previewHtmlContent: '',
      previewMarkdownHtml: '',
      previewLoading: false,
      previewFullscreen: false,
      imageScale: 1,
      imageRotation: 0,
      imageOffsetX: 0,
      imageOffsetY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      dragOffsetX: 0,
      dragOffsetY: 0,
      showCreateFolder: false,
      newFolderName: '',
      showHistory: false,
      historyList: loadHistory(),
      _videoPlayer: null,
      _mkvFallbackUrl: null
    };
  },
  computed: {
    isAdmin: function() {
      var user = this.$store.state.auth.user;
      if (!user) return false;
      return user.is_admin === 1;
    },
    imageTransformStyle: function() {
      return {
        transform: 'translate(' + this.imageOffsetX + 'px, ' + this.imageOffsetY + 'px) scale(' + this.imageScale + ') rotate(' + this.imageRotation + 'deg)',
        cursor: this.isDragging ? 'grabbing' : 'grab',
        transition: this.isDragging ? 'none' : 'transform 0.2s var(--ease-standard)'
      };
    }
  },
  mounted: function() {
    this.loadFiles('');
  },
  beforeDestroy: function() {
    if (this._dragMoveHandler) {
      document.removeEventListener('mousemove', this._dragMoveHandler);
      this._dragMoveHandler = null;
    }
    if (this._dragUpHandler) {
      document.removeEventListener('mouseup', this._dragUpHandler);
      this._dragUpHandler = null;
    }
    this._disposeVideoPlayer();
  },
  methods: {
    loadFiles: function(dirPath) {
      var self = this;
      self.loading = true;
      self.error = '';
      self.searchResults = null;
      self.currentPath = dirPath;
      api.get('/resources', { params: { path: dirPath } })
        .then(function(response) {
          var data = response.data.data;
          self.files = data.files || [];
          self.breadcrumbs = data.breadcrumbs || [];
          self.loading = false;
          self.recordVisit(dirPath);
        })
        .catch(function(err) {
          self.error = (err.response && err.response.data && err.response.data.message) || '加载失败';
          self.loading = false;
        });
    },
    navigateTo: function(dirPath) {
      this.searchResults = null;
      this.showHistory = false;
      this.loadFiles(dirPath);
    },
    handleItemClick: function(item) {
      if (item.is_dir) {
        var newPath = item.path || (this.currentPath ? this.currentPath + '/' + item.name : item.name);
        this.navigateTo(newPath);
      } else {
        var filePath = item.path || (this.currentPath ? this.currentPath + '/' + item.name : item.name);
        this.previewResource(item, filePath);
      }
    },
    getIconClass: function(item) {
      if (item.is_dir) return 'fa-solid fa-folder';
      var map = {
        video: 'fa-solid fa-film', image: 'fa-solid fa-image', audio: 'fa-solid fa-file-audio',
        document: 'fa-solid fa-file-pdf', text: 'fa-solid fa-file-code', archive: 'fa-solid fa-file-zipper',
        other: 'fa-solid fa-file'
      };
      return map[item.fileType] || 'fa-solid fa-file';
    },
    getTypeLabel: function(item) {
      if (item.is_dir) return '文件夹';
      var map = {
        video: '视频', image: '图片', audio: '音频',
        document: '文档', text: '文本', archive: '压缩包', other: '文件'
      };
      return map[item.fileType] || '文件';
    },
    formatDate: function(isoStr) {
      if (!isoStr) return '';
      var d = new Date(isoStr);
      var m = (d.getMonth() + 1).toString().padStart(2, '0');
      var day = d.getDate().toString().padStart(2, '0');
      var h = d.getHours().toString().padStart(2, '0');
      var min = d.getMinutes().toString().padStart(2, '0');
      return m + '-' + day + ' ' + h + ':' + min;
    },
    toggleSearch: function() {
      this.searchActive = !this.searchActive;
      if (this.searchActive) {
        var self = this;
        this.$nextTick(function() {
          if (self.$refs.searchInput) self.$refs.searchInput.focus();
        });
      }
    },
    closeSearch: function() {
      this.searchActive = false;
      this.searchQuery = '';
      this.searchType = '';
      this.searchResults = null;
    },
    doSearch: function() {
      var self = this;
      if (!self.searchQuery.trim()) return;
      self.loading = true;
      api.get('/resources/search', { params: { q: self.searchQuery, type: self.searchType, path: self.currentPath } })
        .then(function(response) {
          self.searchResults = response.data.data.results || [];
          self.loading = false;
        })
        .catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '搜索失败', type: 'error' });
          self.loading = false;
        });
    },
    previewResource: function(item, filePath) {
      var self = this;
      if (!filePath) {
        filePath = self.currentPath ? self.currentPath + '/' + item.name : item.name;
      }
      self.previewItem = item;
      self.previewFilePath = filePath;
      self.previewVisible = true;
      self.previewLoading = true;
      self.imageScale = 1;
      self.imageRotation = 0;
      self.imageOffsetX = 0;
      self.imageOffsetY = 0;
      self.previewMarkdownHtml = '';
      var ext = (item.extension || '').toLowerCase();
      if (ext === 'html' || ext === 'htm') {
        // HTML文件直接在当前页面跳转，不使用iframe
        var htmlUrl = '/api/resources/html-proxy?path=' + encodeURIComponent(filePath) + '&_t=' + Date.now() + (self.$store.state.auth.token ? '&token=' + encodeURIComponent(self.$store.state.auth.token) : '');
        window.location.href = htmlUrl;
        return;
      }
      if (ext === 'md' || ext === 'markdown') {
        api.get('/resources/preview', { params: { path: filePath } })
          .then(function(response) {
            var content = response.data.data.content || '';
            self.previewType = 'markdown';
            self.previewMarkdownHtml = DOMPurify.sanitize(marked(content, { breaks: true, gfm: true }));
            self.previewLoading = false;
          })
          .catch(function() {
            self.previewType = 'unsupported';
            self.previewLoading = false;
          });
        return;
      }
      var previewableTypes = ['image', 'video', 'audio', 'text'];
      if (previewableTypes.indexOf(item.fileType) === -1) {
        self.previewType = 'unsupported';
        self.previewLoading = false;
        return;
      }
      if (item.fileType === 'text') {
        api.get('/resources/preview', { params: { path: filePath } })
          .then(function(response) {
            self.previewType = 'text';
            self.previewTextContent = response.data.data.content || '';
            self.previewLoading = false;
          })
          .catch(function() {
            self.previewType = 'unsupported';
            self.previewLoading = false;
          });
      } else {
        self.previewType = item.fileType;
        self.previewUrl = '/api/resources/preview?path=' + encodeURIComponent(filePath) + '&_t=' + Date.now() + (self.$store.state.auth.token ? '&token=' + encodeURIComponent(self.$store.state.auth.token) : '');
        self.previewLoading = false;
        if (item.fileType === 'video') {
          self.$nextTick(function() { self._initVideoPlayer(); });
        }
      }
    },
    openPreview: function(item) {
      this.previewResource(item, null);
    },
    closePreview: function() {
      this._disposeVideoPlayer();
      this.previewVisible = false;
      this.previewItem = null;
      this.previewFilePath = '';
      this.previewType = '';
      this.previewUrl = '';
      this.previewTextContent = '';
      this.previewHtmlContent = '';
      this.previewMarkdownHtml = '';
      this.previewFullscreen = false;
    },
    zoomIn: function() { this.imageScale = Math.min(this.imageScale + 0.25, 5); },
    zoomOut: function() { this.imageScale = Math.max(this.imageScale - 0.25, 0.25); },
    rotateImage: function() { this.imageRotation = (this.imageRotation + 90) % 360; },
    resetImageTransform: function() { this.imageScale = 1; this.imageRotation = 0; this.imageOffsetX = 0; this.imageOffsetY = 0; },
    onImageWheel: function(e) {
      if (e.deltaY < 0) { this.imageScale = Math.min(this.imageScale + 0.1, 5); }
      else { this.imageScale = Math.max(this.imageScale - 0.1, 0.25); }
    },
    startImageDrag: function(e) {
      this.isDragging = true;
      this.dragStartX = e.clientX - this.imageOffsetX;
      this.dragStartY = e.clientY - this.imageOffsetY;
      var self = this;
      var onMove = function(ev) { self.imageOffsetX = ev.clientX - self.dragStartX; self.imageOffsetY = ev.clientY - self.dragStartY; };
      var onUp = function() { self.isDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); self._dragMoveHandler = null; self._dragUpHandler = null; };
      this._dragMoveHandler = onMove;
      this._dragUpHandler = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    downloadFile: function(item, filePath) {
      if (!item || item.is_dir) return;
      var self = this;
      if (!filePath) {
        filePath = self.currentPath ? self.currentPath + '/' + item.name : item.name;
      }
      var downloadUrl = '/api/resources/download?path=' + encodeURIComponent(filePath) + (self.$store.state.auth.token ? '&token=' + encodeURIComponent(self.$store.state.auth.token) : '');
      self.$store.commit('toast/SHOW_TOAST', { message: '正在下载...', type: 'info' });
      fetch(downloadUrl, { credentials: 'include' })
        .then(function(response) { if (!response.ok) throw new Error('下载失败'); return response.blob(); })
        .then(function(blob) {
          var url = window.URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = item.name;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          self.$store.commit('toast/SHOW_TOAST', { message: '下载完成', type: 'success' });
        })
        .catch(function() {
          // Fallback for WebView where blob download may fail: navigate directly
          window.location.href = downloadUrl;
          self.$store.commit('toast/SHOW_TOAST', { message: '正在下载...', type: 'info' });
        });
    },
    createFolder: function() {
      var self = this;
      if (!self.newFolderName.trim()) return;
      api.post('/resources/create-folder', { parent_path: self.currentPath, folder_name: self.newFolderName.trim() })
        .then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '创建成功', type: 'success' });
          self.showCreateFolder = false;
          self.newFolderName = '';
          self.loadFiles(self.currentPath);
        })
        .catch(function(err) {
          self.$store.commit('toast/SHOW_TOAST', { message: (err.response && err.response.data && err.response.data.message) || '创建失败', type: 'error' });
        });
    },
    recordVisit: function(dirPath) {
      var list = loadHistory();
      var name = dirPath ? dirPath.split('/').pop() : '根目录';
      if (dirPath === 'videos' || dirPath === 'music' || dirPath.startsWith('videos/') || dirPath.startsWith('music/')) {
        return;
      }
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].path === dirPath) {
          list[i].count = (list[i].count || 0) + 1;
          list[i].lastVisit = Date.now();
          list.splice(0, 0, list.splice(i, 1)[0]);
          found = true;
          break;
        }
      }
      if (!found) { list.unshift({ path: dirPath, name: name, count: 1, lastVisit: Date.now() }); }
      if (list.length > 50) list = list.slice(0, 50);
      saveHistory(list);
      this.historyList = list;
    },
    clearHistory: function() { localStorage.removeItem(HISTORY_KEY); this.historyList = []; },
    _initVideoPlayer: function() {
      var self = this;
      self._disposeVideoPlayer();
      var container = self.$refs.videoContainer;
      if (!container) return;
      container.innerHTML = '';

      var videoEl = document.createElement('video');
      videoEl.className = 'video-js vjs-default-skin vjs-big-play-centered';
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');
      videoEl.setAttribute('x5-playsinline', '');
      videoEl.setAttribute('x5-video-player-type', 'h5');
      videoEl.setAttribute('preload', 'metadata');
      videoEl.setAttribute('muted', '');
      container.appendChild(videoEl);

      // MKV → 需预转码为 MP4（运行 Resources/视频批量转码MKV.bat）
      // 其他格式 → 直链播放
      var extFromItem = (self.previewItem && self.previewItem.extension || '').toLowerCase();
      var extFromPath = (self.previewFilePath || '').toLowerCase();
      var isMkv = extFromItem === 'mkv' || extFromPath.endsWith('.mkv');
      var videoSrc, videoType;

      if (isMkv) {
        // 尝试同名 MP4，如果存在则播放
        var mp4Path = self.previewFilePath.replace(/\.mkv$/i, '.mp4');
        videoSrc = '/api/resources/preview?path=' + encodeURIComponent(mp4Path) + '&_t=' + Date.now();
        videoType = 'video/mp4';
        // 同时提供原始流媒体转码作为回退（需 server 端 ffmpeg + 硬件加速）
        self._mkvFallbackUrl = '/api/resources/stream?path=' + encodeURIComponent(self.previewFilePath) + '&_t=' + Date.now();
      } else {
        videoSrc = self.previewUrl;
        videoType = self._getVideoMimeType(self.previewItem);
        self._mkvFallbackUrl = null;
      }

      self._videoPlayer = videojs(videoEl, {
        controls: true,
        autoplay: false,
        muted: true,
        preload: 'metadata',
        fill: true,
        fluid: false,
        touchUi: true,
        playbackRates: [0.5, 1, 1.25, 1.5, 2],
        // VHS 配置：处理流式视频的超时和重试
        html5: {
          vhs: {
            // 允许足够长的时间等待 ffmpeg 生成数据
            segmentRequestTimeout: 30000,
            bandwidthVariance: 1.2,
            useBandwidthFromLocalStorage: false
          },
          // 原生 HLS 回退（Safari）
          nativeAudioTracks: false,
          nativeVideoTracks: false
        },
        controlBar: {
          children: [
            'playToggle',
            'volumePanel',
            'currentTimeDisplay',
            'timeDivider',
            'durationDisplay',
            'progressControl',
            'playbackRateMenuButton'
          ]
        },
        sources: [{ src: videoSrc, type: videoType }],
        userActions: { hotkeys: true }
      });
      // 移动端手势支持
      self._videoPlayer.mobileUi({
        fullscreen: {
          enterOnRotate: false,
          exitOnRotate: false,
          lockOnRotate: false,
          swipeToFullscreen: false,
          swipeFromFullscreen: false
        },
        touchControls: {
          seekSeconds: 10,
          tapTimeout: 300,
          disableOnEnd: false
        }
      });
      // MKV 文件：尝试同名 MP4 → 失败则回退到实时转码
      var mkvRetryCount = 0;
      self._videoPlayer.on('error', function() {
        var error = self._videoPlayer.error();
        // MKV 同名 MP4 不存在 → 自动回退到实时转码
        if (isMkv && self._mkvFallbackUrl && mkvRetryCount === 0 && error && error.code === 4) {
          mkvRetryCount++;
          console.log('[MKV] MP4 not found, trying stream fallback...');
          self._videoPlayer.src({ src: self._mkvFallbackUrl, type: 'video/mp4' });
          self._videoPlayer.play();
          return;
        }
        if (error && error.code === 2) {
          self.$store.commit('toast/SHOW_TOAST', {
            message: '网络错误：请检查服务器连接', type: 'error'
          });
        } else if (error && error.code === 4) {
          self.$store.commit('toast/SHOW_TOAST', {
            message: isMkv ? '此 MKV 未转码且实时转码失败。请在服务器运行"视频批量转码MKV.bat"转为 MP4 后播放。' : '视频格式不支持或文件已损坏',
            type: 'error'
          });
        } else {
          self.$store.commit('toast/SHOW_TOAST', {
            message: isMkv ? 'MKV 播放失败，请先转为 MP4' : '视频加载失败',
            type: 'error'
          });
        }
        console.error('[Video Error]', error);
      });
    },
    _disposeVideoPlayer: function() {
      if (this._videoPlayer) {
        try { this._videoPlayer.dispose(); } catch (e) {}
        this._videoPlayer = null;
      }
      // 清理容器中的残留 DOM 元素
      var container = this.$refs.videoContainer;
      if (container) {
        container.innerHTML = '';
      }
    },
    _getVideoMimeType: function(item) {
      if (!item) return 'video/mp4';
      var ext = (item.extension || '').toLowerCase();
      var map = {
        mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', ogv: 'video/ogg',
        m3u8: 'application/x-mpegURL', mov: 'video/mp4', mkv: 'video/x-matroska',
        avi: 'video/mp4', flv: 'video/x-flv', ts: 'video/mp2t'
      };
      return map[ext] || 'video/mp4';
    }
  }
};
</script>

<style scoped>
.resource-page { display: flex; flex-direction: column; height: 100%; background: var(--bg-color); position: relative; }
.resource-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.search-bar { padding: 12px 20px; background: var(--card-bg); border-bottom: 0.5px solid var(--separator-color); flex-shrink: 0; }
.search-input-wrap { display: flex; align-items: center; gap: 8px; background: var(--bg-color); border-radius: var(--radius-md); padding: 4px 12px; border: 1px solid var(--border-color); }
.search-icon { color: var(--text-tertiary); font-size: var(--font-size-sm); }
.search-input { flex: 1; border: none; background: none; padding: 8px 0; font-size: var(--font-size-base); color: var(--text-primary); outline: none; }
.search-type-select { border: none; background: var(--card-bg); padding: 6px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; }
.search-go-btn { padding: 6px 16px; background: var(--primary-color); color: #FFFFFF; border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
.search-close-btn { padding: 6px; color: var(--text-tertiary); font-size: var(--font-size-callout); }
.breadcrumb-bar { display: flex; align-items: center; gap: 4px; padding: 10px 20px; background: var(--card-bg); border-bottom: 0.5px solid var(--separator-color); flex-shrink: 0; overflow-x: auto; white-space: nowrap; }
.breadcrumb-crumb { padding: 4px 10px; border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-secondary); background: none; transition: background 0.15s, color 0.15s; min-height: 36px; display: flex; align-items: center; }
.breadcrumb-crumb:hover { background: var(--primary-light); color: var(--primary-color); }
.breadcrumb-crumb:active { transform: scale(0.92); opacity: 0.7; }
.breadcrumb-crumb.active { color: var(--primary-color); font-weight: var(--font-weight-semibold); }
.breadcrumb-sep { color: var(--text-tertiary); font-size: var(--font-size-caption2); display: flex; align-items: center; }
.loading-area { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 12px; color: var(--text-tertiary); }
.error-area { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 12px; color: var(--text-tertiary); }
.error-icon { font-size: 48px; color: var(--warning-color); }
.search-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; font-size: var(--font-size-sm); color: var(--text-secondary); border-bottom: 0.5px solid var(--separator-color); flex-shrink: 0; }
.btn-text { color: var(--primary-color); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.file-list-area { flex: 1; overflow-y: auto; padding: 8px; }
.file-grid { width: 100%; }
.file-grid-inner { width: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
.file-item { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: var(--radius-lg); background: var(--card-bg); cursor: pointer; transition: background 0.15s, box-shadow 0.15s; border: 1px solid transparent; }
.file-item:hover { background: var(--primary-lighter); border-color: var(--border-color); box-shadow: var(--shadow-sm); }
.file-item:active { background: var(--border-color); }
.file-icon { width: 42px; height: 42px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-subheadline); flex-shrink: 0; }
.file-icon.folder { background: rgba(var(--warning-rgb), 0.1); color: var(--warning-color); }
.file-icon.video { background: rgba(var(--danger-rgb), 0.1); color: var(--danger-color); }
.file-icon.image { background: rgba(var(--success-rgb), 0.1); color: var(--success-color); }
.file-icon.audio { background: rgba(var(--accent-ai-rgb), 0.1); color: var(--accent-ai); }
.file-icon.document { background: rgba(var(--danger-rgb), 0.1); color: var(--danger-color); }
.file-icon.text { background: rgba(var(--primary-rgb), 0.1); color: var(--primary-color); }
.file-icon.archive { background: rgba(var(--warning-rgb), 0.1); color: var(--warning-color); }
.file-icon.other { background: var(--primary-light); color: var(--primary-color); }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.folder-badge { font-size: var(--font-size-caption2); padding: 1px 6px; background: rgba(var(--warning-rgb), 0.15); color: var(--warning-color); border-radius: var(--radius-xs); font-weight: var(--font-weight-semibold); flex-shrink: 0; }
.file-meta { display: flex; align-items: center; gap: 10px; margin-top: 2px; font-size: var(--font-size-xs); color: var(--text-tertiary); }
.file-type-label { padding: 1px 6px; border-radius: var(--radius-xs); font-size: var(--font-size-caption2); background: var(--primary-lighter); }
.file-type-label.folder { background: rgba(var(--warning-rgb), 0.1); color: var(--warning-color); }
.file-type-label.video { background: rgba(var(--danger-rgb), 0.1); color: var(--danger-color); }
.file-type-label.image { background: rgba(var(--success-rgb), 0.1); color: var(--success-color); }
.file-type-label.audio { background: rgba(var(--accent-ai-rgb), 0.1); color: var(--accent-ai); }
.file-path { color: var(--text-tertiary); font-size: var(--font-size-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.file-item:hover .file-actions { opacity: 1; }
.action-icon-btn { width: 44px; height: 44px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-sm); color: var(--text-secondary); transition: background 0.15s, color 0.15s; }
.action-icon-btn:hover { background: var(--primary-light); color: var(--primary-color); }
.action-icon-btn:active { transform: scale(0.92); opacity: 0.7; }
.nav-action-btn { width: 44px; height: 44px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-callout); color: var(--primary-color); transition: background 0.15s; }
.nav-action-btn:hover { background: var(--primary-light); }
.nav-action-btn:active { transform: scale(0.92); opacity: 0.7; }
.preview-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.85); z-index: 1000; display: flex; align-items: stretch; justify-content: stretch; }
.preview-fullscreen-panel { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.preview-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 0.5px solid var(--separator-color); flex-shrink: 0; gap: 8px; background: var(--card-bg); }
.preview-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.preview-actions { display: flex; gap: 2px; flex-shrink: 0; }
.preview-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; min-height: 0; background: #000; }
.preview-body > .preview-markdown, .preview-body > .preview-text { align-self: stretch; }
.preview-image-wrap { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; -webkit-user-select: none; user-select: none; }
.preview-img { max-width: 100%; max-height: calc(100vh - 56px); object-fit: contain; pointer-events: auto; }
.video-fullscreen-wrap { width: 100%; height: 100%; position: relative; background: #000; display: flex; align-items: center; justify-content: center; }
.video-back-btn { position: absolute; top: 6px; left: 6px; z-index: 100; width: 44px; height: 44px; border-radius: 50%; background: rgba(0,0,0,0.5); color: #FFFFFF; font-size: var(--font-size-caption); display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; transition: background 0.2s; }
.video-back-btn:hover { background: rgba(0,0,0,0.7); }
.video-back-btn:active { transform: scale(0.92); opacity: 0.7; }
.video-js-container { width: 100%; height: 100%; background: #000; }
.video-js-container .video-js { width: 100% !important; height: 100% !important; outline: none !important; }
.video-js-container .video-js:focus, .video-js-container .video-js:focus-visible, .video-js-container .video-js:focus-within { outline: none !important; box-shadow: none !important; }
.video-js-container .vjs-control:focus, .video-js-container .vjs-control:focus-visible, .video-js-container .vjs-control:hover { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container .vjs-big-play-button:focus, .video-js-container .vjs-big-play-button:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
.video-js-container .vjs-slider:focus, .video-js-container .vjs-slider:focus-visible { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container .vjs-menu-item:focus, .video-js-container .vjs-menu-item:focus-visible { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container *:focus, .video-js-container *:focus-visible { outline: none !important; box-shadow: none !important; -webkit-tap-highlight-color: transparent !important; }
.video-js-container .vjs-big-play-button { width: 1.8em; height: 1.8em; border-radius: 50%; line-height: 1.8em; border: none; background: rgba(0,0,0,0.6); }
.video-js-container .vjs-control-bar { font-size: var(--font-size-caption2); }
.video-js-container .vjs-volume-panel { width: 6em; }
.video-js-container .vjs-playback-rate { font-size: var(--font-size-caption2); min-width: 2.5em; }
.preview-audio-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px; width: 100%; background: var(--card-bg); }
.audio-visual { width: 100px; height: 100px; border-radius: 50%; background: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 36px; color: #FFFFFF; animation: audioPulse 2s ease-in-out infinite; }
@keyframes audioPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.audio-info { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); color: var(--text-primary); text-align: center; word-break: break-all; }
.preview-audio { width: 100%; max-width: 500px; }
.preview-text { width: 100%; height: 100%; padding: 24px; overflow: auto; background: var(--card-bg); }
.preview-text pre { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: var(--font-size-sm); line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: var(--text-primary); }
.preview-markdown { width: 100%; height: 100%; padding: 32px 40px; overflow: auto; background: var(--card-bg); color: var(--text-primary); line-height: 1.7; font-size: var(--font-size-body); }
.preview-markdown >>> h1 { font-size: 1.8em; margin: 0.8em 0 0.4em; border-bottom: 0.5px solid var(--separator-color); padding-bottom: 0.3em; }
.preview-markdown >>> h2 { font-size: 1.5em; margin: 0.8em 0 0.4em; border-bottom: 0.5px solid var(--separator-color); padding-bottom: 0.3em; }
.preview-markdown >>> h3 { font-size: 1.25em; margin: 0.8em 0 0.4em; }
.preview-markdown >>> h4 { font-size: 1.1em; margin: 0.6em 0 0.3em; }
.preview-markdown >>> p { margin: 0.6em 0; }
.preview-markdown >>> ul, .preview-markdown >>> ol { padding-left: 2em; margin: 0.5em 0; }
.preview-markdown >>> li { margin: 0.2em 0; }
.preview-markdown >>> code { background: var(--bg-color); padding: 2px 6px; border-radius: var(--radius-xs); font-size: 0.9em; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }
.preview-markdown >>> pre { background: var(--bg-color); padding: 16px; border-radius: var(--radius-sm); overflow-x: auto; margin: 0.8em 0; line-height: 1.5; }
.preview-markdown >>> pre code { background: none; padding: 0; display: block; white-space: pre; word-break: normal; word-wrap: normal; overflow-x: auto; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.9em; line-height: 1.5; }
.preview-markdown >>> blockquote { border-left: 4px solid var(--primary-color); padding: 0.5em 1em; margin: 0.8em 0; background: var(--primary-lighter); border-radius: 0 var(--radius-xs) var(--radius-xs) 0; }
.preview-markdown >>> table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
.preview-markdown >>> th, .preview-markdown >>> td { border: 1px solid var(--border-color); padding: 8px 12px; text-align: left; }
.preview-markdown >>> th { background: var(--bg-color); font-weight: var(--font-weight-semibold); }
.preview-markdown >>> img { max-width: 100%; border-radius: var(--radius-sm); }
.preview-markdown >>> a { color: var(--primary-color); text-decoration: none; }
.preview-markdown >>> a:hover { text-decoration: underline; }
.preview-markdown >>> hr { border: none; border-top: 0.5px solid var(--separator-color); margin: 1.5em 0; }
.preview-unsupported { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px; color: var(--text-tertiary); background: var(--card-bg); }
.preview-unsupported i { font-size: 48px; opacity: 0.4; }
.history-panel { position: fixed; top: 52px; right: 0; width: 320px; height: calc(100% - 52px); background: var(--sidebar-bg); border-left: 0.5px solid var(--separator-color); z-index: 900; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); backdrop-filter: var(--glass-blur-container); -webkit-backdrop-filter: var(--glass-blur-container); }
.history-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 0.5px solid var(--separator-color); }
.history-header h3 { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); display: flex; align-items: center; gap: 8px; color: var(--text-primary); }
.history-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.history-item { display: flex; align-items: center; gap: 12px; padding: 10px 20px; cursor: pointer; transition: background 0.15s; min-height: 44px; }
.history-item:hover { background: var(--primary-lighter); }
.history-item:active { background: var(--border-color); }
.history-icon { width: 32px; height: 32px; border-radius: var(--radius-sm); background: rgba(var(--warning-rgb), 0.1); color: var(--warning-color); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-sm); flex-shrink: 0; }
.history-info { flex: 1; min-width: 0; }
.history-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-path { font-size: var(--font-size-xs); color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-count { font-size: var(--font-size-xs); color: var(--text-tertiary); padding: 2px 8px; background: var(--primary-lighter); border-radius: var(--radius-md); flex-shrink: 0; }
.history-footer { padding: 12px 20px; border-top: 0.5px solid var(--separator-color); }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.4); z-index: 1001; display: flex; align-items: center; justify-content: center; }
.modal-card { background: var(--card-bg); border-radius: var(--radius-lg); padding: 24px; width: 380px; max-width: 90vw; box-shadow: var(--shadow-lg); }
.modal-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin-bottom: 16px; color: var(--text-primary); }
.modal-input { width: 100%; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: var(--font-size-base); background: var(--bg-color); color: var(--text-primary); margin-bottom: 16px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
.res-list-enter-active { transition: opacity 0.25s var(--ease-standard), transform 0.25s var(--ease-standard); }
.res-list-enter { opacity: 0; transform: translateY(8px); }
.res-list-leave-active { transition: opacity 0.15s var(--ease-standard); }
.res-list-leave-to { opacity: 0; }
.slide-right-enter-active, .slide-right-leave-active { transition: transform 0.25s var(--ease-standard); }
.slide-right-enter, .slide-right-leave-to { transform: translateX(100%); }
@media (max-width: 768px) {
  .search-input-wrap { flex-wrap: wrap; }
  .search-type-select { width: 100%; }
  .search-go-btn { width: 100%; }
  .file-item { padding: 10px 14px; }
  .file-meta { flex-wrap: wrap; gap: 6px; }
  .preview-markdown { padding: 20px 16px; }
  .history-panel { width: 100%; }
}
.file-grid-search { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
@media (min-width: 1024px) and (orientation: landscape) {
  .file-grid-inner { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .file-grid-search { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .file-item { padding: 10px 14px; gap: 10px; }
  .file-icon { width: 38px; height: 38px; font-size: var(--font-size-callout); border-radius: var(--radius-sm); }
  .file-name { font-size: var(--font-size-sm); }
  .file-meta { font-size: var(--font-size-caption2); gap: 6px; }
  .breadcrumb-bar { padding: 8px 16px; }
  .search-bar { padding: 8px 16px; }
  .history-panel { width: 280px; }
}
/* 960×600 / 2x DPR 横屏平板适配 */
@media (max-height: 400px), (max-width: 520px) {
  .preview-header { padding: 6px 12px; }
  .preview-title { font-size: var(--font-size-caption); }
  .action-icon-btn { width: 28px; height: 28px; font-size: var(--font-size-caption); }
  .video-back-btn { top: 4px; left: 4px; width: 26px; height: 26px; font-size: var(--font-size-caption2); }
  .video-js-container .vjs-control-bar { font-size: 8px; }
  .video-js-container .vjs-big-play-button { width: 1.4em; height: 1.4em; line-height: 1.4em; }
  .video-js-container .vjs-volume-panel { width: 4em; }
  .video-js-container .vjs-playback-rate { font-size: 8px; min-width: 2em; }
  .video-js-container .vjs-time-control { font-size: 8px; padding: 0 2px; min-width: auto; }
  .video-js-container .vjs-progress-control { height: 2em; }
}
</style>

<style>
/* 非 scoped：确保 video.js 动态创建的 DOM 元素也能匹配（Chrome 80 等旧浏览器不支持 :focus-visible） */
.video-js-container .video-js { outline: none !important; }
.video-js-container .video-js:focus,
.video-js-container .video-js:focus-visible,
.video-js-container .video-js:focus-within { outline: none !important; box-shadow: none !important; }
.video-js-container .video-js video { outline: none !important; }
.video-js-container .video-js video:focus,
.video-js-container .video-js video:focus-visible { outline: none !important; box-shadow: none !important; }
.video-js-container .vjs-control:focus,
.video-js-container .vjs-control:focus-visible,
.video-js-container .vjs-control:hover { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container .vjs-big-play-button:focus,
.video-js-container .vjs-big-play-button:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
.video-js-container .vjs-slider:focus,
.video-js-container .vjs-slider:focus-visible { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container .vjs-menu-item:focus,
.video-js-container .vjs-menu-item:focus-visible { outline: none !important; box-shadow: none !important; text-shadow: none !important; }
.video-js-container *:focus,
.video-js-container *:focus-visible { outline: none !important; box-shadow: none !important; -webkit-tap-highlight-color: transparent !important; }
</style>
