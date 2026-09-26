<template>
  <div class="cloud-lite">
    <!-- 顶栏 -->
    <div class="lite-header">
      <div class="lite-title">
        <i class="fa-solid fa-cloud"></i>
        <span>云盘 · 上传下载</span>
      </div>
      <button v-if="isLoggedIn" class="lite-logout" @click="logout">退出</button>
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

    <!-- 已登录：上传 + 文件列表 -->
    <template v-else>
      <!-- 上传区 -->
      <div class="upload-card" @click="triggerUpload">
        <input ref="fileInput" type="file" accept="image/*,audio/*,video/*" multiple style="display:none" @change="onFileSelect" />
        <i class="fa-solid fa-cloud-arrow-up upload-icon"></i>
        <p class="upload-text">{{ uploading ? '上传中 ' + uploadProgress + '%' : '点击选择图片 / 音频 / 视频' }}</p>
        <div v-if="uploading" class="progress-track"><div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div></div>
        <p class="upload-hint">上传后老师会进行审核，请勿上传与学习无关的内容</p>
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
  var lower = name.toLowerCase();
  var idx = name.lastIndexOf('.');
  var ext = idx > -1 ? name.substring(idx).toLowerCase() : '';
  if (IMAGE_EXTS.indexOf(ext) > -1) return 'image';
  if (VIDEO_EXTS.indexOf(ext) > -1) return 'video';
  if (AUDIO_EXTS.indexOf(ext) > -1) return 'audio';
  return 'other';
}

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
      uploading: false,
      uploadProgress: 0,
      toastMsg: '',
      toastTimer: null
    };
  },
  computed: {
    isLoggedIn: function() {
      return !!(this.$store.state.auth.token);
    }
  },
  mounted: function() {
    if (this.isLoggedIn) {
      var user = this.$store.state.auth.user;
      if (user && user.account) this.account = user.account;
      this.loadFiles();
    }
  },
  methods: {
    getMediaType: getMediaType,
    showToast: function(msg) {
      var self = this;
      self.toastMsg = msg;
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function() { self.toastMsg = ''; }, 2200);
    },
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
    triggerUpload: function() {
      if (this.uploading) return;
      this.$refs.fileInput.click();
    },
    onFileSelect: function(e) {
      var self = this;
      var list = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (list.length === 0 || self.uploading) return;
      var idx = 0;
      var okCount = 0;
      var failCount = 0;

      function next() {
        if (idx >= list.length) {
          self.uploading = false;
          self.uploadProgress = 0;
          if (failCount > 0) self.showToast(okCount + ' 个成功，' + failCount + ' 个失败');
          else self.showToast('已上传 ' + okCount + ' 个文件');
          self.loadFiles();
          return;
        }
        var f = list[idx];
        var fd = new FormData();
        fd.append('file', f, f.name);
        self.uploading = true;
        self.uploadProgress = 0;
        api.post('/cloud/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: function(evt) {
            if (evt.total) self.uploadProgress = Math.round((evt.loaded / evt.total) * 100);
          }
        }).then(function() {
          okCount++;
          idx++;
          next();
        }).catch(function(err) {
          failCount++;
          idx++;
          var msg = (err.response && err.response.data && err.response.data.message) || '';
          if (msg) self.showToast(f.name + '：' + msg);
          next();
        });
      }
      next();
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
      api.get('/cloud/files/' + encodeURIComponent(file.hash), { responseType: 'blob' }).then(function(res) {
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
  min-height: 100vh;
  background: #f2f2f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  padding-bottom: 40px;
}
.lite-header {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  background: rgba(242, 242, 247, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.lite-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; color: #1c1c1e; }
.lite-title i { color: #5856D6; }
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
.upload-hint { margin: 8px 0 0; font-size: 12px; color: #8e8e93; }
.progress-track { height: 6px; border-radius: 3px; background: rgba(118, 118, 128, 0.15); overflow: hidden; margin-top: 10px; }
.progress-fill { height: 100%; border-radius: 3px; background: #5856D6; transition: width 0.2s; }
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
