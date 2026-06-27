var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../utils/db');
var jwtUtil = require('../utils/jwt');
var pwdUtil = require('../utils/password');
var config = require('../config');
var auth = require('../middleware/auth');
var authMiddleware = require('../middleware/auth').requireAuth;
var time = require('../utils/time');
var constants = require('../utils/constants');

// 时序安全的字符串比较（防止时序侧信道攻击）
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Helper: build user_info object (never include password_hash)
function buildUserInfo(row) {
  return {
    user_id: row.user_id,
    net_name: row.net_name,
    real_name: row.real_name,
    gender: row.gender,
    status: row.status,
    is_admin: row.is_admin,
    is_class_admin: constants.isClassAdmin(row.user_id),
    role: row.role || 'user',
    officer_permissions: row.officer_permissions || '[]',
    officer_title: row.officer_title || '',
    info: constants.safeJsonParse(row.info_json),
    created_at: time.toISOString(row.created_at),
    last_login: time.toISOString(row.last_login),
    ban_expires_at: row.ban_expires_at || null,
    ban_reason: row.ban_reason || null
  };
}

// Helper: generate JWT payload
function buildTokenPayload(row) {
  return {
    user_id: row.user_id,
    net_name: row.net_name,
    real_name: row.real_name,
    is_admin: row.is_admin,
    is_class_admin: constants.isClassAdmin(row.user_id),
    role: row.role || 'user',
    officer_permissions: row.officer_permissions || '[]',
    officer_title: row.officer_title || '',
    gender: row.gender
  };
}

// Helper: set auth cookie
function setAuthCookie(res, token) {
  var isProduction = process.env.NODE_ENV === 'production';
  var isSecure = isProduction && process.env.HTTPS === 'true';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

// POST /api/auth/register
router.post('/register', function(req, res) {
  try {
    var net_name = req.body.net_name;
    var real_name = req.body.real_name;
    var password = req.body.password;
    var confirm_password = req.body.confirm_password;

    // 1. Validate all fields present
    if (!net_name || !real_name || !password || !confirm_password) {
      return res.json({ code: 400, message: '请填写所有必填字段', data: null });
    }

    // 2. Check passwords match
    if (password !== confirm_password) {
      return res.json({ code: 400, message: '两次输入的密码不一致', data: null });
    }

    // 3. Check password strength
    var strengthResult = pwdUtil.checkPasswordStrength(password);
    if (!strengthResult.valid) {
      return res.json({ code: 400, message: strengthResult.message, data: null });
    }

    // 4. Check real_name in pre_records table
    var preRecord = db.prepare('SELECT * FROM pre_records WHERE real_name = ?').get(real_name);
    if (!preRecord) {
      return res.json({ code: 400, message: '该姓名不在预注册名单中', data: null });
    }

    // 5. Get user_id and gender from pre_records
    var assigned_user_id = preRecord.user_id;
    var assigned_gender = preRecord.gender;

    // 6. Check real_name not already registered
    var existingByRealName = db.prepare('SELECT user_id FROM users WHERE real_name = ?').get(real_name);
    if (existingByRealName) {
      return res.json({ code: 409, message: '该姓名已注册', data: null });
    }

    // 7. Check net_name not already taken
    var existingByNetName = db.prepare('SELECT user_id FROM users WHERE net_name = ?').get(net_name);
    if (existingByNetName) {
      return res.json({ code: 409, message: '该网名已被使用', data: null });
    }

    // 7b. Check user_id not already registered (defensive: catches stale pre_records)
    var existingByUid = db.prepare('SELECT real_name FROM users WHERE user_id = ?').get(assigned_user_id);
    if (existingByUid) {
      console.error('[Register] user_id collision: ' + assigned_user_id + ' assigned to ' + real_name + ' but already used by ' + existingByUid.real_name);
      return res.json({ code: 409, message: '该用户ID已被占用，请联系管理员处理', data: null });
    }

    // 8. Hash password and insert into users table
    var password_hash = pwdUtil.hashPassword(password);
    var is_admin = config.adminUserIds.indexOf(assigned_user_id) !== -1 ? 1 : 0;

    db.prepare(
      'INSERT INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(net_name, real_name, assigned_user_id, assigned_gender, password_hash, 'active', is_admin, '{}');

    db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(assigned_user_id);

    // 9. Generate JWT token
    var userRow = db.prepare('SELECT * FROM users WHERE user_id = ?').get(assigned_user_id);
    var tokenPayload = buildTokenPayload(userRow);
    var token = jwtUtil.generateToken(tokenPayload);

    // Set cookie
    setAuthCookie(res, token);

    // 10. Return user_info and token
    var user_info = buildUserInfo(userRow);

    constants.relayEvent('user_registered', {
      user_id: assigned_user_id,
      net_name: net_name,
      real_name: real_name,
      gender: assigned_gender,
      is_admin: is_admin,
      info_json: '{}',
      wechat: '',
      qq: '',
      phone: '',
      address: '',
      signature: '',
      privacy_settings: '{}',
      created_at: time.nowISO()
    });

    return res.json({ code: 200, message: '注册成功', data: { user_info: user_info, token: token } });
  } catch (err) {
    console.error('Register error:', err);
    return res.json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/auth/login
router.post('/login', function(req, res) {
  try {
    var account = req.body.account;
    var password = req.body.password;

    // Validate fields
    if (!account || !password) {
      return res.json({ code: 400, message: '请输入账号和密码', data: null });
    }

    // 1. Find user by account (check real_name, user_id, or net_name)
    var user = db.prepare(
      'SELECT * FROM users WHERE real_name = ? OR user_id = ? OR net_name = ?'
    ).get(account, account, account);

    if (!user) {
      return tryRelayLogin(account, password, res);
    }

    if (!user.password_hash) {
      return tryRelayLogin(account, password, res);
    }

    // 2. Verify password
    if (!pwdUtil.verifyPassword(password, user.password_hash)) {
      return res.json({ code: 401, message: '账号或密码错误', data: null });
    }

    // 3. Check user status (not disabled)
    if (user.status === 'disabled') {
      return res.json({ code: 403, message: '该账号已被禁用', data: null, ban_expires_at: user.ban_expires_at || null, ban_reason: user.ban_reason || null });
    }

    // 4. Update last_login
    db.prepare('UPDATE users SET last_login = datetime(\'now\'), updated_at = datetime(\'now\') WHERE user_id = ?').run(user.user_id);

    // 登录事件仅本地广播，不中继（各服务器独立管理登录状态）
    try {
      var relayBus = require('../utils/relay-bus');
      relayBus.emitLocal('user_login', {
        user_id: user.user_id,
        last_login: new Date().toISOString()
      });
    } catch (e) {}

    var tokenPayload = buildTokenPayload(user);
    var token = jwtUtil.generateToken(tokenPayload);

    // Set cookie
    setAuthCookie(res, token);

    // 6. Return user_info and token
    var user_info = buildUserInfo(user);
    return res.json({ code: 200, message: '登录成功', data: { user_info: user_info, token: token } });
  } catch (err) {
    console.error('Login error:', err);
    return res.json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/auth/refresh-token
router.post('/refresh-token', function(req, res) {
  try {
    // 1. Verify current token
    var token = req.cookies.token || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    if (!token) {
      return res.json({ code: 401, message: '未登录', data: null });
    }

    var result = jwtUtil.verifyToken(token);
    if (!result.valid) {
      return res.json({ code: 401, message: '登录已过期，请重新登录', data: null });
    }

    var decoded = result.data;

    // Verify user still exists and is not disabled
    var user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(decoded.user_id);
    if (!user) {
      return res.json({ code: 401, message: '用户不存在', data: null });
    }
    if (user.status === 'disabled') {
      return res.json({ code: 403, message: '该账号已被禁用', data: null, ban_expires_at: user.ban_expires_at || null, ban_reason: user.ban_reason || null });
    }

    // 2. Generate new token with same user info
    var tokenPayload = buildTokenPayload(user);
    var newToken = jwtUtil.generateToken(tokenPayload);

    // Set cookie
    setAuthCookie(res, newToken);

    // 3. Return token and user_info
    var user_info = buildUserInfo(user);
    return res.json({ code: 200, message: '令牌刷新成功', data: { token: newToken, user_info: user_info } });
  } catch (err) {
    console.error('Refresh token error:', err);
    return res.json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// GET /api/auth/check-status
router.get('/check-status', auth.requireAuth, function(req, res) {
  try {
    // 1. Token already verified by requireAuth middleware, req.user is set
    // 2. Check user not disabled in database
    var user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
    if (!user) {
      return res.json({ code: 401, message: '用户不存在', data: null });
    }
    if (user.status === 'disabled') {
      return res.json({ code: 403, message: '该账号已被禁用', data: null, ban_expires_at: user.ban_expires_at || null, ban_reason: user.ban_reason || null });
    }

    // 3. Return user_info and current token
    var token = req.cookies.token || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    var user_info = buildUserInfo(user);
    if (user.is_admin !== req.user.is_admin || user.net_name !== req.user.net_name) {
      var tokenPayload = buildTokenPayload(user);
      token = jwtUtil.generateToken(tokenPayload);
      setAuthCookie(res, token);
    }
    return res.json({ code: 200, message: 'ok', data: { user_info: user_info, token: token } });
  } catch (err) {
    console.error('Check status error:', err);
    return res.json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/auth/logout
router.post('/logout', function(req, res) {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax'
  });
  return res.json({ code: 200, message: '已退出登录', data: null });
});

router.get('/ban-info', authMiddleware, function(req, res) {
  var userId = req.query.user_id;
  if (!userId) {
    return res.status(400).json({ code: 400, message: '缺少用户ID' });
  }
  var user = db.prepare('SELECT status, ban_expires_at, ban_reason, net_name FROM users WHERE user_id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }
  if (user.status !== 'disabled') {
    return res.json({ code: 200, message: 'ok', data: { banned: false } });
  }
  if (user.ban_expires_at) {
    var expiresAt = new Date(user.ban_expires_at + 'Z');
    if (expiresAt <= new Date()) {
      db.prepare('UPDATE users SET status = \'active\', ban_expires_at = NULL, ban_reason = NULL WHERE user_id = ?').run(userId);
      return res.json({ code: 200, message: 'ok', data: { banned: false } });
    }
  }
  res.json({ code: 200, message: 'ok', data: { banned: true, ban_expires_at: user.ban_expires_at, ban_reason: user.ban_reason, net_name: user.net_name } });
});

// POST /api/auth/relay-verify - Internal endpoint for relay-based password verification
router.post('/relay-verify', function(req, res) {
  var relaySecret = req.headers['x-relay-secret'];
  // config.relay.secret 为空时拒绝访问（避免空字符串导致认证被绕过）
  if (!config.relay.secret || !safeCompare(relaySecret || '', config.relay.secret)) {
    return res.status(403).json({ code: 403, message: 'Forbidden' });
  }
  var account = req.body.account;
  var password = req.body.password;
  if (!account || !password) {
    return res.json({ code: 400, message: 'Missing fields', data: null });
  }
  var user = db.prepare(
    'SELECT * FROM users WHERE real_name = ? OR user_id = ? OR net_name = ?'
  ).get(account, account, account);
  if (!user || !user.password_hash) {
    return res.json({ code: 404, message: 'User not found', data: null });
  }
  if (!pwdUtil.verifyPassword(password, user.password_hash)) {
    return res.json({ code: 401, message: 'Wrong password', data: null });
  }
  return res.json({
    code: 200,
    message: 'ok',
    data: {
      user_id: user.user_id,
      net_name: user.net_name,
      real_name: user.real_name,
      gender: user.gender,
      is_admin: user.is_admin,
      status: user.status
    }
  });
});

function tryRelayLogin(account, password, res) {
  var RELAY_SERVERS = config.relay.servers;
  if (!RELAY_SERVERS || RELAY_SERVERS.length === 0) {
    return res.json({ code: 401, message: '账号或密码错误', data: null });
  }

  var http = require('http');
  var https = require('https');
  var completed = false;

  function attemptRelayVerify(relayUrl, callback) {
    var targetUrl = relayUrl.replace(/\/relay$/, '').replace(/ws:\/\//, 'http://').replace(/wss:\/\//, 'https://');
    var verifyUrl = targetUrl + '/api/auth/relay-verify';
    var urlObj;
    try { urlObj = new URL(verifyUrl); } catch (e) { return callback(null); }

    var postData = JSON.stringify({ account: account, password: password });
    var options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Relay-Secret': config.relay.secret
      },
      timeout: 5000
    };

    var client = urlObj.protocol === 'https:' ? https : http;
    var req = client.request(options, function(resp) {
      var body = '';
      resp.on('data', function(chunk) { body += chunk; });
      resp.on('end', function() {
        try {
          var result = JSON.parse(body);
          if (result.code === 200 && result.data) {
            callback(result.data);
          } else {
            callback(null);
          }
        } catch (e) {
          callback(null);
        }
      });
    });
    req.on('error', function() { callback(null); });
    req.on('timeout', function() { req.destroy(); callback(null); });
    req.write(postData);
    req.end();
  }

  var pending = RELAY_SERVERS.length;
  for (var i = 0; i < RELAY_SERVERS.length; i++) {
    (function(relayUrl) {
      attemptRelayVerify(relayUrl, function(userData) {
        if (completed) return;
        pending--;
        if (userData) {
          completed = true;
          var existingUser = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userData.user_id);
          if (!existingUser) {
            db.prepare(
              'INSERT INTO users (user_id, net_name, real_name, gender, password_hash, status, is_admin, info_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
            ).run(userData.user_id, userData.net_name, userData.real_name, userData.gender || '', userData.password_hash, userData.status || 'active', userData.is_admin || 0, '{}');
          } else {
            db.prepare('UPDATE users SET password_hash = ?, net_name = ? WHERE user_id = ?').run(userData.password_hash, userData.net_name, userData.user_id);
          }
          var userRow = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userData.user_id);
          if (userRow) {
            db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE user_id = ?').run(userRow.user_id);
            var tokenPayload = buildTokenPayload(userRow);
            var token = jwtUtil.generateToken(tokenPayload);
            setAuthCookie(res, token);
            var user_info = buildUserInfo(userRow);
            return res.json({ code: 200, message: '登录成功', data: { user_info: user_info, token: token } });
          }
          return res.json({ code: 401, message: '账号或密码错误', data: null });
        }
        if (pending === 0 && !completed) {
          completed = true;
          return res.json({ code: 401, message: '账号或密码错误', data: null });
        }
      });
    })(RELAY_SERVERS[i]);
  }
}

module.exports = router;
