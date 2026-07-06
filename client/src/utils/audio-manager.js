var audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'metadata';

var store = null;
var rafId = null;

// 命名函数引用，便于 destroy() 中正确移除监听器
function onTimeUpdate() {
  if (store) {
    store.commit('music/SET_CURRENT_TIME', audio.currentTime);
    store.dispatch('music/updateLyricIndex');
  }
}
function onLoadedMetadata() {
  if (store) store.commit('music/SET_DURATION', audio.duration || 0);
}
function onEnded() {
  if (store) store.dispatch('music/next');
}
function onPlay() {
  if (store) store.commit('music/SET_PLAYING', true);
}
function onPause() {
  if (store) store.commit('music/SET_PLAYING', false);
}
function onError() {
  if (store) store.commit('music/SET_PLAYING', false);
}
function onProgress() {
  if (!store || !audio.buffered || audio.buffered.length === 0) return;
  var end = audio.buffered.end(audio.buffered.length - 1);
  store.commit('music/SET_BUFFERED_END', end);
}

function rafLoop() {
  if (store && !audio.paused) {
    store.commit('music/SET_CURRENT_TIME', audio.currentTime);
    store.dispatch('music/updateLyricIndex');
  }
  rafId = requestAnimationFrame(rafLoop);
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

    rafLoop();
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
    audio.pause();
    audio.removeEventListener('timeupdate', onTimeUpdate);
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('play', onPlay);
    audio.removeEventListener('pause', onPause);
    audio.removeEventListener('error', onError);
    audio.removeEventListener('progress', onProgress);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    store = null;
  }
};
