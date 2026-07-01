var path = require('path');

module.exports = {
  port: process.env.PORT || 9001,
  wsPort: process.env.WS_PORT || 10001,
  relayPort: process.env.RELAY_PORT || 10011,
  jwt: {
    secret: process.env.JWT_SECRET || (function() { console.error('FATAL: JWT_SECRET environment variable must be set'); process.exit(1); })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  adminUserIds: (process.env.ADMIN_USER_IDS || '').split(',').filter(function(s) { return s.trim() !== ''; }),
  qweather: {
    key: process.env.QWEATHER_KEY || '',
    location: process.env.QWEATHER_LOCATION || '',
    apiHost: process.env.QWEATHER_API_HOST || 'devapi.qweather.com',
    kid: process.env.QWEATHER_KID || '',
    sub: process.env.QWEATHER_SUB || '',
    privateKey: process.env.QWEATHER_PRIVATE_KEY || ''
  },
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    apiUrl: process.env.AI_API_URL || '',
    model: process.env.AI_MODEL || 'gpt-3.5-turbo',
    // GPT sub-models available for user switching
    availableModels: (process.env.AI_AVAILABLE_MODELS || 'gpt-4o-mini-2024-07-18,gpt-4o-mini').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; })
  },
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
