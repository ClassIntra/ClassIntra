<template>
  <div v-if="mode === 'compact'" class="island-body">
    <div class="music-compact-content">
      <div class="music-compact-cover">
        <img v-if="song && song.coverUrl" :src="song.coverUrl" alt="" />
        <div v-else class="music-compact-cover-placeholder"><i class="fa-solid fa-music"></i></div>
      </div>
      <div class="music-compact-title" v-if="song">
        <span class="music-compact-title-text">{{ song.title }}</span>
      </div>
      <div class="music-compact-wave">
        <span v-for="i in 3" :key="i" class="wave-bar" :class="{ 'wave-playing': isPlaying }" :style="{ animationDelay: ((i - 1) * 0.15) + 's' }"></span>
      </div>
      <div class="music-compact-indicator" v-if="!isPlaying">
        <i class="fa-solid fa-pause" style="font-size:8px;opacity:0.4"></i>
      </div>
    </div>
  </div>

  <div v-else class="island-body">
    <div class="music-expanded-top">
      <div class="music-expanded-cover" @click.stop="$emit('go-to-music')">
        <img v-if="song && song.coverUrl" :src="song.coverUrl" alt="" />
        <div v-else class="music-expanded-cover-placeholder"><i class="fa-solid fa-music"></i></div>
      </div>
      <div class="music-expanded-info">
        <div class="music-expanded-title-row">
          <div class="music-expanded-title" @click.stop="$emit('go-to-music')">{{ song ? song.title : '' }}</div>
          <div class="music-expanded-mode" @click.stop="$emit('toggle-play-mode')">
            <i :class="playModeIcon"></i>
          </div>
        </div>
        <div class="music-expanded-artist">{{ song ? song.artist : '' }}</div>
        <transition name="lyric-fade" mode="out-in">
          <div v-if="currentLyric" class="music-expanded-lyric" key="current">{{ currentLyric }}</div>
          <div v-else-if="nextLyric" class="music-expanded-lyric lyric-next" key="next">{{ nextLyric }}</div>
        </transition>
      </div>
    </div>
    <div class="music-expanded-bottom">
      <span class="music-time-label">{{ formattedTime }}</span>
      <div class="music-expanded-progress" @click.stop="$emit('seek', $event)">
        <div class="music-progress-track">
          <div class="music-progress-fill" :style="{ width: progressPercent + '%' }"></div>
          <div class="music-progress-dot" :style="{ left: progressPercent + '%' }"></div>
        </div>
      </div>
      <span class="music-time-label">{{ formattedDuration }}</span>
    </div>
    <div class="music-expanded-controls">
      <button class="music-ctrl-btn" @click.stop="$emit('prev')"><i class="fa-solid fa-backward-step"></i></button>
      <button class="music-ctrl-btn music-ctrl-play" @click.stop="$emit('toggle')"><i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i></button>
      <button class="music-ctrl-btn" @click.stop="$emit('next')"><i class="fa-solid fa-forward-step"></i></button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandMusicPanel',
  props: {
    mode: { type: String, default: 'compact' }, // 'compact' | 'expanded'
    song: { type: Object, default: null },
    isPlaying: { type: Boolean, default: false },
    currentLyric: { type: String, default: '' },
    nextLyric: { type: String, default: '' },
    progressPercent: { type: Number, default: 0 },
    formattedTime: { type: String, default: '0:00' },
    formattedDuration: { type: String, default: '0:00' },
    playModeIcon: { type: String, default: 'fa-solid fa-arrow-right-long' }
  }
};
</script>

<style scoped>
/* ===== Compact ===== */
.music-compact-content {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  height: 100%;
}

.music-compact-cover {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: var(--shadow-sm);
}

.music-compact-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.music-compact-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.12);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.music-compact-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.music-compact-title-text {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  line-height: 1;
}

.music-compact-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  flex-shrink: 0;
  padding-right: 2px;
}

.music-compact-indicator {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.wave-bar {
  width: 2.5px;
  height: 3px;
  border-radius: 1.5px;
  background: rgba(255, 255, 255, 0.5);
  transition: height 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wave-bar.wave-playing {
  animation: waveAnim 0.8s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate;
}

.wave-bar.wave-playing:nth-child(1) { animation-duration: 0.7s; }
.wave-bar.wave-playing:nth-child(2) { animation-duration: 0.9s; animation-delay: 0.1s; }
.wave-bar.wave-playing:nth-child(3) { animation-duration: 0.6s; animation-delay: 0.2s; }

@keyframes waveAnim {
  0% { height: 3px; }
  30% { height: 10px; }
  60% { height: 5px; }
  100% { height: 13px; }
}

/* ===== Expanded ===== */
.music-expanded-top {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}

.music-expanded-cover {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(255, 255, 255, 0.06) inset;
  transition: box-shadow 0.2s var(--ease-standard), transform 0.15s var(--ease-standard);
}

.music-expanded-cover:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(255, 255, 255, 0.1) inset;
  transform: scale(1.03);
}

.music-expanded-cover:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.music-expanded-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.music-expanded-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.12);
  font-size: 18px;
  color: rgba(255, 255, 255, 0.5);
}

.music-expanded-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.music-expanded-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.music-expanded-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  line-height: 1.3;
  flex: 1;
  min-width: 0;
}

.music-expanded-mode {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  transition: background 0.15s, color 0.15s;
}

.music-expanded-mode:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.music-expanded-artist {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.music-expanded-lyric {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  line-height: 1.3;
}

.lyric-next {
  opacity: 0.7;
}

.lyric-fade-enter-active {
  transition: opacity 0.25s var(--ease-standard), transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lyric-fade-leave-active {
  transition: opacity 0.12s var(--ease-standard), transform 0.12s var(--ease-standard);
}

.lyric-fade-enter {
  opacity: 0;
  transform: translate3d(0, 4px, 0);
}

.lyric-fade-leave-to {
  opacity: 0;
  transform: translate3d(0, -4px, 0);
}

.music-expanded-bottom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.music-time-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
}

.music-time-label:last-child {
  text-align: right;
}

.music-expanded-progress {
  flex: 1;
  cursor: pointer;
  padding: 4px 0;
}

.music-progress-track {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  position: relative;
  transition: height 0.12s var(--ease-standard);
}

.music-expanded-progress:hover .music-progress-track {
  height: 5px;
}

.music-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.65);
  transition: width 0.2s var(--ease-standard);
}

.music-progress-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  top: 50%;
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: var(--shadow-sm);
}

.music-expanded-progress:hover .music-progress-dot {
  transform: translate(-50%, -50%) scale(1);
}

.music-expanded-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 2px;
}

.music-ctrl-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  cursor: pointer;
  padding: 5px;
  border-radius: 50%;
  transition: background 0.15s, transform 0.1s, color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.music-ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.95);
}

.music-ctrl-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.music-ctrl-play {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  font-size: 14px;
  color: #fff;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.music-ctrl-play:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .wave-bar.wave-playing { animation: none !important; }
  .lyric-fade-enter-active,
  .lyric-fade-leave-active { transition: none !important; }
}

@media (max-height: 640px) {
  .music-expanded-cover {
    width: 40px;
    height: 40px;
  }
  .music-expanded-controls {
    gap: 14px;
  }
}
</style>
