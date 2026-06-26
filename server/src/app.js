var crashLogger = require('./utils/crash-logger');
crashLogger.installCrashHandlers();

require('dotenv').config();
var express = require('express');
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
var PORT = process.env.PORT || 9001;

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
  // 未配置 CORS_ORIGINS 时禁止跨域（同源访问不受影响，避免任意网站携带凭证跨域访问）
  corsOptions = { origin: false, credentials: false };
}
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(compression());
app.use('/api/auth', rateLimit({ max: 60, windowMs: 60000, message: '登录请求过于频繁，请稍后再试' }));
app.use('/api/admin', rateLimit({ max: 200, windowMs: 60000 }));
app.use('/api/ai-chat', rateLimit({ max: 30, windowMs: 60000, message: 'AI请求过于频繁，请稍后再试' }));
app.use('/api/community', rateLimit({ max: 120, windowMs: 60000 }));
app.use('/api/chat', rateLimit({ max: 120, windowMs: 60000 }));

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
    // 支持WASM等跨域嵌入资源加载
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

// FontAwesome字体文件兼容路由 - 确保旧缓存CSS的字体请求也能正常返回
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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/ai-chat', require('./routes/ai-chat'));
app.use('/api/resources', require('./routes/resource'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/community', require('./routes/community'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/cloud', require('./routes/cloud'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/level', require('./routes/level'));
app.use('/api/cdn', require('./routes/cdn-proxy'));
app.use('/api/music', require('./routes/music'));
app.use('/api/system', require('./routes/system'));

// Setup 页面路由
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
    if (req.query._v !== currentHash) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ClassNet</title></head><body style="margin:0;background:#0a0a1a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,sans-serif"><div style="text-align:center"><div style="font-size:18px;margin-bottom:12px">正在更新资源...</div><div style="font-size:13px;opacity:.6">请稍候</div></div><script>try{if(\'caches\' in window)caches.keys().then(function(n){for(var i=0;i<n.length;i++)caches.delete(n[i]);});}catch(e){}location.replace(location.pathname+\'?_v=' + currentHash + '&_t=\' + Date.now());</' + 'script></body></html>');
      return;
    }
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
  }
  res.status(status).json({ code: status, message: message });
});

var portRetries = 0;
var MAX_PORT_RETRIES = 10;

var server = app.listen(PORT, function() {
  portRetries = 0;
  console.log('ClassNet Server running on port ' + PORT);
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
      console.error('[Server] Port ' + PORT + ' still in use after ' + MAX_PORT_RETRIES + ' retries. Exiting.');
      process.exit(1);
    }
    var delay = 3000 + portRetries * 2000;
    console.error('[Server] Port ' + PORT + ' is in use. Retry ' + portRetries + '/' + MAX_PORT_RETRIES + ' in ' + delay + 'ms...');
    setTimeout(function() {
      try { server.close(); } catch (e) {}
      server.listen(PORT);
    }, delay);
  } else {
    console.error('[Server] Server error:', err.message);
  }
});

var isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[Server] Received ' + signal + ', shutting down gracefully...');

  try {
    var chatServer = require('./ws/chat-server');
    if (chatServer.broadcast) {
      chatServer.broadcast({ type: 'server_shutting_down', message: '服务器正在重启，请稍后...' });
    }
  } catch (e) {}

  setTimeout(function() {
    server.close(function() {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
  }, 1000);

  setTimeout(function() {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', function() { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', function() { gracefulShutdown('SIGINT'); });

require('./ws/chat-server');

// ======== 天气提醒定时检查 ========
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
          var weatherRoute = require('./routes/weather');
          weatherRoute.checkWeatherAlert().then(function(result) {
            if (result.has_rain || result.has_warning) {
              var alertType = 'both';
              if (result.has_rain && !result.has_warning) alertType = 'rain';
              else if (!result.has_rain && result.has_warning) alertType = 'warning';

              try {
                var relayBus = require('./utils/relay-bus');
                // 天气预警仅广播本地，不中继
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

    // 清理过期的 lastChecked 记录（保留当天之前的）
    var keys = Object.keys(weatherAlertLastChecked);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].indexOf(todayKey) === -1) {
        delete weatherAlertLastChecked[keys[k]];
      }
    }
  }, 60000); // 每分钟检查一次
}

startWeatherAlertScheduler();
