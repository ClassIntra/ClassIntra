#!/usr/bin/env node
// ClassIntra 统一脚手架入口（第三方开发第一站）
// ============================================================
// 一个命令覆盖四类模块的骨架生成，模板即正确示例（Chrome 80 / 令牌 / 生命周期）：
//
//   node scripts/create.mjs app <name> [--label 显示名] [--with-backend] [--force] [--color #hex]
//                                  市场应用（market-apps/，微前端 entry.js）→ 转发 create-app.mjs
//   node scripts/create.mjs official-app <name> [...]
//                                  官方应用（apps/，.vue 组件随主仓构建）→ 转发 create-app.mjs --kind official
//   node scripts/create.mjs plugin <name> [--dir 目录]
//                                  市场插件（默认 <市场源>/plugins/，纯后端热挂载）
//   node scripts/create.mjs theme <id> [--type light|dark] [--dir 目录]
//                                  市场主题（默认 <市场源>/themes/，纯数据 JSON 免构建）
//   node scripts/create.mjs widget <app-name> <widget-id> --name "组件名"
//                                  官方应用的桌面小组件 → 转发 scaffold.js
//
// 生成后的下一步：node scripts/diag.js market [name] 装前预检 →
// 本地源安装调试 → node scripts/market-index-gen.mjs && node scripts/market-sign.mjs 发布。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const kind = argv[0];
const name = argv[1];

function argFlag(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
function marketDir() {
  // 与 market-service 的 local 源同规则：MARKET_LOCAL_DIR || <根>/../market
  return argFlag('--dir') || process.env.MARKET_LOCAL_DIR || resolve(ROOT, '..', 'market');
}
function forward(script, args) {
  execFileSync(process.execPath, [join('scripts', script), ...args], { stdio: 'inherit', cwd: ROOT });
}

const USAGE = `ClassIntra 统一脚手架（六类入口，覆盖从零开发与存量项目迁入）

  node scripts/create.mjs app <name> [--label 显示名] [--with-backend] [--force]   市场应用（entry.js 微前端）
  node scripts/create.mjs site <name>                                             静态站点（iframe 零适配迁入，dist 拷入即跑）
  node scripts/create.mjs service <name> [--lang node|python]                    独立端口服务（任意语言进程托管）
  node scripts/create.mjs official-app <name> [...]                               官方应用（.vue 随主仓构建）
  node scripts/create.mjs plugin <name> [--dir 目录]                              市场插件（纯后端热挂载）
  node scripts/create.mjs theme <id> [--type light|dark] [--dir 目录]              市场主题（纯数据 JSON）
  node scripts/create.mjs widget <app> <widget-id> --name "组件名"                 桌面小组件（官方应用）

示例：
  node scripts/create.mjs app countdown-pro --label "倒计时 Pro" --with-backend
  node scripts/create.mjs site my-vite-app      # 已有 vite 项目：dist/* 拷入 frontend/
  node scripts/create.mjs service game-server   # 自带端口的联机服务
  node scripts/create.mjs plugin score-sync
  node scripts/create.mjs theme ocean-blue --type dark`;

async function genPlugin(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name || '')) throw new Error('插件名非法（kebab-case）');
  const dir = join(marketDir(), 'plugins', name);
  if (existsSync(dir)) throw new Error('目录已存在: ' + dir + '（--dir 可换位置，或先删除）');
  mkdirSync(join(dir, 'backend'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    name,
    type: 'plugin',
    version: '0.1.0',
    label: name,
    description: '插件示例：纯后端扩展（无前端页面），安装后热挂载到 /api/' + name,
    author: '',
    backend: {
      mountPath: '/api/' + name,
      entry: './backend/routes.js',
      rateLimit: { max: 120, windowMs: 60000 }
    },
    capabilities: ['data.http'],
    config: []
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'backend', 'routes.js'), `// ${name} 插件后端（热挂载到 /api/${name}，请求期闸门随启停即时生效）
// 编码约定：var / function / 单引号（Node 服务端无语法限制，但保持与主仓一致）
var express = require('express');
var path = require('path');
var router = express.Router();
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;

router.get('/health', requireAuth, function(req, res) {
  res.json({ code: 200, data: { ok: true, plugin: '${name}' } });
});

// TODO: 你的业务路由。自建表请提供 backend/cleanup.js（卸载即无痕，见 https://classintra.github.io/development/package-spec §6）

module.exports = router;
`);
  writeFileSync(join(dir, 'backend', 'cleanup.js'), `// 卸载清理钩子（模板）：自建了表/数据就取消注释并替换表名
// var path = require('path');
// var db = require(path.resolve(process.cwd(), 'src/utils/db'));
module.exports = function cleanup(ctx) {
  // db.prepare('DROP TABLE IF EXISTS ${name.replace(/-/g, '_')}_items').run();
};
`);
  writeFileSync(join(dir, 'README.md'), `# ${name}

市场插件（纯后端）。开发循环：
1. 改代码 → 管理端「应用市场 → 插件 → 更新」（本地源直读，无需构建）
2. 装前预检：node scripts/diag.js plugin（或 market）
3. 发布：市场源根目录跑 node scripts/market-index-gen.mjs && node scripts/market-sign.mjs 后推送

完整契约：https://classintra.github.io/development/package-spec 与 plugins/README.md
`);
  console.log('已生成插件骨架: ' + dir);
  console.log('下一步: node scripts/diag.js plugin ' + name);
}

async function genTheme(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || '')) throw new Error('主题 id 非法（kebab-case）');
  if (id === 'light' || id === 'dark') throw new Error('主题 id 不能是 light/dark（内置主题不可覆盖）');
  const type = argFlag('--type') === 'dark' ? 'dark' : 'light';
  const dir = join(marketDir(), 'themes', id);
  if (existsSync(dir)) throw new Error('目录已存在: ' + dir + '（--dir 可换位置，或先删除）');
  mkdirSync(dir, { recursive: true });
  // tokens 副本从内置同名型主题生成（完整可改；只动 color 组的值即可生效）
  const builtin = await import(pathToFileURL(join(ROOT, 'themes', type, 'tokens.js')).href);
  const tokens = (builtin.default || builtin.TOKENS || builtin);
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id,
    name: id,
    type,
    version: '0.1.0',
    description: '市场主题示例：改 tokens.json 里的 color 组值即可',
    author: '',
    tokens: './tokens.json'
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# ${id}

市场主题（纯数据 JSON，免构建、无脚本执行）。
- tokens.json 是内置 ${type} 主题的完整副本：改 color 组的值（primary/semantic/accent…）即可，
  shape/shadow/motion 组一般不用动
- 安装后出现在全班成员的主题选择里；卸载时使用中的用户自动回退浅色
- 发布：市场源根目录 node scripts/market-index-gen.mjs && node scripts/market-sign.mjs 后推送

完整契约：https://classintra.github.io/development/package-spec §9
`);
  console.log('已生成主题骨架: ' + dir + '（type=' + type + '，tokens 基于 ' + type + ' 副本）');
  console.log('下一步: 改 tokens.json → 管理端市场 → 主题 → 安装');
}

async function genSite(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name || '')) throw new Error('应用名非法（kebab-case）');
  const dir = join(marketDir(), 'apps', name);
  if (existsSync(dir)) throw new Error('目录已存在: ' + dir + '（--dir 可换位置，或先删除）');
  mkdirSync(join(dir, 'frontend'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    name,
    type: 'app',
    version: '0.1.0',
    label: name,
    description: '静态站点示例：已有独立项目（vite/webpack 打包的 dist）零适配迁入',
    author: '',
    category: 'desktop',
    frontend: {
      route: '/' + name,
      static: './frontend/index.html'
    },
    sdk: '1',
    capabilities: ['data.http']
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'frontend', 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; padding: 24px; background: var(--bg-color, #f2f2f7); color: var(--text-primary, #000); }
    h1 { font-size: 20px; }
    button { padding: 10px 24px; border-radius: 10px; border: none; background: #007AFF; color: #fff; font-size: 14px; min-height: 44px; }
    pre { background: rgba(128,128,128,0.12); border-radius: 10px; padding: 12px; font-size: 12px; overflow: auto; }
  </style>
  <!-- CI 适配器：获得用户信息/主题跟随/返回桌面/系统 toast（见 https://classintra.github.io/development/migration） -->
  <script src="/ci-adapter.js"></script>
</head>
<body>
  <h1>${name}（静态站）</h1>
  <p>iframe 同源加载：直接调主服务 API；CI.* 是宿主系统能力。</p>
  <button onclick="callApi()">调系统 API</button>
  <button onclick="showUser()">当前用户</button>
  <button onclick="CI.toast({ message: '来自 ${name}', type: 'success' })">系统 toast</button>
  <button onclick="CI.back()">返回桌面</button>
  <pre id="out">按钮结果会显示在这里</pre>
  <script>
    // 静态站形态：与主站同源，token 从 localStorage 取（登录后自动可用）
    function callApi() {
      var token = localStorage.getItem('token');
      fetch('/api/system/version', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(function(r) { return r.json(); })
        .then(function(j) { document.getElementById('out').textContent = JSON.stringify(j, null, 2); })
        .catch(function(e) { document.getElementById('out').textContent = '请求失败: ' + e.message; });
    }
    function showUser() {
      CI.user().then(function(u) {
        document.getElementById('out').textContent = '当前用户: ' + u.net_name + '（' + u.user_id + '，' + (u.role || 'student') + '）';
      }).catch(function(e) {
        document.getElementById('out').textContent = '宿主能力不可用: ' + e.message;
      });
    }
    // 跟随系统主题（tokens 里拿 primary 等色值应用到自己的样式）
    CI.onTheme(function(t) {
      var c = t.tokens && t.tokens.color;
      if (c && c.primary) document.body.style.setProperty('--primary-color', c.primary);
    });
    CI.theme().then(function(t) {
      var c = t.tokens && t.tokens.color;
      if (c && c.primary) document.body.style.setProperty('--primary-color', c.primary);
    }).catch(function() {});
  </script>
</body>
</html>
`);
  writeFileSync(join(dir, 'README.md'), `# ${name}

静态站点形态（iframe 迁入，零适配）。迁移已有项目：把构建产物（dist 里全部文件）拷到 frontend/ 下，
确保有 index.html，manifest 的 frontend.static 指向它即可。
- 同源运行：可直接 fetch('/api/...')，登录 token 在 localStorage('token')
- 主题令牌：宿主注入的 --ci-* CSS 变量在 iframe 内不可见，需要跟随主题请自读 :root 或改用 app 形态深度集成
- 发布：市场源根目录 node scripts/market-index-gen.mjs && node scripts/market-sign.mjs 后推送
`);
  console.log('已生成静态站骨架: ' + dir);
  console.log('迁移已有项目：把 dist/* 拷进 frontend/，覆盖 index.html 即可');
}

async function genService(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name || '')) throw new Error('服务名非法（kebab-case）');
  const lang = (argv.indexOf('--lang') !== -1 && argv[argv.indexOf('--lang') + 1]) || 'node'; // node | python
  const dir = join(marketDir(), 'apps', name);
  if (existsSync(dir)) throw new Error('目录已存在: ' + dir + '（--dir 可换位置，或先删除）');
  mkdirSync(join(dir, 'frontend'), { recursive: true });
  mkdirSync(join(dir, 'backend'), { recursive: true });
  const port = 41000 + Math.floor(Math.random() * 4000); // 建议端口（安装时仍会探测冲突）
  const entryFile = lang === 'python' ? './backend/server.py' : './backend/server.js';
  const command = lang === 'python' ? 'python server.py' : undefined;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    name,
    type: 'app',
    version: '0.1.0',
    label: name,
    description: '独立端口服务示例（' + (lang === 'python' ? 'Python' : 'Node') + '）：进程托管 + 反代 127.0.0.1:' + port,
    author: '',
    category: 'desktop',
    frontend: {
      route: '/' + name,
      static: './frontend/index.html'
    },
    backend: {
      mountPath: '/api/' + name,
      entry: entryFile,
      process: lang === 'python'
        ? { command: command, entry: entryFile, port: port }
        : { entry: entryFile, port: port }
    },
    sdk: '1',
    capabilities: ['data.http', 'data.storage']
  }, null, 2) + '\n');
  if (lang === 'python') {
    writeFileSync(join(dir, 'backend', 'server.py'), `# ${name} 独立服务（Python，进程形态）
# 主服务 spawn 本文件为独立进程并反代 /api/${name} -> 127.0.0.1:PORT
# 宿主需预装 Python 3（command 默认 "python server.py"，按部署环境改 manifest）
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"code": 200, "data": {"hello": "${name}", "path": self.path}}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', ${port}))
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
`);
    writeFileSync(join(dir, 'backend', 'requirements.txt'), '# 依赖请让部署者预装（市场不执行 pip）；或自带纯标准库实现\n');
  } else {
    writeFileSync(join(dir, 'backend', 'server.js'), `// ${name} 独立服务（进程型后端）
// 主服务安装时 spawn 本文件为独立进程并反代 /api/${name} → 127.0.0.1:PORT。
// 环境变量：PORT（必守）、CI_APP_NAME、CI_APP_DIR（应用目录）
// 约束：只绑 127.0.0.1；崩溃由主服务自动重启（指数退避，上限 5 次）
var http = require('http');

var server = http.createServer(function(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: { ok: true, app: '${name}' } }));
    return;
  }
  // TODO: 你的业务。调用主服务 API 可直接 fetch/http 打本机主端口（同机部署）
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 200, data: { hello: '${name}', path: req.url } }));
});

server.listen(Number(process.env.PORT || ${port}), '127.0.0.1', function() {
  console.log('[${name}] listening on 127.0.0.1:' + (process.env.PORT || ${port}));
});
`);
  }
  writeFileSync(join(dir, 'frontend', 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${name}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;padding:24px}pre{background:rgba(128,128,128,.12);border-radius:10px;padding:12px;font-size:12px}</style>
</head>
<body>
  <h1>${name}（独立端口服务 · ${lang === 'python' ? 'Python' : 'Node'}）</h1>
  <p>前端经主服务反代访问自己的后端：<code>/api/${name}/...</code></p>
  <pre id="out">探测中…</pre>
  <script>
    fetch('/api/${name}/health')
      .then(function(r){return r.json()})
      .then(function(j){document.getElementById('out').textContent = JSON.stringify(j, null, 2)})
      .catch(function(e){document.getElementById('out').textContent = '服务未响应: ' + e.message});
  </script>
</body>
</html>
`);
  writeFileSync(join(dir, 'README.md'), `# ${name}

独立端口服务形态（${lang === 'python' ? 'Python' : 'Node'} 进程托管 + 反代）。
- 进程入口：${entryFile}${lang === 'python' ? '（command: ' + command + '，按宿主环境可改 python3）' : ''}
- 主服务把 /api/${name} 反代到 127.0.0.1:${port}（仅 HTTP；WS 暂不支持）
- 崩溃自动重启（指数退避 × 5 次）；停用/卸载自动终止进程树
- 端口冲突安装期检测；只应绑 127.0.0.1
- **多语言注意**：宿主运行时（python/jvm/go…）由部署者预装，市场不自动安装依赖；
  优先用目标机的语言标准库，或把依赖打包进目录（如 Python vendar、Go 静态编译产物）

发布：node scripts/market-index-gen.mjs && node scripts/market-sign.mjs 后推送
`);
  console.log('已生成独立服务骨架: ' + dir + '（' + (lang === 'python' ? 'Python' : 'Node') + '，建议端口 ' + port + '）');
}

async function main() {
  if (!kind || !name) { console.log(USAGE); process.exit(kind ? 1 : 0); }
  const rest = argv.slice(2);
  switch (kind) {
    case 'app':
      forward('create-app.mjs', [name, ...rest]);
      return;
    case 'official-app':
      forward('create-app.mjs', [name, '--kind', 'official', ...rest]);
      return;
    case 'site':
      await genSite(name);
      return;
    case 'service':
      await genService(name);
      return;
    case 'widget':
      // scaffold.js widget 用位置参数（app-name widget-id），--name 由其自行解析
      execFileSync(process.execPath, ['scripts/scaffold.js', 'widget', name, argv[2] || '', ...rest.slice(1)], { stdio: 'inherit', cwd: ROOT });
      return;
    case 'plugin':
      await genPlugin(name);
      return;
    case 'theme':
      await genTheme(name);
      return;
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch(function(e) {
  console.error('生成失败: ' + (e && e.message));
  process.exit(1);
});
