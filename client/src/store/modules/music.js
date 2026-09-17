import audioManager from '@/utils/audio-manager';
import api from '@/utils/api';
import lrcParser from '@/utils/lrc-parser';

var state = {
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,
  playMode: 'sequence',
  playQueue: [],
  songs: [],
  lyrics: null,
  currentLyricIndex: -1,
  showPlayer: false,
  bufferedEnd: 0
};

var mutations = {
  SET_CURRENT_SONG: function (state, song) {
    state.currentSong = song;
  },
  SET_PLAYING: function (state, isPlaying) {
    state.isPlaying = isPlaying;
  },
  SET_CURRENT_TIME: function (state, time) {
    state.currentTime = time;
  },
  SET_DURATION: function (state, duration) {
    state.duration = duration;
  },
  SET_VOLUME: function (state, volume) {
    state.volume = volume;
  },
  SET_MUTED: function (state, isMuted) {
    state.isMuted = isMuted;
  },
  SET_PLAY_MODE: function (state, mode) {
    state.playMode = mode;
  },
  SET_PLAY_QUEUE: function (state, queue) {
    state.playQueue = queue;
  },
  SET_SONGS: function (state, songs) {
    state.songs = songs;
  },
  SET_LYRICS: function (state, lyrics) {
    state.lyrics = lyrics;
  },
  SET_CURRENT_LYRIC_INDEX: function (state, index) {
    state.currentLyricIndex = index;
  },
  SET_SHOW_PLAYER: function (state, show) {
    state.showPlayer = show;
  },
  SET_BUFFERED_END: function (state, end) {
    state.bufferedEnd = end;
  }
};

// 播放入口：网易云歌曲需先向插件换取同源播放地址（带短时票据），本地歌曲直接播放
function startPlayback(dispatch, song) {
  if (song && song.source === 'netease' && song.ncmId) {
    api.get('/netease-music/song/url', { params: { id: song.ncmId } }).then(function (res) {
      var body = res.data || {};
      var item = body.data && body.data[0];
      if (body.code === 200 && item && item.url) {
        song.audioUrl = item.url;
        audioManager.playSong(song);
        dispatch('fetchLyrics', song);
      }
      // 获取失败（VIP/无版权等）时静默停止，不打断队列
    }).catch(function () {});
    return;
  }
  audioManager.playSong(song);
  dispatch('fetchLyrics', song);
}

// 合并网易云官方翻译歌词：tlyric 按时间戳（≤0.5s）对齐写入 line.translation
function mergeTranslation(parsed, tlyricText) {
  if (!tlyricText || !parsed || !parsed.lines || !parsed.lines.length) return parsed;
  var tLines = [];
  var raw = tlyricText.split('\n');
  for (var i = 0; i < raw.length; i++) {
    var line = raw[i].trim();
    if (!line) continue;
    var m = line.match(/^\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\]/);
    if (!m) continue;
    var text = line.substring(m[0].length).trim();
    if (!text) continue;
    var parts = m[1].split(':');
    tLines.push({ time: parseInt(parts[0], 10) * 60 + parseFloat(parts[1]), text: text });
  }
  if (!tLines.length) return parsed;
  var lines = parsed.lines;
  for (var j = 0; j < lines.length; j++) {
    if (lines[j].translation) continue;
    for (var k = 0; k < tLines.length; k++) {
      if (Math.abs(tLines[k].time - lines[j].time) <= 0.5) {
        lines[j].translation = tLines[k].text;
        break;
      }
    }
  }
  return parsed;
}

var actions = {
  play: function (_ref, song) {
    var commit = _ref.commit;
    var dispatch = _ref.dispatch;
    var isNcm = song && song.source === 'netease' && song.ncmId;
    startPlayback(dispatch, song);
    commit('SET_CURRENT_SONG', song);
    // 在线歌曲需异步换流，待 audioManager 真正起播后再标记播放态
    if (!isNcm) commit('SET_PLAYING', true);
  },
  pause: function (_ref) {
    var commit = _ref.commit;
    audioManager.pause();
    commit('SET_PLAYING', false);
  },
  toggle: function (_ref) {
    audioManager.toggle();
  },
  next: function (_ref) {
    var commit = _ref.commit;
    var dispatch = _ref.dispatch;
    var state = _ref.state;
    var queue = state.playQueue.length > 0 ? state.playQueue : state.songs;
    var current = state.currentSong;
    var mode = state.playMode;
    if (!queue.length || !current) return;
    var index = queue.findIndex(function (s) { return s.id === current.id; });
    if (index === -1) index = 0;
    var nextSong;
    if (mode === 'shuffle') {
      var nextIndex = Math.floor(Math.random() * queue.length);
      nextSong = queue[nextIndex];
    } else if (mode === 'repeat-one') {
      audioManager.seek(0);
      audioManager.resume();
      return;
    } else {
      var nextIdx = (index + 1) % queue.length;
      nextSong = queue[nextIdx];
    }
    commit('SET_CURRENT_LYRIC_INDEX', -1);
    commit('SET_LYRICS', null);
    startPlayback(dispatch, nextSong);
  },
  prev: function (_ref) {
    var commit = _ref.commit;
    var dispatch = _ref.dispatch;
    var state = _ref.state;
    var queue = state.playQueue.length > 0 ? state.playQueue : state.songs;
    var current = state.currentSong;
    if (!queue.length || !current) return;
    var index = queue.findIndex(function (s) { return s.id === current.id; });
    if (index === -1) index = 0;
    var prevIdx = (index - 1 + queue.length) % queue.length;
    var prevSong = queue[prevIdx];
    commit('SET_CURRENT_LYRIC_INDEX', -1);
    commit('SET_LYRICS', null);
    startPlayback(dispatch, prevSong);
  },
  seek: function (_ref, time) {
    audioManager.seek(time);
  },
  updateTime: function (_ref, time) {
    var commit = _ref.commit;
    commit('SET_CURRENT_TIME', time);
  },
  updateLyricIndex: function (_ref) {
    var commit = _ref.commit;
    var state = _ref.state;
    var lyrics = state.lyrics;
    var currentTime = state.currentTime;
    if (!lyrics || !lyrics.lines || !lyrics.lines.length) return;
    var index = -1;
    for (var i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time <= currentTime) {
        index = i;
      } else {
        break;
      }
    }
    if (index !== state.currentLyricIndex) {
      commit('SET_CURRENT_LYRIC_INDEX', index);
    }
  },
  fetchLyrics: function (_ref, song) {
    var commit = _ref.commit;
    var state = _ref.state;
    if (!song) return;
    // 网易云歌曲：走插件歌词接口，并合并官方翻译（tlyric）
    if (song.source === 'netease' && song.ncmId) {
      commit('SET_LYRICS', null);
      api.get('/netease-music/lyric', { params: { id: song.ncmId } }).then(function (res) {
        if (state.currentSong && state.currentSong.id === song.id) {
          var body = res.data || {};
          var lrcText = body.lrc && body.lrc.lyric;
          if (body.code === 200 && lrcText) {
            commit('SET_LYRICS', Object.freeze(mergeTranslation(lrcParser.parseLRC(lrcText), body.tlyric && body.tlyric.lyric)));
          } else {
            commit('SET_LYRICS', null);
          }
        }
      }).catch(function () {
        if (state.currentSong && state.currentSong.id === song.id) {
          commit('SET_LYRICS', null);
        }
      });
      return;
    }
    if (!song.hasLyrics || !song.lyricsUrl) {
      commit('SET_LYRICS', null);
      return;
    }
    api.get(song.lyricsUrl).then(function (res) {
      if (state.currentSong && state.currentSong.id === song.id) {
        if (res.data.code === 200 && res.data.data && res.data.data.content) {
          commit('SET_LYRICS', Object.freeze(lrcParser.parseLRC(res.data.data.content)));
        } else {
          commit('SET_LYRICS', null);
        }
      }
    }).catch(function () {
      if (state.currentSong && state.currentSong.id === song.id) {
        commit('SET_LYRICS', null);
      }
    });
  }
};

var getters = {
  hasCurrentSong: function (state) {
    return !!state.currentSong;
  },
  currentLyric: function (state) {
    if (!state.lyrics || !state.lyrics.lines || state.currentLyricIndex < 0 || state.currentLyricIndex >= state.lyrics.lines.length) {
      return '';
    }
    return state.lyrics.lines[state.currentLyricIndex].text || '';
  },
  nextLyric: function (state) {
    if (!state.lyrics || !state.lyrics.lines || state.currentLyricIndex + 1 < 0 || state.currentLyricIndex + 1 >= state.lyrics.lines.length) {
      return '';
    }
    return state.lyrics.lines[state.currentLyricIndex + 1].text || '';
  },
  progressPercent: function (state) {
    if (!state.duration) return 0;
    return (state.currentTime / state.duration) * 100;
  },
  formattedTime: function (state) {
    var minutes = Math.floor(state.currentTime / 60);
    var seconds = Math.floor(state.currentTime % 60);
    return (minutes < 10 ? '0' + minutes : minutes) + ':' + (seconds < 10 ? '0' + seconds : seconds);
  },
  formattedDuration: function (state) {
    var minutes = Math.floor(state.duration / 60);
    var seconds = Math.floor(state.duration % 60);
    return (minutes < 10 ? '0' + minutes : minutes) + ':' + (seconds < 10 ? '0' + seconds : seconds);
  }
};

export default {
  namespaced: true,
  state: state,
  mutations: mutations,
  actions: actions,
  getters: getters
};
