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
        <i class="fa-solid fa-cloud-arrow-up upload-icon" :class="{ 'fa-bounce-soft': queueRunning }"></i>
        <p class="upload-text">{{ queueRunning ? '上传中 ' + doneCount + '/' + queue.length : '点击选择图片 / 音频 / 视频' }}</p>
        <p class="upload-sub">{{ queueRunning ? '可以锁屏休息一下，中断的文件可一键重试' : '可一次选择多个文件' }}</p>
      </div>

      <!-- 上传队列 -->
      <div v-if="queue.length > 0" class="queue-card">
        <div class="queue-head">
          <span class="queue-title">上传列表</span>
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
              {{ item.status === 'waiting' ? '等待上传' : (item.status === 'uploading' ? '上传中 ' + item.progress + '%' : (item.status === 'done' ? '已完成' : (item.error || '上传失败'))) }}
            </span>
          </div>
          <button v-if="item.status === 'failed'" class="queue-retry" @click="retryItem(item)">
            <i class="fa-solid fa-rotate-right"></i> 重试
          </button>
          <i v-else-if="item.status === 'done'" class="fa-solid fa-circle-check queue-done-icon"></i>
        </div>
      </div>

      <!-- 文件列表 -->
      <div v-if="loading" class="lite-loading">加载中...</div>
      <div v-else-if="files.length === 0" class="lite-empty">
        <i class="fa-solid fa-folder-open"></i>
        <p>云盘还是空的，先上传一个文件吧</p>
      </div>
      <div v-else class="lite-list">
        <div v-for="file in files" :key="file.hash" class="lite-item">
          <div class="lite-thumb">
            <img v-if="getMediaType(file) === 'image'" :src="file.url + '?w=200'" loading="lazy" :alt="file.name" />
            <i v-else-if="getMediaType(file) === 'video'" class="fa-solid fa-film"></i>
            <i v-else-if="getMediaType(file) === 'audio'" class="fa-solid fa-music"></i>
            <i v-else class="fa-solid fa-file"></i>
          </div>
          <div class="lite-info">
            <span class="lite-name">{{ file.display_name || file.name }}</span>
            <span class="lite-meta">{{ formatSize(file.size) }} · {{ formatTime(file.uploaded_at) }}</span>
          </div>
          <button class="lite-download" @click="downloadFile(file)" title="下载">
            <i class="fa-solid fa-download"></i>
          </button>
        </div>
      </div>
    </template>

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
      // 上传队列
      queue: [],
      queueSeq: 0,
      pumping: false,
      lastProgressAt: 0,
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
          error: '',
          preview: isImage ? URL.createObjectURL(f) : null
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
      item.error = '';
      self.pumping = true;
      self.lastProgressAt = Date.now();

      var fd = new FormData();
      fd.append('file', item.file, item.name);
      api.post('/cloud/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: function(evt) {
          self.lastProgressAt = Date.now();
          if (evt.total) item.progress = Math.round((evt.loaded / evt.total) * 100);
        }
      }).then(function() {
        item.status = 'done';
        item.progress = 100;
        if (item.preview) { URL.revokeObjectURL(item.preview); item.preview = null; }
      }).catch(function(err) {
        item.status = 'failed';
        item.progress = 0;
        item.error = (err.response && err.response.data && err.response.data.message) || '上传失败';
        if (err.response && err.response.status === 401) {
          self.showToast('登录已过期，请重新登录');
        }
      }).then(function() {
        self.pumping = false;
        self.pump();
      });
    },
    retryItem: function(item) {
      if (item.status !== 'failed') return;
      item.status = 'waiting';
      item.error = '';
      this.pump();
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
    downloadFile: function(file) {
      var self = this;
      self.showToast('开始下载：' + (file.display_name || file.name));
      api.get('/cloud/files/' + encodeURIComponent(file.hash), { responseType: 'blob', timeout: 0 }).then(function(res) {
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
      }).catch(function() {
        self.showToast('下载失败');
      });
    },

    // ====== 登录 ======
    login: function() {
      var self = this;
      if (!self.account || !self.password || self.loginLoading) return;
      self.loginLoading = true;
      self.loginError = '';
      self.$store.dispatch('auth/login', { account: self.account, password: self.password }).then(function() {
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
.lite-logout {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 6px 14px; border-radius: 999px; font-size: 13px; cursor: pointer;
}
.lite-header-actions { display: flex; align-items: center; gap: 8px; }
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
.queue-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.queue-title { font-size: 13px; font-weight: 600; color: #3a3a3c; }
.queue-clear {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 4px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
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
}
.lite-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lite-thumb i { font-size: 20px; color: #8e8e93; }
.lite-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.lite-name { font-size: 14px; font-weight: 600; color: #1c1c1e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lite-meta { font-size: 12px; color: #8e8e93; }
.lite-download {
  border: none; background: rgba(88, 86, 214, 0.12); color: #5856D6;
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 15px;
}
.lite-toast {
  position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.9); color: #fff;
  padding: 10px 18px; border-radius: 999px; font-size: 13px;
  max-width: 86vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  z-index: 100;
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity 0.25s; }
.toast-fade-enter, .toast-fade-leave-to { opacity: 0; }
</style>
