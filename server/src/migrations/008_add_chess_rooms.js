// 迁移 008：象棋（chess 市场应用）房间系统
// 对齐 gomoku（004）的表结构风格：房间 / 成员 / 对局 / 走子四张表 + 索引。
// winner：'red' | 'black' | 'draw'（困毙判和）| NULL；result：checkmate/stalemate/resign。
function up(db) {
  db.exec("CREATE TABLE IF NOT EXISTS chess_rooms (room_code TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE IF NOT EXISTS chess_members (room_code TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', color TEXT, joined_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (room_code, user_id), FOREIGN KEY (room_code) REFERENCES chess_rooms(room_code) ON DELETE CASCADE)");
  db.exec("CREATE TABLE IF NOT EXISTS chess_games (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, board TEXT NOT NULL, turn TEXT NOT NULL DEFAULT 'red', winner TEXT, result TEXT, status TEXT NOT NULL DEFAULT 'active', started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, FOREIGN KEY (room_code) REFERENCES chess_rooms(room_code) ON DELETE CASCADE)");
  db.exec("CREATE TABLE IF NOT EXISTS chess_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, user_id TEXT NOT NULL, color TEXT NOT NULL, from_row INTEGER NOT NULL, from_col INTEGER NOT NULL, to_row INTEGER NOT NULL, to_col INTEGER NOT NULL, piece TEXT NOT NULL, captured TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (game_id) REFERENCES chess_games(id) ON DELETE CASCADE)");
  db.exec('CREATE INDEX IF NOT EXISTS idx_chess_games_room ON chess_games(room_code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chess_moves_game ON chess_moves(game_id)');
}

module.exports = { version: 8, name: 'add_chess_rooms', up: up };
