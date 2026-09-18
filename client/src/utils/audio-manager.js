var audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'metadata';

var store = null;
var rafId = null;
var lastCommit = 0;

// Vuex 提交节流（~10Hz）：进度条 / 时间文本由 CSS 过渡平滑，
// 避免高频提交引发整个页面以 rAF 频率重渲染（低端设备卡顿主因）
var COMMIT_INTERVAL = 100;

function commitTime(force) {
  if (!store) return;
  var now = Date.now();
  if (!force && now - lastCommit < COMMIT_INTERVAL) return;
  lastCommit = now;
  store.commit('music/SET_CURRENT_TIME', audio.currentTime);
  store.dispatch('music/updateLyricIndex');
}

// 命名函数引用，便于 destroy() 中正确移除监听器
function onTimeUpdate() {
  commitTime(false);
}
function onLoadedMetadata() {
  if (store) store.commit('music/SET_DURATION', audio.duration || 0);
}
function onEnded() {
  if (store) store.dispatch('music/next');
}
function onPlay() {
  if (store) {
    store.commit('music/SET_PLAYING', true);
    startRaf();
  }
}
function onPause() {
  if (store) {
    store.commit('music/SET_PLAYING', false);
    stopRaf();
  }
}
function onError() {
  if (store) {
    store.commit('music/SET_PLAYING', false);
    stopRaf();
  }
}
function onProgress() {
  if (!store || !audio.buffered || audio.buffered.length === 0) return;
  var end = audio.buffered.end(audio.buffered.length - 1);
  store.commit('music/SET_BUFFERED_END', end);
}

// rAF 循环仅在播放期间运行，暂停即停止，不再空转
function startRaf() {
  if (rafId) return;
  var loop = function() {
    commitTime(false);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function stopRaf() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export default {
  init: function (_store) {
    store = _store;

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('progress', onProgress);
  },

  playSong: function (song) {
    audio.pause();
    var src = song.audioUrl || ('/api/music/stream/' + encodeURIComponent(song.file));
    audio.src = src;
    audio.load();
    audio.play().catch(function () {});
    store.commit('music/SET_CURRENT_SONG', song);
    store.commit('music/SET_PLAYING', true);
    store.commit('music/SET_CURRENT_TIME', 0);
    store.commit('music/SET_DURATION', 0);
    lastCommit = 0;
    startRaf();
  },

  pause: function () {
    audio.pause();
  },

  resume: function () {
    if (store && store.state.music && store.state.music.currentSong) {
      audio.play().catch(function () {});
    }
  },

  toggle: function () {
    if (audio.paused) {
      if (!audio.src && store && store.state.music && store.state.music.currentSong) {
        var song = store.state.music.currentSong;
        audio.src = song.audioUrl || ('/api/music/stream/' + encodeURIComponent(song.file));
        audio.load();
      }
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
  },

  seek: function (time) {
    audio.currentTime = time;
    // 拖拽 / 点击进度条后立即反馈，不等节流窗口
    commitTime(true);
  },

  setVolume: function (vol) {
    audio.volume = vol;
    store.commit('music/SET_VOLUME', vol);
  },

  toggleMute: function () {
    audio.muted = !audio.muted;
    store.commit('music/SET_MUTED', audio.muted);
  },

  getAudio: function () {
    return audio;
  },

  destroy: function () {
    stopRaf();
    audio.pause();
    audio.removeEventListener('timeupdate', onTimeUpdate);
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('play', onPlay);
    audio.removeEventListener('pause', onPause);
    audio.removeEventListener('error', onError);
    audio.removeEventListener('progress', onProgress);
    store = null;
  }
};
