/**
 * 灵动岛通知桥接模块
 * 通过 App.vue 注入 SuperIsland 的 ref，复用 island-notifications mixin 的 enqueueNotification
 */
var superIslandRef = null;

// 设置 SuperIsland 组件引用（App.vue mounted 时调用）
function setSuperIslandRef(ref) {
  superIslandRef = ref;
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

export default { setSuperIslandRef, notify, showShareCapsule };
