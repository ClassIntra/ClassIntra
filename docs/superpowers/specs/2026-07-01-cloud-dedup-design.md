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
- **原始上传者拥有删除权**：只有第一个上传该文件的用户能删除物理文件，转存者仅收藏引用
- **软删除 + 占位**：文件被原始上传者删除后，聊天/论坛/笔记中显示"文件已删除"占位而非裂图
- **自动迁移**：现有文件自动去重迁移到新结构
- **预留分组**：数据库设计预留用户自定义文件夹/分组能力

### 删除权限模型

```
原始上传者（owner）→ 可删除物理文件 → 所有人的引用消失 → 聊天/论坛显示"文件已删除"
转存者（saver）    → 仅可移除自己的引用（取消收藏）→ 不影响其他人
```

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
  owner_user_id TEXT NOT NULL,        -- 原始上传者（第一个上传此文件的用户），拥有删除权
  original_name TEXT NOT NULL,        -- 首次上传时的原始文件名
  size INTEGER NOT NULL,              -- 字节数
  mime_type TEXT NOT NULL,            -- image/png, video/mp4, audio/webm...
  storage_path TEXT NOT NULL,         -- shared/ 下的相对路径，如 a1/b2c3...full.png
  deleted INTEGER NOT NULL DEFAULT 0, -- 软删除标记：0=正常, 1=已被原始上传者删除
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 用户文件关联表：用户→文件的引用关系（"收藏/转存"）
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
CREATE INDEX IF NOT EXISTS idx_cf_owner ON cloud_files(owner_user_id);
```

- `owner_user_id`：记录第一个上传该文件的用户，**只有此用户能删除物理文件**
- `deleted`：软删除标记。设为 1 后文件服务返回占位图而非 404，确保聊天/论坛/笔记中不会出现裂图
- `UNIQUE(user_id, file_hash, folder)`：同一用户对同一文件在同一文件夹下唯一（预留分组能力）
- `folder`：当前始终为空字符串，未来可扩展为用户自定义分组

---

## 三、API 设计

### 3.1 POST /api/cloud/upload — 文件上传（修改）

**流程变化**：

```
旧流程：multer → 用户 photos/ 目录 → 转码 → 返回
新流程：multer → .tmp/ 目录 → 转码(如需要) → 计算 SHA-256
       → 查 cloud_files 是否存在
         → 存在且未被删除：INSERT OR IGNORE cloud_user_files（用户收藏此文件）
         → 不存在：移到 shared/<xx>/<hash>.<ext>，INSERT cloud_files(owner=当前用户) + cloud_user_files
       → 删除 tmp
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
- `cloud_user_files` 插入使用 `INSERT OR IGNORE`：如果用户已收藏该文件，静默跳过
- `cloud_files.owner_user_id` 设置为第一个成功上传该文件的用户（INSERT 时记录，已存在则不动）
- `cloud_user_files` 插入使用 `INSERT OR IGNORE`：如果用户已有该文件（同哈希），静默跳过，返回已有文件信息

### 3.2 POST /api/cloud/upload-batch — 批量上传（修改）

- 串行处理（保持现有串行转码逻辑）
- 每个文件独立跑上传流程（哈希去重）

### 3.3 POST /api/cloud/guest-upload — 免登录上传（修改）

- 流程与普通上传一致
- 文件归属为上传码所有者（`guestOwnerId`）

### 3.4 GET /api/cloud/files — 文件列表（修改）

**旧**：`fs.readdirSync(photoDir)` 扫描磁盘  
**新**：数据库查询（自动过滤已删除文件）

```sql
SELECT cuf.file_hash, cuf.display_name, cuf.folder, cuf.uploaded_at,
       cf.size, cf.mime_type, cf.storage_path
FROM cloud_user_files cuf
JOIN cloud_files cf ON cuf.file_hash = cf.hash
WHERE cuf.user_id = ? AND cf.deleted = 0
ORDER BY cuf.uploaded_at DESC
```

- `cf.deleted = 0` 确保被原始上传者删除的文件不会出现在任何用户的列表中

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
**新**：哈希直查数据库 + 软删除占位

```
1. 安全检查 hash 参数（仅允许十六进制 64 字符）
2. SELECT storage_path, deleted, mime_type FROM cloud_files WHERE hash = ?
3. 如果记录不存在 → 404
4. 如果 deleted = 1：
   → 返回"文件已删除"占位图（根据 mime_type 返回对应占位 SVG/PNG）
   → 图片类型：返回占位图片（灰底 + "文件已删除"文字）
   → 视频/音频类型：返回 410 Gone 状态码，前端显示占位提示
5. 如果 deleted = 0：
   → 拼接完整路径：Resources/cloud/shared/<storage_path>
   → sendMediaFile() 发送（Range 支持保持不变）
```

**占位图方案**：
- 后端动态生成一个 SVG 占位图（200×200，灰色背景 + 文件图标 + "文件已删除"）
- 或者返回一个静态 PNG 资源 `/resources/cloud/deleted-placeholder.png`
- 占位图方案确保聊天/论坛/笔记中已删除的图片不会显示裂图（404 broken image）
- 对于音频/视频：返回 410 Gone，前端 `<audio>/<video>` 标签显示浏览器原生错误状态

- 不再需要遍历用户目录，O(1) 查询
- 不再需要兼容新旧文件名格式

### 3.6 DELETE /api/cloud/files/:hash — 删除文件（修改）

**旧**：`fs.unlinkSync(filePath)` 直接物理删除
**新**：区分权限——owner 删除物理文件，非 owner 仅取消收藏

```
1. 安全检查 hash 参数
2. 查 cloud_files 确认文件存在且未被删除
3. 判断当前用户身份：
   
   【情况A：当前用户是 owner_user_id（原始上传者）】
   a. UPDATE cloud_files SET deleted = 1 WHERE hash = ?
   b. 将物理文件移到 .trash/<hash>.<ext>（延迟清理，保留占位能力）
   c. DELETE FROM cloud_user_files WHERE file_hash = ?
      （移除所有用户的收藏记录，文件从所有人的云盘中消失）
   d. 返回 { deleted: true, owner_delete: true }
   
   【情况B：当前用户不是 owner（转存者/收藏者）】
   a. DELETE FROM cloud_user_files WHERE user_id = ? AND file_hash = ?
      （仅移除自己的收藏，不影响物理文件和其他用户）
   b. 返回 { deleted: true, owner_delete: false }
```

**权限总结**：
| 操作者 | 效果 |
|--------|------|
| 原始上传者 | 物理文件软删除 → 所有用户云盘中消失 → 聊天/论坛显示"文件已删除"占位 |
| 转存者 | 仅从自己云盘中移除（取消收藏），文件仍存在 |

### 3.7 POST /api/cloud/save-from-url — 转存（修改）

**旧**：`fs.copyFileSync()` 物理复制  
**新**：纯数据库操作（收藏引用）

```
1. 从 URL 解析源文件 → 定位源文件路径 → 计算或查找其哈希
2. 如果源文件不在 cloud_files 表中（如 /resources/ 下系统资源首次被转存）：
   a. 计算哈希 → 如果 shared/ 中不存在，复制到 shared/
   b. 创建 cloud_files 记录（owner_user_id = 当前用户，或保持为 __system__）
3. INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name, folder)
4. 返回成功（无需操作 cloud_files.ref_count，该字段已移除）
```

**关键变化**：不再复制文件到用户目录，仅建立数据库引用（收藏关系）

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
| 删除确认文案 | "确认删除此文件？" | 如果自己是 owner："删除后所有转存此文件的用户也会失去访问权，确认删除？"；如果不是 owner：仅"确认从云盘移除此文件？" |
| `getMediaType(file.name)` | 解析文件名中的 `__audio/__video/__image` 标记 | 优先使用 `file.mime_type`，回退到文件名解析 |
| 文件列表渲染 | 不变 | 不变（`file.name`、`file.url`、`file.size` 字段保留） |

**owner 判断**：前端可新增可选字段 `is_owner`，API 在文件列表响应中返回（对比 `file.owner_user_id === currentUserId`）

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
1. 检查 cloud_files 表是否已有数据，如有则跳过迁移
2. 创建 shared/ 目录结构
3. 遍历 Resources/cloud/ 下所有数字命名的用户目录
4. 对每个用户目录下的 photos/ 中每个文件：
   a. 计算 SHA-256
   b. 如果 cloud_files 中已有此哈希：
      - INSERT OR IGNORE cloud_user_files 建立引用
      - 删除原文件（已存在共享副本）
   c. 如果 cloud_files 中无此哈希：
      - 移动文件到 shared/<hash[0:2]>/<hash>.<ext>
      - INSERT cloud_files（owner_user_id = 文件所在目录名，即 userId）
      - INSERT cloud_user_files 建立引用
5. 清理空的 photos/ 目录（可选）
6. 保留 note/ 目录不动
```

### 所有权判断

- **所有文件**都在 `<userId>/photos/` 目录下，**owner_user_id 就是目录名 `userId`**
- 文件在哪个用户的目录里，该用户就是原始上传者
- 极少数不在用户目录下的文件：owner 标记为 `__system__`

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

- 文件被原始上传者删除后移入 `.trash/`，保留 7 天
- 7 天内：`cloud_files.deleted = 1` 保留数据库记录，文件服务返回占位图
- 7 天后：清理脚本删除 `.trash/` 中的物理文件和 `cloud_files` 中的数据库记录
- 清理后：访问该哈希返回真正的 404
- 每次上传时懒清理过期 trash（避免定时任务开销）

### 6.7 占位图生成

```js
// 后端动态生成 1×1 像素占位 SVG（极轻量，base64 内联）
// 或者返回一个预制的 PNG 文件
function sendDeletedPlaceholder(res, mimeType) {
  if (mimeType && mimeType.indexOf('image/') === 0) {
    // 返回占位 SVG
    var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect fill="#e0e0e0" width="200" height="200" rx="8"/>
      <text x="100" y="95" text-anchor="middle" fill="#999" font-size="14">文件已删除</text>
      <text x="100" y="115" text-anchor="middle" fill="#bbb" font-size="11">File Deleted</text>
    </svg>`;
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } else {
    // 音频/视频返回 410
    res.status(410).json({ code: 410, message: '文件已被上传者删除' });
  }
}
```

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

1. **上传去重**：同一文件上传两次 → 磁盘只有一份，两个用户都收藏了它
2. **转存去重**：用户 A 上传 → 用户 B 转存 → 磁盘只有一份，B 仅建立引用
3. **owner 删除**：A 上传 → B 转存 → A 删除 → B 云盘中消失，文件移入 .trash
4. **非 owner 取消收藏**：A 上传 → B 转存 → B 取消收藏 → A 云盘中仍存在，物理文件不变
5. **聊天占位**：A 上传图片 → 发到聊天 → A 删除 → 聊天中图片显示"文件已删除"占位图而非裂图
6. **论坛/笔记占位**：同上，已删除文件显示占位而非 404
7. **视频转码**：上传 .mov → 转码 .mp4 → 哈希基于 mp4 内容
8. **并发上传**：两个用户同时上传同一文件 → owner 为第一个完成 INSERT 的用户
9. **旧文件迁移**：启动后旧文件正确迁移到 shared/ 并建立引用关系
10. **大文件**：200MB 文件上传和哈希计算正常
