var fs = require('fs');
var path = require('path');

// 读取 .env 文件（改进版：使用绝对路径 + 错误日志）
function parseEnv(filePath) {
  var env = {};
  try {
    if (!fs.existsSync(filePath)) {
      console.error('[ecosystem] WARNING: .env file not found at', filePath);
      return env;
    }
    var content = fs.readFileSync(filePath, 'utf8');
    var lines = content.split(/\r?\n/);
    lines.forEach(function(line) {
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      var eqIndex = line.indexOf('=');
      if (eqIndex === -1) return;
      var key = line.substring(0, eqIndex).trim();
      var val = line.substring(eqIndex + 1).trim();
      // 支持引号包裹和行尾注释
      if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
          (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
        val = val.substring(1, val.length - 1);
      }
      env[key] = val;
    });
    console.log('[ecosystem] Loaded', Object.keys(env).length, 'vars from .env');
  } catch (e) {
    console.error('[ecosystem] ERROR reading .env:', e.message);
  }
  return env;
}

// 使用绝对路径确保 PM2 resurrect 时也能找到 .env
var serverDir = path.resolve(__dirname, 'server');
var envFile = path.join(serverDir, '.env');
var envVars = parseEnv(envFile);

// ChmlFrp 内网穿透客户端（家庭上传链路：uk.frp.one:14225 网页 / :10721 WebSocket）
var frpcDir = 'C:\\Users\\iflytek\\Documents\\ChmlFrp-0.51.2_251023_2_windows_amd64';

// Node 解释器：显式钉死系统 Node。
// 原因：better-sqlite3 是原生模块，按**系统 Node 的 ABI** 编译（Node 24 = NODE_MODULE_VERSION 137）。
// 如果 PM2 子进程从 PATH 解析到别的 Node（例如被外部工具注入到 PATH 前端的 Node 22 = ABI 127），
// 服务会在 require('better-sqlite3') 处 ERR_DLOPEN_FAILED 崩溃（表现为 PM2 疯狂重启、9001 不通）。
var NODE_BIN = 'C:\\Program Files\\nodejs\\node.exe';
var nodeInterpreter = fs.existsSync(NODE_BIN) ? NODE_BIN : 'node';

module.exports = {
  apps: [
    {
      name: 'classintra-server',
      script: 'src/app.js',
      cwd: serverDir,                       // 绝对路径
      exec_mode: 'fork',
      exec_interpreter: nodeInterpreter,    // 钉死系统 Node（见上方 NODE_BIN 说明）
      autorestart: true,
      max_restarts: 20,                     // 提高重启上限
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=768',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'logs', 'server-error.log'),
      out_file: path.join(__dirname, 'logs', 'server-out.log'),
      merge_logs: true,
      min_uptime: '30s',
      listen_timeout: 30000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        NODE_PATH: path.join(serverDir, 'node_modules'),
        // 外部工具（WorkBuddy 等）会经 NODE_OPTIONS / PYTHONPATH 注入垫片。
        // 这两个键必须显式清空：从被污染的 shell 里 start/restart 会把垫片继承进
        // 常驻进程（2026-10-25 实测 classintra-server 的 NODE_OPTIONS 就带着
        // node-language-shim.cjs，而 classintra-https 是干净的）。清空不影响
        // better-sqlite3 —— ABI 只由 exec_interpreter 钉住的 Node 版本决定。
        NODE_OPTIONS: '',
        PYTHONPATH: '',
        PORT: envVars.PORT || '9001',
        WS_PORT: envVars.WS_PORT || '10001',
        RELAY_PORT: envVars.RELAY_PORT || '10011',
        RELAY_SERVER_ID: envVars.RELAY_SERVER_ID || 'server-a',
        RELAY_SERVERS: envVars.RELAY_SERVERS || '',
        RELAY_SECRET: envVars.RELAY_SECRET || '',
        JWT_SECRET: envVars.JWT_SECRET || '',
        JWT_EXPIRES_IN: envVars.JWT_EXPIRES_IN || '7d',
        ADMIN_USER_IDS: envVars.ADMIN_USER_IDS || '',
        CORS_ORIGINS: envVars.CORS_ORIGINS || '',
        DB_PATH: envVars.DB_PATH || './database/classintra.db',
        QWEATHER_KEY: envVars.QWEATHER_KEY || '',
        QWEATHER_LOCATION: envVars.QWEATHER_LOCATION || '101010100',
        TAILSCALE_ENABLED: envVars.TAILSCALE_ENABLED || 'false',
        TAILSCALE_RELAY_IP: envVars.TAILSCALE_RELAY_IP || '',
        SYNCTHING_HOST: envVars.SYNCTHING_HOST || 'localhost',
        SYNCTHING_PORT: envVars.SYNCTHING_PORT || '8384',
        SYNCTHING_API_KEY: envVars.SYNCTHING_API_KEY || ''
      }
    },
    {
      // HTTPS 站点（https://<局域网IP>:9443）。
      //
      // ⚠️ **默认端口不是 443**。443 归本机其他服务使用（用户在跑自己的东西），
      //    这里刻意避让：过去写成 `|| '443'`，结果 `pm2 start ecosystem.config.js`
      //    一执行就把用户的 443 抢了，且 PM2 会 resurrect —— 开机就抢。
      //    要用 443 必须由 `.env` 显式给 `HTTPS_PORT=443`，属于自愿行为。
      //    （app-https.js 自身的缺省值是 9001，所以这个文件只负责「显式指定」。）
      //
      // 为什么单独一个 app 而不是让 app.js 同时监听两个端口：
      //   app-https.js 与 app.js 是两份入口（证书、helmet、压缩策略都不同），
      //   历史上 HTTPS 一直是「手动 node src/app-https.js」起在某个 cmd 窗口里。
      //   那种活法有三个后果：机器重启后不回来、崩了没人拉、改了代码不生效
      //   （旧进程还攥着旧代码）—— 而 Cluss 应用在 HTTPS 下的同源反代
      //   （/cluss-app → 127.0.0.1:9003）恰恰需要它重启才能加载。
      //   纳入 PM2 后开机 resurrect 一并恢复，与 classintra-server 同规格。
      //
      // env 里**只列 HTTPS_PORT**，其余一律不列：dotenv 会读 server/.env，
      //   而 PM2 的 env 会先写进 process.env、反过来盖住 .env 的同名键
      //   （dotenv 不覆盖已存在的值）。多列一个键就多一个「改了 .env 不生效」
      //   的坑，这是 ClassIntra 自己踩过的（见 Cluss ecosystem.config.js 的长注释）。
      name: 'classintra-https',
      script: 'src/app-https.js',
      cwd: serverDir,
      exec_mode: 'fork',
      exec_interpreter: nodeInterpreter,    // 钉死系统 Node（见上方 NODE_BIN 说明）
      autorestart: true,
      max_restarts: 20,
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=768',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'logs', 'https-error.log'),
      out_file: path.join(__dirname, 'logs', 'https-out.log'),
      merge_logs: true,
      min_uptime: '30s',
      listen_timeout: 30000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        NODE_PATH: path.join(serverDir, 'node_modules'),
        // 443 已被本机其他服务占用，默认让开；要换端口改 server/.env 的 HTTPS_PORT
        HTTPS_PORT: envVars.HTTPS_PORT || '9443',
        // 本实例是 9001 的 TLS 镜像：WS/Relay/mesh 席位/天气调度全部归主实例。
        // app-https.js 顶部也会硬设一次，这里写出来是让「读配置的人」一眼能看到，
        // 不必去翻代码才知道这个进程不持有那些东西。
        WS_MIRROR_MODE: 'true',
        // 网页代理的 9102 同样只能有一个所有者：镜像实例抢了它，
        // 主实例（真正要用的那个）反而 EADDRINUSE 起不来，功能就坏了。
        WEB_PROXY_AUTOSTART: '0',
        // 外部工具（WorkBuddy 等）会经 NODE_OPTIONS 注入垫片，清空防污染
        NODE_OPTIONS: ''
      }
    },
    {
      name: 'tunnel-gateway',
      script: 'src/tunnel-gateway.js',
      cwd: serverDir,
      exec_mode: 'fork',
      exec_interpreter: nodeInterpreter,    // 同上，避免被 PATH 带到别的 Node 版本
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'logs', 'gateway-error.log'),
      out_file: path.join(__dirname, 'logs', 'gateway-out.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_PATH: path.join(serverDir, 'node_modules'),
        TUNNEL_GATEWAY_PORT: '10111',
        UPSTREAM_PORT: envVars.PORT || '9001'
      }
    },
    {
      name: 'chmlfrp-frpc',
      script: path.join(frpcDir, 'frpc.exe'),
      args: '-c frpc.ini',
      cwd: frpcDir,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 10000,
      exp_backoff_restart_delay: 200,
      min_uptime: '30s',
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'logs', 'frpc-error.log'),
      out_file: path.join(__dirname, 'logs', 'frpc-out.log'),
      merge_logs: true
    },
    {
      // pcagent（noVNC 设备端代理，Python）
      //
      // 为什么必须写进 ecosystem：此前它一直靠手动 `pm2 start ...` 拉起，
      // 而 resurrect / start ecosystem / 开机自启脚本都只认这个文件 ——
      // 结果就是**每次系统重启（Windows 更新强制重启）pcagent 都会消失**，
      // 远程链路静默断掉，没人知道为什么。2026-10-01 02:03 的自动重启再次踩中。
      name: 'pcagent',
      script: 'D:\\NetWork\\noVNC\\pcagent\\agent.py',
      cwd: 'D:\\NetWork\\noVNC\\pcagent',
      exec_mode: 'fork',
      // 钉死 Python 解释器：PATH 在不同会话里差别很大（WorkBuddy 会把它自己的
      // 目录插到最前面），解析到别的 Python 会缺依赖或行为不一致
      exec_interpreter: 'C:\\Users\\iflytek\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '30s',
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'logs', 'pcagent-error.log'),
      out_file: path.join(__dirname, 'logs', 'pcagent-out.log'),
      merge_logs: true,
      // WorkBuddy 等外部工具会往 PYTHONPATH 塞自己的 shim 目录，一旦被继承，
      // Python 进程会先 import 到 shim 里的同名模块（与 Node 侧的 ABI 崩溃同族，
      // 见 ~/.workbuddy/MEMORY.md 第 10 条）。这里显式清空。
      env: {
        PYTHONPATH: '',
        PCAGENT_CWD: 'D:\\NetWork\\noVNC\\pcagent'
      }
    }
  ]
};
