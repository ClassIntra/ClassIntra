/**
 * 灵动岛通知桥接模块
 * 通过 App.vue 注入 SuperIsland 的 ref，复用 island-notifications mixin 的 enqueueNotification
 * 通过 Browser.vue 注入 browserRef，支持超能岛向 iframe 子站点下发指令
 */
var superIslandRef = null;
var browserRef = null;

// 设置 SuperIsland 组件引用（App.vue mounted 时调用）
function setSuperIslandRef(ref) {
  superIslandRef = ref;
}

// 设置 Browser 组件引用（Browser.vue mounted 时调用）
function setBrowserRef(ref) {
  browserRef = ref;
}

// 发送灵动岛通知
function notify(options) {
  if (superIslandRef && typeof superIslandRef.enqueueNotification === 'function') {
    superIslandRef.enqueueNotification({
      icon: options.icon || 'fa-solid fa-bell',
      color: options.color || 'rgba(0, 122, 255, 0.25)',
      title: options.title || '',
      text: options.text || '',
      route: options.route || '',
      type: options.type || 'system',
      category: options.category || 'system',
      priority: options.priority || 'normal'
    });
  }
}

// 在超能岛展示分享胶囊（由 ClassIntra Browser 监听子站 postMessage 后调用）
// data: { url, title, aid, bvid, pic, owner }
function showShareCapsule(data) {
  if (superIslandRef && typeof superIslandRef.showShareCapsule === 'function') {
    superIslandRef.showShareCapsule(data);
    return true;
  }
  return false;
}

// 在超能岛展示视频岛（CampusBili 视频播放时同步状态）
// data: { isPlaying, ended, currentTime, duration, title, pic, bvid, aid, owner }
function showVideoIsland(data) {
  if (superIslandRef && typeof superIslandRef.showVideoIsland === 'function') {
    superIslandRef.showVideoIsland(data);
    return true;
  }
  return false;
}

// 隐藏超能岛视频岛（CampusBili 视频停止播放时调用）
function hideVideoIsland() {
  if (superIslandRef && typeof superIslandRef.hideVideoIsland === 'function') {
    superIslandRef.hideVideoIsland();
    return true;
  }
  return false;
}

// 向 iframe 子站点下发视频控制指令（超能岛 → Browser → iframe → CampusBili）
// command: 'play' | 'pause' | 'seek', value: number (seek 时为秒数)
function sendVideoControl(command, value) {
  if (browserRef && typeof browserRef.sendToIframe === 'function') {
    browserRef.sendToIframe('video-control', { command: command, value: value });
    return true;
  }
  return false;
}

export default { setSuperIslandRef, setBrowserRef, notify, showShareCapsule, showVideoIsland, hideVideoIsland, sendVideoControl };
