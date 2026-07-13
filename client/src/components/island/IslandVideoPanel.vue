<template>
  <div class="island-body">
    <!-- Compact 模式：精简显示视频标题和播放状态 -->
    <div v-if="mode === 'compact'" class="compact-content">
      <span class="compact-icon" :class="{ 'compact-icon-pulse': isPlaying }">
        <i :class="isPlaying ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
      </span>
      <span class="compact-text">{{ displayTitle }}</span>
    </div>

    <!-- Expanded 模式：展开视频控制面板 -->
    <div v-else class="video-expanded">
      <div class="panel-head">
        <span class="panel-title">正在播放</span>
        <button class="panel-close" @click.stop="$emit('cancel')" title="收起">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="video-info">
        <div class="video-thumb" :style="thumbStyle">
          <i v-if="!videoData.pic" class="fa-solid fa-video video-thumb-placeholder"></i>
          <div class="video-thumb-overlay">
            <button class="video-play-btn" @click.stop="$emit('toggle-play')">
              <i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
            </button>
          </div>
        </div>
        <div class="video-meta">
          <div class="video-title" :title="videoData.title">{{ videoData.title || 'CampusBili 视频' }}</div>
          <div v-if="videoData.owner" class="video-owner">
            <i class="fa-solid fa-user"></i>
            <span>{{ videoData.owner }}</span>
          </div>
        </div>
      </div>
      <!-- 进度条 -->
      <div class="video-progress" @click.stop="onSeek">
        <div class="video-progress-bar" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <div class="video-time">
        <span>{{ formattedTime }}</span>
        <span>{{ formattedDuration }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandVideoPanel',
  props: {
    mode: { type: String, default: 'compact' },
    videoData: { type: Object, default: function() { return {}; } }
  },
  computed: {
    isPlaying: function() {
      return !!(this.videoData && this.videoData.isPlaying);
    },
    displayTitle: function() {
      var title = (this.videoData && this.videoData.title) || '';
      if (title.length > 20) return title.substring(0, 20) + '...';
      return title || 'CampusBili 视频';
    },
    thumbStyle: function() {
      var pic = this.videoData && this.videoData.pic;
      if (!pic) return {};
      return {
        backgroundImage: 'url(' + pic + ')',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      };
    },
    progressPercent: function() {
      var d = (this.videoData && this.videoData.duration) || 0;
      var t = (this.videoData && this.videoData.currentTime) || 0;
      return d > 0 ? Math.min(100, (t / d) * 100) : 0;
    },
    formattedTime: function() {
      var t = (this.videoData && this.videoData.currentTime) || 0;
      return this._formatTime(t);
    },
    formattedDuration: function() {
      var d = (this.videoData && this.videoData.duration) || 0;
      return this._formatTime(d);
    }
  },
  methods: {
    _formatTime: function(s) {
      var m = Math.floor(s / 60);
      var sec = Math.floor(s % 60);
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    },
    onSeek: function(e) {
      var rect = e.currentTarget.getBoundingClientRect();
      var ratio = (e.clientX - rect.left) / rect.width;
      var d = (this.videoData && this.videoData.duration) || 0;
      if (d > 0) {
        this.$emit('seek', ratio * d);
      }
    }
  }
};
</script>

<style scoped>
.compact-content {
  display: flex;
  align-items: center;
  gap: 8px;
}
.compact-icon {
  font-size: 12px;
  color: #f43f5e;
  display: flex;
  align-items: center;
}
.compact-icon-pulse {
  animation: pulse-play 1.5s ease-in-out infinite;
}
@keyframes pulse-play {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.compact-text {
  font-size: 13px;
  color: var(--island-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.video-expanded {
  min-width: 260px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--island-text);
}
.panel-close {
  width: 22px;
  height: 22px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  color: var(--island-text);
  opacity: 0.7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s;
}
.panel-close:hover {
  background: rgba(255, 255, 255, 0.16);
  opacity: 1;
}

.video-info {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.video-thumb {
  width: 80px;
  height: 50px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.video-thumb-placeholder {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.3);
}
.video-thumb-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
}
.video-play-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: transform 0.15s, background 0.15s;
}
.video-play-btn:hover {
  transform: scale(1.1);
  background: #fff;
}
.video-play-btn:active {
  transform: scale(0.9);
}

.video-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.video-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--island-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.video-owner {
  font-size: 11px;
  color: var(--island-text);
  opacity: 0.6;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.video-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
  margin-bottom: 6px;
}
.video-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #f43f5e, #fb923c);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.video-time {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--island-text);
  opacity: 0.6;
}
</style>
