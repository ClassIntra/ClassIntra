#!/usr/bin/env node
// ClassIntra · 全维度系统体检门禁
// ============================================================
// 只用 Node 内置模块：不装依赖、不连数据库、不改任何文件、不启动服务。
// 设计约束来自 .github/workflows/kernel-ci.yml —— CI 额度按分钟计，这条要 <10s。
//
// 用法：
//   node scripts/system-audit.mjs              # 有 FAIL 时退出码 1
//   node scripts/system-audit.mjs --strict     # WARN 也算失败（上线前用）
//   node scripts/system-audit.mjs --json       # 结构化输出，供看板消费
//
// 维度：资金完整性 / 凭据与日志 / 事件可靠性 / Chrome80 与主题 /
//       工程质量 / 错误态与可观测性。每维都要能指向具体文件，不做主观打分。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

const checks = [];
function add(dim, name, pass, detail, level) {
  checks.push({
    dim,
    name,
    status: pass ? 'PASS' : (level || 'FAIL'),
    detail: detail || ''
  });
}
function info(dim, name, detail) {
  checks.push({ dim, name, status: 'INFO', detail: detail || '' });
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; }
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
function posOf(text, needle) {
  const i = text.indexOf(needle);
  return i === -1 ? Infinity : i;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'logs', 'backup', 'Resources',
  'exports', '.workbuddy', '.vite', 'screenshots', 'archive'
]);
const SCAN_EXT = ['.js', '.mjs', '.cjs', '.vue', '.css', '.scss'];
function scan(relDirs) {
  const out = [];
  function walk(abs, rel) {
    let items;
    try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      if (it.name.startsWith('.') || SKIP_DIRS.has(it.name)) continue;
      const a = path.join(abs, it.name);
      const r = rel + '/' + it.name;
      if (it.isDirectory()) walk(a, r);
      else if (it.isFile() && SCAN_EXT.some(function (x) { return it.name.endsWith(x); })) out.push(r);
    }
  }
  relDirs.forEach(function (d) { walk(path.join(ROOT, d), d); });
  return out;
}
const FRONT = ['client/src', 'apps', 'market-apps', 'shared'];
const BACK = ['server/src', 'server/scripts', 'scripts'];
const frontFiles = scan(FRONT);
// 排除自身：脚本里含有 `inset:` / `SELECT *` 等**检测用**字面量，
// 扫到自己会造成自指误报（首跑就因此误判过一次 FAIL）。
const backFiles = scan(BACK).filter(function (r) { return r !== 'scripts/system-audit.mjs'; });

// ============================================================
// 1. 资金完整性
// ============================================================
const pkg = (function () {
  try { return JSON.parse(read('server/package.json')); } catch (e) { return {}; }
})();
const testLedger = String((pkg.scripts && pkg.scripts['test:ledger']) || '');
const ledgerScripts = testLedger.split('&&').map(function (s) { return s.trim(); }).filter(Boolean);
add('资金完整性', 'test:ledger 覆盖 ≥22 个脚本', ledgerScripts.length >= 22,
  ledgerScripts.length + ' 个');
add('资金完整性', '加固验收脚本在门禁内', testLedger.indexOf('scripts-test-ledger-hardening.cjs') !== -1);

const migrations = (function () {
  try { return fs.readdirSync(path.join(ROOT, 'server/src/migrations')).filter(function (f) { return f.endsWith('.js'); }); }
  catch (e) { return []; }
})();
const versions = [];
migrations.forEach(function (f) {
  const m = read('server/src/migrations/' + f).match(/version\s*:\s*(\d+)/);
  if (m) versions.push(Number(m[1]));
});
const dup = versions.filter(function (v, i) { return versions.indexOf(v) !== i; });
add('资金完整性', '迁移版本号无撞号', dup.length === 0,
  '最大 v' + Math.max.apply(null, versions.concat([0])) + '，共 ' + versions.length + ' 个');

const schema = read('server/src/ledger/schema.sql');
const mig046 = read('server/src/migrations/046_ledger_hardening_v2.js');
const NEW_TABLES = [
  'xy_ledger_tx_seals', 'xy_ledger_chain_state', 'xy_ledger_post_attempts',
  'xy_ledger_reconcile_runs', 'xy_ledger_reconcile_diffs',
  'xy_ledger_supply_state', 'xy_ledger_bridge_receipts'
];
const missingTables = NEW_TABLES.filter(function (t) { return schema.indexOf(t) === -1 || mig046.indexOf(t) === -1; });
add('资金完整性', 'schema.sql 与迁移 046 的 7 张表一致', missingTables.length === 0,
  missingTables.length ? missingTables.join(', ') : '7/7');

const initDb = read('server/src/utils/init-db.js');
add('资金完整性', '名单文件读失败时不清空 pre_records',
  posOf(initDb, 'if (!preRecordsLoaded)') < posOf(initDb, "db.exec('DELETE FROM pre_records')") &&
  initDb.indexOf('preRecordsLoaded = true') !== -1);

// ============================================================
// 1.5 财政权限（组网从班封锁一致性）
// ============================================================
const ledgerRoutes = read('server/src/routes/ledger.js');
const xueyuanRoutes = read('server/src/routes/xueyuan.js');
const treasuryMw = read('server/src/middleware/treasury.js');
const bridge = read('server/src/routes/cluss-bridge.js');
add('财政权限', 'treasury 判定单一真相源',
  treasuryMw.indexOf('function requireTreasury') !== -1 &&
  xueyuanRoutes.indexOf("require('../middleware/treasury')") !== -1 &&
  xueyuanRoutes.indexOf('function requireTreasury') === -1);
add('财政权限', '/api/xy 无裸 auth.requireAdmin', !/auth\.requireAdmin/.test(ledgerRoutes));
add('财政权限', '发钱端点挂 requireTreasury',
  /router\.post\('\/issue',\s*treasury\.requireTreasury/.test(ledgerRoutes));
add('财政权限', '管理员越权动作被单独拦截',
  ledgerRoutes.indexOf('treasury.treasuryForAdmins') !== -1 &&
  ledgerRoutes.indexOf('router.use(function (req, res, next)') !== -1);
add('财政权限', 'Cluss 桥额度原子化 + 统计 fail-closed',
  bridge.indexOf('creditTx.immediate()') !== -1 && bridge.indexOf('{ strict: true }') !== -1);
add('财政权限', '专项验收脚本已进门禁',
  testLedger.indexOf('scripts-test-treasury-guard.cjs') !== -1);

// ============================================================
// 2. 凭据与日志
// ============================================================
const appJs = read('server/src/app.js');
const appHttps = read('server/src/app-https.js');
add('凭据与日志', '访问日志不裸记 :url（token 脱敏）',
  appJs.indexOf("morgan.token('safe-url'") !== -1 && !/morgan\([^)]*:url[^)]*\)/.test(appJs));
add('凭据与日志', 'dotenv 显式钉到 server/.env',
  appJs.indexOf("require('dotenv').config({ path:") !== -1 &&
  appHttps.indexOf("require('dotenv').config({ path:") !== -1);
const gitignore = read('.gitignore');
add('凭据与日志', '.env 已被忽略',
  gitignore.indexOf('.env') !== -1);

// ============================================================
// 3. 事件可靠性
// ============================================================
const relayBus = read('server/src/utils/relay-bus.js');
add('事件可靠性', 'relay 去重标记在 handler 成功之后',
  posOf(relayBus, 'config.handler(payload, ctx)') <
  posOf(relayBus, 'processedRelayMsgIds[relayMsgId] = true'));
const emitter = read('server/src/integrations/emit.js');
const dispatcher = read('server/src/integrations/outbound-dispatcher.js');
add('事件可靠性', '未登记事件拒绝越权外发',
  emitter.indexOf('if (!scope)') !== -1 && dispatcher.indexOf('if (!requiredScope)') !== -1);
add('事件可靠性', '出站投递结果链有 catch 与超时',
  dispatcher.indexOf('AbortSignal.timeout') !== -1 && /all\.then\([\s\S]*?\)\.catch\(/.test(dispatcher));
const dbJs = read('server/src/utils/db.js');
add('事件可靠性', 'SQL Statement 有缓存且可关闭',
  dbJs.indexOf('stmtCache') !== -1 && dbJs.indexOf('CI_SQL_CACHE') !== -1);
add('事件可靠性', '崩溃处理器 / 限流定时器防重复挂载',
  read('server/src/utils/crash-logger.js').indexOf('__ci_crash_handlers_installed__') !== -1 &&
  read('server/src/middleware/rate-limit.js').indexOf('__ci_rate_limit_cleanup_timer__') !== -1);

// ============================================================
// 4. Chrome 80 与主题
// ============================================================
let insetHits = [];
let whiteHits = 0;
let emptyCatch = 0;
let emptyState = 0;
let selectStar = 0;
for (const rel of frontFiles.concat(backFiles)) {
  const text = read(rel);
  if (!text) continue;
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (/\binset\s*:/.test(t) && !t.startsWith('inset: {')) insetHits.push(rel);
    if (/background(?:-color)?\s*:\s*#fff(?:fff)?\b/i.test(t)) whiteHits++;
  }
  emptyCatch += (text.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length;
  emptyState += (text.match(/\.catch\([^)]*\)\s*\.then\([\s\S]{0,220}?\|\|\s*\[\]/g) || []).length;
  selectStar += (text.match(/SELECT\s+\*/gi) || []).length;
}
add('Chrome80', '真实 inset 声明已清零', insetHits.length === 0,
  insetHits.length ? insetHits.slice(0, 4).join(', ') : '0 处');
const viteCfg = read('client/vite.config.mjs');
const mainJs = read('client/src/main.js');
add('Chrome80', 'flex gap 兜底不依赖 @supports 误判',
  viteCfg.indexOf('no-flex-gap') !== -1 && mainJs.indexOf('no-flex-gap') !== -1);
info('Chrome80', '刻意保留的纯白背景', whiteHits + ' 处（图标/二维码/第三方，见 system-excellence.md）');

// ============================================================
// 5. 工程质量
// ============================================================
const ci = read('.github/workflows/kernel-ci.yml');
add('工程质量', 'CI 纳入全维度门禁', ci.indexOf('system-audit.mjs') !== -1);
let logBytes = 0;
try {
  const logsAbs = path.join(ROOT, 'logs');
  const stack = [logsAbs];
  while (stack.length) {
    const d = stack.pop();
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) stack.push(p);
      else { try { logBytes += fs.statSync(p).size; } catch (e) {} }
    }
  }
} catch (e) {}
add('工程质量', '日志目录 < 200 MB', logBytes < 200 * 1024 * 1024,
  (logBytes / 1024 / 1024).toFixed(1) + ' MB', 'WARN');

let maxChunk = { name: '-', size: 0 };
try {
  const assets = path.join(ROOT, 'client/dist/assets');
  for (const f of fs.readdirSync(assets)) {
    if (!f.endsWith('.js')) continue;
    const s = fs.statSync(path.join(assets, f)).size;
    if (s > maxChunk.size) maxChunk = { name: f, size: s };
  }
} catch (e) {}
add('工程质量', '最大 JS chunk < 800 KB', maxChunk.size < 800 * 1024,
  maxChunk.name + ' ' + (maxChunk.size / 1024).toFixed(0) + ' KB', 'WARN');
info('工程质量', 'SELECT * 存量', selectStar + ' 处（历史技术债，新代码避免）');
add('工程质量', 'prepare 调用点有统一缓存', dbJs.indexOf('stmtCache') !== -1,
  '全仓 Statement 复用，CI_SQL_CACHE=0 可回退');

// ============================================================
// 6. 错误态与可观测性
// ============================================================
add('错误态', '空 catch 已清零', emptyCatch === 0, emptyCatch + ' 处', 'WARN');
add('错误态', 'catch 后静默置空数组已收敛', emptyState <= 2, emptyState + ' 处', 'WARN');
add('错误态', '账本失败留痕 + 结构化错误码',
  exists('server/src/ledger/errors.js') && exists('server/src/ledger/overview.js'));

// ============================================================
// 7. 用户触达（学生能不能真的看见）
// ============================================================
const desktopVue = read('client/src/views/Desktop.vue');
const chatVue = read('apps/chat/frontend/Chat.vue');
const walletVue = read('apps/wallet/frontend/Wallet.vue');
add('用户触达', '桌面首屏有学元钩子', desktopVue.indexOf('TodayXueyuanBar') !== -1);
add('用户触达', '聊天主动线能领津贴', chatVue.indexOf('claimDailyInChat') !== -1);
add('用户触达', '钱包空态给了下一步动作', walletVue.indexOf('给同学发红包') !== -1);
// 最关键的一条：源码改了却不 build，学生什么也看不到（前几轮就栽在这里）。
// TodayXueyuanBar 里的 localStorage key 会随编译保留，用它反查产物。
let distHasHook = false;
try {
  const assets = path.join(ROOT, 'client/dist/assets');
  const deskChunks = fs.readdirSync(assets).filter(function (f) { return /^Desktop-.*\.js$/.test(f); });
  distHasHook = deskChunks.some(function (f) {
    return fs.readFileSync(path.join(assets, f), 'utf8').indexOf('ci:txy:hidden') !== -1;
  });
} catch (e) {}
add('用户触达', '构建产物包含首屏钩子（改源码必须 build）', distHasHook);

// ============================================================
// 8. 聊天体验（私聊 99911 条是学生真正的主场）
// ============================================================
const chatX = read('apps/chat/frontend/chat-experience.js');
const chatTest = read('server/scripts-test-chat-experience.mjs');
const serverPkg = read('server/package.json');
const bubbleVue = read('client/src/components/ChatBubble.vue');
const previewVue = read('client/src/components/ImagePreview.vue');
add('聊天体验', '体验内核独立成文件且被 Chat.vue 引用',
  chatX.indexOf('createBotTyping') !== -1 && chatVue.indexOf("from './chat-experience.js'") !== -1);
add('聊天体验', '专项回归已纳入 test:chat',
  serverPkg.indexOf('test:chat') !== -1 && chatTest.indexOf('通过 ') !== -1);
add('聊天体验', '私聊可往上翻历史（不再停在最近 50 条）',
  chatVue.indexOf("kind: 'private'") !== -1 && chatVue.indexOf('scrollAnchor') !== -1);
add('聊天体验', '连打第二句不再被静默吞掉',
  chatVue.indexOf('sendDecision') !== -1 && chatVue.indexOf('_drainSendQueue') !== -1 &&
  bubbleVue.indexOf("status === 'queued'") !== -1);
add('聊天体验', 'AI 会话有本地等待指示且会超时熄灭',
  chatVue.indexOf('_startBotTyping') !== -1 && chatX.indexOf('timeoutMs') !== -1);
add('聊天体验', '已读回执可补报（拉取失败 / 重连 / 回前台）',
  chatVue.indexOf('sendMarkRead({ force: true })') !== -1 && chatVue.indexOf('createReadTracker') !== -1);
add('聊天体验', '拉不到 ≠ 没有：错误态带重试出口',
  chatVue.indexOf('retryLoadCurrentChat') !== -1 && chatVue.indexOf('emptyState') !== -1);
add('聊天体验', '平板有显式换行 + 全屏图片失败不白屏',
  chatVue.indexOf('insertNewlineAtCaret') !== -1 && previewVue.indexOf('onImageError') !== -1);
add('聊天体验', '表情回应有第一个入口（不再只有点已有徽章）',
  chatVue.indexOf('reactionEmojis') !== -1 && chatVue.indexOf('addReaction') !== -1 &&
  chatVue.indexOf('VALID_REACTIONS') !== -1);
add('聊天体验', 'AI 回复 Markdown 走先转义后插标签',
  chatX.indexOf('renderBotReply') !== -1 && chatX.indexOf('escapeHtml') !== -1 &&
  bubbleVue.indexOf('botHtml') !== -1);
add('聊天体验', '重进聊天回到上次会话',
  chatVue.indexOf("ci:chat:last") !== -1 && chatVue.indexOf('self.selectChat(last)') !== -1);
let chatBuilt = false;
try {
  const chatAssets = path.join(ROOT, 'client/dist/assets');
  const chatChunks = fs.readdirSync(chatAssets).filter(function (f) { return /^Chat-.*\.js$/.test(f); });
  chatBuilt = chatChunks.some(function (f) {
    return fs.readFileSync(path.join(chatAssets, f), 'utf8').indexOf('没有更早的消息了') !== -1;
  });
} catch (e) {}
add('聊天体验', '构建产物包含聊天体验逻辑（改源码必须 build）', chatBuilt, '', 'WARN');

// ============================================================
// 汇总
// ============================================================
const dims = {};
checks.forEach(function (c) {
  if (!dims[c.dim]) dims[c.dim] = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
  dims[c.dim][c.status]++;
});
const pass = checks.filter(function (c) { return c.status === 'PASS'; }).length;
const warn = checks.filter(function (c) { return c.status === 'WARN'; }).length;
const fail = checks.filter(function (c) { return c.status === 'FAIL'; }).length;
const scored = pass + warn + fail;
const score = scored ? Math.round((pass + warn * 0.5) / scored * 100) : 0;

if (asJson) {
  console.log(JSON.stringify({ score, pass, warn, fail, dimensions: dims, checks }, null, 2));
} else {
  console.log('\n=== ClassIntra 全维度体检 ===');
  Object.keys(dims).forEach(function (d) {
    const v = dims[d];
    console.log('  [' + d + '] PASS ' + v.PASS + ' / WARN ' + v.WARN + ' / FAIL ' + v.FAIL);
  });
  checks.filter(function (c) { return c.status !== 'PASS'; }).forEach(function (c) {
    const mark = c.status === 'FAIL' ? '✗' : (c.status === 'WARN' ? '!' : '·');
    console.log('  ' + mark + ' [' + c.dim + '] ' + c.name + (c.detail ? ' — ' + c.detail : ''));
  });
  console.log('\n健康分 ' + score + '/100 · PASS ' + pass + ' / WARN ' + warn + ' / FAIL ' + fail);
  console.log(fail ? '结论: ✗ 有硬性缺口，禁止发版' : '结论: ✓ 无硬性缺口' + (warn ? '（' + warn + ' 项技术债待收敛）' : ''));
  console.log('');
}

process.exit(fail > 0 || (strict && warn > 0) ? 1 : 0);
