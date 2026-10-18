// 客户端集成入口：Web Proxy 客户端适配层（v1.0）
// =====================================
// 模块化边界（插件独立化）：本文件是 ClassIntra 核心与 web-proxy 插件之间的唯一集成点。
//
// 设计要点：
//   1. 禁止静态 import 插件路径 —— 插件缺失时 Vite 构建与运行均不可受影响
//   2. 通过 import.meta.glob 做「构建期存在性探测」：目录不存在时 glob 返回空对象，
//      各导出自动落到 noop 降级实现（不注册任何行为），核心功能照常工作
//   3. 插件存在时，行为与直接引用插件模块完全一致（无运行时异步差异）
//   4. 插件提供 shared/contract.js（契约）+ frontend/bridge.js（桥接实现）；
//      核心不直接感知插件内部路径
//
// 使用方式（Browser.vue）：
//   import { mountBridge, unmountBridge, ACTIONS_CHILD_TO_PARENT } from '@/integrations/web-proxy-client';

// 构建期存在性探测：插件目录被移除 → 两个 glob 均为空映射，构建不报错
var bridgeModules = import.meta.glob('../../../plugins/web-proxy/frontend/bridge.js', { eager: true });
var contractModules = import.meta.glob('../../../plugins/web-proxy/shared/contract.js', { eager: true });

var _bridgeKey = Object.keys(bridgeModules)[0] || null;
var _contractKey = Object.keys(contractModules)[0] || null;

// 插件是否随构建存在（供 UI 降级提示使用）
var WEB_PROXY_BRIDGE_AVAILABLE = !!_bridgeKey && !!_contractKey;

// ========== noop 降级实现（插件缺失时启用） ==========
function _noopBridge() {
  var stub = {
    available: false,
    on: function() { return stub; },
    off: function() { return stub; },
    requestPageInfo: function() { return stub; },
    requestProxyStatus: function() { return stub; },
    destroy: function() {}
  };
  return stub;
}

function _noopMountBridge() {
  console.info('[web-proxy] 插件未安装，网页代理联动停用（核心浏览不受影响）');
  return _noopBridge();
}

function _noopUnmountBridge() {}

// ========== 条件导出：插件存在 → 真实实现；缺失 → noop ==========
export var BridgeInstance = _bridgeKey
  ? bridgeModules[_bridgeKey].BridgeInstance
  : function BridgeInstanceStub() { return _noopBridge(); };
export var mountBridge = _bridgeKey ? bridgeModules[_bridgeKey].mountBridge : _noopMountBridge;
export var unmountBridge = _bridgeKey ? bridgeModules[_bridgeKey].unmountBridge : _noopUnmountBridge;

// ========== 契约常量：插件存在 → 真实契约；缺失 → 空对象（消费方订阅自然失效） ==========
var _contractModule = _contractKey ? contractModules[_contractKey] : null;
export var PROTOCOL_VERSION = _contractModule ? _contractModule.PROTOCOL_VERSION : '';
export var MSG_TYPE = _contractModule ? _contractModule.MSG_TYPE : 'web-proxy';
export var SOURCE_CLASSINTRA = _contractModule ? _contractModule.SOURCE_CLASSINTRA : '';
export var SOURCE_PROXY_PAGE = _contractModule ? _contractModule.SOURCE_PROXY_PAGE : '';
export var ACTIONS_PARENT_TO_CHILD = _contractModule ? (_contractModule.ACTIONS_PARENT_TO_CHILD || {}) : {};
export var ACTIONS_CHILD_TO_PARENT = _contractModule ? (_contractModule.ACTIONS_CHILD_TO_PARENT || {}) : {};
export var CHANNEL_ACTIONS = _contractModule ? (_contractModule.CHANNEL_ACTIONS || {}) : {};
export var DEFAULT_CHANNELS = _contractModule ? (_contractModule.DEFAULT_CHANNELS || []) : [];

// 工具函数：插件缺失时返回安全的默认值/空操作
function _noopCreateMessage() { return null; }
function _noopBooleanTrue() { return true; }
function _noopExtractOrigin() { return null; }

export var createMessage = _contractModule ? _contractModule.createMessage : _noopCreateMessage;
export var createHelloMessage = _contractModule ? _contractModule.createHelloMessage : _noopCreateMessage;
export var createPageInfoMessage = _contractModule ? _contractModule.createPageInfoMessage : _noopCreateMessage;
export var validateMessage = _contractModule ? _contractModule.validateMessage : function() { return { valid: false, errors: [] }; };
export var isActionAllowed = _contractModule ? _contractModule.isActionAllowed : _noopBooleanTrue;
export var extractOrigin = _contractModule ? _contractModule.extractOrigin : _noopExtractOrigin;

export { WEB_PROXY_BRIDGE_AVAILABLE };
