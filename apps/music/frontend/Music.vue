<template>
  <div class="music-page" :data-theme="theme">
    <div class="music-list-page">
      <div class="music-nav">
        <button class="music-nav-btn" @click="goDesktop" title="返回桌面">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <h1 class="music-nav-title">音乐</h1>
        <div class="music-nav-count" v-if="songs.length > 0">{{ filteredSongs.length }} / {{ songs.length }}</div>
      </div>

      <div class="list-layout">
        <div class="list-sidebar scrollbar-thin">
          <div class="sidebar-nav">
            <div class="sidebar-item" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">
              <i class="fa-solid fa-music"></i>
              <span>全部歌曲</span>
            </div>
            <div class="sidebar-item" :class="{ active: activeTab === 'favorites' }" @click="activeTab = 'favorites'">
              <i class="fa-solid fa-heart"></i>
              <span>我的收藏</span>
            </div>
            <div class="sidebar-divider"></div>
            <div class="sidebar-label">歌单</div>
            <div
              v-for="pl in playlists"
              :key="pl.id"
              class="sidebar-item"
              :class="{ active: typeof activeTab === 'number' && activeTab === pl.id }"
              @click="openPlaylistDetail(pl)"
            >
              <i class="fa-solid fa-list"></i>
              <span class="sidebar-item-name">{{ pl.name }}</span>
            </div>
            <div v-if="playlists.length === 0" class="sidebar-empty">暂无歌单</div>
          </div>
          <button class="sidebar-create-btn" @click="showCreatePlaylist = true">
            <i class="fa-solid fa-plus"></i>
            <span>新建歌单</span>
          </button>
        </div>

        <div class="list-content scrollbar-thin">
          <div class="list-search">
            <div class="search-box">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input v-model="searchQuery" placeholder="搜索歌曲或艺术家" />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div v-if="typeof activeTab === 'number' && currentPlaylist" class="playlist-header">
            <div class="playlist-header-info">
              <h2 class="playlist-header-name">{{ currentPlaylist.name }}</h2>
              <p v-if="currentPlaylist.description" class="playlist-header-desc">{{ currentPlaylist.description }}</p>
            </div>
            <div class="playlist-header-actions">
              <button class="playlist-action-btn" @click="playPlaylist(activeTab)">
                <i class="fa-solid fa-play"></i>
                <span>播放全部</span>
              </button>
              <button class="playlist-action-btn" @click="sharePlaylist(activeTab)">
                <i class="fa-solid fa-share-nodes"></i>
                <span>分享</span>
              </button>
              <button class="playlist-action-btn playlist-action-btn-danger" @click="deletePlaylist(activeTab)">
                <i class="fa-solid fa-trash"></i>
                <span>删除</span>
              </button>
            </div>
          </div>

          <div v-if="songsLoading" class="list-loading">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
          </div>

          <div v-else class="song-list">
            <div
              v-for="song in filteredSongs"
              :key="song.id"
              class="song-row"
              :class="{ active: currentSong && currentSong.id === song.id }"
              @click="playSong(song)"
              @contextmenu.prevent="openAddToPlaylist(song)"
            >
              <div class="song-row-cover">
                <img v-if="song.coverUrl" :src="song.coverUrl" loading="lazy" decoding="async" />
                <div v-else class="cover-fallback-sm" :style="coverFallbackStyle(song)">
                  <i class="fa-solid fa-music"></i>
                </div>
                <div v-if="currentSong && currentSong.id === song.id && isPlaying" class="cover-playing-sm">
                  <div class="eq-bar"></div>
                  <div class="eq-bar"></div>
                  <div class="eq-bar"></div>
                </div>
              </div>
              <div class="song-row-info">
                <div class="song-row-title">{{ song.title }}</div>
                <div class="song-row-artist">{{ song.artist }}</div>
              </div>
              <span v-if="song.format" class="song-row-format">{{ song.format }}</span>
              <button class="song-row-fav" @click.stop="toggleFavorite(song)" :title="song.isFavorite ? '取消收藏' : '收藏'">
                <i :class="song.isFavorite ? 'fa-solid fa-star' : 'fa-regular fa-star'" :style="song.isFavorite ? 'color: var(--primary-color)' : ''"></i>
              </button>
              <button class="song-row-more" @click.stop="openAddToPlaylist(song)" title="添加到歌单">
                <i class="fa-solid fa-ellipsis"></i>
              </button>
              <button
                v-if="typeof activeTab === 'number'"
                class="song-row-remove"
                @click.stop="removeFromPlaylist(activeTab, song.id)"
                title="从歌单移除"
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div v-if="!songsLoading && filteredSongs.length === 0" class="list-empty">
            <i class="fa-solid fa-music"></i>
            <p>{{ searchQuery ? '未找到匹配的歌曲' : (activeTab === 'favorites' ? '暂无收藏' : (typeof activeTab === 'number' ? '歌单为空' : '暂无歌曲')) }}</p>
          </div>
        </div>
      </div>

      <transition name="mini-slide">
        <div v-if="currentSong" class="mini-player" @click="openPlayer">
          <div class="mini-cover" :class="{ 'mini-cover-spin': isPlaying }">
            <img v-if="currentSong.coverUrl" :src="currentSong.coverUrl" />
            <div v-else class="mini-cover-fallback">
              <i class="fa-solid fa-music"></i>
            </div>
          </div>
          <div class="mini-info">
            <div class="mini-title">{{ currentSong.title }}</div>
            <div class="mini-artist">{{ currentSong.artist }}</div>
          </div>
          <div class="mini-progress" :style="{ transform: 'scaleX(' + (progressPercent / 100) + ')' }"></div>
          <button class="mini-btn" @click.stop="togglePlay">
            <i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
          </button>
          <button class="mini-btn" @click.stop="nextSong">
            <i class="fa-solid fa-forward-step"></i>
          </button>
        </div>
      </transition>
    </div>

    <transition name="player-slide">
      <div v-if="showPlayer && currentSong" class="player-page" :class="'effect-' + effectMode">
        <div class="player-bg">
          <div class="player-bg-image" :style="bgImageStyle"></div>
          <div class="player-bg-image player-bg-image-next" :style="bgImageNextStyle"></div>
          <div class="player-bg-glow"></div>
          <div class="player-bg-noise"></div>
          <div class="player-bg-overlay"></div>
        </div>

        <div class="player-header">
          <button class="player-back-btn" @click="closePlayer">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <div class="player-header-center">
            <span class="player-header-label">正在播放</span>
            <span class="player-header-song">{{ currentSong.title }} — {{ currentSong.artist }}</span>
          </div>
          <button class="player-effect-btn" @click="toggleEffectMode" :title="effectModeLabel">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <span class="effect-label">{{ effectModeLabel }}</span>
          </button>
        </div>

        <div class="player-content">
          <div class="player-left">
            <div class="album-section">
              <div class="album-art-wrap">
                <div class="album-shadow" :style="albumShadowStyle"></div>
                <div class="album-art-box">
                  <img v-if="currentSong.coverUrl" :src="currentSong.coverUrl" class="album-art" />
                  <div v-else class="album-art-fallback" :style="placeholderStyle">
                    <i class="fa-solid fa-music"></i>
                  </div>
                </div>
              </div>
              <div class="song-meta">
                <h2 class="song-meta-title">{{ currentSong.title }}</h2>
                <p class="song-meta-artist">{{ currentSong.artist }}</p>
              </div>
            </div>

            <div class="progress-section">
              <div
                class="progress-track-wrap"
                :class="{ dragging: isDragging }"
                @mousedown="onProgressMouseDown"
                @touchstart.prevent="onProgressTouchStart"
                ref="progressBar"
              >
                <div class="progress-track"></div>
                <div class="progress-buffered" :style="bufferedStyle"></div>
                <div class="progress-fill" :style="progressFillStyle"></div>
                <div class="progress-thumb" :style="progressThumbStyle"></div>
              </div>
              <div class="time-row">
                <span>{{ formattedCurrentTime }}</span>
                <span>{{ formattedDuration }}</span>
              </div>
            </div>

            <div class="controls-section">
              <button class="ctrl" :class="{ on: playMode === 'shuffle' }" @click="toggleShuffle" title="随机播放">
                <i class="fa-solid fa-shuffle"></i>
              </button>
              <button class="ctrl" @click="prevSong" title="上一首">
                <i class="fa-solid fa-backward-step"></i>
              </button>
              <button class="ctrl ctrl-main" @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
                <i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'" class="play-icon"></i>
              </button>
              <button class="ctrl" @click="nextSong" title="下一首">
                <i class="fa-solid fa-forward-step"></i>
              </button>
              <button class="ctrl" :class="{ on: playMode === 'repeat-one' || playMode === 'repeat-all' }" @click="toggleRepeat" :title="repeatModeLabel">
                <i class="fa-solid fa-repeat"></i>
                <span v-if="playMode === 'repeat-one'" class="repeat-one">1</span>
              </button>
            </div>

            <div class="bottom-row">
              <div class="vol-wrap">
                <button class="vol-btn" @click="toggleMute" :title="isMuted ? '取消静音' : '静音'">
                  <i :class="volumeIcon"></i>
                </button>
                <div
                  class="vol-track-wrap"
                  @mousedown="onVolumeMouseDown"
                  @touchstart.prevent="onVolumeTouchStart"
                  ref="volumeBar"
                >
                  <div class="vol-track"></div>
                  <div class="vol-fill" :style="{ width: volumePercent + '%' }"></div>
                  <div class="vol-thumb" :style="{ left: volumePercent + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="player-right">
            <div v-if="hasLyrics" class="lyrics-container">
              <div class="lyrics-mode-bar">
                <div class="lyrics-mode-capsule">
                  <button class="lyrics-mode-btn" :class="{ active: lyricsMode === 'scroll' }" @click="setLyricsMode('scroll')">滚动</button>
                  <button class="lyrics-mode-btn" :class="{ active: lyricsMode === 'drop' }" @click="setLyricsMode('drop')">逐字</button>
                </div>
              </div>
              <div class="lyrics-scroll scrollbar-thin" ref="lyricsBody">
                <div class="lyrics-pad-top"></div>
                <div
                  v-for="(line, index) in lyrics.lines"
                  :key="index"
                  class="lyric-line"
                  :class="[lyricLineClass(index), 'lyrics-' + lyricsMode]"
                  @click="seekToLine(line)"
                >
                  <template v-if="lyricsMode === 'drop'">
                    <div class="lyric-words lyric-words-drop">
                      <span
                        v-for="(ch, ci) in line._chars"
                        :key="ci"
                        class="lyric-char"
                        :class="{ 'lyric-char-space': ch === ' ' }"
                        :style="{ '--i': ci }"
                      >{{ ch === ' ' ? '\u00A0' : ch }}</span>
                    </div>
                    <div v-if="line.translation" class="lyric-trans lyric-trans-drop" :class="{ 'trans-dropped': index === currentLyricIndex }">{{ line.translation }}</div>
                  </template>
                  <template v-else-if="line.words && line.words.length > 0">
                    <span class="lyric-words">
                      <span
                        v-for="(word, wi) in line.words"
                        :key="wi"
                        class="lyric-word"
                        :class="wordHighlightClass(line, word, index)"
                        :style="wordHighlightStyle(line, word, index)"
                      >{{ word.text }}</span>
                    </span>
                  </template>
                  <template v-else>
                    <span class="lyric-text">{{ line.text }}</span>
                  </template>
                  <span v-if="line.translation && lyricsMode !== 'drop'" class="lyric-trans">{{ line.translation }}</span>
                </div>
                <div class="lyrics-pad-bottom"></div>
              </div>
            </div>
            <div v-else class="no-lyrics-hint">
              <i class="fa-solid fa-music"></i>
              <span>暂无歌词</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Modal: Create Playlist -->
    <div v-if="showCreatePlaylist" class="modal-overlay" @click.self="showCreatePlaylist = false">
      <div class="modal-box">
        <div class="modal-title">新建歌单</div>
        <input class="modal-input" v-model="newPlaylistName" placeholder="歌单名称" @keyup.enter="createPlaylist" />
        <input class="modal-input" v-model="newPlaylistDesc" placeholder="描述（可选）" />
        <div class="modal-actions">
          <button class="modal-btn" @click="showCreatePlaylist = false">取消</button>
          <button class="modal-btn modal-btn-primary" @click="createPlaylist" :disabled="!newPlaylistName.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- Modal: Add to Playlist -->
    <div v-if="showAddToPlaylist" class="modal-overlay" @click.self="showAddToPlaylist = false">
      <div class="modal-box">
        <div class="modal-title">添加到歌单</div>
        <div class="modal-playlist-list">
          <div
            v-for="pl in playlists"
            :key="pl.id"
            class="modal-playlist-item"
            @click="addToPlaylist(pl.id)"
          >
            <i class="fa-solid fa-list"></i>
            <span>{{ pl.name }}</span>
          </div>
          <div v-if="playlists.length === 0" class="modal-empty">暂无歌单，请先创建歌单</div>
        </div>
        <div class="modal-actions">
          <button class="modal-btn" @click="showAddToPlaylist = false">取消</button>
        </div>
      </div>
    </div>

    <!-- Modal: Share -->
    <div v-if="showShareDialog" class="modal-overlay" @click.self="showShareDialog = false">
      <div class="modal-box">
        <div class="modal-title">分享歌单</div>
        <div class="modal-share-name">{{ currentPlaylist ? currentPlaylist.name : '' }}</div>
        <div class="modal-share-actions">
          <button class="modal-btn modal-btn-accent" @click="shareToChat">
            <i class="fa-solid fa-comment"></i> 分享到聊天
          </button>
          <button class="modal-btn modal-btn-accent" @click="shareToCommunity">
            <i class="fa-solid fa-newspaper"></i> 分享到论坛
          </button>
        </div>
        <div class="modal-actions">
          <button class="modal-btn" @click="showShareDialog = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import lrcParser from '@/utils/lrc-parser';
import api from '@/utils/api';
import audioManager from '@/utils/audio-manager';

var EFFECT_MODES = ['full', 'glow', 'blur', 'none'];
var EFFECT_LABELS = { full: '全效果', glow: '流光', blur: '模糊', none: '无效果' };

function hashStr(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = s.charCodeAt(i) + ((h << 5) - h); h = h & h; }
  return Math.abs(h);
}
function hue(s) { return hashStr(s) % 360; }

export default {
  name: 'Music',
  data: function() {
    return {
      songsLoading: true,
      searchQuery: '',
      effectMode: 'full',
      lyricsMode: 'scroll',
      prevVolume: 0.8,
      isDragging: false,
      isVolDragging: false,
      shuffleHistory: [],
      shufflePool: [],
      playlists: [],
      activeTab: 'all',
      showCreatePlaylist: false,
      newPlaylistName: '',
      newPlaylistDesc: '',
      showAddToPlaylist: false,
      addToPlaylistSongId: null,
      showShareDialog: false,
      playlistDetailSongs: [],
      _bgCrossfadeActive: false,
      _bgCrossfadeTimer: null
    };
  },
  computed: {
    isDark: function() {
      return this.$store.state.settings.theme === 'dark';
    },
    theme: function() {
      return this.$store.state.settings.theme;
    },
    songs: function() { return this.$store.state.music.songs; },
    currentSong: function() { return this.$store.state.music.currentSong; },
    isPlaying: function() { return this.$store.state.music.isPlaying; },
    currentTime: function() { return this.$store.state.music.currentTime; },
    duration: function() { return this.$store.state.music.duration; },
    volume: function() { return this.$store.state.music.volume; },
    isMuted: function() { return this.$store.state.music.isMuted; },
    playMode: function() { return this.$store.state.music.playMode; },
    showPlayer: function() { return this.$store.state.music.showPlayer; },
    lyrics: function() { return this.$store.state.music.lyrics; },
    playQueue: function() { return this.$store.state.music.playQueue; },
    bufferedEnd: function() { return this.$store.state.music.bufferedEnd; },
    currentPlaylist: function() {
      if (typeof this.activeTab !== 'number') return null;
      var id = this.activeTab;
      return this.playlists.find(function(p) { return p.id === id; }) || null;
    },
    filteredSongs: function() {
      var q = this.searchQuery.toLowerCase().trim();
      var vm = this;
      var list;
      if (vm.activeTab === 'all') {
        list = vm.songs;
      } else if (vm.activeTab === 'favorites') {
        list = vm.songs.filter(function(s) { return s.isFavorite; });
      } else if (typeof vm.activeTab === 'number') {
        var detailIds = vm.playlistDetailSongs;
        list = vm.songs.filter(function(s) { return detailIds.indexOf(s.id) !== -1; });
      } else {
        list = vm.songs;
      }
      if (!q) return list;
      return list.filter(function(s) {
        return s.title.toLowerCase().indexOf(q) !== -1 || s.artist.toLowerCase().indexOf(q) !== -1;
      });
    },
    progressPercent: function() {
      return this.duration > 0 ? Math.min(100, (this.currentTime / this.duration) * 100) : 0;
    },
    progressFillStyle: function() {
      return { transform: 'scaleX(' + (this.progressPercent / 100) + ')' };
    },
    progressThumbStyle: function() {
      return { left: this.progressPercent + '%' };
    },
    bufferedStyle: function() {
      if (this.duration <= 0 || this.bufferedEnd <= 0) return { transform: 'scaleX(0)' };
      return { transform: 'scaleX(' + Math.min(1, this.bufferedEnd / this.duration) + ')' };
    },
    volumePercent: function() { return this.isMuted ? 0 : this.volume * 100; },
    formattedCurrentTime: function() { return this.fmt(this.currentTime); },
    formattedDuration: function() { return this.fmt(this.duration); },
    currentLyricIndex: function() {
      if (!this.lyrics || !this.lyrics.lines) return -1;
      return lrcParser.findCurrentLine(this.lyrics.lines, this.currentTime);
    },
    hasLyrics: function() {
      return this.currentSong && this.currentSong.hasLyrics && this.lyrics && this.lyrics.lines.length > 0;
    },
    bgImageStyle: function() {
      if (this.effectMode === 'none') return { opacity: 0 };
      if (this.currentSong && this.currentSong.coverUrl) {
        return { backgroundImage: "url('" + this.currentSong.coverUrl + "')", opacity: this._bgCrossfadeActive ? 0 : 1 };
      }
      var h = this.currentSong ? hue(this.currentSong.title) : 220;
      return { background: 'linear-gradient(135deg, hsl(' + h + ',40%,15%), hsl(' + ((h + 60) % 360) + ',30%,10%))', opacity: this._bgCrossfadeActive ? 0 : 1 };
    },
    bgImageNextStyle: function() {
      if (this.effectMode === 'none') return { opacity: 0 };
      if (!this._bgCrossfadeActive) return { opacity: 0 };
      if (this.currentSong && this.currentSong.coverUrl) {
        return { backgroundImage: "url('" + this.currentSong.coverUrl + "')", opacity: 1 };
      }
      var h = this.currentSong ? hue(this.currentSong.title) : 220;
      return { background: 'linear-gradient(135deg, hsl(' + h + ',40%,15%), hsl(' + ((h + 60) % 360) + ',30%,10%))', opacity: 1 };
    },
    albumShadowStyle: function() {
      if (this.currentSong && this.currentSong.coverUrl) {
        return { backgroundImage: "url('" + this.currentSong.coverUrl + "')" };
      }
      return {};
    },
    placeholderStyle: function() {
      var h = this.currentSong ? hue(this.currentSong.title) : 220;
      var l = this.isDark ? 25 : 78;
      return { background: 'linear-gradient(135deg, hsl(' + h + ',50%,' + l + '%), hsl(' + ((h + 60) % 360) + ',40%,' + (l - 5) + '%))' };
    },
    effectModeLabel: function() { return EFFECT_LABELS[this.effectMode] || '全效果'; },
    repeatModeLabel: function() {
      if (this.playMode === 'repeat-one') return '单曲循环';
      if (this.playMode === 'repeat-all') return '列表循环';
      return '顺序播放';
    },
    volumeIcon: function() {
      if (this.isMuted || this.volume === 0) return 'fa-solid fa-volume-xmark';
      if (this.volume < 0.3) return 'fa-solid fa-volume-off';
      if (this.volume < 0.7) return 'fa-solid fa-volume-low';
      return 'fa-solid fa-volume-high';
    }
  },
  watch: {
    currentLyricIndex: function(n, o) {
      if (n !== o && n >= 0) this.scrollLyric(n);
    },
    currentSong: function(newSong, oldSong) {
      if (newSong && (!oldSong || newSong.id !== oldSong.id)) {
        this.fetchLyrics(newSong);
        this.triggerBgCrossfade();
      }
    },
    effectMode: function() {
      this.triggerBgCrossfade();
    }
  },
  mounted: function() {
    audioManager.init(this.$store);
    this.fetchSongs();
    this.fetchPlaylists();
    if (this.currentSong && !this.lyrics) {
      this.fetchLyrics(this.currentSong);
    }
    var playlistId = this.$route.query.playlist;
    if (playlistId) {
      var pl = { id: parseInt(playlistId, 10) };
      this.openPlaylistDetail(pl);
      this.$router.replace({ query: {} }).catch(function() {});
    }
    this._keyHandler = function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.nextSong(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); this.prevSong(); }
      else if (e.code === 'Escape') {
        if (this.showPlayer) this.closePlayer();
      }
    }.bind(this);
    document.addEventListener('keydown', this._keyHandler);
  },
  beforeDestroy: function() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    if (this._bgCrossfadeTimer) { clearTimeout(this._bgCrossfadeTimer); this._bgCrossfadeTimer = null; }
  },
  methods: {
    goDesktop: function() {
      this.$router.push('/');
    },
    setLyricsMode: function(mode) {
      this.lyricsMode = mode;
    },
    coverFallbackStyle: function(song) {
      var h = hue(song.title);
      var l = this.isDark ? 22 : 82;
      return { background: 'linear-gradient(135deg, hsl(' + h + ',45%,' + l + '%), hsl(' + ((h + 50) % 360) + ',35%,' + (l - 6) + '%))' };
    },
    lyricLineClass: function(index) {
      var d = Math.abs(index - this.currentLyricIndex);
      if (d === 0) return 'lyric-active';
      if (d === 1) return 'lyric-near';
      if (d <= 2) return 'lyric-far';
      return 'lyric-distant';
    },
    wordHighlightClass: function(line, word, lineIndex) {
      if (lineIndex !== this.currentLyricIndex) return '';
      var p = lrcParser.getWordProgress(line, word, this.currentTime);
      return p > 0 ? 'word-lit' : '';
    },
    wordHighlightStyle: function(line, word, lineIndex) {
      if (lineIndex !== this.currentLyricIndex) return null;
      var p = lrcParser.getWordProgress(line, word, this.currentTime);
      if (p <= 0) return null;
      return { '--wp': Math.min(1, p), '--wp-pct': Math.round(Math.min(1, p) * 100) + '%' };
    },
    fetchSongs: function() {
      var vm = this;
      vm.songsLoading = true;
      api.get('/music/list').then(function(res) {
        if (res.data.code === 200) vm.$store.commit('music/SET_SONGS', res.data.data.songs);
      }).catch(function() {}).finally(function() {
        vm.songsLoading = false;
        vm.fetchPlaylists();
      });
    },
    fetchLyrics: function(song) {
      this.$store.dispatch('music/fetchLyrics', song);
    },
    playSong: function(song) {
      if (this.currentSong && this.currentSong.id === song.id) {
        this.openPlayer();
        this.togglePlay();
        return;
      }
      audioManager.playSong(song);
      this.fetchLyrics(song);
      this.openPlayer();
    },
    openPlayer: function() { this.$store.commit('music/SET_SHOW_PLAYER', true); },
    togglePlay: function() {
      audioManager.toggle();
    },
    closePlayer: function() {
      this.$store.commit('music/SET_SHOW_PLAYER', false);
    },
    nextSong: function() {
      var list = this.playQueue.length > 0 ? this.playQueue : this.songs;
      if (list.length === 0) return;
      var vm = this;
      var idx = vm.currentSong ? list.findIndex(function(s) { return s.id === vm.currentSong.id; }) : -1;
      if (vm.playMode === 'shuffle') {
        var allIdx = vm.songs.findIndex(function(s) { return s.id === vm.currentSong.id; });
        var ni = vm.shuffleNext(allIdx);
        vm.playSong(vm.songs[ni]);
      } else if (vm.playMode === 'repeat-all') {
        vm.playSong(list[(idx + 1) % list.length]);
      } else {
        if (idx < list.length - 1) {
          vm.playSong(list[idx + 1]);
        }
      }
    },
    prevSong: function() {
      var list = this.playQueue.length > 0 ? this.playQueue : this.songs;
      if (list.length === 0) return;
      if (this.currentTime > 3) { audioManager.seek(0); return; }
      var vm = this;
      var idx = vm.currentSong ? list.findIndex(function(s) { return s.id === vm.currentSong.id; }) : 0;
      if (vm.playMode === 'shuffle') {
        var allIdx = vm.songs.findIndex(function(s) { return s.id === vm.currentSong.id; });
        var ni = vm.shufflePrev(allIdx);
        vm.playSong(vm.songs[ni]);
      } else {
        vm.playSong(list[idx <= 0 ? list.length - 1 : idx - 1]);
      }
    },
    shuffleNext: function(currentIdx) {
      if (this.songs.length <= 1) return 0;
      if (this.shufflePool.length === 0) {
        this.shufflePool = [];
        for (var i = 0; i < this.songs.length; i++) {
          if (i !== currentIdx) this.shufflePool.push(i);
        }
        for (var j = this.shufflePool.length - 1; j > 0; j--) {
          var k = Math.floor(Math.random() * (j + 1));
          var tmp = this.shufflePool[j];
          this.shufflePool[j] = this.shufflePool[k];
          this.shufflePool[k] = tmp;
        }
      }
      var next = this.shufflePool.shift();
      this.shuffleHistory.push(currentIdx);
      if (this.shuffleHistory.length > 50) this.shuffleHistory.shift();
      return next;
    },
    shufflePrev: function(currentIdx) {
      if (this.shuffleHistory.length > 0) {
        this.shufflePool.unshift(currentIdx);
        return this.shuffleHistory.pop();
      }
      return currentIdx <= 0 ? this.songs.length - 1 : currentIdx - 1;
    },
    onProgressClick: function(e) {
      if (!this.duration || !this.$refs.progressBar) return;
      var rect = this.$refs.progressBar.getBoundingClientRect();
      audioManager.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * this.duration);
    },
    onProgressMouseDown: function(e) {
      if (!this.duration) return;
      this.isDragging = true;
      this.onProgressClick(e);
      var vm = this;
      var onMove = function(ev) {
        if (!vm.$refs.progressBar) return;
        var rect = vm.$refs.progressBar.getBoundingClientRect();
        audioManager.seek(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * vm.duration);
      };
      var onUp = function() {
        vm.isDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    onProgressTouchStart: function(e) {
      if (!this.duration) return;
      this.isDragging = true;
      var vm = this;
      var touch = e.touches[0];
      var rect = this.$refs.progressBar.getBoundingClientRect();
      audioManager.seek(Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * this.duration);
      var onMove = function(ev) {
        ev.preventDefault();
        if (!vm.$refs.progressBar) return;
        var t = ev.touches[0];
        var r = vm.$refs.progressBar.getBoundingClientRect();
        audioManager.seek(Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)) * vm.duration);
      };
      var onEnd = function() {
        vm.isDragging = false;
        document.removeEventListener('touchmove', onMove, { passive: false });
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
    },
    onVolumeClick: function(e) {
      if (!this.$refs.volumeBar) return;
      var rect = this.$refs.volumeBar.getBoundingClientRect();
      var vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audioManager.setVolume(vol);
      this.$store.commit('music/SET_MUTED', false);
    },
    onVolumeMouseDown: function(e) {
      this.isVolDragging = true;
      this.onVolumeClick(e);
      var vm = this;
      var onMove = function(ev) {
        if (!vm.$refs.volumeBar) return;
        var rect = vm.$refs.volumeBar.getBoundingClientRect();
        var vol = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        audioManager.setVolume(vol);
        vm.$store.commit('music/SET_MUTED', false);
      };
      var onUp = function() {
        vm.isVolDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    onVolumeTouchStart: function(e) {
      this.isVolDragging = true;
      var vm = this;
      var touch = e.touches[0];
      var rect = this.$refs.volumeBar.getBoundingClientRect();
      var vol = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      audioManager.setVolume(vol);
      this.$store.commit('music/SET_MUTED', false);
      var onMove = function(ev) {
        ev.preventDefault();
        if (!vm.$refs.volumeBar) return;
        var t = ev.touches[0];
        var r = vm.$refs.volumeBar.getBoundingClientRect();
        var v = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
        audioManager.setVolume(v);
        vm.$store.commit('music/SET_MUTED', false);
      };
      var onEnd = function() {
        vm.isVolDragging = false;
        document.removeEventListener('touchmove', onMove, { passive: false });
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
    },
    toggleMute: function() {
      if (this.isMuted) {
        this.$store.commit('music/SET_MUTED', false);
        audioManager.setVolume(this.prevVolume || 0.5);
      } else {
        this.prevVolume = this.volume;
        this.$store.commit('music/SET_MUTED', true);
        audioManager.setVolume(0);
      }
    },
    toggleShuffle: function() {
      if (this.playMode === 'shuffle') {
        this.$store.commit('music/SET_PLAY_MODE', 'sequence');
        this.shuffleHistory = [];
        this.shufflePool = [];
      } else {
        this.$store.commit('music/SET_PLAY_MODE', 'shuffle');
      }
    },
    toggleRepeat: function() {
      var m = ['sequence', 'repeat-all', 'repeat-one'];
      this.$store.commit('music/SET_PLAY_MODE', m[(m.indexOf(this.playMode) + 1) % m.length]);
    },
    toggleEffectMode: function() {
      this.effectMode = EFFECT_MODES[(EFFECT_MODES.indexOf(this.effectMode) + 1) % EFFECT_MODES.length];
    },
    triggerBgCrossfade: function() {
      var vm = this;
      if (vm._bgCrossfadeTimer) { clearTimeout(vm._bgCrossfadeTimer); }
      vm._bgCrossfadeActive = true;
      vm.$nextTick(function() {
        vm._bgCrossfadeTimer = setTimeout(function() {
          vm._bgCrossfadeActive = false;
        }, 800);
      });
    },
    seekToLine: function(line) { if (line && line.time !== undefined) audioManager.seek(line.time); },
    scrollLyric: function(index) {
      var vm = this;
      vm.$nextTick(function() {
        var lyricsBody = vm.$refs.lyricsBody;
        if (!lyricsBody) return;
        var el = lyricsBody.children[index + 1];
        if (!el) return;
        var br = lyricsBody.getBoundingClientRect();
        var er = el.getBoundingClientRect();
        var target = lyricsBody.scrollTop + (er.top - br.top) - br.height / 2 + er.height / 2;
        lyricsBody.scrollTo({ top: target, behavior: 'smooth' });
      });
    },
    fmt: function(s) {
      if (!s || isNaN(s)) return '0:00';
      var m = Math.floor(s / 60);
      var sec = Math.floor(s % 60);
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    },

    /* ========== Playlist & Favorite Methods ========== */
    toggleFavorite: function(song) {
      var vm = this;
      api.post('/music/favorite', { songId: song.id }).then(function(res) {
        if (res.data.code === 200) {
          song.isFavorite = res.data.data.isFavorite;
        }
      }).catch(function() {});
    },
    fetchPlaylists: function() {
      var vm = this;
      api.get('/music/playlists').then(function(res) {
        if (res.data.code === 200) {
          vm.playlists = res.data.data.playlists || [];
        }
      }).catch(function() {});
    },
    createPlaylist: function() {
      var vm = this;
      if (!vm.newPlaylistName.trim()) return;
      api.post('/music/playlist/create', {
        name: vm.newPlaylistName.trim(),
        description: vm.newPlaylistDesc.trim()
      }).then(function(res) {
        if (res.data.code === 200) {
          vm.showCreatePlaylist = false;
          vm.newPlaylistName = '';
          vm.newPlaylistDesc = '';
          vm.fetchPlaylists();
        }
      }).catch(function() {});
    },
    deletePlaylist: function(id) {
      var vm = this;
      api.post('/music/playlist/delete', { playlistId: id }).then(function(res) {
        if (res.data.code === 200) {
          if (vm.activeTab === id) vm.activeTab = 'all';
          vm.fetchPlaylists();
        }
      }).catch(function() {});
    },
    addToPlaylist: function(playlistId) {
      var vm = this;
      api.post('/music/playlist/add-song', {
        playlistId: playlistId,
        songId: vm.addToPlaylistSongId
      }).then(function(res) {
        if (res.data.code === 200) {
          vm.showAddToPlaylist = false;
          vm.addToPlaylistSongId = null;
          if (typeof vm.activeTab === 'number' && vm.activeTab === playlistId) {
            vm.openPlaylistDetail(vm.currentPlaylist);
          }
        }
      }).catch(function() {});
    },
    removeFromPlaylist: function(playlistId, songId) {
      var vm = this;
      api.post('/music/playlist/remove-song', {
        playlistId: playlistId,
        songId: songId
      }).then(function(res) {
        if (res.data.code === 200) {
          vm.playlistDetailSongs = vm.playlistDetailSongs.filter(function(id) { return id !== songId; });
        }
      }).catch(function() {});
    },
    openAddToPlaylist: function(song) {
      this.showAddToPlaylist = true;
      this.addToPlaylistSongId = song.id;
    },
    sharePlaylist: function(playlistId) {
      var vm = this;
      var pl = vm.currentPlaylist;
      if (!pl) {
        vm.$toast.show('请先选择一个歌单', { type: 'warning' });
        return;
      }
      vm.showShareDialog = true;
    },
    openPlaylistDetail: function(playlist) {
      var vm = this;
      vm.activeTab = playlist.id;
      api.get('/music/playlist/detail', { params: { playlistId: playlist.id } }).then(function(res) {
        if (res.data.code === 200) {
          vm.playlistDetailSongs = res.data.data.songIds || [];
        } else {
          vm.playlistDetailSongs = [];
        }
      }).catch(function() {
        vm.playlistDetailSongs = [];
      });
    },
    playPlaylist: function(playlistId) {
      var vm = this;
      api.get('/music/playlist/detail', { params: { playlistId: playlistId } }).then(function(res) {
        if (res.data.code === 200) {
          var songIds = res.data.data.songIds || [];
          if (songIds.length > 0) {
            vm.playlistDetailSongs = songIds;
            var playlistSongs = vm.songs.filter(function(s) { return songIds.indexOf(s.id) !== -1; });
            if (playlistSongs.length > 0) {
              vm.$store.commit('music/SET_PLAY_QUEUE', playlistSongs.slice());
              vm.playSong(playlistSongs[0]);
            }
          }
        }
      }).catch(function() {});
    },
    shareToChat: function() {
      var vm = this;
      var pl = vm.currentPlaylist;
      if (!pl) {
        vm.$toast.show('请先选择一个歌单', { type: 'warning' });
        return;
      }
      var forwardData = {
        playlistId: pl.id,
        playlistName: pl.name,
        songCount: vm.playlistDetailSongs.length
      };
      vm.$router.push('/chat?forward=' + encodeURIComponent(JSON.stringify(forwardData)) + '&forwardType=music_playlist');
      vm.showShareDialog = false;
    },
    shareToCommunity: function() {
      var vm = this;
      var pl = vm.currentPlaylist;
      if (!pl) {
        vm.$toast.show('请先选择一个歌单', { type: 'warning' });
        return;
      }
      var postData = {
        playlistId: pl.id,
        playlistName: pl.name,
        songCount: vm.playlistDetailSongs.length,
        description: pl.description || ''
      };
      vm.$router.push('/community?sharePlaylist=' + encodeURIComponent(JSON.stringify(postData)));
      vm.showShareDialog = false;
    }
  }
};
</script>

<style scoped>
.music-page {
  height: 100vh;
  overflow: hidden;
  position: relative;
  background: var(--bg-color);
}

.music-list-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

.music-nav {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 44px;
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border-bottom: 0.5px solid var(--separator-color);
  -webkit-app-region: drag;
  will-change: auto;
}

.music-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--primary-color);
  font-size: var(--font-size-callout);
  cursor: pointer;
  border: none;
  background: none;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.music-nav-btn:hover { background: var(--primary-light); }
.music-nav-btn:active { transform: scale(0.92); opacity: 0.7; }

.music-nav-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-nav-count {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ========== List Layout: Sidebar + Content ========== */
.list-layout {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.list-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border-right: 0.5px solid var(--separator-color);
  overflow-y: auto;
  -webkit-app-region: no-drag;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  min-height: 44px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  -webkit-user-select: none;
  user-select: none;
}

.sidebar-item i {
  font-size: var(--font-size-sm);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.sidebar-item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item:hover {
  background: var(--primary-lighter);
  color: var(--text-primary);
}

.sidebar-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
}

.sidebar-divider {
  height: 0.5px;
  background: var(--separator-color);
  margin: 8px 14px;
}

.sidebar-label {
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 8px 14px 4px;
}

.sidebar-empty {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  padding: 8px 14px;
  text-align: center;
}

.sidebar-create-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 8px 12px 12px;
  padding: 10px 16px;
  min-height: 44px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.sidebar-create-btn:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.sidebar-create-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.sidebar-create-btn i {
  font-size: var(--font-size-caption);
}

.sidebar-import-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 12px 12px;
  padding: 10px 16px;
  min-height: 44px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.sidebar-import-btn:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.sidebar-import-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.sidebar-import-btn i {
  font-size: var(--font-size-caption);
}

.modal-hint {
  margin: 0 0 12px;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  line-height: 1.5;
}

/* ========== List Content ========== */
.list-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0 0 80px;
  contain: layout style;
}

.list-search {
  padding: 16px 24px 8px;
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--primary-lighter);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  min-height: 44px;
  transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.search-box:focus-within {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.search-box i { color: var(--text-tertiary); font-size: var(--font-size-sm); }

.search-box input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
}

.search-box input::placeholder { color: var(--text-tertiary); }

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--border-color);
  border: none;
  color: var(--text-secondary);
  font-size: var(--font-size-caption2);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.search-clear:hover { background: var(--text-tertiary); color: var(--bg-color); }
.search-clear:active { transform: scale(0.92); opacity: 0.7; }

/* ========== Playlist Header ========== */
.playlist-header {
  padding: 16px 24px 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.playlist-header-info {
  flex: 1;
  min-width: 0;
}

.playlist-header-name {
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-header-desc {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin: 4px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.playlist-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  border: 0.5px solid var(--separator-color);
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.playlist-action-btn:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.playlist-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.playlist-action-btn i {
  font-size: var(--font-size-caption2);
}

.playlist-action-btn-danger:hover {
  background: rgba(var(--danger-rgb), 0.08);
  color: var(--danger-color);
  border-color: var(--danger-color);
}

[data-theme="dark"] .playlist-action-btn-danger:hover {
  background: rgba(var(--danger-rgb), 0.15);
  color: var(--danger-color);
}

/* ========== Song List ========== */
.list-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 16px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.song-list {
  padding: 4px 20px;
}

.song-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.2s var(--ease-standard);
  contain: layout style;
}

.song-row:hover {
  background: var(--primary-lighter);
}

.song-row:active {
  background: var(--primary-light);
}

.song-row.active {
  background: var(--primary-lighter);
}

.song-row-cover {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.song-row-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-fallback-sm {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: var(--font-size-subheadline);
}

.cover-playing-sm {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: var(--radius-md);
}

.song-row-info {
  flex: 1;
  min-width: 0;
}

.song-row-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.song-row.active .song-row-title {
  color: var(--primary-color);
}

.song-row-artist {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.song-row-format {
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary);
  background: var(--primary-lighter);
  border-radius: var(--radius-xs);
  padding: 2px 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.song-row-fav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.song-row-fav:hover {
  background: var(--primary-lighter);
  transform: scale(1.1);
}

.song-row-fav:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.song-row-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.song-row-more:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
}

.song-row-more:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.song-row-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.song-row-remove:hover {
  background: rgba(var(--danger-rgb), 0.08);
  color: var(--danger-color);
}

.song-row-remove:active {
  transform: scale(0.92);
  opacity: 0.7;
}

[data-theme="dark"] .song-row-remove:hover {
  background: rgba(var(--danger-rgb), 0.15);
  color: var(--danger-color);
}

.eq-bar {
  width: 3px;
  background: var(--primary-color);
  border-radius: var(--radius-xs);
  animation: eq 0.6s ease-in-out infinite alternate;
}

.eq-bar:nth-child(1) { height: 6px; animation-delay: 0s; }
.eq-bar:nth-child(2) { height: 10px; animation-delay: 0.15s; }
.eq-bar:nth-child(3) { height: 4px; animation-delay: 0.3s; }

@keyframes eq {
  0% { height: 3px; }
  100% { height: 12px; }
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-tertiary);
  gap: 12px;
}

.list-empty i { font-size: 40px; }
.list-empty p { font-size: var(--font-size-sm); margin: 0; }

/* ========== Mini Player ========== */
.mini-player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border-top: 0.5px solid var(--separator-color);
  cursor: pointer;
  overflow: hidden;
}

.mini-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-hover));
  transform-origin: 0 0;
  will-change: transform;
  pointer-events: none;
}

.mini-cover {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
  transition: border-radius 0.3s var(--ease-standard);
}

.mini-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.mini-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-callout);
  background: var(--primary-lighter);
}

.mini-cover-spin {
  animation: miniSpin 12s linear infinite;
}

@keyframes miniSpin {
  to { transform: rotate(360deg); }
}

.mini-info { flex: 1; min-width: 0; }

.mini-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-artist {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text-primary);
  font-size: var(--font-size-callout);
  border: none;
  background: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.mini-btn:hover { color: var(--primary-color); background: var(--primary-light); }
.mini-btn:active { transform: scale(0.92); opacity: 0.7; }

.mini-slide-enter-active,
.mini-slide-leave-active {
  transition: transform 0.35s cubic-bezier(0, 0, 0.2, 1), opacity 0.25s var(--ease-standard);
}

.mini-slide-enter,
.mini-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* ========== Modal Dialogs ========== */
.modal-overlay {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  animation: modalFadeIn 0.2s ease;
}

@keyframes modalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-box {
  background: var(--card-bg);
  border-radius: var(--radius-2xl);
  padding: 24px;
  width: 90%;
  max-width: 400px;
  box-shadow: var(--shadow-lg);
  animation: modalSlideIn 0.25s cubic-bezier(0, 0, 0.2, 1);
}

@keyframes modalSlideIn {
  from { transform: translateY(20px) scale(0.96); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}

.modal-title {
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0 0 20px;
}

.modal-input {
  display: block;
  width: 100%;
  padding: 10px 14px;
  margin-bottom: 12px;
  min-height: 44px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: var(--primary-lighter);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
  box-sizing: border-box;
}

.modal-input:focus {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.modal-input::placeholder {
  color: var(--text-tertiary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.modal-btn {
  padding: 8px 20px;
  min-height: 44px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.modal-btn:hover {
  background: var(--primary-lighter);
  color: var(--text-primary);
}

.modal-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.modal-btn-primary {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}

.modal-btn-primary:hover {
  background: var(--primary-hover);
  color: #fff;
  border-color: var(--primary-hover);
}

.modal-btn-primary:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.modal-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-playlist-list {
  max-height: 260px;
  overflow-y: auto;
}

.modal-playlist-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.modal-playlist-item i {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.modal-playlist-item:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
}

.modal-playlist-item:hover i {
  color: var(--primary-color);
}

.modal-empty {
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  padding: 24px 0;
}

.modal-share-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: 12px;
}

.modal-share-code {
  padding: 12px 16px;
  background: var(--primary-lighter);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  font-family: 'Courier New', Courier, monospace;
  font-size: var(--font-size-callout);
  font-weight: var(--font-weight-semibold);
  color: var(--primary-color);
  word-break: break-all;
  text-align: center;
  letter-spacing: 0.05em;
  -webkit-user-select: all;
  user-select: all;
}

.modal-share-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.modal-share-actions .modal-btn {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-caption);
  gap: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.modal-btn-accent {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border: 0.5px solid var(--primary-color);
}

.modal-btn-accent:hover {
  background: var(--primary-color);
  color: #fff;
}

/* ========== Player Page (unchanged) ========== */
.player-page {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
}

[data-theme="dark"] .player-page {
  color: #fff;
}

.player-bg {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 0;
  overflow: hidden;
  transition: opacity 0.6s var(--ease-standard);
}

.effect-none .player-bg { opacity: 0; pointer-events: none; }

.player-bg-image {
  position: absolute;
  top: -100px; right: -100px; bottom: -100px; left: -100px;
  background-size: cover;
  background-position: center;
  filter: blur(60px) saturate(180%) brightness(0.7);
  transform: scale(1.3);
  transition: filter 0.6s var(--ease-standard);
  will-change: filter;
}

.player-bg-image-next {
  transition: filter 0.6s var(--ease-standard), opacity 1.2s var(--ease-standard);
}

[data-theme="dark"] .player-bg-image {
  filter: blur(80px) saturate(200%) brightness(0.35);
}

.effect-glow .player-bg-image {
  filter: blur(30px) saturate(200%) brightness(0.8);
}

[data-theme="dark"] .effect-glow .player-bg-image {
  filter: blur(40px) saturate(250%) brightness(0.5);
}

.effect-blur .player-bg-image {
  filter: blur(80px) saturate(160%) brightness(0.6);
}

[data-theme="dark"] .effect-blur .player-bg-image {
  filter: blur(100px) saturate(180%) brightness(0.3);
}

.effect-none .player-bg-image {
  filter: none;
  opacity: 0;
}

.player-bg-glow {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  opacity: 0;
  transition: opacity 0.6s var(--ease-standard);
  pointer-events: none;
}

.effect-glow .player-bg-glow {
  opacity: 1;
  background: radial-gradient(ellipse at 30% 40%, rgba(33, 150, 243, 0.08) 0%, transparent 60%),
              radial-gradient(ellipse at 70% 60%, rgba(156, 39, 176, 0.05) 0%, transparent 50%);
  animation: glowPulse 6s ease-in-out infinite alternate;
}

[data-theme="dark"] .effect-glow .player-bg-glow {
  background: radial-gradient(ellipse at 30% 40%, rgba(33, 150, 243, 0.12) 0%, transparent 60%),
              radial-gradient(ellipse at 70% 60%, rgba(156, 39, 176, 0.08) 0%, transparent 50%);
}

@keyframes glowPulse {
  0% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
  100% { opacity: 0.7; transform: scale(1.02); }
}

.player-bg-noise {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  opacity: 0.02;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 128px 128px;
  pointer-events: none;
}

[data-theme="dark"] .player-bg-noise {
  opacity: 0.04;
}

.player-bg-overlay {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.65) 40%, rgba(255,255,255,0.88) 100%);
}

[data-theme="dark"] .player-bg-overlay {
  background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.7) 100%);
}

.player-header {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  flex-shrink: 0;
}

.player-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  color: var(--text-secondary);
  font-size: var(--font-size-callout);
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
}

[data-theme="dark"] .player-back-btn {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.player-back-btn:hover {
  background: rgba(255, 255, 255, 0.75);
  color: var(--text-primary);
}

[data-theme="dark"] .player-back-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.player-back-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.player-header-center {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.player-header-label {
  display: block;
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

[data-theme="dark"] .player-header-label {
  color: rgba(255, 255, 255, 0.3);
}

.player-header-song {
  display: block;
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

[data-theme="dark"] .player-header-song {
  color: rgba(255, 255, 255, 0.6);
}

.player-effect-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  border-radius: var(--radius-2xl);
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  font-size: var(--font-size-footnote);
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
  padding: 0 14px;
}

[data-theme="dark"] .player-effect-btn {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
}

.player-effect-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--primary-color);
}

[data-theme="dark"] .player-effect-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--primary-color);
}

.player-effect-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.effect-label {
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.03em;
}

.player-content {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
  padding: 0 36px 28px;
  gap: 36px;
}

.player-left {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 360px;
  min-height: 0;
}

.album-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  gap: 20px;
}

.album-art-wrap {
  position: relative;
  width: 220px;
  height: 220px;
  flex-shrink: 0;
}

.album-shadow {
  position: absolute;
  top: 8%; right: 8%; bottom: 8%; left: 8%;
  border-radius: var(--radius-2xl);
  z-index: 0;
  filter: blur(48px) brightness(0.4) saturate(150%);
  opacity: 0.5;
  transform: translateY(16px) scale(1.08);
  overflow: hidden;
  background-size: cover;
  background-position: center;
}

.album-art-box {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  overflow: hidden;
  z-index: 1;
  box-shadow: var(--shadow-xl);
  transition: transform 0.4s cubic-bezier(0, 0, 0.2, 1), box-shadow 0.4s var(--ease-standard);
}

.album-art-box:hover {
  transform: scale(1.02);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.5), 0 6px 16px rgba(0, 0, 0, 0.35);
}

.album-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.album-art-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.12);
  font-size: 64px;
}

.song-meta {
  text-align: center;
  width: 100%;
  max-width: 280px;
}

.song-meta-title {
  font-size: var(--font-size-title2);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

[data-theme="dark"] .song-meta-title {
  color: #fff;
}

.song-meta-artist {
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-regular);
  color: var(--text-secondary);
  margin: 4px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

[data-theme="dark"] .song-meta-artist {
  color: rgba(255, 255, 255, 0.45);
}

.progress-section {
  width: 100%;
  flex-shrink: 0;
}

.progress-track-wrap {
  position: relative;
  height: 24px;
  display: flex;
  align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.progress-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: var(--radius-pill);
  transition: height 0.15s;
}

[data-theme="dark"] .progress-track {
  background: rgba(255, 255, 255, 0.08);
}

.progress-track-wrap:hover .progress-track,
.progress-track-wrap.dragging .progress-track {
  height: 5px;
}

.progress-buffered {
  position: absolute;
  left: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: var(--radius-pill);
  width: 100%;
  transform-origin: 0 0;
  will-change: transform;
  transition: height 0.15s;
}

[data-theme="dark"] .progress-buffered {
  background: rgba(255, 255, 255, 0.12);
}

.progress-track-wrap:hover .progress-buffered,
.progress-track-wrap.dragging .progress-buffered {
  height: 5px;
}

.progress-fill {
  position: absolute;
  left: 0;
  height: 3px;
  background: var(--primary-color);
  border-radius: var(--radius-pill);
  width: 100%;
  transform-origin: 0 0;
  will-change: transform;
  transition: height 0.15s;
}

[data-theme="dark"] .progress-fill {
  background: rgba(255, 255, 255, 0.85);
}

.progress-track-wrap:hover .progress-fill,
.progress-track-wrap.dragging .progress-fill {
  height: 5px;
}

.progress-thumb {
  position: absolute;
  width: 0;
  height: 0;
  background: var(--primary-color);
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-sm);
  transition: width 0.15s, height 0.15s;
  pointer-events: none;
  will-change: left;
}

[data-theme="dark"] .progress-thumb {
  background: #fff;
}

.progress-track-wrap:hover .progress-thumb,
.progress-track-wrap.dragging .progress-thumb {
  width: 14px;
  height: 14px;
}

.time-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

[data-theme="dark"] .time-row {
  color: rgba(255, 255, 255, 0.3);
}

.controls-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-shrink: 0;
}

.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
  border: none;
  background: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  position: relative;
  flex-shrink: 0;
}

[data-theme="dark"] .ctrl {
  color: rgba(255, 255, 255, 0.55);
}

.ctrl:hover {
  color: var(--text-primary);
  background: var(--primary-lighter);
}

[data-theme="dark"] .ctrl:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
}

.ctrl:active { transform: scale(0.92); opacity: 0.7; }
.ctrl.on { color: var(--primary-color); }

[data-theme="dark"] .ctrl.on { color: var(--primary-color); }

.ctrl-main {
  width: 56px;
  height: 56px;
  background: var(--primary-color);
  color: #fff;
  font-size: 20px;
  transition: transform 0.2s cubic-bezier(0, 0, 0.2, 1), background 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 15px rgba(var(--primary-rgb), 0.3);
}

[data-theme="dark"] .ctrl-main {
  background: #fff;
  color: #111;
  box-shadow: 0 4px 18px rgba(255, 255, 255, 0.25);
}

.ctrl-main:hover {
  background: var(--primary-hover);
  color: #fff;
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(var(--primary-rgb), 0.45);
}

[data-theme="dark"] .ctrl-main:hover {
  background: rgba(255, 255, 255, 0.9);
  color: #000;
  box-shadow: 0 6px 24px rgba(255, 255, 255, 0.35);
}
.ctrl-main:active { transform: scale(0.92); opacity: 0.7; }

.play-icon { margin-left: 2px; }
.ctrl-main .fa-pause { margin-left: 0; }

.repeat-one {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 8px;
  font-weight: var(--font-weight-bold);
  color: var(--primary-color);
  line-height: 1;
}

[data-theme="dark"] .repeat-one {
  color: var(--primary-color);
}

.bottom-row {
  width: 100%;
  flex-shrink: 0;
  padding: 0 4px;
}

.vol-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.vol-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-footnote);
  border: none;
  background: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

[data-theme="dark"] .vol-btn {
  color: rgba(255, 255, 255, 0.4);
}

.vol-btn:hover {
  color: var(--text-primary);
}

[data-theme="dark"] .vol-btn:hover {
  color: #fff;
}

.vol-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.vol-track-wrap {
  flex: 1;
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.vol-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: var(--radius-pill);
}

[data-theme="dark"] .vol-track {
  background: rgba(255, 255, 255, 0.1);
}

.vol-fill {
  position: absolute;
  left: 0;
  height: 3px;
  background: var(--primary-color);
  border-radius: var(--radius-pill);
  pointer-events: none;
  transition: height 0.15s;
}

[data-theme="dark"] .vol-fill {
  background: rgba(255, 255, 255, 0.4);
}

.vol-track-wrap:hover .vol-fill {
  height: 5px;
  background: var(--primary-hover);
}

[data-theme="dark"] .vol-track-wrap:hover .vol-fill {
  background: rgba(255, 255, 255, 0.5);
}

.vol-thumb {
  position: absolute;
  width: 0;
  height: 0;
  background: var(--primary-color);
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  transition: width 0.15s, height 0.15s;
}

[data-theme="dark"] .vol-thumb {
  background: #fff;
}

.vol-track-wrap:hover .vol-thumb {
  width: 12px;
  height: 12px;
}

.player-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  padding-left: 36px;
  border-left: 0.5px solid var(--separator-color);
}

[data-theme="dark"] .player-right {
  border-left-color: rgba(255, 255, 255, 0.08);
}

.lyrics-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.lyrics-mode-bar {
  display: flex;
  justify-content: center;
  padding: 0 0 14px;
  flex-shrink: 0;
}

.lyrics-mode-capsule {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.04);
  border-radius: var(--radius-2xl);
  padding: 3px;
  gap: 2px;
}

[data-theme="dark"] .lyrics-mode-capsule {
  background: rgba(255, 255, 255, 0.06);
}

.lyrics-mode-btn {
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-medium);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  padding: 5px 18px;
  min-height: 44px;
  cursor: pointer;
  transition: color var(--duration-normal) var(--ease-standard), background var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

[data-theme="dark"] .lyrics-mode-btn {
  color: rgba(255, 255, 255, 0.35);
}

.lyrics-mode-btn:hover {
  color: var(--text-secondary);
}

[data-theme="dark"] .lyrics-mode-btn:hover {
  color: rgba(255, 255, 255, 0.6);
}

.lyrics-mode-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.lyrics-mode-btn.active {
  color: var(--primary-color);
  background: var(--primary-light);
  box-shadow: 0 1px 4px rgba(33, 150, 243, 0.15);
}

[data-theme="dark"] .lyrics-mode-btn.active {
  color: #fff;
  background: rgba(33, 150, 243, 0.25);
}

.no-lyrics-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-tertiary);
}

[data-theme="dark"] .no-lyrics-hint {
  color: rgba(255, 255, 255, 0.08);
}

.no-lyrics-hint i { font-size: 48px; }
.no-lyrics-hint span { font-size: 14px; }

.lyrics-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 24px 0 0;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 10%, black 92%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, black 10%, black 92%, transparent 100%);
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  will-change: scroll-position;
}

.lyrics-scroll::-webkit-scrollbar { display: none; }
.lyrics-scroll { scrollbar-width: none; }

.lyrics-pad-top { height: 40%; }
.lyrics-pad-bottom { height: 50%; }

.lyric-line {
  padding: 10px 0;
  cursor: pointer;
  transition: opacity 0.35s var(--ease-standard), transform 0.35s var(--ease-standard);
  opacity: 0.2;
  transform: translate3d(0, 4px, 0);
  transform-origin: left center;
}

.lyric-line.lyric-near {
  opacity: 0.5;
  transform: translate3d(0, 2px, 0);
}

.lyric-line.lyric-far {
  opacity: 0.3;
  transform: translate3d(0, 1px, 0);
}

.lyric-line.lyric-distant {
  opacity: 0.2;
  transform: translate3d(0, 4px, 0);
}

.lyric-line.lyric-active {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

.lyric-line:hover {
  opacity: 0.5;
}

.lyric-line.lyric-active:hover {
  opacity: 1;
}

.lyric-text {
  font-size: 26px;
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  line-height: 1.35;
  letter-spacing: -0.01em;
}

[data-theme="dark"] .lyric-text {
  color: #fff;
}

.lyric-line.lyric-active .lyric-text {
  letter-spacing: -0.02em;
}

[data-theme="light"] .lyric-line.lyric-active .lyric-text {
  color: var(--text-primary);
}

.lyric-words { display: inline; }

.lyric-word {
  font-size: 26px;
  font-weight: var(--font-weight-bold);
  color: var(--text-tertiary);
  line-height: 1.35;
  letter-spacing: -0.01em;
}

[data-theme="dark"] .lyric-word {
  color: rgba(255, 255, 255, 0.2);
}

[data-theme="light"] .lyric-word {
  color: rgba(0, 0, 0, 0.3);
}

.lyric-line.lyric-active .lyric-word {
  letter-spacing: -0.02em;
}

[data-theme="light"] .lyric-line.lyric-active .lyric-word {
  color: var(--text-primary);
}

.lyric-line.lyric-active .lyric-word.word-lit {
  background: linear-gradient(90deg, var(--text-primary) 0%, var(--text-primary) var(--wp-pct, 100%), var(--text-tertiary) var(--wp-pct, 100%));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: var(--text-primary);
}

[data-theme="dark"] .lyric-line.lyric-active .lyric-word.word-lit {
  background: linear-gradient(90deg, #fff 0%, #fff var(--wp-pct, 100%), rgba(255,255,255,0.2) var(--wp-pct, 100%));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.lyric-line:not(.lyric-active) .lyric-word.word-lit {
  color: var(--text-tertiary);
}

[data-theme="dark"] .lyric-line:not(.lyric-active) .lyric-word.word-lit {
  color: rgba(255, 255, 255, 0.2);
}

.lyric-trans {
  display: block;
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-regular);
  color: var(--text-tertiary);
  margin-top: 5px;
  line-height: 1.5;
  letter-spacing: 0.02em;
  transition: opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  transform: translate3d(0, 2px, 0);
  opacity: 0.65;
}

[data-theme="light"] .lyric-trans {
  color: rgba(0, 0, 0, 0.38);
  opacity: 0.8;
}

[data-theme="dark"] .lyric-trans {
  color: rgba(255, 255, 255, 0.2);
  opacity: 0.75;
}

.lyric-line.lyric-active .lyric-trans {
  color: var(--text-secondary);
  transform: translate3d(0, 0, 0);
  opacity: 1;
}

[data-theme="light"] .lyric-line.lyric-active .lyric-trans {
  color: rgba(0, 0, 0, 0.6);
}

[data-theme="dark"] .lyric-line.lyric-active .lyric-trans {
  color: rgba(255, 255, 255, 0.5);
}

.lyric-line.lyric-near .lyric-trans {
  opacity: 0.5;
}

.lyric-char {
  display: inline-block;
  font-size: 26px;
  font-weight: var(--font-weight-bold);
  color: var(--text-tertiary);
  line-height: 1.35;
  letter-spacing: -0.01em;
  opacity: 0.15;
  transform: translate3d(0, 0, 0);
}

[data-theme="light"] .lyric-char {
  color: rgba(0, 0, 0, 0.22);
  opacity: 0.25;
}

.lyric-char-space {
  width: 0.3em;
}

[data-theme="dark"] .lyric-char {
  color: rgba(255, 255, 255, 0.15);
}

.lyric-line:not(.lyrics-drop) .lyric-char {
  transition: opacity 0.3s var(--ease-standard);
}

.lyric-line.lyrics-drop.lyric-active .lyric-char {
  color: var(--text-primary);
  opacity: 1;
  will-change: transform, opacity;
  animation: charIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i, 0) * 60ms) both;
}

[data-theme="light"] .lyric-line.lyrics-drop.lyric-active .lyric-char {
  color: var(--text-primary);
}

[data-theme="dark"] .lyric-line.lyrics-drop.lyric-active .lyric-char {
  color: #fff;
}

.lyric-line.lyrics-drop.lyric-active .lyric-char-space {
  animation: none;
  opacity: 1;
  transform: none;
}

[data-theme="dark"] .lyric-line.lyrics-drop.lyric-active .lyric-char-space {
  animation: none;
  opacity: 1;
  transform: none;
}

@keyframes charIn {
  0% {
    opacity: 0;
    transform: translate3d(0, -30px, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(0, 3px, 0);
  }
  80% {
    transform: translate3d(0, -1px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

.lyric-line.lyrics-drop:not(.lyric-active) .lyric-char {
  opacity: 0.15;
  transform: translate3d(0, 0, 0);
  color: var(--text-tertiary);
  animation: none;
  will-change: auto;
}

[data-theme="light"] .lyric-line.lyrics-drop:not(.lyric-active) .lyric-char {
  color: rgba(0, 0, 0, 0.22);
  opacity: 0.25;
}

[data-theme="dark"] .lyric-line.lyrics-drop:not(.lyric-active) .lyric-char {
  color: rgba(255, 255, 255, 0.15);
}

.lyric-words-drop {
  line-height: 1.4;
}

.lyric-line.lyrics-drop.lyric-active .lyric-words-drop {
}

.lyric-trans-drop {
  display: block;
  opacity: 0;
  transform: translate3d(0, 8px, 0);
  transition: opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.4s,
              transform 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.4s;
  margin-top: 5px;
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-regular);
  color: var(--text-tertiary);
  line-height: 1.5;
  letter-spacing: 0.02em;
}

.lyric-trans-drop.trans-dropped {
  opacity: 0.75;
  transform: translate3d(0, 0, 0);
  color: var(--text-secondary);
}

[data-theme="light"] .lyric-trans-drop.trans-dropped {
  color: rgba(0, 0, 0, 0.55);
}

[data-theme="dark"] .lyric-trans-drop.trans-dropped {
  color: rgba(255, 255, 255, 0.5);
}

.lyric-line.lyrics-drop {
  transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  overflow: visible;
}

.lyric-line.lyrics-drop.lyric-active {
  opacity: 1;
}

.lyric-line.lyrics-drop.lyric-near {
  opacity: 0.4;
}

.lyric-line.lyrics-drop.lyric-far {
  opacity: 0.2;
}

.lyric-line.lyrics-drop.lyric-distant {
  opacity: 0.1;
}

.player-slide-enter-active {
  transition: transform 0.5s cubic-bezier(0, 0, 0.2, 1);
}

.player-slide-leave-active {
  transition: transform 0.35s cubic-bezier(0.5, 0, 0.75, 0);
}

.player-slide-enter,
.player-slide-leave-to {
  transform: translateY(100%);
}

/* Small screen: stack vertically */
@media (max-width: 767px), (orientation: portrait) {
  .player-content {
    flex-direction: column;
    gap: 20px;
    padding: 0 24px 20px;
    overflow-y: auto;
  }

  .player-left {
    width: 100%;
    flex: 0 0 auto;
    gap: 12px;
  }

  .album-art-wrap {
    width: 180px;
    height: 180px;
  }

  .song-meta { max-width: 100%; }
  .song-meta-title { font-size: 18px; }
  .song-meta-artist { font-size: 13px; }

  .player-right {
    flex: 0 0 auto;
    min-height: 200px;
    padding-left: 0;
    border-left: none;
    border-top: 0.5px solid var(--separator-color);
    padding-top: 16px;
  }

  [data-theme="dark"] .player-right {
    border-top-color: rgba(255, 255, 255, 0.08);
    border-left-color: transparent;
  }

  .controls-section { gap: 12px; }
  .ctrl { width: 44px; height: 44px; font-size: var(--font-size-callout); }
  .ctrl-main { width: 56px; height: 56px; font-size: var(--font-size-title3); }
}

@media (min-width: 1024px) and (orientation: landscape) {
  .song-list {
    padding: 4px 24px;
  }

  .song-row {
    padding: 10px 16px;
    gap: 16px;
  }

  .song-row-cover {
    width: 52px;
    height: 52px;
  }

  .song-row-title { font-size: var(--font-size-body); }
  .song-row-artist { font-size: var(--font-size-sm); }

  .player-content {
    padding: 0 48px 24px;
    gap: 48px;
  }

  .player-left {
    width: 400px;
    gap: 18px;
  }

  .album-art-wrap {
    width: 260px;
    height: 260px;
  }

  .player-right {
    padding-left: 48px;
  }

  .song-meta-title { font-size: 22px; }
  .song-meta-artist { font-size: 15px; }

  .lyric-text { font-size: 28px; }
  .lyric-word { font-size: 28px; }
  .lyric-char { font-size: 28px; }
  .lyric-trans { font-size: 14px; }
  .lyric-trans-drop { font-size: 14px; }

  .ctrl-main {
    width: 60px;
    height: 60px;
    font-size: 22px;
  }
}

@media (min-width: 1280px) and (orientation: landscape) {
  .song-row-cover {
    width: 56px;
    height: 56px;
  }

  .song-row-title { font-size: var(--font-size-body); }

  .player-content {
    gap: 56px;
  }

  .player-left {
    width: 440px;
  }

  .album-art-wrap {
    width: 300px;
    height: 300px;
  }

  .player-right {
    padding-left: 56px;
  }

  .song-meta { max-width: 340px; }
  .song-meta-title { font-size: 24px; }
  .song-meta-artist { font-size: 16px; }

  .lyric-text { font-size: 30px; }
  .lyric-word { font-size: 30px; }
  .lyric-char { font-size: 30px; }
  .lyric-trans { font-size: 15px; }
  .lyric-trans-drop { font-size: 15px; }
}

@media (min-width: 1600px) and (orientation: landscape) {
  .song-row-cover {
    width: 60px;
    height: 60px;
  }

  .player-content {
    gap: 64px;
  }

  .player-left {
    width: 500px;
  }

  .album-art-wrap {
    width: 340px;
    height: 340px;
  }

  .player-right {
    padding-left: 64px;
  }

  .song-meta { max-width: 400px; }
  .song-meta-title { font-size: 26px; }

  .lyric-text { font-size: 32px; }
  .lyric-word { font-size: 32px; }
  .lyric-char { font-size: 32px; }
  .lyric-trans { font-size: 16px; }
  .lyric-trans-drop { font-size: 16px; }
}
</style>
