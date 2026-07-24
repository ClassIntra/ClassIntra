// 客户端集成入口：CampusBili Bridge 客户端适配层（v1.1）
// =====================================
// 此文件是 ClassIntra 客户端与 campusbili-bridge 插件之间的唯一集成点。
// 插件位于 plugins/campusbili-bridge/（独立顶级目录），客户端通过此文件引用插件的桥接模块。
//
// 设计意图：
//   - 插件是独立单元，提供 shared/contract.js（契约）+ frontend/bridge.js（桥接实现）
//   - 客户端不直接引用插件内部路径，而是通过此 re-export 层
//   - 便于未来替换插件实现或增加适配逻辑

export {
  BridgeInstance,
  STATE,
  getCurrentBridge,
  mountBridge,
  unmountBridge
} from '../../../plugins/campusbili-bridge/frontend/bridge.js';

// 同时导出契约常量与工具函数（供客户端代码引用，避免直接深入插件目录）
export {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_CAMPUSBILI,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  VIDEO_COMMANDS,
  CHANNEL_ACTIONS,
  DEFAULT_CHANNELS,
  createMessage,
  createIdentityMessage,
  createHelloMessage,
  createWelcomeMessage,
  createReadyMessage,
  validateMessage,
  getMessageDirection,
  negotiateVersion,
  actionToChannel,
  isActionAllowed,
  isIdentityAllowed,
  intersectChannels,
  extractOrigin
} from '../../../plugins/campusbili-bridge/shared/contract.js';
