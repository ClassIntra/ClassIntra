// bot-transfer.js — 转存时调用 AstrBot 插件「云盘转运」端点
//
// 背景：bot 用 yt-dlp 下载的视频落在 Resources/cloud/botmedia/remote/（如 dv*.mp4）。
// 学生把聊天里的 bot 视频「转存到云盘」时，老逻辑是 CI 自己 copyFileSync 一份进
// cloud/shared/ —— 同一个视频在磁盘上出现两个物理副本，且 botmedia 那份因
// downloader._prune_old_videos 的保护逻辑（sha256 在 cloud_files 即跳过清理）永驻。
//
// 新策略（方案 B）：CI 不再复制字节，改调 AstrBot 插件的 POST /api/cloud/transfer，
// 由 bot 把 botmedia 原文件**硬链接**进 cloud/shared/<hash>（同盘一个 inode 两个名字，
// 零额外占用；跨盘 bot 自动回退复制）。物理层归 bot，数据库写入仍全部在 CI 侧
// （插件对 CI 库保持只读，避免跨进程写 SQLite）。
//
// 配置（server/.env，均有默认值，不配即走本地 6200）：
//   BOT_TRANSFER_URL          默认 http://127.0.0.1:6200（AstrBot 插件 api_server）
//   BOT_TRANSFER_TOKEN        对应插件 api_token；留空 = 插件未开鉴权时不带头部
//   BOT_TRANSFER_TIMEOUT_MS   默认 10000（本地硬链接是毫秒级操作，10s 足够）

var axios = require('axios');
var path = require('path');

var CFG = {
  baseUrl: String(process.env.BOT_TRANSFER_URL || 'http://127.0.0.1:6200').replace(/\/+$/, ''),
  token: String(process.env.BOT_TRANSFER_TOKEN || '').trim(),
  timeoutMs: parseInt(process.env.BOT_TRANSFER_TIMEOUT_MS, 10) || 10000
};

// botmedia 目录内文件的两种站内 URL 前缀（静态挂载均指向 resourcesDir/cloud/botmedia）：
//   现行：/resources/cloud/botmedia/remote/<file>
//   旧式：/resources/botmedia/remote/<file>（app.js 里 /resources/botmedia → cloud/botmedia）
// 注意旧式前缀在 save-from-url 里按 resourcesDir 直译会落到不存在的 Resources/botmedia/，
// 这里统一归一化到真实位置，顺带修掉「旧链接转存 404」的既有不一致。
function resolveBotmediaFile(imageUrl, resourcesDir) {
  var rest = null;
  if (imageUrl.indexOf('/resources/cloud/botmedia/remote/') === 0) {
    rest = imageUrl.substring('/resources/cloud/botmedia/remote/'.length);
  } else if (imageUrl.indexOf('/resources/botmedia/remote/') === 0) {
    rest = imageUrl.substring('/resources/botmedia/remote/'.length);
  } else {
    return null; // 非 botmedia 文件（系统资源/照片等走原复制逻辑）
  }
  // 剥查询参数（如 ?w=800），避免混进文件名
  var qIdx = rest.indexOf('?');
  if (qIdx !== -1) rest = rest.substring(0, qIdx);
  // 只接受纯文件名：无子目录、无路径成分、无穿越片段
  if (!rest || rest.indexOf('/') !== -1 || rest.indexOf('\\') !== -1 || rest.indexOf('..') !== -1) {
    return null;
  }
  if (rest.indexOf('.') === -1) return null;
  var fileName = rest;
  var abs = path.resolve(resourcesDir, 'cloud', 'botmedia', 'remote', fileName);
  // 防目录穿越 + 必须真在 botmedia/remote 内（emoji 等兄弟目录不适用转运）
  if (abs.indexOf(resourcesDir + path.sep) !== 0) return null;
  var base = path.join(resourcesDir, 'cloud', 'botmedia', 'remote') + path.sep;
  if (abs.indexOf(base) !== 0) return null;
  return { fileName: fileName, absPath: abs };
}

// storage_path 形态校验：bot 返回的值要进 CI 的 cloud_files，必须严格符合
// "<2位hex>/<64位hex><ext>"，杜绝任何路径注入
var STORAGE_PATH_RE = /^[a-f0-9]{2}\/[a-f0-9]{64}\.\w{1,8}$/;

function transfer(fileName) {
  return axios.post(CFG.baseUrl + '/api/cloud/transfer', { file: String(fileName || '') }, {
    headers: buildHeaders(),
    timeout: CFG.timeoutMs
  }).then(function(resp) {
    var body = resp && resp.data;
    if (!body || body.code !== 200 || !body.data || !body.data.hash) {
      return { ok: false, reason: 'bad_response', message: (body && body.message) || 'bot 响应异常' };
    }
    var d = body.data;
    var storagePath = String(d.storage_path || '');
    if (!STORAGE_PATH_RE.test(storagePath)) {
      return { ok: false, reason: 'bad_response', message: 'bot 返回的 storage_path 不合法' };
    }
    return {
      ok: true,
      hash: String(d.hash),
      size: parseInt(d.size, 10) || 0,
      storage_path: storagePath,
      linked: !!d.linked
    };
  }).catch(function(err) {
    var status = err && err.response && err.response.status;
    var body = err && err.response && err.response.data;
    if (status === 404) {
      return { ok: false, reason: 'not_found', message: 'botmedia 中不存在该文件（可能已被清理）' };
    }
    if (status === 400) {
      return { ok: false, reason: 'bad_request', message: (body && body.message) || '文件名不合法' };
    }
    if (status === 503) {
      return { ok: false, reason: 'unconfigured', message: 'bot 未配置 botmedia 目录' };
    }
    // 连接拒绝/超时/5xx：bot 不可达，交由调用方回退本地复制
    return { ok: false, reason: 'unavailable', message: (err && err.message) || 'bot 不可达' };
  });
}

function buildHeaders() {
  var headers = { 'Content-Type': 'application/json' };
  if (CFG.token) headers['X-ClassIntra-Token'] = CFG.token;
  return headers;
}

module.exports = {
  transfer: transfer,
  resolveBotmediaFile: resolveBotmediaFile,
  config: CFG
};
