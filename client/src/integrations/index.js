// 前端集成层：聚合入口
// 统一导出 PostMessageBridge + OutboundLauncher
// 提供 IntegrationManager 统一管理 API
//
// 使用方式：
//   import { getIntegrationManager } from '@/integrations';
//   var manager = getIntegrationManager();
//   manager.start().then(function() { /* 桥接已就绪 */ });

import { getPostMessageBridge } from './postmessage-bridge';
import { getOutboundLauncher } from './outbound-launcher';
import { getEventBus } from '@/core/event-bus';
import { getServiceRegistry } from '@/core/service-registry';
import { EVENT_NAMES } from '@shared/constants';
import { CHANNELS } from '@shared/integration-contract';

// 集成管理器
function IntegrationManager() {
  this._bridge = getPostMessageBridge();
  this._launcher = getOutboundLauncher();
  this._started = false;
}

// 启动集成系统
IntegrationManager.prototype.start = function() {
  var self = this;
  if (self._started) return Promise.resolve();
  return self._bridge.start().then(function() {
    self._started = true;
    // 注册默认 channel handlers
    self._registerDefaultHandlers();
    // 监听 EventBus 事件，广播到外部 iframe
    self._subscribeEventBus();
    console.log('[integration] 集成系统已启动');
  });
};

// 注册默认 channel handlers
IntegrationManager.prototype._registerDefaultHandlers = function() {
  var self = this;

  // handshake:request — 外部站点握手
  self._bridge.on('handshake:request', function(env) {
    var registry = getServiceRegistry();
    var store = registry.resolve('store');
    var user = store && store.state.auth ? store.state.auth.user : null;
    return {
      userInfo: user ? {
        user_id: user.user_id,
        real_name: user.real_name,
        net_name: user.net_name
      } : null,
      allowChannels: Object.keys(CHANNELS),
      protocolVersion: '1.0'
    };
  });

  // ping — 心跳
  self._bridge.on('ping', function(env) {
    return { pong: true, timestamp: Date.now() };
  });
};

// 监听 EventBus 事件，广播到外部 iframe
IntegrationManager.prototype._subscribeEventBus = function() {
  var self = this;
  var bus = getEventBus();

  // 用户登出 → 广播 user:signed-out
  bus.on(EVENT_NAMES.USER_SIGNED_OUT, function() {
    self._bridge.broadcast('user:signed-out', { timestamp: Date.now() });
  });

  // 用户登录 → 广播 user:signed-in
  bus.on(EVENT_NAMES.USER_SIGNED_IN, function() {
    self._bridge.broadcast('user:signed-in', { timestamp: Date.now() });
  });
};

// 获取 bridge
IntegrationManager.prototype.getBridge = function() {
  return this._bridge;
};

// 获取 launcher
IntegrationManager.prototype.getLauncher = function() {
  return this._launcher;
};

// 停止集成系统
IntegrationManager.prototype.stop = function() {
  this._launcher.closeAll();
  this._bridge.stop();
  this._started = false;
};

// ========== 单例 ==========
var _instance = null;
function getIntegrationManager() {
  if (!_instance) {
    _instance = new IntegrationManager();
  }
  return _instance;
}

export {
  IntegrationManager,
  getIntegrationManager,
  getPostMessageBridge,
  getOutboundLauncher
};
