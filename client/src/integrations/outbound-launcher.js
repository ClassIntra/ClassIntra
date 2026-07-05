// 前端集成层：Outbound Launcher（外部站点嵌入启动器）
// 参考 Ditto packages/integration/src/outbound-launcher.ts
//
// 设计要点：
// 1. 在 ClassIntra 内嵌入外部站点（iframe）
// 2. 自动建立 postMessage 连接，完成握手
// 3. 传递用户身份信息（SSO 令牌，通过 handshake 传递）
// 4. 管理嵌入的 iframe 生命周期

import { getPostMessageBridge } from './postmessage-bridge';
import { createEnvelope, CHANNELS } from '@shared/integration-contract';

// 嵌入外部站点的容器
function OutboundLauncher() {
  this._frames = {};  // { frameId: { iframe, bridge, url, origin } }
}

/**
 * 启动外部站点嵌入
 * @param {Object} options
 * @param {string} options.url - 外部站点 URL
 * @param {string} [options.frameId] - iframe id（缺省自动生成）
 * @param {HTMLElement} options.container - 容器元素
 * @param {Object} [options.userInfo] - 用户信息（通过 handshake 传递）
 * @param {string[]} [options.allowChannels] - 允许的 channels
 * @param {Object} [options.iframeAttrs] - iframe 属性（如 style、class）
 * @returns {{ frameId, iframe, readyPromise }}
 */
OutboundLauncher.prototype.launch = function(options) {
  var self = this;
  if (!options || !options.url || !options.container) {
    throw new Error('OutboundLauncher.launch: url 和 container 必填');
  }

  var url = options.url;
  var origin = _extractOrigin(url);
  var frameId = options.frameId || 'ci-frame-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

  // 创建 iframe
  var iframe = document.createElement('iframe');
  iframe.id = frameId;
  iframe.src = url;
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allow', 'fullscreen; clipboard-write');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  if (options.iframeAttrs) {
    var keys = Object.keys(options.iframeAttrs);
    for (var i = 0; i < keys.length; i++) {
      iframe.setAttribute(keys[i], options.iframeAttrs[keys[i]]);
    }
  }

  // 准备握手数据
  var userInfo = options.userInfo || null;
  var allowChannels = options.allowChannels || Object.keys(CHANNELS);

  // 握手 Promise
  var readyPromise = new Promise(function(resolve, reject) {
    var handshakeHandler = function(env) {
      if (env.channel === 'handshake:request' && env.kind === 'request') {
        // 外部站点发起握手，回复 handshake:response
        var bridge = getPostMessageBridge();
        bridge.setTarget(iframe.contentWindow, origin);
        bridge.respond(env.id, 'handshake:response', {
          userInfo: userInfo,
          allowChannels: allowChannels,
          protocolVersion: '1.0'
        }, iframe.contentWindow, origin);

        // 移除握手 handler
        bridge._handlers['handshake:request'] = bridge._handlers['handshake:request'].filter(function(h) {
          return h !== handshakeHandler;
        });

        resolve({ frameId: frameId, iframe: iframe, origin: origin });
      }
    };

    // 注册握手 handler
    var bridge = getPostMessageBridge();
    bridge.on('handshake:request', handshakeHandler);

    // 超时（10 秒）
    setTimeout(function() {
      reject(new Error('握手超时：外部站点未响应'));
    }, 10000);
  });

  // 挂载到容器
  options.container.appendChild(iframe);
  self._frames[frameId] = {
    iframe: iframe,
    url: url,
    origin: origin
  };

  return {
    frameId: frameId,
    iframe: iframe,
    readyPromise: readyPromise
  };
};

/**
 * 关闭嵌入的外部站点
 */
OutboundLauncher.prototype.close = function(frameId) {
  var frame = this._frames[frameId];
  if (!frame) return;
  if (frame.iframe && frame.iframe.parentNode) {
    frame.iframe.parentNode.removeChild(frame.iframe);
  }
  delete this._frames[frameId];
};

/**
 * 关闭所有嵌入的外部站点
 */
OutboundLauncher.prototype.closeAll = function() {
  var keys = Object.keys(this._frames);
  for (var i = 0; i < keys.length; i++) {
    this.close(keys[i]);
  }
};

// 工具：从 URL 提取 origin
function _extractOrigin(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    var match = url.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

// ========== 单例 ==========
var _instance = null;
function getOutboundLauncher() {
  if (!_instance) {
    _instance = new OutboundLauncher();
  }
  return _instance;
}

export { OutboundLauncher, getOutboundLauncher };
