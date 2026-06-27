var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');
var db = require('../utils/db');
var auth = require('../middleware/auth');

var PRE_RECORDS_PATH = path.join(__dirname, '../../config/pre-records.json');
var ENV_PATH = path.join(__dirname, '../../.env');

// 敏感环境变量关键词（值不返回给客户端，防止密钥泄露）
var SENSITIVE_KEYS = ['SECRET', 'KEY', 'PASSWORD', 'PASSWD', 'TOKEN', 'CREDENTIAL'];

function isSensitiveKey(key) {
  var upper = (key || '').toUpperCase();
  for (var i = 0; i < SENSITIVE_KEYS.length; i++) {
    if (upper.indexOf(SENSITIVE_KEYS[i]) > -1) return true;
  }
  return false;
}

// 检查是否已完成初始化（数据库中有普通用户，不止管理员）
function isInitialized() {
  try {
    var row = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    return row.cnt > 2;
  } catch (e) {
    return false;
  }
}

// 初始化完成后要求管理员认证；首次运行时允许匿名访问
function requireSetupAuth(req, res, next) {
  if (!isInitialized()) {
    return next();
  }
  return auth.requireAuth(req, res, function() {
    auth.requireAdmin(req, res, next);
  });
}

// 读取当前配置状态
router.get('/status', requireSetupAuth, function(req, res) {
  var hasPreRecords = fs.existsSync(PRE_RECORDS_PATH);
  var hasEnv = fs.existsSync(ENV_PATH);
  var preRecordsData = null;
  var envData = {};

  if (hasPreRecords) {
    try { preRecordsData = JSON.parse(fs.readFileSync(PRE_RECORDS_PATH, 'utf8')); } catch (e) {}
  }

  if (hasEnv) {
    try {
      var envContent = fs.readFileSync(ENV_PATH, 'utf8');
      envContent.split('\n').forEach(function(line) {
        line = line.trim();
        if (!line || line.indexOf('#') === 0) return;
        var eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          envData[line.substring(0, eqIdx).trim()] = line.substring(eqIdx + 1).trim();
        }
      });
    } catch (e) {}
  }

  // 从 pre-records 推断届数和班级
  var cohorts = [];
  var classes = [];
  if (preRecordsData) {
    var cohortSet = {};
    var classSet = {};
    Object.keys(preRecordsData).forEach(function(key) {
      var records = preRecordsData[key] || [];
      records.forEach(function(r) {
        if (r.user_id && r.user_id.length === 6 && /^\d{6}$/.test(r.user_id)) {
          var yy = r.user_id.substring(0, 2);
          var cc = r.user_id.substring(2, 4);
          if (cc !== '00') {
            cohortSet[yy] = true;
            classSet[cc] = true;
          }
        }
      });
    });
    cohorts = Object.keys(cohortSet).sort();
    classes = Object.keys(classSet).sort();
  }

  // 统计预注册人数
  var preRecordCounts = {};
  if (preRecordsData) {
    Object.keys(preRecordsData).forEach(function(key) {
      preRecordCounts[key] = (preRecordsData[key] || []).length;
    });
  }

  // 检查是否已初始化（数据库中有用户）
  var dbUserCount = 0;
  try {
    var row = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    dbUserCount = row.cnt;
  } catch (e) {}

  // 过滤敏感环境变量（密钥值不返回，防止泄露）
  var safeEnv = {};
  Object.keys(envData).forEach(function(key) {
    if (isSensitiveKey(key)) {
      safeEnv[key] = envData[key] ? '***' : '';
    } else {
      safeEnv[key] = envData[key];
    }
  });

  res.json({
    hasPreRecords: hasPreRecords,
    hasEnv: hasEnv,
    preRecords: preRecordsData,
    env: safeEnv,
    cohorts: cohorts,
    classes: classes,
    preRecordCounts: preRecordCounts,
    dbUserCount: dbUserCount,
    isFirstRun: dbUserCount <= 2 // 只有管理员账号
  });
});

// 保存届数和班级配置 + 预注册名单
router.post('/save', requireSetupAuth, function(req, res) {
  try {
    var data = req.body;
    var cohort = String(data.cohort || '').trim();
    var classNames = data.classNames || {}; // { '08': '8班', '18': '18班' }
    var adminIds = data.adminIds || [];
    var records = data.records || {}; // { 'class08': [...], 'class18': [...] }

    // 验证届数
    if (!cohort || !/^\d{2}$/.test(cohort)) {
      return res.status(400).json({ code: 400, message: '届数必须为2位数字（如25代表2025届）' });
    }

    // 验证班级
    var classKeys = Object.keys(classNames);
    if (classKeys.length === 0) {
      return res.status(400).json({ code: 400, message: '至少需要创建一个班级' });
    }
    for (var i = 0; i < classKeys.length; i++) {
      if (!/^\d{2}$/.test(classKeys[i])) {
        return res.status(400).json({ code: 400, message: '班级号必须为2位数字（如08、18）' });
      }
    }

    // 验证管理员ID
    if (adminIds.length === 0) {
      return res.status(400).json({ code: 400, message: '至少需要一个管理员ID' });
    }

    // 构建 pre-records.json
    var preRecordsData = {};
    var allUserIds = {};
    var allRealNames = {};

    for (var ci = 0; ci < classKeys.length; ci++) {
      var classNum = classKeys[ci];
      var classKey = 'class' + classNum;
      var classRecords = records[classKey] || [];

      // 验证并生成 user_id
      var seqCounter = 0;
      for (var ri = 0; ri < classRecords.length; ri++) {
        var rec = classRecords[ri];
        var realName = String(rec.real_name || '').trim();
        var gender = String(rec.gender || '').trim();

        if (!realName) {
          return res.status(400).json({ code: 400, message: '第' + (ri + 1) + '条记录姓名不能为空' });
        }
        if (allRealNames[realName]) {
          return res.status(400).json({ code: 400, message: '姓名重复: ' + realName });
        }
        allRealNames[realName] = true;

        // 检查该学生是否被选为班管（前端通过 is_class_admin 标记）
        var isAdmin = rec.is_class_admin === true;
        var userId;
        if (isAdmin) {
          userId = cohort + classNum + '00'; // 班管ID: YYCC00
        } else {
          seqCounter++;
          // 跳过00序号（预留给班管）
          var seq = String(seqCounter).padStart(2, '0');
          userId = cohort + classNum + seq;
        }

        if (allUserIds[userId]) {
          return res.status(400).json({ code: 400, message: 'user_id 重复: ' + userId });
        }
        allUserIds[userId] = true;

        classRecords[ri] = {
          real_name: realName,
          user_id: userId,
          gender: gender
        };
      }

      preRecordsData[classKey] = classRecords;
    }

    // 写入 pre-records.json
    fs.writeFileSync(PRE_RECORDS_PATH, JSON.stringify(preRecordsData, null, 2), 'utf8');

    // 更新 .env 文件
    var envLines = [];
    if (fs.existsSync(ENV_PATH)) {
      envLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    }

    var envMap = {};
    envLines.forEach(function(line) {
      line = line.trim();
      if (!line || line.indexOf('#') === 0) return;
      var eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        envMap[line.substring(0, eqIdx).trim()] = line.substring(eqIdx + 1).trim();
      }
    });

    envMap['ADMIN_USER_IDS'] = adminIds.join(',');

    // 重建 .env
    var envOutput = [];
    var handledKeys = {};
    // 保留原有行顺序和注释
    envLines.forEach(function(line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed.indexOf('#') === 0) {
        envOutput.push(line);
        return;
      }
      var eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        var key = trimmed.substring(0, eqIdx).trim();
        if (envMap.hasOwnProperty(key)) {
          envOutput.push(key + '=' + envMap[key]);
          handledKeys[key] = true;
        } else {
          envOutput.push(line);
        }
      } else {
        envOutput.push(line);
      }
    });
    // 添加新增的 key
    Object.keys(envMap).forEach(function(key) {
      if (!handledKeys[key]) {
        envOutput.push(key + '=' + envMap[key]);
      }
    });

    fs.writeFileSync(ENV_PATH, envOutput.join('\n'), 'utf8');

    // 重新加载 .env 到 process.env（覆盖内存中的旧值）
    require('dotenv').config({ path: ENV_PATH, override: true });
    // 清除 config 模块缓存，使其从新的 process.env 重建
    try {
      delete require.cache[require.resolve('../config')];
      var initDb = require('../utils/init-db');
      initDb.initDatabase();
    } catch (e) {
      console.error('[Setup] Database re-init error:', e.message);
    }

    res.json({
      code: 200,
      message: '配置保存成功',
      stats: {
        cohort: cohort,
        classes: classKeys.length,
        totalRecords: Object.keys(allUserIds).length,
        adminIds: adminIds
      }
    });
  } catch (e) {
    console.error('[Setup] Save error:', e);
    res.status(500).json({ code: 500, message: '保存失败: ' + e.message });
  }
});

// 从文本导入预注册名单
router.post('/import', requireSetupAuth, function(req, res) {
  try {
    var text = String(req.body.text || '').trim();
    var classNum = String(req.body.classNum || '').trim();

    if (!text) {
      return res.status(400).json({ code: 400, message: '导入文本不能为空' });
    }
    if (!/^\d{2}$/.test(classNum)) {
      return res.status(400).json({ code: 400, message: '班级号必须为2位数字' });
    }

    // 解析文本：每行一个姓名，支持 "序号→姓名" 格式
    var names = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // 去掉序号前缀（如 "1→姓名" 或 "1. 姓名" 或 "1、姓名"）
      var name = line.replace(/^\d+\s*[→.、\s]\s*/, '').trim();
      if (name) names.push(name);
    }

    if (names.length === 0) {
      return res.status(400).json({ code: 400, message: '未识别到有效姓名' });
    }

    res.json({
      code: 200,
      names: names,
      count: names.length
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: '导入失败: ' + e.message });
  }
});

module.exports = router;
