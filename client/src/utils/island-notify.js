/**
 * 灵动岛通知桥接模块。
 * CampusBili 仅允许触发分享胶囊，不再同步播放状态或下发播放控制。
 */
var superIslandRef = null;

function setSuperIslandRef(ref) {
  superIslandRef = ref;
}

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

function showShareCapsule(data) {
  if (superIslandRef && typeof superIslandRef.showShareCapsule === 'function') {
    superIslandRef.showShareCapsule(data);
    return true;
  }
  return false;
}

export default { setSuperIslandRef, notify, showShareCapsule };
