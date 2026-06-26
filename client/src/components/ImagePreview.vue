<template>
  <transition name="fade">
    <div v-if="visible" class="image-preview-overlay" @click="onOverlayClick" @contextmenu.prevent>
      <!-- 图片模式：保持原有缩放/拖动逻辑 -->
      <div v-if="mediaType === 'image'" class="image-preview-content" @click.stop>
        <div class="preview-image-wrap"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchEnd"
          @wheel="onWheel">
          <img :src="imageUrl" class="preview-image"
            :style="{ transform: 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')', transition: (isPinching || isDragging) ? 'none' : 'transform 0.18s ease-out' }"
            @load="onImageLoad"
            draggable="false" />
        </div>
        <div class="preview-hint" v-if="scale === 1">双指缩放 · 双击放大 · 点击关闭</div>
      </div>

      <!-- 视频模式：Video.js 全屏播放 -->
      <div v-else-if="mediaType === 'video'" class="media-preview-content video-preview-wrap" @click.stop>
        <video ref="videoPlayer" class="video-js vjs-big-play-centered preview-video-player" controls autoplay muted playsinline>
          <source :src="imageUrl" :type="videoSourceType">
        </video>
      </div>

      <!-- 音频模式：Video.js 音频播放 -->
      <div v-else-if="mediaType === 'audio'" class="media-preview-content audio-preview-wrap" @click.stop>
        <div class="audio-preview-card">
          <div class="audio-preview-icon"><i class="fa-solid fa-music"></i></div>
          <audio ref="audioPlayer" class="video-js vjs-big-play-centered preview-audio-player" controls autoplay>
            <source :src="imageUrl" :type="audioSourceType">
          </audio>
        </div>
      </div>

      <!-- 操作按钮 -->
      <button v-if="showSave" class="preview-action-btn preview-save-btn" @click="saveToCloud">
        <i class="fa-solid fa-cloud-arrow-up"></i>
      </button>
      <button class="preview-action-btn preview-close-btn" @click="$emit('close')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </transition>
</template>

<script>
import api from '@/utils/api';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

var VIDEO_EXT_MAP = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp'
};
var AUDIO_EXT_MAP = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus'
};

function getMimeType(url, map) {
  var lower = (url || '').toLowerCase();
  for (var key in map) {
    if (lower.indexOf(key) > -1) return map[key];
  }
  return null;
}

export default {
  name: 'ImagePreview',
  props: {
    visible: { type: Boolean, default: false },
    imageUrl: { type: String, default: '' },
    mediaType: { type: String, default: 'image' },
    showSave: { type: Boolean, default: true }
  },
  data: function() {
    return {
      scale: 1, x: 0, y: 0,
      isPinching: false, isDragging: false,
      pinchStartDist: 0, pinchStartScale: 1,
      dragStartX: 0, dragStartY: 0,
      lastTapTime: 0,
      videoPlayer: null, audioPlayer: null
    };
  },
  computed: {
    videoSourceType: function() { return getMimeType(this.imageUrl, VIDEO_EXT_MAP) || 'video/mp4'; },
    audioSourceType: function() { return getMimeType(this.imageUrl, AUDIO_EXT_MAP) || 'audio/mpeg'; }
  },
  watch: {
    visible: function(val) {
      var self = this;
      if (val) {
        self.scale = 1; self.x = 0; self.y = 0;
        self.isPinching = false; self.isDragging = false;
        self.lastTapTime = 0;
        // 视频/音频：初始化 Video.js 播放器
        if (self.mediaType === 'video') {
          self.$nextTick(function() { self.initVideoPlayer(); });
        } else if (self.mediaType === 'audio') {
          self.$nextTick(function() { self.initAudioPlayer(); });
        }
      } else {
        // 关闭时销毁播放器
        self.disposePlayers();
      }
    }
  },
  beforeDestroy: function() {
    this.disposePlayers();
  },
  methods: {
    initVideoPlayer: function() {
      var self = this;
      self.disposePlayers();
      var el = self.$refs.videoPlayer;
      if (!el) return;
      self.videoPlayer = videojs(el, {
        controls: true, autoplay: true, muted: true, preload: 'auto',
        fluid: true, fill: true,
        playbackRates: [0.5, 1, 1.25, 1.5, 2],
        controlBar: {
          volumePanel: { inline: false },
          pictureInPictureToggle: false
        }
      });
    },
    initAudioPlayer: function() {
      var self = this;
      self.disposePlayers();
      var el = self.$refs.audioPlayer;
      if (!el) return;
      self.audioPlayer = videojs(el, {
        controls: true, autoplay: true, preload: 'auto',
        fluid: false, fill: false,
        controlBar: {
          volumePanel: { inline: false },
          pictureInPictureToggle: false,
          fullscreenToggle: false
        }
      });
    },
    disposePlayers: function() {
      if (this.videoPlayer) { this.videoPlayer.dispose(); this.videoPlayer = null; }
      if (this.audioPlayer) { this.audioPlayer.dispose(); this.audioPlayer = null; }
    },
    onImageLoad: function(e) {
      var img = e.target; var nw = img.naturalWidth; var nh = img.naturalHeight;
      if (!nw || !nh) return;
      var screenW = window.innerWidth, screenH = window.innerHeight;
      var maxW = screenW * 0.95, maxH = screenH * 0.95;
      var imgRatio = nw / nh;
      var containW, containH;
      if (maxW / maxH > imgRatio) { containH = maxH; containW = maxH * imgRatio; }
      else { containW = maxW; containH = maxW / imgRatio; }
      if (containW < screenW * 0.6) {
        var targetScale = Math.max(1, Math.min(8, maxW / containW));
        this.scale = targetScale;
        var scaledH = containH * targetScale;
        if (scaledH > screenH) { this.y = (scaledH - screenH) / 2; }
      }
    },
    onOverlayClick: function() {
      if (this.mediaType !== 'image') { this.$emit('close'); return; }
      if (this.scale === 1) { this.$emit('close'); }
      else { this.scale = 1; this.x = 0; this.y = 0; }
    },
    getTouchDist: function(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    },
    onTouchStart: function(e) {
      if (e.touches.length === 2) {
        this.isPinching = true; this.isDragging = false;
        this.pinchStartDist = this.getTouchDist(e.touches);
        this.pinchStartScale = this.scale;
      } else if (e.touches.length === 1) {
        var now = Date.now();
        if (now - this.lastTapTime < 280) {
          if (this.scale > 1) { this.scale = 1; this.x = 0; this.y = 0; }
          else { this.scale = 3; }
          this.lastTapTime = 0; return;
        }
        this.lastTapTime = now;
        if (this.scale > 1) {
          this.isDragging = true;
          this.dragStartX = e.touches[0].clientX - this.x;
          this.dragStartY = e.touches[0].clientY - this.y;
        }
      }
    },
    onTouchMove: function(e) {
      if (this.isPinching && e.touches.length === 2) {
        e.preventDefault();
        var dist = this.getTouchDist(e.touches);
        var newScale = this.pinchStartScale * (dist / this.pinchStartDist);
        this.scale = Math.max(1, Math.min(8, newScale));
        if (this.scale === 1) { this.x = 0; this.y = 0; }
      } else if (this.isDragging && e.touches.length === 1) {
        e.preventDefault();
        this.x = e.touches[0].clientX - this.dragStartX;
        this.y = e.touches[0].clientY - this.dragStartY;
      }
    },
    onTouchEnd: function(e) {
      if (e.touches.length < 2) this.isPinching = false;
      if (e.touches.length === 0) this.isDragging = false;
    },
    onWheel: function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.15 : 0.15;
      var newScale = this.scale + delta;
      this.scale = Math.max(1, Math.min(8, newScale));
      if (this.scale === 1) { this.x = 0; this.y = 0; }
    },
    saveToCloud: function() {
      var self = this;
      var url = this.imageUrl;
      if (!url) return;
      api.post('/cloud/save-from-url', { url: url }).then(function(res) {
        if (res.data.code === 200) {
          self.$store.commit('toast/SHOW_TOAST', { message: '文件已转存到云盘', type: 'success' });
        } else {
          self.$store.commit('toast/SHOW_TOAST', { message: res.data.message || '转存失败', type: 'error' });
        }
      }).catch(function(err) {
        console.error('转存文件失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '转存失败，请重试', type: 'error' });
      });
    }
  }
};
</script>

<style scoped>
.image-preview-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  display: flex; align-items: center; justify-content: center;
  z-index: 10002;
}
.image-preview-content {
  position: relative; width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.preview-image-wrap {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.preview-image {
  max-width: 95vw; max-height: 95vh;
  object-fit: contain; transform-origin: center center;
  pointer-events: none; will-change: transform;
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.preview-hint {
  position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.55); font-size: 12px;
  pointer-events: none; white-space: nowrap;
  -webkit-user-select: none; user-select: none;
}
.media-preview-content {
  width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
}
.video-preview-wrap { max-width: 100vw; max-height: 100vh; }
.preview-video-player { width: 100%; height: 100%; }
.audio-preview-wrap { width: 100%; display: flex; align-items: center; justify-content: center; }
.audio-preview-card {
  text-align: center; width: 300px; max-width: 90vw;
}
.audio-preview-icon {
  font-size: 48px; color: rgba(255,255,255,0.6); margin-bottom: 20px;
}
.preview-audio-player { width: 100% !important; }
.preview-action-btn {
  position: absolute; top: 16px; width: 40px; height: 40px;
  border-radius: 50%; background: rgba(255,255,255,0.2); color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s, transform 0.15s;
  z-index: 10; -webkit-tap-highlight-color: transparent;
}
.preview-action-btn:active { background: rgba(255,255,255,0.35); transform: scale(0.92); }
.preview-close-btn { right: 16px; }
.preview-save-btn { right: 64px; }
</style>
