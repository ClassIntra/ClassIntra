// 集成层：内部事件的「发令枪」
// ============================================================
// 为什么要有这一层：
//   outbound-dispatcher 早就写好了（签名、scope 过滤、异步投递），但**全仓没有调用点**，
//   结果「出站 Webhook」是个文档里存在、实际永不触发的功能。
//   这里提供 emit()，把「业务代码里发事件」收敛成一个安全调用：
//     - 永不抛错、永不阻塞请求（投递本身是异步的）
//     - dispatcher 加载失败只降级为一条 warn，不影响主流程
//     - 统一事件名，避免各处拼错（见 EVENT_SCOPE_MAP）
//
// 用法：emit('market.app_disabled', { name: 'pet', label: '桌宠' });
//
// 编码约定：var / function（服务端 CommonJS 风格）

var EVENT_SCOPE_MAP = {
  // 用户
  'user.signed_in': 'user:read',
  'user.signed_out': 'user:read',
  // 消息 / 公告
  'message.received': 'message:read',
  'announcement.published': 'notification:write',
  // 市场与应用管控
  'market.app_installed': 'market:read',
  'market.app_updated': 'market:read',
  'market.app_uninstalled': 'market:read',
  'market.plugin_installed': 'market:read',
  'market.plugin_uninstalled': 'market:read',
  'market.theme_installed': 'market:read',
  'market.theme_uninstalled': 'market:read',
  'app.enabled': 'app:read',
  'app.disabled': 'app:read',
  // 预留
  'countdown.reached': 'countdown:read',
  'calendar.event_created': 'calendar:read'
};

function emit(event, data) {
  if (!event) return false;
  var payload = data || {};

  // 1) 进程内事件总线：插件/应用后端可直接订阅
  try {
    require('../core/app-events').emit(event, payload);
  } catch (e) {
    try { console.warn('[integrations] 进程内事件失败 ' + event + ': ' + (e && e.message)); } catch (_) {}
  }

  // 2) 进程外出站 Webhook：班级门户/大屏等外部系统
  try {
    var dispatcher = require('./outbound-dispatcher');
    // 事件表以本文件为准（dispatcher 里的那份是历史副本，两处都补会漂移）
    dispatcher.EVENT_SCOPE_MAP[event] = EVENT_SCOPE_MAP[event];
    dispatcher.dispatch(event, payload);
    return true;
  } catch (e) {
    try { console.warn('[integrations] 出站事件投递失败 ' + event + ': ' + (e && e.message)); } catch (_) {}
    return false;
  }
}

module.exports = { emit: emit, EVENT_SCOPE_MAP: EVENT_SCOPE_MAP };
