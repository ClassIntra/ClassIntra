var https = require('https');
var path = require('path');
var fs = require('fs');
var express = require('express');

var app = express();
var PORT = process.env.DETECT_PORT || 7998;

var certsDir = path.join(__dirname, '../certs');
var certFiles = fs.readdirSync(certsDir).filter(function(f) { return f.endsWith('.pem'); });
var keyFile = certFiles.find(function(f) { return f.includes('-key.pem'); });
var certFile = certFiles.find(function(f) { return !f.includes('-key.pem'); });

var certPath = path.join(certsDir, certFile);
var keyPath = path.join(certsDir, keyFile);

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('[DETECT] 证书文件未找到:', certPath, keyPath);
  process.exit(1);
}

var sslOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

var pagesDir = path.resolve(__dirname, '../../Resources/Pages');
app.get('/', function(req, res) { res.redirect(302, '/browser-check.html'); });
app.use(express.static(pagesDir));

https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', function() {
  console.log('[DETECT] 浏览器检测 HTTPS 服务已启动: https://0.0.0.0:' + PORT);
  console.log('[DETECT] 页面地址: https://localhost:' + PORT + '/browser-check.html');
});
