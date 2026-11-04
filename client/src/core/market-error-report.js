// 前端核心：第三方应用错误归因与上报
// ============================================================
// 问题：市场应用与宿主同页面运行，任何未捕获异常都落到全局 handler。
// 之前只能看到一条无主堆栈，分不清是「宿主坏了」还是「某个第三方应用坏了」。
//
// 做法：
//   1. MarketRuntime 挂载时标记当前应用（setActiveApp）
//   2. 全局 handler 调用 report()，只有堆栈/URL 里出现
//      /market-static/<name>/ 时才归因给该应用（避免宿主错误被误算到第三方头上）
//   3. 控制台上仍打 [app:<name>] 前缀，本机排查同样受益
//   4. 上报走 /api/market/app-error，每会话每应用最多 5 条（防死循环刷库），
//      服务端还有每小时 500 条的总闸门。
//
// 编码约定：var / function / 单引号（Chrome 80 基线）。

import api from '@/utils/api';

var _activeApp = '';
var _reported = {};        // name -> 已上报条数
var _usageSent = {};       // name -> 本会话是否已发过使用心跳
var MAX_PER_APP = 5;

function setActiveApp(name) {
  _activeApp = name ? String(name) : '';
}

function getActiveApp() {
  return _activeApp;
}

function _belongsTo(name, err, meta) {
  if (!name) return false;
  var stack = '';
  try { stack = (err && err.stack) ? String(err.stack) : ''; } catch (e) {}
  var message = '';
  try {
    message = err && err.message ? String(err.message) : (typeof err === 'string' ? err : '');
  } catch (e) {}
  var url = (meta && meta.url) ? String(meta.url) : '';
  var haystack = stack + ' ' + message + ' ' + url;
  return haystack.indexOf('/market-static/' + name + '/') !== -1;
}

function report(err, meta) {
  var name = _activeApp;
  if (!name) return false;

  // 先在本机打上归属前缀——即使不上报，排查也有据可依
  try {
    console.error('[app:' + name + ']', (meta && meta.source ? '(' + meta.source + ') ' : ''), err);
  } catch (e) {}

  if (!_belongsTo(name, err, meta)) return false;

  _reported[name] = _reported[name] || 0;
  if (_reported[name] >= MAX_PER_APP) return false;
  _reported[name]++;

  var payload = {
    name: name,
    message: (err && err.message) ? String(err.message) : String(err || ''),
    stack: (err && err.stack) ? String(err.stack) : '',
    url: (typeof window !== 'undefined' && window.location) ? String(window.location.pathname || '') : ''
  };
  try {
    api.post('/market/app-error', payload).catch(function() {});
  } catch (e) {}
  return true;
}

// 应用打开心跳：每个应用每会话只发一次，避免路由来回切刷接口
function reportUsage(name) {
  if (!name) return;
  if (_usageSent[name]) return;
  _usageSent[name] = true;
  try {
    api.post('/market/app-usage', { name: name }).catch(function() {});
  } catch (e) {}
}

// 会话级重置（登出/换账号时调用，避免旧账号的配额影响新账号）
function resetSession() {
  _reported = {};
  _usageSent = {};
}

export {
  setActiveApp,
  getActiveApp,
  report,
  reportUsage,
  resetSession
};
