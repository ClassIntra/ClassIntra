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
  // 学元经济参数。全部以「人民币元」为单位定义，由 services/xueyuan.js 按
  // yuanRate 折算成「学元分」—— 调 yuanRate 只改面额，不改这些真实货币约束。
  //
  // ⚠️ yuanRate 一旦产生过充值就**不能再改**：存量余额与提现承诺都按旧比率计，
  //    改它等于单方面重估负债（升则违约，降则凭空多欠）。详见 xueyuan.js 文件头。
  xueyuan: {
    yuanRate: Number(process.env.XUEYUAN_YUAN_RATE || 1000),
    // 开户礼金
    welcomeYuan: Number(process.env.XUEYUAN_WELCOME_YUAN || 10),
    // 每日助学津贴 / 连签第 7 天起的加成
    dailyYuan: Number(process.env.XUEYUAN_DAILY_YUAN || 0.2),
    dailyBonusYuan: Number(process.env.XUEYUAN_DAILY_BONUS_YUAN || 0.4),
    dailyBonusFromDay: Number(process.env.XUEYUAN_DAILY_BONUS_FROM_DAY || 7),
    // 单笔线下充值上限 + 每人每学期累计充值配额（防「氪金一次清空货架」）
    maxRechargeYuan: Number(process.env.XUEYUAN_MAX_RECHARGE_YUAN || 200),
    rechargeQuotaYuan: Number(process.env.XUEYUAN_RECHARGE_QUOTA_YUAN || 300),
    // 教师发放：单次上限 + 每人每日累计上限（防一笔打乱整个价格体系）
    maxGrantYuan: Number(process.env.XUEYUAN_MAX_GRANT_YUAN || 0.5),
    grantDailyCapYuan: Number(process.env.XUEYUAN_GRANT_DAILY_CAP_YUAN || 2),
    // 学元贷款：只借赠送学元 GRANT，不碰真金。金额按人民币元配置，
    // 由 ledger/loan.js 用唯一单位链换算（0.1 元 = 100 学元）。
    // 额度阶梯：首次基础额度，按「按时还款的自然日」每天 +1 档，封顶最大额度。
    loanEnabled: (process.env.XUEYUAN_LOAN_ENABLED || 'true') !== 'false',
    loanMinYuan: Number(process.env.XUEYUAN_LOAN_MIN_YUAN || 0.1),
    loanMaxYuan: Number(process.env.XUEYUAN_LOAN_MAX_YUAN || 2),
    loanBaseLimitYuan: Number(process.env.XUEYUAN_LOAN_BASE_LIMIT_YUAN || 0.5),
    loanStepYuan: Number(process.env.XUEYUAN_LOAN_STEP_YUAN || 0.5),
    loanMaxLimitYuan: Number(process.env.XUEYUAN_LOAN_MAX_LIMIT_YUAN || 2),
    loanTermDays: Number(process.env.XUEYUAN_LOAN_TERM_DAYS || 7),
    loanInterestPercent: Number(process.env.XUEYUAN_LOAN_INTEREST_PERCENT || 5),
    // 按时还清的计分冷却：防止「小额借→立刻还」反复刷分。0 = 关闭冷却。
    loanScoreCooldownHours: Number(process.env.XUEYUAN_LOAN_SCORE_COOLDOWN_HOURS || 24),
    // 到期后的宽限小时数：宽限内不算逾期、不影响「按时还清」提额。
    loanGraceHours: Number(process.env.XUEYUAN_LOAN_GRACE_HOURS || 24),
    // 全班同时未还本金上限（人民币元）。防止贷款把整个班的赠金供给放大。
    loanPoolYuan: Number(process.env.XUEYUAN_LOAN_POOL_YUAN || 100),
    // 核销后的冷静期：防止「借了不还 → 求班管核销 → 立刻再借」循环。
    loanWriteOffCooldownDays: Number(process.env.XUEYUAN_LOAN_WRITE_OFF_COOLDOWN_DAYS || 7)
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
