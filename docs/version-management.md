# ClassIntra 版本管理制度与发布制度

本文件是 ClassIntra 的**版本管理**与**GitHub Release 发布**的权威规范。所有版本号变更、CHANGELOG 维护、tag 与 Release 发布必须遵循本文档。

---

## 1. 版本号格式（SemVer）

```
MAJOR.MINOR.PATCH

示例: 1.3.2
  MAJOR = 1   （主版本：不兼容的架构变更）
  MINOR = 3   （次版本：新增功能，向后兼容）
  PATCH = 2   （修订号：bug 修复，向后兼容）
```

版本号**只增不减**，禁止回退。

---

## 2. 版本号升级规则

### 2.1 日常开发（自动）

每次运行 `npm run build`（根目录）时，由 `client/scripts/prebuild.js` 自动处理：

- 若 `version.json` 中 MAJOR/MINOR 未变化 → PATCH 自动 +1
- 若 MAJOR/MINOR 已手动修改 → PATCH 归零

```
1.0.0 → 1.0.1 → 1.0.2 → 1.0.3 ...
```

> 日常开发中**不需要手动管版本号**，构建即自动递增。

### 2.2 功能发布（手动）

完成一个功能模块后，手动修改 `server/version.json` 的 MINOR，下次构建 PATCH 自动归零：

```
1.0.27 → 手动改为 1.1.0 → 构建后 1.1.0
1.1.5  → 手动改为 1.2.0 → 构建后 1.2.0
```

### 2.3 重大升级（手动）

发生不兼容架构变更时，手动修改 MAJOR：

```
1.9.3 → 手动改为 2.0.0 → 构建后 2.0.0
```

| 操作 | 版本号变更 |
|------|-----------|
| 日常开发（修 bug、加小功能） | PATCH 自动 +1，不用管 |
| 感觉积累了不少新功能，想标记一下 | 手动改 MINOR +1（PATCH 自动归零） |
| 重大架构变更（极少发生） | 手动改 MAJOR +1 |

---

## 3. 关键文件与版本同步

```
ClassIntra/
├── server/version.json          ← 版本号权威数据源（唯一源头）
├── client/scripts/prebuild.js   ← 构建前自动处理脚本（版本递增 + CHANGELOG 生成）
├── client/vite.config.js        ← 读取 version.json 注入全局变量
├── CHANGELOG.md                 ← 自动生成的变更日志
├── scripts/release.js           ← 一键发布脚本（构建 + commit + tag + gh release）
└── docs/version-management.md   ← 本文档
```

### 版本号同步机制

`server/version.json` 是**唯一权威数据源**。`scripts/release.js` 发布时会将以下文件的 `version` 字段与 `version.json` 对齐：

```
package.json          （根目录）
client/package.json
server/package.json
apps/package.json
plugins/package.json
```

> **规则：所有 package.json 的 version 必须与 version.json 一致，否则视为违规。**
> 日常构建只修改 version.json（及 CHANGELOG.md），package.json 在正式发布时由 release.js 统一同步。

---

## 4. version.json 结构

```json
{
  "version": "1.0.5",
  "lastBuiltVersion": "1.0.4",
  "buildHash": "a1b2c3d4e5f6g7h8",
  "buildTime": "2026-06-25T08:30:00.000Z",
  "changelog": "### 修复\n- 修复登录页面样式错误",
  "minClientVersion": "1.0.0",
  "forceUpdate": false,
  "updateUrl": ""
}
```

| 字段 | 说明 |
|------|------|
| `version` | 当前版本号 |
| `lastBuiltVersion` | 上次构建的版本号（用于判断手动/自动升级） |
| `buildHash` | 构建标识（自动生成，用于缓存清理） |
| `buildTime` | 构建时间（ISO 8601 格式） |
| `changelog` | 本次构建的变更摘要 |
| `minClientVersion` | 最低兼容客户端版本 |
| `forceUpdate` | 是否强制更新 |
| `updateUrl` | 更新地址 |

---

## 5. CHANGELOG.md 规范

每次构建时由 `prebuild.js` 自动从 `git log` 提取提交记录，**最新版本在最上方**，时间倒序：

```markdown
# Changelog

## [1.2.1] - 2026-08-26
【安全】
- 修复 33 个 Dependabot 依赖漏洞（11 high）

## [1.2.0] - 2026-08-25
【新增】
- 联机 Gomoku：支持在线对局与市场应用接入

## [1.1.92] - 2026-08-26
【其他】
fix(market): use dedicated application market icon

## [1.1.84] - 2026-08-25
版本更新
```

### 规范要求

1. **版本顺序必须严格倒序**：新版本永远插在文件顶部（`# Changelog` 之下，最上方）。禁止出现旧版本插到新版本下方或重复条目。
2. **同版本不重复**：prebuild.js 会幂等去重，同一版本只保留一个条目。
3. **分类格式**：`【新增】` / `【修复/优化】` / `【其他】` / `【安全】`。无实质内容时写 `版本更新`。
4. **日期格式**：`YYYY-MM-DD`（版本条目的日期可以不同于创建日期，= 该版本实际发布日）。

---

## 6. GitHub Release 发布制度

### 6.1 发布流程（一键脚本）

正式发布统一使用 `scripts/release.js`，**禁止手动在 GitHub 网页上发布**（容易造成版本与 CHANGELOG 不一致）：

```bash
# 在 ClassIntra/ 根目录下

# 1. 预览将要执行的动作（不修改任何文件）
node scripts/release.js patch --dry-run

# 2. 正式发布补丁版（默认行为：PATCH +1）
node scripts/release.js patch

# 3. 发布次版本 / 主版本
node scripts/release.js minor
node scripts/release.js major

# 4. 带自定义 changelog 说明
node scripts/release.js patch --message "fix: 修复登录超时问题"

# 5. 跳过测试（不推荐，正式发布应保留）
node scripts/release.js patch --skip-tests

# 6. 发布并推送 main + tag 到 origin
node scripts/release.js patch --push
```

### 6.2 release.js 执行流程

```
步骤 1: 运行服务端测试 pnpm test（--skip-tests 可跳过）
步骤 2: 构建客户端（prebuild 自动递增版本号 + 生成 CHANGELOG 条目）
步骤 3: 同步 server/version.json 与所有 package.json 的 version
步骤 4: git add -A → git commit "chore(release): prepare <版本>" → git tag v<版本>
步骤 5: 若 gh 已安装且已认证 → gh release create（notes 取自 CHANGELOG 顶部条目）
步骤 6: （可选 --push）git push origin main + git push origin <tag>
```

### 6.3 命名规范

| 项目 | 规范 | 示例 |
|------|------|------|
| Git tag | `v<版本>` | `v1.2.1` |
| Release 标题 | `v<版本>` | `v1.2.1` |
| Release 正文 | 对应 CHANGELOG 条目正文 | `【安全】\n- 修复 33 个...` |
| Release tag | 与 Git tag 完全一致 | `v1.2.1` |

### 6.4 一致性红线

以下三处**必须永远一致**，发布前必须核对：

```
server/version.json 的 version == CHANGELOG.md 顶部条目版本 == GitHub Release tag
```

- 每次发布后，`CHANGELOG.md` 顶部版本 = `server/version.json` = GitHub Release tag，缺一不可。
- 如果发现不一致，**以 `server/version.json` 为准**修正其余两处。
- 修订历史：**禁止**修改已发布的 tag 或 Release（如确需修正，新建更高版本号，而非覆盖旧版本）。

### 6.5 gh CLI 准备

安装 GitHub CLI 后，首次使用前需认证：

```bash
gh auth login
# 选择 GitHub.com → HTTPS → Login with a web browser
# 完成后验证:
gh auth status
```

未认证时 release.js 会跳过 Release 创建并给出提示。

---

## 7. 发布 Checklist

正式发布前逐项确认：

- [ ] server 测试通过（`cd server && pnpm test`）
- [ ] 客户端构建通过（`npm run build`）
- [ ] CHANGELOG.md 顶部版本与 version.json 一致
- [ ] 所有 package.json 的 version 与 version.json 一致
- [ ] gh CLI 已安装且已认证（`gh auth status`）
- [ ] 确认发布类型（patch / minor / major）正确
- [ ] GitHub Release 标题与 tag 均为 `v<版本>`
- [ ] Release 正文与 CHANGELOG 对应条目一致

---

## 8. 回滚与治理

### 版本回滚

版本号只增不减。发现误发版本时，**不修改已发布的版本**，而是发布更高版本修复：

```
原计划:  1.2.1（有 bug，已发布）
修正:    新发布 1.2.2（修复），不删除/修改 1.2.1
```

### 一致性纠偏

若发现版本不一致（如本次 1.2.0 与 CHANGELOG 错位）：

1. 以 `server/version.json` 为权威数据源
2. 修正 CHANGELOG.md 顺序与重复条目（顶部 = 最新）
3. 同步所有 package.json
4. 若 GitHub 已有 tag，用 `gh release edit` 修正标题/正文（仅当 tag 正确、内容错误时）

---

## 9. API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/system/version` | GET | 获取当前版本信息 |
| `/api/system/heartbeat` | GET | 心跳检测（含版本和强制更新标记） |
| `/api/system/set-version` | POST | 管理员设置版本信息（需认证） |

## 10. 设置页面版本显示

设置 → 关于系统 页面显示：
- **版本号**：从 `/api/system/version` 获取，`__APP_VERSION__` 作为初始值
- **构建标识**：8 字节随机 hex，用于客户端缓存清理
- **构建日期**：从 `buildTime` 解析为 `YYYY-MM-DD HH:mm` 格式

## 11. WebSocket 版本广播

当管理员通过 `/api/system/set-version` 更新版本号时，服务器通过 WebSocket 向所有在线客户端广播：

```json
{
  "type": "app_update_available",
  "version": "1.1.0",
  "forceUpdate": false,
  "changelog": "...",
  "minClientVersion": "1.0.0"
}
```