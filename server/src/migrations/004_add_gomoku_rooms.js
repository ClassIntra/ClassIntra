function up(db) {
  db.exec("CREATE TABLE IF NOT EXISTS gomoku_rooms (room_code TEXT PRIMARY KEY, owner_id TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 15, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE IF NOT EXISTS gomoku_members (room_code TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', color TEXT, joined_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (room_code, user_id), FOREIGN KEY (room_code) REFERENCES gomoku_rooms(room_code) ON DELETE CASCADE)");
  db.exec("CREATE TABLE IF NOT EXISTS gomoku_games (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, size INTEGER NOT NULL, board TEXT NOT NULL, turn TEXT NOT NULL DEFAULT 'black', winner TEXT, status TEXT NOT NULL DEFAULT 'active', started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, FOREIGN KEY (room_code) REFERENCES gomoku_rooms(room_code) ON DELETE CASCADE)");
  db.exec("CREATE TABLE IF NOT EXISTS gomoku_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, user_id TEXT NOT NULL, color TEXT NOT NULL, row INTEGER NOT NULL, col INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (game_id) REFERENCES gomoku_games(id) ON DELETE CASCADE)");
  db.exec('CREATE INDEX IF NOT EXISTS idx_gomoku_games_room ON gomoku_games(room_code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gomoku_moves_game ON gomoku_moves(game_id)');
}

module.exports = { version: 4, name: 'add_gomoku_rooms', up: up };
