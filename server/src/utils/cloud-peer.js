/**
 * cloud-peer.js - 跨班云盘文件回源（向对端服务器取字节）
 *
 * 背景：cloud_files 的元数据不进中继水位同步（relay-sync 只同步消息/帖子/用户等），
 * 文件二进制靠 Syncthing 落盘。同步延迟窗口内本地既无 DB 记录、磁盘也没有 →
 * 读路径 404 → 聊天图片被前端 onerror 渲染成「文件已删除」占位图。
 * 所以凡是「内容里引用了对端才有的 hash」的场景，都得主动向对端把字节取回来。
 *
 * 两个调用方：
 *   1. relay-handlers.js 的写路径预取：消息中继到达时立即后台拉取（对端用户还没请求）
 *   2. apps/resource 云盘读路径回源：404 时按需补拉（已有流式实现，可复用 peerBases）
 *
 * 寻址为什么要「逐个尝试」而不是精确定位：
 *   中继通道只给得出 source_server_id（一个逻辑标识，如 '8i'/'18i'），
 *   而 RELAY_SERVERS 配的是 ws://host:10011 这种 WS 地址——两者之间没有映射表，
 *   按 serverId 反查 URL 只能靠猜。与其猜错打到自己身上（旧 getPeerHttpUrl 就是
 *   永远取 servers[0]，serverId 形参从未使用），不如把所有候选基址挨个试。
 *   候选只有 1~2 个，试错成本远低于「猜错导致整条链路静默失效」。
 *
 * 防护：
 *   - single-flight：同一 hash 的并发请求合并成一次回源，其余等它落盘
 *   - 负缓存 60s：文件哪台都没有时（已删/脏 hash），不打爆对端
 *   - 内存上限：过大文件直接放弃（超大文件走读路径的流式回源）
 *   - sha256 校验：peer-fetch 是可信内网通道，但仍防传输损坏/错文件落盘
 */

var http = require('http');
var https = require('https');
var crypto = require('crypto');
var config = require('../config');

// 单次内存回源上限。聊天附件（图片/短视频）远小于此；
// 更大的文件交给云盘读路径的流式回源（256MB 上限），避免这里把内存吃穿。
var FETCH_MAX_SIZE = parseInt(process.env.CLOUD_PEER_MAX_SIZE, 10) || 32 * 1024 * 1024;
var FETCH_TIMEOUT_MS = parseInt(process.env.CLOUD_PEER_TIMEOUT_MS, 10) || 30000;

var inflight = {};      // hash -> Promise（single-flight）
var missCache = {};     // hash -> ts（负缓存）
var MISS_TTL = 60 * 1000;

/**
 * 对端 HTTP 基址候选列表。
 * 优先 PEER_MEDIA_BASES（与云盘读路径同名同语义，联调时可显式指定），
 * 否则从中继 RELAY_SERVERS 的 ws://host:port 推导 http(s)://host:<本服务端口>
 * （生产两端同为 9001，与云盘读路径的推导口径一致）。
 */
function peerBases() {
  var bases = [];
  var env = String(process.env.PEER_MEDIA_BASES || '').trim();
  if (env) {
    env.split(',').forEach(function(x) {
      x = x.trim().replace(/\/+$/, '');
      if (x && bases.indexOf(x) === -1) bases.push(x);
    });
  }
  if (!bases.length) {
    var servers = (config.relay && config.relay.servers) || [];
    var port = config.port || 9001;
    for (var i = 0; i < servers.length; i++) {
      try {
        var u = new URL(servers[i]);
        var scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
        var b = scheme === 'https:' ? 'https://' + u.hostname + ':' + port
                                    : 'http://' + u.hostname + ':' + port;
        if (bases.indexOf(b) === -1) bases.push(b);
      } catch (e) { /* 配置项非法则跳过 */ }
    }
  }
  return bases;
}

function hashOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// 单个基址上试一次。resolve(null) 表示这台没有（404/网络错），调用方继续试下一台。
function tryOne(base, hash) {
  return new Promise(function(resolve) {
    var fetchUrl = base + '/api/cloud/peer-fetch/' + hash;
    var mod = fetchUrl.indexOf('https://') === 0 ? https : http;
    var relaySecret = (config.relay && config.relay.secret) || '';
    var settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }
    var req = mod.get(fetchUrl, { headers: { 'X-Relay-Secret': relaySecret } }, function(response) {
      if (response.statusCode !== 200) {
        // 404 = 这台真没有；其余状态码同样当作「这台取不到」，交给下一台
        response.resume();
        return finish(null);
      }
      var declared = parseInt(response.headers['content-length'], 10);
      if (declared && declared > FETCH_MAX_SIZE) {
        response.resume();
        return finish(null);
      }
      var chunks = [];
      var total = 0;
      var aborted = false;
      response.on('data', function(chunk) {
        if (aborted) return;
        total += chunk.length;
        if (total > FETCH_MAX_SIZE) {
          aborted = true;
          response.resume();
          return finish(null);
        }
        chunks.push(chunk);
      });
      response.on('end', function() {
        if (aborted || settled) return;
        var buffer = Buffer.concat(chunks);
        var fileHash = response.headers['x-file-hash'] || hash;
        // 哈希校验：拿到的字节必须真的就是这个 hash，否则宁可不要
        if (hashOf(buffer) !== fileHash) {
          console.warn('[CloudPeer] 哈希不匹配:', fileHash, '实际:', hashOf(buffer), '来源:', base);
          return finish(null);
        }
        finish({
          hash: fileHash,
          buffer: buffer,
          name: decodeURIComponent(response.headers['x-file-name'] || ''),
          mime: response.headers['x-file-mime'] || 'application/octet-stream',
          from: base
        });
      });
    });
    req.on('error', function() { finish(null); });
    req.setTimeout(FETCH_TIMEOUT_MS, function() {
      try { req.destroy(); } catch (e) {}
      finish(null);
    });
  });
}

/**
 * 向对端逐个尝试取回文件字节。
 * @returns Promise<{hash, buffer, name, mime, from} | null>；null = 所有对端都没有
 */
function fetchFromPeers(hash) {
  if (!hash) return Promise.resolve(null);
  if (missCache[hash] && Date.now() - missCache[hash] < MISS_TTL) {
    return Promise.resolve(null);
  }
  if (inflight[hash]) return inflight[hash];

  var bases = peerBases();
  if (!bases.length) return Promise.resolve(null);

  var job = bases.reduce(function(chain, base) {
    return chain.then(function(found) {
      if (found) return found;
      return tryOne(base, hash);
    });
  }, Promise.resolve(null));

  job = job.then(function(found) {
    delete inflight[hash];
    if (!found) {
      missCache[hash] = Date.now();
      // 负缓存不能无限长：条目本身很小，但学期尺度下会随 hash 数线性增长
      var keys = Object.keys(missCache);
      if (keys.length > 2000) {
        keys.sort(function(a, b) { return missCache[a] - missCache[b]; });
        for (var i = 0; i < keys.length - 1000; i++) delete missCache[keys[i]];
      }
    }
    return found;
  }, function(err) {
    delete inflight[hash];
    console.warn('[CloudPeer] 回源异常:', hash, err && err.message);
    return null;
  });

  inflight[hash] = job;
  return job;
}

module.exports = {
  peerBases: peerBases,
  fetchFromPeers: fetchFromPeers,
  FETCH_MAX_SIZE: FETCH_MAX_SIZE
};
