/**
 * 音频播放器管理类
 *
 * 从 ChatBubble.vue 中提取的语音条播放管理逻辑，负责：
 * - 创建和复用 Audio 对象（按 URL 缓存）
 * - 绑定 loadedmetadata / timeupdate / ended 事件，更新语音条 UI
 * - 切换播放/暂停，并自动暂停其他正在播放的语音
 * - 组件销毁时清理所有 Audio 资源，避免内存泄漏
 *
 * 使用方式：
 *   var manager = new AudioPlayerManager();
 *   manager.initBars(rootEl);          // 初始化未绑定的语音条
 *   manager.togglePlay(url, barEl);    // 切换播放
 *   manager.cleanup();                 // 组件销毁时调用
 */
export default class AudioPlayerManager {
  constructor() {
    // Audio 对象池，key = 媒体 URL
    this.players = {};
  }

  /**
   * 初始化未绑定的语音条：创建 Audio 对象并绑定事件
   * 扫描 rootEl 下所有 data-voice-init="0" 的语音条元素
   * @param {HTMLElement} rootEl - 组件根元素
   */
  initBars(rootEl) {
    var self = this;
    if (!rootEl) return;
    var bars = rootEl.querySelectorAll('.msg-voice-bar[data-voice-init="0"]');
    for (var i = 0; i < bars.length; i++) {
      this._initSingleBar(bars[i]);
    }
  }

  /**
   * 初始化单个语音条
   * @param {HTMLElement} bar - 语音条 DOM 元素
   * @private
   */
  _initSingleBar(bar) {
    var self = this;
    var url = bar.getAttribute('data-media-url');
    if (!url) return;
    bar.setAttribute('data-voice-init', '1');

    // 创建 Audio 对象（复用池）
    if (!self.players[url]) {
      var audio = new Audio(url);
      audio.preload = 'metadata';

      audio.addEventListener('loadedmetadata', function() {
        var dur = audio.duration;
        if (isNaN(dur) || dur === Infinity) return;
        // 在文档中查找所有使用该 URL 的语音条（可能有多条相同语音）
        var allBars = document.querySelectorAll('.msg-voice-bar[data-media-url="' + url.replace(/"/g, '\\"') + '"]');
        for (var k = 0; k < allBars.length; k++) {
          var durEl = allBars[k].querySelector('.voice-duration');
          if (durEl) durEl.textContent = Math.ceil(dur) + '"';
        }
      });

      audio.addEventListener('timeupdate', function() {
        var dur = audio.duration;
        if (isNaN(dur) || dur === Infinity || dur === 0) return;
        var progress = (audio.currentTime / dur) * 100;
        var allBars = document.querySelectorAll('.msg-voice-bar[data-media-url="' + url.replace(/"/g, '\\"') + '"]');
        for (var k = 0; k < allBars.length; k++) {
          var progEl = allBars[k].querySelector('.voice-progress');
          if (progEl) progEl.style.width = progress + '%';
          var waveBars = allBars[k].querySelectorAll('.voice-wave-bars span');
          var activeCount = Math.ceil((progress / 100) * waveBars.length);
          for (var m = 0; m < waveBars.length; m++) {
            if (m < activeCount) waveBars[m].classList.add('active');
            else waveBars[m].classList.remove('active');
          }
        }
      });

      audio.addEventListener('ended', function() {
        var allBars = document.querySelectorAll('.msg-voice-bar[data-media-url="' + url.replace(/"/g, '\\"') + '"]');
        for (var k = 0; k < allBars.length; k++) {
          var playBtn = allBars[k].querySelector('.voice-play-btn i');
          if (playBtn) playBtn.className = 'fa-solid fa-play';
          var progEl = allBars[k].querySelector('.voice-progress');
          if (progEl) progEl.style.width = '0%';
          var waveBars = allBars[k].querySelectorAll('.voice-wave-bars span');
          for (var m = 0; m < waveBars.length; m++) {
            waveBars[m].classList.remove('active');
          }
        }
      });

      self.players[url] = audio;
    }
  }

  /**
   * 切换语音条播放/暂停
   * @param {string} url - 媒体 URL
   * @param {HTMLElement} barEl - 当前语音条元素
   */
  togglePlay(url, barEl) {
    var audio = this.players[url];
    if (!audio) return;

    var playIcon = barEl.querySelector('.voice-play-btn i');
    if (audio.paused) {
      // 暂停其他正在播放的语音
      for (var key in this.players) {
        if (key !== url && !this.players[key].paused) {
          this.players[key].pause();
          var otherBars = document.querySelectorAll('.msg-voice-bar[data-media-url="' + key.replace(/"/g, '\\"') + '"]');
          for (var k = 0; k < otherBars.length; k++) {
            var otherIcon = otherBars[k].querySelector('.voice-play-btn i');
            if (otherIcon) otherIcon.className = 'fa-solid fa-play';
          }
        }
      }
      audio.play().catch(function() {});
      if (playIcon) playIcon.className = 'fa-solid fa-pause';
    } else {
      audio.pause();
      if (playIcon) playIcon.className = 'fa-solid fa-play';
    }
  }

  /**
   * 清理所有 Audio 对象，释放资源
   * 在组件 beforeDestroy 生命周期中调用
   */
  cleanup() {
    for (var key in this.players) {
      var audio = this.players[key];
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    }
    this.players = {};
  }
}
