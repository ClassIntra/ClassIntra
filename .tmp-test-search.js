// 临时诊断3：weapi search/get 各分类字段结构验证
var engine = require('./plugins/netease-music/backend/ncm/engine');

function req(uri, data, cryptoType) {
  return engine.request(uri, data, { crypto: cryptoType || 'weapi', cookie: {}, timeout: 10000 });
}

function brief(o, keys) {
  if (!o) return 'null';
  var parts = [];
  keys.forEach(function (k) { parts.push(k + '=' + JSON.stringify(o[k]).substring(0, 60)); });
  return parts.join(' ');
}

(async function () {
  // 单曲 type=1
  try {
    var r = await req('/api/search/get', { s: '周杰伦', type: 1, limit: 3, offset: 0 }, 'weapi');
    var b = r.body || {};
    var songs = ((b.result || {}).songs) || [];
    console.log('type=1 songs:', songs.length, '| songCount:', (b.result || {}).songCount);
    if (songs[0]) {
      console.log('  song keys:', Object.keys(songs[0]).join(','));
      console.log('  first:', brief(songs[0], ['id', 'name']));
      console.log('  artists:', JSON.stringify(songs[0].artists || []).substring(0, 120));
      console.log('  album:', brief(songs[0].album, ['id', 'name', 'picUrl']));
    }
  } catch (e) { console.log('type=1 ERROR:', (e && e.message) || e); }

  // 歌单 type=1000
  try {
    var r2 = await req('/api/search/get', { s: '流行', type: 1000, limit: 3, offset: 0 }, 'weapi');
    var b2 = r2.body || {};
    var pls = ((b2.result || {}).playlists) || [];
    console.log('\ntype=1000 playlists:', pls.length, '| playlistCount:', (b2.result || {}).playlistCount);
    if (pls[0]) {
      console.log('  pl keys:', Object.keys(pls[0]).join(','));
      console.log('  first:', brief(pls[0], ['id', 'name', 'trackCount', 'playCount', 'coverImgUrl', 'creator']));
    }
  } catch (e) { console.log('type=1000 ERROR:', (e && e.message) || e); }

  // 歌手 type=100
  try {
    var r3 = await req('/api/search/get', { s: '林俊杰', type: 100, limit: 3, offset: 0 }, 'weapi');
    var b3 = r3.body || {};
    var ars = ((b3.result || {}).artists) || [];
    console.log('\ntype=100 artists:', ars.length, '| artistCount:', (b3.result || {}).artistCount);
    if (ars[0]) {
      console.log('  ar keys:', Object.keys(ars[0]).join(','));
      console.log('  first:', brief(ars[0], ['id', 'name', 'picUrl', 'img1v1Url', 'alias']));
    }
  } catch (e) { console.log('type=100 ERROR:', (e && e.message) || e); }

  // 专辑 type=10
  try {
    var r4 = await req('/api/search/get', { s: '范特西', type: 10, limit: 3, offset: 0 }, 'weapi');
    var b4 = r4.body || {};
    var abs = ((b4.result || {}).albums) || [];
    console.log('\ntype=10 albums:', abs.length, '| albumCount:', (b4.result || {}).albumCount);
    if (abs[0]) {
      console.log('  al keys:', Object.keys(abs[0]).join(','));
      console.log('  first:', brief(abs[0], ['id', 'name', 'picUrl', 'artist']));
    }
  } catch (e) { console.log('type=10 ERROR:', (e && e.message) || e); }

  // 搜索联想 weapi
  try {
    var r5 = await req('/api/search/suggest/keyword', { s: '周' }, 'weapi');
    var b5 = r5.body || {};
    console.log('\nsuggest/keyword => code:', b5.code, '| allMatch:', JSON.stringify(b5.result && b5.result.allMatch || []).substring(0, 200));
  } catch (e) { console.log('suggest/keyword ERROR:', (e && e.message) || e); }
})();
