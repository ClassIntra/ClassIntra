// 锁屏页脚所需的本机网络名（SSID）读取工具
// ------------------------------------------------------------
// 浏览器读不到 SSID（Network Information API 出于隐私不暴露网络名），
// 因此由服务端读取「本机（CI 服务所在机器）」当前关联的无线网络。教室环境下
// 服务器与平板处在同一个 AP 之下，故该值等价于全班当前正在使用的网络名。
//
// 降级链（任何一环失败都不抛错，只是拿不到名）：
//   1. env 覆盖 LOCK_INFO_WIFI      —— 服务器走有线网 / 虚拟机 / 探测不到时手动指定
//   2. netsh wlan show interfaces   —— 仅 Windows
//   3. { wifi:'', connected:false } —— 前端显示「WIFI: 未连接」
//
// 结果带 TTL 缓存 + 并发合并：一台班级机的锁屏可能长时间挂着、且多个客户端同时问，
// 不能每次请求都 spawn 一个 netsh。
var execFile = require('child_process').execFile;

var TTL = 15000;
var cache = { at: 0, data: null };
var waiters = null;

function decodeWinOutput(buf) {
  // 中文 Windows 的 netsh 输出是 GBK；Node 官方构建带完整 ICU，可直接按 gb18030 解码
  try {
    return new TextDecoder('gb18030').decode(buf);
  } catch (e) {}
  return buf.toString('utf8');
}

function isConnectedState(state) {
  var s = String(state || '').trim();
  if (!s) return false;
  if (s.indexOf('已连接') >= 0) return true;   // 「已断开连接」不含「已连接」子串，故此判据安全
  if (/已断开|未连接|断开/.test(s)) return false;
  return /connect/i.test(s) && !/disconnect/i.test(s);   // 英文 connected / disconnected
}

// 解析 netsh 输出：按「名称/Name」切分多网卡块，取第一个「已连接」的块
function pickConnectedWifi(text) {
  var lines = String(text || '').split(/\r?\n/);
  var reHead = /^\s*(?:名称|Name)\s*:/;
  var reState = /^\s*(?:状态|State)\s*:\s*(.+?)\s*$/;
  var reSsid = /^\s*SSID\s*:\s*(.+?)\s*$/i;
  var blocks = [];
  var cur = null;
  var m;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (reHead.test(line)) {
      cur = { ssid: '', state: '' };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    if ((m = reState.exec(line))) {
      if (!cur.state) cur.state = m[1];
    } else if ((m = reSsid.exec(line))) {
      if (!cur.ssid) cur.ssid = m[1];
    }
  }
  for (var b = 0; b < blocks.length; b++) {
    if (isConnectedState(blocks[b].state)) return blocks[b];
  }
  return null;
}

function readNow(callback) {
  var override = String(process.env.LOCK_INFO_WIFI || '').trim();
  if (override) {
    return callback(null, { wifi: override, connected: true, state: '已连接', source: 'env' });
  }
  if (process.platform !== 'win32') {
    return callback(null, { wifi: '', connected: false, state: '不支持', source: 'platform' });
  }
  execFile('netsh', ['wlan', 'show', 'interfaces'], {
    windowsHide: true, timeout: 3500, encoding: 'buffer', maxBuffer: 1024 * 1024
  }, function(err, stdout) {
    if (err) return callback(err);
    var hit = pickConnectedWifi(decodeWinOutput(stdout));
    if (!hit) {
      return callback(null, { wifi: '', connected: false, state: '已断开连接', source: 'netsh' });
    }
    callback(null, { wifi: hit.ssid, connected: true, state: hit.state, source: 'netsh' });
  });
}

// 取当前网络信息；命中缓存时同步返回（callback 立即被调用）
function getNetworkInfo(callback) {
  function expand(info) {
    return {
      wifi: info.wifi || '',
      connected: !!info.connected,
      state: info.state || '',
      source: info.source || '',
      updated_at: cache.at
    };
  }
  var now = Date.now();
  if (cache.data && now - cache.at < TTL) {
    return callback(null, expand(cache.data));
  }
  if (waiters) {
    waiters.push(callback);
    return;
  }
  waiters = [callback];
  readNow(function(err, info) {
    var payload = (!info || err) ? { wifi: '', connected: false, state: 'unknown', source: 'error' } : info;
    cache = { at: Date.now(), data: payload };
    var list = waiters;
    waiters = null;
    for (var i = 0; i < list.length; i++) list[i](null, expand(payload));
  });
}

module.exports = {
  getNetworkInfo: getNetworkInfo,
  pickConnectedWifi: pickConnectedWifi,
  isConnectedState: isConnectedState,
  decodeWinOutput: decodeWinOutput
};
