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
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
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

const reports = db.prepare('SELECT date_key, payload_json FROM stock_daily_report ORDER BY date_key').all()
  .map(r => ({ ...JSON.parse(r.payload_json), date_key: r.date_key }));
const latest = reports[reports.length - 1];
const quoteTs = Math.max(...quotes.map(q => q.quoted_at));

const tradeByDate = {};
for (const r of db.prepare('SELECT trade_date, COUNT(*) n, COUNT(DISTINCT user_id) u FROM stock_trades GROUP BY trade_date').all()) {
  tradeByDate[r.trade_date] = { n: r.n, users: r.u };
}

const bj = ts => {
  const d = new Date(ts + 8 * 3600 * 1000);
  const p = n => (n < 10 ? '0' : '') + n;
  return {
    date: d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()),
    time: p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()),
    weekday: '日一二三四五六'[d.getUTCDay()]
  };
};
const snap = bj(quoteTs);
const dataDate = latest.date_key;
const outDir = outArg >= 0 ? argv[outArg + 1] : join(ROOT, 'exports', 'stock-' + dataDate);
const htmlDir = join(ROOT, '.workbuddy', 'tmp', 'stock-export', 'html');
mkdirSync(outDir, { recursive: true });
mkdirSync(htmlDir, { recursive: true });

const up = quotes.filter(q => q.pct > 0).length;
const down = quotes.filter(q => q.pct < 0).length;
const flat = quotes.length - up - down;
const avgPct = r2(quotes.reduce((s, q) => s + q.pct, 0) / quotes.length);
const totalAmount = quotes.reduce((s, q) => s + q.amount, 0);
const sorted = [...quotes].sort((a, b) => b.pct - a.pct);

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

const accountRows = db.prepare(`SELECT a.user_id, a.balance, a.practice_balance, a.frozen_practice,
    s.realized_cent, s.fee_total_cent, s.trade_count, u.real_name, u.net_name
  FROM xy_account a JOIN stock_account s ON s.user_id = a.user_id
  LEFT JOIN users u ON u.user_id = a.user_id
  WHERE a.user_id NOT LIKE '@%'`).all();

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

  const practice = a.practice_balance || 0;
  const pnlCent = (mvCent - costCent) + (a.realized_cent || 0);
  const f = flowMap[a.user_id] || { buy_out: 0, sell_in: 0 };
  const invested = practice + f.buy_out - f.sell_in;
  const agg = todayAggMap[a.user_id] || { n: 0, fee: 0 };
  return {
    uid: a.user_id,
    name: a.real_name || a.net_name || a.user_id,
    net_name: a.net_name || '',
    practice: practice / 100,
    frozen: (a.frozen_practice || 0) / 100,
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
  posCount: posRows.length
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

function header(title, sub, badge) {
  return `<div class="hd"><div><div class="brand"><i>学元</i>证券 <small>${esc(title)}</small></div><div class="sub">${sub}</div></div>
  <div class="stamp"><b>${badge}</b><br>数据截止 ${dataDate}（周五）收盘<br>快照 ${snap.date} ${snap.time} · 136 只 / 27 板块</div></div>`;
}

const footer = (extra = '') => `<div class="foot"><div>${extra}行情来自东方财富公开接口，学元证券为教学模拟盘，数据仅供学习，不构成投资建议。<br>红涨绿跌 · 价格为真实 A 股行情（元）· 成交额为真实市场数据</div><div style="text-align:right"><b>周末 11/07–11/08 休市</b><br>下一交易日 11/09（周一）09:30 开盘<br>导出时间 ${snap.date} ${snap.time}（北京时间）</div></div>`;

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
const weekTrades = reports.reduce((s, r) => s + (tradeByDate[r.date_key] ? tradeByDate[r.date_key].n : 0), 0);
const page1 = page(header('周末行情速览', '最近一个交易日 = 周五收盘；周末休市，价格保持不变，周一开盘前可直接对照', '周末带回家 · 离线可看') + `
  <div class="grid3">${idxCards}</div>
  <div class="panel"><div class="pt">市场宽度 <span>按股票池 136 只等权统计 · ${dataDate} 收盘</span></div>
    <div class="breadth"><i style="width:${fmt(up / quotes.length * 100, 2)}%;background:var(--up)"></i><i style="width:${fmt(flat / quotes.length * 100, 2)}%;background:#4a5568"></i><i style="width:${fmt(down / quotes.length * 100, 2)}%;background:var(--down)"></i></div>
    <div class="breadth-l"><span><b class="up num">${up}</b> 只上涨 &nbsp;· <b class="flat num">${flat}</b> 只平盘 &nbsp;· <b class="down num">${down}</b> 只下跌</span>
    <span>平均涨跌 <b class="num ${cls(avgPct)}">${signed(avgPct)}%</b> &nbsp;· 合计成交额 <b class="num">${money(totalAmount)}</b></span></div>
  </div>
  <div class="cols">
    <div class="col"><div class="panel"><div class="pt" style="color:var(--up)">涨幅榜 TOP 8 <span>收盘涨幅</span></div><table><thead><tr><th>股票</th><th>现价</th><th>涨跌幅</th></tr></thead><tbody>${rankedRows(sorted.slice(0, 8))}</tbody></table></div></div>
    <div class="col"><div class="panel"><div class="pt" style="color:var(--down)">跌幅榜 TOP 8 <span>收盘跌幅</span></div><table><thead><tr><th>股票</th><th>现价</th><th>涨跌幅</th></tr></thead><tbody>${rankedRows(sorted.slice(-8).reverse())}</tbody></table></div></div>
  </div>
  <div class="panel"><div class="pt">板块表现 <span>27 个板块 · 等权平均涨跌幅 / 上涨家数</span></div>
    <div class="cols"><div class="col">${sectorRows(sectorStats.slice(0, 14))}</div><div class="col">${sectorRows(sectorStats.slice(14))}</div></div>
  </div>
  <div class="note">📌 <b>周末提示</b>：11/07（周六）、11/08（周日）A 股休市，本图价格即为周五收盘价，不会变动；长期有效委托会在周一开盘后按当时价格撮合。<br>
  本班本周（11/03–11/06）共成交 <b>${weekTrades}</b> 笔，周五 <b>${(tradeByDate[dataDate] || {}).n || 0}</b> 笔 / <b>${(tradeByDate[dataDate] || {}).users || 0}</b> 人参与；最热门：${hot.map(h => esc(h.name) + ' ' + h.n + ' 笔').join('、') || '—'}。
  ${esc(latest.comment || '')}</div>
  ${footer('')}
`, '01 行情总览');

// ---------------------------------------------------------------- 页面 2：本周走势
function lineChart() {
  const w = 1310, h = 300, L = 54, R = 24, T = 22, B = 34;
  const series = [0, 1, 2].map(i => {
    const base = reports[0].indexes[i].price;
    return reports.map(r => ({ v: r2((r.indexes[i].price / base - 1) * 100), d: r.date_key }));
  });
  const all = series.flat().map(p => p.v);
  let lo = Math.min(...all, 0), hi = Math.max(...all, 1);
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const X = i => L + i * (w - L - R) / (reports.length - 1);
  const Y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  let g = '';
  for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) {
    const zero = v === 0;
    g += `<line x1="${L}" y1="${fmt(Y(v), 1)}" x2="${w - R}" y2="${fmt(Y(v), 1)}" stroke="${zero ? '#5a6883' : '#202a3a'}" stroke-width="1"${zero ? ' stroke-dasharray="5 4"' : ''}/>`;
    g += `<text x="${L - 10}" y="${fmt(Y(v) + 4, 1)}" fill="#8b98ad" font-size="12" text-anchor="end" font-family="Consolas,monospace">${v > 0 ? '+' : ''}${v}%</text>`;
  }
  reports.forEach((r, i) => {
    g += `<text x="${fmt(X(i), 1)}" y="${h - 10}" fill="#8b98ad" font-size="12" text-anchor="middle">${r.date_key.slice(5)} 周${'二三四五'[i] || ''}</text>`;
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
  v: r2((latest.indexes[i].price / reports[0].indexes[i].price - 1) * 100),
  color: idxColors[i]
}));
const upRatio = reports.map(r => r.up_count + r.down_count ? r.up_count / (r.up_count + r.down_count) * 100 : 0);
const tradeCounts = reports.map(r => (tradeByDate[r.date_key] || {}).n || 0);
const dayLabels = reports.map(r => r.date_key.slice(5));

const dayRows = reports.slice().reverse().map(r => {
  const t = tradeByDate[r.date_key] || { n: 0, users: 0 };
  const ix = r.indexes.map(i => `<span class="num ${cls(i.change_pct)}">${signed(i.change_pct)}%</span>`).join(' / ');
  const g0 = r.gainers && r.gainers[0], l0 = r.losers && r.losers[0];
  return `<tr><td class="num nowrap">${r.date_key}</td><td class="nowrap">${ix}</td><td class="num nowrap">${r.up_count} : ${r.down_count}</td>
    <td class="nowrap">${g0 ? esc(g0.name) + ' <span class="up num">' + signed(g0.change_pct) + '%</span>' : '—'}</td>
    <td class="nowrap">${l0 ? esc(l0.name) + ' <span class="down num">' + signed(l0.change_pct) + '%</span>' : '—'}</td>
    <td class="num nowrap">${t.n} / ${t.users}</td><td class="lcol" style="color:var(--muted)">${esc(r.comment || '')}</td></tr>`;
}).join('');

const page2 = page(header('本周大盘走势', '11/03 – 11/06 共 4 个交易日 · 指数以周一收盘为基准的累计涨跌幅', '本周回顾') + `
  <div class="panel"><div class="pt">三大指数 · 本周累计涨跌 <span>以 ${reports[0].date_key} 收盘点位 = 0%</span></div>
    ${lineChart()}
    <div class="legend"><span><i style="background:#e2b45e"></i>上证指数</span><span><i style="background:#5b9dff"></i>深证成指</span><span><i style="background:#c08bff"></i>创业板指</span>
    <span style="margin-left:auto;color:var(--muted)">周五收盘较周一：</span>${endVals.map(e => `<span><i style="background:${e.color}"></i>${e.name} <b class="num ${cls(e.v)}">${signed(e.v)}%</b></span>`).join('')}</div>
  </div>
  <div class="cols">
    <div class="col"><div class="panel"><div class="pt">每日上涨占比 <span>上涨家数 / (涨 + 跌)</span></div>${barChart(upRatio, dayLabels, '#ff5257', '%', 100)}</div></div>
    <div class="col"><div class="panel"><div class="pt">本班每日成交笔数 <span>笔 / 参与人数见下表</span></div>${barChart(tradeCounts, dayLabels, '#e2b45e', '')}</div></div>
  </div>
  <div class="panel"><div class="pt">每日看点 <span>收盘报告 + 班级成交</span></div>
    <table><thead><tr><th class="nowrap">日期</th><th class="nowrap">上证 / 深成 / 创业板</th><th class="nowrap">涨 : 跌</th><th class="nowrap">领涨</th><th class="nowrap">领跌</th><th class="nowrap">成交/人</th><th class="lcol">当日点评</th></tr></thead><tbody>${dayRows}</tbody></table>
  </div>
  <div class="note">📌 <b>本周脉络</b>：周二普涨、周五回吐，三大指数全周仍收涨，创业板波动最大。<br>
  <b>读图提醒</b>：股票池 11/05 从 67 只扩容到 136 只，因此前两日的「涨 : 跌」家数与后两日不可直接比较，看「上涨占比」更稳妥。<br>
  周五收盘：${esc(latest.comment || '')} ${esc(latest.tip || '')}</div>
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
  return page(header('全部行情明细 ' + (i + 1) + '/2', `按板块分组 · 本页 ${bucket.length} 个板块 / ${codes} 只 · 现价、涨跌额、涨跌幅均为周五收盘`, '离线存档') + `
    <div class="note" style="margin-bottom:14px">📖 <b>怎么看</b>：红=涨、绿=跌；「现价」是周五收盘的最后真实价，「涨跌」相对前收盘价。板块标题右侧为该板块等权平均涨跌幅。两页合计覆盖全部 136 只可交易股票。</div>
    <div class="cards">${bucket.map(cardHtml).join('')}</div>
    ${footer('')}
  `, '0' + (3 + i) + ' 行情明细');
});

// ---------------------------------------------------------------- 页面 5/6/7：各用户具体情况
const n2 = v => fmt(v, 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const sn2 = v => (v > 0 ? '+' : '') + n2(v);
const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '').trim() || 'user';

const userFooter = () => `<div class="foot"><div>口径：证券账户 = 练习金池，总资产 = 练习金余额 + 持仓市值；累计盈亏 = 持仓浮盈亏 + 已实现盈亏；收益率 = 累计盈亏 / 净投入。<br>与学生在「资产页」看到的数字一致；不含钱包里的充值 / 赠送学元。教学模拟盘，不构成投资建议。</div>
  <div style="text-align:right"><b>周末 11/07–11/08 休市</b><br>下一交易日 11/09（周一）09:30 开盘<br>导出时间 ${snap.date} ${snap.time}（北京时间）</div></div>`;

const userRow = u => `<tr>
  <td class="num">${u.rank}</td><td class="num">${u.uid}</td><td>${esc(u.name)}</td>
  <td class="num">${n2(u.total)}</td><td class="num">${n2(u.practice)}</td><td class="num">${n2(u.mv)}</td>
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
      : `<div class="empty">空仓 · 可用练习金 ${n2(u.practice)} 学元（尚未买入，或已全部卖出）</div>`}
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
  `本页 ${bucket.length} 人 · 每只持仓的成本、现价、市值与浮动盈亏（周五收盘价）`, '一人一格') + `
  <div class="note" style="margin-bottom:14px">📖 <b>怎么看</b>：成本价含买入手续费；浮盈亏 = 现价×数量 − 成本；红=赚、绿=亏。空仓同学只显示可用练习金。两页合计 ${classStats.n} 人 / ${classStats.posCount} 条持仓。</div>
  <div class="ucards">${bucket.map(userCard).join('')}</div>
  ${userFooter()}
`, '0' + (6 + i) + ' 各用户持仓明细'));

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
      : `今天成交 ${u.today_trades} 笔、费用 ${fmt(u.today_fee)} 学元，收盘前花两分钟复盘：每一笔都有理由吗？`;
  const cells = [
    ['可用练习金', n2(u.practice)], ['冻结', n2(u.frozen)], ['持仓市值', n2(u.mv)],
    ['净投入', n2(u.invested)], ['已实现盈亏', sn2(u.realized)],
    ['持仓浮盈亏', sn2(u.position_pnl)], ['累计成交', u.trades + ' 笔'],
    ['累计费用', n2(u.fee)], ['成就', u.ach + ' 项'], ['持仓只数', u.positions.length + ' 只']
  ];
  return `<div class="pcard" data-uid="${u.uid}" data-name="${esc(u.name)}">
    <div class="p-hd"><div><div class="p-brand"><i>学元</i>证券 · 周末个人账单</div>
      <div class="p-title">${esc(u.name)} <small class="num">${u.uid}</small></div></div>
      <div class="p-stamp"><b>${dataDate} 周五收盘</b><br>全班第 ${u.rank} / ${classStats.n} 名<br>快照 ${snap.date} ${snap.time}</div></div>
    <div class="p-hero">
      <div><span>证券账户总资产</span><b class="num">${n2(u.total)}</b><small>学元</small></div>
      <div><span>累计盈亏</span><b class="num ${cls(u.pnl)}">${sn2(u.pnl)}</b></div>
      <div><span>收益率</span><b class="num ${cls(u.ret)}">${signed(u.ret)}%</b></div>
      <div><span>今日盈亏</span><b class="num ${cls(u.today_pnl)}">${sn2(u.today_pnl)}</b></div>
    </div>
    <div class="p-grid">${cells.map(c => `<div>${c[0]}<b class="num">${c[1]}</b></div>`).join('')}</div>
    <div class="p-sec"><h3>持仓明细（${u.positions.length} 只 · 周五收盘价估值）</h3>
      ${u.positions.length
        ? `<table><thead><tr><th>股票</th><th>数量</th><th>成本价</th><th>现价</th><th>今日</th><th>成本额</th><th>市值</th><th>浮盈亏</th><th>盈亏%</th><th>持有天</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div style="font-size:12.5px;color:var(--muted);padding:6px 2px">当前空仓 · 可用练习金 ${n2(u.practice)} 学元。周末休市，周一开盘后可以按新价格挂单。</div>`}
    </div>
    <div class="p-sec"><h3>今日复盘</h3><div style="font-size:12.5px;color:#b9c4d4;line-height:1.8">${tip}<br>
      累计成交 ${u.trades} 笔，累计费用 ${n2(u.fee)} 学元；已实现盈亏 <span class="num ${cls(u.realized)}">${sn2(u.realized)}</span>，持仓浮盈亏 <span class="num ${cls(u.position_pnl)}">${sn2(u.position_pnl)}</span>。</div></div>
    <div class="p-note">📌 11/07（周六）、11/08（周日）A 股休市，本单价格即周五收盘价，不会变动；长期有效委托会在周一 09:30 开盘后按当时价格撮合。<br>
      口径：总资产 = 练习金余额 + 持仓市值；累计盈亏 = 持仓浮盈亏 + 已实现盈亏；与「资产页」一致，不含钱包里的充值 / 赠送学元。</div>
    <div class="p-foot"><div>行情来自东方财富公开接口 · 学元证券为教学模拟盘，仅供学习，不构成投资建议<br>红涨绿跌 · 单位：学元 · 价格取周五收盘最后真实价</div>
      <div style="text-align:right"><b>周末休市 11/07–11/08</b><br>下一交易日 11/09（周一）09:30<br>导出 ${snap.date} ${snap.time}</div></div>
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
  .concat(users.map(u => [u.rank, u.uid, u.name, u.net_name, fmt(u.total), fmt(u.practice), fmt(u.frozen),
    fmt(u.mv), fmt(u.invested), fmt(u.pnl), fmt(u.ret), fmt(u.today_pnl), fmt(u.realized),
    fmt(u.position_pnl), u.trades, fmt(u.fee), u.ach, u.positions.length, u.today_trades, fmt(u.today_fee)].map(cell).join(',')));
writeText(join(outDir, '各用户数据-' + dataDate + '.csv'), '\ufeff' + userCsv.join('\r\n'), '各用户数据 CSV');

const posCsv = [['学号', '姓名', '代码', '名称', '数量', '成本价', '成本额', '现价', '今日涨跌%', '市值', '浮盈亏', '盈亏%', '持有天数'].join(',')]
  .concat(users.flatMap(u => u.positions.map(p => [u.uid, u.name, p.code, p.name, p.qty,
    fmt(p.avg_cost), fmt(p.cost), fmt(p.price), fmt(p.change_pct), fmt(p.mv), fmt(p.pnl), fmt(p.pnl_pct), p.hold_days].map(cell).join(','))));
writeText(join(outDir, '各用户持仓明细-' + dataDate + '.csv'), '\ufeff' + posCsv.join('\r\n'), '持仓明细 CSV');

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
console.log(`数据：${dataDate} 收盘 · ${quotes.length} 只 / ${sectorStats.length} 板块 · 快照 ${snap.date} ${snap.time}`);
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
  const PW = 1040, BATCH = 6;
  let made = 0;
  for (let s = 0; s < users.length; s += BATCH) {
    const batch = users.slice(s, s + BATCH);
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>周末个人账单</title><style>${PCSS}</style></head><body>${batch.map(personalCard).join('')}</body></html>`;
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
console.log(`\n  ✓ CSV：行情 ${quotes.length} 行 / 各用户 ${users.length} 行 / 持仓明细 ${classStats.posCount} 行`);
console.log('\n完成。周末休市，图片可直接发群 / 打印 / 单独发给本人。');
