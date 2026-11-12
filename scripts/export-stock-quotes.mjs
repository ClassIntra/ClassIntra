// 学元证券 · 行情图片导出（周末离线带走用）
// 用法（仓库根，必须系统 Node 24 / ABI 137）：
//   "C:\Program Files\nodejs\node.exe" scripts/export-stock-quotes.mjs [--out <dir>]
// 数据源：server/database/classintra.db（只读）+ market-apps/stock/backend/quotes.js（板块映射）
// 产物：exports/stock-<日期>/ 下 7 张 PNG + 3 份 CSV + per-user/ 每人一张卡；
//       中间 HTML 在 .workbuddy/tmp/stock-export/html/
// 参数：--out <dir> 改输出目录；--no-personal 跳过每人一张的个人卡（只出全班汇总）。
//
// 约定：红涨绿跌（A 股习惯）、价格单位元（库内为分）、行情为「最后真实价」。
// 用户口径只读复刻 backend/trading.js accountSummary + /rank 的净投入反推（不写库、
// 不 require 应用模块，避免 settleT1 改动生产数据）；证券账户 = 练习金池 practice_balance。

import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'server', 'index.js'));
const Database = require('better-sqlite3');

const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = 9335;
const W = 1400;
const DPR = 2;

// ---------------------------------------------------------------- 数据
const db = new Database(join(ROOT, 'server', 'database', 'classintra.db'), { readonly: true });

const universeSrc = readFileSync(join(ROOT, 'market-apps', 'stock', 'backend', 'quotes.js'), 'utf8');
const sectorOf = {};
const ure = /\{\s*code:\s*'(\d{6})',\s*sector:\s*'([^']+)'/g;
let um;
while ((um = ure.exec(universeSrc))) sectorOf[um[1]] = um[2];

const r2 = n => Math.round(n * 100) / 100;
const fmt = (n, d = 2) => Number(n).toFixed(d);
const signed = (n, d = 2) => (n > 0 ? '+' : '') + fmt(n, d);
const money = n => {
  if (n >= 1e8) return fmt(n / 1e8) + '亿';
  if (n >= 1e4) return fmt(n / 1e4) + '万';
  return fmt(n, 0);
};

const quotes = db.prepare('SELECT * FROM stock_quotes').all().map(r => {
  const price = r.price_cent / 100;
  const prev = r.prev_close_cent / 100;
  return {
    code: r.code,
    name: String(r.name || '').replace(/\s+/g, ''),
    sector: sectorOf[r.code] || '其他',
    price, prev,
    open: r.open_cent / 100,
    high: r.high_cent / 100,
    low: r.low_cent / 100,
    change: r2(price - prev),
    pct: prev ? r2((price - prev) / prev * 100) : 0,
    volume: r.volume,
    amount: r.amount,
    price_cent: r.price_cent,
    prev_close_cent: r.prev_close_cent,
    quoted_at: r.quoted_at
  };
});

const bj = ts => {
  const d = new Date(ts + 8 * 3600 * 1000);
  const p = n => (n < 10 ? '0' : '') + n;
  return {
    date: d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()),
    time: p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()),
    weekday: '日一二三四五六'[d.getUTCDay()]
  };
};
const quoteTs = Math.max(...quotes.map(q => q.quoted_at));
const snap = bj(quoteTs);
const nowSnap = bj(Date.now());

const reports = db.prepare('SELECT date_key, payload_json FROM stock_daily_report ORDER BY date_key').all()
  .map(r => ({ ...JSON.parse(r.payload_json), date_key: r.date_key }));

const up = quotes.filter(q => q.pct > 0).length;
const down = quotes.filter(q => q.pct < 0).length;
const flat = quotes.length - up - down;
const avgPct = r2(quotes.reduce((s, q) => s + q.pct, 0) / quotes.length);
const totalAmount = quotes.reduce((s, q) => s + q.amount, 0);
const sorted = [...quotes].sort((a, b) => b.pct - a.pct);

const tradeByDate = {};
for (const r of db.prepare('SELECT trade_date, COUNT(*) n, COUNT(DISTINCT user_id) u FROM stock_trades GROUP BY trade_date').all()) {
  tradeByDate[r.trade_date] = { n: r.n, users: r.u };
}

// 行情快照是「今天」但今日收盘报告还没生成（15:00 前）→ 盘中模式。
// 盘中指数不在库里，实时取东财；取不到就沿用昨收并把涨跌清零（页面会标注）。
const hasTodayReport = reports.some(r => r.date_key === snap.date);
const intraday = snap.date === nowSnap.date && !hasTodayReport;
const dataDate = snap.date === nowSnap.date || !reports.length ? snap.date : reports[reports.length - 1].date_key;

if (intraday) {
  let live = null;
  try {
    const r = await fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f14&secids=1.000001,0.399001,0.399006', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' }
    });
    const j = await r.json();
    const diff = j && j.data && j.data.diff;
    const arr = Array.isArray(diff) ? diff : Object.values(diff || {});
    if (arr.length === 3) live = arr.map(d => ({ code: d.f12, name: d.f14, price: d.f2, change: d.f4, change_pct: d.f3 }));
  } catch (e) {
    console.log('  ! 指数接口不可用，沿用上一交易日点位：' + e.message);
  }
  if (!live) {
    const prev = reports[reports.length - 1];
    live = (prev ? prev.indexes : []).map(ix => ({ ...ix, change: 0, change_pct: 0 }));
  }
  const hotMap = {};
  for (const t of db.prepare('SELECT code, COUNT(*) n FROM stock_trades WHERE trade_date = ? GROUP BY code ORDER BY n DESC LIMIT 5').all(dataDate)) {
    hotMap[t.code] = t.n;
  }
  const td = tradeByDate[dataDate] || { n: 0, users: 0 };
  reports.push({
    date_key: dataDate,
    indexes: live,
    up_count: up,
    down_count: down,
    gainers: sorted.slice(0, 3).map(q => ({ name: q.name, code: q.code, change_pct: q.pct })),
    losers: sorted.slice(-3).reverse().map(q => ({ name: q.name, code: q.code, change_pct: q.pct })),
    comment: '盘中快照，非收盘数据；15:00 收盘后重跑可得收盘版。',
    tip: '',
    class_activity: {
      hot: Object.keys(hotMap).map(code => ({ code, name: (quotes.find(q => q.code === code) || {}).name || code, n: hotMap[code] })),
      trades: td.n,
      users: td.users
    }
  });
}

const latest = reports[reports.length - 1];
const wdChar = ds => '日一二三四五六'[new Date(ds + 'T00:00:00Z').getUTCDay()];
const nextTradingDay = ds => {
  const d = new Date(ds + 'T00:00:00Z');
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};

// 「本周走势」只取当周（周一为基准）；当周不足 2 天（周一/节后首日）退回最近 4 个交易日
const mondayOf = ds => {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
};
const weekStart = mondayOf(dataDate);
let weekReports = reports.filter(r => r.date_key >= weekStart);
if (weekReports.length < 2) weekReports = reports.slice(-4);

const outDir = outArg >= 0 ? argv[outArg + 1] : join(ROOT, 'exports', 'stock-' + dataDate);
const htmlDir = join(ROOT, '.workbuddy', 'tmp', 'stock-export', 'html');
mkdirSync(outDir, { recursive: true });
mkdirSync(htmlDir, { recursive: true });

const groups = {};
for (const q of quotes) (groups[q.sector] || (groups[q.sector] = [])).push(q);
const sectorStats = Object.keys(groups).map(name => {
  const arr = groups[name];
  return {
    name, list: arr.slice().sort((a, b) => b.pct - a.pct),
    pct: r2(arr.reduce((s, q) => s + q.pct, 0) / arr.length),
    up: arr.filter(q => q.pct > 0).length,
    n: arr.length,
    amount: arr.reduce((s, q) => s + q.amount, 0)
  };
}).sort((a, b) => b.pct - a.pct);

// ---------------------------------------------------------------- 各用户具体情况
// 口径（与 backend/trading.js accountSummary、/rank 一致，只读复刻）：
//   total_asset = 练习金余额(practice_balance) + Σ 现价×持仓数量
//   total_pnl   = Σ(市值 − 成本) + 已实现盈亏        （资产页「累计盈亏」）
//   净投入      = 练习金余额 + Σ买入流出(含费) − Σ卖出净回流
//   收益率      = total_pnl / 净投入
// ⚠️ 排行榜接口用的是 xy_account.balance（现金+赠送池），多池拆分后与证券资产页
//    不再同源；本导出一律以「证券练习金账户」为准，即学生资产页看到的数字。
const qByCode = {};
for (const q of quotes) qByCode[q.code] = q;

const posRows = db.prepare('SELECT * FROM stock_positions WHERE qty > 0').all();
const flowMap = {};
for (const r of db.prepare(`SELECT user_id,
    COALESCE(SUM(CASE WHEN side='buy' THEN amount_cent + fee_cent ELSE 0 END), 0) AS buy_out,
    COALESCE(SUM(CASE WHEN side='sell' THEN amount_cent - fee_cent ELSE 0 END), 0) AS sell_in
  FROM stock_trades GROUP BY user_id`).all()) flowMap[r.user_id] = r;
const achMap = {};
for (const r of db.prepare('SELECT user_id, COUNT(*) n FROM stock_achievements GROUP BY user_id').all()) achMap[r.user_id] = r.n;
const todayRealizedMap = {};
for (const r of db.prepare('SELECT user_id, COALESCE(SUM(realized_cent),0) s FROM stock_trades WHERE trade_date = ? GROUP BY user_id').all(dataDate)) todayRealizedMap[r.user_id] = r.s;
const todayAggMap = {};
for (const r of db.prepare('SELECT user_id, COUNT(*) n, COALESCE(SUM(fee_cent),0) fee FROM stock_trades WHERE trade_date = ? GROUP BY user_id').all(dataDate)) todayAggMap[r.user_id] = r;

// 2026-11-11 起旧表 xy_account 已退役，余额唯一来源是账本 xy_ledger_*：
//   practice_balance = 用户账户 PRACTICE + 交易托管 escrow('trading:<学号>') PRACTICE
// （与 ledger/app-api.js practiceAccount、trading.js accountSummary 同口径）
const hasLedger = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_accounts'").get();
// 999999=开发账号、999001=AI测试：只用来联调，不进班级排名
const DEV_IDS = "('999999', '999001')";
const accountRows = (hasLedger
  ? db.prepare(`SELECT s.user_id, s.realized_cent, s.fee_total_cent, s.trade_count,
      u.real_name, u.net_name,
      COALESCE(ub.balance, 0) AS practice_avail,
      COALESCE(tb.balance, 0) AS practice_frozen
    FROM stock_account s
    LEFT JOIN users u ON u.user_id = s.user_id
    LEFT JOIN xy_ledger_accounts ua ON ua.kind = 'user' AND ua.owner_id = s.user_id
    LEFT JOIN xy_ledger_balances ub ON ub.account_id = ua.id AND ub.asset = 'PRACTICE'
    LEFT JOIN xy_ledger_accounts ta ON ta.kind = 'escrow' AND ta.owner_id = 'trading:' || s.user_id
    LEFT JOIN xy_ledger_balances tb ON tb.account_id = ta.id AND tb.asset = 'PRACTICE'
    WHERE s.user_id NOT LIKE '@%' AND s.user_id NOT IN ${DEV_IDS}`)
  : db.prepare(`SELECT a.user_id, a.practice_balance AS practice_avail, a.frozen_practice AS practice_frozen,
      s.realized_cent, s.fee_total_cent, s.trade_count, u.real_name, u.net_name
    FROM xy_account a JOIN stock_account s ON s.user_id = a.user_id
    LEFT JOIN users u ON u.user_id = a.user_id
    WHERE a.user_id NOT LIKE '@%' AND a.user_id NOT IN ${DEV_IDS}`)
).all();

const users = accountRows.map(a => {
  let mvCent = 0, costCent = 0, dayPnlCent = 0;
  const positions = posRows.filter(p => p.user_id === a.user_id).map(p => {
    const q = qByCode[p.code];
    const last = q ? q.price_cent : 0;
    const prev = q ? q.prev_close_cent : last;
    const mv = last * p.qty;
    const pnl = mv - p.cost_cent;
    mvCent += mv; costCent += p.cost_cent; dayPnlCent += (last - prev) * p.qty;
    return {
      code: p.code,
      name: String(p.name || (q && q.name) || p.code).replace(/\s+/g, ''),
      qty: p.qty,
      avg_cost: p.qty ? r2(p.cost_cent / p.qty / 100) : 0,
      cost: p.cost_cent / 100,
      price: last / 100,
      mv: mv / 100,
      pnl: pnl / 100,
      pnl_pct: p.cost_cent ? r2(pnl / p.cost_cent * 100) : 0,
      day_pnl: (last - prev) * p.qty / 100,
      change_pct: q ? q.pct : 0,
      hold_days: p.opened_at ? Math.floor((Date.now() - p.opened_at) / 86400000) : 0
    };
  }).sort((x, y) => y.mv - x.mv);

  const practice = (a.practice_avail || 0) + (a.practice_frozen || 0);
  const pnlCent = (mvCent - costCent) + (a.realized_cent || 0);
  const f = flowMap[a.user_id] || { buy_out: 0, sell_in: 0 };
  const invested = practice + f.buy_out - f.sell_in;
  const agg = todayAggMap[a.user_id] || { n: 0, fee: 0 };
  return {
    uid: a.user_id,
    name: a.real_name || a.net_name || a.user_id,
    net_name: a.net_name || '',
    practice: practice / 100,
    available: (a.practice_avail || 0) / 100,
    frozen: (a.practice_frozen || 0) / 100,
    mv: mvCent / 100,
    cost: costCent / 100,
    total: (practice + mvCent) / 100,
    pnl: pnlCent / 100,
    invested: invested / 100,
    ret: invested > 0 ? r2(pnlCent / invested * 100) : 0,
    realized: (a.realized_cent || 0) / 100,
    position_pnl: (mvCent - costCent) / 100,
    today_pnl: (dayPnlCent + (todayRealizedMap[a.user_id] || 0)) / 100,
    trades: a.trade_count || 0,
    fee: (a.fee_total_cent || 0) / 100,
    ach: achMap[a.user_id] || 0,
    today_trades: agg.n,
    today_fee: agg.fee / 100,
    positions
  };
}).sort((x, y) => y.total - x.total);
users.forEach((u, i) => { u.rank = i + 1; });

// 跨班战报与上周结算：db 关闭前一次性取出（页面渲染阶段已不能查库）
const peerRanks = db.prepare('SELECT class_no, payload_json, generated_at FROM stock_peer_rank').all()
  .map(r => {
    try { return { ...JSON.parse(r.payload_json), generated_at: r.generated_at }; } catch (e) { return null; }
  })
  .filter(Boolean);
const lastSettle = db.prepare('SELECT * FROM stock_weekly_settle ORDER BY settled_at DESC LIMIT 1').get();

const classStats = {
  n: users.length,
  total: users.reduce((s, u) => s + u.total, 0),
  win: users.filter(u => u.pnl > 0).length,
  lose: users.filter(u => u.pnl < 0).length,
  even: users.filter(u => u.pnl === 0).length,
  avgRet: r2(users.reduce((s, u) => s + u.ret, 0) / (users.length || 1)),
  trades: users.reduce((s, u) => s + u.trades, 0),
  fee: users.reduce((s, u) => s + u.fee, 0),
  holders: users.filter(u => u.positions.length > 0).length,
  posCount: users.reduce((s, u) => s + u.positions.length, 0)
};

db.close();

// ---------------------------------------------------------------- 工具
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = n => n > 0 ? 'up' : n < 0 ? 'down' : 'flat';

const CSS = `
*{box-sizing:border-box}
:root{--bg:#0c1018;--panel:#151c28;--panel2:#1a2231;--line:#273245;--txt:#e9eef7;--muted:#8b98ad;--up:#ff5257;--down:#18c98a;--gold:#e2b45e;--blue:#5b9dff}
html,body{margin:0;padding:0;background:var(--bg);color:var(--txt);font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}
body{width:${W}px}
.num{font-family:Consolas,"Courier New",monospace;font-variant-numeric:tabular-nums;letter-spacing:-.2px}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}
.page{padding:34px 40px 40px}
.hd{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid var(--gold);padding-bottom:16px;margin-bottom:22px}
.brand{font-size:30px;font-weight:700;letter-spacing:1px}
.brand i{font-style:normal;color:var(--gold)}
.brand small{font-size:15px;font-weight:400;color:var(--muted);margin-left:12px;letter-spacing:0}
.sub{font-size:14px;color:var(--muted);margin-top:8px}
.stamp{text-align:right;font-size:13px;color:var(--muted);line-height:1.9}
.stamp b{display:inline-block;background:#2a2213;color:var(--gold);border:1px solid #59461f;border-radius:4px;padding:5px 12px;font-size:13px;font-weight:600;margin-bottom:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin-bottom:16px}
.pt{font-size:15px;font-weight:700;color:var(--txt);margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.pt span{font-size:12px;font-weight:400;color:var(--muted)}
.grid3{display:flex;gap:14px;margin-bottom:16px}
.idx{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px;position:relative;overflow:hidden}
.idx:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--up)}
.idx.dn:before{background:var(--down)}
.idx-n{font-size:14px;color:var(--muted)}
.idx-n span{margin-left:7px}
.idx-n b{font-size:16px;color:var(--txt);font-weight:600}
.idx-p{font-size:34px;font-weight:700;margin:6px 0 2px;line-height:1.1}
.idx-c{font-size:15px;font-weight:600}
.idx-sp{position:absolute;right:14px;bottom:12px;opacity:.9}
.cols{display:flex;gap:16px}
.col{flex:1;min-width:0}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{color:var(--muted);font-weight:400;text-align:right;padding:7px 6px;border-bottom:1px solid var(--line);font-size:12px}
th:first-child,td:first-child{text-align:left}
td{padding:7px 6px;text-align:right;border-bottom:1px solid #1e2736}
.nowrap{white-space:nowrap}
.lcol{text-align:left!important}
tr:last-child td{border-bottom:none}
.rank{display:inline-block;width:18px;color:var(--muted);font-size:12px}
.nm{font-weight:600}
.cd{color:var(--muted);font-size:11px;margin-left:5px;font-weight:400}
.pill{display:inline-block;min-width:70px;padding:2px 7px;border-radius:3px;text-align:right;font-weight:700}
.pill.up{background:rgba(255,82,87,.14)}.pill.down{background:rgba(24,201,138,.14)}.pill.flat{background:rgba(139,152,173,.12)}
.breadth{display:flex;height:20px;border-radius:4px;overflow:hidden;margin:4px 0 10px}
.breadth i{display:block;height:100%}
.breadth-l{display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}
.breadth-l b{font-size:15px}
.secrow{display:flex;align-items:center;height:27px;font-size:12.5px}
.sec-name{width:88px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sec-track{flex:1;position:relative;height:12px;background:#111824;border-radius:2px;margin:0 9px}
.sec-mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3a465c}
.sec-bar{position:absolute;top:2px;height:8px;border-radius:2px}
.sec-val{width:60px;text-align:right;font-weight:700}
.sec-cnt{width:46px;text-align:right;color:var(--muted);font-size:11px}
.foot{margin-top:18px;border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);line-height:1.7}
.foot b{color:var(--gold);font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:11px 12px;break-inside:avoid}
.card-h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:4px}
.card-h b{font-size:15px}
.card-h span{font-size:12px;color:var(--muted)}
.card-h em{font-style:normal;font-weight:700;font-size:14px;margin-left:8px}
.qrow-t{display:flex;align-items:center;height:25px;font-size:12px;border-bottom:1px solid #1b2331}
.qrow-t:last-child{border-bottom:none}
.qrow-t .n{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qrow-t .n small{color:var(--muted);font-size:10px;margin-left:4px}
.qrow-t .p{width:62px;text-align:right}
.qrow-t .c{width:54px;text-align:right;font-size:11px}
.qrow-t .v{width:66px;text-align:right;font-weight:700}
.cards{display:flex;flex-wrap:wrap;gap:12px}
.cards .card{width:calc(33.333% - 8px)}
.note{background:#171f2d;border-left:3px solid var(--gold);padding:10px 14px;font-size:12.5px;color:#b9c4d4;line-height:1.75;border-radius:0 5px 5px 0;margin-bottom:16px}
.kv{display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.kv b{color:var(--txt);font-size:17px;margin-left:5px}
.legend{display:flex;gap:20px;font-size:12px;color:var(--muted);margin-top:8px}
.legend i{display:inline-block;width:16px;height:3px;vertical-align:middle;margin-right:6px;border-radius:2px}
.kpis{display:flex;gap:12px;margin-bottom:16px}
.kpi{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:13px 16px}
.kpi>span{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}
.kpi b{font-size:23px;font-weight:700}
.kpi small{font-size:11px;color:var(--muted);font-weight:400;margin-left:6px}
.utable{font-size:12px}
.utable td{padding:5px 6px}
.utable tbody tr:nth-child(even){background:#141b27}
.ucards{display:flex;flex-wrap:wrap;gap:12px}
.ucards .ucard{width:calc(50% - 6px);background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:12px 14px;break-inside:avoid}
.uc-h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:7px}
.uc-h b{font-size:15px}
.uc-h .num{font-size:11px;color:var(--muted);margin-left:6px}
.uc-h em{font-style:normal;font-size:11px;color:var(--gold);margin-left:8px}
.uc-kpi{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-bottom:7px;flex-wrap:wrap}
.uc-kpi b{font-size:12.5px;margin-left:3px}
.utable2{font-size:11px}
.utable2 td{padding:4px 4px}
.utable2 th{padding:4px 4px;font-size:10.5px}
.empty{font-size:11.5px;color:var(--muted);padding:8px 4px}
`;

function page(inner, title) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page">${inner}</div></body></html>`;
}

function header(title, sub, badge, stampLine) {
  return `<div class="hd"><div><div class="brand"><i>学元</i>证券 <small>${esc(title)}</small></div><div class="sub">${sub}</div></div>
  <div class="stamp"><b>${badge}</b><br>数据截止 ${dataDate}（周${wdChar(dataDate)}）${intraday ? '盘中 · 未收盘' : '收盘'}<br>${stampLine || `快照 ${snap.date} ${snap.time} · ${quotes.length} 只 / ${sectorStats.length} 板块`}</div></div>`;
}

const nextDay = nextTradingDay(dataDate);
const gapDays = Math.round((new Date(nextDay + 'T00:00:00Z') - new Date(dataDate + 'T00:00:00Z')) / 86400000);
const footer = (extra = '') => `<div class="foot"><div>${extra}行情来自东方财富公开接口，学元证券为教学模拟盘，数据仅供学习，不构成投资建议。<br>红涨绿跌 · 价格为真实 A 股行情（元）· 成交额为真实市场数据</div><div style="text-align:right">${intraday
    ? `<b>今日 15:00 收盘</b><br>现在为盘中数据，价格仍会变动<br>快照 ${snap.date} ${snap.time} · 导出 ${nowSnap.time}（北京时间）`
    : `<b>${gapDays > 1 ? `休市 ${gapDays - 1} 天` : '下一交易日'}</b><br>${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30 开盘<br>导出时间 ${nowSnap.date} ${nowSnap.time}（北京时间）`}</div></div>`;

// ---------------------------------------------------------------- 页面 1：总览
function spark(points, color) {
  const w = 118, h = 40, pad = 4;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((v, i) => [pad + i * (w - 2 * pad) / (points.length - 1), h - pad - (v - min) / span * (h - 2 * pad)]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + fmt(p[0], 1) + ' ' + fmt(p[1], 1)).join(' ');
  return `<svg class="idx-sp" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${fmt(xy[xy.length - 1][0], 1)}" cy="${fmt(xy[xy.length - 1][1], 1)}" r="2.6" fill="${color}"/></svg>`;
}

function rankedRows(arr) {
  return arr.map((q, i) => `<tr><td><span class="rank">${i + 1}</span><span class="nm">${esc(q.name)}</span><span class="cd num">${q.code}</span></td>
    <td class="num">${fmt(q.price)}</td><td><span class="pill ${cls(q.pct)} num">${signed(q.pct)}%</span></td></tr>`).join('');
}

const idxColors = ['#e2b45e', '#5b9dff', '#c08bff'];
const idxCards = latest.indexes.map((ix, i) => {
  const pts = reports.map(r => (r.indexes[i] || {}).price).filter(v => typeof v === 'number');
  const c = cls(ix.change_pct);
  return `<div class="idx ${ix.change_pct < 0 ? 'dn' : ''}"><div class="idx-n"><b>${esc(ix.name)}</b> <span class="num">${ix.code}</span></div>
    <div class="idx-p num ${c}">${fmt(ix.price)}</div>
    <div class="idx-c num ${c}">${signed(ix.change)} &nbsp; ${signed(ix.change_pct)}%</div>
    ${spark(pts, c === 'down' ? '#18c98a' : '#ff5257')}</div>`;
}).join('');

const maxSec = Math.max(...sectorStats.map(s => Math.abs(s.pct))) || 1;
function sectorRows(list) {
  return list.map(s => {
    const w = Math.max(2, Math.abs(s.pct) / maxSec * 48);
    const bar = s.pct >= 0
      ? `<i class="sec-bar" style="left:50%;width:${fmt(w, 1)}%;background:var(--up)"></i>`
      : `<i class="sec-bar" style="right:50%;width:${fmt(w, 1)}%;background:var(--down)"></i>`;
    return `<div class="secrow"><div class="sec-name">${esc(s.name)}</div><div class="sec-track"><div class="sec-mid"></div>${bar}</div>
      <div class="sec-val num ${cls(s.pct)}">${signed(s.pct)}%</div><div class="sec-cnt num">${s.up}/${s.n}</div></div>`;
  }).join('');
}

const hot = (latest.class_activity && latest.class_activity.hot || []).slice(0, 3);
const weekTrades = weekReports.reduce((s, r) => s + (tradeByDate[r.date_key] ? tradeByDate[r.date_key].n : 0), 0);
const p1Title = intraday ? '盘中行情速览' : (gapDays > 1 ? '周末行情速览' : '当日行情速览');
const p1Sub = intraday
  ? `${dataDate} 盘中 ${snap.time} · A 股仍在交易，价格为最新成交价，收盘前会继续变动`
  : (gapDays > 1 ? `${dataDate} 收盘；周末休市，价格保持不变，下个交易日开盘前可直接对照` : `${dataDate} 收盘 · 全部 ${quotes.length} 只按板块归档`);
const page1 = page(header(p1Title, p1Sub, intraday ? '盘中快照 · 非收盘' : (gapDays > 1 ? '周末带回家 · 离线可看' : '收盘存档')) + `
  <div class="grid3">${idxCards}</div>
  <div class="panel"><div class="pt">市场宽度 <span>按股票池 ${quotes.length} 只等权统计 · ${dataDate} ${intraday ? '盘中' : '收盘'}</span></div>
    <div class="breadth"><i style="width:${fmt(up / quotes.length * 100, 2)}%;background:var(--up)"></i><i style="width:${fmt(flat / quotes.length * 100, 2)}%;background:#4a5568"></i><i style="width:${fmt(down / quotes.length * 100, 2)}%;background:var(--down)"></i></div>
    <div class="breadth-l"><span><b class="up num">${up}</b> 只上涨 &nbsp;· <b class="flat num">${flat}</b> 只平盘 &nbsp;· <b class="down num">${down}</b> 只下跌</span>
    <span>平均涨跌 <b class="num ${cls(avgPct)}">${signed(avgPct)}%</b> &nbsp;· 合计成交额 <b class="num">${money(totalAmount)}</b></span></div>
  </div>
  <div class="cols">
    <div class="col"><div class="panel"><div class="pt" style="color:var(--up)">涨幅榜 TOP 8 <span>${intraday ? '盘中' : '收盘'}涨幅</span></div><table><thead><tr><th>股票</th><th>现价</th><th>涨跌幅</th></tr></thead><tbody>${rankedRows(sorted.slice(0, 8))}</tbody></table></div></div>
    <div class="col"><div class="panel"><div class="pt" style="color:var(--down)">跌幅榜 TOP 8 <span>${intraday ? '盘中' : '收盘'}跌幅</span></div><table><thead><tr><th>股票</th><th>现价</th><th>涨跌幅</th></tr></thead><tbody>${rankedRows(sorted.slice(-8).reverse())}</tbody></table></div></div>
  </div>
  <div class="panel"><div class="pt">板块表现 <span>${sectorStats.length} 个板块 · 等权平均涨跌幅 / 上涨家数</span></div>
    <div class="cols"><div class="col">${sectorRows(sectorStats.slice(0, Math.ceil(sectorStats.length / 2)))}</div><div class="col">${sectorRows(sectorStats.slice(Math.ceil(sectorStats.length / 2)))}</div></div>
  </div>
  <div class="note">📌 <b>${intraday ? '盘中提示' : (gapDays > 1 ? '休市提示' : '当日提示')}</b>：${intraday
    ? `现在是 ${dataDate}（周${wdChar(dataDate)}）${snap.time}，A 股仍在交易，图中价格是<b>盘中最新价</b>，会继续变动；15:00 收盘后重跑脚本即可得到当日收盘版。`
    : gapDays > 1
      ? `本图价格是 ${dataDate}（周${wdChar(dataDate)}）收盘价，${gapDays - 1} 天休市期间不会变动；长期有效委托会在 ${nextDay.slice(5)}（周${wdChar(nextDay)}）开盘后按当时价格撮合。`
      : `本图价格是 ${dataDate}（周${wdChar(dataDate)}）收盘价；下一交易日 ${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30 开盘。`}<br>
  本班本周（${weekReports[0].date_key.slice(5).replace('-', '/')}–${dataDate.slice(5).replace('-', '/')}）共成交 <b>${weekTrades}</b> 笔，本日 <b>${(tradeByDate[dataDate] || {}).n || 0}</b> 笔 / <b>${(tradeByDate[dataDate] || {}).users || 0}</b> 人参与；最热门：${hot.map(h => esc(h.name) + ' ' + h.n + ' 笔').join('、') || '—'}。
  ${esc(latest.comment || '')}</div>
  ${footer('')}
`, '01 行情总览');

// ---------------------------------------------------------------- 页面 2：本周走势
function lineChart() {
  const w = 1310, h = 300, L = 54, R = 24, T = 22, B = 34;
  const series = [0, 1, 2].map(i => {
    const base = weekReports[0].indexes[i].price;
    return weekReports.map(r => ({ v: r2((r.indexes[i].price / base - 1) * 100), d: r.date_key }));
  });
  const all = series.flat().map(p => p.v);
  let lo = Math.min(...all, 0), hi = Math.max(...all, 1);
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  // 最低网格线正好落在坐标轴上时，它的刻度文字会和日期标签挤在一起
  if (Math.ceil(lo / 2) * 2 === lo) lo -= 1;
  const X = i => L + i * (w - L - R) / (weekReports.length - 1);
  const Y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  let g = '';
  for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) {
    const zero = v === 0;
    g += `<line x1="${L}" y1="${fmt(Y(v), 1)}" x2="${w - R}" y2="${fmt(Y(v), 1)}" stroke="${zero ? '#5a6883' : '#202a3a'}" stroke-width="1"${zero ? ' stroke-dasharray="5 4"' : ''}/>`;
    g += `<text x="${L - 10}" y="${fmt(Y(v) + 4, 1)}" fill="#8b98ad" font-size="12" text-anchor="end" font-family="Consolas,monospace">${v > 0 ? '+' : ''}${v}%</text>`;
  }
  weekReports.forEach((r, i) => {
    const isLast = i === weekReports.length - 1;
    const suffix = intraday && isLast ? '*' : '';
    g += `<text x="${fmt(X(i), 1)}" y="${h - 10}" fill="${intraday && isLast ? '#e2b45e' : '#8b98ad'}" font-size="12" text-anchor="middle">${r.date_key.slice(5)} 周${wdChar(r.date_key)}${suffix}</text>`;
  });
  series.forEach((s, si) => {
    const color = idxColors[si];
    const d = s.map((p, i) => (i ? 'L' : 'M') + fmt(X(i), 1) + ' ' + fmt(Y(p.v), 1)).join(' ');
    g += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>`;
    s.forEach((p, i) => {
      g += `<circle cx="${fmt(X(i), 1)}" cy="${fmt(Y(p.v), 1)}" r="4" fill="#0c1018" stroke="${color}" stroke-width="2.2"/>`;
      // 首点=基准 0%、末点与另外两条线太近，数值移到图例汇总，避免标签互相压住
      if (i > 0 && i < s.length - 1) {
        g += `<text x="${fmt(X(i), 1)}" y="${fmt(Y(p.v) - 11, 1)}" fill="${color}" font-size="12" font-weight="700" text-anchor="middle" font-family="Consolas,monospace">${signed(p.v)}%</text>`;
      }
    });
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g}</svg>`;
}

function barChart(values, labels, color, suffix, maxOverride) {
  const w = 620, h = 190, L = 40, R = 12, T = 18, B = 30;
  const max = maxOverride || Math.max(...values, 1) * 1.15;
  const bw = (w - L - R) / values.length * 0.52;
  let g = `<line x1="${L}" y1="${h - B}" x2="${w - R}" y2="${h - B}" stroke="#3a465c"/>`;
  values.forEach((v, i) => {
    const x = L + (i + 0.5) * (w - L - R) / values.length - bw / 2;
    const bh = Math.max(2, v / max * (h - T - B));
    g += `<rect x="${fmt(x, 1)}" y="${fmt(h - B - bh, 1)}" width="${fmt(bw, 1)}" height="${fmt(bh, 1)}" rx="3" fill="${color}" opacity=".88"/>`;
    g += `<text x="${fmt(x + bw / 2, 1)}" y="${fmt(h - B - bh - 7, 1)}" fill="#e9eef7" font-size="12" font-weight="700" text-anchor="middle" font-family="Consolas,monospace">${fmt(v, 1)}${suffix}</text>`;
    g += `<text x="${fmt(x + bw / 2, 1)}" y="${h - 9}" fill="#8b98ad" font-size="11" text-anchor="middle">${labels[i]}</text>`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g}</svg>`;
}

const endVals = [0, 1, 2].map(i => ({
  name: ['上证', '深成', '创业板'][i],
  v: r2((latest.indexes[i].price / weekReports[0].indexes[i].price - 1) * 100),
  color: idxColors[i]
}));
const upRatio = weekReports.map(r => r.up_count + r.down_count ? r.up_count / (r.up_count + r.down_count) * 100 : 0);
const tradeCounts = weekReports.map(r => (tradeByDate[r.date_key] || {}).n || 0);
const dayLabels = weekReports.map(r => r.date_key.slice(5));

const dayRows = weekReports.slice().reverse().map(r => {
  const t = tradeByDate[r.date_key] || { n: 0, users: 0 };
  const ix = r.indexes.map(i => `<span class="num ${cls(i.change_pct)}">${signed(i.change_pct)}%</span>`).join(' / ');
  const g0 = r.gainers && r.gainers[0], l0 = r.losers && r.losers[0];
  const mark = intraday && r.date_key === dataDate ? ' <span style="color:var(--gold)">盘中</span>' : '';
  return `<tr><td class="num nowrap">${r.date_key}${mark}</td><td class="nowrap">${ix}</td><td class="num nowrap">${r.up_count} : ${r.down_count}</td>
    <td class="nowrap">${g0 ? esc(g0.name) + ' <span class="up num">' + signed(g0.change_pct) + '%</span>' : '—'}</td>
    <td class="nowrap">${l0 ? esc(l0.name) + ' <span class="down num">' + signed(l0.change_pct) + '%</span>' : '—'}</td>
    <td class="num nowrap">${t.n} / ${t.users}</td><td class="lcol" style="color:var(--muted)">${esc(r.comment || '')}</td></tr>`;
}).join('');

const weekSpan = weekReports.length ? `（${weekReports[0].date_key.slice(5).replace('-', '/')} – ${dataDate.slice(5).replace('-', '/')}，${weekReports.length} 个交易日${intraday ? '含盘中' : ''}）` : '';

const shPct = r => (r.indexes[0] || {}).change_pct;
const rankedDays = weekReports.filter(r => typeof shPct(r) === 'number').slice().sort((a, b) => shPct(b) - shPct(a));
const bestDay = rankedDays[0], worstDay = rankedDays[rankedDays.length - 1];
const poolSizes = [...new Set(weekReports.map(r => r.up_count + r.down_count))];
const poolChanged = poolSizes.length > 1;
const weekNarrative = rankedDays.length >= 2
  ? `${bestDay.date_key.slice(5)} 最强（上证 ${signed(shPct(bestDay))}%），${worstDay.date_key.slice(5)} 最弱（上证 ${signed(shPct(worstDay))}%）；截至 ${dataDate.slice(5)} ${intraday ? '盘中' : '收盘'}，三大指数本周 ${endVals.every(e => e.v > 0) ? '全部收涨' : endVals.every(e => e.v < 0) ? '全部收跌' : '涨跌互现'}。`
  : `本周目前只有 ${dataDate} 一天的数据，趋势要等后续交易日补上。`;
const page2 = page(header('本周大盘走势', `${weekSpan} 指数以本周首个交易日为基准的累计涨跌幅`, intraday ? '本周回顾 · 含盘中' : '本周回顾') + `
  <div class="panel"><div class="pt">三大指数 · 本周累计涨跌 <span>以 ${weekReports[0].date_key} 收盘点位 = 0%${intraday ? ' · 最后一个点为盘中' : ''}</span></div>
    ${lineChart()}
    <div class="legend"><span><i style="background:#e2b45e"></i>上证指数</span><span><i style="background:#5b9dff"></i>深证成指</span><span><i style="background:#c08bff"></i>创业板指</span>
    <span style="margin-left:auto;color:var(--muted)">${dataDate.slice(5)} ${intraday ? '盘中' : '收盘'} 较 ${weekReports[0].date_key.slice(5)}：</span>${endVals.map(e => `<span><i style="background:${e.color}"></i>${e.name} <b class="num ${cls(e.v)}">${signed(e.v)}%</b></span>`).join('')}</div>
  </div>
  <div class="cols">
    <div class="col"><div class="panel"><div class="pt">每日上涨占比 <span>上涨家数 / (涨 + 跌)</span></div>${barChart(upRatio, dayLabels, '#ff5257', '%', 100)}</div></div>
    <div class="col"><div class="panel"><div class="pt">本班每日成交笔数 <span>笔 / 参与人数见下表</span></div>${barChart(tradeCounts, dayLabels, '#e2b45e', '')}</div></div>
  </div>
  <div class="panel"><div class="pt">每日看点 <span>收盘报告 + ${intraday ? '当日成交（盘中）' : '班级成交'}</span></div>
    <table><thead><tr><th class="nowrap">日期</th><th class="nowrap">上证 / 深成 / 创业板</th><th class="nowrap">涨 : 跌</th><th class="nowrap">领涨</th><th class="nowrap">领跌</th><th class="nowrap">成交/人</th><th class="lcol">当日点评</th></tr></thead><tbody>${dayRows}</tbody></table>
  </div>
  <div class="note">📌 <b>本周脉络</b>：${weekNarrative}<br>
  ${poolChanged ? `<b>读图提醒</b>：本周「涨 : 跌」统计的股票池家数发生过变化（${poolSizes.join(' → ')} 只），前后两日的家数不能直接比较，看「上涨占比」更稳妥。<br>` : ''}
  ${intraday ? '盘中' : '收盘'}：${esc(latest.comment || '')} ${esc(latest.tip || '')}</div>
  ${footer('')}
`, '02 本周走势');

// ---------------------------------------------------------------- 页面 3/4：全量明细（按板块分组）
function cardHtml(s) {
  const rows = s.list.map(q => `<div class="qrow-t"><div class="n">${esc(q.name)}<small class="num">${q.code}</small></div>
    <div class="p num">${fmt(q.price)}</div><div class="c num ${cls(q.change)}">${signed(q.change)}</div>
    <div class="v num ${cls(q.pct)}">${signed(q.pct)}%</div></div>`).join('');
  return `<div class="card"><div class="card-h"><div><b>${esc(s.name)}</b><span> ${s.n} 只</span><em class="num ${cls(s.pct)}">${signed(s.pct)}%</em></div>
    <span class="num">${s.up} 涨 / ${s.n - s.up} 跌</span></div>
    <div class="qrow-t" style="height:20px;color:var(--muted);font-size:11px"><div class="n">名称 / 代码</div><div class="p" style="text-align:right">现价</div><div class="c" style="text-align:right">涨跌</div><div class="v" style="text-align:right">涨跌幅</div></div>
    ${rows}</div>`;
}

// 按卡片高度贪心分成两页，保证两页高度接近
const byHeight = [...sectorStats].sort((a, b) => b.list.length - a.list.length);
const buckets = [[], []];
const heights = [0, 0];
for (const s of byHeight) {
  const k = heights[0] <= heights[1] ? 0 : 1;
  buckets[k].push(s);
  heights[k] += s.list.length * 25 + 60;
}
buckets.forEach(b => b.sort((x, y) => y.pct - x.pct));

const detailPages = buckets.map((bucket, i) => {
  const codes = bucket.reduce((n, s) => n + s.n, 0);
  return page(header('全部行情明细 ' + (i + 1) + '/2', `按板块分组 · 本页 ${bucket.length} 个板块 / ${codes} 只 · 现价、涨跌额、涨跌幅均为${intraday ? '盘中最新' : '收盘'}价`, intraday ? '盘中快照' : '离线存档') + `
    <div class="note" style="margin-bottom:14px">📖 <b>怎么看</b>：红=涨、绿=跌；「现价」是${intraday ? `盘中 ${snap.time} 的最新价` : '收盘最后真实价'}，「涨跌」相对前收盘价。板块标题右侧为该板块等权平均涨跌幅。两页合计覆盖全部 ${quotes.length} 只可交易股票。</div>
    <div class="cards">${bucket.map(cardHtml).join('')}</div>
    ${footer('')}
  `, '0' + (3 + i) + ' 行情明细');
});

// ---------------------------------------------------------------- 页面 5/6/7：各用户具体情况
const n2 = v => fmt(v, 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const sn2 = v => (v > 0 ? '+' : '') + n2(v);
const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '').trim() || 'user';

const userFooter = () => `<div class="foot"><div>口径：证券账户 = 练习金池，总资产 = 练习金余额 + 持仓市值；累计盈亏 = 持仓浮盈亏 + 已实现盈亏；收益率 = 累计盈亏 / 净投入。<br>与学生在「资产页」看到的数字一致；不含钱包里的充值 / 赠送学元。教学模拟盘，不构成投资建议。${intraday ? '<br>⚠️ 本页为盘中数据：持仓按最新价估值，「今日盈亏」收盘前还会变动。' : ''}</div>
  <div style="text-align:right">${intraday
    ? `<b>今日 15:00 收盘</b><br>收盘后重跑可得当日最终数字<br>快照 ${snap.date} ${snap.time}（北京时间）`
    : `<b>${gapDays > 1 ? `休市 ${gapDays - 1} 天` : '下一交易日'}</b><br>${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30 开盘<br>导出时间 ${nowSnap.date} ${nowSnap.time}（北京时间）`}</div></div>`;

const userRow = u => `<tr>
  <td class="num">${u.rank}</td><td class="num">${u.uid}</td><td>${esc(u.name)}</td>
  <td class="num">${n2(u.total)}</td><td class="num">${n2(u.available)}</td><td class="num">${n2(u.mv)}</td>
  <td class="num ${cls(u.pnl)}"><b>${sn2(u.pnl)}</b></td><td class="num ${cls(u.ret)}">${signed(u.ret)}%</td>
  <td class="num">${u.trades}</td><td class="num">${u.positions.length}</td><td class="num">${u.ach}</td></tr>`;

const page5 = page(header('各用户情况总览', '按证券账户总资产排序 · 口径与学生「资产页」一致（练习金池）', `全班 ${classStats.n} 人`) + `
  <div class="kpis">
    <div class="kpi"><span>参与人数</span><b class="num">${classStats.n}</b><small>人 · ${classStats.holders} 人持仓</small></div>
    <div class="kpi"><span>合计总资产</span><b class="num">${n2(classStats.total)}</b><small>学元</small></div>
    <div class="kpi"><span>盈利 / 亏损 / 持平</span><b><span class="up">${classStats.win}</span> / <span class="down">${classStats.lose}</span> / <span class="flat">${classStats.even}</span></b><small>人</small></div>
    <div class="kpi"><span>平均收益率</span><b class="num ${cls(classStats.avgRet)}">${signed(classStats.avgRet)}%</b><small>累计成交 ${classStats.trades} 笔</small></div>
  </div>
  <div class="panel"><div class="pt">全班账户一览 <span>单位：学元 · 按总资产降序 · 共 ${classStats.n} 人 / ${classStats.posCount} 条持仓</span></div>
    <table class="utable"><thead><tr><th>名次</th><th>学号</th><th style="text-align:left">姓名</th><th>总资产</th><th>可用练习金</th><th>持仓市值</th><th>累计盈亏</th><th>收益率</th><th>成交</th><th>持仓</th><th>成就</th></tr></thead>
    <tbody>${users.map(userRow).join('')}</tbody></table>
  </div>
  <div class="note">📌 <b>怎么读</b>：红=盈利、绿=亏损；「累计盈亏」已扣掉佣金、印花税与过户费，也包含已卖出部分的已实现盈亏；「收益率」= 累计盈亏 ÷ 净投入（余额 + 买入流出 − 卖出回流）。<br>
  <b>口径提醒</b>：本图用证券练习金账户（学生资产页口径）。应用内排行榜读的是学元总余额（含充值 / 赠送池），多池拆分后两者不同源，如对不上以本图为准。</div>
  ${userFooter()}
`, '05 各用户总览');

function userCard(u) {
  const rows = u.positions.map(p => `<tr>
    <td>${esc(p.name)}<small class="cd num">${p.code}</small></td>
    <td class="num">${p.qty}</td><td class="num">${fmt(p.avg_cost)}</td><td class="num">${fmt(p.price)}</td>
    <td class="num">${n2(p.mv)}</td><td class="num ${cls(p.pnl)}">${sn2(p.pnl)}</td>
    <td class="num ${cls(p.pnl_pct)}">${signed(p.pnl_pct)}%</td></tr>`).join('');
  return `<div class="ucard">
    <div class="uc-h"><div><b>${esc(u.name)}</b><span class="num">${u.uid}</span><em>第 ${u.rank} 名</em></div>
      <div class="num" style="font-size:12px">总资产 ${n2(u.total)}</div></div>
    <div class="uc-kpi">
      <span>累计盈亏 <b class="num ${cls(u.pnl)}">${sn2(u.pnl)}</b></span>
      <span>收益率 <b class="num ${cls(u.ret)}">${signed(u.ret)}%</b></span>
      <span>今日 <b class="num ${cls(u.today_pnl)}">${sn2(u.today_pnl)}</b></span>
      <span>成交 <b class="num">${u.trades}</b> 笔</span>
      <span>成就 <b class="num">${u.ach}</b></span>
    </div>
    ${u.positions.length
      ? `<table class="utable2"><thead><tr><th style="text-align:left">股票</th><th>数量</th><th>成本</th><th>现价</th><th>市值</th><th>浮盈亏</th><th>盈亏%</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">空仓 · 可用练习金 ${n2(u.available)} 学元（尚未买入，或已全部卖出）</div>`}
  </div>`;
}

// 按持仓条数贪心分成两页，两页高度接近
const uBuckets = [[], []], uHeights = [0, 0];
for (const u of [...users].sort((a, b) => b.positions.length - a.positions.length)) {
  const k = uHeights[0] <= uHeights[1] ? 0 : 1;
  uBuckets[k].push(u);
  uHeights[k] += u.positions.length * 22 + 92;
}
uBuckets.forEach(b => b.sort((x, y) => x.rank - y.rank));

const userDetailPages = uBuckets.map((bucket, i) => page(header('各用户持仓明细 ' + (i + 1) + '/2',
  `本页 ${bucket.length} 人 · 每只持仓的成本、现价、市值与浮动盈亏（${intraday ? '盘中最新价' : '收盘价'}）`, intraday ? '一人一格 · 盘中' : '一人一格') + `
  <div class="note" style="margin-bottom:14px">📖 <b>怎么看</b>：成本价含买入手续费；浮盈亏 = 现价×数量 − 成本；红=赚、绿=亏。空仓同学只显示可用练习金。两页合计 ${classStats.n} 人 / ${classStats.posCount} 条持仓。</div>
  <div class="ucards">${bucket.map(userCard).join('')}</div>
  ${userFooter()}
`, '0' + (6 + i) + ' 各用户持仓明细'));

// ---------------------------------------------------------------- 页面 8：跨班（8 班）
// 8 班在另一个实例上，本地只有 stock_peer_rank 里的「跨班战报」：
// class_no / participants / avg_return / top[10]（只要网名 + 数字，学号真名不出班）。
// 所以这一页做的是两班对照，不含 8 班逐人明细 —— 那是隐私边界，不是数据缺失。
const localClass = (() => {
  const cnt = {};
  for (const u of users) {
    const cc = String(u.uid).slice(2, 4);
    if (/^\d{2}$/.test(cc)) cnt[cc] = (cnt[cc] || 0) + 1;
  }
  return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
})();
const peer = peerRanks.find(p => p.class_no !== localClass) || null;

// 对决口径与 peer.js buildLocalPayload 一致：余额只取练习金主账户（不含交易托管），
// 盈亏 = 总资产 − 净投入，人均只算「有成交或有持仓」的活跃同学。
const duelPlayers = users
  .filter(u => u.trades > 0 || u.positions.length > 0)
  .map(u => {
    const total = r2(u.available + u.mv);
    const invested = r2(u.invested - u.frozen);
    const pnl = r2(total - invested);
    return { uid: u.uid, name: u.name, net_name: u.net_name, total, pnl, ret: invested > 0 ? r2(pnl / invested * 100) : 0 };
  })
  .sort((a, b) => b.total - a.total);
const duelAvg = duelPlayers.length ? r2(duelPlayers.reduce((s, p) => s + p.ret, 0) / duelPlayers.length) : 0;
const duelTotal = r2(duelPlayers.reduce((s, p) => s + p.total, 0));
const settleInfo = lastSettle && lastSettle.detail_json ? Object.assign({}, JSON.parse(lastSettle.detail_json), { week_key: lastSettle.week_key }) : null;

const peerTop = peer ? peer.top : [];
const peerAvg = peer ? peer.avg_return : 0;
const lead = !peer ? null : duelAvg > peerAvg ? 'self' : duelAvg < peerAvg ? 'peer' : 'tie';
const leadText = lead === 'self' ? '本班领先' : lead === 'peer' ? `${parseInt(peer.class_no, 10)} 班领先` : lead === 'tie' ? '打平' : '暂无对端数据';

const duelRow = (p, side) => `<tr>
  <td class="num">${p.i}</td>
  <td>${side === 'self' ? `${esc(p.name)}<small class="cd num"> ${p.uid}</small>` : esc(p.net_name || '同学')}</td>
  <td class="num">${n2(p.total_asset !== undefined ? p.total_asset : p.total)}</td>
  <td class="num ${cls(p.pnl)}">${sn2(p.pnl)}</td>
  <td class="num ${cls(p.return_pct !== undefined ? p.return_pct : p.ret)}">${signed(p.return_pct !== undefined ? p.return_pct : p.ret)}%</td></tr>`;

const selfRows = duelPlayers.slice(0, 10).map((p, i) => duelRow({ ...p, i: i + 1 }, 'self')).join('');
const peerRows = peerTop.slice(0, 10).map((p, i) => duelRow({ ...p, i: i + 1 }, 'peer')).join('');

const page8 = peer ? page(header(`跨班对决 · ${parseInt(localClass, 10)} 班 vs ${parseInt(peer.class_no, 10)} 班`,
  `两班各跑一份学元证券，每半小时互发战报 · 本页只做对照，不含 ${parseInt(peer.class_no, 10)} 班逐人明细`,
  '跨班 · 对照',
  `本班战报 ${snap.date} ${snap.time}<br>${parseInt(peer.class_no, 10)} 班战报 ${bj(peer.generated_at).date} ${bj(peer.generated_at).time}`) + `
  <div class="kpis">
    <div class="kpi"><span>本班活跃</span><b class="num">${duelPlayers.length}</b><small>人有成交或持仓</small></div>
    <div class="kpi"><span>${parseInt(peer.class_no, 10)} 班活跃</span><b class="num">${peer.participants || 0}</b><small>人</small></div>
    <div class="kpi"><span>本班人均收益率</span><b class="num ${cls(duelAvg)}">${signed(duelAvg)}%</b><small>活跃同学等权</small></div>
    <div class="kpi"><span>${parseInt(peer.class_no, 10)} 班人均收益率</span><b class="num ${cls(peerAvg)}">${signed(peerAvg)}%</b><small>活跃同学等权</small></div>
  </div>
  <div class="panel" style="display:flex;align-items:center;justify-content:space-between">
    <div><div class="pt" style="margin-bottom:4px">本周实时对决</div>
      <div style="font-size:12.5px;color:var(--muted)">按人均收益率判定，周五 15:05 后自动结算；胜方班给本班「本周活跃」同学发学元</div></div>
    <div style="font-size:26px;font-weight:700;color:${lead === 'peer' ? '#5b9dff' : 'var(--gold)'}">${leadText}
      <span class="num" style="font-size:15px;color:var(--muted);margin-left:10px">${signed(duelAvg)}% vs ${signed(peerAvg)}%</span></div>
  </div>
  <div class="cols">
    <div class="col"><div class="panel"><div class="pt" style="color:var(--gold)">本班 · 资产榜 TOP 10 <span>${duelPlayers.length} 人活跃 · 合计 ${n2(duelTotal)}</span></div>
      <table><thead><tr><th>#</th><th>同学</th><th>总资产</th><th>盈亏</th><th>收益率</th></tr></thead><tbody>${selfRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div>
    <div class="col"><div class="panel"><div class="pt" style="color:#5b9dff">${parseInt(peer.class_no, 10)} 班 · 资产榜 TOP 10 <span>仅网名（跨班战报）</span></div>
      <table><thead><tr><th>#</th><th>网名</th><th>总资产</th><th>盈亏</th><th>收益率</th></tr></thead><tbody>${peerRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div>
  </div>
  <div class="panel"><div class="pt">上周对决 ${settleInfo ? `<span>${settleInfo.week_key}</span>` : ''}</div>
    ${settleInfo
      ? `<div class="kv"><span>结果<b class="${settleInfo.result === 'win' ? 'up' : settleInfo.result === 'lose' ? 'down' : ''}">${settleInfo.result === 'win' ? '18 班胜' : settleInfo.result === 'lose' ? '8 班胜' : '平局'}</b></span>
        <span>本班人均<b class="num ${cls(lastSettle.my_avg_return)}">${signed(lastSettle.my_avg_return)}%</b></span>
        <span>8 班人均<b class="num ${cls(lastSettle.peer_avg_return)}">${signed(lastSettle.peer_avg_return)}%</b></span>
        <span>参与<b class="num">${settleInfo.participants} / ${settleInfo.peer_participants}</b></span>
        <span>获奖<b class="num">${lastSettle.rewarded_count} 人 × ${(settleInfo.reward_cent / 100).toFixed(0)} 学元</b></span></div>`
      : '<div class="empty">还没有结算记录（每周五 15:05 后自动结算）</div>'}
  </div>
  <div class="note">📌 <b>为什么没有 ${parseInt(peer.class_no, 10)} 班的逐人明细</b>：跨班交换只发网名、总资产、收益率、参与人数，
  <b>学号和真名不出班</b>——这是两个实例之间的隐私约定。本页的本班数字用同一口径（练习金主账户 + 持仓市值，不含委托冻结）
  计算，所以和班级账户页可能差几元冻结资金。<br>
  ${parseInt(peer.class_no, 10)} 班战报生成于 ${bj(peer.generated_at).date} ${bj(peer.generated_at).time}（北京时间），每半小时刷新一次。</div>
  ${footer('')}
`, '08 跨班对决') : '';

// ---------------------------------------------------------------- 每人一张的个人卡
const PCSS = `
*{box-sizing:border-box}
:root{--bg:#0c1018;--panel:#151c28;--line:#273245;--txt:#e9eef7;--muted:#8b98ad;--up:#ff5257;--down:#18c98a;--gold:#e2b45e}
html,body{margin:0;padding:0;background:var(--bg);color:var(--txt);font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}
body{width:1040px;padding:18px 20px}
.num{font-family:Consolas,"Courier New",monospace;font-variant-numeric:tabular-nums}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}
.pcard{width:1000px;background:#101621;border:1px solid #2b3548;border-radius:10px;padding:24px 28px;margin-bottom:18px}
.p-hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid var(--gold);padding-bottom:14px;margin-bottom:18px}
.p-brand{font-size:16px;color:var(--muted);letter-spacing:1px}.p-brand i{font-style:normal;color:var(--gold);font-weight:700}
.p-title{font-size:29px;font-weight:700;margin-top:6px}.p-title small{font-size:16px;font-weight:400;color:var(--muted);margin-left:10px}
.p-stamp{text-align:right;font-size:12px;color:var(--muted);line-height:1.9}
.p-stamp b{display:inline-block;background:#2a2213;color:var(--gold);border:1px solid #59461f;border-radius:4px;padding:4px 10px;margin-bottom:4px}
.p-hero{display:flex;gap:12px;margin-bottom:14px}
.p-hero>div{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:13px 15px}
.p-hero span{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.p-hero b{font-size:25px;font-weight:700}.p-hero small{font-size:11px;color:var(--muted);margin-left:5px}
.p-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.p-grid div{width:calc(20% - 7px);background:#141b28;border:1px solid #222c3d;border-radius:5px;padding:8px 10px;font-size:11px;color:var(--muted)}
.p-grid b{display:block;font-size:14px;color:var(--txt);margin-top:3px}
.p-sec{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.p-sec h3{font-size:14px;margin:0 0 10px;color:var(--txt)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{color:var(--muted);font-weight:400;text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);font-size:11px}
th:first-child,td:first-child{text-align:left}
td{padding:6px 8px;text-align:right;border-bottom:1px solid #1e2736}
tr:last-child td{border-bottom:none}
.cd{color:var(--muted);font-size:10px;margin-left:5px}
.p-note{background:#171f2d;border-left:3px solid var(--gold);padding:10px 14px;font-size:12px;color:#b9c4d4;line-height:1.7;border-radius:0 5px 5px 0;margin-bottom:12px}
.p-foot{border-top:1px solid var(--line);padding-top:10px;display:flex;justify-content:space-between;font-size:11px;color:var(--muted);line-height:1.7}
.p-foot b{color:var(--gold)}
`;

function personalCard(u) {
  const rows = u.positions.map(p => `<tr>
    <td>${esc(p.name)}<span class="cd num">${p.code}</span></td>
    <td class="num">${p.qty}</td><td class="num">${fmt(p.avg_cost)}</td><td class="num">${fmt(p.price)}</td>
    <td class="num ${cls(p.change_pct)}">${signed(p.change_pct)}%</td>
    <td class="num">${n2(p.cost)}</td><td class="num">${n2(p.mv)}</td>
    <td class="num ${cls(p.pnl)}">${sn2(p.pnl)}</td>
    <td class="num ${cls(p.pnl_pct)}">${signed(p.pnl_pct)}%</td>
    <td class="num">${p.hold_days}</td></tr>`).join('');
  const tip = u.today_trades >= 6
    ? `今天成交 ${u.today_trades} 笔、费用 ${fmt(u.today_fee)} 学元 —— 手续费会吃掉收益，频繁交易是新手亏损的头号原因。`
    : u.today_trades === 0
      ? '今天没有交易。拿住不动也是一种策略，但要清楚自己为什么持有它。'
      : `今天成交 ${u.today_trades} 笔、费用 ${fmt(u.today_fee)} 学元，${intraday ? '收盘前' : '花'}两分钟复盘：每一笔都有理由吗？`;
  const cells = [
    ['可用练习金', n2(u.available)], ['冻结', n2(u.frozen)], ['持仓市值', n2(u.mv)],
    ['净投入', n2(u.invested)], ['已实现盈亏', sn2(u.realized)],
    ['持仓浮盈亏', sn2(u.position_pnl)], ['累计成交', u.trades + ' 笔'],
    ['累计费用', n2(u.fee)], ['成就', u.ach + ' 项'], ['持仓只数', u.positions.length + ' 只']
  ];
  return `<div class="pcard" data-uid="${u.uid}" data-name="${esc(u.name)}">
    <div class="p-hd"><div><div class="p-brand"><i>学元</i>证券 · ${intraday ? '盘中' : (gapDays > 1 ? '周末' : '当日')}个人账单</div>
      <div class="p-title">${esc(u.name)} <small class="num">${u.uid}</small></div></div>
      <div class="p-stamp"><b>${dataDate} ${intraday ? '盘中（未收盘）' : '收盘'}</b><br>全班第 ${u.rank} / ${classStats.n} 名<br>快照 ${snap.date} ${snap.time}</div></div>
    <div class="p-hero">
      <div><span>证券账户总资产</span><b class="num">${n2(u.total)}</b><small>学元</small></div>
      <div><span>累计盈亏</span><b class="num ${cls(u.pnl)}">${sn2(u.pnl)}</b></div>
      <div><span>收益率</span><b class="num ${cls(u.ret)}">${signed(u.ret)}%</b></div>
      <div><span>今日盈亏</span><b class="num ${cls(u.today_pnl)}">${sn2(u.today_pnl)}</b></div>
    </div>
    <div class="p-grid">${cells.map(c => `<div>${c[0]}<b class="num">${c[1]}</b></div>`).join('')}</div>
    <div class="p-sec"><h3>持仓明细（${u.positions.length} 只 · ${intraday ? '最新价' : '收盘价'}估值）</h3>
      ${u.positions.length
        ? `<table><thead><tr><th>股票</th><th>数量</th><th>成本价</th><th>现价</th><th>今日</th><th>成本额</th><th>市值</th><th>浮盈亏</th><th>盈亏%</th><th>持有天</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div style="font-size:12.5px;color:var(--muted);padding:6px 2px">当前空仓 · 可用练习金 ${n2(u.available)} 学元。${intraday ? '盘中有合适的价位可以挂单，但别为了交易而交易。' : gapDays > 1 ? '休市期间可以计划，开盘后按新价格挂单。' : '下一个交易日可以按新价格挂单。'}</div>`}
    </div>
    <div class="p-sec"><h3>今日复盘</h3><div style="font-size:12.5px;color:#b9c4d4;line-height:1.8">${tip}<br>
      累计成交 ${u.trades} 笔，累计费用 ${n2(u.fee)} 学元；已实现盈亏 <span class="num ${cls(u.realized)}">${sn2(u.realized)}</span>，持仓浮盈亏 <span class="num ${cls(u.position_pnl)}">${sn2(u.position_pnl)}</span>。</div></div>
    <div class="p-note">📌 ${intraday
      ? `现在是 ${dataDate} ${snap.time}，A 股仍在交易，本单所有市值与盈亏按<b>盘中最新价</b>计算，收盘前还会变动；15:00 收盘后重跑可得到当日最终版。`
      : gapDays > 1
        ? `本单价格即 ${dataDate} 收盘价，${gapDays - 1} 天休市期间不会变动；长期有效委托会在 ${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30 开盘后按当时价格撮合。`
        : `本单价格即 ${dataDate} 收盘价；下一交易日 ${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30 开盘。`}<br>
      口径：总资产 = 练习金余额 + 持仓市值；累计盈亏 = 持仓浮盈亏 + 已实现盈亏；与「资产页」一致，不含钱包里的充值 / 赠送学元。</div>
    <div class="p-foot"><div>行情来自东方财富公开接口 · 学元证券为教学模拟盘，仅供学习，不构成投资建议<br>红涨绿跌 · 单位：学元 · 价格取 ${intraday ? '盘中最新' : '收盘最后真实'}价</div>
      <div style="text-align:right">${intraday
        ? `<b>今日 15:00 收盘</b><br>收盘后重跑可得最终数字<br>快照 ${snap.time}`
        : `<b>${gapDays > 1 ? `休市 ${gapDays - 1} 天` : '下一交易日'}</b><br>${nextDay.slice(5)}（周${wdChar(nextDay)}）09:30<br>导出 ${nowSnap.date} ${nowSnap.time}`}</div></div>
  </div>`;
}

// ---------------------------------------------------------------- CSV
// 用户可能正在编辑器 / Excel 里打开上一轮导出的 CSV（Windows 会锁文件）。
// 内容相同就跳过；被占用就保留原文件（收盘价不变，只是快照时间不同），绝不强行覆盖。
const writeText = (file, data, label) => {
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === data) return;
    writeFileSync(file, data, 'utf8');
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      if (existsSync(file)) {
        console.log(`  · ${label} 正被其他程序打开，已保留原文件（同一收盘价，数据未变）`);
        return;
      }
      const alt = file.replace(/\.csv$/, '-new.csv');
      writeFileSync(alt, data, 'utf8');
      console.log(`  · ${label} 目标被占用，改写到 ${alt.split(/[\\/]/).pop()}`);
      return;
    }
    throw e;
  }
};

const csvHeader = ['代码', '名称', '板块', '现价', '昨收', '今开', '最高', '最低', '涨跌额', '涨跌幅%', '成交量(手)', '成交额(元)', '快照时间'];
const csvLines = [csvHeader.join(',')].concat(sorted.map(q => [
  q.code, q.name, q.sector, fmt(q.price), fmt(q.prev), fmt(q.open), fmt(q.high), fmt(q.low),
  signed(q.change), signed(q.pct), q.volume, q.amount, snap.date + ' ' + snap.time
].join(',')));
writeText(join(outDir, '行情数据-' + dataDate + '.csv'), '\ufeff' + csvLines.join('\r\n'), '行情数据 CSV');

const cell = v => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const userCsv = [['名次', '学号', '姓名', '昵称', '总资产', '可用练习金', '冻结', '持仓市值', '净投入',
  '累计盈亏', '收益率%', '今日盈亏', '已实现盈亏', '持仓浮盈亏', '累计成交', '累计费用', '成就数', '持仓只数', '今日成交', '今日费用'].join(',')]
  .concat(users.map(u => [u.rank, u.uid, u.name, u.net_name, fmt(u.total), fmt(u.available), fmt(u.frozen),
    fmt(u.mv), fmt(u.invested), fmt(u.pnl), fmt(u.ret), fmt(u.today_pnl), fmt(u.realized),
    fmt(u.position_pnl), u.trades, fmt(u.fee), u.ach, u.positions.length, u.today_trades, fmt(u.today_fee)].map(cell).join(',')));
writeText(join(outDir, '各用户数据-' + dataDate + '.csv'), '\ufeff' + userCsv.join('\r\n'), '各用户数据 CSV');

const posCsv = [['学号', '姓名', '代码', '名称', '数量', '成本价', '成本额', '现价', '今日涨跌%', '市值', '浮盈亏', '盈亏%', '持有天数'].join(',')]
  .concat(users.flatMap(u => u.positions.map(p => [u.uid, u.name, p.code, p.name, p.qty,
    fmt(p.avg_cost), fmt(p.cost), fmt(p.price), fmt(p.change_pct), fmt(p.mv), fmt(p.pnl), fmt(p.pnl_pct), p.hold_days].map(cell).join(','))));
writeText(join(outDir, '各用户持仓明细-' + dataDate + '.csv'), '\ufeff' + posCsv.join('\r\n'), '持仓明细 CSV');

if (peer) {
  const duelCsv = [['班级', '名次', '身份', '总资产', '累计盈亏', '收益率%'].join(',')]
    .concat(duelPlayers.slice(0, 10).map((p, i) => [localClass + '班', i + 1, p.name + '(' + p.uid + ')', fmt(p.total), fmt(p.pnl), fmt(p.ret)].map(cell).join(',')))
    .concat(peer.top.slice(0, 10).map((p, i) => [peer.class_no + '班', i + 1, p.net_name, fmt(p.total_asset), fmt(p.pnl), fmt(p.return_pct)].map(cell).join(',')));
  duelCsv.push([peer.class_no + '班', '', '汇总', '', '', ''].join(','));
  duelCsv.push(['对端', '', 'participants/avg_return', peer.participants, '', peer.avg_return].join(','));
  writeText(join(outDir, '跨班对决-' + dataDate + '.csv'), '\ufeff' + duelCsv.join('\r\n'), '跨班对决 CSV');
}

// ---------------------------------------------------------------- 渲染 PNG
const specs = [
  { name: '01-行情总览.png', html: page1 },
  { name: '02-本周走势.png', html: page2 },
  { name: '03-全部行情明细-上.png', html: detailPages[0] },
  { name: '04-全部行情明细-下.png', html: detailPages[1] },
  { name: '05-各用户情况总览.png', html: page5 },
  { name: '06-各用户持仓明细-上.png', html: userDetailPages[0] },
  { name: '07-各用户持仓明细-下.png', html: userDetailPages[1] }
];
if (page8) specs.push({ name: '08-跨班对决.png', html: page8 });

if (!existsSync(CHROME)) { console.error('找不到 Chrome：' + CHROME); process.exit(1); }

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(ROOT, '.workbuddy', 'tmp', 'stock-export', 'chrome-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--hide-scrollbars', '--force-color-profile=srgb', `--window-size=${W},1000`, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();

let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(300); } }
if (!ver) { console.error('✗ Chrome 未启动'); chrome.kill(); process.exit(1); }

let target = null;
for (let i = 0; i < 40; i++) {
  target = (await getJSON('/json/list')).find(t => t.type === 'page');
  if (target) break; await sleep(300);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: DPR, mobile: false });

console.log('\n=== 学元证券行情导出 ===');
console.log(`数据：${dataDate} ${intraday ? `盘中（未收盘）· 指数实时取东财` : '收盘'} · ${quotes.length} 只 / ${sectorStats.length} 板块 · 快照 ${snap.date} ${snap.time}`);
console.log(`输出：${outDir}\n`);

for (const s of specs) {
  const htmlPath = join(htmlDir, s.name.replace(/\.png$/, '.html'));
  writeFileSync(htmlPath, s.html, 'utf8');
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    ready = await evalJS(`document.readyState === 'complete' && !!document.querySelector('.page')`);
    if (ready) break;
  }
  if (!ready) throw new Error('页面未就绪：' + s.name);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: DPR, mobile: false });
  const h = await evalJS(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) + 8`);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: DPR, mobile: false });
  await sleep(220);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(outDir, s.name), Buffer.from(shot.data, 'base64'));
  console.log(`  ✓ ${s.name}  ${W * DPR}×${h * DPR}px  (${Math.round(Buffer.from(shot.data, 'base64').length / 1024)} KB)`);
}

// ---------------------------------------------------------------- 每人一张卡
// 分批渲染：49 张卡叠成一页会超过 Chrome 截图表面上限，每 6 张一批最稳。
if (!argv.includes('--no-personal')) {
  const perUserDir = join(outDir, 'per-user');
  mkdirSync(perUserDir, { recursive: true });
  // 清掉上一轮留下的卡（改过名单后旧卡会残留，如已剔除的开发账号）
  for (const f of readdirSync(perUserDir)) {
    if (/\.png$/i.test(f)) unlinkSync(join(perUserDir, f));
  }
  const PW = 1040, BATCH = 6;
  let made = 0;
  for (let s = 0; s < users.length; s += BATCH) {
    const batch = users.slice(s, s + BATCH);
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>个人账单</title><style>${PCSS}</style></head><body>${batch.map(personalCard).join('')}</body></html>`;
    const htmlPath = join(htmlDir, 'per-user-' + (s / BATCH + 1) + '.html');
    writeFileSync(htmlPath, html, 'utf8');
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(120);
      ready = await evalJS(`document.readyState === 'complete' && document.querySelectorAll('.pcard').length === ${batch.length}`);
      if (ready) break;
    }
    if (!ready) throw new Error('个人卡批次未就绪 @' + s);
    await send('Emulation.setDeviceMetricsOverride', { width: PW, height: 1000, deviceScaleFactor: DPR, mobile: false });
    const ph = await evalJS(`document.documentElement.scrollHeight + 20`);
    await send('Emulation.setDeviceMetricsOverride', { width: PW, height: ph, deviceScaleFactor: DPR, mobile: false });
    await sleep(180);
    const rects = await evalJS(`[...document.querySelectorAll('.pcard')].map(function(el){var r=el.getBoundingClientRect();return {x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:r.height,uid:el.dataset.uid,name:el.dataset.name};})`);
    for (const r of rects) {
      const shot = await send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: true,
        clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 }
      });
      writeFileSync(join(perUserDir, r.uid + '-' + safeName(r.name) + '.png'), Buffer.from(shot.data, 'base64'));
      made++;
    }
  }
  console.log(`  ✓ per-user/  ${made} 张个人卡（2000px 宽，按学号-姓名命名）`);
}

ws.close();
chrome.kill();
console.log(`\n  ✓ CSV：行情 ${quotes.length} 行 / 各用户 ${users.length} 行 / 持仓明细 ${classStats.posCount} 行${peer ? ` / 跨班对战报 20 行（vs ${parseInt(peer.class_no, 10)} 班）` : ''}`);
console.log(intraday
  ? '\n完成。⚠️ 现在是盘中数据，价格仍在变动；15:00 收盘后重跑本脚本即可得到当日收盘版。'
  : '\n完成。图片可直接发群 / 打印 / 单独发给本人。');
