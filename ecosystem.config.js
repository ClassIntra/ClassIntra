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

module.exports = {
  apps: [
    {
      name: 'classintra-server',
      script: 'src/app.js',
      cwd: serverDir,                       // 绝对路径
      exec_mode: 'fork',
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
        AI_API_KEY: envVars.AI_API_KEY || '',
        AI_API_URL: envVars.AI_API_URL || '',
        AI_MODEL: envVars.AI_MODEL || 'gpt-3.5-turbo',
        AI_AVAILABLE_MODELS: envVars.AI_AVAILABLE_MODELS || 'gpt-4o-mini-2024-07-18,gpt-4o-mini',
        DEEPSEEK_API_KEY: envVars.DEEPSEEK_API_KEY || '',
        DEEPSEEK_API_URL: envVars.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
        DEEPSEEK_MODEL: envVars.DEEPSEEK_MODEL || 'deepseek-chat',
        TAVILY_API_KEY: envVars.TAVILY_API_KEY || '',
        TAVILY_API_URL: envVars.TAVILY_API_URL || 'https://api.tavily.com/search',
        TAILSCALE_ENABLED: envVars.TAILSCALE_ENABLED || 'false',
        TAILSCALE_RELAY_IP: envVars.TAILSCALE_RELAY_IP || '',
        SYNCTHING_HOST: envVars.SYNCTHING_HOST || 'localhost',
        SYNCTHING_PORT: envVars.SYNCTHING_PORT || '8384',
        SYNCTHING_API_KEY: envVars.SYNCTHING_API_KEY || ''
      }
    }
  ]
};
