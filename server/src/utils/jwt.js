// JWT 工具：签发与校验
//
// ---- 默认零配置：开箱即用 RS256 ----
// 原本是 HS256 对称签名，JWT_SECRET 既签发又验签。这个密钥此前还要共享给
// Cluss（CI_JWT_SECRET）让对方验 CI 签的 token，于是「CI 配置泄露」
// 直接等于「Cluss 管理员权限泄露」—— 持有密钥的一方能签出
// { user_id: 任意账号, is_class_admin: 1 }。
//
// 现在改为 RS256：**私钥只留在本机，公钥可以公开**。
//
// ⚠️ 开源部署必须「零配置可用」（本项目以独立部署为主、联动为辅）：
//   不能要求每个使用者先手动生成密钥对再填 .env。所以私钥不存在时
//   **自动生成一对**并存到 server/keys/，首次启动即完成，之后一直复用。
//   配了 JWT_PRIVATE_KEY 才用自己的；没配就自动生成。
//   这样单部署用户什么都不用做，也自动拿到了更安全的算法。
//
// ---- 平滑切换：旧 token 不失效 ----
// 切换瞬间所有人手里的 HS256 token 会全部失效（有效期 7 天），
// 而 refresh-token 也得先 verifyToken —— 旧 token 验不过就刷不出新的，
// 等于把全校师生一次性登出。
//
// 所以 verifyToken **两条路径都接受**：先试 RS256，失败再试 HS256 共享密钥；
// 签发一律走 RS256。效果是：
//   - 新登录 / 新刷新 → 拿到 RS256 token
//   - 7 天内陆续刷新 → 旧 token 自然淘汰
//   - 过渡期任何人都不被登出
// 过渡期结束后确认无人再持旧 token，删掉 JWT_SECRET 即可收紧到只认公钥。
//
// ---- 必须锁定算法 ----
// 非对称验签若不显式 allowlist，攻击者能把 RS256 的 token 改用 HS256 重签 ——
// 因为 HS256 的「密钥」就是那段**公开可得的**公钥文本。这是 alg 混淆漏洞。

var jwt = require('jsonwebtoken');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var config = require('../config');

// 非对称验签的算法白名单
var ASYMMETRIC_ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];

// 密钥对只读一次：每次签发都读盘会拖慢登录
var cachedKeys = null;

// 相对路径统一按「本文件位置」解析，不用 cwd：
// pm2 启动时 cwd 可能是项目根而不是 server/，用 cwd 会找不到文件。
// 而「找不到就静默降级」是最坏的失败方式 —— 服务看着正常，
// 实际用的还是旧算法，没人知道。所以解析顺序明确写在下面。
function resolvePath(p) {
  var candidates = [
    p,                                       // 绝对路径或已是可用路径
    path.resolve(__dirname, '../..', p),     // 相对 server/
    path.resolve(__dirname, '../../..', p)    // 相对项目根
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return '';
}

function toPemText(v) {
  // .env 里多行 PEM 写成字面 \n，这里还原
  return String(v || '').replace(/\\n/g, '\n');
}

// 自动生成密钥对并落盘。返回 { privateKey, publicKey }，失败返回 null。
function generateKeyPair(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(path.join(dir, 'jwt-private.pem'), pair.privateKey, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'jwt-public.pem'), pair.publicKey);
    return pair;
  } catch (e) {
    console.error('[jwt] 自动生成密钥对失败：%s', e.message);
    return null;
  }
}

// 取密钥对：优先用配置，否则自动生成并复用
function getKeys() {
  if (cachedKeys) return cachedKeys;

  // 默认目录：server/keys/（本文件在 server/src/utils/，往上两级）
  var keysDir = path.resolve(__dirname, '../../keys');
  var privateKey = '';
  var publicKey = '';

  var configured = config.jwt.privateKey;
  if (configured) {
    if (configured.indexOf('-----BEGIN') !== -1) {
      privateKey = toPemText(configured);
    } else {
      var p = resolvePath(configured);
      if (p) privateKey = fs.readFileSync(p, 'utf8');
      else console.error('[jwt] JWT_PRIVATE_KEY 指向的文件不存在：%s（退回自动生成）', configured);
    }
  }

  // 私钥仍缺 → 看默认目录里有没有现成的（重启后复用，避免每次启动换密钥）
  if (!privateKey) {
    var dflt = path.join(keysDir, 'jwt-private.pem');
    if (fs.existsSync(dflt)) privateKey = fs.readFileSync(dflt, 'utf8');
  }

  // 仍缺 → 首次启动自动生成，**这是让开源用户零配置可用的关键**
  if (!privateKey) {
    var pair = generateKeyPair(keysDir);
    if (pair) {
      privateKey = pair.privateKey;
      console.log('[jwt] 已自动生成 RSA 密钥对（server/keys/）。');
      console.log('[jwt] 私钥仅本机可见，请勿提交；需要让其它服务验签时把 jwt-public.pem 给它。');
    }
  }

  // 公钥：配置优先，否则从私钥导出。
  //
  // ⚠️ 必须保证「公钥与私钥同源」。若 .env 里配了公钥、而私钥是自动生成的新
  // 一对（两者不同源），验签会静默失败 —— 表现为所有人登录后立刻被登出，
  // 而日志里什么都看不到。所以这里从私钥导出后再与配置比对，不一致就明确警告。
  var derivedPub = '';
  try {
    if (privateKey) {
      var dfltPubPath = path.join(keysDir, 'jwt-public.pem');
      if (fs.existsSync(dfltPubPath)) {
        derivedPub = fs.readFileSync(dfltPubPath, 'utf8');
      } else {
        derivedPub = crypto.createPublicKey(privateKey)
          .export({ type: 'spki', format: 'pem' }).toString();
      }
    }
  } catch (e) { /* 公钥拿不到不影响签发 */ }

  var configuredPub = toPemText(config.jwt.publicKey);
  if (configuredPub && derivedPub) {
    // 比较时忽略空白与换行差异
    var norm = function(s) { return String(s).replace(/\s+/g, ''); };
    if (norm(configuredPub) !== norm(derivedPub)) {
      console.warn('[jwt] ⚠️  配置的 JWT_PUBLIC_KEY 与当前私钥**不是同一对**，验签会失败。');
      console.warn('[jwt]    私钥来源：%s', configured ? 'JWT_PRIVATE_KEY' : '自动生成的 server/keys/jwt-private.pem');
      console.warn('[jwt]    请把该私钥对应的公钥填回 JWT_PUBLIC_KEY，或清空该项让程序自动导出。');
    }
  }

  // 验签一律用「与私钥同源」的公钥，配置值仅在无私钥时作为兜底
  publicKey = derivedPub || configuredPub;

  cachedKeys = { privateKey: privateKey, publicKey: publicKey };
  return cachedKeys;
}

function generateToken(userInfo) {
  var keys = getKeys();
  if (keys.privateKey) {
    return jwt.sign(userInfo, keys.privateKey, {
      algorithm: 'RS256',
      expiresIn: config.jwt.expiresIn
    });
  }
  // 兜底：连自动生成都失败（只读文件系统等极端情况）才退回 HS256。
  // 正常路径下永远走不到这里 —— 走到就说明环境有问题，必须让人看见。
  console.warn('[jwt] 无法使用 RS256（私钥不可用），退回 HS256；此时跨系统验签只能用共享密钥');
  return jwt.sign(userInfo, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

// 依次尝试：RS256 公钥 → HS256 共享密钥（兼容过渡期与兜底模式）
function verifyToken(token) {
  if (!token) return { valid: false, data: null };

  var keys = getKeys();
  if (keys.publicKey) {
    try {
      // ⚠️ algorithms 必须显式给出，否则可被 HS256 公钥重签绕过
      var decoded = jwt.verify(token, keys.publicKey, { algorithms: ASYMMETRIC_ALGS });
      return { valid: true, data: decoded };
    } catch (err) {
      // 不是本系统私钥签的 → 继续试共享密钥（兼容旧的 HS256 token）
    }
  }

  try {
    var decoded2 = jwt.verify(token, config.jwt.secret);
    return { valid: true, data: decoded2 };
  } catch (err) {
    return { valid: false, data: null };
  }
}

module.exports = {
  generateToken: generateToken,
  verifyToken: verifyToken
};