<template>
  <div class="cloud-upload-page">
    <div class="upload-header">
      <button class="back-btn" @click="$router.go(-1)" aria-label="返回">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <h2>上传到云盘</h2>
    </div>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button class="mode-tab" :class="{ active: mode === 'file' }" @click="switchMode('file')">
        <i class="fa-solid fa-file-arrow-up"></i>
        <span>文件</span>
      </button>
      <button class="mode-tab" :class="{ active: mode === 'audio' }" @click="switchMode('audio')">
        <i class="fa-solid fa-microphone"></i>
        <span>录音</span>
      </button>
      <button class="mode-tab" :class="{ active: mode === 'video' }" @click="switchMode('video')">
        <i class="fa-solid fa-video"></i>
        <span>录像</span>
      </button>
    </div>

    <!-- 文件上传模式 -->
    <div v-if="mode === 'file'" class="mode-content">
      <input ref="fileInput" type="file" accept="image/*,audio/*,video/*" multiple style="display:none" @change="onFileSelect" />
      <div v-if="!uploading && !uploaded && selectedFiles.length === 0" class="upload-actions">
        <button class="upload-action-btn" @click="takePhoto">
          <i class="fa-solid fa-camera"></i>
          <span>拍照上传</span>
        </button>
        <button class="upload-action-btn" @click="selectFromAlbum">
          <i class="fa-solid fa-images"></i>
          <span>从相册选择</span>
        </button>
        <button class="upload-action-btn" @click="$refs.fileInput.click()">
          <i class="fa-solid fa-file"></i>
          <span>选择文件</span>
        </button>
      </div>
      <div v-if="selectedFiles.length > 0" class="file-list">
        <div v-for="(f, i) in selectedFiles" :key="i" class="file-item">
          <div class="file-item-icon">
            <i :class="getFileIcon(f)"></i>
          </div>
          <div class="file-item-info">
            <span class="file-item-name">{{ f.name }}</span>
            <span class="file-item-size">{{ formatSize(f.size) }}</span>
          </div>
          <button class="file-item-remove" @click="removeFile(i)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="file-actions">
          <button class="action-btn-secondary" @click="$refs.fileInput.click()">添加更多</button>
          <button class="action-btn-primary" :disabled="uploading" @click="uploadFiles">
            <span v-if="uploading" class="btn-loading-small"></span>
            <span v-else>上传 {{ selectedFiles.length }} 个文件</span>
          </button>
        </div>
      </div>
      <div v-if="uploading" class="upload-loading">
        <div class="upload-spinner"></div>
        <p>正在上传...</p>
      </div>
      <div v-if="uploaded" class="upload-success">
        <i class="fa-solid fa-circle-check"></i>
        <p>上传成功！</p>
        <button class="upload-again" @click="uploaded = false">继续上传</button>
      </div>
    </div>

    <!-- 录音模式 -->
    <div v-if="mode === 'audio'" class="mode-content">
      <div v-if="!mediaRecorderSupported" class="not-supported">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>当前浏览器不支持录音功能</p>
      </div>
      <div v-else-if="!audioBlob" class="record-area">
        <div class="record-timer" :class="{ recording: audioRecording, paused: audioPaused }">
          {{ formatTime(recordSeconds) }}
        </div>
        <canvas ref="audioWaveform" class="audio-waveform" width="600" height="80"></canvas>
        <div class="record-pulse-wrap">
          <div class="record-pulse" :class="{ active: audioRecording && !audioPaused }"></div>
          <button class="record-btn" :class="{ recording: audioRecording }" @click="toggleAudioRecord">
            <i :class="audioRecording ? 'fa-solid fa-stop' : 'fa-solid fa-microphone'"></i>
          </button>
        </div>
        <button v-if="audioRecording" class="pause-btn" @click="toggleAudioPause">
          <i :class="audioPaused ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
          <span>{{ audioPaused ? '继续' : '暂停' }}</span>
        </button>
        <p class="record-hint" v-if="!audioRecording">点击按钮开始录音</p>
        <p class="record-hint" v-else-if="audioPaused">已暂停，点击继续录音</p>
        <p class="record-hint" v-else>录音中...</p>
      </div>
      <div v-else class="record-preview">
        <div class="preview-label">
          <i class="fa-solid fa-music"></i>
          <span>录音完成</span>
        </div>
        <audio :src="audioUrl" controls class="preview-audio"></audio>
        <div class="preview-actions">
          <button class="action-btn-secondary" @click="resetAudio">重录</button>
          <button class="action-btn-primary" :disabled="uploading" @click="uploadAudio">
            <span v-if="uploading" class="btn-loading-small"></span>
            <span v-else>上传录音</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 录像模式 - 全屏相机（未录制时） -->
    <div v-if="mode === 'video' && mediaRecorderSupported && !videoBlob" class="video-fullscreen">
      <video ref="videoPreview" autoplay muted playsinline></video>
      <div class="vf-top-bar">
        <div v-if="videoRecording" class="vf-rec-badge">
          <span class="rec-dot"></span>
          <span>{{ formatTime(recordSeconds) }}</span>
        </div>
      </div>
      <div v-if="!videoRecording && cameraReady && !videoError" class="vf-hint">点击按钮开始录像</div>
      <div v-else-if="videoRecording && !videoPaused" class="vf-hint">录像中</div>
      <div v-else-if="videoPaused" class="vf-hint">已暂停</div>
      <div v-if="videoError" class="vf-error">
        <i class="fa-solid fa-video-slash"></i>
        <p>{{ videoError }}</p>
        <button class="vf-error-btn" @click="startCamera">重试</button>
      </div>
      <div class="vf-bottom-bar">
        <div class="vf-side-slot">
          <button v-if="!videoRecording && cameraReady" class="vf-side-btn" @click="switchCamera">
            <i class="fa-solid fa-camera-rotate"></i>
            <span>翻转</span>
          </button>
        </div>
        <button class="vf-record-btn" :class="{ recording: videoRecording }" @click="toggleVideoRecord">
          <span class="vf-btn-inner"></span>
        </button>
        <div class="vf-side-slot">
          <button v-if="videoRecording" class="vf-side-btn" @click="toggleVideoPause">
            <i :class="videoPaused ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
            <span>{{ videoPaused ? '继续' : '暂停' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 录像模式 - 预览/不支持 -->
    <div v-if="mode === 'video'" class="mode-content">
      <div v-if="!mediaRecorderSupported" class="not-supported">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>当前浏览器不支持录像功能</p>
      </div>
      <div v-if="videoBlob" class="record-preview">
        <div class="preview-label">
          <i class="fa-solid fa-film"></i>
          <span>录像完成</span>
        </div>
        <video :src="videoUrl" controls class="preview-video"></video>
        <div class="preview-actions">
          <button class="action-btn-secondary" @click="resetVideo">重录</button>
          <button class="action-btn-primary" :disabled="uploading" @click="uploadVideo">
            <span v-if="uploading" class="btn-loading-small"></span>
            <span v-else>上传视频</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 上传遮罩 -->
    <div v-if="uploading && mode !== 'file'" class="upload-overlay">
      <div class="upload-progress-box">
        <div v-if="uploadProgress > 0" class="upload-progress-bar">
          <div class="upload-progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <div v-else class="upload-spinner"></div>
        <span>{{ uploadProgress > 0 ? '上传中 ' + uploadProgress + '%' : '正在上传...' }}</span>
      </div>
    </div>

    <!-- Toast -->
    <transition name="toast-fade">
      <div v-if="toastMsg" class="toast-msg" :class="toastType">{{ toastMsg }}</div>
    </transition>

    <input ref="cameraInput" type="file" accept="image/*" capture="environment" style="display:none" @change="handleFile" />
  </div>
</template>

<script>
import api from '@/utils/api';
import { isMediaRecorderSupported, pickMimeTypes, extFromMime, getMediaTypeByName, getMediaError, getAudioConstraints, getVideoAudioConstraints } from '@/utils/media-recorder.js';

export default {
  name: 'CloudUpload',
  data: function() {
    return {
      mode: 'file',
      uploading: false,
      uploaded: false,
      uploadProgress: 0,
      toastMsg: '',
      toastType: 'success',
      toastTimer: null,
      // 文件上传
      selectedFiles: [],
      // 录音
      audioRecording: false,
      audioPaused: false,
      audioBlob: null,
      audioUrl: '',
      audioRecorder: null,
      audioChunks: [],
      audioStream: null,
      audioAnalyser: null,
      audioContext: null,
      waveformRaf: null,
      // 录像
      videoRecording: false,
      videoPaused: false,
      videoBlob: null,
      videoUrl: '',
      videoRecorder: null,
      videoChunks: [],
      videoStream: null,
      cameraReady: false,
      facingMode: 'user',
      videoError: '',
      // 计时器
      recordSeconds: 0,
      recordTimer: null
    };
  },
  computed: {
    mediaRecorderSupported: function() {
      return isMediaRecorderSupported();
    }
  },
  beforeDestroy: function() {
    this.cleanupAudio();
    this.cleanupVideo();
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  },
  methods: {
    // ===== 通用 =====
    showToast: function(msg, type) {
      var self = this;
      self.toastMsg = msg;
      self.toastType = type || 'success';
      if (self.toastTimer) clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function() {
        self.toastMsg = '';
      }, 2500);
    },
    formatTime: function(s) {
      var m = Math.floor(s / 60);
      var sec = s % 60;
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return pad(m) + ':' + pad(sec);
    },
    formatSize: function(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    },
    getFileIcon: function(f) {
      var type = getMediaTypeByName(f.name);
      if (type === 'image') return 'fa-solid fa-image';
      if (type === 'video') return 'fa-solid fa-film';
      if (type === 'audio') return 'fa-solid fa-music';
      return 'fa-solid fa-file';
    },

    // ===== 模式切换 =====
    switchMode: function(m) {
      if (this.mode === m) return;
      if (this.mode === 'audio') this.cleanupAudio();
      if (this.mode === 'video') this.cleanupVideo();
      this.mode = m;
      this.uploaded = false;
      // 等待 DOM 渲染完成（videoPreview ref 才存在）再启动摄像头
      if (m === 'video' && !this.videoBlob) {
        var self = this;
        this.$nextTick(function() {
          self.startCamera();
        });
      }
    },

    // ===== 文件上传 =====
    takePhoto: function() {
      if (window.AndroidJSBridge && window.AndroidJSBridge.takePhoto) {
        window.AndroidJSBridge.takePhoto();
      } else {
        this.$refs.cameraInput.setAttribute('capture', 'environment');
        this.$refs.cameraInput.click();
      }
    },
    selectFromAlbum: function() {
      this.$refs.cameraInput.removeAttribute('capture');
      this.$refs.cameraInput.click();
    },
    onFileSelect: function(e) {
      var files = e.target.files;
      for (var i = 0; i < files.length; i++) {
        this.selectedFiles.push(files[i]);
      }
      e.target.value = '';
    },
    removeFile: function(idx) {
      this.selectedFiles.splice(idx, 1);
    },
    handleFile: function(e) {
      var self = this;
      var file = e.target.files[0];
      if (!file) return;
      self.selectedFiles.push(file);
      e.target.value = '';
    },
    uploadFiles: function() {
      var self = this;
      if (self.selectedFiles.length === 0) return;
      self.uploading = true;
      var completed = 0;
      var failed = 0;
      var total = self.selectedFiles.length;

      function onDone() {
        completed++;
        if (completed >= total) {
          self.uploading = false;
          if (failed > 0) {
            self.showToast('上传完成，' + failed + ' 个失败', 'error');
          } else {
            self.uploaded = true;
            self.selectedFiles = [];
            self.showToast('全部上传成功', 'success');
          }
        }
      }

      for (var i = 0; i < total; i++) {
        (function(file) {
          var formData = new FormData();
          // mediaType 必须在 file 之前，否则 multer 中 req.body 为空
          formData.append('mediaType', getMediaTypeByName(file.name));
          formData.append('file', file);
          api.post('/cloud/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000
          }).then(function() {
            onDone();
          }).catch(function() {
            failed++;
            onDone();
          });
        })(self.selectedFiles[i]);
      }
    },

    // ===== 录音 =====
    toggleAudioRecord: function() {
      if (this.audioRecording) {
        this.stopAudioRecord();
      } else {
        this.startAudioRecord();
      }
    },
    startAudioRecord: function() {
      var self = this;
      if (!isMediaRecorderSupported()) {
        self.showToast('浏览器不支持录音', 'error');
        return;
      }
      if (!window.isSecureContext) {
        self.showToast('录音需要 HTTPS 安全环境', 'error');
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false }).then(function(stream) {
        self.audioStream = stream;
        self.audioChunks = [];
        // 创建 AnalyserNode 用于波形可视化
        try {
          var AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            self.audioContext = new AudioCtx();
            var source = self.audioContext.createMediaStreamSource(stream);
            var analyser = self.audioContext.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.7;
            source.connect(analyser);
            self.audioAnalyser = analyser;
          }
        } catch (e) {}
        var mime = pickMimeTypes('audio');
        var options = { audioBitsPerSecond: 192000 }; // 192kbps 高质量语音
        if (mime) options.mimeType = mime;
        var recorder = new MediaRecorder(stream, options);
        recorder.ondataavailable = function(e) {
          if (e.data && e.data.size > 0) {
            self.audioChunks.push(e.data);
          }
        };
        recorder.onstop = function() {
          var type = mime || 'audio/webm';
          self.audioBlob = new Blob(self.audioChunks, { type: type });
          self.audioUrl = URL.createObjectURL(self.audioBlob);
          self.cleanupAudioStream();
        };
        recorder.start(1000);
        self.audioRecorder = recorder;
        self.audioRecording = true;
        self.audioPaused = false;
        self.recordSeconds = 0;
        self.startTimer();
        self.$nextTick(function() {
          self.startWaveform();
        });
      }).catch(function(err) {
        self.showToast(getMediaError(err), 'error');
      });
    },
    stopAudioRecord: function() {
      this.stopWaveform();
      if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
        this.audioRecorder.stop();
      }
      this.audioRecording = false;
      this.audioPaused = false;
      this.stopTimer();
    },
    toggleAudioPause: function() {
      if (!this.audioRecorder) return;
      if (this.audioPaused) {
        this.audioRecorder.resume();
        this.audioPaused = false;
        this.startTimer();
        this.startWaveform();
      } else {
        this.audioRecorder.pause();
        this.audioPaused = true;
        this.stopTimer();
        this.stopWaveform();
      }
    },
    // 波形可视化绘制
    startWaveform: function() {
      var self = this;
      if (!self.audioAnalyser) return;
      var canvas = self.$refs.audioWaveform;
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var bufferLength = self.audioAnalyser.frequencyBinCount;
      var dataArray = new Uint8Array(bufferLength);

      function draw() {
        if (!self.audioAnalyser || !self.audioRecording || self.audioPaused) {
          return;
        }
        self.waveformRaf = requestAnimationFrame(draw);
        self.audioAnalyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var barCount = Math.min(bufferLength, 48);
        var gap = 2;
        var barWidth = (canvas.width - gap * (barCount - 1)) / barCount;
        for (var i = 0; i < barCount; i++) {
          var value = dataArray[i];
          var barHeight = Math.max(2, (value / 255) * canvas.height);
          var x = i * (barWidth + gap);
          var y = (canvas.height - barHeight) / 2;
          var alpha = 0.4 + (value / 255) * 0.6;
          ctx.fillStyle = self.audioPaused ? 'rgba(255, 149, 0, ' + alpha + ')'
                                            : 'rgba(255, 59, 48, ' + alpha + ')';
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      }
      draw();
    },
    stopWaveform: function() {
      if (this.waveformRaf) {
        cancelAnimationFrame(this.waveformRaf);
        this.waveformRaf = null;
      }
      var canvas = this.$refs.audioWaveform;
      if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    resetAudio: function() {
      this.stopWaveform();
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioBlob = null;
      this.audioUrl = '';
      this.audioChunks = [];
      this.recordSeconds = 0;
    },
    cleanupAudioStream: function() {
      if (this.audioStream) {
        var tracks = this.audioStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          tracks[i].stop();
        }
        this.audioStream = null;
      }
    },
    cleanupAudio: function() {
      this.stopTimer();
      this.stopWaveform();
      if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
        try { this.audioRecorder.stop(); } catch (e) {}
      }
      this.cleanupAudioStream();
      if (this.audioContext) {
        try { this.audioContext.close(); } catch (e) {}
        this.audioContext = null;
      }
      this.audioAnalyser = null;
      this.audioRecording = false;
      this.audioPaused = false;
    },
    uploadAudio: function() {
      var self = this;
      if (!self.audioBlob) return;
      self.uploading = true;
      self.uploadProgress = 0;
      var ext = extFromMime(self.audioBlob.type, 'audio');
      var filename = 'recording_' + Date.now() + ext;
      var file = new File([self.audioBlob], filename, { type: self.audioBlob.type });
      var formData = new FormData();
      // mediaType 必须在 file 之前，否则 multer 中 req.body 为空
      formData.append('mediaType', 'audio');
      formData.append('file', file);
      api.post('/cloud/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
        onUploadProgress: function(e) {
          if (e.lengthComputable) {
            self.uploadProgress = Math.round((e.loaded / e.total) * 100);
          }
        }
      }).then(function() {
        self.uploading = false;
        self.uploadProgress = 0;
        self.showToast('录音上传成功', 'success');
        self.resetAudio();
      }).catch(function(err) {
        self.uploading = false;
        self.uploadProgress = 0;
        var msg = (err.response && err.response.data && err.response.data.message) || '上传失败，请重试';
        self.showToast(msg, 'error');
      });
    },

    // ===== 录像 =====
    startCamera: function() {
      var self = this;
      self.videoError = '';
      self.cameraReady = false;
      if (!isMediaRecorderSupported()) {
        self.videoError = '浏览器不支持录像';
        return;
      }
      if (!window.isSecureContext) {
        self.videoError = '录像需要 HTTPS 安全环境';
        return;
      }
      var constraints = {
        video: { facingMode: self.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: getVideoAudioConstraints()
      };
      navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
        self.videoStream = stream;
        var video = self.$refs.videoPreview;
        if (video) {
          video.srcObject = stream;
          video.play().catch(function() {});
        }
        self.cameraReady = true;
      }).catch(function(err) {
        self.videoError = getMediaError(err);
      });
    },
    switchCamera: function() {
      this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
      this.cleanupVideoStream();
      this.cameraReady = false;
      this.startCamera();
    },
    toggleVideoRecord: function() {
      if (this.videoRecording) {
        this.stopVideoRecord();
      } else {
        this.startVideoRecord();
      }
    },
    startVideoRecord: function() {
      var self = this;
      if (!self.videoStream) {
        self.showToast('摄像头未就绪', 'error');
        return;
      }
      self.videoChunks = [];
      var mime = pickMimeTypes('video');
      var options = { videoBitsPerSecond: 6000000, audioBitsPerSecond: 192000 }; // 6Mbps 1080p 画质 + 192kbps 音质
      if (mime) options.mimeType = mime;
      try {
        var recorder = new MediaRecorder(self.videoStream, options);
      } catch (e) {
        self.showToast('无法启动录像：' + e.message, 'error');
        return;
      }
      recorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) {
          self.videoChunks.push(e.data);
        }
      };
      recorder.onstop = function() {
        var type = mime || 'video/webm';
        self.videoBlob = new Blob(self.videoChunks, { type: type });
        self.videoUrl = URL.createObjectURL(self.videoBlob);
        self.cleanupVideoStream();
        self.cameraReady = false;
      };
      recorder.start(1000);
      self.videoRecorder = recorder;
      self.videoRecording = true;
      self.videoPaused = false;
      self.recordSeconds = 0;
      self.startTimer();
    },
    stopVideoRecord: function() {
      if (this.videoRecorder && this.videoRecorder.state !== 'inactive') {
        this.videoRecorder.stop();
      }
      this.videoRecording = false;
      this.videoPaused = false;
      this.stopTimer();
    },
    toggleVideoPause: function() {
      if (!this.videoRecorder) return;
      if (this.videoPaused) {
        this.videoRecorder.resume();
        this.videoPaused = false;
        this.startTimer();
      } else {
        this.videoRecorder.pause();
        this.videoPaused = true;
        this.stopTimer();
      }
    },
    resetVideo: function() {
      if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
      this.videoBlob = null;
      this.videoUrl = '';
      this.videoChunks = [];
      this.recordSeconds = 0;
      // 等待 DOM 渲染回 video-area（videoPreview ref 恢复）再启动摄像头
      var self = this;
      this.$nextTick(function() {
        self.startCamera();
      });
    },
    cleanupVideoStream: function() {
      if (this.videoStream) {
        var tracks = this.videoStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          tracks[i].stop();
        }
        this.videoStream = null;
      }
      var video = this.$refs.videoPreview;
      if (video) video.srcObject = null;
    },
    cleanupVideo: function() {
      this.stopTimer();
      if (this.videoRecorder && this.videoRecorder.state !== 'inactive') {
        try { this.videoRecorder.stop(); } catch (e) {}
      }
      this.cleanupVideoStream();
      this.videoRecording = false;
      this.videoPaused = false;
      this.cameraReady = false;
    },
    uploadVideo: function() {
      var self = this;
      if (!self.videoBlob) return;
      self.uploading = true;
      self.uploadProgress = 0;
      var ext = extFromMime(self.videoBlob.type, 'video');
      var filename = 'video_' + Date.now() + ext;
      var file = new File([self.videoBlob], filename, { type: self.videoBlob.type });
      var formData = new FormData();
      // mediaType 必须在 file 之前，否则 multer 中 req.body 为空
      formData.append('mediaType', 'video');
      formData.append('file', file);
      api.post('/cloud/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
        onUploadProgress: function(e) {
          if (e.lengthComputable) {
            self.uploadProgress = Math.round((e.loaded / e.total) * 100);
          }
        }
      }).then(function() {
        self.uploading = false;
        self.uploadProgress = 0;
        self.showToast('视频上传成功', 'success');
        self.resetVideo();
      }).catch(function(err) {
        self.uploading = false;
        self.uploadProgress = 0;
        var msg = (err.response && err.response.data && err.response.data.message) || '上传失败，请重试';
        self.showToast(msg, 'error');
      });
    },

    // ===== 计时器 =====
    startTimer: function() {
      var self = this;
      self.stopTimer();
      self.recordTimer = setInterval(function() {
        self.recordSeconds++;
      }, 1000);
    },
    stopTimer: function() {
      if (this.recordTimer) {
        clearInterval(this.recordTimer);
        this.recordTimer = null;
      }
    }
  }
};
</script>

<style scoped>
.cloud-upload-page {
  height: 100%;
  background: var(--bg-color, #f2f2f7);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.upload-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--card-bg, #fff);
  border-bottom: 0.5px solid var(--separator-color, #e5e5ea);
  position: relative;
}
.upload-header h2 {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--font-size-title3, 17px);
  font-weight: 600;
  margin: 0;
}
.back-btn {
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--primary-color, #007aff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.back-btn:active { transform: scale(0.92); opacity: 0.7; }

/* 模式切换 */
.mode-tabs {
  display: flex;
  background: var(--card-bg, #fff);
  border-bottom: 0.5px solid var(--separator-color, #e5e5ea);
}
.mode-tab {
  flex: 1;
  padding: 12px 0;
  background: transparent;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary, #8e8e93);
  cursor: pointer;
  transition: color 0.2s;
  border-bottom: 2px solid transparent;
}
.mode-tab i { font-size: 20px; }
.mode-tab span { font-size: var(--font-size-sm, 13px); }
.mode-tab.active {
  color: var(--primary-color, #007aff);
  border-bottom-color: var(--primary-color, #007aff);
}
.mode-tab:active { opacity: 0.7; }

/* 模式内容 */
.mode-content {
  flex: 1;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* 文件上传 */
.upload-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  padding-top: 20px;
}
.upload-action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 20px;
  background: var(--card-bg, #fff);
  border: none;
  border-radius: var(--radius-xl, 16px);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.08));
  cursor: pointer;
}
.upload-action-btn:active { transform: scale(0.95); opacity: 0.8; }
.upload-action-btn i { font-size: 36px; color: var(--primary-color, #007aff); }
.upload-action-btn span { font-size: var(--font-size-body, 15px); }

.file-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--card-bg, #fff);
  border-radius: var(--radius-md, 12px);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
}
.file-item-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm, 8px);
  background: var(--primary-light, rgba(0, 122, 255, 0.1));
  color: var(--primary-color, #007aff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.file-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.file-item-name {
  font-size: var(--font-size-body, 15px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-item-size {
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary, #8e8e93);
}
.file-item-remove {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #8e8e93);
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
}
.file-item-remove:active { transform: scale(0.92); opacity: 0.7; }
.file-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.upload-loading, .upload-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 60px;
}
.upload-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--separator-color, #e5e5ea);
  border-top-color: var(--primary-color, #007aff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.upload-success i { font-size: 60px; color: var(--success-color, #34c759); }
.upload-success p { margin: 0; font-size: var(--font-size-body, 16px); }
.upload-again {
  padding: 10px 24px;
  background: var(--primary-color, #007aff);
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 12px);
  cursor: pointer;
  font-size: var(--font-size-body, 15px);
}
.upload-again:active { transform: scale(0.95); opacity: 0.8; }

/* 通用按钮 */
.action-btn-primary {
  flex: 1;
  height: 48px;
  background: var(--primary-color, #007aff);
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 12px);
  font-size: var(--font-size-body, 16px);
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.action-btn-primary:active { transform: scale(0.92); opacity: 0.7; }
.action-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.action-btn-secondary {
  flex: 1;
  height: 48px;
  background: var(--card-bg, #fff);
  color: var(--primary-color, #007aff);
  border: 1px solid var(--primary-color, #007aff);
  border-radius: var(--radius-md, 12px);
  font-size: var(--font-size-body, 16px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.action-btn-secondary:active { transform: scale(0.92); opacity: 0.7; }

/* 录音/录像区 */
.record-area, .video-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 20px 0;
}
.record-timer {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 48px;
  font-weight: 300;
  color: var(--text-primary, #000);
  letter-spacing: 4px;
}
.record-timer.recording { color: var(--danger-color, #ff3b30); }
.record-timer.paused { color: var(--warning-color, #ff9500); }

/* 录音波形 */
.audio-waveform {
  width: 100%;
  max-width: 320px;
  height: 80px;
}

/* 录音脉冲 */
.record-pulse-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.record-pulse {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--danger-color, #ff3b30);
  opacity: 0;
  position: absolute;
  pointer-events: none;
}
.record-pulse.active {
  animation: pulse-ring 1.5s ease-out infinite;
}
@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* 录音按钮 */
.record-btn {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--danger-color, #ff3b30);
  color: #fff;
  border: none;
  font-size: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(255, 59, 48, 0.3);
  transition: transform 0.15s;
  position: relative;
}
.record-btn:active { transform: scale(0.92); }
.record-btn.recording {
  background: var(--danger-color, #ff3b30);
  animation: rec-pulse 1.5s ease-in-out infinite;
}
@keyframes rec-pulse {
  0%, 100% { box-shadow: 0 4px 16px rgba(255, 59, 48, 0.3); }
  50% { box-shadow: 0 4px 32px rgba(255, 59, 48, 0.6); }
}
.video-record-btn {
  width: 72px;
  height: 72px;
  font-size: 24px;
}

/* 暂停按钮 */
.pause-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--separator-color, #e5e5ea);
  border-radius: var(--radius-md, 12px);
  color: var(--text-primary, #000);
  font-size: var(--font-size-body, 15px);
  cursor: pointer;
  min-height: 44px;
}
.pause-btn:active { transform: scale(0.92); opacity: 0.7; }

.record-hint {
  font-size: var(--font-size-body, 15px);
  color: var(--text-secondary, #8e8e93);
  margin: 0;
}

/* 全屏相机录像 */
.video-fullscreen {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 100;
  background: #000;
  overflow: hidden;
}
.video-fullscreen video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.vf-top-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  padding: 20px 16px 40px;
  display: flex;
  justify-content: center;
  background: linear-gradient(to bottom, rgba(0,0,0,0.45), transparent);
  z-index: 2;
}
.vf-rec-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: rgba(0,0,0,0.6);
  border-radius: 20px;
  color: #fff;
  font-size: 15px;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-weight: 600;
}
.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff3b30;
  animation: rec-blink 1s infinite;
}
@keyframes rec-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.vf-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255,255,255,0.85);
  font-size: 16px;
  text-shadow: 0 1px 6px rgba(0,0,0,0.6);
  pointer-events: none;
  z-index: 2;
  white-space: nowrap;
}
.vf-error {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(0,0,0,0.88);
  color: #fff;
  z-index: 3;
}
.vf-error i { font-size: 56px; }
.vf-error p { margin: 0; font-size: 15px; text-align: center; padding: 0 24px; }
.vf-error-btn {
  padding: 10px 32px;
  background: var(--primary-color, #007aff);
  color: #fff;
  border: none;
  border-radius: 24px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.vf-error-btn:active { transform: scale(0.92); opacity: 0.7; }
.vf-bottom-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 20px 32px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(to top, rgba(0,0,0,0.5), transparent);
  z-index: 2;
}
.vf-side-slot {
  width: 80px;
  display: flex;
  justify-content: center;
}
.vf-side-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  padding: 8px;
}
.vf-side-btn i { font-size: 24px; }
.vf-side-btn:active { opacity: 0.6; }
.vf-record-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: transparent;
  border: 4px solid #fff;
  padding: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s var(--ease-standard, ease);
  flex-shrink: 0;
}
.vf-btn-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #fff;
  transition: all 0.3s var(--ease-standard, ease);
}
.vf-record-btn.recording {
  border-color: #ff3b30;
}
.vf-record-btn.recording .vf-btn-inner {
  border-radius: 4px;
  background: #ff3b30;
  transform: scale(0.45);
}
.vf-record-btn:active { transform: scale(0.92); }

/* 预览 */
.record-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
}
.preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-body, 17px);
  font-weight: 600;
  color: var(--text-primary, #000);
}
.preview-label i { color: var(--success-color, #34c759); }
.preview-audio {
  width: 100%;
}
.preview-video {
  width: 100%;
  max-height: 40vh;
  border-radius: var(--radius-lg, 16px);
  background: #000;
}
.preview-actions {
  display: flex;
  gap: 12px;
}

/* 不支持提示 */
.not-supported {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary, #8e8e93);
}
.not-supported i { font-size: 48px; color: var(--warning-color, #ff9500); }
.not-supported p { margin: 0; font-size: var(--font-size-body, 16px); }

/* 上传遮罩 */
.upload-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.upload-progress-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 40px;
  background: var(--card-bg, #fff);
  border-radius: var(--radius-lg, 16px);
  color: var(--text-primary, #000);
  min-width: 200px;
}
.upload-progress-bar {
  width: 200px;
  height: 6px;
  background: var(--separator-color, #e5e5ea);
  border-radius: 3px;
  overflow: hidden;
}
.upload-progress-fill {
  height: 100%;
  background: var(--primary-color, #007aff);
  border-radius: 3px;
  transition: width 0.3s var(--ease-standard, ease);
}

/* 加载按钮 */
.btn-loading-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

/* Toast */
.toast-msg {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: var(--radius-md, 12px);
  color: #fff;
  font-size: var(--font-size-body, 15px);
  z-index: 10001;
  box-shadow: var(--shadow-lg, 0 4px 20px rgba(0,0,0,0.15));
}
.toast-msg.success { background: var(--success-color, #34c759); }
.toast-msg.error { background: var(--danger-color, #ff3b30); }
.toast-fade-enter-active, .toast-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-fade-enter, .toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
</style>
