# ClassIntra 开发指南

> 本文档介绍如何在 ClassIntra 中新增应用、注册服务、写 DB migration、注册快捷键和搜索源。
> 初学者请先阅读 [architecture.md](./architecture.md)。

---

## 目录

- [新增应用](#1-新增应用)
- [注册服务到 ServiceRegistry](#2-注册服务到-serviceregistry)
- [写 DB Migration](#3-写-db-migration)
- [注册快捷键](#4-注册快捷键)
- [注册搜索源](#5-注册搜索源)
- [订阅 EventBus 事件](#6-订阅-eventbus-事件)
- [使用 PersistenceStore](#7-使用-persistencestore)
- [添加主题 Token](#8-添加主题-token)
- [代码风格约定](#9-代码风格约定)
- [构建与提交](#10-构建与提交)

---

## 1. 新增应用

### 1.1 创建应用目录

在 `apps/` 下创建新目录，结构如下：

```
apps/my-app/
├── manifest.json              # 必填，应用清单
├── frontend/
│   ├── MyApp.vue              # 主页面组件
│   ├── widgets/               # 可选，桌面小组件
│   │   └── MyAppWidget.vue
│   └── store.js               # 可选，Vuex 模块
└── backend/
    └── routes.js              # 可选，Express 路由
```

### 1.2 编写 manifest.json

```json
{
  "name": "my-app",
  "type": "app",
  "version": "1.0.0",
  "label": "我的应用",
  "icon": "/resources/public/icons/MyApp.png",
  "color": "#5856D6",
  "category": "desktop",
  "order": 20,
  "defaultEnabled": true,
  "canDisable": true,
  "frontend": {
    "route": "/my-app",
    "routeName": "MyApp",
    "component": "./frontend/MyApp.vue",
    "widgets": [
      {
        "id": "my-app-widget",
        "name": "我的应用组件",
        "component": "./frontend/widgets/MyAppWidget.vue",
        "defaultSize": { "w": 2, "h": 2 },
        "minSize": { "w": 1, "h": 1 },
        "maxSize": { "w": 4, "h": 4 },
        "description": "显示我的应用摘要",
        "configSchema": {
          "fields": [
            {
              "key": "filter",
              "label": "显示范围",
              "type": "select",
              "options": [
                { "value": "all", "label": "全部" },
                { "value": "pinned", "label": "仅置顶" }
              ],
              "default": "all"
            },
            {
              "key": "count",
              "label": "显示数量",
              "type": "number",
              "default": 5,
              "min": 1,
              "max": 20
            },
            {
              "key": "showAvatar",
              "label": "显示头像",
              "type": "bool",
              "default": true
            }
          ]
        }
      }
    ]
  },
  "backend": {
    "mountPath": "/api/my-app",
    "entry": "./backend/routes.js",
    "rateLimit": {
      "max": 100,
      "windowMs": 60000,
      "message": "请求过于频繁，请稍后再试"
    }
  }
}
```

### 1.3 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | 应用唯一标识，kebab-case |
| label | string | 是 | - | 显示名 |
| type | string | 否 | `'app'` | `app` / `system` / `widget` |
| version | string | 否 | `'0.0.0'` | semver 版本号 |
| icon | string | 否 | - | 图标路径，绝对路径或 `./icon.png` |
| color | string | 否 | - | 主题色 hex |
| category | string | 否 | `'desktop'` | `desktop` / `system` / `hidden` |
| order | number | 否 | `99` | 排序权重，越小越靠前 |
| defaultEnabled | boolean | 否 | `true` | 是否默认启用 |
| canDisable | boolean | 否 | `true` | 是否允许用户禁用 |
| frontend | object | 否 | - | 前端配置 |
| backend | object | 否 | - | 后端配置 |
| extraBackends | array | 否 | - | 附加后端路由 |

### 1.4 编写前端组件

```vue
<!-- apps/my-app/frontend/MyApp.vue -->
<template>
  <div class="my-app-page">
    <h1>我的应用</h1>
    <p>{{ message }}</p>
    <button @click="fetchData">刷新</button>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'MyApp',
  data: function() {
    return {
      message: 'Hello ClassIntra!'
    };
  },
  methods: {
    fetchData: function() {
      var self = this;
      api.get('/api/my-app/data').then(function(res) {
        if (res.data.code === 200) {
          self.message = res.data.data.message;
        }
      }).catch(function(err) {
        console.error('获取数据失败:', err);
      });
    }
  },
  mounted: function() {
    this.fetchData();
  }
};
</script>

<style scoped>
.my-app-page {
  padding: 20px;
}
</style>
```

### 1.5 编写后端路由

```javascript
// apps/my-app/backend/routes.js
var express = require('express');
var router = express.Router();

// 鉴权中间件（如需要）
var auth = require('../../../server/src/middleware/auth');

// GET /api/my-app/data
router.get('/data', auth.requireAuth, function(req, res) {
  res.json({
    code: 200,
    data: {
      message: 'Hello from backend at ' + new Date().toISOString()
    }
  });
});

// POST /api/my-app/items
router.post('/items', auth.requireAuth, function(req, res) {
  var { name } = req.body;
  if (!name) {
    return res.status(400).json({ code: 400, message: 'name 必填' });
  }
  // ... 业务逻辑
  res.json({ code: 200, data: { id: Date.now(), name: name } });
});

module.exports = router;
```

### 1.6 添加图标

将图标 PNG 放到 `Resources/public/icons/MyApp.png`，或在 manifest 中使用相对路径：

```json
{
  "icon": "./icon.png"
}
```

相对路径会自动转换为 `/apps-static/my-app/icon.png`（由 [app-registry.js](../client/src/core/app-registry.js#L17-L19) 处理）。

### 1.7 验证

- **前端构建**：`cd client && npx vite build` — 路由表自动包含新应用
- **后端启动**：`cd server && node src/app.js` — 日志显示 `[route-aggregator] 挂载应用路由: my-app -> /api/my-app`
- **桌面图标**：自动出现在桌面（如果 `category === 'desktop'`）

### 1.8 完整示例参考

参考现有应用：
- [apps/countdown/manifest.json](../apps/countdown/manifest.json) — 含 widget + configSchema
- [apps/resource/manifest.json](../apps/resource/manifest.json) — 含 extraRoutes（cloud-picker）
- [apps/integration/manifest.json](../apps/integration/manifest.json) — 集成管理后台

---

## 2. 注册服务到 ServiceRegistry

### 2.1 注册服务

在 [main.js](../client/src/main.js#L170-L177) 中注册：

```javascript
import { getServiceRegistry } from '@/core/service-registry';
import { getMyService } from '@/core/my-service';

var serviceRegistry = getServiceRegistry();

// 简单注册
serviceRegistry.register('myService', function() {
  return getMyService();
});

// 带销毁函数
serviceRegistry.register('dbConnection', function() {
  var conn = createConnection();
  return {
    instance: conn,
    destroy: function() {
      conn.close();
    }
  };
});
```

### 2.2 在组件中使用

```javascript
// 通过 this.$services（已在 main.js 中挂到 Vue.prototype）
var myService = this.$services.resolve('myService');
myService.doSomething();

// 或直接 import 单例
import { getMyService } from '@/core/my-service';
getMyService().doSomething();
```

### 2.3 自定义服务示例

```javascript
// client/src/core/my-service.js
function MyService() {
  this._cache = {};
}

MyService.prototype.getData = function(key) {
  if (this._cache[key]) return this._cache[key];
  return fetch('/api/my-app/data?key=' + encodeURIComponent(key))
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.code === 200) {
        this._cache[key] = res.data;
        return res.data;
      }
      throw new Error(res.message);
    }.bind(this));
};

MyService.prototype.clearCache = function() {
  this._cache = {};
};

// 单例
var _instance = null;
function getMyService() {
  if (!_instance) {
    _instance = new MyService();
  }
  return _instance;
}

export { MyService, getMyService };
```

---

## 3. 写 DB Migration

### 3.1 何时需要写 migration

- 新增表
- 修改表结构（ALTER TABLE ADD COLUMN）
- 新增索引
- 数据 schema 变更（如类型转换）

### 3.2 创建 migration 文件

在 `server/src/migrations/` 下创建文件，命名为 `NNN_description.js`（`NNN` 是递增版本号）：

```javascript
// server/src/migrations/003_add_notifications_table.js
module.exports = {
  version: 3,
  name: 'add_notifications_table',
  up: function(db) {
    // 必须幂等：CREATE TABLE IF NOT EXISTS
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
    `);

    // 索引也必须幂等
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
    `);
  }
};
```

### 3.3 修改现有表（ALTER TABLE）

```javascript
// server/src/migrations/004_add_user_avatar_column.js
module.exports = {
  version: 4,
  name: 'add_user_avatar_column',
  up: function(db) {
    // 必须检查列是否已存在（ALTER TABLE 不支持 IF NOT EXISTS）
    var columns = db.prepare("PRAGMA table_info(users)").all();
    var hasAvatar = columns.some(function(c) { return c.name === 'avatar_url'; });
    if (!hasAvatar) {
      db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;");
    }
  }
};
```

### 3.4 数据迁移（schema 变更）

```javascript
// server/src/migrations/005_migrate_community_likes_type.js
module.exports = {
  version: 5,
  name: 'migrate_community_likes_type',
  up: function(db) {
    // 把 community_likes.target_id 从 INTEGER 转为 TEXT
    // SQLite 不支持 ALTER COLUMN，需要重建表
    
    // 1. 检查是否已迁移
    var tableInfo = db.prepare("PRAGMA table_info(community_likes)").all();
    var targetIdCol = tableInfo.find(function(c) { return c.name === 'target_id'; });
    if (!targetIdCol || targetIdCol.type === 'TEXT') {
      return; // 已迁移
    }
    
    // 2. 重建表
    db.exec(`
      BEGIN TRANSACTION;
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
      COMMIT;
    `);
  }
};
```

### 3.5 幂等性要求

**所有 migration 必须幂等**，即多次执行结果一致：

| 操作 | 幂等方式 |
|------|----------|
| `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS` |
| `CREATE INDEX` | `CREATE INDEX IF NOT EXISTS` |
| `ALTER TABLE ADD COLUMN` | 先 `PRAGMA table_info` 检查列是否存在 |
| `ALTER TABLE DROP COLUMN` | 先检查列是否存在 |
| 数据迁移 | 先检查是否已迁移（如类型已变更） |

### 3.6 执行顺序

migration-runner 按文件名排序执行：

```
000_baseline.js                    # 全量抽取原 init-db.js 的 schema
001_initial_schema_version.js      # 版本标记占位
002_add_integrations_tables.js     # integrations 表
003_add_notifications_table.js     # 你的新 migration
004_xxx.js
```

### 3.7 调试

```bash
# 查看当前 schema 版本
cd server && node -e "
var migrationRunner = require('./src/utils/migration-runner');
console.log('当前版本:', migrationRunner.getCurrentVersion());
console.log('迁移历史:', migrationRunner.getMigrationHistory());
"

# 手动执行迁移（通常不需要，启动时自动执行）
cd server && node -e "
var migrationRunner = require('./src/utils/migration-runner');
var result = migrationRunner.runAll();
console.log('执行结果:', result);
"
```

详见 [migration-guide.md](./migration-guide.md)。

---

## 4. 注册快捷键

### 4.1 注册全局快捷键

```javascript
import { getHotkeyManager } from '@/core/hotkey-manager';

var hotkey = getHotkeyManager();

// 注册 Ctrl+Shift+F（聚焦搜索框）
var unregister = hotkey.register({
  id: 'focus-search',
  combo: 'Ctrl+Shift+F',
  description: '聚焦搜索框',
  global: false,  // 在输入框中不触发
  handler: function(e) {
    e.preventDefault();
    document.querySelector('.search-input').focus();
  }
});

// 取消注册（如在 beforeDestroy 中）
unregister();
```

### 4.2 在组件中注册（自动清理）

```javascript
export default {
  mounted: function() {
    var self = this;
    var hotkey = getHotkeyManager();
    
    this._unregisterHotkey = hotkey.register({
      id: 'my-app-save',
      combo: 'Ctrl+S',
      description: '保存',
      handler: function(e) {
        e.preventDefault();
        self.save();
      }
    });
  },
  beforeDestroy: function() {
    if (this._unregisterHotkey) {
      this._unregisterHotkey();
    }
  },
  methods: {
    save: function() { /* ... */ }
  }
};
```

### 4.3 支持的组合键

- **修饰键**：`Ctrl` / `Control` / `Cmd` / `Meta` / `Alt` / `Option` / `Shift`
- **字母数字**：`a`-`z` / `0`-`9`
- **特殊键**：`esc` / `del` / `space` / `up` / `down` / `left` / `right` / `enter` / `tab`

### 4.4 注意事项

- **大小写不敏感**：`'Ctrl+K'` 和 `'ctrl+k'` 等价
- **倒序匹配**：后注册的优先级高，可覆盖早期注册
- **输入框过滤**：默认在 `<input>` / `<textarea>` / `<select>` / `contenteditable` 中**不触发**（除非 `global: true`）
- **阻止默认行为**：匹配到组合键时自动 `preventDefault` + `stopPropagation`

---

## 5. 注册搜索源

### 5.1 注册命令（同步）

```javascript
import { getSearchRegistry } from '@/core/search-registry';

getSearchRegistry().registerCommand({
  id: 'my-app-action',
  title: '执行我的应用操作',
  description: '快速执行某个操作',
  keywords: ['action', '操作', '快捷'],
  icon: 'fa-solid fa-bolt',
  action: function() {
    // 执行操作
    window.__router.push('/my-app');
  }
});
```

### 5.2 注册 Provider（异步）

适用于需要后端搜索的场景：

```javascript
import { getSearchRegistry } from '@/core/search-registry';
import api from '@/utils/api';

getSearchRegistry().registerProvider({
  id: 'notes-search',
  category: '笔记',
  search: function(query) {
    return api.get('/api/notes/search', { params: { q: query } })
      .then(function(res) {
        if (res.data.code !== 200) return [];
        return res.data.data.items.map(function(item) {
          return {
            id: 'note:' + item.id,
            title: item.title,
            description: item.preview,
            icon: 'fa-solid fa-file-lines',
            action: function() {
              window.__router.push({ name: 'Notes', query: { id: item.id } });
            }
          };
        });
      });
  }
});
```

### 5.3 在组件中注册（自动清理）

```javascript
import { getSearchRegistry } from '@/core/search-registry';

export default {
  mounted: function() {
    this._unregisterProvider = getSearchRegistry().registerProvider({
      id: 'my-app-search',
      category: '我的应用',
      search: this.searchItems.bind(this)
    });
  },
  beforeDestroy: function() {
    if (this._unregisterProvider) {
      this._unregisterProvider();
    }
  },
  methods: {
    searchItems: function(query) {
      // 返回 result[] 或 Promise<result[]>
      return this.$http.get('/api/my-app/search', { params: { q: query } })
        .then(function(res) { return res.data.items; });
    }
  }
};
```

### 5.4 result 结构

```javascript
{
  id: 'unique-id',           // 必填，唯一标识
  title: '显示标题',           // 必填
  description: '描述',         // 可选
  icon: 'fa-solid fa-xxx',    // 可选，图标 class（或图片路径）
  iconColor: '#FF9500',       // 可选，图标背景色
  action: function() {}       // 可选，点击回调（无 action 时仅显示）
}
```

---

## 6. 订阅 EventBus 事件

### 6.1 订阅全局事件

```javascript
import { getEventBus } from '@/core/event-bus';
import { EVENT_NAMES } from '@shared/constants';

var bus = getEventBus();

// 订阅主题变化
var unsubscribe = bus.on(EVENT_NAMES.THEME_CHANGED, function(payload) {
  console.log('主题已切换为:', payload.id);
});

// 取消订阅
unsubscribe();
```

### 6.2 在组件中订阅（自动清理）

```javascript
import { getEventBus } from '@/core/event-bus';
import { EVENT_NAMES } from '@shared/constants';

export default {
  mounted: function() {
    var self = this;
    var bus = getEventBus();
    
    this._unsubThemeChange = bus.on(EVENT_NAMES.THEME_CHANGED, function(payload) {
      self.onThemeChange(payload);
    });
  },
  beforeDestroy: function() {
    if (this._unsubThemeChange) this._unsubThemeChange();
  },
  methods: {
    onThemeChange: function(payload) {
      // 响应主题变化
    }
  }
};
```

### 6.3 触发自定义事件

```javascript
// 在某处触发事件
bus.emit('my-app:data-updated', { itemId: 123 });

// 在另一处监听
bus.on('my-app:data-updated', function(payload) {
  console.log('数据已更新:', payload.itemId);
});
```

> 局部事件无需声明在 `EVENT_NAMES` 常量中，但建议使用 `appName:event-name` 格式避免冲突。

### 6.4 内置事件名

详见 [shared/src/constants.js](../shared/src/constants.js#L57-L67)：

- `theme:changed` / `theme:motion-toggled`
- `app:launched` / `app:closed`
- `user:signed-in` / `user:signed-out`
- `integration:handshake` / `integration:event` / `integration:disconnected`

---

## 7. 使用 PersistenceStore

### 7.1 基本使用

```javascript
import { getDefaultStore } from '@/core/persistence-store';

var store = getDefaultStore();

// 写入（自动 JSON 序列化）
store.set('user preference', { theme: 'dark', lang: 'zh-CN' });

// 读取（自动 JSON 反序列化，第二参数为默认值）
var pref = store.get('user preference', { theme: 'light', lang: 'en' });

// 删除
store.remove('user preference');

// 检查是否存在
if (store.has('user preference')) {
  // ...
}
```

### 7.2 订阅 key 变化

```javascript
var unsubscribe = store.onChange('user preference', function(newValue, fullKey) {
  console.log('偏好已更新:', newValue);
  // fullKey === 'classintra:user preference'
});

// 取消订阅
unsubscribe();
```

### 7.3 注意事项

- **localStorage 前缀**：所有 key 自动添加 `classintra:` 前缀
- **降级机制**：localStorage 不可用时（隐私模式）自动降级到内存存储
- **数据损坏**：JSON 解析失败时返回 `defaultValue`，不抛异常
- **不要存储敏感数据**：localStorage 可被 JS 读取，敏感数据应放后端

---

## 8. 添加主题 Token

### 8.1 修改 theme-tokens.js

在 [shared/src/theme-tokens.js](../shared/src/theme-tokens.js) 中同时修改 `LIGHT_TOKENS` 和 `DARK_TOKENS`：

```javascript
var LIGHT_TOKENS = {
  color: {
    // 新增 myApp 主题色
    accent: {
      // ... 现有字段
      myApp: '#FF9500'
    }
  }
};

var DARK_TOKENS = {
  color: {
    accent: {
      // ... 现有字段
      myApp: '#FF9500'  // 深色模式下保持一致
    }
  }
};
```

### 8.2 同步修改 global.scss

在 [client/src/styles/global.scss](../client/src/styles/global.scss) 中**双写**：

```scss
:root {
  /* 旧变量（向后兼容） */
  --my-app-color: #FF9500;
  
  /* 新变量（自动由 ThemeEngine 写入，无需在此声明） */
  /* --ci-color-accent-my-app 会从 LIGHT_TOKENS 自动生成 */
}

[data-theme="dark"] {
  --my-app-color: #FF9500;
}
```

### 8.3 在组件中使用

```scss
.my-app-icon {
  /* 优先使用新变量 */
  color: var(--ci-color-accent-my-app, var(--my-app-color, #FF9500));
}
```

### 8.4 双写策略

- **新代码用 `--ci-*` 变量**：由 ThemeEngine 自动写入 inline style
- **旧代码继续用旧变量**：由 `:root` / `[data-theme="dark"]` CSS 提供
- **后续清理**：所有代码统一用 `--ci-*` 后，删除 `:root` 中的旧变量声明

详见 [theme-system.md](./theme-system.md)。

---

## 9. 代码风格约定

### 9.1 JavaScript

```javascript
// ✓ 使用 var（不用 let/const）
var x = 10;
var arr = [1, 2, 3];

// ✓ 字符串用单引号
var name = 'ClassIntra';

// ✓ 2 空格缩进
function foo() {
  var x = 1;
  return x;
}

// ✓ Vue 组件用 Options API
export default {
  name: 'MyComponent',
  data: function() {
    return { count: 0 };
  },
  methods: {
    increment: function() {
      this.count++;
    }
  }
};

// ✓ 模块级函数放在 export default 之前
function helper() {
  // ...
}

export default {
  // ...
};

// ✓ import 使用 import X from 'path'
import api from '@/utils/api';

// ✗ 禁用：可选链
var x = obj?.prop;           // ❌ Chrome 80 不支持
// ✓ 替代方案
var x = obj && obj.prop;

// ✗ 禁用：空值合并
var x = a ?? b;              // ❌ Chrome 80 不支持
// ✓ 替代方案
var x = (a !== null && a !== undefined) ? a : b;
// 或简化（仅当 0/'' 是有效值时需用上面的）
var x = a || b;

// ✗ 禁用：模板字符串
var msg = `Hello ${name}`;   // ❌ 与现有代码风格不一致
// ✓ 替代方案
var msg = 'Hello ' + name;

// ✗ 禁用：箭头函数
var sum = (a, b) => a + b;   // ❌ 与现有代码风格不一致
// ✓ 替代方案
var sum = function(a, b) { return a + b; };

// ✗ 禁用：class 语法
class MyClass { }            // ❌ 与现有代码风格不一致
// ✓ 替代方案
function MyClass() { }
MyClass.prototype.method = function() { };
```

### 9.2 CSS/SCSS

```scss
// ✓ 全局样式放 client/src/styles/global.scss
// ✓ 组件级样式用 <style scoped>
// ✓ CSS 变量在 :root 中定义
:root {
  --my-color: #FF9500;
}

// ✓ 使用 var(--xxx) 引用变量
.my-element {
  color: var(--my-color);
}
```

### 9.3 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `latex-renderer.js` |
| Vue 组件 | PascalCase | `MyApp.vue` |
| 函数 | camelCase | `fetchData` |
| CSS 类 | kebab-case | `.my-app-page` |
| JS 变量 | camelCase | `userInfo` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RECENT` |
| 错误码 | `CLASSINTRA_<域>_<错误>` | `CLASSINTRA_APP_NOT_FOUND` |

---

## 10. 构建与提交

### 10.1 修改前备份

```bash
git save    # 创建带时间戳的备份点
```

### 10.2 频繁提交

```bash
git add -A
git commit -m "feat: 添加 xxx 应用"
```

### 10.3 构建验证

```bash
# 前端构建
cd client && npx vite build

# 后端启动验证
cd server && node src/app.js
```

### 10.4 健康检查

```bash
git health    # 检查 b→o 字符损坏
git fix-b2o   # 修复 b→o 损坏
```

### 10.5 提交信息格式

```
<类型>: <简短描述>

类型：
  feat     - 新功能
  fix      - 修复 bug
  refactor - 重构
  style    - 样式修改
  docs     - 文档更新
  chore    - 杂项

示例：
  feat: 添加 \colorbox LaTeX 支持
  fix: 修复 b→o 字符损坏
  docs: 添加架构总览文档
```

详见 [CLAUDE.md](../CLAUDE.md)。

---

## 附录：相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 架构总览 |
| [api-reference.md](./api-reference.md) | API 参考 |
| [manifest-schema.md](./manifest-schema.md) | Manifest Schema 完整定义 |
| [migration-guide.md](./migration-guide.md) | DB 迁移指南 |
| [theme-system.md](./theme-system.md) | 主题系统 |
| [chrome-80-compat.md](./chrome-80-compat.md) | Chrome 80 兼容性 |
| [integration-guide.md](./integration-guide.md) | 集成系统使用指南 |
