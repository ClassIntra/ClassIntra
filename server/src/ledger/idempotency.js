// 学元账本 · 幂等请求指纹
// ============================================================
// ref 唯一只能挡住「同一笔写了两次」，挡不住「同一个 ref 换了载荷」：
// 后者在原实现里会静默返回 duplicate，调用方以为钱已经按新参数动了 ——
// 这是比重复扣款更难查的一类错账。
//
// 指纹覆盖：ref / kind / initiator / memo / payload / 规范化后的全部分录。
// 用规范化后的 account_id（不是调用方写的 {kind,owner}），这样同一个业务
// 模板换一种写法不会误判成冲突。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var crypto = require('crypto');

// 稳定序列化：对象键排序、数组保序、undefined 归一为 null。
// 目的不是「短」，而是「同一份语义在任何 Node 版本上得到同一串字节」。
function canonical(value) {
  if (value === null || value === undefined) return 'null';
  var t = typeof value;
  if (t === 'number') {
    if (!isFinite(value)) return 'null';
    return String(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (t === 'object') {
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (value[k] === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + canonical(value[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

function hashOf(value) {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

// normEntries: post() 规范化后的分录数组，元素字段顺序不影响结果（canonical 会排序）。
function fingerprint(ref, kind, opts, normEntries) {
  var o = opts || {};
  return hashOf({
    v: 1,
    ref: String(ref),
    kind: String(kind || ''),
    initiator: o.initiator == null ? null : String(o.initiator),
    memo: o.memo == null ? '' : String(o.memo),
    payload: o.payload === undefined ? null : o.payload,
    entries: (normEntries || []).map(function (e) {
      return {
        account_id: Number(e.account_id),
        asset: String(e.asset),
        direction: Number(e.direction),
        amount_cent: Number(e.amount_cent)
      };
    })
  });
}

module.exports = {
  canonical: canonical,
  hashOf: hashOf,
  fingerprint: fingerprint
};
