# ClassIntra 主题系统

> 本文档介绍 ClassIntra 主题系统的设计、token 体系、双写策略和动画开关。
> 详见 [api-reference.md#2-themeengine-主题引擎](./api-reference.md#2-themeengine-主题引擎) 的 API 参考。

---

## 目录

- [设计概览](#1-设计概览)
- [Token 体系](#2-token-体系)
- [双写策略](#3-双写策略)
- [主题切换流程](#4-主题切换流程)
- [动画开关](#5-动画开关)
- [添加自定义主题](#6-添加自定义主题)
- [调试技巧](#7-调试技巧)

---

## 1. 设计概览

ClassIntra 主题系统参考 Ditto 的 ThemeEngine，但做了简化：

| 维度 | Ditto | ClassIntra |
|------|-------|------------|
| 动画档位 | 四档（fast/normal/slow/none） | 单档（开/关） |
| 主题包加载 | 内置 + 外部加载 | 仅内置 light/dark |
| Token 前缀 | `--ditto-*` | `--ci-*` |
| 旧变量兼容 | 无 | 双写（旧变量 + 新变量并存） |

### 核心文件

| 文件 | 作用 |
|------|------|
| [client/src/core/theme-engine.js](../client/src/core/theme-engine.js) | ThemeEngine 引擎（setTheme / 订阅 / 动画开关） |
| [shared/src/theme-tokens.js](../shared/src/theme-tokens.js) | LIGHT_TOKENS / DARK_TOKENS 定义 |
| [shared/src/theme-adapter.js](../shared/src/theme-adapter.js) | flattenTokens / applyToElement 工具 |
| [client/src/styles/global.scss](../client/src/styles/global.scss) | 旧 CSS 变量定义（`:root` + `[data-theme="dark"]`） |
| [client/src/styles/_motion.scss](../client/src/styles/_motion.scss) | 动画降级规则（`[data-no-motion="true"]`） |
| [client/src/store/modules/settings.js](../client/src/store/modules/settings.js) | Vuex 主题状态 |

---

## 2. Token 体系

### 2.1 Token 结构

主题 token 采用**结构化对象**，由 `flattenTokens` 展平为 CSS 变量：

```javascript
// shared/src/theme-tokens.js
var LIGHT_TOKENS = {
  color: {
    primary: '#007AFF',           // → --ci-color-primary
    primaryHover: '#0066CC',      // → --ci-color-primary-hover
    primaryRgb: '0, 122, 255',    // → --ci-color-primary-rgb
    accent: {
      music: '#FF2D55',           // → --ci-color-accent-music
      weather: '#4A90D9'          // → --ci-color-accent-weather
    },
    semantic: {
      success: '#34C759',         // → --ci-color-semantic-success
      danger: '#FF3B30'           // → --ci-color-semantic-danger
    },
    bg: {
      base: '#F2F2F7',            // → --ci-color-bg-base
      card: '#FFFFFF'             // → --ci-color-bg-card
    },
    text: {
      primary: 'rgba(0,0,0,0.90)',  // → --ci-color-text-primary
      secondary: 'rgba(60,60,67,0.60)'  // → --ci-color-text-secondary
    },
    glass: {
      dock: 'rgba(255,255,255,0.65)',  // → --ci-color-glass-dock
      island: 'rgba(28,28,30,0.72)'    // → --ci-color-glass-island
    }
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.08)',  // → --ci-shadow-sm
    md: '0 4px 12px rgba(0,0,0,0.08)',  // → --ci-shadow-md
    lg: '0 12px 40px rgba(0,0,0,0.12)'  // → --ci-shadow-lg
  },
  motion: {
    easeStandard: 'cubic-bezier(0.25,0.1,0.25,1)',  // → --ci-motion-ease-standard
    durationFast: '0.15s',                            // → --ci-motion-duration-fast
    durationNormal: '0.25s'                           // → --ci-motion-duration-normal
  }
};
```

### 2.2 命名规则

- **CSS 变量名**：`--ci-<分类>-<子分类>-<名称>`
- **驼峰转 kebab**：`primaryHover` → `primary-hover`
- **递归展平**：嵌套对象的 key 拼接为前缀

### 2.3 Token 分类

| 分类 | 子分类 | 说明 |
|------|--------|------|
| `color.primary` | primary / primaryHover / primaryPressed / primaryRgb | 主色及衍生 |
| `color.accent` | music / weather / community / chat / notes / resource / settings / ai | 应用主题色 |
| `color.semantic` | success / warning / danger / info | 语义色 |
| `color.bg` | base / card / elevated / glass | 背景色 |
| `color.text` | primary / secondary / tertiary | 文字色 |
| `color.border` | default / separator | 边框色 |
| `color.glass` | dock / nav / island / sidebar | 毛玻璃材质色 |
| `color.onWallpaper` | text / shadow / dot | 壁纸上的文字色 |
| `shadow` | sm / md / lg / xl | 阴影 |
| `motion` | easeXxx / durationXxx | 动画曲线和时长 |

---

## 3. 双写策略

### 3.1 为什么需要双写

ClassIntra 经历了从"旧变量体系"到"新 token 体系"的迁移。为避免一次性迁移导致大量代码改动，采用**双写策略**：

- **新代码用 `--ci-*` 变量**：由 ThemeEngine 在运行时写入 inline style
- **旧代码继续用旧变量**：由 `global.scss` 中的 `:root` 和 `[data-theme="dark"]` 提供
- **后续清理**：所有代码统一用 `--ci-*` 后，删除 `global.scss` 中的旧变量声明

### 3.2 旧变量示例

```scss
// client/src/styles/global.scss
:root {
  --primary-color: #007AFF;
  --bg-color: #F2F2F7;
  --text-color: rgba(0, 0, 0, 0.90);
  --border-color: rgba(60, 60, 67, 0.12);
  // ... 共 80+ 旧变量
}

[data-theme="dark"] {
  --primary-color: #0A84FF;
  --bg-color: #000000;
  --text-color: rgba(235, 235, 245, 0.95);
  --border-color: rgba(84, 84, 88, 0.65);
  // ...
}
```

### 3.3 新变量示例

由 ThemeEngine 调用 `applyToElement(document.documentElement, flatMap)` 写入：

```css
/* 运行时 inline style（由 JS 写入） */
html {
  --ci-color-primary: #007AFF;
  --ci-color-bg-base: #F2F2F7;
  --ci-color-text-primary: rgba(0, 0, 0, 0.90);
  /* ... */
}

html[data-theme="dark"] {
  --ci-color-primary: #0A84FF;
  --ci-color-bg-base: #000000;
  --ci-color-text-primary: rgba(235, 235, 245, 0.95);
  /* ... */
}
```

### 3.4 在 CSS 中使用

```scss
.my-component {
  /* ✓ 推荐：优先用新变量，降级到旧变量，再降级到硬编码 */
  color: var(--ci-color-text-primary, var(--text-color, rgba(0, 0, 0, 0.90)));
  background: var(--ci-color-bg-card, var(--bg-card-color, #FFFFFF));
  border: 1px solid var(--ci-color-border-default, var(--border-color, rgba(60, 60, 67, 0.12)));
}

/* ✓ 简化版（不降级，假设新变量一定存在） */
.my-component {
  color: var(--ci-color-text-primary);
}
```

### 3.5 迁移清理路径

未来某个版本可以一次性清理：

1. 全局搜索替换：把所有 `var(--primary-color)` 替换为 `var(--ci-color-primary)`
2. 删除 `global.scss` 中 `:root` 和 `[data-theme="dark"]` 的旧变量声明
3. 保留 ThemeEngine 的 `--ci-*` 写入逻辑

---

## 4. 主题切换流程

### 4.1 完整流程

```
用户点击"切换深色模式"
    ↓
store.dispatch('settings/setTheme', 'dark')
    ↓
store/modules/settings.js: SET_THEME mutation
    ↓ 调用 ThemeEngine.setTheme('dark')
    ↓
ThemeEngine.setTheme('dark')
    ↓
1. documentElement.setAttribute('data-theme', 'dark')
   → 触发 CSS 中 [data-theme="dark"] 选择器生效（旧变量切换）
    ↓
2. flattenTokens(DARK_TOKENS) → applyToElement(root, flatMap)
   → 写入新的 --ci-* 变量到 inline style（新变量切换）
   → 先 removeFromElement 清除旧 --ci-* 变量，避免残留
    ↓
3. 通知所有 subscribers（payload: { id, previous, type, icons }）
    ↓
4. EventBus.emit('theme:changed', payload)
   → 广播给非直接订阅者
    ↓
5. localStorage.setItem('theme', 'dark')
   → 持久化用户选择
```

### 4.2 多种触发方式

#### 4.2.1 通过 Vuex action（推荐）

```javascript
this.$store.dispatch('settings/setTheme', 'dark');
// 内部会调用 ThemeEngine.setTheme + 持久化
```

#### 4.2.2 直接调用 ThemeEngine

```javascript
import { getThemeEngine } from '@/core/theme-engine';
getThemeEngine().setTheme('dark');
// 注意：不会自动持久化，需手动 localStorage.setItem
```

#### 4.2.3 切换 light/dark

```javascript
getThemeEngine().toggleColorScheme();
// 返回切换后的主题 id
```

### 4.3 订阅主题变化

```javascript
import { getThemeEngine } from '@/core/theme-engine';

var unsubscribe = getThemeEngine().subscribe(function(payload) {
  console.log('主题切换:', payload.previous, '→', payload.id);
  // payload.type === 'dark' / 'light'
  // payload.icons === null（本期未实现图标主题）
});
```

或通过 EventBus：

```javascript
import { getEventBus } from '@/core/event-bus';
import { EVENT_NAMES } from '@shared/constants';

getEventBus().on(EVENT_NAMES.THEME_CHANGED, function(payload) {
  // ...
});
```

---

## 5. 动画开关

### 5.1 设计

ClassIntra 采用**单档动画**（开/关），不区分 fast/normal/slow：

- **启用**：所有 transition / animation 按正常时长播放
- **禁用**：所有 transition / animation 时长变为 `0s`，立即生效

### 5.2 实现机制

#### 5.2.1 设置 data 属性

```javascript
// 启用
documentElement.removeAttribute('data-no-motion');

// 禁用
documentElement.setAttribute('data-no-motion', 'true');
```

#### 5.2.2 SCSS 全局规则

```scss
// client/src/styles/_motion.scss
[data-no-motion="true"] *,
[data-no-motion="true"] *::before,
[data-no-motion="true"] *::after {
  animation-duration: 0.001s !important;
  animation-delay: 0s !important;
  transition-duration: 0.001s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
```

### 5.3 初始化

在 [App.vue](../client/src/App.vue#L177) mounted 中调用：

```javascript
try { getThemeEngine().initMotion(); } catch (e) {}
```

**优先级**：

1. `localStorage.ci_motion_disabled === '1'` → 禁用
2. `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → 禁用
3. 默认 → 启用

### 5.4 运行时切换

```javascript
import { getThemeEngine } from '@/core/theme-engine';

var themeEngine = getThemeEngine();

// 关闭动画
themeEngine.setMotionEnabled(false);
// → 设置 data-no-motion="true"
// → localStorage.ci_motion_disabled = '1'
// → EventBus.emit('theme:motion-toggled', { enabled: false })

// 查询状态
var enabled = themeEngine.isMotionEnabled();  // false

// 开启动画
themeEngine.setMotionEnabled(true);
```

### 5.5 在 CSS 中使用动画 token

```scss
.my-component {
  /* 使用 token 定义的时长和曲线 */
  transition: color var(--ci-motion-duration-normal, 0.25s) var(--ci-motion-ease-standard, ease);
  animation: fadeIn var(--ci-motion-duration-slow, 0.35s) var(--ci-motion-ease-decelerate, ease);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

> **注意**：使用 token 的动画在 `[data-no-motion="true"]` 时会自动被全局规则覆盖，无需额外处理。

---

## 6. 添加自定义主题

### 6.1 注册自定义主题

```javascript
import { getThemeEngine } from '@/core/theme-engine';

var themeEngine = getThemeEngine();

themeEngine.registerTheme('sepia', {
  name: '护眼黄',
  type: 'light',  // type 决定部分代码的分支（如深色模式判断）
  tokens: {
    color: {
      primary: '#8B4513',
      bg: {
        base: '#F4E8D0',
        card: '#FFF8E7'
      },
      text: {
        primary: '#3E2723'
      }
      // ... 必须提供完整的 token 结构
    },
    shadow: {
      sm: '0 1px 3px rgba(62,39,35,0.1)',
      md: '0 4px 12px rgba(62,39,35,0.1)'
    },
    motion: {
      // 复用默认 motion token
      easeStandard: 'cubic-bezier(0.25,0.1,0.25,1)',
      durationFast: '0.15s',
      durationNormal: '0.25s',
      durationSlow: '0.35s'
    }
  },
  icons: null  // 主题图标映射（本期未实现）
});

// 切换到自定义主题
themeEngine.setTheme('sepia');
```

### 6.2 注意事项

- **必须提供完整 token 结构**：缺失的 token 会导致对应 CSS 变量未定义
- **CSS 仍需双写**：如果自定义主题需要在 `global.scss` 中支持（如通过 `[data-theme="sepia"]` 选择器），需手动添加 CSS 规则
- **持久化需自行处理**：`setTheme` 不会自动持久化，需 `localStorage.setItem('theme', 'sepia')`

### 6.3 外部主题包加载（预留）

```javascript
// 本期未实现，调用会 reject
themeEngine.loadExternalTheme('https://example.com/themes/dark.json')
  .catch(function(err) {
    console.error('加载失败:', err.message);
    // "loadExternalTheme 尚未实现"
  });
```

---

## 7. 调试技巧

### 7.1 查看当前主题

```javascript
// 浏览器控制台
__services.resolve('themeEngine').getCurrentTheme();
// 或
document.documentElement.getAttribute('data-theme');  // 'dark' / null（light）
```

### 7.2 查看所有已注册主题

```javascript
__services.resolve('themeEngine').listThemes();
// [{ id: 'light', name: '默认浅色', type: 'light', icons: null },
//  { id: 'dark', name: '默认深色', type: 'dark', icons: null }]
```

### 7.3 查看 inline style 中的 --ci-* 变量

```javascript
// 浏览器控制台
var style = document.documentElement.style;
for (var i = 0; i < style.length; i++) {
  var prop = style[i];
  if (prop.indexOf('--ci-') === 0) {
    console.log(prop, '=', style.getPropertyValue(prop));
  }
}
```

### 7.4 强制切换主题（测试用）

```javascript
// 切换到深色
__services.resolve('themeEngine').setTheme('dark');

// 切换回浅色
__services.resolve('themeEngine').setTheme('light');

// 切换（toggle）
__services.resolve('themeEngine').toggleColorScheme();
```

### 7.5 测试动画开关

```javascript
var te = __services.resolve('themeEngine');

// 关闭动画
te.setMotionEnabled(false);
// 检查 documentElement 是否有 data-no-motion="true"
console.log(document.documentElement.getAttribute('data-no-motion'));  // 'true'

// 开启动画
te.setMotionEnabled(true);
console.log(document.documentElement.getAttribute('data-no-motion'));  // null
```

### 7.6 监听主题变化（调试用）

```javascript
import { getEventBus } from '@/core/event-bus';
import { EVENT_NAMES } from '@shared/constants';

getEventBus().on(EVENT_NAMES.THEME_CHANGED, function(payload) {
  console.log('[调试] 主题切换:', payload);
});

getEventBus().on(EVENT_NAMES.THEME_MOTION_TOGGLED, function(payload) {
  console.log('[调试] 动画开关:', payload.enabled ? '启用' : '禁用');
});
```

---

## 附录：相关文档

| 文档 | 说明 |
|------|------|
| [api-reference.md#2-themeengine-主题引擎](./api-reference.md#2-themeengine-主题引擎) | ThemeEngine API 参考 |
| [architecture.md#4.2-themeengine-主题引擎](./architecture.md#42-themeengine-主题引擎) | 架构概览 |
| [development-guide.md#8-添加主题-token](./development-guide.md#8-添加主题-token) | 添加新 token 的步骤 |
