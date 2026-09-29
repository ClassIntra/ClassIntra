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

    <!-- 已登录 -->
    <template v-else>
      <!-- 分组栏 -->
      <div class="folder-bar">
        <button class="fchip" :class="{ on: currentFolder === '' }" @click="switchFolder('')">
          全部<span class="fchip-count">{{ files.length }}</span>
        </button>
        <button class="fchip" :class="{ on: currentFolder === '__root__' }" @click="switchFolder('__root__')">
          未分组
        </button>
        <button
          v-for="f in folders"
          :key="f.id"
          class="fchip"
          :class="{ on: currentFolder === f.name }"
          @click="switchFolder(f.name)"
        >
          <i v-if="f.hide_from_all" class="fa-solid fa-eye-slash fchip-hidden"></i>
          {{ f.name }}<span class="fchip-count">{{ f.file_count }}</span>
        </button>
        <button class="fchip manage" @click="openManage">
          <i class="fa-solid fa-folder-plus"></i> 管理
        </button>
      </div>

      <!-- 上传入口：相机 / 录像 / 相册 / 文件 -->
      <div class="upload-card">
        <div class="entry-grid">
          <input ref="camInput" type="file" accept="image/*" capture="environment" style="display:none" @change="onFileSelect" />
          <!-- 录像不带 capture：部分国产 WebView（X5 等）对 capture+video 弹「拍照/相册」图片弹窗；
               去掉后系统弹「摄像/选择文件」视频选择器，可直接录像或从相册选 -->
          <input ref="vidInput" type="file" accept="video/*" style="display:none" @change="onFileSelect" />
          <input ref="galInput" type="file" accept="image/*,video/*" multiple style="display:none" @change="onFileSelect" />
          <input ref="fileInput" type="file" multiple style="display:none" @change="onFileSelect" />
          <button class="entry" @click="pickEntry('cam')">
            <i class="fa-solid fa-camera"></i><span>拍照</span>
          </button>
          <button class="entry" @click="pickEntry('vid')">
            <i class="fa-solid fa-video"></i><span>录像</span>
          </button>
          <button class="entry" @click="pickEntry('gal')">
            <i class="fa-solid fa-images"></i><span>相册</span>
          </button>
          <button class="entry" @click="pickEntry('file')">
            <i class="fa-solid fa-file-arrow-up"></i><span>文件</span>
          </button>
        </div>
        <p class="upload-sub">
          <template v-if="queueRunning">上传中 {{ doneCount }}/{{ queue.length }} · 可锁屏休息，中断可重试</template>
          <template v-else-if="currentFolderName">将上传到分组「{{ currentFolderName }}」</template>
          <template v-else>支持多选 · 图片 / 音频 / 视频 / 文本</template>
        </p>
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
            <span class="queue-status" :class="item.status">{{ statusText(item) }}</span>
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
        <p>{{ currentFolderName ? '这个分组还是空的' : '云盘还是空的，先上传一个文件吧' }}</p>
      </div>
      <template v-else>
        <div class="filter-bar">
          <button v-for="f in filters" :key="f.key" class="filter-chip" :class="{ active: activeFilter === f.key }" @click="activeFilter = f.key">
            {{ f.label }} <span class="filter-count">{{ countByType(f.key) }}</span>
          </button>
        </div>
        <div v-if="filteredFiles.length === 0" class="lite-empty">
          <p>该类型下没有文件</p>
        </div>
        <div v-else class="lite-list">
          <div v-for="file in filteredFiles" :key="file.hash" class="lite-item">
            <div class="lite-thumb" @click="openViewer(file)">
              <img v-if="getMediaType(file) === 'image'" :src="file.url + '?w=200'" loading="lazy" :alt="file.name" />
              <i v-else-if="getMediaType(file) === 'video'" class="fa-solid fa-circle-play"></i>
              <i v-else-if="getMediaType(file) === 'audio'" class="fa-solid fa-music"></i>
              <i v-else-if="getMediaType(file) === 'text'" class="fa-solid fa-file-lines"></i>
              <i v-else class="fa-solid fa-file"></i>
            </div>
            <div class="lite-info" @click="openViewer(file)">
              <span class="lite-name">{{ file.display_name || file.name }}</span>
              <span class="lite-meta">{{ formatSize(file.size) }} · {{ formatTime(file.uploaded_at) }}</span>
            </div>
            <button class="lite-download" @click="downloadFile(file)" title="下载">
              <i class="fa-solid fa-download"></i>
            </button>
            <button class="lite-delete" @click="deleteFile(file)" title="删除">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- 分组管理弹层 -->
    <div v-if="manageOpen" class="modal-mask" @click.self="closeManage">
      <div class="modal-sheet">
        <div class="sh-head">
          <span class="sh-title">分组管理</span>
          <button class="sh-close" @click="closeManage"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="sh-sec">
          <h4>创建分组</h4>
          <div class="row">
            <input v-model.trim="newFolderName" class="lite-input row-inp" type="text" placeholder="分组名称" maxlength="50" @keyup.enter="createFolder" />
            <button class="row-btn" @click="createFolder">创建</button>
          </div>
        </div>
        <div class="sh-sec">
          <h4>导入他人分享</h4>
          <div class="row">
            <input v-model.trim="importCode" class="lite-input row-inp" type="text" placeholder="输入 8 位分享码" maxlength="8" style="text-transform:uppercase" @keyup.enter="importShare" />
            <button class="row-btn" @click="importShare">导入</button>
          </div>
          <div v-if="shareInfo" class="share-code">
            <b>{{ shareInfo.code }}</b>
            <span>「{{ shareInfo.name }}」的分享码 · 可发给同学导入</span>
          </div>
        </div>
        <div class="sh-sec">
          <h4>我的分组（点名称可跳转）</h4>
          <p v-if="folders.length === 0" class="sh-empty">还没有分组，先创建一个吧</p>
          <div v-for="f in folders" :key="f.id" class="frow">
            <span class="frow-name" @click="switchFolder(f.name); closeManage()">
              <i v-if="f.hide_from_all" class="fa-solid fa-eye-slash"></i>{{ f.name }}
              <em>{{ f.file_count }} 个</em>
            </span>
            <button class="frow-act brand" @click="shareFolder(f)">分享</button>
            <button class="frow-act" @click="toggleHide(f)">{{ f.hide_from_all ? '显示' : '隐藏' }}</button>
            <button class="frow-act danger" @click="deleteFolder(f)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 查看器：大图 / 视频 / 音频 / 文本 -->
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
          :src="viewerImages[viewer.index].url"
          :alt="viewerImages[viewer.index].name"
          @click.stop
        />
        <button v-if="viewerImages.length > 1" class="viewer-nav next" @click.stop="viewerStep(1)">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
      <p class="viewer-name">{{ viewerImages[viewer.index].display_name || viewerImages[viewer.index].name }}</p>
    </div>

    <div v-if="mediaOverlay.open" class="viewer">
      <div class="viewer-top">
        <div class="viewer-top-actions">
          <button class="viewer-btn" @click="downloadFile(mediaOverlay.file)" title="下载">
            <i class="fa-solid fa-download"></i>
          </button>
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
        <div v-else-if="mediaOverlay.type === 'text'" class="text-panel">
          <span v-if="mediaOverlay.loading" class="btn-loading dark"></span>
          <pre v-else-if="mediaOverlay.content !== null" class="v-text">{{ mediaOverlay.content }}</pre>
          <p v-else class="v-err">{{ mediaOverlay.error || '加载失败' }}</p>
        </div>
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
import axios from 'axios';

var IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
var VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
var AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];
var TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yml'];

function getMediaType(file) {
  if (!file) return 'other';
  if (file.mime_type) {
    if (file.mime_type.indexOf('image/') === 0) return 'image';
    if (file.mime_type.indexOf('video/') === 0) return 'video';
    if (file.mime_type.indexOf('audio/') === 0) return 'audio';
    if (file.mime_type.indexOf('text/') === 0 || file.mime_type === 'application/json') return 'text';
  }
  var name = file.name || file.display_name || '';
  var idx = name.lastIndexOf('.');
  var ext = idx > -1 ? name.substring(idx).toLowerCase() : '';
  if (IMAGE_EXTS.indexOf(ext) > -1) return 'image';
  if (VIDEO_EXTS.indexOf(ext) > -1) return 'video';
  if (AUDIO_EXTS.indexOf(ext) > -1) return 'audio';
  if (TEXT_EXTS.indexOf(ext) > -1) return 'text';
  return 'other';
}

// 锁屏/切后台后浏览器可能冻结或杀掉上传中的请求：
// 可见时若某文件超过该时长无进度事件，主动断开触发自动重试
var STALL_ABORT = 45000;
// 上传性能与稳定性：2 路并行（多流吃满隧道带宽）；自动重试 2 次带退避
var PARALLEL = 2;
var MAX_RETRY = 2;

export default {
  name: 'CloudLite',
  data: function() {
    return {
      account: '',
      password: '',
      loginLoading: false,
      loginError: '',
      files: [],
      folders: [],
      currentFolder: '',
      newFolderName: '',
      importCode: '',
      manageOpen: false,
      shareInfo: null,
      activeFilter: 'all',
      filters: [
        { key: 'all', label: '全部' },
        { key: 'image', label: '图片' },
        { key: 'video', label: '视频' },
        { key: 'audio', label: '音频' },
        { key: 'text', label: '文本' },
        { key: 'other', label: '其他' }
      ],
      queue: [],
      queueSeq: 0,
      lastProgressAt: 0,
      viewer: { open: false, index: 0 },
      mediaOverlay: { open: false, file: null, type: '', loading: false, content: '', error: '' },
      toastMsg: '',
      toastTimer: null
    };
  },
  computed: {
    isLoggedIn: function() {
      return !!(this.$store.state.auth.token);
    },
    currentFolderName: function() {
      return (this.currentFolder !== '' && this.currentFolder !== '__root__') ? this.currentFolder : '';
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
      this.loadFolders();
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
      var body = document.body;
      body.style.visibility = 'hidden';
      setTimeout(function() { body.style.visibility = ''; }, 60);
      // 上传中文件若已长时间无进度（后台被冻结导致看门狗失灵），主动断开触发自动重试
      self.queue.forEach(function(q) {
        if (q.status === 'uploading' && q._cancel && Date.now() - q._lastProg > STALL_ABORT) {
          q._cancel.cancel('stall');
        }
      });
    },

    // ====== 分组 ======
    loadFolders: function() {
      var self = this;
      return api.get('/cloud/folders').then(function(res) {
        self.folders = (res.data.data && res.data.data.folders) || [];
      }).catch(function() {
        self.folders = [];
      });
    },
    switchFolder: function(name) {
      this.currentFolder = name;
      this.loadFiles();
    },
    openManage: function() {
      this.manageOpen = true;
      this.shareInfo = null;
    },
    closeManage: function() {
      this.manageOpen = false;
      this.shareInfo = null;
    },
    createFolder: function() {
      var self = this;
      var name = self.newFolderName.trim();
      if (!name) { self.showToast('请输入分组名称'); return; }
      if (name.length > 50) { self.showToast('分组名称不能超过50个字符'); return; }
      api.post('/cloud/folders', { name: name }).then(function(res) {
        if (res.data.code === 200) {
          self.showToast('分组「' + name + '」已创建');
          self.newFolderName = '';
          self.loadFolders();
        }
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '创建失败');
      });
    },
    deleteFolder: function(f) {
      var self = this;
      if (!confirm('删除分组「' + f.name + '」？分组内的文件会移回未分组，不会丢失。')) return;
      api.delete('/cloud/folders/' + f.id).then(function() {
        self.showToast('分组已删除，文件已移回未分组');
        if (self.currentFolder === f.name) self.currentFolder = '';
        self.loadFolders();
        self.loadFiles();
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '删除失败');
      });
    },
    toggleHide: function(f) {
      var self = this;
      api.patch('/cloud/folders/' + f.id + '/toggle-hide').then(function() {
        self.showToast(f.hide_from_all ? '「' + f.name + '」已恢复显示' : '「' + f.name + '」已隐藏');
        self.loadFolders();
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '操作失败');
      });
    },
    shareFolder: function(f) {
      var self = this;
      api.post('/cloud/folders/' + f.id + '/share').then(function(res) {
        var d = res.data.data;
        if (d && d.share_code) {
          self.shareInfo = { name: f.name, code: d.share_code };
        } else {
          self.showToast((res.data && res.data.message) || '生成失败');
        }
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '生成失败');
      });
    },
    importShare: function() {
      var self = this;
      var code = self.importCode.trim().toUpperCase();
      if (!code) { self.showToast('请输入 8 位分享码'); return; }
      api.post('/cloud/folders/import/' + encodeURIComponent(code)).then(function(res) {
        var d = res.data.data;
        if (res.data.code === 200 && d) {
          self.showToast('成功导入 ' + d.imported + ' 个文件' + (d.skipped > 0 ? '，' + d.skipped + ' 个已存在' : ''));
          self.importCode = '';
          self.loadFolders();
          self.loadFiles();
        }
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '导入失败：分享码无效');
      });
    },

    // ====== 上传队列 ======
    pickEntry: function(kind) {
      if (this.queueRunning) { this.showToast('当前队列上传中，请稍候'); return; }
      var ref = { cam: 'camInput', vid: 'vidInput', gal: 'galInput', file: 'fileInput' }[kind];
      if (ref && this.$refs[ref]) this.$refs[ref].click();
    },
    onFileSelect: function(e) {
      var self = this;
      var list = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (list.length === 0) return;
      var folder = self.currentFolderName;
      list.forEach(function(f) {
        var isImage = getMediaType({ name: f.name, mime_type: f.type }) === 'image';
        self.queue.push({
          id: ++self.queueSeq,
          name: f.name,
          size: f.size,
          file: f,
          folder: folder,
          status: 'waiting',
          progress: 0,
          speed: '',
          error: '',
          attempts: 0,
          preview: isImage ? URL.createObjectURL(f) : null,
          _lastLoaded: 0,
          _spT: 0,
          _lastProg: 0
        });
      });
      if (list.length > 1) self.showToast('已加入 ' + list.length + ' 个文件');
      self.pump();
    },
    pump: function() {
      var self = this;
      var uploading = self.queue.filter(function(q) { return q.status === 'uploading'; }).length;
      while (uploading < PARALLEL) {
        var next = null;
        self.queue.forEach(function(q) { if (!next && q.status === 'waiting') next = q; });
        if (!next) break;
        self.startUpload(next);
        uploading++;
      }
      if (uploading === 0) {
        if (self.queue.length > 0) {
          var ok = self.queue.filter(function(q) { return q.status === 'done'; }).length;
          var fail = self.queue.filter(function(q) { return q.status === 'failed'; }).length;
          if (ok + fail > 0 && self.queue.every(function(q) { return q.status === 'done' || q.status === 'failed'; })) {
            self.showToast(fail > 0 ? ok + ' 个成功，' + fail + ' 个失败' : '全部上传完成');
          }
        }
        self.loadFiles();
        self.loadFolders();
      }
    },
    armStall: function(item) {
      var self = this;
      clearTimeout(item._stall);
      item._stall = setTimeout(function() {
        if (item.status === 'uploading' && item._cancel) {
          item._cancel.cancel('stall');
        }
      }, STALL_ABORT);
    },
    startUpload: function(item) {
      var self = this;
      item.status = 'uploading';
      item.progress = 0;
      item.speed = '';
      item.error = '';
      item._lastLoaded = 0;
      item._spT = 0;
      item._lastProg = Date.now();
      self.lastProgressAt = Date.now();
      item._cancel = axios.CancelToken.source();

      var fd = new FormData();
      fd.append('file', item.file, item.name);
      fd.append('source', 'lite');
      if (item.folder) fd.append('folder', item.folder);
      api.post('/cloud/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        cancelToken: item._cancel ? item._cancel.token : undefined,
        onUploadProgress: function(evt) {
          var now = Date.now();
          self.lastProgressAt = now;
          item._lastProg = now;
          if (evt.total) item.progress = Math.round((evt.loaded / evt.total) * 100);
          if (now - item._spT > 800 && evt.loaded > item._lastLoaded) {
            item.speed = self.formatSize(Math.round((evt.loaded - item._lastLoaded) / ((now - item._spT) / 1000))) + '/s';
            item._lastLoaded = evt.loaded;
            item._spT = now;
          }
          self.armStall(item);
        }
      }).then(function() {
        clearTimeout(item._stall);
        item.status = 'done';
        item.progress = 100;
        item.speed = '';
        if (item.preview) { URL.revokeObjectURL(item.preview); item.preview = null; }
        self.pump();
      }).catch(function(err) {
        clearTimeout(item._stall);
        var status = err.response ? err.response.status : 0;
        var retryable = !status || status >= 500 || status === 408 || status === 429;
        if (retryable && item.attempts < MAX_RETRY) {
          item.attempts++;
          item.status = 'waiting';
          item.progress = 0;
          item.error = '网络中断，自动重试 ' + item.attempts + '/' + MAX_RETRY;
          setTimeout(function() { self.pump(); }, 2000 * item.attempts);
        } else {
          item.status = 'failed';
          item.error = (err.response && err.response.data && err.response.data.message) || '上传失败';
          if (status === 401) {
            self.showToast('登录已过期，请重新登录');
          }
        }
        self.pump();
      });
    },
    statusText: function(item) {
      if (item.status === 'waiting') return item.error || '等待上传';
      if (item.status === 'uploading') return '上传中 ' + item.progress + '%' + (item.speed ? ' · ' + item.speed : '');
      if (item.status === 'done') return '已完成' + (item.folder ? ' → ' + item.folder : '');
      return item.error || '上传失败';
    },
    retryItem: function(item) {
      if (item.status !== 'failed') return;
      item.attempts = 0;
      item.status = 'waiting';
      item.error = '';
      this.pump();
    },
    retryAllFailed: function() {
      var self = this;
      self.queue.forEach(function(q) {
        if (q.status === 'failed') {
          q.attempts = 0;
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
        this.mediaOverlay = { open: true, file: file, type: type, loading: false, content: '', error: '' };
      } else if (type === 'text') {
        if ((file.size || 0) > 5 * 1024 * 1024) {
          this.showToast('文件较大，请直接下载查看');
          return;
        }
        var self = this;
        self.mediaOverlay = { open: true, file: file, type: 'text', loading: true, content: '', error: '' };
        api.get('/cloud/files/' + encodeURIComponent(file.hash), { responseType: 'text', timeout: 60000 }).then(function(res) {
          self.mediaOverlay.content = typeof res.data === 'string' ? res.data : String(res.data || '');
          self.mediaOverlay.loading = false;
        }).catch(function(err) {
          self.mediaOverlay.loading = false;
          self.mediaOverlay.content = null;
          self.mediaOverlay.error = (err.response && err.response.data && err.response.data.message) || '加载失败';
        });
      }
    },
    closeViewer: function() {
      this.viewer = { open: false, index: 0 };
    },
    closeMedia: function() {
      this.mediaOverlay = { open: false, file: null, type: '', loading: false, content: '', error: '' };
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
      this.loadFolders();
      this.loadFiles();
    },
    loadFiles: function() {
      var self = this;
      self.loading = true;
      var params = {};
      if (self.currentFolder) params.folder = self.currentFolder;
      api.get('/cloud/files', { params: params }).then(function(res) {
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
          self.loadFolders();
        }
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '删除失败';
        self.showToast(msg);
      });
    },

    // ====== 下载：服务端附件下发（Content-Disposition），浏览器原生进度，兼容旧内核 ======
    downloadFile: function(file) {
      var name = file.display_name || file.name;
      this.showToast('开始下载：' + name + '（进度见浏览器下载栏）');
      var a = document.createElement('a');
      a.href = file.url + '?download=1';
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        document.body.removeChild(a);
      }, 1000);
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
        self.loadFolders();
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
        self.folders = [];
        self.queue = [];
        self.currentFolder = '';
        self.closeManage();
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
  padding-bottom: 48px;
}
@media (min-width: 760px) {
  .cloud-lite { max-width: 720px; margin: 0 auto; }
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
  padding: 6px 14px; border-radius: var(--radius-pill); font-size: 13px; cursor: pointer;
}
.login-card {
  margin: 60px 24px 0;
  background: #fff; border-radius: var(--radius-lg); padding: 28px 22px;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.login-icon { font-size: 34px; color: #5856D6; margin-bottom: 10px; }
.login-card h3 { margin: 0 0 4px; font-size: 17px; color: #1c1c1e; }
.login-desc { margin: 0 0 18px; font-size: 13px; color: #8e8e93; text-align: center; line-height: 1.5; }
.lite-input {
  width: 100%; box-sizing: border-box;
  padding: 11px 14px; margin-bottom: 12px;
  border: 1px solid rgba(0, 0, 0, 0.1); border-radius: var(--radius-sm);
  font-size: 15px; outline: none; background: #f7f7fa;
}
.lite-input:focus { border-color: #5856D6; background: #fff; }
.lite-error { color: #FF3B30; font-size: 13px; margin: -4px 0 10px; align-self: flex-start; }
.lite-btn {
  width: 100%; padding: 12px; border: none; border-radius: var(--radius-md);
  font-size: 16px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; min-height: 44px;
}
.lite-btn.primary { background: #5856D6; color: #fff; }
.lite-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-loading {
  width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff; border-radius: 50%; animation: lite-spin 0.8s linear infinite;
}
.btn-loading.dark { border-color: rgba(0, 0, 0, 0.15); border-top-color: #5856D6; }
@keyframes lite-spin { to { transform: rotate(360deg); } }
/* ====== 分组栏 ====== */
.folder-bar { display: flex; align-items: center; padding: 14px 16px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.folder-bar::-webkit-scrollbar { display: none; }
.fchip {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 6px 13px; border-radius: var(--radius-pill); font-size: 13px; cursor: pointer;
  white-space: nowrap; margin-right: 8px; flex-shrink: 0;
  display: inline-flex; align-items: center;
}
.fchip.on { background: #5856D6; color: #fff; }
.fchip-count { font-size: 11px; opacity: 0.7; margin-left: 4px; }
.fchip-hidden { font-size: 11px; margin-right: 4px; opacity: 0.75; }
.fchip.manage { background: rgba(88, 86, 214, 0.12); color: #5856D6; margin-right: 0; }
/* ====== 上传入口 ====== */
.upload-card {
  margin: 14px 16px 0;
  background: #fff; border-radius: var(--radius-lg); padding: 16px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.entry-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
@media (max-width: 420px) {
  .entry-grid { grid-template-columns: repeat(2, 1fr); row-gap: 10px; }
}
.entry {
  border: none; background: rgba(88, 86, 214, 0.1); color: #5856D6;
  border-radius: var(--radius-md); padding: 13px 4px; cursor: pointer; font-family: inherit;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.entry i { font-size: 20px; margin-bottom: 6px; }
.entry span { font-size: 12px; font-weight: 600; }
.entry:active { background: rgba(88, 86, 214, 0.18); }
.upload-sub { margin: 10px 0 0; font-size: 12px; color: #8e8e93; text-align: center; }
/* ====== 队列 ====== */
.queue-card {
  margin: 12px 16px 0;
  background: #fff; border-radius: var(--radius-lg); padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.queue-head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 6px; }
.queue-title { font-size: 13px; font-weight: 600; color: #3a3a3c; margin-right: auto; }
.queue-clear {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 4px 12px; border-radius: var(--radius-pill); font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.queue-item { display: flex; align-items: center; padding: 8px 0; }
.queue-thumb {
  width: 42px; height: 42px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0;
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
.progress-track { height: 4px; border-radius: var(--radius-xs); background: rgba(118, 118, 128, 0.15); overflow: hidden; margin-top: 4px; }
.progress-fill { height: 100%; border-radius: var(--radius-xs); background: #5856D6; transition: width 0.2s; }
.progress-fill.full { background: #34C759; }
.queue-retry {
  border: none; background: rgba(88, 86, 214, 0.12); color: #5856D6;
  padding: 6px 12px; border-radius: var(--radius-pill); font-size: 12px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.queue-done-icon { color: #34C759; font-size: 18px; flex-shrink: 0; }
/* ====== 类型筛选 ====== */
.filter-bar { display: flex; align-items: center; padding: 14px 16px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.filter-bar::-webkit-scrollbar { display: none; }
.filter-chip {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 6px 14px; border-radius: var(--radius-pill); font-size: 13px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;
}
.filter-chip.active { background: #5856D6; color: #fff; }
.filter-count { font-size: 11px; opacity: 0.7; }
/* ====== 文件列表 ====== */
.lite-loading, .lite-empty { text-align: center; color: #8e8e93; padding: 50px 20px; font-size: 14px; }
.lite-empty i { font-size: 34px; margin-bottom: 10px; display: block; color: #c7c7cc; }
.lite-list { margin: 14px 16px 0; display: grid; grid-template-columns: 1fr; }
@media (min-width: 860px) {
  .lite-list { grid-template-columns: 1fr 1fr; column-gap: 10px; }
}
.lite-item {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-radius: var(--radius-md); padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); margin-bottom: 10px;
}
.lite-thumb {
  width: 52px; height: 52px; border-radius: var(--radius-sm); overflow: hidden;
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
/* ====== 分组管理弹层 ====== */
.modal-mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 150;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: flex-end; justify-content: center;
}
@media (min-width: 640px) { .modal-mask { align-items: center; } }
.modal-sheet {
  background: #f2f2f7; width: 100%; max-width: 560px; max-height: 86vh;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 16px; overflow-y: auto; -webkit-overflow-scrolling: touch;
}
@media (min-width: 640px) { .modal-sheet { border-radius: var(--radius-lg); } }
.sh-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sh-title { font-size: 16px; font-weight: 700; }
.sh-close {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.sh-sec { background: #fff; border-radius: var(--radius-md); padding: 14px; margin-bottom: 12px; }
.sh-sec h4 { font-size: 13px; color: #8e8e93; margin-bottom: 10px; font-weight: 600; }
.row { display: flex; align-items: center; }
.row-inp { margin-bottom: 0; margin-right: 10px; flex: 1; }
.row-btn {
  border: none; background: #5856D6; color: #fff;
  min-height: 40px; padding: 0 16px; border-radius: var(--radius-sm); font-size: 14px; cursor: pointer; flex-shrink: 0;
}
.share-code {
  margin-top: 12px; background: #f2f2f7; border-radius: var(--radius-md); padding: 12px; text-align: center;
}
.share-code b { display: block; font-size: 24px; letter-spacing: 4px; color: #5856D6; margin-bottom: 6px; font-family: Menlo, Consolas, monospace; }
.share-code span { font-size: 12px; color: #8e8e93; }
.sh-empty { font-size: 13px; color: #8e8e93; text-align: center; padding: 8px 0; }
.frow { display: flex; align-items: center; padding: 9px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.05); }
.frow:last-child { border-bottom: none; }
.frow-name { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.frow-name i { font-size: 11px; color: #8e8e93; margin-right: 5px; }
.frow-name em { font-style: normal; font-size: 11px; color: #8e8e93; margin-left: 5px; }
.frow-act {
  border: none; background: rgba(118, 118, 128, 0.12); color: #3a3a3c;
  padding: 5px 10px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; margin-left: 6px; flex-shrink: 0;
}
.frow-act.danger { background: rgba(255, 59, 48, 0.1); color: #FF3B30; }
.frow-act.brand { background: rgba(88, 86, 214, 0.12); color: #5856D6; }
/* ====== 骨架屏 ====== */
.skeleton-pulse { animation: sk-pulse 1.4s ease-in-out infinite; }
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.lite-item.skeleton { pointer-events: none; }
.sk-line { height: 13px; border-radius: var(--radius-xs); background: #e5e5ea; }
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
.text-panel {
  background: #fff; width: 100%; max-width: 720px; max-height: 100%;
  overflow: auto; border-radius: var(--radius-md); padding: 16px;
  display: flex; align-items: center; justify-content: center; min-height: 120px;
  -webkit-overflow-scrolling: touch;
}
.v-text {
  font-family: Menlo, Consolas, 'Courier New', monospace;
  font-size: 13px; line-height: 1.6; color: #1c1c1e;
  white-space: pre-wrap; word-break: break-all; margin: 0; width: 100%;
}
.v-err { color: #FF3B30; font-size: 14px; text-align: center; }
/* ====== Toast ====== */
.lite-toast {
  position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.9); color: #fff;
  padding: 10px 18px; border-radius: var(--radius-pill); font-size: 13px;
  max-width: 86vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  z-index: 300;
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity 0.25s; }
.toast-fade-enter, .toast-fade-leave-to { opacity: 0; }
</style>
