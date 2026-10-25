// 验证：market 应用完整生命周期「安装 → 使用 → 卸载 → 重装 → 再卸载」全程无残留
// （对应 https://classintra.github.io/development/package-spec 的"卸载即无痕"承诺，是生态质量的回归探针）
//
// 流程：
//   0. 在本地市场源写入一次性探针应用 zz-lifecycle-probe（自建表 + cleanup.js 钩子）
//   1. 安装 → 断言：installed 列表含它、后端 API 可用、自建表已创建、app_control 有记录
//   2. 卸载 → 断言：cleanup.js 已 DROP 自建表、app_control 行已删、目录已删、API 已 404
//   3. 重装（验证全新安装不受残留影响）→ 再卸载 → 再断言
//   4. 恢复本地市场源的 index.json 原状、清理探针源文件
//
// 运行前提：服务器已启动（默认 http://127.0.0.1:9001），server/.env 有 JWT_SECRET，
//           用户表里存在 is_admin=1 的账号（探针自动查找并以其身份签名）。
// 用法：node scripts/market-lifecycle-probe.mjs
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = process.env.PROBE_BASE_URL || 'http://127.0.0.1:9001';
const PROBE_APP = 'zz-lifecycle-probe';
const PROBE_TABLE = 'zz_probe_items';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

// ---- 读 server/.env（JWT_SECRET / MARKET_LOCAL_DIR / DB_PATH）----
const env = {};
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SECRET = env.JWT_SECRET;
if (!SECRET) { console.error('FAIL 未在 server/.env 找到 JWT_SECRET'); process.exit(1); }

// 本地市场源目录（与 market-service.js 的 DEFAULT_SOURCES local 逻辑一致）
const MARKET_DIR = env.MARKET_LOCAL_DIR || 'D:/NetWork/Integration/market';
const DB_PATH = env.DB_PATH || REPO + '/server/database/classintra.db';

// ---- 找一个管理员身份签 token ----
const dbro = new Database(DB_PATH, { readonly: true });
const admin = dbro.prepare('SELECT user_id FROM users WHERE is_admin = 1 ORDER BY user_id LIMIT 1').get();
dbro.close();
if (!admin) { console.error('FAIL 用户表中没有 is_admin=1 的账号'); process.exit(1); }
const TOKEN = jwt.sign({ user_id: admin.user_id }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };

async function j(method, url, body) {
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

// sqlite 只读查询（表是否存在 / 行是否存在）
function q(sql) {
  const d = new Database(DB_PATH, { readonly: true });
  try { return d.prepare(sql).all(); } finally { d.close(); }
}
function tableExists(name) {
  return q(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
}

// ---- 组装探针应用源文件 ----
const fixtureDir = MARKET_DIR + '/apps/' + PROBE_APP;
const manifest = {
  name: PROBE_APP, type: 'app', version: '1.0.0',
  label: '生命周期探针', description: 'market 生命周期回归探针的一次性应用',
  category: 'desktop',
  frontend: { route: '/' + PROBE_APP, routeName: 'ZZLifecycleProbe', entry: './frontend/entry.js' },
  backend: { mountPath: '/api/' + PROBE_APP, entry: './backend/routes.js' }
};
const entryJs = `(function() {
  var NAME = '${PROBE_APP}';
  function mount(container) { container.innerHTML = '<div style="padding:12px">lifecycle probe</div>'; }
  function unmount() {}
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
})();`;
const routesJs = `// 探针后端：模块加载时自建表 + 种子行（用于验证"表随安装创建、随卸载清理"）
var express = require('express');
var path = require('path');
var router = express.Router();
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
db.prepare('CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id INTEGER PRIMARY KEY, note TEXT)').run();
db.prepare('INSERT INTO ${PROBE_TABLE} (note) VALUES (?)').run('probe-seed-' + Date.now());
router.get('/count', function(req, res) {
  var row = db.prepare('SELECT COUNT(*) AS c FROM ${PROBE_TABLE}').get();
  res.json({ code: 200, data: { count: row.c } });
});
module.exports = router;`;
const cleanupJs = `// 探针清理钩子：DROP 自己的表 —— 卸载即无痕的样板
var path = require('path');
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
module.exports = function cleanup(ctx) {
  db.prepare('DROP TABLE IF EXISTS ${PROBE_TABLE}').run();
};`;

let indexOriginal = null;
let indexExisted = false;

async function installProbe() {
  const r = await j('POST', APP + '/api/market/install', { name: PROBE_APP, source: 'local' });
  return r;
}
async function uninstallProbe() {
  return j('POST', APP + '/api/market/uninstall', { name: PROBE_APP });
}

try {
  // ---- 0. 准备本地市场源（备份 index.json；清掉上次运行可能的残桌）----
  if (!existsSync(MARKET_DIR + '/apps')) mkdirSync(MARKET_DIR + '/apps', { recursive: true });
  const indexPath = MARKET_DIR + '/index.json';
  indexExisted = existsSync(indexPath);
  if (indexExisted) indexOriginal = readFileSync(indexPath, 'utf8');
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir + '/frontend', { recursive: true });
  mkdirSync(fixtureDir + '/backend', { recursive: true });
  writeFileSync(fixtureDir + '/manifest.json', JSON.stringify(manifest, null, 2));
  writeFileSync(fixtureDir + '/frontend/entry.js', entryJs);
  writeFileSync(fixtureDir + '/backend/routes.js', routesJs);
  writeFileSync(fixtureDir + '/backend/cleanup.js', cleanupJs);
  const catalog = indexOriginal ? JSON.parse(indexOriginal) : { version: 1, apps: [], plugins: [] };
  catalog.apps = (catalog.apps || []).filter(a => a.name !== PROBE_APP);
  catalog.apps.push({ name: PROBE_APP, label: '生命周期探针', version: '1.0.0',
    files: ['apps/' + PROBE_APP + '/manifest.json', 'apps/' + PROBE_APP + '/frontend/entry.js',
            'apps/' + PROBE_APP + '/backend/routes.js', 'apps/' + PROBE_APP + '/backend/cleanup.js'] });
  writeFileSync(indexPath, JSON.stringify(catalog, null, 2));
  // 上次运行可能的残桌先清掉（正常情况下不会有）
  try {
    const d = new Database(DB_PATH);
    d.prepare('DROP TABLE IF EXISTS ' + PROBE_TABLE).run();
    d.close();
  } catch (e) {}

  // ---- 1. 第一次安装 ----
  const inst = await installProbe();
  check('1a 本地源安装成功', inst.status === 200 && inst.json && inst.json.code === 200, (inst.json && inst.json.message) || inst.text.slice(0, 120));
  const lst1 = await j('GET', APP + '/api/market/installed');
  const inList1 = (lst1.json && lst1.json.data && lst1.json.data.apps || []).some(a => a.name === PROBE_APP);
  check('1b installed 列表含探针应用', inList1);
  const ping1 = await j('GET', APP + '/api/' + PROBE_APP + '/count');
  check('1c 后端 API 可用且表已建', ping1.status === 200 && ping1.json && ping1.json.data && ping1.json.data.count >= 1, JSON.stringify(ping1.json && ping1.json.data));
  check('1d app_control 已登记', q(`SELECT * FROM app_control WHERE app_name='${PROBE_APP}'`).length === 1);
  check('1e 应用目录已落盘', existsSync(REPO + '/market-apps/' + PROBE_APP + '/manifest.json'));

  // ---- 2. 第一次卸载（验证 cleanup 钩子 + 全面无残留）----
  const uni1 = await uninstallProbe();
  check('2a 卸载成功', uni1.status === 200, (uni1.json && uni1.json.message) || uni1.text.slice(0, 120));
  const ping2 = await j('GET', APP + '/api/' + PROBE_APP + '/count');
  check('2b 后端路由已摘除', ping2.status === 404, 'status=' + ping2.status);
  check('2c cleanup 钩子已 DROP 自建表', !tableExists(PROBE_TABLE));
  check('2d app_control 行已删', q(`SELECT * FROM app_control WHERE app_name='${PROBE_APP}'`).length === 0);
  check('2e 应用目录已删除', !existsSync(REPO + '/market-apps/' + PROBE_APP));

  // ---- 3. 重装 → 再卸载（验证全新安装 + 清理可重复）----
  const inst2 = await installProbe();
  check('3a 重装成功（无残留干扰）', inst2.status === 200, (inst2.json && inst2.json.message) || inst2.text.slice(0, 120));
  const ping3 = await j('GET', APP + '/api/' + PROBE_APP + '/count');
  check('3b 重装后表为全新状态（count=1）', ping3.status === 200 && ping3.json && ping3.json.data && ping3.json.data.count === 1, JSON.stringify(ping3.json && ping3.json.data));
  const uni2 = await uninstallProbe();
  check('3c 二次卸载成功', uni2.status === 200);
  check('3d 二次卸载后表再次清理', !tableExists(PROBE_TABLE));
  check('3e 二次卸载后目录再次删除', !existsSync(REPO + '/market-apps/' + PROBE_APP));

  // ---- 4. 清单中移除探针应用后的最终状态 ----
  const lst2 = await j('GET', APP + '/api/market/installed');
  const inList2 = (lst2.json && lst2.json.data && lst2.json.data.apps || []).some(a => a.name === PROBE_APP);
  check('4 installed 列表无探针应用', !inList2);

} catch (e) {
  check('探针执行', false, e.message);
} finally {
  // ---- 恢复市场源原状 ----
  try {
    const indexPath = MARKET_DIR + '/index.json';
    if (indexExisted && indexOriginal !== null) writeFileSync(indexPath, indexOriginal);
    else if (!indexExisted) rmSync(indexPath, { force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
    console.log('---- 本地市场源已恢复原状 ----');
  } catch (e) {
    console.warn('恢复市场源失败（请手动检查 ' + MARKET_DIR + '）:', e.message);
  }
}

console.log(fail === 0 ? '\n全部通过 ✔' : `\n${fail} 项失败 ✘`);
process.exit(fail === 0 ? 0 : 1);
