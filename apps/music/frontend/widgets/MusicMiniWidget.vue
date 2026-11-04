<template>
  <div class="music-mini-widget">
    <!-- 空态：未在播放 -->
    <div v-if="!currentSong" class="mm-state">
      <i class="fa-solid fa-music"></i>
      <span>打开音乐应用选首歌</span>
    </div>
    <!-- 播控 -->
    <div v-else class="mm-content" :class="{ 'mm-content--wide': isWide }">
      <img
        v-if="currentSong.coverUrl"
        class="mm-cover"
        :src="currentSong.coverUrl"
        :alt="currentSong.title"
        draggable="false"
      />
      <i v-else class="fa-solid fa-compact-disc mm-cover mm-cover--ph"></i>
      <div class="mm-info">
        <div class="mm-title">{{ currentSong.title }}</div>
        <div class="mm-artist">{{ currentSong.artist || '未知歌手' }}</div>
        <div class="mm-progress">
          <div class="mm-progress-fill" :style="{ transform: 'scaleX(' + progressPercent / 100 + ')' }"></div>
        </div>
      </div>
      <div class="mm-controls">
        <button class="mm-btn" aria-label="上一首" @click.stop="doPrev">
          <i class="fa-solid fa-backward-step"></i>
        </button>
        <button class="mm-btn mm-btn--main" :aria-label="isPlaying ? '暂停' : '播放'" @click.stop="doToggle">
          <i class="fa-solid" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i>
        </button>
        <button class="mm-btn" aria-label="下一首" @click.stop="doNext">
          <i class="fa-solid fa-forward-step"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
// 音乐播控小组件：直接读写全局播放态（audio-manager 单例持久于音乐应用生命周期之外）
export default {
  name: 'MusicMiniWidget',
  props: {
    config: {
      type: Object,
      default: function() { return {}; }
    },
    refreshKey: {
      type: Number,
      default: 0
    }
  },
  data: function() {
    return {
      isWide: false
    };
  },
  computed: {
    currentSong: function() {
      return this.$store.state.music.currentSong;
    },
    isPlaying: function() {
      return this.$store.state.music.isPlaying;
    },
    progressPercent: function() {
      return this.$store.getters['music/progressPercent'];
    }
  },
  mounted: function() {
    var self = this;
    if (typeof ResizeObserver !== 'undefined' && self.$el) {
      self._ro = new ResizeObserver(function(entries) {
        var w = entries && entries[0] ? entries[0].contentRect.width : 0;
        self.isWide = w >= 320;
      });
      self._ro.observe(self.$el);
    }
  },
  beforeDestroy: function() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  },
  methods: {
    doToggle: function() {
      if (!this.currentSong) return;
      this.$store.dispatch('music/toggle');
    },
    doPrev: function() {
      if (!this.currentSong) return;
      this.$store.dispatch('music/prev');
    },
    doNext: function() {
      if (!this.currentSong) return;
      this.$store.dispatch('music/next');
    }
  }
};
</script>

<style scoped>
.music-mini-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
}

.mm-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.mm-state i { font-size: 24px; }

.mm-content {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  overflow: hidden;
}

.mm-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.mm-cover--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.12);
}

.mm-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-artist {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-progress {
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--separator-color);
  overflow: hidden;
}

.mm-progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--primary-color);
  transform-origin: left center;
  transition: transform var(--duration-normal) var(--ease-standard);
}

.mm-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mm-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.mm-btn:active {
  transform: scale(0.9);
  background: var(--separator-color);
}

.mm-btn--main {
  width: 38px;
  height: 38px;
  background: var(--primary-color);
  color: #fff;
  font-size: 15px;
}

.mm-btn--main:active {
  background: var(--primary-color);
  opacity: 0.85;
}

/* 加宽（4×2）：封面加大，控制区右移 */
.mm-content--wide .mm-cover {
  width: 64px;
  height: 64px;
}

.mm-content--wide .mm-controls {
  margin-left: auto;
  gap: 10px;
}

.mm-content--wide .mm-btn--main {
  width: 44px;
  height: 44px;
}
</style>
