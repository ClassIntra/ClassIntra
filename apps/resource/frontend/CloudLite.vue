<template>
  <div class="cloud-lite">
    <!-- 顶栏（禁用 backdrop-filter：X5/旧内核锁屏后合成层丢失会黑屏） -->
    <div class="lite-header">
      <div class="lite-title">
        <i class="fa-solid fa-cloud"></i>
        <span>云盘 · 上传下载</span>
      </div>
      <div class="lite-header-actions">
        <button v-if="isLoggedIn" class="lite-logout" @click="refreshList" title="刷新">
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }"></i>
        </button>
        <button v-if="isLoggedIn" class="lite-logout" @click="logout">退出</button>
      </div>
    </div>

    <!-- 未登录：内嵌登录卡片 -->
    <div v-if="!isLoggedIn" class="login-card">
      <i class="fa-solid fa-user login-icon"></i>
      <h3>登录你的账号</h3>
      <p class="login-desc">登录后即可上传文件到自己的云盘，或下载云盘中的文件</p>
      <input
        v-model.trim="account"
        type="text"
        class="lite-input"
        placeholder="账号"
        autocomplete="username"
      />
      <input
        v-model="password"
        type="password"
        class="lite-input"
        placeholder="密码"
        autocomplete="current-password"
        @keyup.enter="login"
      />
      <div v-if="loginError" class="lite-error">{{ loginError }}</div>
      <button class="lite-btn primary" :disabled="loginLoading || !account || !password" @click="login">
        <span v-if="loginLoading" class="btn-loading"></span>
        <span v-else>登 录</span>
      </button>
    </div>

    <!-- 已登录：上传 + 队列 + 文件列表 -->
    <template v-else>
      <!-- 上传区 -->
      <div class="upload-card" @click="triggerUpload">
        <input ref="fileInput" type="file" accept="image/*,audio/*,video/*" multiple style="display:none" @change="onFileSelect" />
        <i class="fa-solid fa-cloud-arrow-up upload-icon"></i>
        <p class="upload-text">{{ queueRunning ? '上传中 ' + doneCount + '/' + queue.length : '点击选择图片 / 音频 / 视频' }}</p>
        <p class="upload-sub">{{ queueRunning ? '可以锁屏休息一下，中断的文件可一键重试' : '可一次选择多个文件' }}</p>
      </div>

      <!-- 上传队列 -->
      <div v-if="queue.length > 0" class="queue-card">
        <div class="queue-head">
          <span class="queue-title">上传列表</span>
          <button v-if="failedCount > 0 && !queueRunning" class="queue-clear" @click="retryAllFailed">
            <i class="fa-solid fa-rotate-right"></i> 全部重试
          </button>
          <button v-if="finishedCount > 0 && !queueRunning" class="queue-clear" @click="clearFinished">清空已完成</button>
        </div>
        <div v-for="item in queue" :key="item.id" class="queue-item">
          <div class="queue-thumb">
            <img v-if="item.preview" :src="item.preview" :alt="item.name" />
            <i v-else class="fa-solid fa-file"></i>
          </div>
          <div class="queue-info">
            <span class="queue-name">{{ item.name }}</span>
            <div v-if="item.status === 'uploading' || item.status === 'done'" class="progress-track">
              <div class="progress-fill" :class="{ full: item.status === 'done' }" :style="{ width: (item.status === 'done' ? 100 : item.progress) + '%' }"></div>
            </div>
            <span class="queue-status" :class="item.status">
              {{ statusText(item) }}
            </span>
          </div>
          <button v-if="item.status === 'failed'" class="queue-retry" @click="retryItem(item)">
            <i class="fa-solid fa-rotate-right"></i> 重试
          </button>
          <i v-else-if="item.status === 'done'" class="fa-solid fa-circle-check queue-done-icon"></i>
        </div>
      </div>

      <!-- 文件列表 -->
      <div v-if="loading && files.length === 0" class="lite-list">
        <div v-for="n in 4" :key="'sk' + n" class="lite-item skeleton">
          <div class="lite-thumb skeleton-pulse"></div>
          <div class="lite-info">
            <div class="sk-line skeleton-pulse"></div>
            <div class="sk-line short skeleton-pulse"></div>
          </div>
        </div>
      </div>
      <div v-else-if="files.length === 0" class="lite-empty">
        <i class="fa-solid fa-folder-open"></i>
        <p>云盘还是空的，先上传一个文件吧</p>
      </div>
      <template v-else>
        <!-- 类型筛选 -->
        <div class="filter-bar">
          <button v-for="f in filters" :key="f.key" class="filter-chip" :class="{ active: activeFilter === f.key }" @click="activeFilter = f.key">
            {{ f.label }} <span class="filter-count">{{ countByType(f.key) }}</span>
          </button>
        </div>
        <div class="lite-list">
          <div v-for="file in filteredFiles" :key="file.hash" class="lite-item">
            <div class="lite-thumb" @click="openViewer(file)">
              <img v-if="getMediaType(file) === 'image'" :src="file.url + '?w=200'" loading="lazy" :alt="file.name" />
              <i v-else-if="getMediaType(file) === 'video'" class="fa-solid fa-circle-play"></i>
              <i v-else-if="getMediaType(file) === 'audio'" class="fa-solid fa-music"></i>
              <i v-else class="fa-solid fa-file"></i>
            </div>
            <div class="lite-info" @click="openViewer(file)">
              <span class="lite-name">{{ file.display_name || file.name }}</span>
              <span class="lite-meta">{{ formatSize(file.size) }} · {{ formatTime(file.uploaded_at) }}</span>
            </div>
            <button
              class="lite-download"
              :class="{ downloading: downloads[file.hash] }"
              :disabled="!!downloads[file.hash]"
              @click="downloadFile(file)"
              :title="downloads[file.hash] ? '下载中 ' + downloads[file.hash] + '%' : '下载'"
            >
              <i v-if="downloads[file.hash]" class="fa-solid fa-spinner fa-spin"></i>
              <span v-else-if="downloads[file.hash] === 0"></span>
              <i v-else class="fa-solid fa-download"></i>
              <em v-if="downloads[file.hash]">{{ downloads[file.hash] }}%</em>
            </button>
            <button class="lite-delete" @click="deleteFile(file)" title="删除">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- 查看器：大图 / 视频 / 音频 -->
    <div v-if="viewer.open" class="viewer" @touchstart="viewerTouchStart" @touchend="viewerTouchEnd">
      <div class="viewer-top">
        <span class="viewer-count" v-if="viewerImages.length > 1">{{ viewer.index + 1 }} / {{ viewerImages.length }}</span>
        <div class="viewer-top-actions">
          <button class="viewer-btn" @click="downloadFile(viewerImages[viewer.index])" title="下载">
            <i class="fa-solid fa-download"></i>
          </button>
          <button class="viewer-btn" @click="closeViewer" title="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div class="viewer-stage">
        <button v-if="viewerImages.length > 1" class="viewer-nav prev" @click.stop="viewerStep(-1)">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <img
          class="viewer-img"
          :src="viewerImages[viewer.index].url + '?w=1200'"
          :alt="viewerImages[viewer.index].name"
          @click.stop
        />
        <button v-if="viewerImages.length > 1" class="viewer-nav next" @click.stop="viewerStep(1)">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
      <p class="viewer-name">{{ viewerImages[viewer.index].display_name || viewerImages[viewer.index].name }}</p>
    </div>

    <!-- 查看器：视频 / 音频播放 -->
    <div v-if="mediaOverlay.open" class="viewer">
      <div class="viewer-top">
        <div class="viewer-top-actions">
          <button class="viewer-btn" @click="closeMedia" title="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div class="viewer-stage media-stage">
        <video
          v-if="mediaOverlay.type === 'video'"
          class="viewer-video"
          :src="mediaOverlay.file.url"
          controls
          playsinline
          autoplay
        ></video>
        <div v-else class="audio-panel">
          <i class="fa-solid fa-music audio-icon"></i>
          <p class="audio-name">{{ mediaOverlay.file.display_name || mediaOverlay.file.name }}</p>
          <audio class="viewer-audio" :src="mediaOverlay.file.url" controls autoplay></audio>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <transition name="toast-fade">
      <div v-if="toastMsg" class="lite-toast">{{ toastMsg }}</div>
    </transition>
  </div>
</template>

<script>
import api from '@/utils/api';

var IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
var VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
var AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];

function getMediaType(file) {
  if (!file) return 'other';
  if (file.mime_type) {
    if (file.mime_type.indexOf('image/') === 0) return 'image';
    if (file.mime_type.indexOf('video/') === 0) return 'video';
    if (file.mime_type.indexOf('audio/') === 0) return 'audio';
  }
  var name = file.name || file.display_name || '';
  var idx = name.lastIndexOf('.');
  var ext = idx > -1 ? name.substring(idx).toLowerCase() : '';
  if (IMAGE_EXTS.indexOf(ext) > -1) return 'image';
  if (VIDEO_EXTS.indexOf(ext) > -1) return 'video';
  if (AUDIO_EXTS.indexOf(ext) > -1) return 'audio';
  return 'other';
}

// 锁屏/切后台后浏览器可能冻结或杀掉上传中的请求：
// 可见时若某文件超过该时长无进度事件，判定为中断，标记失败等待重试
var STALL_TIMEOUT = 30000;

export default {
  name: 'CloudLite',
  data: function() {
    return {
      account: '',
      password: '',
      loginLoading: false,
      loginError: '',
      files: [],
      loading: false,
      activeFilter: 'all',
      filters: [
        { key: 'all', label: '全部' },
        { key: 'image', label: '图片' },
        { key: 'video', label: '视频' },
        { key: 'audio', label: '音频' },
        { key: 'other', label: '其他' }
      ],
      // 上传队列
      queue: [],
      queueSeq: 0,
      pumping: false,
      lastProgressAt: 0,
      // 下载进度 { hash: percent }
      downloads: {},
      // 图片查看器 / 媒体播放
      viewer: { open: false, index: 0 },
      mediaOverlay: { open: false, file: null, type: '' },
      toastMsg: '',
      toastTimer: null
    };
  },
  computed: {
    isLoggedIn: function() {
      return !!(this.$store.state.auth.token);
    },
    queueRunning: function() {
      return this.queue.some(function(q) { return q.status === 'waiting' || q.status === 'uploading'; });
    },
    doneCount: function() {
      return this.queue.filter(function(q) { return q.status === 'done'; }).length;
    },
    finishedCount: function() {
      return this.queue.filter(function(q) { return q.status === 'done' || q.status === 'failed'; }).length;
    },
    failedCount: function() {
      return this.queue.filter(function(q) { return q.status === 'failed'; }).length;
    },
    filteredFiles: function() {
      var self = this;
      if (self.activeFilter === 'all') return self.files;
      return self.files.filter(function(f) { return getMediaType(f) === self.activeFilter; });
    },
    viewerImages: function() {
      return this.files.filter(function(f) { return getMediaType(f) === 'image'; });
    }
  },
  mounted: function() {
    this._onVisibility = this.onVisibility.bind(this);
    document.addEventListener('visibilitychange', this._onVisibility);
    if (this.isLoggedIn) {
      var user = this.$store.state.auth.user;
      if (user && user.account) this.account = user.account;
      this.loadFiles();
    }
  },
  beforeDestroy: function() {
    document.removeEventListener('visibilitychange', this._onVisibility);
    var self = this;
    self.queue.forEach(function(q) { if (q.preview) URL.revokeObjectURL(q.preview); });
  },
  methods: {
    getMediaType: getMediaType,
    showToast: function(msg) {
      var self = this;
      self.toastMsg = msg;
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function() { self.toastMsg = ''; }, 2400);
    },

    // ====== 锁屏/切后台自愈 ======
    onVisibility: function() {
      if (document.visibilityState !== 'visible') return;
      var self = this;
      // 1) 强制重绘：X5/旧内核锁屏后 GPU 合成层可能丢失导致黑屏
      var body = document.body;
      body.style.visibility = 'hidden';
      setTimeout(function() { body.style.visibility = ''; }, 60);
      // 2) 上传看门狗：长时间无进度的"上传中"文件判定为中断
      var stuck = null;
      self.queue.forEach(function(q) {
        if (q.status === 'uploading' && Date.now() - self.lastProgressAt > STALL_TIMEOUT) {
          stuck = q;
        }
      });
      if (stuck) {
        stuck.status = 'failed';
        stuck.error = '锁屏中断，请重试';
        stuck.progress = 0;
        self.pumping = false;
        self.showToast('检测到上传中断，可点击重试');
        setTimeout(function() { self.pump(); }, 300);
      }
    },

    // ====== 上传队列 ======
    triggerUpload: function() {
      if (!this.queueRunning) this.$refs.fileInput.click();
    },
    onFileSelect: function(e) {
      var self = this;
      var list = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (list.length === 0) return;
      list.forEach(function(f) {
        var isImage = getMediaType({ name: f.name, mime_type: f.type }) === 'image';
        self.queue.push({
          id: ++self.queueSeq,
          name: f.name,
          size: f.size,
          file: f,
          status: 'waiting',
          progress: 0,
          speed: '',
          error: '',
          preview: isImage ? URL.createObjectURL(f) : null,
          _lastLoaded: 0,
          _lastTime: 0
        });
      });
      self.pump();
    },
    pump: function() {
      var self = this;
      if (self.pumping) return;
      var item = null;
      self.queue.forEach(function(q) {
        if (!item && q.status === 'waiting') item = q;
      });
      if (!item) {
        // 队列跑完：汇总 + 刷新列表
        if (self.queue.length > 0) {
          var ok = self.queue.filter(function(q) { return q.status === 'done'; }).length;
          var fail = self.queue.filter(function(q) { return q.status === 'failed'; }).length;
          if (ok + fail > 0 && self.queue.every(function(q) { return q.status === 'done' || q.status === 'failed'; })) {
            self.showToast(fail > 0 ? ok + ' 个成功，' + fail + ' 个失败' : '全部上传完成');
          }
        }
        self.loadFiles();
        return;
      }
      item.status = 'uploading';
      item.progress = 0;
      item.speed = '';
      item.error = '';
      item._lastLoaded = 0;
      item._lastTime = Date.now();
      self.pumping = true;
      self.lastProgressAt = Date.now();

      var fd = new FormData();
      fd.append('file', item.file, item.name);
      fd.append('source', 'lite');
      api.post('/cloud/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: function(evt) {
          var now = Date.now();
          self.lastProgressAt = now;
          if (evt.total) item.progress = Math.round((evt.loaded / evt.total) * 100);
          // 瞬时速度（1 秒窗口平滑）
          var dt = now - item._lastTime;
          if (dt > 800 && evt.loaded > item._lastLoaded) {
            var bps = (evt.loaded - item._lastLoaded) / (dt / 1000);
            item.speed = self.formatSize(Math.round(bps)) + '/s';
            item._lastLoaded = evt.loaded;
            item._lastTime = now;
          }
        }
      }).then(function() {
        item.status = 'done';
        item.progress = 100;
        item.speed = '';
        if (item.preview) { URL.revokeObjectURL(item.preview); item.preview = null; }
      }).catch(function(err) {
        item.status = 'failed';
        item.progress = 0;
        item.speed = '';
        item.error = (err.response && err.response.data && err.response.data.message) || '上传失败';
        if (err.response && err.response.status === 401) {
          self.showToast('登录已过期，请重新登录');
        }
      }).then(function() {
        self.pumping = false;
        self.pump();
      });
    },
    statusText: function(item) {
      if (item.status === 'waiting') return '等待上传';
      if (item.status === 'uploading') return '上传中 ' + item.progress + '%' + (item.speed ? ' · ' + item.speed : '');
      if (item.status === 'done') return '已完成';
      return item.error || '上传失败';
    },
    retryItem: function(item) {
      if (item.status !== 'failed') return;
      item.status = 'waiting';
      item.error = '';
      this.pump();
    },
    retryAllFailed: function() {
      var self = this;
      self.queue.forEach(function(q) {
        if (q.status === 'failed') {
          q.status = 'waiting';
          q.error = '';
        }
      });
      self.pump();
    },
    clearFinished: function() {
      var self = this;
      self.queue.forEach(function(q) {
        if ((q.status === 'done' || q.status === 'failed') && q.preview) {
          URL.revokeObjectURL(q.preview);
          q.preview = null;
        }
      });
      self.queue = self.queue.filter(function(q) { return q.status === 'waiting' || q.status === 'uploading'; });
    },

    // ====== 查看器 ======
    countByType: function(key) {
      if (key === 'all') return this.files.length;
      var n = 0;
      this.files.forEach(function(f) { if (getMediaType(f) === key) n++; });
      return n;
    },
    openViewer: function(file) {
      var type = getMediaType(file);
      if (type === 'image') {
        var idx = -1;
        this.viewerImages.forEach(function(f, i) { if (f.hash === file.hash) idx = i; });
        if (idx === -1) idx = 0;
        this.viewer = { open: true, index: idx };
      } else if (type === 'video' || type === 'audio') {
        this.mediaOverlay = { open: true, file: file, type: type };
      }
    },
    closeViewer: function() {
      this.viewer = { open: false, index: 0 };
    },
    closeMedia: function() {
      this.mediaOverlay = { open: false, file: null, type: '' };
    },
    viewerStep: function(delta) {
      var len = this.viewerImages.length;
      if (len === 0) return;
      this.viewer.index = (this.viewer.index + delta + len) % len;
    },
    viewerTouchStart: function(e) {
      this._touchX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
    },
    viewerTouchEnd: function(e) {
      if (!this.viewer.open || this.viewerImages.length < 2) return;
      var endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
      var dx = endX - (this._touchX || 0);
      if (dx > 60) this.viewerStep(-1);
      else if (dx < -60) this.viewerStep(1);
    },

    // ====== 文件列表 ======
    refreshList: function() {
      if (this.loading) return;
      this.loadFiles();
    },
    loadFiles: function() {
      var self = this;
      self.loading = true;
      api.get('/cloud/files').then(function(res) {
        self.files = (res.data.data && res.data.data.files) || [];
        self.loading = false;
      }).catch(function() {
        self.loading = false;
      });
    },
    deleteFile: function(file) {
      var self = this;
      var name = file.display_name || file.name;
      if (!confirm('确定删除「' + name + '」？删除后无法恢复。')) return;
      api.delete('/cloud/files/' + encodeURIComponent(file.hash)).then(function(res) {
        if (res.data.code === 200) {
          self.showToast('已删除：' + name);
          self.loadFiles();
        }
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '删除失败';
        self.showToast(msg);
      });
    },

    // ====== 下载（带进度） ======
    downloadFile: function(file) {
      var self = this;
      var key = file.hash;
      if (self.downloads[key] !== undefined) return;
      self.$set(self.downloads, key, 0);
      api.get('/cloud/files/' + encodeURIComponent(key), {
        responseType: 'blob',
        timeout: 0,
        onDownloadProgress: function(evt) {
          if (evt.total) self.$set(self.downloads, key, Math.round((evt.loaded / evt.total) * 100));
        }
      }).then(function(res) {
        var url = URL.createObjectURL(res.data);
        var a = document.createElement('a');
        a.href = url;
        a.download = file.display_name || file.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
        self.showToast('已下载：' + (file.display_name || file.name));
      }).catch(function() {
        self.showToast('下载失败');
      }).then(function() {
        setTimeout(function() { self.$delete(self.downloads, key); }, 600);
      });
    },

    // ====== 登录 ======
    login: function() {
      var self = this;
      if (!self.account || !self.password || self.loginLoading) return;
      self.loginLoading = true;
      self.loginError = '';
      self.$store.dispatch('auth/login', { account: self.account, password: self.password }).then(function() {
        try { localStorage.setItem('ci_last_account', self.account); } catch (e) {}
        self.password = '';
        self.loadFiles();
      }).catch(function(err) {
        self.loginError = (err.response && err.response.data && err.response.data.message) || err.message || '登录失败';
      }).then(function() {
        self.loginLoading = false;
      });
    },
    logout: function() {
      var self = this;
      self.$store.dispatch('auth/logout').then(function() {
        self.files = [];
        self.account = '';
      });
    },

    // ====== 格式化 ======
    formatSize: function(size) {
      if (!size && size !== 0) return '';
      if (size < 1024) return size + ' B';
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
      if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB';
      return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    },
    formatTime: function(s) {
      if (!s) return '';
      var d = new Date(s.indexOf('T') > -1 ? s : s.replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return s;
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
  }
};
</script>

<style scoped>
.cloud-lite {
  /* 页面自身作为滚动容器：主应用外壳锁了 body 滚动，依赖 body 滑动会整页滑不动 */
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  background: #f2f2f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  padding-bottom: 40px;
}
.lite-header {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  background: #f2f2f7;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.lite-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; color: #1c1c1e; }
.lite-title i { color: #5856D6; }
.lite-header-actions { display: flex; align-items: center; gap: 8px; }
.lite-logout {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 6px 14px; border-radius: 999px; font-size: 13px; cursor: pointer;
}
.login-card {
  margin: 60px 24px 0;
  background: #fff; border-radius: 16px; padding: 28px 22px;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.login-icon { font-size: 34px; color: #5856D6; margin-bottom: 10px; }
.login-card h3 { margin: 0 0 4px; font-size: 17px; color: #1c1c1e; }
.login-desc { margin: 0 0 18px; font-size: 13px; color: #8e8e93; text-align: center; line-height: 1.5; }
.lite-input {
  width: 100%; box-sizing: border-box;
  padding: 11px 14px; margin-bottom: 12px;
  border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 10px;
  font-size: 15px; outline: none; background: #f7f7fa;
}
.lite-input:focus { border-color: #5856D6; background: #fff; }
.lite-error { color: #FF3B30; font-size: 13px; margin: -4px 0 10px; align-self: flex-start; }
.lite-btn {
  width: 100%; padding: 12px; border: none; border-radius: 12px;
  font-size: 16px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; min-height: 44px;
}
.lite-btn.primary { background: #5856D6; color: #fff; }
.lite-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-loading {
  width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff; border-radius: 50%; animation: lite-spin 0.8s linear infinite;
}
@keyframes lite-spin { to { transform: rotate(360deg); } }
.upload-card {
  margin: 16px 16px 0;
  background: #fff; border-radius: 16px; padding: 26px 18px;
  text-align: center; cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.upload-icon { font-size: 36px; color: #5856D6; margin-bottom: 8px; }
.upload-text { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #1c1c1e; }
.upload-sub { margin: 0; font-size: 12px; color: #8e8e93; }
/* ====== 上传队列 ====== */
.queue-card {
  margin: 12px 16px 0;
  background: #fff; border-radius: 16px; padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.queue-head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 6px; }
.queue-title { font-size: 13px; font-weight: 600; color: #3a3a3c; margin-right: auto; }
.queue-clear {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 4px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.queue-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.queue-thumb {
  width: 42px; height: 42px; border-radius: 8px; overflow: hidden; flex-shrink: 0;
  background: #f2f2f7; display: flex; align-items: center; justify-content: center;
}
.queue-thumb img { width: 100%; height: 100%; object-fit: cover; }
.queue-thumb i { font-size: 16px; color: #8e8e93; }
.queue-info { flex: 1; min-width: 0; }
.queue-name { display: block; font-size: 13px; color: #1c1c1e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-status { display: block; font-size: 12px; color: #8e8e93; margin-top: 2px; }
.queue-status.failed { color: #FF3B30; }
.queue-status.done { color: #34C759; }
.queue-status.uploading { color: #5856D6; }
.progress-track { height: 4px; border-radius: 2px; background: rgba(118, 118, 128, 0.15); overflow: hidden; margin-top: 4px; }
.progress-fill { height: 100%; border-radius: 2px; background: #5856D6; transition: width 0.2s; }
.progress-fill.full { background: #34C759; }
.queue-retry {
  border: none; background: rgba(88, 86, 214, 0.12); color: #5856D6;
  padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.queue-done-icon { color: #34C759; font-size: 18px; flex-shrink: 0; }
/* ====== 类型筛选 ====== */
.filter-bar { display: flex; align-items: center; gap: 8px; padding: 14px 16px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.filter-chip {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 6px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.filter-chip.active { background: #5856D6; color: #fff; }
.filter-count { font-size: 11px; opacity: 0.7; }
/* ====== 文件列表 ====== */
.lite-loading, .lite-empty { text-align: center; color: #8e8e93; padding: 50px 20px; font-size: 14px; }
.lite-empty i { font-size: 34px; margin-bottom: 10px; display: block; color: #c7c7cc; }
.lite-list { margin: 14px 16px 0; display: flex; flex-direction: column; gap: 10px; }
.lite-item {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-radius: 14px; padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.lite-thumb {
  width: 52px; height: 52px; border-radius: 10px; overflow: hidden;
  background: #f2f2f7; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.lite-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lite-thumb i { font-size: 20px; color: #8e8e93; }
.lite-thumb i.fa-circle-play { font-size: 26px; color: #5856D6; }
.lite-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
.lite-name { font-size: 14px; font-weight: 600; color: #1c1c1e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lite-meta { font-size: 12px; color: #8e8e93; }
.lite-download, .lite-delete {
  border: none; color: #5856D6;
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 15px;
  font-style: normal; position: relative;
}
.lite-download { background: rgba(88, 86, 214, 0.12); }
.lite-delete { background: rgba(255, 59, 48, 0.1); color: #FF3B30; }
.lite-download.downloading { background: rgba(88, 86, 214, 0.2); }
.lite-download em { position: absolute; bottom: -14px; left: 0; right: 0; font-size: 9px; color: #5856D6; text-align: center; font-style: normal; }
/* ====== 骨架屏 ====== */
.skeleton-pulse { animation: sk-pulse 1.4s ease-in-out infinite; }
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.lite-item.skeleton { pointer-events: none; }
.sk-line { height: 13px; border-radius: 4px; background: #e5e5ea; }
.sk-line.short { width: 55%; height: 11px; }
/* ====== 查看器 ====== */
.viewer {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.94); z-index: 200;
  display: flex; flex-direction: column;
}
.viewer-top { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; }
.viewer-count { color: rgba(255, 255, 255, 0.75); font-size: 13px; }
.viewer-top-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.viewer-btn {
  border: none; background: rgba(255, 255, 255, 0.14); color: #fff;
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer; font-size: 15px;
  display: flex; align-items: center; justify-content: center;
}
.viewer-stage {
  flex: 1; position: relative;
  display: flex; align-items: center; justify-content: center;
  min-height: 0; padding: 0 8px;
}
.viewer-img { max-width: 100%; max-height: 100%; object-fit: contain; }
.viewer-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  border: none; background: rgba(255, 255, 255, 0.12); color: #fff;
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 15px;
}
.viewer-nav.prev { left: 10px; }
.viewer-nav.next { right: 10px; }
.viewer-name {
  margin: 0; padding: 12px 16px 18px; text-align: center;
  color: rgba(255, 255, 255, 0.8); font-size: 13px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.viewer-video { max-width: 100%; max-height: 100%; }
.media-stage { padding: 16px; }
.audio-panel { text-align: center; width: 100%; }
.audio-icon { font-size: 48px; color: #5856D6; }
.audio-name { color: rgba(255, 255, 255, 0.85); font-size: 15px; margin: 14px 0 22px; }
.viewer-audio { width: 100%; max-width: 480px; }
/* ====== Toast ====== */
.lite-toast {
  position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.9); color: #fff;
  padding: 10px 18px; border-radius: 999px; font-size: 13px;
  max-width: 86vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  z-index: 300;
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity 0.25s; }
.toast-fade-enter, .toast-fade-leave-to { opacity: 0; }
</style>
