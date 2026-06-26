var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var auth = require('../middleware/auth');
var config = require('../config');
var db = require('../utils/db');

var MUSIC_DIR = path.join(config.resourcesDir, 'music');
var AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma'];

function parseSongInfo(baseName) {
  var lastDash = baseName.lastIndexOf(' - ');
  if (lastDash !== -1) {
    return {
      title: baseName.substring(0, lastDash).trim(),
      artist: baseName.substring(lastDash + 3).trim()
    };
  }
  lastDash = baseName.lastIndexOf('-');
  if (lastDash !== -1) {
    return {
      title: baseName.substring(0, lastDash).trim(),
      artist: baseName.substring(lastDash + 1).trim()
    };
  }
  var parenMatch = baseName.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), artist: parenMatch[2].trim() };
  }
  return { title: baseName, artist: '未知艺术家' };
}

router.use(auth.requireAuth);

router.get('/list', function(req, res) {
  if (!fs.existsSync(MUSIC_DIR)) {
    return res.json({ code: 200, data: { songs: [] } });
  }

  var files;
  try {
    files = fs.readdirSync(MUSIC_DIR);
  } catch (e) {
    return res.json({ code: 200, data: { songs: [] } });
  }

  var songs = [];
  var audioMap = {};
  var fileSet = {};

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.startsWith('.')) continue;
    fileSet[file] = true;
    var ext = path.extname(file).toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) !== -1) {
      var baseName = file.substring(0, file.length - ext.length);
      audioMap[baseName] = { file: file, ext: ext };
    }
  }

  var userId = req.user ? req.user.user_id : 0;
  var favRows = [];
  if (userId) {
    try {
      favRows = db.prepare('SELECT song_id FROM music_favorites WHERE user_id = ?').all(userId);
    } catch (e) {}
  }
  var favSet = {};
  for (var fi = 0; fi < favRows.length; fi++) {
    favSet[favRows[fi].song_id] = true;
  }

  var baseNames = Object.keys(audioMap);
  for (var j = 0; j < baseNames.length; j++) {
    var name = baseNames[j];
    var info = audioMap[name];
    var songInfo = parseSongInfo(name);

    var lrcName = name + '.lrc';
    var hasLyrics = !!fileSet[lrcName];

    var coverFileName = '';
    var coverJpg = name + '.jpg';
    var coverPng = name + '.png';
    var coverJpgUpper = name + '.JPG';
    var coverPngUpper = name + '.PNG';

    if (fileSet[coverJpg]) {
      coverFileName = coverJpg;
    } else if (fileSet[coverJpgUpper]) {
      coverFileName = coverJpgUpper;
    } else if (fileSet[coverPng]) {
      coverFileName = coverPng;
    } else if (fileSet[coverPngUpper]) {
      coverFileName = coverPngUpper;
    } else {
      for (var fk in fileSet) {
        var fkLower = fk.toLowerCase();
        if ((fkLower === coverJpg.toLowerCase() || fkLower === coverPng.toLowerCase()) && !fk.startsWith('.')) {
          coverFileName = fk;
          break;
        }
      }
    }

    var hasCover = !!coverFileName;
    var defaultCoverFile = '';
    var defaultCoverNames = ['cover.jpg', 'cover.png', 'Cover.jpg', 'Cover.png', 'COVER.JPG', 'COVER.PNG'];
    for (var di = 0; di < defaultCoverNames.length; di++) {
      if (fileSet[defaultCoverNames[di]]) {
        defaultCoverFile = defaultCoverNames[di];
        break;
      }
    }
    if (!defaultCoverFile) {
      for (var dk in fileSet) {
        var dkLower = dk.toLowerCase();
        if ((dkLower === 'cover.jpg' || dkLower === 'cover.png') && !dk.startsWith('.')) {
          defaultCoverFile = dk;
          break;
        }
      }
    }
    var defaultCover = defaultCoverFile ? '/resources/music/' + encodeURIComponent(defaultCoverFile) : null;

    var stat;
    try {
      stat = fs.statSync(path.join(MUSIC_DIR, info.file));
    } catch (e) {
      continue;
    }

    songs.push({
      id: name,
      title: songInfo.title,
      artist: songInfo.artist,
      audioUrl: '/resources/music/' + encodeURIComponent(info.file),
      hasLyrics: hasLyrics,
      lyricsUrl: hasLyrics ? '/music/lyrics?file=' + encodeURIComponent(lrcName) : null,
      hasCover: hasCover,
      coverUrl: hasCover ? '/resources/music/' + encodeURIComponent(coverFileName) : defaultCover,
      size: stat.size,
      format: info.ext.substring(1),
      isFavorite: !!favSet[name]
    });
  }

  songs.sort(function(a, b) {
    return a.title.localeCompare(b.title, 'zh-CN');
  });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ code: 200, data: { songs: songs } });
});

router.get('/lyrics', function(req, res) {
  var file = req.query.file;
  if (!file) {
    return res.status(400).json({ code: 400, message: '参数错误' });
  }

  var basename = path.basename(file);
  var resolved = path.resolve(MUSIC_DIR, basename);
  if (!resolved.startsWith(MUSIC_DIR)) {
    return res.status(403).json({ code: 403, message: '禁止访问' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ code: 404, message: '歌词文件不存在' });
  }

  var content = fs.readFileSync(resolved, 'utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ code: 200, data: { content: content } });
});

router.post('/favorite', function(req, res) {
  var userId = req.user.user_id;
  var songId = req.body.songId;
  if (!songId) return res.status(400).json({ code: 400, message: '参数错误' });

  try {
    var existing = db.prepare('SELECT id FROM music_favorites WHERE user_id = ? AND song_id = ?').get(userId, songId);
    if (existing) {
      db.prepare('DELETE FROM music_favorites WHERE user_id = ? AND song_id = ?').run(userId, songId);
      res.json({ code: 200, data: { isFavorite: false } });
    } else {
      db.prepare('INSERT INTO music_favorites (user_id, song_id) VALUES (?, ?)').run(userId, songId);
      res.json({ code: 200, data: { isFavorite: true } });
    }
  } catch (e) {
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

router.get('/favorites', function(req, res) {
  var userId = req.user.user_id;
  try {
    var rows = db.prepare('SELECT song_id FROM music_favorites WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    var ids = [];
    for (var i = 0; i < rows.length; i++) ids.push(rows[i].song_id);
    res.json({ code: 200, data: { songIds: ids } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

router.post('/playlist/create', function(req, res) {
  var userId = req.user.user_id;
  var name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ code: 400, message: '歌单名称不能为空' });
  var description = (req.body.description || '').trim();

  try {
    var info = db.prepare('INSERT INTO music_playlists (user_id, name, description) VALUES (?, ?, ?)').run(userId, name, description);
    res.json({ code: 200, data: { id: info.lastInsertRowid, name: name, description: description } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '创建失败' });
  }
});

router.get('/playlists', function(req, res) {
  var userId = req.user.user_id;
  try {
    var playlists = db.prepare(
      'SELECT p.id, p.name, p.description, p.cover_url, p.share_code, p.created_at, p.updated_at, ' +
      '(SELECT COUNT(*) FROM music_playlist_songs WHERE playlist_id = p.id) AS song_count ' +
      'FROM music_playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC'
    ).all(userId);
    res.json({ code: 200, data: { playlists: playlists } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

router.post('/playlist/update', function(req, res) {
  var userId = req.user.user_id;
  var playlistId = req.body.playlistId;
  var name = (req.body.name || '').trim();
  var description = (req.body.description || '').trim();
  if (!playlistId) return res.status(400).json({ code: 400, message: '参数错误' });
  if (!name) return res.status(400).json({ code: 400, message: '歌单名称不能为空' });

  try {
    var pl = db.prepare('SELECT id FROM music_playlists WHERE id = ? AND user_id = ?').get(playlistId, userId);
    if (!pl) return res.status(403).json({ code: 403, message: '无权限' });
    db.prepare('UPDATE music_playlists SET name = ?, description = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, description, playlistId);
    res.json({ code: 200, data: {} });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

router.post('/playlist/delete', function(req, res) {
  var userId = req.user.user_id;
  var playlistId = req.body.playlistId;
  if (!playlistId) return res.status(400).json({ code: 400, message: '参数错误' });

  try {
    var pl = db.prepare('SELECT id FROM music_playlists WHERE id = ? AND user_id = ?').get(playlistId, userId);
    if (!pl) return res.status(403).json({ code: 403, message: '无权限' });
    db.prepare('DELETE FROM music_playlist_songs WHERE playlist_id = ?').run(playlistId);
    db.prepare('DELETE FROM music_playlists WHERE id = ?').run(playlistId);
    res.json({ code: 200, data: {} });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

router.post('/playlist/add-song', function(req, res) {
  var userId = req.user.user_id;
  var playlistId = req.body.playlistId;
  var songId = req.body.songId;
  if (!playlistId || !songId) return res.status(400).json({ code: 400, message: '参数错误' });

  try {
    var pl = db.prepare('SELECT id FROM music_playlists WHERE id = ? AND user_id = ?').get(playlistId, userId);
    if (!pl) return res.status(403).json({ code: 403, message: '无权限' });

    var existing = db.prepare('SELECT id FROM music_playlist_songs WHERE playlist_id = ? AND song_id = ?').get(playlistId, songId);
    if (existing) return res.json({ code: 200, data: { message: '已存在' } });

    var maxOrder = db.prepare('SELECT MAX(sort_order) AS mo FROM music_playlist_songs WHERE playlist_id = ?').get(playlistId);
    var sortOrder = (maxOrder && maxOrder.mo != null) ? maxOrder.mo + 1 : 0;

    db.prepare('INSERT INTO music_playlist_songs (playlist_id, song_id, sort_order) VALUES (?, ?, ?)').run(playlistId, songId, sortOrder);
    db.prepare('UPDATE music_playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(playlistId);
    res.json({ code: 200, data: {} });
  } catch (e) {
    res.status(500).json({ code: 500, message: '添加失败' });
  }
});

router.post('/playlist/remove-song', function(req, res) {
  var userId = req.user.user_id;
  var playlistId = req.body.playlistId;
  var songId = req.body.songId;
  if (!playlistId || !songId) return res.status(400).json({ code: 400, message: '参数错误' });

  try {
    var pl = db.prepare('SELECT id FROM music_playlists WHERE id = ? AND user_id = ?').get(playlistId, userId);
    if (!pl) return res.status(403).json({ code: 403, message: '无权限' });

    db.prepare('DELETE FROM music_playlist_songs WHERE playlist_id = ? AND song_id = ?').run(playlistId, songId);
    db.prepare('UPDATE music_playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(playlistId);
    res.json({ code: 200, data: {} });
  } catch (e) {
    res.status(500).json({ code: 500, message: '移除失败' });
  }
});

router.get('/playlist/detail', function(req, res) {
  var playlistId = req.query.playlistId;
  if (!playlistId) return res.status(400).json({ code: 400, message: '参数错误' });

  try {
    var pl = db.prepare('SELECT * FROM music_playlists WHERE id = ?').get(playlistId);
    if (!pl) return res.status(404).json({ code: 404, message: '歌单不存在' });

    var songs = db.prepare(
      'SELECT song_id, sort_order FROM music_playlist_songs WHERE playlist_id = ? ORDER BY sort_order'
    ).all(playlistId);
    var songIds = [];
    for (var i = 0; i < songs.length; i++) songIds.push(songs[i].song_id);

    res.json({ code: 200, data: { playlist: pl, songIds: songIds } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

// 公开获取歌单详情（用于转发分享，不需要 user_id 校验）
router.get('/playlist/:id/public', function(req, res) {
  var playlistId = req.params.id;
  try {
    var playlist = db.prepare('SELECT id, name, description, user_id, created_at FROM music_playlists WHERE id = ?').get(playlistId);
    if (!playlist) {
      return res.status(404).json({ code: 404, message: '歌单不存在' });
    }
    var songs = db.prepare('SELECT song_id, sort_order FROM music_playlist_songs WHERE playlist_id = ? ORDER BY sort_order').all(playlistId);
    playlist.song_count = songs.length;
    playlist.songIds = [];
    for (var i = 0; i < songs.length; i++) playlist.songIds.push(songs[i].song_id);
    res.json({ code: 200, data: playlist });
  } catch (e) {
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

module.exports = router;
