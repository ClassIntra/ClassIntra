# ClassIntra DB Migration 指南

> 本文档介绍 ClassIntra 数据库迁移系统的工作原理、如何编写新 migration 和调试技巧。
> 详见 [api-reference.md#15-migration-runner-db-迁移执行器](./api-reference.md#15-migration-runner-db-迁移执行器) 的 API 参考。

---

## 目录

- [系统设计](#1-系统设计)
- [迁移文件结构](#2-迁移文件结构)
- [编写新 Migration](#3-编写新-migration)
- [幂等性要求](#4-幂等性要求)
- [执行流程](#5-执行流程)
- [调试方法](#6-调试方法)
- [常见场景](#7-常见场景)
- [最佳实践](#8-最佳实践)

---

## 1. 系统设计

### 1.1 核心组件

| 组件 | 位置 | 作用 |
|------|------|------|
| Migration Runner | [server/src/utils/migration-runner.js](../server/src/utils/migration-runner.js) | 执行引擎，按版本顺序执行迁移 |
| Migrations 目录 | [server/src/migrations/](../server/src/migrations/) | 存放所有迁移文件 |
| `schema_version` 表 | SQLite | 记录已执行的迁移版本 |
| `init-db.js` | [server/src/utils/init-db.js](../server/src/utils/init-db.js) | 调用 `runAll()` 启动迁移 |

### 1.2 设计要点

1. **按文件名排序执行**：`000_baseline.js` → `001_xxx.js` → `002_xxx.js`
2. **事务包裹**：每个迁移在事务中执行，失败则回滚并中止后续迁移
3. **幂等性**：所有迁移必须可重复执行（多次执行结果一致）
4. **版本记录**：成功执行的迁移记录到 `schema_version` 表，下次启动跳过
5. **失败中止**：任一迁移失败，立即中止后续迁移并抛出异常（不破坏数据库）

### 1.3 与原 init-db.js 的关系

**改造前**：`init-db.js` 包含所有 `CREATE TABLE` / `ALTER TABLE` 语句（约 1024 行）。

**改造后**：
- Schema 操作抽取到 `migrations/000_baseline.js`（约 690 行，全量原 schema）
- `init-db.js` 缩减为薄包装（约 345 行），仅保留数据初始化：

```javascript
// server/src/utils/init-db.js
function initDatabase() {
  // 1. 执行 schema 迁移（幂等）
  var result = migrationRunner.runAll();
  
  // 2. 数据初始化（预注册名单 / 默认应用 / watermark 等）
  _initData();
  
  // 3. 云盘旧文件迁移（文件系统操作，幂等）
  runCloudMigration();
}
```

---

## 2. 迁移文件结构

### 2.1 基本结构

```javascript
// server/src/migrations/003_add_xxx_table.js
module.exports = {
  version: 3,                    // 必填，版本号（与文件名前缀一致）
  name: 'add_xxx_table',         // 必填，迁移名称（用于日志和 schema_version 表）
  up: function(db) {              // 必填，执行函数，接收 db 实例
    db.exec(`
      CREATE TABLE IF NOT EXISTS xxx (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
};
```

### 2.2 文件命名规则

```
NNN_description.js
```

- `NNN`：3 位数字版本号，从 `000` 开始递增
- `description`：简短描述，snake_case
- 必须以 `.js` 结尾（`.sql` 不支持）

### 2.3 现有迁移文件

| 文件 | 版本 | 说明 |
|------|------|------|
| [000_baseline.js](../server/src/migrations/000_baseline.js) | 0 | 全量抽取原 init-db.js 的 schema（所有原表 + 索引） |
| [001_initial_schema_version.js](../server/src/migrations/001_initial_schema_version.js) | 1 | 版本标记占位（up 为空操作） |
| [002_add_integrations_tables.js](../server/src/migrations/002_add_integrations_tables.js) | 2 | integrations 表 + 2 个索引 |

### 2.4 db 实例

`up(db)` 接收的 `db` 是 [server/src/utils/db.js](../server/src/utils/db.js) 导出的 `better-sqlite3` Database 实例。

**可用 API**：

```javascript
db.exec(sql);                          // 执行多条 SQL（无返回值）
db.prepare(sql);                        // 准备语句，返回 Statement
db.prepare(sql).run(...params);         // 执行并返回 { changes, lastInsertRowid }
db.prepare(sql).get(...params);         // 查询单行
db.prepare(sql).all(...params);         // 查询多行
db.transaction(fn);                     // 创建事务函数（migration-runner 已包裹）
db.pragma('table_info(tablename)');     // 查询表结构
```

---

## 3. 编写新 Migration

### 3.1 步骤

1. **确定版本号**：查询当前最新版本（文件名最大数字 +1）
2. **创建文件**：`server/src/migrations/NNN_description.js`
3. **编写 up 函数**：确保幂等
4. **测试**：删除测试数据库或手动调用 `runAll()` 验证
5. **构建验证**：`cd server && node src/app.js`，观察迁移日志

### 3.2 示例：新增表

```javascript
// server/src/migrations/003_add_notifications_table.js
module.exports = {
  version: 3,
  name: 'add_notifications_table',
  up: function(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        content TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
    `);
  }
};
```

### 3.3 示例：新增列

```javascript
// server/src/migrations/004_add_user_avatar_column.js
module.exports = {
  version: 4,
  name: 'add_user_avatar_column',
  up: function(db) {
    // ALTER TABLE 不支持 IF NOT EXISTS，必须先检查列是否存在
    var columns = db.prepare("PRAGMA table_info(users)").all();
    var hasAvatar = columns.some(function(c) { return c.name === 'avatar_url'; });
    
    if (!hasAvatar) {
      db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
      console.log('[migration] 已添加 users.avatar_url 列');
    } else {
      console.log('[migration] users.avatar_url 列已存在，跳过');
    }
  }
};
```

### 3.4 示例：数据迁移（schema 变更）

```javascript
// server/src/migrations/005_migrate_community_likes_type.js
module.exports = {
  version: 5,
  name: 'migrate_community_likes_type',
  up: function(db) {
    // 把 community_likes.target_id 从 INTEGER 转为 TEXT
    // SQLite 不支持 ALTER COLUMN，需要重建表
    
    var tableInfo = db.prepare("PRAGMA table_info(community_likes)").all();
    var targetIdCol = tableInfo.find(function(c) { return c.name === 'target_id'; });
    
    if (!targetIdCol || targetIdCol.type === 'TEXT') {
      console.log('[migration] community_likes.target_id 已是 TEXT 类型，跳过');
      return;
    }
    
    // 重建表（在事务中）
    db.exec(`
      CREATE TABLE community_likes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      
      INSERT INTO community_likes_new (id, user_id, target_type, target_id, created_at)
        SELECT id, user_id, target_type, CAST(target_id AS TEXT), created_at FROM community_likes;
      
      DROP TABLE community_likes;
      ALTER TABLE community_likes_new RENAME TO community_likes;
      
      CREATE INDEX IF NOT EXISTS idx_community_likes_user ON community_likes(user_id);
      CREATE INDEX IF NOT EXISTS idx_community_likes_target ON community_likes(target_type, target_id);
    `);
    
    console.log('[migration] community_likes.target_id 已迁移为 TEXT 类型');
  }
};
```

### 3.5 示例：新增索引

```javascript
// server/src/migrations/006_add_message_search_index.js
module.exports = {
  version: 6,
  name: 'add_message_search_index',
  up: function(db) {
    // FTS5 全文搜索虚拟表（如 SQLite 启用了 FTS5 扩展）
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        user_id,
        type,
        content='chat_messages',
        content_rowid='id'
      );
    `);
    
    // 填充已有数据
    var count = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages').get().cnt;
    if (count > 0) {
      db.exec(`
        INSERT INTO messages_fts(rowid, content, user_id, type)
          SELECT id, content, user_id, 'chat' FROM chat_messages;
      `);
    }
  }
};
```

---

## 4. 幂等性要求

### 4.1 为什么需要幂等

- **多环境部署**：开发库、测试库、生产库的初始状态不同
- **失败重试**：迁移中途失败后，重启会重新执行
- **从备份恢复**：恢复老备份后启动，需补齐所有迁移

### 4.2 幂等方式

| 操作 | 幂等方式 |
|------|----------|
| `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS` |
| `CREATE INDEX` | `CREATE INDEX IF NOT EXISTS` |
| `CREATE VIEW` | `CREATE VIEW IF NOT EXISTS` |
| `CREATE TRIGGER` | `CREATE TRIGGER IF NOT EXISTS` |
| `ALTER TABLE ADD COLUMN` | 先 `PRAGMA table_info(tablename)` 检查列是否存在 |
| `ALTER TABLE DROP COLUMN` | 先检查列是否存在 |
| `ALTER TABLE RENAME COLUMN` | 先检查旧列存在、新列不存在 |
| 数据迁移 | 先检查是否已迁移（如类型已变更、数据已存在） |
| 删除表 | `DROP TABLE IF EXISTS` |

### 4.3 检查列是否存在的模板

```javascript
function hasColumn(db, tableName, columnName) {
  var columns = db.prepare('PRAGMA table_info(' + tableName + ')').all();
  return columns.some(function(c) { return c.name === columnName; });
}

// 使用
if (!hasColumn(db, 'users', 'avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
}
```

### 4.4 检查表是否存在的模板

```javascript
function hasTable(db, tableName) {
  var row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  return !!row;
}

// 使用
if (!hasTable(db, 'notifications')) {
  db.exec('CREATE TABLE notifications (...)');
}
```

### 4.5 检查数据是否已迁移的模板

```javascript
// 检查某个值是否已转换（如 status 字段从 'active'/'inactive' 改为 1/0）
var oldFormatCount = db.prepare(
  "SELECT COUNT(*) as cnt FROM users WHERE status IN ('active', 'inactive')"
).get().cnt;

if (oldFormatCount > 0) {
  db.exec(`
    UPDATE users SET status = '1' WHERE status = 'active';
    UPDATE users SET status = '0' WHERE status = 'inactive';
  `);
}
```

---

## 5. 执行流程

### 5.1 启动时执行

```
server/src/app.js 启动
    ↓
调用 initDatabase()（server/src/utils/init-db.js）
    ↓
migrationRunner.runAll()
    ↓
1. ensureSchemaVersionTable()
   → CREATE TABLE IF NOT EXISTS schema_version (...)
    ↓
2. getCurrentVersion()
   → SELECT MAX(version) FROM schema_version
   → 返回 -1 表示无记录（全新库）
    ↓
3. loadMigrations()
   → 读取 migrations/ 目录
   → 按文件名排序
   → 过滤无效文件（缺少 version 或 up）
    ↓
4. 遍历 migrations
   for each migration:
     if (migration.version <= currentVersion) continue;  // 跳过已执行
     ↓
     在事务中执行:
       1. migration.up(db)
       2. INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)
     ↓
     事务成功 → 记录日志
     事务失败 → 回滚 + 抛出异常（中止后续迁移）
    ↓
5. 返回 { applied, currentVersion, migrations }
```

### 5.2 失败处理

- **事务回滚**：单个迁移失败时，事务自动回滚，数据库不变
- **中止后续**：抛出异常后，后续迁移不会执行
- **应用启动失败**：异常向上传播，应用启动失败（避免数据不一致）

### 5.3 重试机制

修复失败的迁移后，重启应用：

1. `getCurrentVersion()` 返回上次成功的版本（不包含失败的）
2. `loadMigrations()` 重新加载所有迁移
3. 从失败的那个开始重新执行

---

## 6. 调试方法

### 6.1 查看当前 schema 版本

```bash
cd server
node -e "
var migrationRunner = require('./src/utils/migration-runner');
console.log('当前版本:', migrationRunner.getCurrentVersion());
"
```

输出示例：

```
当前版本: 2
```

### 6.2 查看迁移历史

```bash
cd server
node -e "
var migrationRunner = require('./src/utils/migration-runner');
console.log(migrationRunner.getMigrationHistory());
"
```

输出示例：

```javascript
[
  { version: 0, name: 'baseline', applied_at: '2026-07-05 10:00:00' },
  { version: 1, name: 'initial_schema_version', applied_at: '2026-07-05 10:00:00' },
  { version: 2, name: 'add_integrations_tables', applied_at: '2026-07-05 10:00:00' }
]
```

### 6.3 查看已加载的迁移文件

```bash
cd server
node -e "
var migrationRunner = require('./src/utils/migration-runner');
var migrations = migrationRunner.loadMigrations();
migrations.forEach(function(m) {
  console.log('v' + m.version, m.name, '(' + m.file + ')');
});
"
```

### 6.4 手动执行迁移

```bash
cd server
node -e "
var migrationRunner = require('./src/utils/migration-runner');
var result = migrationRunner.runAll();
console.log('结果:', result);
"
```

输出示例（首次启动）：

```
[migration] 执行迁移 v0 baseline (000_baseline.js)
[migration] ✓ v0 baseline 完成
[migration] 执行迁移 v1 initial_schema_version (001_initial_schema_version.js)
[migration] ✓ v1 initial_schema_version 完成
[migration] 执行迁移 v2 add_integrations_tables (002_add_integrations_tables.js)
[migration] ✓ v2 add_integrations_tables 完成
结果: { applied: 3, currentVersion: 2, migrations: ['v0 baseline', 'v1 initial_schema_version', 'v2 add_integrations_tables'] }
```

输出示例（已迁移过）：

```
结果: { applied: 0, currentVersion: 2, migrations: [] }
```

### 6.5 检查表结构

```bash
cd server
node -e "
var db = require('./src/utils/db');
var columns = db.prepare('PRAGMA table_info(integrations)').all();
columns.forEach(function(c) {
  console.log(c.name, c.type, c.notnull ? 'NOT NULL' : '', c.pk ? 'PK' : '');
);
"
```

### 6.6 验证迁移幂等性

```bash
# 第一次执行（应用迁移）
cd server
node -e "var r = require('./src/utils/migration-runner').runAll(); console.log(r);"

# 第二次执行（应该 0 迁移）
node -e "var r = require('./src/utils/migration-runner').runAll(); console.log(r);"
# 输出: { applied: 0, currentVersion: N, migrations: [] }
```

---

## 7. 常见场景

### 7.1 新增表

参考 [3.2 示例](#32-示例新增表)。

### 7.2 新增列

参考 [3.3 示例](#33-示例新增列)。

### 7.3 修改列类型

SQLite 不支持 `ALTER COLUMN`，需重建表。参考 [3.4 示例](#34-示例数据迁移schema-变更)。

### 7.4 删除列

SQLite 3.35+ 支持 `ALTER TABLE DROP COLUMN`：

```javascript
module.exports = {
  version: 7,
  name: 'drop_user_legacy_field',
  up: function(db) {
    var columns = db.prepare('PRAGMA table_info(users)').all();
    var hasLegacy = columns.some(function(c) { return c.name === 'legacy_field'; });
    if (hasLegacy) {
      db.exec('ALTER TABLE users DROP COLUMN legacy_field;');
    }
  }
};
```

### 7.5 重命名列

SQLite 支持 `ALTER TABLE RENAME COLUMN`：

```javascript
module.exports = {
  version: 8,
  name: 'rename_user_name_column',
  up: function(db) {
    var columns = db.prepare('PRAGMA table_info(users)').all();
    var hasOld = columns.some(function(c) { return c.name === 'name'; });
    var hasNew = columns.some(function(c) { return c.name === 'display_name'; });
    if (hasOld && !hasNew) {
      db.exec('ALTER TABLE users RENAME COLUMN name TO display_name;');
    }
  }
};
```

### 7.6 添加外键约束

SQLite 不支持直接添加外键，需重建表：

```javascript
module.exports = {
  version: 9,
  name: 'add_foreign_key_to_notes',
  up: function(db) {
    // 检查是否已迁移（通过检查表是否是新建的）
    var sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='cloud_notes'"
    ).get();
    
    if (sql.sql.indexOf('REFERENCES users(user_id)') !== -1) {
      return;  // 已有外键约束
    }
    
    // 重建表
    db.exec(`
      CREATE TABLE cloud_notes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(user_id),
        title TEXT,
        content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      INSERT INTO cloud_notes_new SELECT * FROM cloud_notes;
      DROP TABLE cloud_notes;
      ALTER TABLE cloud_notes_new RENAME TO cloud_notes;
      
      CREATE INDEX IF NOT EXISTS idx_cloud_notes_user ON cloud_notes(user_id);
    `);
  }
};
```

---

## 8. 最佳实践

### 8.1 命名规范

- **文件名**：`NNN_snake_case_description.js`（`NNN` 递增）
- **version**：与文件名前缀数字一致
- **name**：与文件名描述部分一致（snake_case）

### 8.2 单一职责

每个 migration 只做一件事：

```javascript
// ✓ 好：单一职责
// 010_add_user_avatar_column.js
module.exports = {
  version: 10,
  name: 'add_user_avatar_column',
  up: function(db) { /* 只加 avatar_url 列 */ }
};

// 011_add_user_phone_column.js  
module.exports = {
  version: 11,
  name: 'add_user_phone_column',
  up: function(db) { /* 只加 phone 列 */ }
};

// ✗ 差：一个 migration 做多件事
// 010_add_user_columns.js
module.exports = {
  version: 10,
  name: 'add_user_columns',
  up: function(db) {
    // 同时加 avatar_url、phone、address 三列
    // 难以单独回滚
  }
};
```

### 8.3 不要修改已发布的 migration

**已发布到生产的 migration 永远不要修改**！如需修改 schema，新建一个 migration。

```javascript
// ✗ 错误：修改已发布的 003_add_notifications_table.js
//   加个新字段 is_starred
module.exports = {
  version: 3,
  name: 'add_notifications_table',
  up: function(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        content TEXT,
        is_read INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,  -- 新增！
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
};
// 问题：生产环境已经执行过 v3，不会重新执行，新字段不会添加！

// ✓ 正确：新建 migration
// 004_add_notifications_starred_column.js
module.exports = {
  version: 4,
  name: 'add_notifications_starred_column',
  up: function(db) {
    var columns = db.prepare('PRAGMA table_info(notifications)').all();
    if (!columns.some(function(c) { return c.name === 'is_starred'; })) {
      db.exec('ALTER TABLE notifications ADD COLUMN is_starred INTEGER DEFAULT 0;');
    }
  }
};
```

### 8.4 测试迁移

```bash
# 1. 备份现有数据库
cp server/database/classintra.db server/database/classintra.db.bak

# 2. 在备份上测试新迁移
DB_PATH=server/database/classintra.db.bak node -e "
var migrationRunner = require('./src/utils/migration-runner');
var result = migrationRunner.runAll();
console.log('迁移结果:', result);
"

# 3. 验证表结构
DB_PATH=server/database/classintra.db.bak node -e "
var db = require('./src/utils/db');
console.log(db.prepare('PRAGMA table_info(notifications)').all());
"

# 4. 删除测试数据库
rm server/database/classintra.db.bak
```

### 8.5 日志输出

在 up 函数中输出日志，便于调试：

```javascript
module.exports = {
  version: 10,
  name: 'add_xxx_table',
  up: function(db) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xxx'").get()) {
      console.log('[migration] xxx 表已存在，跳过');
      return;
    }
    db.exec('CREATE TABLE xxx (...)');
    console.log('[migration] 已创建 xxx 表');
  }
};
```

### 8.6 大表数据迁移

对于大表的数据迁移（如百万行），分批处理避免锁表：

```javascript
module.exports = {
  version: 11,
  name: 'migrate_large_table_data',
  up: function(db) {
    var total = db.prepare('SELECT COUNT(*) as cnt FROM large_table').get().cnt;
    var migrated = db.prepare('SELECT COUNT(*) as cnt FROM large_table WHERE migrated = 1').get().cnt;
    
    if (migrated === total) {
      console.log('[migration] 已全部迁移，跳过');
      return;
    }
    
    var batchSize = 1000;
    var remaining = total - migrated;
    
    while (remaining > 0) {
      var tx = db.transaction(function() {
        db.prepare(`
          UPDATE large_table 
          SET migrated = 1, new_field = old_field 
          WHERE id IN (
            SELECT id FROM large_table WHERE migrated = 0 LIMIT ?
          )
        `).run(batchSize);
      });
      tx();
      remaining -= batchSize;
      console.log('[migration] 剩余', Math.max(0, remaining), '行');
    }
  }
};
```

---

## 附录：相关文档

| 文档 | 说明 |
|------|------|
| [api-reference.md#15-migration-runner-db-迁移执行器](./api-reference.md#15-migration-runner-db-迁移执行器) | Migration Runner API 参考 |
| [architecture.md#7-db-migration-系统](./architecture.md#7-db-migration-系统) | 架构概览 |
| [development-guide.md#3-写-db-migration](./development-guide.md#3-写-db-migration) | 开发指南中的 migration 章节 |
