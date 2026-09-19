// 临时诊断2：搜索风控绕过候选
var engine = require('./plugins/netease-music/backend/ncm/engine');
var https = require('https');

function req(uri, data, cryptoType) {
  return engine.request(uri, data, { crypto: cryptoType || 'weapi', cookie: {}, timeout: 10000 });
}

function httpsGet(url, headers) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    }).on('error', reject);
  });
}

function parseJson(res) {
  try { return JSON.parse(res.text); } catch (e) { return null; }
}

(async function () {
  // 1. weapi 原版搜索 /api/search/get（之前只测了明文版）
  try {
    var r = await req('/api/search/get', { s: '周杰伦', type: 1, limit: 5, offset: 0 }, 'weapi');
    var b = r.body || {};
    console.log('weapi /api/search/get => code:', b.code, '| songs:', ((b.result || {}).songs || b.songs || []).length);
  } catch (e) { console.log('weapi search => ERROR:', (e && e.message) || e); }

  // 2. eapi /api/search/pc
  try {
    var r2 = await req('/api/search/pc', { s: '周杰伦', type: 1, limit: 5 }, 'eapi');
    var b2 = r2.body || {};
    var cnt2 = ((b2.result || {}).songs || []).length;
    console.log('eapi /api/search/pc => code:', b2.code, '| songs:', cnt2);
  } catch (e) { console.log('eapi search => ERROR:', (e && e.message) || e); }

  // 3. interface.music.163.com 明文
  try {
    var r3 = await httpsGet('https://interface.music.163.com/api/search/get/web?s=' + encodeURIComponent('周杰伦') + '&type=1&limit=5', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://music.163.com/',
      'Cookie': 'os=pc; appver=2.9.7'
    });
    var b3 = parseJson(r3);
    if (b3) {
      var cnt3 = ((b3.result || {}).songs || []).length;
      console.log('interface search => code:', b3.code, '| songs:', cnt3);
    } else {
      console.log('interface search => non-json, status:', r3.status, '| preview:', r3.text.substring(0, 120));
    }
  } catch (e) { console.log('interface search => ERROR:', (e && e.message) || e); }

  // 4. 主页预热 cookie 后明文搜索
  try {
    var home = await httpsGet('https://music.163.com/', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/80.0'
    });
    var setCookies = (home.headers['set-cookie'] || []).map(function (c) { return c.split(';')[0]; });
    var cookieStr = 'os=pc; appver=2.9.7; ' + setCookies.join('; ');
    console.log('home cookies:', setCookies.length ? setCookies.join(' | ').substring(0, 100) : '(none)');
    var r4 = await httpsGet('https://music.163.com/api/search/get?s=' + encodeURIComponent('周杰伦') + '&type=1&limit=5', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/80.0',
      'Referer': 'https://music.163.com/',
      'Cookie': cookieStr
    });
    var b4 = parseJson(r4);
    if (b4) {
      var cnt4 = ((b4.result || {}).songs || []).length;
      console.log('warmup plain search => code:', b4.code, '| songs:', cnt4);
      if (cnt4) {
        var s4 = b4.result.songs[0];
        console.log('  first:', s4.name, '| album.picUrl:', !!(s4.album && s4.album.picUrl));
      }
    } else {
      console.log('warmup plain search => non-json, status:', r4.status, '| preview:', r4.text.substring(0, 120));
    }
  } catch (e) { console.log('warmup => ERROR:', (e && e.message) || e); }
})();
