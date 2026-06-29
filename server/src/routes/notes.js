var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var db = require('../utils/db');
var time = require('../utils/time');

function convertTimes(row) {
  if (!row) return;
  if (row.created_at) row.created_at = time.toISOString(row.created_at);
  if (row.updated_at) row.updated_at = time.toISOString(row.updated_at);
}

function convertTimesArray(rows) {
  for (var i = 0; i < rows.length; i++) convertTimes(rows[i]);
}

router.get('/notes', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var notes = db.prepare('SELECT * FROM cloud_notes WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC').all(userId);
    for (var i = 0; i < notes.length; i++) {
      try { notes[i].tags = JSON.parse(notes[i].tags || '[]'); } catch (e) { notes[i].tags = []; }
    }
    convertTimesArray(notes);
    res.json({ code: 200, message: 'ok', data: notes });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取笔记失败' });
  }
});

router.get('/notes/public', auth.requireAuth, function(req, res) {
  try {
    var notes = db.prepare('SELECT n.*, u.net_name FROM cloud_notes n LEFT JOIN users u ON n.user_id = u.user_id WHERE n.visibility = ? ORDER BY n.updated_at DESC LIMIT 100').all('public');
    for (var i = 0; i < notes.length; i++) {
      try { notes[i].tags = JSON.parse(notes[i].tags || '[]'); } catch (e) { notes[i].tags = []; }
    }
    convertTimesArray(notes);
    res.json({ code: 200, message: 'ok', data: notes });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取公开笔记失败' });
  }
});

router.get('/notes/:id', auth.requireAuth, function(req, res) {
  var noteId = req.params.id;
  try {
    var note = db.prepare('SELECT * FROM cloud_notes WHERE id = ?').get(noteId);
    if (!note) return res.status(404).json({ code: 404, message: '笔记不存在' });
    if (note.visibility !== 'public' && String(note.user_id) !== String(req.user.user_id)) {
      return res.status(403).json({ code: 403, message: '无权限查看此笔记' });
    }
    try { note.tags = JSON.parse(note.tags || '[]'); } catch (e) { note.tags = []; }
    convertTimes(note);
    res.json({ code: 200, message: 'ok', data: note });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取笔记失败' });
  }
});

router.post('/notes', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var id = req.body.id;
  var title = (req.body.title || '').trim();
  var content = req.body.content || '';
  var tags = req.body.tags || [];
  var folder = (req.body.folder || '默认').trim();
  var visibility = req.body.visibility === 'public' ? 'public' : 'private';
  var isPinned = req.body.is_pinned ? 1 : 0;
  // 画板数据 + 笔记类型
  var canvasData = req.body.canvas_data || '';
  var noteType = req.body.type === 'draw' ? 'draw' : 'note';
  if (!id) return res.status(400).json({ code: 400, message: '缺少笔记ID' });
  try {
    var existing = db.prepare('SELECT id FROM cloud_notes WHERE id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE cloud_notes SET title = ?, content = ?, tags = ?, folder = ?, visibility = ?, is_pinned = ?, canvas_data = ?, type = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, content, JSON.stringify(tags), folder, visibility, isPinned, canvasData, noteType, id);
    } else {
      db.prepare('INSERT INTO cloud_notes (id, user_id, title, content, tags, folder, visibility, is_pinned, canvas_data, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, title, content, JSON.stringify(tags), folder, visibility, isPinned, canvasData, noteType);
    }
    res.json({ code: 200, message: '保存成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '保存失败' });
  }
});

router.delete('/notes/:id', auth.requireAuth, function(req, res) {
  var noteId = req.params.id;
  try {
    var note = db.prepare('SELECT * FROM cloud_notes WHERE id = ?').get(noteId);
    if (!note) return res.status(404).json({ code: 404, message: '笔记不存在' });
    if (String(note.user_id) !== String(req.user.user_id)) return res.status(403).json({ code: 403, message: '无权限删除此笔记' });
    db.prepare('DELETE FROM cloud_notes WHERE id = ?').run(noteId);
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

router.patch('/notes/:id/visibility', auth.requireAuth, function(req, res) {
  var noteId = req.params.id;
  var visibility = req.body.visibility === 'public' ? 'public' : 'private';
  try {
    var note = db.prepare('SELECT * FROM cloud_notes WHERE id = ?').get(noteId);
    if (!note) return res.status(404).json({ code: 404, message: '笔记不存在' });
    if (String(note.user_id) !== String(req.user.user_id)) return res.status(403).json({ code: 403, message: '无权限修改此笔记' });
    db.prepare('UPDATE cloud_notes SET visibility = ?, updated_at = datetime(\'now\') WHERE id = ?').run(visibility, noteId);
    res.json({ code: 200, message: '可见性已更新' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

router.patch('/notes/:id/folder', auth.requireAuth, function(req, res) {
  var noteId = req.params.id;
  var folder = (req.body.folder || '默认').trim();
  try {
    var note = db.prepare('SELECT * FROM cloud_notes WHERE id = ?').get(noteId);
    if (!note) return res.status(404).json({ code: 404, message: '笔记不存在' });
    if (String(note.user_id) !== String(req.user.user_id)) return res.status(403).json({ code: 403, message: '无权限修改此笔记' });
    db.prepare('UPDATE cloud_notes SET folder = ?, updated_at = datetime(\'now\') WHERE id = ?').run(folder, noteId);
    res.json({ code: 200, message: '文件夹已更新' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

router.get('/folders', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  try {
    var folders = db.prepare('SELECT * FROM cloud_note_folders WHERE user_id = ? ORDER BY name').all(userId);
    convertTimesArray(folders);
    res.json({ code: 200, message: 'ok', data: folders });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取文件夹失败' });
  }
});

router.post('/folders', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ code: 400, message: '文件夹名称不能为空' });
  try {
    db.prepare('INSERT INTO cloud_note_folders (user_id, name) VALUES (?, ?)').run(userId, name);
    res.json({ code: 200, message: '创建成功' });
  } catch (e) {
    if (String(e.message).indexOf('UNIQUE') > -1) return res.status(400).json({ code: 400, message: '文件夹已存在' });
    res.status(500).json({ code: 500, message: '创建失败' });
  }
});

router.delete('/folders/:id', auth.requireAuth, function(req, res) {
  var folderId = req.params.id;
  try {
    var folder = db.prepare('SELECT * FROM cloud_note_folders WHERE id = ?').get(folderId);
    if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });
    if (String(folder.user_id) !== String(req.user.user_id)) return res.status(403).json({ code: 403, message: '无权限删除' });
    db.prepare('UPDATE cloud_notes SET folder = ? WHERE user_id = ? AND folder = ?').run('默认', req.user.user_id, folder.name);
    db.prepare('DELETE FROM cloud_note_folders WHERE id = ?').run(folderId);
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

module.exports = router;
