var path = require('path');

module.exports = {
  port: process.env.PORT || 9001,
  wsPort: process.env.WS_PORT || 10001,
  relayPort: process.env.RELAY_PORT || 10011,
  jwt: {
    // HS256 共享密钥。**仅在过渡期与兜底模式需要**：
    // 私钥配好后签发走 RS256，这个值只剩「验签尚未刷新的旧 token」这一个用途。
    //
    // ⚠️ 收尾时可以清空，但**清空前必须先确认没人再持旧 token**
    //   （判据见 utils/jwt.js 里 HS256 兜底分支的日志：连续 7×24h 无输出）。
    //   清空后旧 HS256 token 会立即全部失效，且无法再通过 refresh-token 抢救。
    //
    //   这里**不再 process.exit(1)**：RS256 路线并不依赖这个值，
    //   而「文档让运维清空它、代码却不许清空」是个执行不了的指令 ——
    //   早期版本用 `|| process.exit(1)`，结果清空就等于服务起不来。
    secret: String(process.env.JWT_SECRET || '').trim(),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',

    // RS256 私钥：**只留在 ClassIntra，绝不外发**。
    // 两种写法二选一：
    //   1) 文件路径（推荐）：如 server/keys/jwt-private.pem
    //   2) 直接贴 PEM：多行用字面 \n
    // 留空则退回 HS256 签发（服务仍可用，但 Cluss 只能用共享密钥验签）。
    privateKey: (process.env.JWT_PRIVATE_KEY || '').trim(),

    // RS256 公钥：可以公开，Cluss 侧持有它用于验签。
    publicKey: (process.env.JWT_PUBLIC_KEY || '').trim().replace(/\\n/g, '\n')
  },
  adminUserIds: (process.env.ADMIN_USER_IDS || '').split(',').filter(function(s) { return s.trim() !== ''; }),
  // 机器人管理员：由 AstrBot 这类自动化账号组成，天然不受「按班级分组」限制
  // （user_id 不是 YYCCxx 形式，canAdminManageUser 的班级比对必然失败）。
  // 仅影响「跨班用户操作」与「PM2 等仅班管可操作」的端点，不改变人类管理员的既有权限。
  botAdminIds: (process.env.BOT_ADMIN_IDS || '').split(',').filter(function(s) { return s.trim() !== ''; }),
  qweather: {
    key: process.env.QWEATHER_KEY || '',
    location: process.env.QWEATHER_LOCATION || '',
    apiHost: process.env.QWEATHER_API_HOST || 'devapi.qweather.com',
    kid: process.env.QWEATHER_KID || '',
    sub: process.env.QWEATHER_SUB || '',
    privateKey: process.env.QWEATHER_PRIVATE_KEY || ''
  },
  ai: (function() {
    var availableModels = (process.env.AI_AVAILABLE_MODELS || 'gpt-4o-mini-2024-07-18,gpt-4o-mini').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; });
    var configuredModel = process.env.AI_MODEL || 'gpt-3.5-turbo';
    return {
      apiKey: process.env.AI_API_KEY || '',
      apiUrl: process.env.AI_API_URL || '',
      model: availableModels.indexOf(configuredModel) >= 0 ? configuredModel : (availableModels[0] || configuredModel),
      availableModels: availableModels
    };
  })(),
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || '',
    apiUrl: process.env.TAVILY_API_URL || 'https://api.tavily.com/search',
    maxResults: 2,
    searchDepth: 'basic'
  },
  resourcesDir: path.resolve(process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources')),
  dbPath: path.resolve(process.env.DB_PATH || path.join(__dirname, '../../database/classintra.db')),
  relay: {
    servers: (process.env.RELAY_SERVERS || '').split(',').filter(function(s) { return s.trim() !== ''; }),
    secret: process.env.RELAY_SECRET || '',
    serverId: process.env.RELAY_SERVER_ID || ''
  },
  syncthing: {
    host: process.env.SYNCTHING_HOST || 'localhost',
    port: process.env.SYNCTHING_PORT || '8384',
    apiKey: process.env.SYNCTHING_API_KEY || ''
  },
  tailscale: {
    enabled: (process.env.TAILSCALE_ENABLED || 'false') === 'true',
    relayIp: process.env.TAILSCALE_RELAY_IP || '',
    statusCommand: process.env.TAILSCALE_STATUS_CMD || 'tailscale status --json'
  }
};
