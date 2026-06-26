# ClassNet 版本管理制度

## 版本号格式（SemVer）

```
MAJOR.MINOR.PATCH

示例: 1.3.2
  MAJOR = 1   （主版本）
  MINOR = 3   （次版本）
  PATCH = 2   （修订号）
```

## 版本号升级规则

### 自动升级（日常开发）

每次运行 `npm run build` 时，**PATCH（修订号）自动 +1**。

```
1.0.0 → 1.0.1 → 1.0.2 → 1.0.3 ...
```

### 手动升级（功能发布）

当你完成一个功能模块的开发，手动修改 `server/version.json` 中的 **MINOR（次版本）**，下次构建时 PATCH 自动归零。

```
1.0.27  → 手动改为 1.1.0 → 构建后 1.1.0
1.1.5   → 手动改为 1.2.0 → 构建后 1.2.0
```

### 重大升级（架构变更）

当发生不兼容的架构变更或底层重写时，手动修改 **MAJOR（主版本）**。

```
1.9.3 → 手动改为 2.0.0 → 构建后 2.0.0
```

## 何时手动修改版本号

大多数情况下**不需要管版本号**——每次构建 PATCH 自动 +1。

| 操作 | 版本号变更 |
|------|-----------|
| 日常开发（AI 写代码、修 bug、加小功能） | PATCH 自动 +1，完全不用管 |
| 感觉积累了不少新功能，想标记一下 | 手动改 MINOR +1（PATCH 自动归零） |
| 重大架构变更（极少发生） | 手动改 MAJOR +1 |

> **简单说：不碰就是自动累加，想标记里程碑就手动改一下。**

## 关键文件

```
ClassNet/
├── server/version.json          ← 版本号权威数据源
├── client/scripts/prebuild.js   ← 构建前自动处理脚本
├── client/vite.config.js        ← 读取 version.json 注入全局变量
├── CHANGELOG.md                 ← 自动生成的变更日志
└── docs/version-management.md   ← 本文档
```

## version.json 结构

```json
{
  "version": "1.0.5",
  "lastBuiltVersion": "1.0.4",
  "buildHash": "a1b2c3d4e5f6g7h8",
  "buildTime": "2026-06-25T08:30:00.000Z",
  "changelog": "### 修复\n- 修复登录页面样式错误\n\n### 新增\n- 添加用户头像上传功能",
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

## CHANGELOG.md

每次构建时自动从 `git log` 提取提交记录生成，不分类，直接列出：

```markdown
# Changelog

## [1.0.5] - 2026-06-25
- feat: 添加用户头像上传功能
- fix: 修复登录页面样式错误
- refactor: 优化组件结构

## [1.0.4] - 2026-06-24
...
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/system/version` | GET | 获取当前版本信息 |
| `/api/system/heartbeat` | GET | 心跳检测（含版本和强制更新标记） |
| `/api/system/set-version` | POST | 管理员设置版本信息（需认证） |

## 设置页面版本显示

设置 → 关于系统 页面显示：
- **版本号**：从 `/api/system/version` 获取，`__APP_VERSION__` 作为初始值
- **构建标识**：8 字节随机 hex，用于客户端缓存清理
- **构建日期**：从 `buildTime` 解析为 `YYYY-MM-DD HH:mm` 格式

## WebSocket 版本广播

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

## 发布流程

```
日常开发:
  写代码 → git commit → npm run build
  └── prebuild: PATCH 自动 +1, changelog 自动生成

功能发布:
  写代码 → git commit → 手动改 server/version.json 的 MINOR → npm run build
  └── prebuild: PATCH 归零, changelog 自动生成

重大升级:
  写代码 → git commit → 手动改 server/version.json 的 MAJOR → npm run build
  └── prebuild: MINOR/PATCH 归零, changelog 自动生成
```
