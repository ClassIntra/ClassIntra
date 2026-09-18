<template>
  <div class="music-page" :data-theme="theme">
    <div class="music-list-page">
      <div class="music-nav">
        <button class="music-nav-btn" @click="goDesktop" title="返回桌面">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <h1 class="music-nav-title">音乐</h1>
        <div class="music-nav-count" v-if="isNcmTab">{{ ncmSongs.length }} 首</div>
        <div class="music-nav-count" v-else-if="songs.length > 0">{{ filteredSongs.length }} / {{ songs.length }}</div>
      </div>

      <div class="list-layout">
        <div class="list-sidebar scrollbar-thin">
          <div class="sidebar-nav">
            <!-- 库切换器：插件已安装时显示，网易云为主库 -->
            <div v-if="ncmAvailable" class="library-switch">
              <button class="library-switch-btn" :class="{ active: librarySource === 'ncm' }" @click="switchLibrary('ncm')">
                <i class="fa-solid fa-cloud"></i>
                <span>网易云</span>
              </button>
              <button class="library-switch-btn" :class="{ active: librarySource === 'local' }" @click="switchLibrary('local')">
                <i class="fa-solid fa-hard-drive"></i>
                <span>本地音乐</span>
              </button>
            </div>

            <!-- 本地音乐页面 -->
            <template v-if="!ncmAvailable || librarySource === 'local'">
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
            </template>

            <!-- 网易云音乐页面 -->
            <template v-else>
              <div class="sidebar-label">在线音乐</div>
              <div class="sidebar-item" :class="{ active: activeTab === 'ncm-daily' }" @click="openNcmTab('ncm-daily')">
                <i class="fa-solid fa-calendar-day"></i>
                <span>每日推荐</span>
              </div>
              <div class="sidebar-item" :class="{ active: activeTab === 'ncm-top' }" @click="openNcmTab('ncm-top')">
                <i class="fa-solid fa-fire"></i>
                <span>热歌排行榜</span>
              </div>
              <div class="sidebar-item" :class="{ active: activeTab === 'ncm-fav' }" @click="openNcmTab('ncm-fav')">
                <i class="fa-solid fa-heart"></i>
                <span>网易云收藏</span>
              </div>
              <div class="sidebar-divider"></div>
              <div class="sidebar-label">网易云歌单</div>
              <div
                v-for="pl in ncmPlaylists"
                :key="'ncm-pl-' + pl.id"
                class="sidebar-item"
                :class="{ active: activeTab === 'ncm-pl-' + pl.id }"
                @click="openNcmTab('ncm-pl-' + pl.id)"
              >
                <i class="fa-solid fa-cloud"></i>
                <span class="sidebar-item-name">{{ pl.name }}</span>
              </div>
              <div v-if="!ncmLoggedIn" class="sidebar-item" @click="startQrLogin">
                <i class="fa-solid fa-qrcode"></i>
                <span>扫码登录网易云</span>
              </div>
              <div v-else class="sidebar-item" @click="ncmLogout" title="点击退出网易云登录">
                <i class="fa-solid fa-circle-user"></i>
                <span class="sidebar-item-name">{{ ncmProfile && ncmProfile.nickname ? ncmProfile.nickname : '已登录' }}</span>
              </div>
            </template>
          </div>
          <button v-if="!ncmAvailable || librarySource === 'local'" class="sidebar-create-btn" @click="showCreatePlaylist = true">
            <i class="fa-solid fa-plus"></i>
            <span>新建歌单</span>
          </button>
        </div>

        <div class="list-content scrollbar-thin" ref="listBody">
          <div class="list-search">
            <div class="search-box">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input
                v-model="searchQuery"
                :placeholder="isNcmTab ? '搜索网易云音乐，回车搜索' : '搜索歌曲或艺术家'"
                @keyup.enter="onSearchEnter"
                @input="onNcmInput"
                @focus="onNcmFocus"
                @blur="onNcmBlur"
              />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div v-if="isNcmTab && ncmSuggestShow && ncmSuggest.length" class="ncm-suggest scrollbar-thin">
              <div v-for="(sg, i) in ncmSuggest" :key="i" class="ncm-suggest-item" @mousedown.prevent="pickNcmSuggest(sg)">
                <i class="fa-solid fa-magnifying-glass"></i>
                <span class="ncm-suggest-name">{{ sg.name }}</span>
                <span class="ncm-suggest-meta">{{ sg.meta }}</span>
              </div>
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

          <div v-if="isNcmTab" class="playlist-header">
            <div class="playlist-header-info ncm-header-info">
              <img v-if="ncmHeaderCover" class="ncm-header-cover" :src="ncmHeaderCover" alt="" loading="lazy" decoding="async" />
              <div class="ncm-header-text">
                <h2 class="playlist-header-name">{{ ncmTabTitle }}</h2>
                <span class="ncm-header-sub">{{ ncmSongs.length }} 首 · 来自网易云音乐</span>
              </div>
            </div>
            <div class="playlist-header-actions">
              <select class="ncm-quality-select" :value="ncmQuality" @change="onNcmQualityChange" title="网易云音质，下一首生效">
                <option value="">音质：跟随服务器</option>
                <option value="standard">标准音质</option>
                <option value="higher">较高音质</option>
                <option value="exhigh">极高音质</option>
                <option value="lossless">无损音质</option>
              </select>
              <button class="playlist-action-btn" @click="playNcmAll">
                <i class="fa-solid fa-play"></i>
                <span>播放全部</span>
              </button>
            </div>
          </div>

          <div v-if="songsLoading || (isNcmTab && ncmLoading)" class="list-loading">
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
              @contextmenu.prevent="onSongContextMenu(song)"
            >
              <div class="song-row-cover">
                <img v-if="song.coverUrl" :src="song.coverUrl" loading="lazy" decoding="async" @error="onCoverError(song)" />
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
              <span v-if="song.format" class="song-row-format" :class="{ 'song-row-vip': song.format === 'VIP' }">{{ song.format }}</span>
              <button class="song-row-fav" @click.stop="toggleFavorite(song)" :title="song.isFavorite ? '取消收藏' : '收藏'">
                <i
                  v-if="song.source === 'netease'"
                  :class="song.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart'"
                  :style="song.isFavorite ? 'color: var(--danger-color)' : ''"
                ></i>
                <i v-else :class="song.isFavorite ? 'fa-solid fa-star' : 'fa-regular fa-star'" :style="song.isFavorite ? 'color: var(--primary-color)' : ''"></i>
              </button>
              <button v-if="song.source !== 'netease'" class="song-row-more" @click.stop="openAddToPlaylist(song)" title="添加到歌单">
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

          <div v-if="isNcmTab && ncmHasMore" class="ncm-load-more">
            <button class="playlist-action-btn" :disabled="ncmLoadingMore" @click="loadNcmMore">
              <i :class="ncmLoadingMore ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-chevron-down'"></i>
              <span>{{ ncmLoadingMore ? '加载中...' : '加载更多' }}</span>
            </button>
          </div>

          <div v-if="!songsLoading && !(isNcmTab && ncmLoading) && filteredSongs.length === 0" class="list-empty">
            <template v-if="isNcmTab && !ncmLoggedIn && !searchQuery">
              <i class="fa-solid fa-cloud"></i>
              <p>登录网易云，开启每日推荐与海量在线曲库</p>
              <button class="playlist-action-btn" @click="startQrLogin">
                <i class="fa-solid fa-right-to-bracket"></i>
                <span>扫码 / 手机号登录</span>
              </button>
            </template>
            <template v-else>
              <i class="fa-solid fa-music"></i>
              <p>{{ searchQuery ? '未找到匹配的歌曲' : (activeTab === 'favorites' ? '暂无收藏' : (typeof activeTab === 'number' ? '歌单为空' : (isNcmTab ? '暂无内容' : '暂无歌曲'))) }}</p>
            </template>
          </div>
        </div>
      </div>

      <transition name="mini-slide">
        <div v-if="currentSong" class="mini-player" @click="openPlayer">
          <div class="mini-cover" :class="{ 'mini-cover-spin': isPlaying }">
            <img v-if="currentSong.coverUrl" :src="currentSong.coverUrl" @error="onCoverError(currentSong)" />
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
                  <img v-if="currentSong.coverUrl" :src="currentSong.coverUrl" class="album-art" @error="onCoverError(currentSong)" />
                  <div v-else class="album-art-fallback" :style="placeholderStyle">
                    <i class="fa-solid fa-music"></i>
                  </div>
                </div>
              </div>
              <div class="song-meta">
                <div class="song-meta-title-row">
                  <h2 class="song-meta-title">{{ currentSong.title }}</h2>
                  <span v-if="currentSong.format === 'VIP'" class="song-meta-badge song-meta-badge-vip">VIP</span>
                  <span v-if="ncmLevelLabel" class="song-meta-badge song-meta-badge-level">{{ ncmLevelLabel }}</span>
                </div>
                <p class="song-meta-artist">
                  <span class="song-meta-artist-name">{{ currentSong.artist }}</span>
                  <span v-if="currentSong.source === 'netease'" class="song-meta-source"><i class="fa-solid fa-cloud"></i>网易云</span>
                </p>
                <div class="song-meta-sub">
                  <span v-if="currentSong.album" class="song-meta-album">{{ currentSong.album }}</span>
                  <button class="song-meta-fav" @click.stop="toggleFavorite(currentSong)" :title="currentSong.isFavorite ? '取消收藏' : '收藏'">
                    <i
                      v-if="currentSong.source === 'netease'"
                      :class="currentSong.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart'"
                      :style="currentSong.isFavorite ? 'color: var(--danger-color)' : ''"
                    ></i>
                    <i v-else :class="currentSong.isFavorite ? 'fa-solid fa-star' : 'fa-regular fa-star'" :style="currentSong.isFavorite ? 'color: var(--primary-color)' : ''"></i>
                  </button>
                </div>
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

    <!-- Modal: 网易云登录（扫码 / 手机密码 / 手机验证码） -->
    <div v-if="showNcmLogin" class="modal-overlay" @click.self="closeNcmLogin">
      <div class="modal-box ncm-login-box">
        <div class="modal-title">网易云音乐登录</div>
        <div class="ncm-login-tabs">
          <button :class="{ active: ncmLoginMode === 'qr' }" @click="switchNcmLoginMode('qr')"><i class="fa-solid fa-qrcode"></i><span>扫码</span></button>
          <button :class="{ active: ncmLoginMode === 'password' }" @click="switchNcmLoginMode('password')"><i class="fa-solid fa-lock"></i><span>密码登录</span></button>
          <button :class="{ active: ncmLoginMode === 'captcha' }" @click="switchNcmLoginMode('captcha')"><i class="fa-solid fa-comment-sms"></i><span>验证码</span></button>
        </div>

        <div v-if="ncmLoginMode === 'qr'" class="ncm-qr-wrap">
          <div v-if="ncmQrLoading" class="ncm-qr-tip">正在生成二维码...</div>
          <template v-else-if="ncmQr && !ncmQrExpired">
            <div class="ncm-qr-box">
              <div v-for="(row, ri) in ncmQr.rows" :key="ri" class="ncm-qr-row">
                <span v-for="(cell, ci) in row" :key="ci" class="ncm-qr-cell" :class="{ 'ncm-qr-cell-dark': cell === 1 }"></span>
              </div>
            </div>
            <div class="ncm-qr-tip">使用网易云音乐 App 扫一扫登录</div>
            <div class="ncm-qr-status" :class="{ 'ncm-qr-status-ok': ncmQrScanned || ncmLoggedIn }">{{ ncmQrStatusText }}</div>
          </template>
          <template v-else>
            <div class="ncm-qr-tip">二维码已过期，请重新生成</div>
            <button class="modal-btn modal-btn-primary" @click="startQrLogin">刷新二维码</button>
          </template>
        </div>

        <div v-else class="ncm-login-form">
          <div class="ncm-login-row">
            <select v-model="ncmLoginForm.countrycode" class="ncm-login-cc" title="国家 / 地区码">
              <option value="86">+86</option>
              <option value="852">+852</option>
              <option value="853">+853</option>
              <option value="886">+886</option>
              <option value="65">+65</option>
              <option value="60">+60</option>
              <option value="1">+1</option>
              <option value="44">+44</option>
              <option value="81">+81</option>
              <option value="82">+82</option>
            </select>
            <input v-model="ncmLoginForm.phone" class="ncm-login-input" type="tel" placeholder="网易云手机号" maxlength="20" />
          </div>
          <div v-if="ncmLoginMode === 'password'" class="ncm-login-row">
            <input v-model="ncmLoginForm.password" class="ncm-login-input" type="password" placeholder="网易云密码" autocomplete="off" @keyup.enter="submitNcmLogin" />
          </div>
          <div v-else class="ncm-login-row">
            <input v-model="ncmLoginForm.captcha" class="ncm-login-input" type="text" inputmode="numeric" placeholder="短信验证码" maxlength="6" @keyup.enter="submitNcmLogin" />
            <button class="ncm-captcha-btn" :disabled="ncmCaptchaCountdown > 0 || !ncmLoginForm.phone.trim()" @click="sendNcmCaptcha">
              {{ ncmCaptchaCountdown > 0 ? ncmCaptchaCountdown + 's 后重发' : '发送验证码' }}
            </button>
          </div>
          <button class="modal-btn modal-btn-primary ncm-login-submit" :disabled="ncmLoginLoading" @click="submitNcmLogin">
            {{ ncmLoginLoading ? '登录中...' : '登录' }}
          </button>
          <p class="ncm-login-hint">账号信息仅保存在本服务器，访问设备无需直连网易云</p>
        </div>

        <div class="modal-actions">
          <button class="modal-btn" @click="closeNcmLogin">关闭</button>
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
      librarySource: 'local', // 当前库页面：'ncm' = 网易云（主库）/ 'local' = 本地音乐
      ncmAvailable: false, // 网易云插件是否安装（启动时探测 /status）
      showCreatePlaylist: false,
      newPlaylistName: '',
      newPlaylistDesc: '',
      showAddToPlaylist: false,
      addToPlaylistSongId: null,
      showShareDialog: false,
      playlistDetailSongs: [],
      // 网易云音乐插件状态
      ncmLoggedIn: false,
      ncmProfile: null,
      ncmSongs: [],
      ncmPlaylists: [],
      ncmToplistId: 3778678, // 云音乐热歌榜
      ncmLoading: false,
      showNcmLogin: false,
      ncmQr: null,
      ncmQrLoading: false,
      ncmQrExpired: false,
      ncmQrScanned: false, // 已扫码待确认（802）
      _ncmQrTimer: null,
      ncmLoginMode: 'qr', // 登录方式：qr=扫码 / password=手机密码 / captcha=手机验证码
      ncmLoginForm: { phone: '', countrycode: '86', password: '', captcha: '' },
      ncmLoginLoading: false,
      ncmCaptchaCountdown: 0,
      _ncmCaptchaTimer: null,
      ncmSuggest: [], // 搜索联想下拉
      ncmSuggestShow: false,
      _ncmSuggestTimer: null,
      ncmSearchOffset: 0, // 搜索翻页游标
      ncmHasMore: false,
      ncmLoadingMore: false, // 搜索追加翻页加载中（按钮内联态，避免列表抖动）
      ncmLastKeyword: '',
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
    isNcmTab: function() {
      return typeof this.activeTab === 'string' && this.activeTab.indexOf('ncm-') === 0;
    },
    ncmTabTitle: function() {
      var t = this.activeTab;
      if (t === 'ncm-daily') return '每日推荐';
      if (t === 'ncm-top') return '热歌排行榜';
      if (t === 'ncm-fav') return '网易云收藏';
      if (t && t.indexOf('ncm-pl-') === 0) {
        var id = parseInt(t.substring(7), 10);
        var pl = this.ncmPlaylists.find(function(p) { return p.id === id; });
        return pl ? pl.name : '网易云歌单';
      }
      return '网易云音乐';
    },
    ncmQrStatusText: function() {
      // 由轮询结果驱动：等待扫码 → 已扫码待确认 → 登录成功（随后关闭弹窗）
      if (this.ncmLoggedIn) return '登录成功';
      if (this.ncmQrScanned) return '已扫码，请在手机上确认';
      return '等待扫码中...';
    },
    ncmPlayError: function() {
      return this.$store.state.music.ncmPlayError;
    },
    ncmQuality: function() {
      return this.$store.state.music.ncmQuality;
    },
    ncmLevel: function() {
      return this.$store.state.music.ncmLevel;
    },
    ncmLevelLabel: function() {
      // 换流返回的实际音质 → 中文标签（仅网易云歌曲显示）
      var map = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res', jyeffect: '高清环绕', sky: '沉浸环绕' };
      if (!this.ncmLevel) return '';
      return map[this.ncmLevel] || this.ncmLevel;
    },
    ncmHeaderCover: function() {
      // 网易云歌单头封面（打开歌单 tab 时展示）
      var t = this.activeTab;
      if (typeof t === 'string' && t.indexOf('ncm-pl-') === 0) {
        var id = parseInt(t.substring(7), 10);
        var pl = this.ncmPlaylists.find(function(p) { return p.id === id; });
        return (pl && pl.coverUrl) || '';
      }
      return '';
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
      } else if (vm.isNcmTab) {
        list = vm.ncmSongs;
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
    // 音量 / 播放模式偏好持久化（刷新后保持）
    volume: function(v) {
      try { localStorage.setItem('music.volume', String(v)); } catch (e) { /* 隐私模式下不可用 */ }
    },
    playMode: function(m) {
      try { localStorage.setItem('music.playMode', String(m)); } catch (e) { /* 隐私模式下不可用 */ }
    },
    // 切换列表页后回到顶部，避免残留上一页滚动位置
    activeTab: function() {
      var vm = this;
      vm.$nextTick(function() {
        if (vm.$refs.listBody) vm.$refs.listBody.scrollTop = 0;
      });
    },
    ncmPlayError: function(n) {
      // 网易云换流失败：toast 提示后立即清空，避免重复弹出
      if (!n) return;
      if (this.$toast) this.$toast.show(n, { type: 'error' });
      this.$store.commit('music/SET_PLAY_ERROR', null);
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
    this._mountedAt = Date.now(); // 用于「插件安装时自动以网易云为主库」的时间窗判断
    this.restoreAudioPrefs();
    this.fetchSongs();
    this.fetchPlaylists();
    this.fetchNcmStatus();
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
    if (this._ncmSuggestTimer) { clearTimeout(this._ncmSuggestTimer); this._ncmSuggestTimer = null; }
    if (this._ncmCaptchaTimer) { clearInterval(this._ncmCaptchaTimer); this._ncmCaptchaTimer = null; }
    this.stopQrPolling();
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
    // 封面加载失败（图片中转断网等）：清空地址让占位渐变兜底
    onCoverError: function(song) {
      if (song && song.coverUrl) song.coverUrl = '';
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
      // 网易云歌曲：通过 store action 处理票据换流；本地歌曲直接走 audioManager
      if (song.source === 'netease') {
        // 队列对齐当前网易云列表，保证自动连播/切歌在在线列表内进行
        if (this.isNcmTab && this.ncmSongs.length > 0) {
          this.$store.commit('music/SET_PLAY_QUEUE', this.ncmSongs.slice());
        } else if (!this.playQueue.some(function(s) { return s.id === song.id; })) {
          this.$store.commit('music/SET_PLAY_QUEUE', [song]);
        }
        this.$store.dispatch('music/play', song);
        this.openPlayer();
        return;
      }
      // 从在线队列切回本地歌曲时清空在线队列，避免连播错源
      if (this.playQueue.length > 0 && this.playQueue[0] && this.playQueue[0].source === 'netease') {
        this.$store.commit('music/SET_PLAY_QUEUE', []);
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
      // 当前是在线歌曲：在在线队列内切歌
      if (this.currentSong && this.currentSong.source === 'netease') {
        this.ncmSkip(1);
        return;
      }
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
      // 当前是在线歌曲：在在线队列内切歌
      if (this.currentSong && this.currentSong.source === 'netease') {
        if (this.currentTime > 3) { audioManager.seek(0); return; }
        this.ncmSkip(-1);
        return;
      }
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
      // 网易云歌曲：调用插件收藏接口（在线同步网易云红心，离线写本地镜像）
      if (song.source === 'netease') {
        api.post('/netease-music/like', {
          id: song.ncmId,
          like: !song.isFavorite,
          song: { id: song.ncmId, title: song.title, artist: song.artist, cover: song.coverUrl }
        }).then(function(res) {
          if (res.data && res.data.code === 200) {
            song.isFavorite = res.data.like;
          }
        }).catch(function() {
          if (vm.$toast) vm.$toast.show('收藏操作失败', { type: 'error' });
        });
        return;
      }
      api.post('/music/favorite', { songId: song.id }).then(function(res) {
        if (res.data.code === 200) {
          song.isFavorite = res.data.data.isFavorite;
        }
      }).catch(function() {});
    },
    onSongContextMenu: function(song) {
      // 在线歌曲不支持加入本地歌单
      if (song.source === 'netease') return;
      this.openAddToPlaylist(song);
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
    },

    /* ========== 网易云音乐 ========== */
    ncmSkip: function(dir) {
      var vm = this;
      var list = vm.playQueue.length > 0 ? vm.playQueue : vm.ncmSongs;
      if (!list.length || !vm.currentSong) return;
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === vm.currentSong.id) { idx = i; break; }
      }
      if (vm.playMode === 'shuffle') {
        var r = idx;
        if (list.length > 1) {
          while (r === idx) r = Math.floor(Math.random() * list.length);
        }
        vm.playSong(list[r]);
        return;
      }
      var ni = idx + dir;
      if (ni < 0) ni = list.length - 1;
      if (ni >= list.length) ni = 0;
      vm.playSong(list[ni]);
    },
    normalizeNcmSong: function(s) {
      var artists = s.ar || s.artists || [];
      var names = [];
      for (var i = 0; i < artists.length; i++) {
        if (artists[i] && artists[i].name) names.push(artists[i].name);
      }
      var album = s.al || s.album || {};
      var pic = album.picUrl || s.picUrl || '';
      return {
        id: 'ncm-' + s.id,
        ncmId: s.id,
        source: 'netease',
        title: s.name || ('歌曲 ' + s.id),
        artist: names.join(' / ') || '未知歌手',
        album: album.name || '',
        coverUrl: pic ? ('/api/netease-music/image?u=' + encodeURIComponent(pic)) : '',
        hasLyrics: true,
        lyricsUrl: '',
        isFavorite: false,
        // fee: 1 = VIP 曲目
        format: s.fee === 1 ? 'VIP' : '',
        fee: s.fee
      };
    },
    fetchNcmStatus: function() {
      var vm = this;
      api.get('/netease-music/status').then(function(res) {
        var d = res.data || {};
        vm.ncmAvailable = true; // 插件已安装
        vm.ncmLoggedIn = !!d.loggedIn;
        vm.ncmProfile = d.profile || null;
        // 插件安装时以网易云为主库：启动 10 秒内用户未主动切换过页面则自动进入网易云页
        if (!vm._libSwitched && vm.activeTab === 'all' && Date.now() - (vm._mountedAt || 0) < 10000) {
          vm.switchLibrary('ncm');
        }
        if (vm.ncmLoggedIn) vm.loadNcmPlaylists();
      }).catch(function() {
        vm.ncmAvailable = false; // 插件未安装：仅显示本地库
      });
    },
    // 从 localStorage 恢复音量 / 播放模式偏好（默认 sequence / 0.8）
    restoreAudioPrefs: function() {
      var v = this.loadPref('music.volume', '0.8');
      var pv = parseFloat(v);
      if (!isNaN(pv)) {
        pv = Math.max(0, Math.min(1, pv));
        this.$store.commit('music/SET_VOLUME', pv);
        try { audioManager.setVolume(pv); } catch (e) {}
      }
      var m = this.loadPref('music.playMode', 'sequence');
      if (m === 'shuffle' || m === 'repeat-one' || m === 'sequence') {
        this.$store.commit('music/SET_PLAY_MODE', m);
      }
    },
    // localStorage 包装（隐私模式等异常吞掉）
    loadPref: function(key, def) {
      try {
        var v = localStorage.getItem(key);
        return v === null || v === undefined ? def : v;
      } catch (e) { return def; }
    },
    // 库切换：网易云与本地音乐分属两个页面，插件安装时网易云为主库
    switchLibrary: function(source) {
      if (source === this.librarySource) return;
      this._libSwitched = true;
      this.librarySource = source;
      this.searchQuery = '';
      this.closeNcmSuggest();
      if (source === 'ncm') {
        this.openNcmTab('ncm-daily');
      } else {
        this.activeTab = 'all';
      }
    },
    loadNcmPlaylists: function() {
      var vm = this;
      api.get('/netease-music/user/playlist').then(function(res) {
        var body = res.data || {};
        vm.ncmPlaylists = (body.playlist || []).map(function(p) {
          return {
            id: p.id,
            name: p.name,
            // 保留封面，经插件图片中转，供歌单头展示
            coverUrl: p.coverImgUrl ? ('/api/netease-music/image?u=' + encodeURIComponent(p.coverImgUrl)) : ''
          };
        });
      }).catch(function() {});
    },
    openNcmTab: function(tab) {
      if (this.activeTab === tab && this.ncmSongs.length > 0) return;
      this.activeTab = tab;
      this.searchQuery = '';
      if (tab === 'ncm-daily') this.loadNcmDaily();
      else if (tab === 'ncm-top') this.loadNcmToplist();
      else if (tab === 'ncm-fav') this.loadNcmFavorites();
      else if (tab.indexOf('ncm-pl-') === 0) this.loadNcmPlaylistTracks(parseInt(tab.substring(7), 10));
    },
    setNcmSongs: function(rawList) {
      var vm = this;
      var list = [];
      for (var i = 0; i < rawList.length; i++) {
        if (rawList[i] && rawList[i].id) list.push(vm.normalizeNcmSong(rawList[i]));
      }
      vm.ncmSongs = list;
      vm.fillNcmFavoriteState();
    },
    fillNcmFavoriteState: function() {
      var vm = this;
      var ids = vm.ncmSongs.map(function(s) { return s.ncmId; });
      var CHUNK = 200; // 分块批量查询，避免 URL 过长
      for (var i = 0; i < ids.length; i += CHUNK) {
        (function(chunk) {
          api.get('/netease-music/like/check', { params: { ids: chunk.join(',') } }).then(function(res) {
            var info = (res.data && res.data.checkInfo) || [];
            var map = {};
            for (var j = 0; j < info.length; j++) map[info[j].id] = info[j].liked;
            for (var k = 0; k < vm.ncmSongs.length; k++) {
              if (map[vm.ncmSongs[k].ncmId] !== undefined) vm.ncmSongs[k].isFavorite = !!map[vm.ncmSongs[k].ncmId];
            }
          }).catch(function() {});
        })(ids.slice(i, i + CHUNK));
      }
    },
    loadNcmDaily: function() {
      var vm = this;
      vm.ncmLoading = true;
      api.get('/netease-music/recommend/songs').then(function(res) {
        var body = res.data || {};
        var songs = (body.data && body.data.dailySongs) || [];
        if (body.code === 200 && songs.length) {
          vm.setNcmSongs(songs);
          vm.ncmLoading = false;
        } else {
          // 未登录或无推荐：回退热歌榜并提示
          if (vm.$toast) vm.$toast.show('未登录网易云，已为你展示热歌榜', { type: 'info' });
          vm.loadNcmToplist();
        }
      }).catch(function() {
        if (vm.$toast) vm.$toast.show('未登录网易云，已为你展示热歌榜', { type: 'info' });
        vm.loadNcmToplist();
      });
    },
    loadNcmToplist: function() {
      var vm = this;
      vm.ncmLoading = true;
      api.get('/netease-music/playlist/track/all', { params: { id: vm.ncmToplistId, limit: 100 } }).then(function(res) {
        var body = res.data || {};
        vm.setNcmSongs(body.songs || (body.playlist && body.playlist.tracks) || []);
        vm.ncmLoading = false;
      }).catch(function() {
        vm.ncmSongs = [];
        vm.ncmLoading = false;
      });
    },
    loadNcmFavorites: function() {
      var vm = this;
      vm.ncmLoading = true;
      api.get('/netease-music/like/list').then(function(res) {
        var body = res.data || {};
        var ids = (body.ids || []).slice(0, 500);
        if (!ids.length) {
          vm.ncmSongs = [];
          vm.ncmLoading = false;
          return;
        }
        return api.get('/netease-music/song/detail', { params: { ids: ids.join(',') } }).then(function(res2) {
          var d = res2.data || {};
          vm.setNcmSongs(d.songs || []);
          vm.ncmLoading = false;
        });
      }).catch(function() {
        vm.ncmSongs = [];
        vm.ncmLoading = false;
      });
    },
    loadNcmPlaylistTracks: function(id) {
      var vm = this;
      vm.ncmLoading = true;
      api.get('/netease-music/playlist/track/all', { params: { id: id, limit: 200 } }).then(function(res) {
        var body = res.data || {};
        vm.setNcmSongs(body.songs || (body.playlist && body.playlist.tracks) || []);
        vm.ncmLoading = false;
      }).catch(function() {
        vm.ncmSongs = [];
        vm.ncmLoading = false;
      });
    },
    onSearchEnter: function() {
      if (!this.isNcmTab) return;
      var kw = this.searchQuery.trim();
      this.closeNcmSuggest();
      if (!kw) return;
      var vm = this;
      vm.ncmLoading = true;
      vm.ncmLastKeyword = kw;
      vm.ncmSearchOffset = 0;
      api.get('/netease-music/search', { params: { keywords: kw, type: 1, limit: 50 } }).then(function(res) {
        var body = res.data || {};
        var songs = (body.result && body.result.songs) || [];
        var count = (body.result && body.result.songCount) || 0;
        vm.setNcmSongs(songs);
        vm.ncmSearchOffset = songs.length;
        vm.ncmHasMore = songs.length > 0 && songs.length < count;
        vm.ncmLoading = false;
      }).catch(function() {
        vm.ncmSongs = [];
        vm.ncmHasMore = false;
        vm.ncmLoading = false;
      });
    },
    // 搜索结果追加翻页（跳过与当前列表重复的歌曲）
    loadNcmMore: function() {
      if (!this.ncmHasMore || this.ncmLoadingMore || !this.ncmLastKeyword) return;
      var vm = this;
      vm.ncmLoadingMore = true;
      api.get('/netease-music/search', { params: { keywords: vm.ncmLastKeyword, type: 1, limit: 50, offset: vm.ncmSearchOffset } }).then(function(res) {
        var body = res.data || {};
        var songs = (body.result && body.result.songs) || [];
        var count = (body.result && body.result.songCount) || 0;
        for (var i = 0; i < songs.length; i++) {
          if (!songs[i] || !songs[i].id) continue;
          var nid = 'ncm-' + songs[i].id;
          var dup = vm.ncmSongs.some(function(s) { return s.id === nid; });
          if (!dup) vm.ncmSongs.push(vm.normalizeNcmSong(songs[i]));
        }
        vm.ncmSearchOffset += songs.length;
        vm.ncmHasMore = songs.length > 0 && vm.ncmSearchOffset < count;
        vm.fillNcmFavoriteState();
        vm.ncmLoadingMore = false;
      }).catch(function() {
        vm.ncmLoadingMore = false;
      });
    },
    /* --- 搜索联想（仅网易云 tab，400ms 防抖） --- */
    onNcmInput: function() {
      var vm = this;
      if (vm._ncmSuggestTimer) { clearTimeout(vm._ncmSuggestTimer); vm._ncmSuggestTimer = null; }
      var kw = vm.searchQuery.trim();
      if (!vm.isNcmTab || !kw) { vm.closeNcmSuggest(); return; }
      vm._ncmSuggestTimer = setTimeout(function() {
        vm._ncmSuggestTimer = null;
        api.get('/netease-music/search/suggest', { params: { keywords: kw } }).then(function(res) {
          var body = res.data || {};
          var result = body.result || {};
          var items = [];
          var songs = result.songs || [];
          for (var i = 0; i < songs.length && items.length < 8; i++) {
            var names = [];
            var ar = songs[i].artists || [];
            for (var a = 0; a < ar.length; a++) { if (ar[a] && ar[a].name) names.push(ar[a].name); }
            items.push({ name: songs[i].name, meta: names.join(' / ') || '歌曲' });
          }
          var artists = result.artists || [];
          for (var j = 0; j < artists.length && items.length < 8; j++) {
            items.push({ name: artists[j].name, meta: '歌手' });
          }
          var albums = result.albums || [];
          for (var k = 0; k < albums.length && items.length < 8; k++) {
            items.push({ name: albums[k].name, meta: '专辑' });
          }
          vm.ncmSuggest = items;
          vm.ncmSuggestShow = items.length > 0;
        }).catch(function() { vm.closeNcmSuggest(); });
      }, 400);
    },
    onNcmFocus: function() {
      if (this.isNcmTab && this.ncmSuggest.length) this.ncmSuggestShow = true;
    },
    onNcmBlur: function() {
      // 延迟关闭，避免与下拉点击冲突（mousedown.prevent 已兜底）
      var vm = this;
      setTimeout(function() { vm.ncmSuggestShow = false; }, 200);
    },
    pickNcmSuggest: function(sg) {
      this.searchQuery = sg.name;
      this.closeNcmSuggest();
      this.onSearchEnter();
    },
    closeNcmSuggest: function() {
      this.ncmSuggestShow = false;
    },
    // 音质切换：写入 store，下一次换流请求生效
    onNcmQualityChange: function(e) {
      var val = e.target.value || '';
      this.$store.commit('music/SET_NCM_QUALITY', val);
      var label = val === '' ? '跟随服务器' : e.target.options[e.target.selectedIndex].text;
      if (this.$toast) this.$toast.show('音质已切换为「' + label + '」，下一首生效', { type: 'info' });
    },
    playNcmAll: function() {
      if (this.ncmSongs.length === 0) return;
      this.playSong(this.ncmSongs[0]);
    },
    // 登录弹窗内切换登录方式；切回扫码时若二维码缺失/过期则重新生成
    switchNcmLoginMode: function(m) {
      this.ncmLoginMode = m;
      if (m === 'qr' && (!this.ncmQr || this.ncmQrExpired)) this.startQrLogin();
    },
    // 发送短信验证码（60s 倒计时）
    sendNcmCaptcha: function() {
      var vm = this;
      var phone = vm.ncmLoginForm.phone.trim();
      if (!phone) {
        if (vm.$toast) vm.$toast.show('请先输入手机号', { type: 'info' });
        return;
      }
      if (vm.ncmCaptchaCountdown > 0) return;
      api.post('/netease-music/login/captcha/send', { phone: phone, countrycode: vm.ncmLoginForm.countrycode }).then(function() {
        if (vm.$toast) vm.$toast.show('验证码已发送，请查收短信', { type: 'success' });
        vm.ncmCaptchaCountdown = 60;
        vm._ncmCaptchaTimer = setInterval(function() {
          vm.ncmCaptchaCountdown--;
          if (vm.ncmCaptchaCountdown <= 0 && vm._ncmCaptchaTimer) {
            clearInterval(vm._ncmCaptchaTimer);
            vm._ncmCaptchaTimer = null;
          }
        }, 1000);
      }).catch(function() {
        if (vm.$toast) vm.$toast.show('验证码发送失败，请稍后重试', { type: 'error' });
      });
    },
    // 手机号登录（密码 / 验证码由当前 tab 决定）
    submitNcmLogin: function() {
      var vm = this;
      var f = vm.ncmLoginForm;
      if (!f.phone.trim() || vm.ncmLoginLoading) return;
      var payload = { phone: f.phone.trim(), countrycode: f.countrycode };
      if (vm.ncmLoginMode === 'captcha') {
        if (!f.captcha.trim()) {
          if (vm.$toast) vm.$toast.show('请输入短信验证码', { type: 'info' });
          return;
        }
        payload.captcha = f.captcha.trim();
      } else {
        if (!f.password) {
          if (vm.$toast) vm.$toast.show('请输入密码', { type: 'info' });
          return;
        }
        payload.password = f.password;
      }
      vm.ncmLoginLoading = true;
      api.post('/netease-music/login/cellphone', payload).then(function(res) {
        vm.ncmLoginLoading = false;
        var d = res.data || {};
        if (d.code === 200) {
          vm.ncmLoggedIn = true;
          vm.ncmProfile = d.profile || vm.ncmProfile;
          vm.closeNcmLogin();
          vm.ncmLoginForm.password = '';
          vm.ncmLoginForm.captcha = '';
          vm.loadNcmPlaylists();
          // 登录成功回到网易云主库并刷新每日推荐
          if (vm.librarySource === 'ncm') vm.openNcmTab('ncm-daily');
          else vm.switchLibrary('ncm');
          if (vm.$toast) vm.$toast.show('网易云音乐登录成功', { type: 'success' });
        } else {
          if (vm.$toast) vm.$toast.show(d.message || '登录失败，请检查账号信息', { type: 'error' });
        }
      }).catch(function(err) {
        vm.ncmLoginLoading = false;
        var msg = (err && err.response && err.response.data && err.response.data.message) || '登录失败，请检查账号信息';
        if (vm.$toast) vm.$toast.show(msg, { type: 'error' });
      });
    },
    startQrLogin: function() {
      var vm = this;
      vm.showNcmLogin = true;
      vm.ncmQrExpired = false;
      vm.ncmQrScanned = false;
      vm.ncmQr = null;
      vm.ncmQrLoading = true;
      vm.stopQrPolling();
      api.post('/netease-music/login/qr/create').then(function(res) {
        var d = res.data || {};
        if (d.code === 200 && d.rows && d.unikey) {
          vm.ncmQr = d;
          vm.ncmQrLoading = false;
          vm.startQrPolling(d.unikey);
        } else {
          vm.ncmQrLoading = false;
          vm.ncmQrExpired = true;
        }
      }).catch(function() {
        vm.ncmQrLoading = false;
        vm.ncmQrExpired = true;
      });
    },
    startQrPolling: function(key) {
      var vm = this;
      vm.stopQrPolling();
      vm._ncmQrTimer = setInterval(function() {
        api.get('/netease-music/login/qr/check', { params: { key: key } }).then(function(res) {
          var code = res.data && res.data.code;
          if (code === 803) {
            vm.stopQrPolling();
            vm.ncmLoggedIn = true;
            vm.ncmProfile = (res.data && res.data.profile) || vm.ncmProfile;
            vm.showNcmLogin = false;
            vm.loadNcmPlaylists();
            vm.openNcmTab('ncm-daily');
            if (vm.$toast) vm.$toast.show('网易云音乐登录成功', { type: 'success' });
          } else if (code === 800) {
            vm.stopQrPolling();
            vm.ncmQrExpired = true;
          } else if (code === 802) {
            vm.ncmQrScanned = true; // 已扫码待确认，绿色提示
          }
          // 801 等待扫码：继续轮询
        }).catch(function() {});
      }, 2500);
    },
    stopQrPolling: function() {
      if (this._ncmQrTimer) { clearInterval(this._ncmQrTimer); this._ncmQrTimer = null; }
    },
    closeNcmLogin: function() {
      this.showNcmLogin = false;
      this.stopQrPolling();
    },
    ncmLogout: function() {
      var vm = this;
      api.post('/netease-music/logout').then(function() {
        vm.ncmLoggedIn = false;
        vm.ncmProfile = null;
        vm.ncmPlaylists = [];
        if (vm.isNcmTab) vm.activeTab = 'all';
        if (vm.$toast) vm.$toast.show('已退出网易云登录', { type: 'info' });
      }).catch(function() {});
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
.music-nav-btn:active { transform: scale(0.94); opacity: 0.7; }

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

/* 库切换器（iPadOS 分段控件风格）：网易云为主库 / 本地音乐 */
.library-switch {
  display: flex;
  gap: 3px;
  margin: 0 6px 10px;
  padding: 3px;
  border-radius: 10px;
  background: var(--primary-lighter);
}

.library-switch-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.library-switch-btn i { font-size: 11px; }

.library-switch-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] .library-switch-btn.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.library-switch-btn:not(.active):hover { color: var(--text-primary); }

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
  transform: scale(0.94);
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
  transform: scale(0.94);
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
.search-clear:active { transform: scale(0.94); opacity: 0.7; }

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

.playlist-action-btn:disabled {
  opacity: 0.55;
  cursor: default;
  transform: none;
}

.playlist-action-btn:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.playlist-action-btn:active {
  transform: scale(0.94);
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
  transition: background var(--duration-normal) var(--ease-standard);
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
  transform: scale(0.94);
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
  transform: scale(0.94);
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
  transform: scale(0.94);
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
  transition: border-radius var(--duration-slow) var(--ease-standard);
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
.mini-btn:active { transform: scale(0.94); opacity: 0.7; }

.mini-slide-enter-active,
.mini-slide-leave-active {
  transition: transform var(--duration-slow) var(--ease-decelerate), opacity var(--duration-normal) var(--ease-standard);
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
  transform: scale(0.94);
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
  transform: scale(0.94);
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
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
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
  /* 规范例外：背景图交叉淡入 1.2s 属节奏参数（§5.5.1 第 9 项），
     filter 0.6s 同理 —— 长时长是有意的缓慢过渡 */
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
  transform: scale(0.94);
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
  transform: scale(0.94);
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
  border-radius: var(--radius-lg);
  overflow: hidden;
  z-index: 1;
  box-shadow: var(--shadow-xl);
  transition: transform var(--duration-slow) var(--ease-decelerate), box-shadow var(--duration-slow) var(--ease-standard);
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-regular);
  color: var(--text-secondary);
  margin: 4px 0 0;
  letter-spacing: 0.01em;
  min-width: 0;
}

.song-meta-artist-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-meta-title-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
}

.song-meta-title-row .song-meta-title { min-width: 0; flex-shrink: 1; }

.song-meta-badge {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.03em;
  line-height: 1.5;
  vertical-align: middle;
}

.song-meta-badge-vip {
  color: #b8860b;
  background: rgba(255, 200, 60, 0.18);
  border: 0.5px solid rgba(255, 200, 60, 0.45);
}

[data-theme="dark"] .song-meta-badge-vip {
  color: #ffd700;
  background: rgba(255, 215, 0, 0.12);
}

.song-meta-badge-level {
  color: var(--primary-color);
  background: var(--primary-lighter);
  border: 0.5px solid var(--primary-color);
}

.song-meta-source {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  color: #c20c0c;
  background: rgba(194, 12, 12, 0.08);
  border: 0.5px solid rgba(194, 12, 12, 0.35);
}

.song-meta-source i { font-size: 9px; }

[data-theme="dark"] .song-meta-source {
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.35);
}

.song-meta-sub {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 6px;
}

.song-meta-album {
  min-width: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-meta-fav {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.song-meta-fav:hover { background: var(--primary-lighter); transform: scale(1.08); }
.song-meta-fav:active { transform: scale(0.92); }

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
  /* 规范例外：波形条高度即音量语义，scaleY 会拉伸圆角（§5.5.2 形状形变豁免） */
  transition: height var(--duration-fast) var(--ease-standard);
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
  /* 规范例外：波形条高度即音量语义，scaleY 会拉伸圆角（§5.5.2 形状形变豁免） */
  transition: height var(--duration-fast) var(--ease-standard);
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
  /* 规范例外：波形条高度即音量语义，scaleY 会拉伸圆角（§5.5.2 形状形变豁免） */
  transition: height var(--duration-fast) var(--ease-standard);
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
  /* 规范例外：滑块尺寸即语义，面积 < 200px²（§5.5.2 形状形变豁免） */
  transition: width var(--duration-fast) var(--ease-standard), height var(--duration-fast) var(--ease-standard);
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

.ctrl:active { transform: scale(0.94); opacity: 0.7; }
.ctrl.on { color: var(--primary-color); }

[data-theme="dark"] .ctrl.on { color: var(--primary-color); }

.ctrl-main {
  width: 56px;
  height: 56px;
  background: var(--primary-color);
  color: #fff;
  font-size: 20px;
  transition: transform var(--duration-normal) var(--ease-decelerate), background var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
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
.ctrl-main:active { transform: scale(0.94); opacity: 0.7; }

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
  transform: scale(0.94);
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
  /* 规范例外：波形条高度即音量语义，scaleY 会拉伸圆角（§5.5.2 形状形变豁免） */
  transition: height var(--duration-fast) var(--ease-standard);
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
  /* 规范例外：滑块尺寸即语义，面积 < 200px²（§5.5.2 形状形变豁免） */
  transition: width var(--duration-fast) var(--ease-standard), height var(--duration-fast) var(--ease-standard);
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
  transform: scale(0.94);
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
  transition: opacity var(--duration-slow) var(--ease-standard), transform var(--duration-slow) var(--ease-standard);
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
  transition: opacity var(--duration-slow) var(--ease-standard);
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
  transition: opacity var(--duration-slow) var(--ease-standard) cubic-bezier(0.22, 1, 0.36, 1);
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
  transition: transform var(--duration-slow) var(--ease-decelerate);
}

.player-slide-leave-active {
  transition: transform var(--duration-slow) var(--ease-standard) cubic-bezier(0.5, 0, 0.75, 0);
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

/* ========== 网易云音乐 ========== */
.song-row-vip {
  color: #b8860b;
  background: rgba(212, 160, 23, 0.14);
  font-weight: var(--font-weight-bold);
}

[data-theme="dark"] .song-row-vip {
  color: #e6b84c;
  background: rgba(230, 184, 76, 0.14);
}

.ncm-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 8px 0 4px;
}

.ncm-qr-box {
  display: inline-block;
  padding: 10px;
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.ncm-qr-row {
  display: flex;
  height: 4px;
}

.ncm-qr-cell {
  width: 4px;
  height: 4px;
  background: transparent;
}

.ncm-qr-cell-dark {
  background: #111;
}

.ncm-qr-tip {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  text-align: center;
}

.ncm-qr-status {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.ncm-qr-status-ok { color: var(--success-color); font-weight: var(--font-weight-medium); }

/* ========== 网易云登录弹窗（多方式） ========== */
.ncm-login-box { width: 380px; max-width: calc(100vw - 48px); }

.ncm-login-tabs {
  display: flex;
  gap: 3px;
  padding: 3px;
  margin-bottom: 16px;
  border-radius: 10px;
  background: var(--primary-lighter);
}

.ncm-login-tabs button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 32px;
  padding: 4px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.ncm-login-tabs button i { font-size: 11px; }
.ncm-login-tabs button.active { background: var(--card-bg); color: var(--text-primary); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); }
[data-theme="dark"] .ncm-login-tabs button.active { background: rgba(255, 255, 255, 0.12); }

.ncm-login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ncm-login-row {
  display: flex;
  gap: 8px;
}

.ncm-login-cc {
  width: 78px;
  min-height: 44px;
  padding: 6px 8px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: var(--primary-lighter);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  outline: none;
  cursor: pointer;
}

.ncm-login-input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 10px 14px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: var(--primary-lighter);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}

.ncm-login-input:focus { border-color: var(--primary-color); }
.ncm-login-input::placeholder { color: var(--text-tertiary); }

.ncm-captcha-btn {
  min-height: 44px;
  padding: 0 14px;
  white-space: nowrap;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: var(--primary-lighter);
  color: var(--primary-color);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.ncm-captcha-btn:disabled { opacity: 0.5; cursor: default; }

.ncm-login-submit { width: 100%; justify-content: center; margin-top: 2px; }

.ncm-login-hint {
  margin: 0;
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

/* ========== 网易云搜索联想下拉 ========== */
.ncm-suggest {
  position: absolute;
  left: 24px;
  right: 24px;
  top: 64px;
  z-index: 5;
  max-height: 280px;
  overflow-y: auto;
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.ncm-suggest-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: background var(--duration-fast) var(--ease-standard);
}

.ncm-suggest-item:hover { background: var(--primary-lighter); }
.ncm-suggest-item i { color: var(--text-tertiary); font-size: var(--font-size-caption); }

.ncm-suggest-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ncm-suggest-meta {
  flex-shrink: 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  max-width: 40%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ========== 网易云 tab 头（封面 + 音质） ========== */
.ncm-header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ncm-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ncm-header-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ncm-header-info .playlist-header-name { min-width: 0; flex-shrink: 1; }

.ncm-header-cover {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.ncm-quality-select {
  min-height: 44px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 0.5px solid var(--separator-color);
  background: var(--primary-lighter);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  outline: none;
}

.ncm-quality-select:hover { border-color: var(--primary-color); color: var(--primary-color); }

/* ========== 网易云搜索加载更多 ========== */
.ncm-load-more {
  display: flex;
  justify-content: center;
  padding: 8px 24px 20px;
}
</style>
