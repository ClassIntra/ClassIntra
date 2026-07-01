# 云盘去重存储设计

> 日期: 2026-07-01 | 状态: 设计中

---

## 一、问题与目标

### 现状

```
Resources/cloud/<userId>/photos/<filename>
```

- 文件物理存储按用户分目录，每个用户一份
- "转存"操作 (`save-from-url`) 使用 `fs.copyFileSync()` 做物理复制
- 10 个用户转存同一张 10MB 图片 → 磁盘占用 100MB

### 目标

- **内容寻址存储**：相同内容的文件在磁盘上只存一份
- **引用计数管理**：删除时只移除用户引用，引用归零才清理物理文件
- **自动迁移**：现有文件自动去重迁移到新结构
- **预留分组**：数据库设计预留用户自定义文件夹/分组能力

---

## 二、存储架构

### 新目录结构

```
Resources/cloud/
├── shared/                          # 所有唯一物理文件
│   ├── a1/
│   │   └── a1b2c3d4e5f6...fullhash.jpg
│   ├── b2/
│   │   └── b2c3d4e5f6...fullhash.mp4
│   └── ...
├── .tmp/                            # 上传暂存目录（计算哈希后移走）
├── .trash/                          # 引用归零的文件（延迟清理）
├── <userId>/                        # 保留：仅存 note/ 目录（云笔记）
│   └── note/
└── ...
```

- 文件名 = SHA-256 十六进制字符串（64 字符）
- 前 2 字符作为子目录前缀，避免单目录文件过多
- 扩展名保留原始扩展名（便于浏览器 MIME 识别）

### 数据库新增表

```sql
-- 物理文件表：每个唯一内容文件一条记录
CREATE TABLE IF NOT EXISTS cloud_files (
  hash TEXT PRIMARY KEY,              -- SHA-256 十六进制（64字符）
  original_name TEXT NOT NULL,        -- 首次上传时的原始文件名
  size INTEGER NOT NULL,              -- 字节数
  mime_type TEXT NOT NULL,            -- image/png, video/mp4, audio/webm...
  storage_path TEXT NOT NULL,         -- shared/ 下的相对路径，如 a1/b2c3...full.png
  ref_count INTEGER NOT NULL DEFAULT 1,  -- 引用用户数（冗余缓存，加速查询）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 用户文件关联表：用户→文件的引用关系
CREATE TABLE IF NOT EXISTS cloud_user_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,         -- 用户看到的文件名
  folder TEXT NOT NULL DEFAULT '',    -- 预留：分组/文件夹，空字符串=根目录
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_hash) REFERENCES cloud_files(hash),
  UNIQUE(user_id, file_hash, folder)
);

CREATE INDEX IF NOT EXISTS idx_cuf_user ON cloud_user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_cuf_user_folder ON cloud_user_files(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_cf_hash ON cloud_files(hash);
```

- `ref_count`：冗余字段，值为 `SELECT COUNT(*) FROM cloud_user_files WHERE file_hash = ?`，加速引用数查询
- `UNIQUE(user_id, file_hash, folder)`：同一用户可以同一文件放在不同文件夹（预留能力）
- `folder`：当前始终为空字符串，未来可扩展为用户自定义分组

---

## 三、API 设计

### 3.1 POST /api/cloud/upload — 文件上传（修改）

**流程变化**：

```
旧流程：multer → 用户 photos/ 目录 → 转码 → 返回
新流程：multer → .tmp/ 目录 → 转码(如需要) → 计算 SHA-256
       → 查 cloud_files 是否存在
         → 存在：ref_count+1，插 cloud_user_files，删 tmp
         → 不存在：移到 shared/<xx>/<hash>.<ext>，插两条记录
       → 返回
```

**请求**：不变（multipart/form-data: file + mediaType）

**响应**（保持兼容）：
```json
{
  "code": 200,
  "data": {
    "hash": "a1b2c3d4...",
    "name": "IMG_001.jpg",
    "size": 1048576,
    "url": "/api/cloud/files/a1b2c3d4..."
  }
}
```

**关键实现细节**：
- Multer 改用 `.tmp/` 作为 destination
- 转码在 tmp 文件上执行（转码完成后 tmp 文件内容变为 mp4）
- SHA-256 在转码后计算（因为转码改变了文件内容）
- 使用 `crypto.createHash('sha256')` 流式读取文件计算哈希
- 文件从 `.tmp/` 移动到 `shared/<xx>/` 使用 `fs.renameSync()`（同磁盘原子操作）
- `cloud_user_files` 插入使用 `INSERT OR IGNORE`：如果用户已有该文件（同哈希），静默跳过，返回已有文件信息

### 3.2 POST /api/cloud/upload-batch — 批量上传（修改）

- 串行处理（保持现有串行转码逻辑）
- 每个文件独立跑上传流程（哈希去重）

### 3.3 POST /api/cloud/guest-upload — 免登录上传（修改）

- 流程与普通上传一致
- 文件归属为上传码所有者（`guestOwnerId`）

### 3.4 GET /api/cloud/files — 文件列表（修改）

**旧**：`fs.readdirSync(photoDir)` 扫描磁盘  
**新**：数据库查询

```sql
SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,
       cf.size, cf.mime_type, cf.storage_path
FROM cloud_user_files cuf
JOIN cloud_files cf ON cuf.file_hash = cf.hash
WHERE cuf.user_id = ?
ORDER BY cuf.uploaded_at DESC
```

**响应格式**（保持前端兼容）：
```json
{
  "code": 200,
  "data": {
    "files": [
      {
        "hash": "a1b2c3d4...",
        "name": "IMG_001.jpg",
        "display_name": "IMG_001.jpg",
        "size": 1048576,
        "mime_type": "image/jpeg",
        "folder": "",
        "url": "/api/cloud/files/a1b2c3d4...",
        "uploaded_at": "2026-07-01T12:00:00.000Z"
      }
    ]
  }
}
```

- `name` 字段保留（= `display_name`），CloudDrive 和 CloudImagePicker 都用 `file.name` 显示
- 新增 `hash` 字段用于删除/获取操作
- 新增 `mime_type` 字段，前端可以用它替代文件名解析来判断媒体类型

### 3.5 GET /api/cloud/files/:hash — 获取文件（修改）

**旧**：解析文件名 → 遍历用户目录找文件  
**新**：哈希直查数据库

```
1. 解码 hash 参数
2. 安全检查：禁止 .. / \ 字符
3. SELECT storage_path FROM cloud_files WHERE hash = ?
4. 拼接完整路径：Resources/cloud/shared/<storage_path>
5. sendMediaFile() 发送（Range 支持保持不变）
```

- 不再需要遍历用户目录，O(1) 查询
- 不再需要兼容新旧文件名格式

### 3.6 DELETE /api/cloud/files/:hash — 删除文件（修改）

**旧**：`fs.unlinkSync(filePath)` 直接删除物理文件  
**新**：引用计数删除

```
1. 安全检查 hash 参数
2. 验证当前用户在 cloud_user_files 中有该文件的记录
3. DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?
4. UPDATE cloud_files SET ref_count = ref_count - 1 WHERE hash = ?
5. 如果 ref_count = 0：
   a. 将文件从 shared/<xx>/<hash>.<ext> 移到 .trash/<hash>.<ext>
   b. 记录日志（可选：定时任务清理 .trash 中超过 N 天的文件）
6. 返回成功
```

**权限**：用户只能删除自己的引用，不能删除其他用户的引用

### 3.7 POST /api/cloud/save-from-url — 转存（修改）

**旧**：`fs.copyFileSync()` 物理复制  
**新**：纯数据库操作

```
1. 从 URL 解析源文件 → 定位源文件路径 → 计算或查找其哈希
2. 如果源文件不在 cloud_files 表中（如 /resources/ 下的系统资源）：
   a. 计算哈希 → 如果 shared/ 中不存在，复制到 shared/
   b. 创建 cloud_files 记录（ref_count=1）
3. INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name, folder)
4. UPDATE cloud_files SET ref_count = ref_count + 1（如果是新增引用）
5. 返回成功
```

**关键变化**：不再复制文件到用户目录，仅建立数据库引用

### 3.8 新增：GET /api/cloud/files/:hash/info — 文件信息

```json
{
  "code": 200,
  "data": {
    "hash": "a1b2c3d4...",
    "original_name": "IMG_001.jpg",
    "display_name": "IMG_001.jpg",
    "size": 1048576,
    "mime_type": "image/jpeg",
    "ref_count": 3,
    "uploaded_at": "2026-07-01T12:00:00.000Z"
  }
}
```

用于调试和管理员查看文件引用情况。

---

## 四、前端修改

### 4.1 CloudDrive.vue

| 位置 | 旧代码 | 新代码 |
|------|--------|--------|
| `deleteFile(file)` | `api.delete('/cloud/files/' + encodeURIComponent(file.name))` | `api.delete('/cloud/files/' + encodeURIComponent(file.hash))` |
| `getMediaType(file.name)` | 解析文件名中的 `__audio/__video/__image` 标记 | 优先使用 `file.mime_type`，回退到文件名解析 |
| 文件列表渲染 | 不变 | 不变（`file.name`、`file.url`、`file.size` 字段保留） |

### 4.2 CloudImagePicker.vue

| 位置 | 旧代码 | 新代码 |
|------|--------|--------|
| `getFileType(name)` | 扩展名 + `__audio/__video/__image` 标记解析 | 优先使用 `file.mime_type` |
| `selectFile(file)` | emit `file` 对象（含 name, url） | emit 保持不变，额外携带 hash |
| `filteredFiles` | `file.name` 搜索 | 不变 |

### 4.3 CloudUpload.vue

- 上传逻辑不变（仍发 multipart/form-data）
- 上传成功后响应中多了 `hash` 字段，不影响现有逻辑

### 4.4 GuestUpload.vue

- 完全不变

---

## 五、迁移脚本

### 触发时机

迁移在服务器启动时自动执行（`init-db.js` 中），幂等（已迁移的文件跳过）。

### 迁移步骤

```
1. 检查 cloud_files 表是否存在，如已有数据则跳过迁移
2. 创建 shared/ 目录结构
3. 遍历 Resources/cloud/ 下所有数字命名的用户目录
4. 对每个用户目录下的 photos/ 中每个文件：
   a. 计算 SHA-256
   b. 如果 cloud_files 中已有此哈希：
      - ref_count + 1
      - INSERT cloud_user_files（owner=该文件所属 userId）
      - 删除原文件（已存在共享副本）
   c. 如果 cloud_files 中无此哈希：
      - 移动文件到 shared/<hash[0:2]>/<hash>.<ext>
      - INSERT cloud_files + cloud_user_files
5. 清理空的 photos/ 目录（可选）
6. 保留 note/ 目录不动
```

### 所有权判断

- **所有文件**都在 `<userId>/photos/` 目录下，**owner 就是目录名 `userId`**，无需从文件名解析
- 新格式文件名中的 userId 前缀是冗余的，不作为所有权依据
- 极少数不在用户目录下的文件（如直接在 cloud/ 根目录的孤立文件）：计算哈希后存入 shared/，owner 标记为 `__system__`

### 转码文件处理

- 迁移时不重新转码（避免迁移耗时过长），保持文件原始格式
- 迁移后新上传的视频文件继续走转码流程

### 迁移安全

- 整个迁移过程使用 SQLite 事务包裹
- 迁移前备份 `cloud_files` 和 `cloud_user_files` 表状态
- 迁移完成后写入 `system_settings` 标记位：`cloud_migration_completed = true`

---

## 六、技术细节

### 6.1 SHA-256 计算

```js
var crypto = require('crypto');

function computeFileHash(filePath) {
  return new Promise(function(resolve, reject) {
    var hash = crypto.createHash('sha256');
    var stream = fs.createReadStream(filePath);
    stream.on('data', function(chunk) { hash.update(chunk); });
    stream.on('end', function() { resolve(hash.digest('hex')); });
    stream.on('error', reject);
  });
}
```

- 200MB 文件计算约 1-2 秒（取决于磁盘速度）
- 对于批量上传，串行计算避免 CPU 争抢

### 6.2 文件移动（同磁盘原子操作）

```js
// .tmp/ → shared/ 同磁盘 rename，原子且不复制数据
var destDir = path.join(cloudDir, 'shared', hash.substring(0, 2));
fs.mkdirSync(destDir, { recursive: true });
var destPath = path.join(destDir, hash + ext);
fs.renameSync(tempPath, destPath);
```

### 6.3 视频转码与哈希的时序

转码改变文件内容，必须在转码后计算哈希：

```
multer 保存原始文件到 .tmp/
  ↓
tryTranscodeVideoToMp4(tmpPath)  ← 如果转码成功，tmp 文件被替换为 mp4
  ↓
computeFileHash(tmpPath)         ← 对最终文件计算哈希
  ↓
move tmp → shared/<hash[0:2]>/<hash>.<ext>
```

### 6.4 并发上传同一文件

两个用户同时上传相同内容的文件：

```
用户A上传                   用户B上传
  ↓                           ↓
计算哈希 = H                计算哈希 = H
  ↓                           ↓
INSERT cloud_files(H)       INSERT cloud_files(H)
  → 成功                     → UNIQUE 冲突！
  ↓
INSERT cloud_user_files     db 报 SQLITE_CONSTRAINT
  → 成功                       ↓
                          catch 冲突 → 重新查询确认存在
                            → INSERT cloud_user_files(H)
                            → UPDATE ref_count + 1
```

使用 `INSERT OR IGNORE` + 二次确认处理竞态。

### 6.5 文件访问安全

```js
// 哈希参数校验：只允许十六进制字符
if (!/^[a-f0-9]{64}$/.test(hash)) {
  return res.status(400).json({ code: 400, message: '无效的文件标识' });
}
```

哈希是十六进制字符串，天然不含路径遍历字符，比旧的文件名校验更安全。

### 6.6 .trash 清理策略

- 文件移入 `.trash/` 后保留 7 天
- 每次上传时顺便清理过期的 trash 文件（懒清理，避免定时任务）
- 清理逻辑：`fs.readdirSync(trashDir)` → 检查 mtime → 超过 7 天的删除

---

## 七、向后兼容

### 破坏性变化

| 变化 | 影响 |
|------|------|
| 文件 URL 从 `/api/cloud/files/<filename>` 变为 `/api/cloud/files/<hash>` | 旧书签/旧消息中的 URL 失效 |
| 文件列表 API 返回新字段 | `name` 保留，前端不受影响 |
| 删除 API 改用 hash | 前端需小改 |

### 兼容处理

- 服务启动时迁移旧文件到新结构后，旧 URL 必然失效
- 可在迁移后保留一个映射表（`old_name → hash`），对旧 URL 做 301 重定向（可选，非必须）
- 建议：直接迁移，旧消息中引用的图片 URL 本身就是临时性的

---

## 八、预留能力

### 8.1 用户文件夹/分组（已预留）

`cloud_user_files.folder` 字段已就绪：

**未来可新增 API**：
- `POST /api/cloud/folders` — 创建文件夹
- `PUT /api/cloud/files/:hash/move` — 移动文件到文件夹
- `GET /api/cloud/files?folder=xxx` — 按文件夹筛选

**前端展示**（未来）：
- CloudDrive 侧边栏显示文件夹列表
- 拖拽文件到文件夹
- 文件夹内搜索

### 8.2 文件标签（可扩展）

`cloud_user_files` 可加 `tags TEXT DEFAULT '[]'` 字段，支持用户打标签。

### 8.3 分享链接

基于哈希生成分享链接，无需复制文件：
- `POST /api/cloud/files/:hash/share` → 生成分享 token
- `GET /api/cloud/shared/:token` → 免登录访问

---

## 九、修改文件清单

### 后端

| 文件 | 修改内容 |
|------|---------|
| `server/src/routes/cloud.js` | 重写上传/列表/获取/删除/转存 API；新增 hash 计算函数 |
| `server/src/utils/init-db.js` | 新增 `cloud_files` 和 `cloud_user_files` 表；新增迁移逻辑 |

### 前端

| 文件 | 修改内容 |
|------|---------|
| `client/src/views/CloudDrive.vue` | 删除改用 hash；`getMediaType` 支持 mime_type |
| `client/src/components/CloudImagePicker.vue` | `getFileType` 支持 mime_type |

### 不需要修改

| 文件 | 原因 |
|------|------|
| `client/src/views/CloudUpload.vue` | 上传逻辑不变，响应新字段不影响 |
| `client/src/views/GuestUpload.vue` | 同上 |
| `client/src/components/RecordModal.vue` | 录音录像后上传，逻辑不变 |
| `client/src/utils/media-recorder.js` | 纯客户端，不涉及存储 |
| `server/src/services/stream-transcoder.js` | 转码接口不变，调用方式微调 |
| `server/src/middleware/auth.js` | 不涉及认证逻辑 |

---

## 十、测试要点

1. **上传去重**：同一文件上传两次 → 磁盘只有一份，ref_count=2
2. **转存去重**：用户 A 上传 → 用户 B 转存 → 磁盘只有一份
3. **删除保护**：用户 A 删除 → 用户 B 仍可访问
4. **引用归零清理**：所有引用者删除 → 文件移入 .trash
5. **视频转码**：上传 .mov → 转码 .mp4 → 哈希基于 mp4 内容
6. **并发上传**：两个用户同时上传同一文件 → 无错误，ref_count 正确
7. **旧文件迁移**：启动后旧文件正确迁移到 shared/ 并建立引用
8. **大文件**：200MB 文件上传和哈希计算正常
