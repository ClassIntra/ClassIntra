/**
 * 全局媒体互斥协调器
 *
 * 学生场景里，聊天语音条 / 帖子视频 / 音乐播放器可能同时出声——
 * 任何一处开始播放时，自动暂停页面里所有其他音视频，保证「同一时刻只有一路声音」。
 * 用 capture 阶段的原生 play 事件监听，无需各组件逐一接入。
 * 安装一次即可（main.js 引入本模块即生效）。
 */
(function installMediaCoordinator() {
  if (typeof window === 'undefined' || window.__ciMediaCoordinatorInstalled) return;
  window.__ciMediaCoordinatorInstalled = true;
  document.addEventListener('play', function(e) {
    var target = e.target;
    if (!target || (target.tagName !== 'AUDIO' && target.tagName !== 'VIDEO')) return;
    var all = document.querySelectorAll('audio, video');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el !== target && !el.paused) {
        el.pause();
      }
    }
  }, true);
})();

export default {};
