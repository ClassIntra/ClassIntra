var crashLogger = require('./utils/crash-logger');
crashLogger.installCrashHandlers();

var errorsLib = require('./core/errors');
var globalErrorHandler = errorsLib.globalErrorHandler;

require('dotenv').config();
var express = require('express');
var https = require('https');
var path = require('path');
var fs = require('fs');
var cookieParser = require('cookie-parser');
var cors = require('cors');
var helmet = require('helmet');
var morgan = require('morgan');
var compression = require('compression');
var rateLimit = require('./middleware/rate-limit').createRateLimiter;
var config = require('./config');
var initDb = require('./utils/init-db');

initDb.initDatabase();

var app = express();
var HTTPS_PORT = process.env.HTTPS_PORT || 9001;

// 证书文件路径
var certsDir = path.join(__dirname, '../certs');
var certFiles = fs.readdirSync(certsDir).filter(function(f) { return f.endsWith('.pem'); });
var keyFile = certFiles.find(function(f) { return f.includes('-key.pem'); });
var certFile = certFiles.find(function(f) { return !f.includes('-key.pem'); });

var certPath = path.join(certsDir, certFile);
var keyPath = path.join(certsDir, keyFile);

// 检查证书文件
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('[HTTPS] 证书文件未找到:', certPath, keyPath);
  console.error('[HTTPS] 请运行 scripts/generate-certs.ps1 生成证书');
  process.exit(1);
}

var sslOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
}));

var corsOrigins = process.env.CORS_ORIGINS || '';
var corsOptions;
if (corsOrigins) {
  var originList = corsOrigins.split(',').map(function(s) { return s.trim(); });
  corsOptions = {
    origin: function(origin, callback) {
      if (!origin || originList.indexOf(origin) !== -1) callback(null, true);
      else callback(null, false);
    },
    credentials: true
  };
} else {
  corsOptions = { origin: false, credentials: false };
}
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: function(req, res) {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use('/api/auth', rateLimit({ max: 60, windowMs: 60000, message: '登录请求过于频繁,请稍后再试' }));
app.use('/api/admin', rateLimit({ max: 200, windowMs: 60000 }));

app.use(function(req, res, next) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

app.use('/resources', express.static(config.resourcesDir, {
  maxAge: '0',
  immutable: false,
  setHeaders: function(res, filePath) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.setHeader('Access-Control-Allow-Origin', '*');
    var ext = path.extname(filePath).substring(1).toLowerCase();
    if (ext === 'wasm' || ext === 'js' || ext === 'mjs' || ext === 'json') {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    if (ext === 'wasm') {
      res.setHeader('Content-Type', 'application/wasm');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));

var faFontDir = path.join(config.resourcesDir, 'public', 'fontawesome', 'webfonts');
var faFontFiles = {
  'fa-solid-900.woff2': null, 'fa-solid-900.ttf': null,
  'fa-regular-400.woff2': null, 'fa-regular-400.ttf': null,
  'fa-brands-400.woff2': null, 'fa-brands-400.ttf': null,
  'fa-v4compatibility.woff2': null, 'fa-v4compatibility.ttf': null
};
try { fs.readdirSync(faFontDir).forEach(function(f) { if (faFontFiles.hasOwnProperty(f)) faFontFiles[f] = path.join(faFontDir, f); }); } catch(e) {}

app.use(function(req, res, next) {
  var fname = path.basename(req.path);
  if (faFontFiles[fname]) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(faFontFiles[fname]);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, '../../client/dist'), {
  index: false,
  maxAge: '0',
  immutable: false,
  setHeaders: function(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

try {
  if (fs.existsSync(path.join(__dirname, '../../apps'))) {
    app.use('/apps-static', express.static(path.join(__dirname, '../../apps'), {
      maxAge: '0',
      immutable: false,
      setHeaders: function(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    }));
  }
} catch (e) {
  console.warn('[app] apps-static 静态路由初始化失败（apps/ 目录可能不存在）:', e.message);
}

app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/level', require('./routes/level'));
app.use('/api/cdn', require('./routes/cdn-proxy'));
app.use('/api/system', require('./routes/system'));
app.use('/api/integrations', require('./routes/integrations'));

var routeAggregator = require('./core/route-aggregator');
routeAggregator.mountAppRoutes(app);

var serviceRegistry = require('./core/service-registry').getServiceRegistry();
serviceRegistry.register('db', function() { return require('./utils/db'); });
serviceRegistry.register('errors', function() { return errorsLib; });

app.get('/setup', function(req, res) {
  res.sendFile(path.join(__dirname, '../public/setup.html'));
});

app.get('*', function(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  var versionInfo = {};
  try {
    versionInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8'));
  } catch (e) {}
  var currentHash = versionInfo.buildHash || '';
  var clientHash = req.cookies && req.cookies._cv ? req.cookies._cv : '';

  if (currentHash && clientHash !== currentHash) {
    res.setHeader('Set-Cookie', '_cv=' + currentHash + '; Path=/; Max-Age=31536000; SameSite=Lax');
  }

  var indexPath = path.join(__dirname, '../../client/dist/index.html');
  try {
    var html = fs.readFileSync(indexPath, 'utf8');
    var wsPort = process.env.WS_PORT || '10001';
    var injectScript = '<script>window.__WS_PORT__="' + wsPort + '";</script>';
    html = html.replace('<head>', '<head>' + injectScript);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    res.sendFile(indexPath);
  }
});

app.use(function(err, req, res, next) {
  var status = err.status || err.statusCode || 500;
  var message = '服务器内部错误';
  if (status === 400) message = '请求参数错误';
  else if (status === 401) message = '未授权访问';
  else if (status === 403) message = '访问被拒绝';
  else if (status === 404) message = '资源不存在';
  else if (status === 429) message = '请求过于频繁';
  else if (status === 413) message = '请求数据过大';
  if (status < 500) {
    console.warn('[API] ' + req.method + ' ' + req.path + ' -> ' + status + ': ' + (err.message || message));
  } else {
    console.error('[API] ' + req.method + ' ' + req.path + ' -> ' + status + ':', err.message || 'Unknown error');
    globalErrorHandler.handle(err);
  }
  res.status(status).json({ code: status, message: message });
});

var server = https.createServer(sslOptions, app);

var portRetries = 0;
var MAX_PORT_RETRIES = 10;

server.listen(HTTPS_PORT, function() {
  portRetries = 0;
  console.log('[HTTPS] ClassIntra Server running on https://localhost:' + HTTPS_PORT);
  console.log('[HTTPS] SSL certificate loaded from:', certsDir);
  console.log('[HTTPS] Certificate file:', certFile);
  console.log('[HTTPS] Key file:', keyFile);

  try {
    var jwtUtil = require('./utils/qweather-jwt');
    jwtUtil.warmUp().then(function(ok) {
      if (ok) console.log('[QWeather] JWT token pre-warmed');
      else console.warn('[QWeather] JWT warm-up failed');
    });
  } catch (e) {}
});

server.on('error', function(err) {
  if (err.code === 'EADDRINUSE') {
    portRetries++;
    if (portRetries > MAX_PORT_RETRIES) {
      console.error('[HTTPS] Port ' + HTTPS_PORT + ' still in use after ' + MAX_PORT_RETRIES + ' retries. Exiting.');
      process.exit(1);
    }
    var delay = 3000 + portRetries * 2000;
    console.error('[HTTPS] Port ' + HTTPS_PORT + ' is in use. Retry ' + portRetries + '/' + MAX_PORT_RETRIES + ' in ' + delay + 'ms...');
    setTimeout(function() {
      try { server.close(); } catch (e) {}
      server.listen(HTTPS_PORT);
    }, delay);
  } else {
    console.error('[HTTPS] Server error:', err.message);
  }
});

var isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[HTTPS] Received ' + signal + ', shutting down gracefully...');

  try {
    var chatServer = require('./ws/chat-server');
    if (chatServer.broadcast) {
      chatServer.broadcast({ type: 'server_shutting_down', message: '服务器正在重启，请稍后...' });
    }
  } catch (e) {}

  setTimeout(function() {
    server.close(function() {
      console.log('[HTTPS] HTTPS server closed');
      process.exit(0);
    });
  }, 1000);

  setTimeout(function() {
    console.error('[HTTPS] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', function() { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', function() { gracefulShutdown('SIGINT'); });

// WebSocket 服务器（HTTPS 端口）
// chat-server.js 会自动启动，这里不需要额外处理

// 天气提醒定时检查
var weatherAlertLastChecked = {};

function startWeatherAlertScheduler() {
  setInterval(function() {
    var db = require('./utils/db');
    var now = new Date();
    var currentTime = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    var todayKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);

    try {
      var schedules = db.prepare('SELECT * FROM weather_alert_settings WHERE enabled = 1').all();
      for (var i = 0; i < schedules.length; i++) {
        var scheduleKey = schedules[i].id + '_' + todayKey;
        if (schedules[i].schedule_time === currentTime && !weatherAlertLastChecked[scheduleKey]) {
          weatherAlertLastChecked[scheduleKey] = true;
          console.log('[WeatherAlert] Scheduled check triggered at ' + currentTime);
          var weatherRoute = require('../../../apps/weather/backend/routes');
          weatherRoute.checkWeatherAlert().then(function(result) {
            if (result.has_rain || result.has_warning) {
              var alertType = 'both';
              if (result.has_rain && !result.has_warning) alertType = 'rain';
              else if (!result.has_rain && result.has_warning) alertType = 'warning';

              try {
                var relayBus = require('./utils/relay-bus');
                relayBus.emitLocal('weather_alert', {
                  alert_type: alertType,
                  rain_text: result.rain_text,
                  warnings: result.warnings,
                  timestamp: new Date().toISOString()
                });
                console.log('[WeatherAlert] Broadcast sent: type=' + alertType + ', rain=' + result.has_rain + ', warning=' + result.has_warning);
              } catch (e) {
                console.error('[WeatherAlert] Broadcast failed:', e.message);
              }
            } else {
              console.log('[WeatherAlert] No rain or warning detected at ' + currentTime);
            }
          }).catch(function(err) {
            console.error('[WeatherAlert] Check failed:', err.message);
          });
        }
      }
    } catch (e) {
      console.error('[WeatherAlert] Scheduler error:', e.message);
    }

    var keys = Object.keys(weatherAlertLastChecked);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].indexOf(todayKey) === -1) {
        delete weatherAlertLastChecked[keys[k]];
      }
    }
  }, 60000);
}

startWeatherAlertScheduler();