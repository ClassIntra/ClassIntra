// 学元账本 · 分录哈希链（可证明性）
// ============================================================
// I1c 能发现「余额和流水对不上」，但发现不了「有人同时改了余额和流水」。
// 哈希链把流水变成一条只能往后追加、改任意一节都会断的链：
//
//   genesis ──● tx(n+1) ──● tx(n+2) ──● ... ──● head
//              prev_hash   prev_hash        chain_hash
//
// 历史段处理：生产库已有 1023 笔交易没有 seal，不能要求历史凭空长出链。
// 迁移 046 打一条 genesis，把「到 MAX(tx.id) 为止的全部历史分录」压成一个
// digest；此后每笔新交易接在链尾。verify() 既验新段逐笔哈希，也重算历史
// digest —— 于是**连历史分录被篡改也能检出**，不依赖 I1c。
//
// ⚠️ 本模块所有函数都接受可选 db 参数（默认单例），因为迁移 046 需要传自己的
//    连接来打 genesis，而测试脚本用的是临时库实例。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var defaultDb = require('../utils/db');
var idem = require('./idempotency');

function d(db) { return db || defaultDb; }
function q(sql, db) { return d(db).prepare(sql); }
function nowIso() { return new Date().toISOString(); }

// 把分录构造成链上可比较的形状。字段白名单是刻意的：
// 将来 entries 表加列不应改变既有交易的哈希（否则全链历史一次性失效）。
function lineRows(normEntries) {
  return (normEntries || []).map(function (e, i) {
    return {
      line_no: e.line_no == null ? i + 1 : Number(e.line_no),
      account_id: Number(e.account_id),
      asset: String(e.asset),
      direction: Number(e.direction),
      amount_cent: Number(e.amount_cent)
    };
  });
}

function entryHash(rows) {
  return idem.hashOf({ v: 1, lines: lineRows(rows) });
}

function txShape(tx) {
  return {
    id: Number(tx.id),
    ref: String(tx.ref),
    kind: String(tx.kind),
    status: String(tx.status),
    initiator: tx.initiator == null ? null : String(tx.initiator),
    memo: tx.memo == null ? '' : String(tx.memo),
    payload: tx.payload == null ? null : String(tx.payload),
    amount_cent: Number(tx.amount_cent),
    request_hash: tx.request_hash == null ? null : String(tx.request_hash),
    created_at: String(tx.created_at)
  };
}

function chainHash(prevHash, eHash, tx) {
  return idem.hashOf({ v: 1, prev: String(prevHash), entries: String(eHash), tx: txShape(tx) });
}

// 到 uptoTxId 为止的全部历史分录摘要。只在打 genesis 与 verify 时算，
// 绝不进 post() 热路径（V.14 修正 2：entries 线性增长，全表扫描会拖死写入）。
function legacyDigest(db, uptoTxId) {
  var rows = q([
    'SELECT e.tx_id, e.line_no, e.account_id, e.asset, e.direction, e.amount_cent,',
    '       t.ref, t.kind, t.status, t.amount_cent AS tx_amount_cent, t.created_at',
    'FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.tx_id <= ? ORDER BY e.tx_id, e.line_no'
  ].join('\n'), db).all(Number(uptoTxId) || 0);
  return idem.hashOf({ v: 1, upto: Number(uptoTxId) || 0, tx_count: rows.length, rows: rows });
}

// 打 genesis。必须在 post() 的事务**外**调用：若在同一事务内、且当前交易已插入，
// MAX(tx.id) 会把这笔新交易也算进历史段，导致它永远不上链。
// 幂等：已有 chain_state 就直接返回，不重写（重写等于给历史换锚）。
function ensureGenesis(db) {
  var conn = d(db);
  var has = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_chain_state'").get();
  if (!has) return { skipped: true, reason: 'chain_state 表不存在（请先跑迁移 046）' };
  var state = conn.prepare('SELECT * FROM xy_ledger_chain_state WHERE id = 1').get();
  if (state) return { skipped: true, genesis_tx_id: state.genesis_tx_id };

  var maxTx = conn.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM xy_ledger_transactions').get().n;
  var digest = legacyDigest(conn, maxTx);
  var headHash = idem.hashOf({ v: 1, genesis: true, upto: Number(maxTx), digest: digest });
  conn.prepare([
    'INSERT OR IGNORE INTO xy_ledger_chain_state',
    '(id, genesis_tx_id, genesis_digest, genesis_head_hash, head_tx_id, head_hash, updated_at)',
    'VALUES (1, ?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(Number(maxTx), digest, headHash, Number(maxTx), headHash, nowIso());
  return { created: true, genesis_tx_id: Number(maxTx), genesis_digest: digest, head_hash: headHash };
}

// 在 post() 事务内给一笔交易上链。调用前必须已 ensureGenesis。
function seal(db, tx, normEntries, actor) {
  var conn = d(db);
  // 老库 / 未跑 046 的临时测试库：没有链就安静跳过，不能让账本写入整体失败。
  // 但表存在却没有 genesis 是配置错误，必须抛出来 —— 静默不上链比报错更危险。
  var hasTable = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_tx_seals'").get();
  if (!hasTable) return { skipped: true, reason: 'seals 表不存在（老库兼容）' };
  var state = conn.prepare('SELECT * FROM xy_ledger_chain_state WHERE id = 1').get();
  if (!state) throw new Error('哈希链未初始化：请先调用 proof.ensureGenesis()');

  var eHash = entryHash(normEntries);
  var ch = chainHash(state.head_hash, eHash, tx);
  conn.prepare([
    'INSERT INTO xy_ledger_tx_seals',
    '(tx_id, prev_hash, entry_hash, chain_hash, actor, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(
    Number(tx.id), String(state.head_hash), eHash, ch,
    actor == null ? null : String(actor), nowIso()
  );
  conn.prepare([
    'UPDATE xy_ledger_chain_state SET head_tx_id = ?, head_hash = ?, updated_at = ? WHERE id = 1'
  ].join(' ')).run(Number(tx.id), ch, nowIso());
  return { tx_id: Number(tx.id), prev_hash: state.head_hash, entry_hash: eHash, chain_hash: ch };
}

function head(db) {
  var conn = d(db);
  var has = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_chain_state'").get();
  if (!has) return null;
  return conn.prepare('SELECT * FROM xy_ledger_chain_state WHERE id = 1').get() || null;
}

// 独立校验器：只读重算，不修任何数据。
// 返回 { ok, checked, legacy_checked, issues[], genesis_tx_id, head_tx_id, head_hash }
function verify(db) {
  var conn = d(db);
  var state = head(conn);
  if (!state) return { ok: false, checked: 0, issues: [{ code: 'NO_GENESIS', detail: '哈希链未初始化' }] };

  var issues = [];
  var checked = 0;

  // 1) 历史段：重算 digest 与 genesis 锚比对
  var digest = legacyDigest(conn, state.genesis_tx_id);
  if (digest !== state.genesis_digest) {
    issues.push({ code: 'LEGACY_DIGEST_MISMATCH', detail: 'genesis 之前的历史分录被改动', extra: {
      expected: state.genesis_digest, got: digest
    } });
  }

  // 2) 新段：逐笔重算 entry_hash / chain_hash / 链接关系
  var txs = conn.prepare([
    "SELECT * FROM xy_ledger_transactions WHERE id > ? AND status = 'posted' ORDER BY id ASC"
  ].join(' ')).all(Number(state.genesis_tx_id));

  var prev = String(state.genesis_head_hash);
  var lastChain = String(state.genesis_head_hash);

  for (var i = 0; i < txs.length; i++) {
    var tx = txs[i];
    var s = conn.prepare('SELECT * FROM xy_ledger_tx_seals WHERE tx_id = ?').get(tx.id);
    if (!s) {
      issues.push({ code: 'SEAL_MISSING', tx_id: tx.id, detail: '交易 ' + tx.id + ' 在链起点之后却没有 seal' });
      continue;
    }
    var rows = conn.prepare([
      'SELECT line_no, account_id, asset, direction, amount_cent',
      'FROM xy_ledger_entries WHERE tx_id = ? ORDER BY line_no'
    ].join('\n')).all(tx.id);
    var eHash = entryHash(rows);
    var ch = chainHash(prev, eHash, tx);

    if (s.entry_hash !== eHash) {
      issues.push({ code: 'SEAL_BROKEN', tx_id: tx.id, detail: '交易 ' + tx.id + ' 的分录被改动（entry_hash 不符）' });
    }
    if (s.prev_hash !== prev) {
      issues.push({ code: 'CHAIN_LINK_BROKEN', tx_id: tx.id, detail: '交易 ' + tx.id + ' 的 prev_hash 接不上上一节' });
    }
    if (s.chain_hash !== ch) {
      issues.push({ code: 'SEAL_BROKEN', tx_id: tx.id, detail: '交易 ' + tx.id + ' 的交易头被改动（chain_hash 不符）' });
    }
    prev = String(s.chain_hash);
    lastChain = String(s.chain_hash);
    checked++;
  }

  if (lastChain !== String(state.head_hash)) {
    issues.push({ code: 'HEAD_MISMATCH', detail: '链尾 hash 与 chain_state.head_hash 不一致', extra: {
      expected: state.head_hash, got: lastChain
    } });
  }

  return {
    ok: issues.length === 0,
    checked: checked,
    legacy_checked: Number(state.genesis_tx_id),
    issues: issues,
    genesis_tx_id: Number(state.genesis_tx_id),
    head_tx_id: Number(state.head_tx_id),
    head_hash: String(state.head_hash)
  };
}

module.exports = {
  lineRows: lineRows,
  entryHash: entryHash,
  chainHash: chainHash,
  legacyDigest: legacyDigest,
  ensureGenesis: ensureGenesis,
  seal: seal,
  head: head,
  verify: verify
};
