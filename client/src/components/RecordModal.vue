<template>
  <transition name="record-modal-fade">
    <div v-if="visible" class="record-modal-overlay" @click.self="onClose">
      <!-- 录音模式：底部卡片 -->
      <div v-if="activeMode === 'audio'" class="record-sheet">
        <div class="record-sheet-header">
          <button class="sheet-close-btn" @click="onClose"><i class="fa-solid fa-xmark"></i></button>
          <span class="sheet-title">录音</span>
          <button v-if="allowSwitch" class="sheet-switch-btn" @click="switchMode('video')">
            <i class="fa-solid fa-video"></i>
          </button>
          <span v-else></span>
        </div>

        <div v-if="error" class="record-error">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <p>{{ error }}</p>
          <button class="record-error-btn" @click="error = ''">重试</button>
        </div>

        <div v-else-if="!blob" class="record-area">
          <div class="record-timer" :class="{ recording: recording && !paused, paused: paused }">
            {{ formatTime(recordSeconds) }}
          </div>
          <canvas ref="waveform" class="audio-waveform" width="600" height="80"></canvas>
          <div class="record-pulse-wrap">
            <div class="record-pulse" :class="{ active: recording && !paused }"></div>
            <button class="record-btn" :class="{ recording: recording }" @click="toggleRecord">
              <i :class="recording ? 'fa-solid fa-stop' : 'fa-solid fa-microphone'"></i>
            </button>
          </div>
          <button v-if="recording" class="pause-btn" @click="togglePause">
            <i :class="paused ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
            <span>{{ paused ? '继续' : '暂停' }}</span>
          </button>
          <p class="record-hint" v-if="!recording">点击按钮开始录音</p>
          <p class="record-hint" v-else-if="paused">已暂停，点击继续录音</p>
          <p class="record-hint" v-else>录音中...</p>
        </div>

        <div v-else class="record-preview">
          <div class="preview-label">
            <i class="fa-solid fa-music"></i>
            <span>录音完成</span>
          </div>
          <audio :src="previewUrl" controls class="preview-audio"></audio>
          <div class="preview-actions">
            <button class="action-btn-secondary" @click="reset">重录</button>
            <button class="action-btn-primary" :disabled="uploading" @click="confirmUpload">
              <span v-if="uploading" class="btn-loading-small"></span>
              <span v-else>上传</span>
            </button>
          </div>
          <div v-if="uploading && uploadProgress > 0" class="upload-progress-bar">
            <div class="upload-progress-fill" :style="{ width: uploadProgress + '%' }"></div>
          </div>
        </div>
      </div>

      <!-- 录像模式：全屏相机 -->
      <div v-else-if="activeMode === 'video'" class="video-fullscreen">
        <video v-if="!blob" ref="videoPreview" autoplay muted playsinline></video>
        <video v-else :src="previewUrl" controls class="video-preview-final"></video>

        <!-- 顶部栏 -->
        <div class="vf-top-bar">
          <button class="vf-close-btn" @click="onClose"><i class="fa-solid fa-xmark"></i></button>
          <div v-if="recording" class="vf-rec-badge">
            <span class="rec-dot"></span>
            <span>{{ formatTime(recordSeconds) }}</span>
          </div>
          <button v-if="allowSwitch && !blob" class="vf-switch-btn" @click="switchMode('audio')">
            <i class="fa-solid fa-microphone"></i>
          </button>
        </div>

        <!-- 错误覆盖 -->
        <div v-if="error" class="vf-error-overlay">
          <i class="fa-solid fa-video-slash"></i>
          <p>{{ error }}</p>
          <button class="vf-error-btn" @click="error = ''; startCamera()">重试</button>
        </div>

        <!-- 中心提示 -->
        <div v-if="!recording && cameraReady && !blob && !error" class="vf-hint">点击按钮开始录像</div>
        <div v-else-if="recording && !paused && !blob" class="vf-hint">录像中</div>
        <div v-else-if="paused && !blob" class="vf-hint">已暂停</div>

        <!-- 底部控制栏 -->
        <div v-if="!blob" class="vf-bottom-bar">
          <div class="vf-side-slot">
            <button v-if="!recording && cameraReady" class="vf-side-btn" @click="switchCamera">
              <i class="fa-solid fa-camera-rotate"></i>
              <span>翻转</span>
            </button>
          </div>
          <button class="vf-record-btn" :class="{ recording: recording }" @click="toggleRecord">
            <span class="vf-btn-inner"></span>
          </button>
          <div class="vf-side-slot">
            <button v-if="recording" class="vf-side-btn" @click="togglePause">
              <i :class="paused ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
              <span>{{ paused ? '继续' : '暂停' }}</span>
            </button>
          </div>
        </div>

        <!-- 录像完成预览 -->
        <div v-if="blob" class="vf-preview-bar">
          <button class="action-btn-secondary" @click="reset">重录</button>
          <button class="action-btn-primary" :disabled="uploading" @click="confirmUpload">
            <span v-if="uploading" class="btn-loading-small"></span>
            <span v-else>上传视频</span>
          </button>
          <div v-if="uploading && uploadProgress > 0" class="upload-progress-bar">
            <div class="upload-progress-fill" :style="{ width: uploadProgress + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import api from '@/utils/api';
import { isMediaRecorderSupported, pickMimeTypes, extFromMime, getMediaError, getAudioConstraints, getVideoAudioConstraints } from '@/utils/media-recorder.js';

export default {
  name: 'RecordModal',
  props: {
    visible: { type: Boolean, default: false },
    mode: { type: String, default: 'audio' }, // 'audio' / 'video'
    allowSwitch: { type: Boolean, default: true }
  },
  data: function() {
    return {
      activeMode: 'audio',
      recording: false,
      paused: false,
      recordSeconds: 0,
      recordTimer: null,
      error: '',
      // 音频相关
      audioStream: null,
      audioRecorder: null,
      audioChunks: [],
      audioContext: null,
      audioAnalyser: null,
      waveformRaf: null,
      // 视频相关
      videoStream: null,
      videoRecorder: null,
      videoChunks: [],
      facingMode: 'user',
      cameraReady: false,
      // 录制结果
      blob: null,
      previewUrl: '',
      // 上传
      uploading: false,
      uploadProgress: 0
    };
  },
  watch: {
    visible: function(val) {
      if (val) {
        this.activeMode = this.mode;
        this.reset();
        if (this.activeMode === 'video') {
          this.$nextTick(this.startCamera);
        }
      } else {
        this.cleanup();
      }
    },
    mode: function(val) {
      if (this.visible) {
        this.activeMode = val;
      }
    }
  },
  beforeDestroy: function() {
    this.cleanup();
  },
  methods: {
    onClose: function() {
      if (this.recording) {
        this.stopRecord();
      }
      this.cleanup();
      this.$emit('close');
    },
    // 切换录音/录像模式
    switchMode: function(newMode) {
      if (newMode === this.activeMode) return;
      if (this.recording) {
        this.stopRecord();
      }
      this.cleanup();
      this.activeMode = newMode;
      this.blob = null;
      this.previewUrl = '';
      this.recordSeconds = 0;
      this.error = '';
      if (newMode === 'video') {
        this.$nextTick(this.startCamera);
      }
    },
    // 切换摄像头
    switchCamera: function() {
      this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
      this.cameraReady = false;
      this.startCamera();
    },
    // 开始/停止录制
    toggleRecord: function() {
      if (this.recording) {
        this.stopRecord();
      } else {
        this.startRecord();
      }
    },
    // 暂停/继续
    togglePause: function() {
      if (this.activeMode === 'audio') {
        if (!this.audioRecorder) return;
        if (this.paused) {
          this.audioRecorder.resume();
          this.paused = false;
          this.startTimer();
          this.startWaveform();
        } else {
          this.audioRecorder.pause();
          this.paused = true;
          this.stopTimer();
          this.stopWaveform();
        }
      } else {
        if (!this.videoRecorder) return;
        if (this.paused) {
          this.videoRecorder.resume();
          this.paused = false;
          this.startTimer();
        } else {
          this.videoRecorder.pause();
          this.paused = true;
          this.stopTimer();
        }
      }
    },
    // 开始录制
    startRecord: function() {
      if (this.activeMode === 'audio') {
        this.startAudioRecord();
      } else {
        this.startVideoRecord();
      }
    },
    // 停止录制
    stopRecord: function() {
      if (this.activeMode === 'audio') {
        this.stopAudioRecord();
      } else {
        this.stopVideoRecord();
      }
    },
    // ===== 录音 =====
    startAudioRecord: function() {
      var self = this;
      if (!isMediaRecorderSupported()) {
        self.error = '浏览器不支持录音';
        return;
      }
      if (!window.isSecureContext) {
        self.error = '录音需要 HTTPS 安全环境';
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
        var options = { audioBitsPerSecond: 128000 }; // 128kbps 高质量语音
        if (mime) options.mimeType = mime;
        var recorder = new MediaRecorder(stream, options);
        recorder.ondataavailable = function(e) {
          if (e.data && e.data.size > 0) {
            self.audioChunks.push(e.data);
          }
        };
        recorder.onstop = function() {
          var type = mime || 'audio/webm';
          self.blob = new Blob(self.audioChunks, { type: type });
          self.previewUrl = URL.createObjectURL(self.blob);
          self.cleanupAudioStream();
        };
        recorder.start(1000);
        self.audioRecorder = recorder;
        self.recording = true;
        self.paused = false;
        self.recordSeconds = 0;
        self.startTimer();
        self.$nextTick(function() {
          self.startWaveform();
        });
      }).catch(function(err) {
        self.error = getMediaError(err);
      });
    },
    stopAudioRecord: function() {
      this.stopWaveform();
      if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
        this.audioRecorder.stop();
      }
      this.recording = false;
      this.paused = false;
      this.stopTimer();
    },
    startWaveform: function() {
      var self = this;
      var canvas = self.$refs.waveform;
      if (!canvas || !self.audioAnalyser) return;
      var ctx = canvas.getContext('2d');
      var bufferLength = self.audioAnalyser.frequencyBinCount;
      var dataArray = new Uint8Array(bufferLength);

      function draw() {
        if (!self.audioAnalyser || !self.recording || self.paused) {
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
          ctx.fillStyle = self.paused ? 'rgba(255, 149, 0, ' + alpha + ')'
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
      var canvas = this.$refs.waveform;
      if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    cleanupAudioStream: function() {
      if (this.audioStream) {
        var tracks = this.audioStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          tracks[i].stop();
        }
        this.audioStream = null;
      }
      if (this.audioContext) {
        try { this.audioContext.close(); } catch (e) {}
        this.audioContext = null;
      }
      this.audioAnalyser = null;
      this.audioRecorder = null;
    },
    // ===== 录像 =====
    startCamera: function() {
      var self = this;
      self.error = '';
      self.cameraReady = false;
      if (!isMediaRecorderSupported()) {
        self.error = '浏览器不支持录像';
        return;
      }
      if (!window.isSecureContext) {
        self.error = '录像需要 HTTPS 安全环境';
        return;
      }
      var constraints = {
        video: { facingMode: self.facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
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
        self.error = getMediaError(err);
      });
    },
    startVideoRecord: function() {
      var self = this;
      if (!self.videoStream) {
        self.error = '摄像头未就绪';
        return;
      }
      self.videoChunks = [];
      var mime = pickMimeTypes('video');
      var options = { videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000 };
      if (mime) options.mimeType = mime;
      try {
        var recorder = new MediaRecorder(self.videoStream, options);
      } catch (e) {
        self.error = '无法启动录像：' + e.message;
        return;
      }
      recorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) {
          self.videoChunks.push(e.data);
        }
      };
      recorder.onstop = function() {
        var type = mime || 'video/webm';
        self.blob = new Blob(self.videoChunks, { type: type });
        self.previewUrl = URL.createObjectURL(self.blob);
        self.cleanupVideoStream();
        self.cameraReady = false;
      };
      recorder.start(1000);
      self.videoRecorder = recorder;
      self.recording = true;
      self.paused = false;
      self.recordSeconds = 0;
      self.startTimer();
    },
    stopVideoRecord: function() {
      if (this.videoRecorder && this.videoRecorder.state !== 'inactive') {
        this.videoRecorder.stop();
      }
      this.recording = false;
      this.paused = false;
      this.stopTimer();
    },
    cleanupVideoStream: function() {
      if (this.videoStream) {
        var tracks = this.videoStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          tracks[i].stop();
        }
        this.videoStream = null;
      }
      this.videoRecorder = null;
    },
    // ===== 计时器 =====
    startTimer: function() {
      var self = this;
      this.stopTimer();
      this.recordTimer = setInterval(function() {
        self.recordSeconds++;
      }, 1000);
    },
    stopTimer: function() {
      if (this.recordTimer) {
        clearInterval(this.recordTimer);
        this.recordTimer = null;
      }
    },
    formatTime: function(sec) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    // ===== 重置/清理 =====
    reset: function() {
      if (this.recording) {
        this.stopRecord();
      }
      this.cleanup();
      if (this.previewUrl) {
        URL.revokeObjectURL(this.previewUrl);
      }
      this.blob = null;
      this.previewUrl = '';
      this.recordSeconds = 0;
      this.error = '';
      this.uploading = false;
      this.uploadProgress = 0;
      if (this.activeMode === 'video') {
        this.$nextTick(this.startCamera);
      }
    },
    cleanup: function() {
      this.stopTimer();
      this.stopWaveform();
      this.cleanupAudioStream();
      this.cleanupVideoStream();
      if (this.previewUrl) {
        URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = '';
      }
    },
    // ===== 上传 =====
    confirmUpload: function() {
      var self = this;
      if (!self.blob) return;
      self.uploading = true;
      self.uploadProgress = 0;
      var kind = self.activeMode; // 'audio' / 'video'
      var ext = extFromMime(self.blob.type, kind);
      var filename = 'recording_' + Date.now() + ext;
      var file = new File([self.blob], filename, { type: self.blob.type });
      var formData = new FormData();
      // mediaType 必须在 file 之前，否则 multer 中 req.body 为空
      formData.append('mediaType', kind);
      formData.append('file', file);
      api.post('/cloud/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
        onUploadProgress: function(e) {
          if (e.lengthComputable) {
            self.uploadProgress = Math.round((e.loaded / e.total) * 100);
          }
        }
      }).then(function(res) {
        self.uploading = false;
        self.uploadProgress = 0;
        var data = (res.data && res.data.data) || {};
        var url = data.url || ('/api/cloud/files/' + encodeURIComponent(data.name || filename));
        var name = data.name || filename;
        self.$emit('uploaded', { url: url, type: kind, name: name });
        self.cleanup();
        self.blob = null;
        self.previewUrl = '';
      }).catch(function(err) {
        self.uploading = false;
        self.uploadProgress = 0;
        var msg = (err.response && err.response.data && err.response.data.message) || '上传失败，请重试';
        self.error = msg;
      });
    }
  }
};
</script>

<style scoped>
.record-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10001;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: var(--glass-blur-container, blur(10px));
}

/* 录音底部卡片 */
.record-sheet {
  width: 100%;
  max-width: 500px;
  background: var(--bg-card, #fff);
  border-radius: 16px 16px 0 0;
  padding: 20px 24px calc(20px + env(safe-area-inset-bottom, 0px));
  animation: sheetSlideUp 0.3s var(--ease-standard, ease-out);
}

@keyframes sheetSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.record-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.sheet-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-color, #000);
}

.sheet-close-btn, .sheet-switch-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-elevated, #f5f5f7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color, #000);
  font-size: 16px;
  -webkit-tap-highlight-color: transparent;
}

.sheet-close-btn:active, .sheet-switch-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* 录音区域 */
.record-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
}

.record-timer {
  font-size: 36px;
  font-weight: 300;
  color: var(--text-color, #000);
  font-variant-numeric: tabular-nums;
  margin-bottom: 16px;
}

.record-timer.recording { color: var(--danger-color, #ff3b30); }
.record-timer.paused { color: var(--warning-color, #ff9500); }

.audio-waveform {
  width: 100%;
  max-width: 400px;
  height: 80px;
  margin-bottom: 20px;
}

.record-pulse-wrap {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.record-pulse {
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--danger-color, #ff3b30);
  opacity: 0;
}

.record-pulse.active {
  animation: recordPulse 1.5s ease-out infinite;
}

@keyframes recordPulse {
  0% { transform: scale(1); opacity: 0.4; }
  100% { transform: scale(1.8); opacity: 0; }
}

.record-btn {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--danger-color, #ff3b30);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
  z-index: 1;
  -webkit-tap-highlight-color: transparent;
}

.record-btn:active {
  transform: scale(0.92);
}

.record-btn.recording {
  background: var(--text-color, #000);
}

.pause-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 20px;
  background: var(--bg-elevated, #f5f5f7);
  color: var(--text-color, #000);
  font-size: 14px;
  margin-top: 12px;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}

.pause-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.record-hint {
  font-size: 13px;
  color: var(--text-color-secondary, rgba(0, 0, 0, 0.5));
  margin-top: 8px;
}

/* 录制预览 */
.record-preview {
  padding: 20px 0;
}

.preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: var(--text-color, #000);
  margin-bottom: 16px;
}

.preview-audio {
  width: 100%;
  margin-bottom: 16px;
}

.preview-actions {
  display: flex;
  gap: 12px;
}

.action-btn-secondary, .action-btn-primary {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.action-btn-secondary {
  background: var(--bg-elevated, #f5f5f7);
  color: var(--text-color, #000);
}

.action-btn-primary {
  background: var(--primary-color, #007aff);
  color: #fff;
}

.action-btn-secondary:active, .action-btn-primary:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.action-btn-primary:disabled {
  opacity: 0.5;
}

/* 录像全屏 */
.video-fullscreen {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  max-width: none;
  padding: 0;
  animation: none;
}

.video-fullscreen video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-preview-final {
  object-fit: contain !important;
}

.vf-top-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.4), transparent);
  z-index: 2;
}

.vf-close-btn, .vf-switch-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  -webkit-tap-highlight-color: transparent;
}

.vf-close-btn:active, .vf-switch-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.vf-rec-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff3b30;
  animation: recBlink 1s ease-in-out infinite;
}

@keyframes recBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.vf-hint {
  position: absolute;
  bottom: 140px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  z-index: 2;
  white-space: nowrap;
}

.vf-error-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #fff;
  z-index: 3;
}

.vf-error-overlay i {
  font-size: 48px;
  margin-bottom: 16px;
}

.vf-error-overlay p {
  font-size: 15px;
  margin-bottom: 16px;
}

.vf-error-btn {
  padding: 10px 24px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 14px;
  min-height: 44px;
}

.vf-bottom-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 20px 24px calc(20px + env(safe-area-inset-bottom, 0px));
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
  color: #fff;
  font-size: 12px;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}

.vf-side-btn i {
  font-size: 22px;
  margin-bottom: 2px;
}

.vf-side-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.vf-record-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 4px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.vf-btn-inner {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #ff3b30;
  transition: all 0.2s;
}

.vf-record-btn.recording .vf-btn-inner {
  width: 24px;
  height: 24px;
  border-radius: 4px;
}

.vf-record-btn:active {
  transform: scale(0.92);
}

.vf-preview-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  display: flex;
  gap: 12px;
  padding: 20px 24px calc(20px + env(safe-area-inset-bottom, 0px));
  background: rgba(0, 0, 0, 0.6);
  z-index: 2;
  flex-wrap: wrap;
}

/* 上传进度条 */
.upload-progress-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-elevated, rgba(255,255,255,0.2));
  overflow: hidden;
  margin-top: 8px;
}

.upload-progress-fill {
  height: 100%;
  background: var(--primary-color, #007aff);
  transition: width 0.2s;
}

.record-error {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-color, #000);
}

.record-error i {
  font-size: 40px;
  color: var(--danger-color, #ff3b30);
  margin-bottom: 12px;
}

.record-error p {
  font-size: 14px;
  margin-bottom: 16px;
  color: var(--text-color-secondary, rgba(0,0,0,0.5));
}

.record-error-btn {
  padding: 10px 24px;
  border-radius: 20px;
  background: var(--primary-color, #007aff);
  color: #fff;
  font-size: 14px;
  min-height: 44px;
}

/* 加载小圆圈 */
.btn-loading-small {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 过渡动画 */
.record-modal-fade-enter-active, .record-modal-fade-leave-active {
  transition: opacity 0.25s var(--ease-standard, ease-out);
}

.record-modal-fade-enter, .record-modal-fade-leave-to {
  opacity: 0;
}
</style>
