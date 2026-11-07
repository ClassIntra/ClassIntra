// 班级（实例）登记表
// ============================================================
// 跨班支付/跨班红包都要回答一个问题：**这个收款码 / 红包码属于哪个班？**
//
// users 表里有跨班镜像用户，光看学号判断不了；收款码 token 也只落在签发它的班上。
// 所以维护一张 server_id → HTTP base 的登记表：
//
//   1) 种子：env WALLET_PEERS="18i=http://<对端地址>:9001,8i=http://<本班地址>:9001"
//      （两个班都配，重启即生效；不配也能在第一次往来后自动学会）
//   2) 学习：任何一次跨班请求都会带上 from_server/from_base，
//      回执里也会带自己的 server_id —— 收到就 upsert。
//
// 只做「记住谁在哪」这一件事，不参与签名与鉴权（那些在 cross-pay 里）。

var db = require('../utils/db');
var config = require('../config');

var ready = false;
// 自己的对外基址：优先 env WALLET_BASE；否则从任意一次带 Origin 的请求里学会
var localBaseCache = '';

function ensure() {
  if (ready) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_peer (
  server_id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  name TEXT,
  source TEXT,
  last_seen INTEGER NOT NULL
);
`);
  ready = true;
  seedFromEnv();
}

function serverId() {
  var s = (config.relay && config.relay.serverId) || process.env.WALLET_SERVER_ID || '';
  if (s) return String(s).slice(0, 32);
  // 没配 serverId 时用 base 的 host 段兜底，保证不同实例不会撞成同一个 key
  return 'local';
}

function normalizeBase(base) {
  var b = String(base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9_.:\-\[\]]{3,120}$/.test(b)) return '';
  return b;
}

// 种子格式：id=base,id=base（也接受只有 base 的简写，id 用 host 代替）
function seedFromEnv() {
  var raw = String(process.env.WALLET_PEERS || '').trim();
  if (!raw) return 0;
  var parts = raw.split(',');
  var n = 0;
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i].trim();
    if (!seg) continue;
    var id = '';
    var base = seg;
    var eq = seg.indexOf('=');
    if (eq > 0) {
      id = seg.slice(0, eq).trim();
      base = seg.slice(eq + 1).trim();
    }
    var b = normalizeBase(base);
    if (!b) continue;
    if (!id) {
      try { id = new URL(b).hostname; } catch (e) { id = b; }
    }
    if (id === serverId()) continue;   // 别把自己记成 peer
    upsert(id, b, '', 'env');
    n++;
  }
  return n;
}

function upsert(serverIdRaw, baseRaw, name, source) {
  ensure();
  var id = String(serverIdRaw || '').trim().slice(0, 32);
  var base = normalizeBase(baseRaw);
  if (!id || !base) return null;
  if (id === serverId()) return null;
  // 防御：对端把「自己的地址」填成我们的（历史上踩过）—— 指向本班的 peer 毫无意义，
  // 而且会让口令探测打到自己的 404 上，所以直接丢弃。
  if (base === localBaseHint()) return null;
  var t = Date.now();
  db.prepare([
    'INSERT INTO xy_peer (server_id, base_url, name, source, last_seen)',
    'VALUES (?, ?, ?, ?, ?)',
    'ON CONFLICT(server_id) DO UPDATE SET',
    '  base_url = excluded.base_url,',
    '  name = COALESCE(NULLIF(excluded.name, \'\'), xy_peer.name),',
    '  source = excluded.source,',
    '  last_seen = excluded.last_seen'
  ].join('\n')).run(id, base, String(name || '').slice(0, 32), String(source || 'learn').slice(0, 16), t);
  return { server_id: id, base_url: base };
}

function list() {
  ensure();
  return db.prepare('SELECT server_id, base_url, name, source, last_seen FROM xy_peer ORDER BY last_seen DESC')
    .all().map(function (r) {
      return {
        server_id: r.server_id,
        base_url: r.base_url,
        name: r.name || '',
        source: r.source || '',
        last_seen: r.last_seen
      };
    });
}

function byServer(id) {
  ensure();
  var r = db.prepare('SELECT * FROM xy_peer WHERE server_id = ?').get(String(id || ''));
  return r ? { server_id: r.server_id, base_url: r.base_url, name: r.name || '' } : null;
}

// 猜一个 base 是不是本班（同 base 就不该走跨班）
function isMine(base) {
  ensure();
  var b = normalizeBase(base);
  if (!b) return true;
  var r = db.prepare('SELECT 1 FROM xy_peer WHERE base_url = ?').get(b);
  // 登记表里有它 → 明确是别人；没有则按「自己的」处理，走本班逻辑（本班会给出更准确的报错）
  return !r;
}

// ---- 本班对外基址 ----
// 没有配置时，任何一次带 Origin 的请求都能教会我们（平板访问的地址就是别人能访问的地址）
function localBaseHint() {
  if (process.env.WALLET_BASE) return normalizeBase(process.env.WALLET_BASE);
  return localBaseCache;
}

function learnLocalBase(base) {
  var b = normalizeBase(base);
  if (b) localBaseCache = b;
  return localBaseCache;
}

module.exports = {
  ensure: ensure,
  upsert: upsert,
  list: list,
  byServer: byServer,
  serverId: serverId,
  normalizeBase: normalizeBase,
  isMine: isMine,
  seedFromEnv: seedFromEnv,
  localBaseHint: localBaseHint,
  learnLocalBase: learnLocalBase
};
