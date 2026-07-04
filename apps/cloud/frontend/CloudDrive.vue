<template>
  <div class="cloud-drive">
    <AppNavBar title="我的云盘">
      <template slot="actions">
        <button v-if="selectMode" class="nav-action-btn" @click="exitSelectMode">取消</button>
        <button v-else class="nav-action-btn" @click="enterSelectMode" title="批量管理">
          <i class="fa-solid fa-list-check"></i>
        </button>
        <button class="nav-action-btn" @click="triggerUpload" title="上传">
          <i class="fa-solid fa-cloud-arrow-up"></i>
        </button>
      </template>
    </AppNavBar>

    <div class="cloud-content">
      <!-- 上传码卡片 -->
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

      <!-- 分组标签栏 -->
      <div class="folder-tabs">
        <div class="folder-tabs-scroll">
          <button
            class="folder-tab"
            :class="{ active: currentFolder === '' }"
            @click="switchFolder('')"
          >全部</button>
          <button
            class="folder-tab"
            :class="{ active: currentFolder === '__root__' }"
            @click="switchFolder('__root__')"
          >未分组</button>
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="folder-tab"
            :class="{ active: currentFolder === folder.name }"
            @click="switchFolder(folder.name)"
            @contextmenu.prevent="showFolderMenu($event, folder)"
          >
            <i v-if="folder.hide_from_all" class="fa-solid fa-eye-slash folder-hidden-icon" title="不在全部中显示"></i>
            {{ folder.name }}
            <span class="folder-count">{{ folder.file_count }}</span>
          </button>
        </div>
        <button class="folder-add-btn" @click="showCreateFolder = true" title="创建分组">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>

      <!-- 分组操作菜单 -->
      <div v-if="folderMenu.target" class="folder-context-menu" :style="folderMenu.style" @click.stop>
        <button @click="renameFolder(folderMenu.target)"><i class="fa-solid fa-pen"></i> 重命名</button>
        <button @click="toggleFolderHide(folderMenu.target)">
          <i :class="folderMenu.target.hide_from_all ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
          {{ folderMenu.target.hide_from_all ? '在全部中显示' : '不在全部里显示' }}
        </button>
        <button @click="shareFolder(folderMenu.target)"><i class="fa-solid fa-share-nodes"></i> 分享</button>
        <button class="danger" @click="deleteFolder(folderMenu.target)"><i class="fa-solid fa-trash"></i> 删除分组</button>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="skeleton-pulse"></div>
      </div>

      <div v-else-if="files.length === 0" class="empty-state">
        <i class="fa-solid fa-cloud"></i>
        <p>{{ currentFolder && currentFolder !== '__root__' ? '此分组为空' : '云盘为空' }}</p>
        <button class="upload-btn" @click="triggerUpload">上传文件</button>
      </div>

      <div v-else class="file-grid">
        <div
          v-for="file in files"
          :key="file.hash || file.name"
          class="file-card"
          :class="{ selected: isSelected(file) }"
          @click="onFileClick(file)"
        >
          <!-- 多选复选框 -->
          <div v-if="selectMode" class="file-check">
            <i :class="isSelected(file) ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'"></i>
          </div>
          <div class="file-preview">
            <img v-if="getMediaType(file) === 'image'" :src="file.url + '?w=300'" :alt="file.name" loading="lazy" />
            <div v-else-if="getMediaType(file) === 'video'" class="media-thumb video-thumb">
              <i class="fa-solid fa-play"></i>
              <span class="media-thumb-label">视频</span>
            </div>
            <div v-else-if="getMediaType(file) === 'audio'" class="media-thumb audio-thumb">
              <i class="fa-solid fa-music"></i>
              <span class="media-thumb-label">音频</span>
            </div>
            <div v-else class="media-thumb other-thumb">
              <i class="fa-solid fa-file"></i>
              <span class="media-thumb-label">文件</span>
            </div>
          </div>
          <div class="file-info">
            <span class="file-name">{{ file.display_name || file.name }}</span>
            <span class="file-size">{{ formatSize(file.size) }}</span>
          </div>
          <button v-if="!selectMode" class="file-delete" @click.stop="deleteFile(file)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 多选操作栏 -->
    <div v-if="selectMode && selectedHashes.length > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selectedHashes.length }} 个</span>
      <div class="batch-actions">
        <button @click="showBatchMove = true"><i class="fa-solid fa-folder-plus"></i> 移到分组</button>
        <button @click="createGroupFromSelection" v-if="currentFolder !== '__root__' || !currentFolder"><i class="fa-solid fa-layer-group"></i> 创建分组</button>
        <button class="danger" @click="batchDelete"><i class="fa-solid fa-trash"></i> 删除</button>
      </div>
    </div>

    <!-- 创建分组弹窗 -->
    <div v-if="showCreateFolder" class="modal-overlay" @click.self="showCreateFolder = false">
      <div class="modal-sheet">
        <h3>创建分组</h3>
        <input v-model="newFolderName" class="modal-input" placeholder="分组名称" maxlength="50" @keyup.enter="createFolder" />
        <div class="modal-actions">
          <button class="btn-cancel" @click="showCreateFolder = false">取消</button>
          <button class="btn-confirm" @click="createFolder" :disabled="!newFolderName.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- 批量移动到分组 -->
    <div v-if="showBatchMove" class="modal-overlay" @click.self="showBatchMove = false">
      <div class="modal-sheet">
        <h3>移动到分组</h3>
        <div class="modal-folder-list">
          <button class="modal-folder-option" @click="batchMove('')">
            <i class="fa-solid fa-folder-open"></i> 根目录（未分组）
          </button>
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="modal-folder-option"
            @click="batchMove(folder.name)"
          >
            <i class="fa-solid fa-folder"></i> {{ folder.name }}
            <span class="folder-opt-count">{{ folder.file_count }}</span>
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showBatchMove = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 分享弹窗 -->
    <div v-if="shareDialog.folder" class="modal-overlay" @click.self="shareDialog = {}">
      <div class="modal-sheet">
        <h3>分享分组「{{ shareDialog.folder.name }}」</h3>
        <div v-if="shareDialog.loading" class="share-loading">生成分享码中...</div>
        <div v-else class="share-code-display">
          <span class="share-code">{{ shareDialog.code }}</span>
          <button class="share-copy-btn" @click="copyShareCode">{{ shareDialog.copied ? '已复制' : '复制' }}</button>
        </div>
        <p class="share-hint">其他用户输入此 8 位码即可一键导入分组中所有文件</p>
        <div class="modal-actions">
          <button class="btn-confirm" @click="refreshShareCode">刷新分享码</button>
          <button class="btn-cancel" @click="shareDialog = {}">关闭</button>
        </div>
      </div>
    </div>

    <!-- 导入分组弹窗 -->
    <div class="import-section">
      <button class="import-btn" @click="showImport = true">
        <i class="fa-solid fa-download"></i> 导入分享分组
      </button>
    </div>
    <div v-if="showImport" class="modal-overlay" @click.self="showImport = false">
      <div class="modal-sheet">
        <h3>导入分享分组</h3>
        <input v-model="importCode" class="modal-input code-input" placeholder="输入 8 位分享码" maxlength="8" @input="importCode = importCode.toUpperCase()" />
        <div v-if="importPreview" class="import-preview">
          <div class="import-preview-header">
            <i class="fa-solid fa-folder"></i>
            <span>{{ importPreview.folder_name }}</span>
            <span class="import-owner">来自 {{ importPreview.owner_name }}</span>
          </div>
          <div class="import-preview-count">共 {{ importPreview.total_files }} 个文件</div>
          <div class="import-preview-files">
            <div v-for="f in importPreview.preview_files" :key="f.hash" class="import-preview-file">
              <i :class="getPreviewFileIcon(f.mime_type)"></i>
              <span>{{ f.name }}</span>
              <span class="import-file-size">{{ formatSize(f.size) }}</span>
            </div>
            <div v-if="importPreview.total_files > 20" class="import-more">...还有 {{ importPreview.total_files - 20 }} 个文件</div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showImport = false; importPreview = null">取消</button>
            <button class="btn-confirm" @click="doImport" :disabled="importing">
              {{ importing ? '导入中...' : '一键导入 ' + importPreview.total_files + ' 个文件' }}
            </button>
          </div>
        </div>
        <div v-else class="modal-actions">
          <button class="btn-cancel" @click="showImport = false">取消</button>
          <button class="btn-confirm" @click="previewImport" :disabled="importCode.length !== 8">查看</button>
        </div>
      </div>
    </div>

    <!-- 媒体预览 -->
    <div v-if="previewFile_data" class="preview-overlay" @click.self="closePreview">
      <img v-if="previewFile_data.type === 'image'" :src="previewFile_data.url + '?w=1200'" class="preview-img" />
      <video v-else-if="previewFile_data.type === 'video'" :src="previewFile_data.url" class="preview-video" controls autoplay></video>
      <div v-else-if="previewFile_data.type === 'audio'" class="preview-audio-wrap">
        <div class="audio-icon"><i class="fa-solid fa-music"></i></div>
        <audio :src="previewFile_data.url" controls autoplay></audio>
      </div>
      <button class="preview-close" @click="closePreview"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <!-- Toast 提示 -->
    <div v-if="toastMsg" class="cloud-toast">{{ toastMsg }}</div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
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
  if (lower.indexOf('__audio') > -1) return 'audio';
  if (lower.indexOf('__video') > -1) return 'video';
  if (lower.indexOf('__image') > -1) return 'image';
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
      folders: [],
      loading: true,
      previewFile_data: null,
      // 上传码
      uploadCode: '',
      uploadCodeCreatedAt: '',
      codeLoading: true,
      codeRefreshing: false,
      // 分组筛选
      currentFolder: '',
      // 多选
      selectMode: false,
      selectedHashes: [],
      // 弹窗
      showCreateFolder: false,
      newFolderName: '',
      showBatchMove: false,
      shareDialog: {},
      showImport: false,
      importCode: '',
      importPreview: null,
      importing: false,
      // 分组菜单
      folderMenu: { target: null, style: {} },
      // Toast
      toastMsg: '',
      toastTimer: null
    };
  },
  mounted: function() {
    this.loadFiles();
    this.loadFolders();
    this.loadUploadCode();
  },
  methods: {
    showToast: function(msg) {
      var self = this;
      self.toastMsg = msg;
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function() { self.toastMsg = ''; }, 2000);
    },

    // ====== 文件列表 ======
    loadFiles: function() {
      var self = this;
      self.loading = true;
      var params = {};
      if (self.currentFolder) params.folder = self.currentFolder;
      api.get('/cloud/files', { params: params }).then(function(res) {
        self.files = res.data.data.files || [];
        self.loading = false;
      }).catch(function() {
        self.loading = false;
      });
    },
    switchFolder: function(folder) {
      this.currentFolder = folder;
      this.exitSelectMode();
      this.closeFolderMenu();
      this.loadFiles();
    },

    // ====== 分组管理 ======
    loadFolders: function() {
      var self = this;
      api.get('/cloud/folders').then(function(res) {
        self.folders = res.data.data.folders || [];
      }).catch(function() {});
    },
    createFolder: function() {
      var self = this;
      var name = self.newFolderName.trim();
      if (!name) return;
      api.post('/cloud/folders', { name: name }).then(function(res) {
        if (res.data.code === 200) {
          self.showToast('分组「' + name + '」已创建');
          self.showCreateFolder = false;
          self.newFolderName = '';
          self.loadFolders();
        }
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '创建失败';
        self.showToast(msg);
      });
    },
    renameFolder: function(folder) {
      var self = this;
      self.closeFolderMenu();
      self.$modal.prompt({
        title: '重命名分组',
        message: '请输入新的分组名称：',
        defaultValue: folder.name,
        placeholder: '分组名称'
      }).then(function(newName) {
        if (newName === null || newName === false) return;
        if (!newName || newName.trim() === '' || newName.trim() === folder.name) return;
        api.put('/cloud/folders/' + folder.id, { name: newName.trim() }).then(function(res) {
          if (res.data.code === 200) {
            self.showToast('已重命名为「' + newName.trim() + '」');
            self.loadFolders();
            self.loadFiles();
          }
        }).catch(function(err) {
          self.showToast((err.response && err.response.data && err.response.data.message) || '重命名失败');
        });
      }).catch(function() {});
    },
    deleteFolder: function(folder) {
      var self = this;
      self.closeFolderMenu();
      self.$modal.confirm({ message: '删除分组「' + folder.name + '」？文件将移回未分组，不会丢失。' }).then(function(result) {
        if (!result) return;
        api.delete('/cloud/folders/' + folder.id).then(function() {
          self.showToast('分组已删除，文件已移回未分组');
          if (self.currentFolder === folder.name) self.currentFolder = '';
          self.loadFolders();
          self.loadFiles();
        }).catch(function() {
          self.showToast('删除失败');
        });
      });
    },
    showCreateFromSelection: function() {
      var self = this;
      self.$modal.prompt({
        title: '新建分组',
        message: '请输入新分组名称：',
        defaultValue: '',
        placeholder: '分组名称'
      }).then(function(name) {
        if (name === null || name === false) return;
        if (!name || !name.trim()) return;
        api.post('/cloud/folders', { name: name.trim() }).then(function(res) {
          if (res.data.code === 200) {
            self.batchMove(name.trim());
            self.loadFolders();
          }
        }).catch(function(err) {
          self.showToast((err.response && err.response.data && err.response.data.message) || '创建失败');
        });
      }).catch(function() {});
    },

    // ====== 分组菜单 ======
    showFolderMenu: function(event, folder) {
      var self = this;
      self.folderMenu.target = folder;
      self.folderMenu.style = { left: event.clientX + 'px', top: event.clientY + 'px' };
      // 全局点击关闭
      setTimeout(function() {
        document.addEventListener('click', self.closeFolderMenu, { once: true });
      }, 0);
    },
    closeFolderMenu: function() {
      this.folderMenu = { target: null, style: {} };
    },

    toggleFolderHide: function(folder) {
      var self = this;
      api.patch('/cloud/folders/' + folder.id + '/toggle-hide').then(function(res) {
        var data = res.data && res.data.data;
        folder.hide_from_all = data ? data.hide_from_all : !folder.hide_from_all;
        self.closeFolderMenu();
        self.showToast(folder.hide_from_all ? '已不在全部中显示' : '已在全部中显示');
        // 刷新文件列表以应用过滤
        self.loadFiles();
      }).catch(function() {
        self.showToast('操作失败');
      });
    },

    // ====== 多选 ======
    enterSelectMode: function() {
      this.selectMode = true;
      this.selectedHashes = [];
    },
    exitSelectMode: function() {
      this.selectMode = false;
      this.selectedHashes = [];
    },
    isSelected: function(file) {
      return this.selectedHashes.indexOf(file.hash || file.name) !== -1;
    },
    toggleSelect: function(file) {
      var id = file.hash || file.name;
      var idx = this.selectedHashes.indexOf(id);
      if (idx === -1) {
        this.selectedHashes.push(id);
      } else {
        this.selectedHashes.splice(idx, 1);
      }
    },
    onFileClick: function(file) {
      if (this.selectMode) {
        this.toggleSelect(file);
      } else {
        this.previewFile(file);
      }
    },

    // ====== 批量操作 ======
    batchMove: function(targetFolder) {
      var self = this;
      self.showBatchMove = false;
      api.post('/cloud/files/batch-move', {
        hashes: self.selectedHashes,
        folder: targetFolder
      }).then(function(res) {
        if (res.data.code === 200) {
          self.showToast('已移动 ' + res.data.data.moved + ' 个文件');
          self.exitSelectMode();
          self.loadFiles();
          self.loadFolders();
        }
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '移动失败');
      });
    },
    createGroupFromSelection: function() {
      this.showCreateFromSelection();
    },
    batchDelete: function() {
      var self = this;
      var ownerCount = 0;
      var items = self.selectedHashes.map(function(hash) {
        var file = self.files.find(function(f) { return (f.hash || f.name) === hash; });
        return { hash: hash, is_owner: file ? file.is_owner : false };
      });
      ownerCount = items.filter(function(i) { return i.is_owner; }).length;
      var msg = '确认删除选中的 ' + self.selectedHashes.length + ' 个文件？';
      if (ownerCount > 0) msg += '\n（其中 ' + ownerCount + ' 个为你上传的文件，删除后其他人也将无法访问）';

      self.$modal.confirm({ message: msg }).then(function(result) {
        if (!result) return;
        api.post('/cloud/files/batch-delete', { items: items }).then(function(res) {
          if (res.data.code === 200) {
            self.showToast('已删除 ' + res.data.data.deleted + ' 个文件');
            self.exitSelectMode();
            self.loadFiles();
            self.loadFolders();
          }
        }).catch(function() {
          self.showToast('删除失败');
        });
      });
    },

    // ====== 分享 ======
    shareFolder: function(folder) {
      var self = this;
      self.closeFolderMenu();
      self.shareDialog = { folder: folder, loading: true, code: '', copied: false };
      api.post('/cloud/folders/' + folder.id + '/share').then(function(res) {
        if (res.data.code === 200) {
          self.shareDialog.loading = false;
          self.shareDialog.code = res.data.data.share_code;
        }
      }).catch(function() {
        self.shareDialog = {};
        self.showToast('生成分享码失败');
      });
    },
    refreshShareCode: function() {
      var self = this;
      var folder = self.shareDialog.folder;
      self.shareDialog.loading = true;
      api.post('/cloud/folders/' + folder.id + '/share').then(function(res) {
        if (res.data.code === 200) {
          self.shareDialog.loading = false;
          self.shareDialog.code = res.data.data.share_code;
          self.shareDialog.copied = false;
        }
      }).catch(function() {
        self.showToast('刷新失败');
      });
    },
    copyShareCode: function() {
      var self = this;
      var code = self.shareDialog.code;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(function() {
          self.shareDialog.copied = true;
        }).catch(function() {});
      } else {
        // Fallback
        var input = document.createElement('input');
        input.value = code;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        self.shareDialog.copied = true;
      }
    },

    // ====== 导入 ======
    previewImport: function() {
      var self = this;
      if (self.importCode.length !== 8) return;
      api.get('/cloud/folders/shared/' + self.importCode).then(function(res) {
        if (res.data.code === 200) {
          self.importPreview = res.data.data;
        }
      }).catch(function(err) {
        self.showToast((err.response && err.response.data && err.response.data.message) || '查询失败');
      });
    },
    doImport: function() {
      var self = this;
      self.importing = true;
      api.post('/cloud/folders/import/' + self.importCode).then(function(res) {
        if (res.data.code === 200) {
          self.showToast('导入成功！' + res.data.data.imported + ' 个文件已添加到分组「' + res.data.data.folder_name + '」');
          self.showImport = false;
          self.importCode = '';
          self.importPreview = null;
          self.importing = false;
          self.loadFolders();
          self.loadFiles();
        }
      }).catch(function(err) {
        self.importing = false;
        self.showToast((err.response && err.response.data && err.response.data.message) || '导入失败');
      });
    },
    getPreviewFileIcon: function(mimeType) {
      if (!mimeType) return 'fa-solid fa-file';
      if (mimeType.indexOf('image/') === 0) return 'fa-solid fa-image';
      if (mimeType.indexOf('video/') === 0) return 'fa-solid fa-video';
      if (mimeType.indexOf('audio/') === 0) return 'fa-solid fa-music';
      return 'fa-solid fa-file';
    },

    // ====== 上传码 ======
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

    // ====== 文件操作 ======
    getMediaType: function(file) { return getMediaType(file); },
    triggerUpload: function() { this.$router.push('/cloud-upload'); },
    deleteFile: function(file) {
      var self = this;
      var confirmMsg = file.is_owner
        ? '作为文件上传者，删除后所有转存此文件的用户也会失去访问权。确认删除？'
        : '确认从云盘移除此文件？（仅取消你的收藏，不影响其他人）';
      self.$modal.confirm({ message: confirmMsg }).then(function(result) {
        if (!result) return;
        var deleteParam = file.hash || file.name;
        api.delete('/cloud/files/' + encodeURIComponent(deleteParam)).then(function(res) {
          if (res.data.code === 200) {
            self.files = self.files.filter(function(f) { return (f.hash || f.name) !== (file.hash || file.name); });
            self.$store.commit('toast/SHOW_TOAST', { message: res.data.owner_delete ? '文件已删除（所有引用已清除）' : '已移除', type: 'success' });
          }
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
        });
      });
    },
    previewFile: function(file) {
      var type = getMediaType(file);
      if (type === 'other') {
        this.$store.commit('toast/SHOW_TOAST', { message: '暂不支持预览此文件类型', type: 'info' });
        return;
      }
      this.previewFile_data = { url: file.url, type: type, name: file.display_name || file.name };
    },
    closePreview: function() { this.previewFile_data = null; },
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
  position: relative;
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
  padding: 16px 16px 80px;
  -webkit-overflow-scrolling: touch;
}

/* 上传码 */
.upload-code-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 12px;
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
.upload-code-title i { color: var(--primary-color); }
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
.tips-content { flex: 1; }
.tips-content p {
  margin: 0 0 4px 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}
.tips-warn { color: var(--warning-color, #ff9500) !important; }

/* 分组标签栏 */
.folder-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 12px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 8px;
  box-shadow: var(--shadow-sm);
}
.folder-tabs-scroll {
  flex: 1;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.folder-tabs-scroll::-webkit-scrollbar { display: none; }
.folder-tab {
  flex-shrink: 0;
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.folder-tab.active {
  background: var(--primary-color);
  color: #fff;
}
.folder-tab:active { transform: scale(0.95); }
.folder-hidden-icon {
  margin-right: 2px;
  font-size: 9px;
  opacity: 0.5;
}
.folder-count {
  margin-left: 4px;
  font-size: var(--font-size-caption2);
  opacity: 0.7;
}
.folder-add-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px dashed var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  transition: all 0.15s;
}
.folder-add-btn:hover { border-color: var(--primary-color); color: var(--primary-color); }

/* 分组右键菜单 */
.folder-context-menu {
  position: fixed;
  z-index: 9998;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 4px 0;
  min-width: 140px;
}
.folder-context-menu button {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  text-align: left;
  cursor: pointer;
}
.folder-context-menu button:hover { background: var(--bg-color-secondary); }
.folder-context-menu button.danger { color: var(--danger-color, #ff3b30); }
.folder-context-menu button i { width: 20px; margin-right: 6px; text-align: center; }

/* 文件网格 */
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
.empty-state i { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
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
  transition: transform 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.file-card:active { transform: scale(0.97); }
.file-card.selected { box-shadow: 0 0 0 3px var(--primary-color); }
.file-check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  font-size: 22px;
  color: var(--primary-color);
  background: rgba(255,255,255,0.9);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-preview {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-color-secondary);
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
.media-thumb i { font-size: 36px; opacity: 0.9; }
.media-thumb-label { font-size: var(--font-size-caption2); opacity: 0.8; }
.file-info { padding: 8px; }
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

/* 批量操作栏 */
.batch-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--card-bg);
  border-top: 1px solid var(--border-color);
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
  box-shadow: var(--shadow-lg);
}
.batch-count {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}
.batch-actions {
  display: flex;
  gap: 8px;
}
.batch-actions button {
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  background: var(--primary-light);
  color: var(--primary-color);
}
.batch-actions button.danger {
  background: rgba(255,59,48,0.1);
  color: var(--danger-color, #ff3b30);
}
.batch-actions button:active { opacity: 0.7; }

/* 弹窗 */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  z-index: 9999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.modal-sheet {
  background: var(--card-bg);
  width: 100%;
  max-width: 500px;
  max-height: 70vh;
  border-radius: 16px 16px 0 0;
  padding: 20px;
  overflow-y: auto;
}
.modal-sheet h3 {
  margin: 0 0 16px;
  font-size: var(--font-size-headline);
  text-align: center;
}
.modal-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  margin-bottom: 16px;
}
.modal-input:focus { outline: none; border-color: var(--primary-color); }
.code-input {
  text-align: center;
  font-size: 24px;
  letter-spacing: 8px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.modal-actions button {
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  cursor: pointer;
}
.btn-cancel { background: var(--bg-color-secondary); color: var(--text-secondary); }
.btn-confirm { background: var(--primary-color); color: #fff; }
.btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

/* 移动分组弹窗 */
.modal-folder-list {
  max-height: 40vh;
  overflow-y: auto;
  margin-bottom: 12px;
}
.modal-folder-option {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 14px 16px;
  border: none;
  border-bottom: 1px solid var(--border-color-light, var(--border-color));
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
  cursor: pointer;
  text-align: left;
}
.modal-folder-option:hover { background: var(--bg-color-secondary); }
.modal-folder-option i { margin-right: 10px; color: var(--primary-color); }
.folder-opt-count { margin-left: auto; font-size: var(--font-size-caption2); color: var(--text-secondary); }

/* 分享弹窗 */
.share-loading { text-align: center; padding: 20px; color: var(--text-secondary); }
.share-code-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-color-secondary);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
}
.share-code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--primary-color);
}
.share-copy-btn {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.share-hint {
  text-align: center;
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  margin-bottom: 12px;
}

/* 导入 */
.import-section {
  padding: 0 16px 20px;
  text-align: center;
}
.import-btn {
  padding: 10px 20px;
  border: 1.5px dashed var(--border-color);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
  cursor: pointer;
  width: 100%;
  transition: all 0.15s;
}
.import-btn:hover { border-color: var(--primary-color); color: var(--primary-color); }
.import-btn i { margin-right: 6px; }
.import-preview { margin-bottom: 12px; }
.import-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--bg-color-secondary);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  font-size: var(--font-size-body);
  font-weight: 600;
}
.import-owner {
  margin-left: auto;
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  font-weight: normal;
}
.import-preview-count {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.import-preview-files {
  max-height: 30vh;
  overflow-y: auto;
  margin-bottom: 12px;
}
.import-preview-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color-light, var(--border-color));
  font-size: var(--font-size-sm);
}
.import-preview-file i { color: var(--primary-color); width: 20px; }
.import-file-size { margin-left: auto; color: var(--text-secondary); font-size: var(--font-size-caption2); }
.import-more { text-align: center; padding: 8px; font-size: var(--font-size-caption2); color: var(--text-secondary); }

/* 预览 */
.preview-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.9);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-img { max-width: 95%; max-height: 95%; object-fit: contain; }
.preview-video { max-width: 95%; max-height: 95%; }
.preview-audio-wrap { display: flex; flex-direction: column; align-items: center; gap: 24px; }
.audio-icon {
  width: 96px; height: 96px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8e44ad, #9b59b6);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 40px;
}
.preview-audio-wrap audio { width: 320px; max-width: 90vw; }
.preview-close {
  position: absolute; top: 20px; right: 20px;
  width: 40px; height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  color: #fff; border: none; font-size: 20px;
  cursor: pointer;
}

/* Toast */
.cloud-toast {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 24px;
  background: rgba(0,0,0,0.8);
  color: #fff;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-body);
  z-index: 10002;
  animation: toast-in 0.2s ease;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>
