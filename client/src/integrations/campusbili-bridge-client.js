// 客户端集成入口：CampusBili Bridge 客户端适配层（v1.1）
// =====================================
// 模块化边界（插件独立化）：本文件是 ClassIntra 核心与 campusbili-bridge 插件之间的唯一集成点。
//
// 设计要点：
//   1. 禁止静态 import 插件路径 —— 插件缺失时 Vite 构建与运行均不可受影响
//   2. 通过 import.meta.glob 做「构建期存在性探测」：目录不存在时 glob 返回空对象，
//      各导出自动落到 noop 降级实现（不注册任何行为），核心功能照常工作
//   3. 插件存在时，行为与旧静态 re-export 完全一致（无运行时异步差异）
//   4. 插件提供 shared/contract.js（契约）+ frontend/bridge.js（桥接实现）；
//      核心不直接感知插件内部路径
//
// 使用方式（Browser.vue）保持不变：
//   import { mountBridge, unmountBridge, ACTIONS_CHILD_TO_PARENT } from '@/integrations/campusbili-bridge-client';

// 构建期存在性探测：插件目录被移除 → 两个 glob 均为空映射，构建不报错
var bridgeModules = import.meta.glob('../../../plugins/campusbili-bridge/frontend/bridge.js', { eager: true });
var contractModules = import.meta.glob('../../../plugins/campusbili-bridge/shared/contract.js', { eager: true });

var _bridgeKey = Object.keys(bridgeModules)[0] || null;
var _contractKey = Object.keys(contractModules)[0] || null;

// 插件是否随构建存在（供 UI 降级提示使用）
var CAMPUSBILI_BRIDGE_AVAILABLE = !!_bridgeKey && !!_contractKey;

// ========== noop 降级实现（插件缺失时启用） ==========
function _noopBridge() {
  var stub = {
    available: false,
    on: function() { return stub; },
    off: function() { return stub; },
    emit: function() { return stub; },
    getDebugInfo: function() {
      return { available: false, reason: 'campusbili-bridge 插件未安装' };
    }
  };
  return stub;
}

function _noopMountBridge() {
  if (CAMPUSBILI_BRIDGE_AVAILABLE === false) {
    console.info('[campusbili-bridge] 插件未安装，联动功能停用（核心浏览不受影响）');
  }
  return _noopBridge();
}

function _noopUnmountBridge() {}

function _noopGetCurrentBridge() { return null; }

// ========== 条件导出：插件存在 → 真实实现；缺失 → noop ==========
export var BridgeInstance = _bridgeKey ? bridgeModules[_bridgeKey].BridgeInstance : function BridgeInstanceStub() { return _noopBridge(); };
export var STATE = _bridgeKey ? (bridgeModules[_bridgeKey].STATE || {}) : {};
export var getCurrentBridge = _bridgeKey ? bridgeModules[_bridgeKey].getCurrentBridge : _noopGetCurrentBridge;
export var mountBridge = _bridgeKey ? bridgeModules[_bridgeKey].mountBridge : _noopMountBridge;
export var unmountBridge = _bridgeKey ? bridgeModules[_bridgeKey].unmountBridge : _noopUnmountBridge;

// ========== 契约常量：插件存在 → 真实契约；缺失 → 空对象（消费方订阅自然失效） ==========
var _contractModule = _contractKey ? contractModules[_contractKey] : null;
export var PROTOCOL_VERSION = _contractModule ? _contractModule.PROTOCOL_VERSION : '';
export var MSG_TYPE = _contractModule ? _contractModule.MSG_TYPE : 'classintra-integration';
export var SOURCE_CLASSINTRA = _contractModule ? _contractModule.SOURCE_CLASSINTRA : '';
export var SOURCE_CAMPUSBILI = _contractModule ? _contractModule.SOURCE_CAMPUSBILI : '';
export var ACTIONS_PARENT_TO_CHILD = _contractModule ? (_contractModule.ACTIONS_PARENT_TO_CHILD || {}) : {};
export var ACTIONS_CHILD_TO_PARENT = _contractModule ? (_contractModule.ACTIONS_CHILD_TO_PARENT || {}) : {};
export var VIDEO_COMMANDS = _contractModule ? (_contractModule.VIDEO_COMMANDS || {}) : {};
export var CHANNEL_ACTIONS = _contractModule ? (_contractModule.CHANNEL_ACTIONS || {}) : {};
export var DEFAULT_CHANNELS = _contractModule ? (_contractModule.DEFAULT_CHANNELS || []) : [];

// 工具函数：插件缺失时返回安全的默认值/空操作
function _noopCreateMessage() { return null; }
function _noopValidateMessage() { return false; }
function _noopNegotiateVersion() { return false; }
function _noopFunctionReturningEmptyArray() { return []; }
function _noopFunctionReturningNull() { return null; }
function _noopBooleanTrue() { return true; }
function _noopExtractOrigin() { return null; }

export var createMessage = _contractModule ? _contractModule.createMessage : _noopCreateMessage;
export var createIdentityMessage = _contractModule ? _contractModule.createIdentityMessage : _noopCreateMessage;
export var createHelloMessage = _contractModule ? _contractModule.createHelloMessage : _noopCreateMessage;
export var createWelcomeMessage = _contractModule ? _contractModule.createWelcomeMessage : _noopCreateMessage;
export var createReadyMessage = _contractModule ? _contractModule.createReadyMessage : _noopCreateMessage;
export var validateMessage = _contractModule ? _contractModule.validateMessage : _noopValidateMessage;
export var getMessageDirection = _contractModule ? _contractModule.getMessageDirection : _noopFunctionReturningNull;
export var negotiateVersion = _contractModule ? _contractModule.negotiateVersion : _noopNegotiateVersion;
export var actionToChannel = _contractModule ? _contractModule.actionToChannel : _noopFunctionReturningNull;
export var isActionAllowed = _contractModule ? _contractModule.isActionAllowed : _noopBooleanTrue;
export var isIdentityAllowed = _contractModule ? _contractModule.isIdentityAllowed : _noopBooleanTrue;
export var intersectChannels = _contractModule ? _contractModule.intersectChannels : _noopFunctionReturningEmptyArray;
export var extractOrigin = _contractModule ? _contractModule.extractOrigin : _noopExtractOrigin;

export { CAMPUSBILI_BRIDGE_AVAILABLE };
