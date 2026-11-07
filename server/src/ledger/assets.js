// 学元账本 · 资产定义
// ============================================================
// 只有三种资产语义，靠数据行扩展而不是改表列：
//   CASH     真金 1:1，可兑付、可转账、可买有真实成本的东西
//   GRANT    赠送额度，不可兑付、可转账、只能抵扣到「毛利」为止
//   PRACTICE 练习金，封闭：不可转账、不可兑付、不可出域
//
// 三条结构禁令（改代码前先看）：
// 1. 只有 external_cost=1 的资产能买真实成本商品（AI 算力 / 实物）。
// 2. PRACTICE 永不进订单、永不提现（orders 表有 CHECK 兜底）。
// 3. 没有任何「汇率」字段。CASH 恒 1 学元分 = 1 人民币分，改锚定 = 违约。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var SEED = [
  {
    asset: 'CASH', label: '充值学元',
    redeemable: 1, transferable: 1, external_cost: 1,
    supply: 'cash', sink: 'withdraw,goods'
  },
  {
    asset: 'GRANT', label: '赠送学元',
    redeemable: 0, transferable: 1, external_cost: 0,
    supply: 'quota', sink: 'goods_offset'
  },
  {
    asset: 'PRACTICE', label: '练习金',
    redeemable: 0, transferable: 0, external_cost: 0,
    supply: 'closed', sink: 'games'
  }
];

var BY_NAME = {};
SEED.forEach(function (a) { BY_NAME[a.asset] = a; });

function normalize(name) {
  return String(name == null ? '' : name).trim().toUpperCase();
}

function get(name) {
  var key = normalize(name);
  return BY_NAME[key] || null;
}

function assertKnown(name) {
  var a = get(name);
  if (!a) throw new Error('未知资产: ' + name);
  return a;
}

function isRedeemable(name)   { return assertKnown(name).redeemable === 1; }
function isTransferable(name) { return assertKnown(name).transferable === 1; }
function canBuyExternal(name) { return assertKnown(name).external_cost === 1; }

function list() {
  return SEED.map(function (a) { return Object.assign({}, a); });
}

// 幂等写入资产表；已存在则不动（避免把线上改过的属性覆盖回去）
function seed(db) {
  var now = new Date().toISOString();
  var ins = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_assets',
    '(asset, label, redeemable, transferable, external_cost, supply, sink, unit, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join(' '));
  var created = 0;
  SEED.forEach(function (a) {
    var r = ins.run(a.asset, a.label, a.redeemable, a.transferable, a.external_cost, a.supply, a.sink, 'cent', now);
    created += r.changes;
  });
  return { total: SEED.length, created: created };
}

// 从库里读回属性（管理端/审计用；正常路径走内存常量）
function loadFromDb(db) {
  var rows = db.prepare('SELECT * FROM xy_ledger_assets').all();
  var out = {};
  rows.forEach(function (r) { out[r.asset] = r; });
  return out;
}

module.exports = {
  SEED: SEED,
  get: get,
  assertKnown: assertKnown,
  normalize: normalize,
  isRedeemable: isRedeemable,
  isTransferable: isTransferable,
  canBuyExternal: canBuyExternal,
  list: list,
  seed: seed,
  loadFromDb: loadFromDb
};
