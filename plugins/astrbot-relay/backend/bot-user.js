// AstrBot Relay - 机器人账号管理
// 确保机器人（如"林晞"）在 ClassIntra users 表中存在独立账号，
// 用于登录 WS 与真人用户私聊。账号信息来自环境变量：
//   BOT_USER_ID  （默认 linxi_ai）
//   BOT_NET_NAME （默认 林晞）
//   BOT_PASSWORD （必填，同时用于自动建号与 WS 登录）
//   BOT_GENDER   （默认 女）

var db = require('../../../server/src/utils/db');
var pwdUtil = require('../../../server/src/utils/password');
var time = require('../../../server/src/utils/time');

function getBotConfig() {
  return {
    userId: process.env.BOT_USER_ID || 'linxi_ai',
    netName: process.env.BOT_NET_NAME || '林晞',
    realName: process.env.BOT_REAL_NAME || '林晞',
    password: process.env.BOT_PASSWORD || '',
    gender: process.env.BOT_GENDER || '女'
  };
}

// 确保机器人账号存在（幂等：已存在则跳过）
function ensureBotUser() {
  var cfg = getBotConfig();
  if (!cfg.password) {
    console.warn('[astrbot-relay] 未配置 BOT_PASSWORD，跳过机器人账号检查与登录');
    return null;
  }
  try {
    var existing = db.prepare('SELECT user_id, net_name FROM users WHERE user_id = ?').get(cfg.userId);
    if (existing) {
      console.log('[astrbot-relay] 机器人账号已存在: ' + cfg.userId + ' (' + existing.net_name + ')');
      return cfg;
    }
    var passwordHash = pwdUtil.hashPassword(cfg.password);
    db.prepare(
      'INSERT INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(cfg.netName, cfg.realName, cfg.userId, cfg.gender, passwordHash, 'active', 0, '{}');
    db.prepare('UPDATE users SET updated_at = ? WHERE user_id = ?').run(time.nowISO(), cfg.userId);
    console.log('[astrbot-relay] 已创建机器人账号: ' + cfg.userId + ' (' + cfg.netName + ')');
    return cfg;
  } catch (e) {
    console.error('[astrbot-relay] 机器人账号初始化失败:', e.message);
    return null;
  }
}

module.exports = { getBotConfig: getBotConfig, ensureBotUser: ensureBotUser };
