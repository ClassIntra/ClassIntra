var express = require('express');
var path = require('path');
var router = express.Router();
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
var crypto = require('crypto');
var DEFAULT_SIZE = 15;
var ALLOWED_SIZES = [15, 19, 21];

function userId(req) {
  return String((req.user && (req.user.user_id || req.user.id)) || 'guest');
}
function board(size) { return Array.from({ length: size }, function() { return Array(size).fill(null); }); }
function validSize(size) { return ALLOWED_SIZES.indexOf(Number(size)) !== -1; }
function validCoordinate(row, col, size) { return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < size && col < size; }
function makeCode() { return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6); }
function colorForMember(roomCode, id) { var row = db.prepare('SELECT color FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id); return row && row.color; }
function roomRow(roomCode) { return db.prepare('SELECT * FROM gomoku_rooms WHERE room_code = ?').get(roomCode); }
function currentGame(roomCode) { return db.prepare('SELECT * FROM gomoku_games WHERE room_code = ? AND status = \'active\' ORDER BY id DESC LIMIT 1').get(roomCode); }
function ensureGame(roomCode, size) {
  var game = currentGame(roomCode);
  if (game) return game;
  var result = db.prepare('INSERT INTO gomoku_games (room_code, size, board) VALUES (?, ?, ?)').run(roomCode, size, JSON.stringify(board(size)));
  return db.prepare('SELECT * FROM gomoku_games WHERE id = ?').get(result.lastInsertRowid);
}
function hasWinner(state, row, col, color) {
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(function(direction) {
    var count = 1;
    [[1, 1], [-1, -1]].forEach(function(sign) {
      var r = row + direction[0] * sign[0], c = col + direction[1] * sign[1];
      while (r >= 0 && c >= 0 && r < state.length && c < state.length && state[r][c] === color) {
        count += 1; r += direction[0] * sign[0]; c += direction[1] * sign[1];
      }
    });
    return count >= 5;
  });
}
function stateFor(roomCode, game) {
  var members = db.prepare('SELECT user_id, role, color, joined_at, last_seen_at FROM gomoku_members WHERE room_code = ? ORDER BY joined_at').all(roomCode);
  return { roomCode: roomCode, size: game.size, board: JSON.parse(game.board), turn: game.turn, winner: game.winner, status: game.status, gameId: game.id, members: members };
}
function requireRoom(req, res, next) {
  var roomCode = req.params.roomCode;
  var room = roomRow(roomCode);
  if (!room || room.status === 'closed') return res.status(404).json({ code: 404, message: '房间不存在或已关闭' });
  req.gomokuRoom = room;
  next();
}
function join(roomCode, id) {
  var existing = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (existing) {
    db.prepare('UPDATE gomoku_members SET last_seen_at = datetime(\'now\') WHERE room_code = ? AND user_id = ?').run(roomCode, id);
    return existing;
  }
  var colors = db.prepare('SELECT color FROM gomoku_members WHERE room_code = ? AND color IS NOT NULL').all(roomCode).map(function(row) { return row.color; });
  var color = colors.indexOf('black') === -1 ? 'black' : colors.indexOf('white') === -1 ? 'white' : null;
  db.prepare('INSERT INTO gomoku_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(roomCode, id, color ? 'player' : 'spectator', color);
  return db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
}
function legacyKey(req) { return req.user && (req.user.user_id || req.user.id) ? String(req.user.user_id || req.user.id) : String(req.get('x-gomoku-room') || 'default'); }
function legacyRoom(req) {
  var key = legacyKey(req), room = roomRow(key);
  if (!room) {
    var code = key;
    if (code.length > 32) code = makeCode();
    try { db.prepare('INSERT INTO gomoku_rooms (room_code, owner_id, size) VALUES (?, ?, ?)').run(code, userId(req), DEFAULT_SIZE); } catch (e) {}
    room = roomRow(code);
    join(code, userId(req));
  }
  return room;
}
function createRoom(req, res) {
  var size = req.body && req.body.size === undefined ? DEFAULT_SIZE : Number(req.body && req.body.size);
  if (!validSize(size)) return res.status(400).json({ code: 400, message: '棋盘大小必须为15、19或21' });
  var code;
  do { code = makeCode(); } while (roomRow(code));
  db.prepare('INSERT INTO gomoku_rooms (room_code, owner_id, size) VALUES (?, ?, ?)').run(code, userId(req), size);
  db.prepare('INSERT INTO gomoku_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(code, userId(req), 'owner', 'black');
  db.prepare('UPDATE gomoku_rooms SET updated_at = datetime(\'now\') WHERE room_code = ?').run(code);
  return res.status(201).json({ code: 201, data: stateFor(code, ensureGame(code, size)) });
}
router.post('/rooms', requireAuth, createRoom);
router.get('/rooms/:roomCode', requireRoom, function(req, res) { res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
router.post('/rooms/:roomCode/join', requireAuth, requireRoom, function(req, res) { join(req.params.roomCode, userId(req)); res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
router.post('/rooms/:roomCode/watch', requireRoom, function(req, res) { var member = join(req.params.roomCode, userId(req)); if (member.color) db.prepare('UPDATE gomoku_members SET role = \'spectator\', color = NULL WHERE room_code = ? AND user_id = ?').run(req.params.roomCode, userId(req)); res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
router.post('/rooms/:roomCode/leave', requireRoom, function(req, res) { var id = userId(req); var member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(req.params.roomCode, id); if (!member) return res.status(404).json({ code: 404, message: '不在房间中' }); db.prepare('DELETE FROM gomoku_members WHERE room_code = ? AND user_id = ?').run(req.params.roomCode, id); if (member.role === 'owner') { var next = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ? ORDER BY joined_at LIMIT 1').get(req.params.roomCode); if (next) db.prepare('UPDATE gomoku_rooms SET owner_id = ? WHERE room_code = ?').run(next.user_id, req.params.roomCode); } res.json({ code: 200, data: { roomCode: req.params.roomCode } }); });
router.post('/rooms/:roomCode/close', requireRoom, function(req, res) { if (req.gomokuRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以关闭房间' }); db.prepare('UPDATE gomoku_rooms SET status = \'closed\', updated_at = datetime(\'now\') WHERE room_code = ?').run(req.params.roomCode); res.json({ code: 200, data: { roomCode: req.params.roomCode, status: 'closed' } }); });
router.post('/rooms/:roomCode/reset', requireRoom, function(req, res) { if (req.gomokuRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以重开对局' }); var game = currentGame(req.params.roomCode); db.prepare('UPDATE gomoku_games SET status = \'finished\', ended_at = datetime(\'now\') WHERE id = ?').run(game.id); res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
router.post('/rooms/:roomCode/color', requireAuth, requireRoom, function(req, res) { var id = userId(req), member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(req.params.roomCode, id), game = currentGame(req.params.roomCode); if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以换色' }); if (game && (game.winner || game.status !== 'active')) return res.status(409).json({ code: 409, message: '对局进行中不能换色' }); var other = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND color = ? AND user_id != ?').get(req.params.roomCode, member.color, id); if (!other) return res.status(409).json({ code: 409, message: '没有可交换的玩家' }); var nextColor = member.color === 'black' ? 'white' : 'black'; db.prepare('UPDATE gomoku_members SET color = ? WHERE room_code = ? AND user_id = ?').run(nextColor, req.params.roomCode, id); db.prepare('UPDATE gomoku_members SET color = ? WHERE room_code = ? AND user_id = ?').run(member.color, req.params.roomCode, other.user_id); res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
router.get('/rooms/:roomCode/history', requireRoom, function(req, res) { var games = db.prepare('SELECT id, size, turn, winner, status, started_at, ended_at FROM gomoku_games WHERE room_code = ? ORDER BY id DESC').all(req.params.roomCode); var moves = db.prepare('SELECT game_id as gameId, user_id as userId, color, row, col, created_at as createdAt FROM gomoku_moves WHERE game_id IN (SELECT id FROM gomoku_games WHERE room_code = ?) ORDER BY id').all(req.params.roomCode); res.json({ code: 200, data: { games: games, moves: moves } }); });
function move(req, res, roomCode, room) { var id = userId(req), game = ensureGame(roomCode, room.size), row = req.body && req.body.row, col = req.body && req.body.col, state = JSON.parse(game.board), member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id); if (!member) member = join(roomCode, id); if (!member.color) return res.status(403).json({ code: 403, message: '观战者不能落子' }); if (!validCoordinate(row, col, game.size)) return res.status(400).json({ code: 400, message: '坐标不合法' }); if (game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束', data: stateFor(roomCode, game) }); if (game.turn !== member.color) return res.status(409).json({ code: 409, message: '尚未轮到该棋子' }); if (state[row][col]) return res.status(409).json({ code: 409, message: '该位置已有棋子', data: stateFor(roomCode, game) }); state[row][col] = member.color; var winner = hasWinner(state, row, col, member.color) ? member.color : null; var turn = winner ? member.color : member.color === 'black' ? 'white' : 'black'; db.prepare('UPDATE gomoku_games SET board = ?, turn = ?, winner = ?, status = ?, ended_at = CASE WHEN ? IS NULL THEN ended_at ELSE datetime(\'now\') END WHERE id = ?').run(JSON.stringify(state), turn, winner, winner ? 'finished' : 'active', winner, game.id); db.prepare('INSERT INTO gomoku_moves (game_id, user_id, color, row, col) VALUES (?, ?, ?, ?, ?)').run(game.id, id, member.color, row, col); return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM gomoku_games WHERE id = ?').get(game.id)) }); }
router.post('/rooms/:roomCode/move', requireAuth, requireRoom, function(req, res) { move(req, res, req.params.roomCode, req.gomokuRoom); });
router.get('/state', function(req, res) { var room = legacyRoom(req); res.json({ code: 200, data: stateFor(room.room_code, ensureGame(room.room_code, room.size)) }); });
router.post('/move', function(req, res) { var room = legacyRoom(req); move(req, res, room.room_code, room); });
router.post('/reset', function(req, res) { var room = legacyRoom(req); var game = currentGame(room.room_code); db.prepare('UPDATE gomoku_games SET status = \'finished\', ended_at = datetime(\'now\') WHERE id = ?').run(game.id); res.json({ code: 200, data: stateFor(room.room_code, ensureGame(room.room_code, room.size)) }); });
module.exports = router;
