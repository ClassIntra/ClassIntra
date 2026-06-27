var express = require('express');
var router = express.Router();
var axios = require('axios');
var path = require('path');
var fs = require('fs');
var config = require('../config');

var CDN_CACHE_DIR = path.join(config.resourcesDir, '.cdn-cache');
var CDN_CACHE_TTL = 3600000;

if (!fs.existsSync(CDN_CACHE_DIR)) {
  try { fs.mkdirSync(CDN_CACHE_DIR, { recursive: true }); } catch (e) {}
}

function getCacheKey(url) {
  var hash = 0;
  for (var i = 0; i < url.length; i++) {
    var ch = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function getCachePath(key, contentType) {
  var ext = '.bin';
  if (contentType) {
    if (contentType.indexOf('javascript') !== -1) ext = '.js';
    else if (contentType.indexOf('css') !== -1) ext = '.css';
    else if (contentType.indexOf('json') !== -1) ext = '.json';
    else if (contentType.indexOf('svg') !== -1) ext = '.svg';
    else if (contentType.indexOf('png') !== -1) ext = '.png';
    else if (contentType.indexOf('jpeg') !== -1 || contentType.indexOf('jpg') !== -1) ext = '.jpg';
    else if (contentType.indexOf('webp') !== -1) ext = '.webp';
    else if (contentType.indexOf('woff2') !== -1) ext = '.woff2';
    else if (contentType.indexOf('woff') !== -1) ext = '.woff';
    else if (contentType.indexOf('ttf') !== -1) ext = '.ttf';
  }
  return path.join(CDN_CACHE_DIR, key + ext);
}

var ALLOWED_CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.bootcdn.net'
];

function isAllowedCdnHost(url) {
  try {
    var parsed = new URL(url);
    var hostname = parsed.hostname.toLowerCase();
    for (var i = 0; i < ALLOWED_CDN_HOSTS.length; i++) {
      if (hostname === ALLOWED_CDN_HOSTS[i] || hostname.endsWith('.' + ALLOWED_CDN_HOSTS[i])) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

router.get('/proxy', function(req, res) {
  var targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ code: 400, message: '缺少 url 参数' });
  }

  if (!isAllowedCdnHost(targetUrl)) {
    return res.status(403).json({ code: 403, message: '不允许的CDN域名' });
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ code: 400, message: 'URL格式无效' });
  }

  var cacheKey = getCacheKey(targetUrl);
  var metaPath = path.join(CDN_CACHE_DIR, cacheKey + '.meta.json');

  try {
    if (fs.existsSync(metaPath)) {
      var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (Date.now() - meta.timestamp < CDN_CACHE_TTL) {
        var cachedPath = meta.filePath;
        if (fs.existsSync(cachedPath)) {
          res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          fs.createReadStream(cachedPath).pipe(res);
          return;
        }
      }
    }
  } catch (e) {}

  axios({
    method: 'get',
    url: targetUrl,
    responseType: 'stream',
    timeout: 15000,
    maxRedirects: 0, // 禁止跟随重定向，防止 SSRF 通过重定向访问内网
    headers: {
      'User-Agent': 'ClassNet-Server/1.0',
      'Accept': '*/*'
    }
  }).then(function(response) {
    var contentType = response.headers['content-type'] || 'application/octet-stream';
    var cachedPath = getCachePath(cacheKey, contentType);

    var meta = {
      url: targetUrl,
      contentType: contentType,
      timestamp: Date.now(),
      filePath: cachedPath
    };

    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    } catch (e) {}

    var writeStream = fs.createWriteStream(cachedPath);
    response.data.pipe(writeStream);

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    response.data.pipe(res);
  }).catch(function(err) {
    var statusCode = err.response ? err.response.status : 502;
    var message = err.code === 'ECONNABORTED' ? 'CDN请求超时' : 'CDN请求失败';
    res.status(statusCode).json({ code: statusCode, message: message });
  });
});

router.post('/clear-cache', function(req, res) {
  try {
    var files = fs.readdirSync(CDN_CACHE_DIR);
    var cleared = 0;
    for (var i = 0; i < files.length; i++) {
      try {
        fs.unlinkSync(path.join(CDN_CACHE_DIR, files[i]));
        cleared++;
      } catch (e) {}
    }
    res.json({ code: 200, message: '缓存已清理', data: { cleared: cleared } });
  } catch (e) {
    res.json({ code: 200, message: '缓存目录不存在', data: { cleared: 0 } });
  }
});

module.exports = router;
