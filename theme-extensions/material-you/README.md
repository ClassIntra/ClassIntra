# Material You 扩展主题

ClassIntra 的第二套主题，基于 Material Design 3 (M3) 设计语言，以**独立扩展包**形式安装。

> ⚠️ 此扩展不是系统自带主题，需通过 `theme-extensions/` 目录独立安装。

## 设计原则

本扩展严格遵循 Material Design 3 的核心设计要素：

### 1. 动态色彩系统 (Dynamic Color)
- 从用户提供的**种子色**（壁纸主色或自选色）派生完整配色方案
- 基于 M3 HCT 色彩空间（本实现采用 HSL 近似，Chrome 80 兼容）
- 生成 5 个 Tonal Palette：primary / secondary / tertiary / neutral / neutralVariant
- 每个调色板包含 13+3 档 tone（0/10/20/.../100），覆盖全部亮度梯度
- 角色色映射：primary/primaryContainer/onPrimary/...，亮色与深色模式取不同 tone

### 2. 个性化自适应界面
- 用户可随时通过 `engine.setDynamicColor('material-you', '#RRGGBB')` 切换种子色
- 整套配色立即重算并应用，无需刷新页面
- 默认种子色 `#0061A4`（M3 Reference 示例色）

### 3. 组件形态变化 (Shape Shift)
- 圆角梯度比 iOS 默认 +4px（如 `--ci-shape-md`: 12px → 16px）
- 体现 M3 "圆润有机"的形态语言
- 通过覆盖 `--ci-shape-*` token 实现，iOS 组件库自动跟随

### 4. 柔和阴影
- 阴影比 iOS 默认更弱，营造"漂浮感"
- 配合更大圆角，符合 M3 视觉风格
- 亮色/深色模式分别调校

### 5. M3 标准缓动曲线
- `easeEmphasized`: `cubic-bezier(0.3, 0, 0, 1)`（M3 官方曲线）
- `easeStandard`: `cubic-bezier(0.2, 0, 0, 1)`
- 比 iOS 曲线略柔和，但保留单档动画策略

## 目录结构

```
theme-extensions/material-you/
├── manifest.json        # 扩展清单（schema/id/name/version/shape/motion/shadow/entry/...）
├── tokens.js            # 静态 token（shape/motion/shadow）
├── dynamic-color.js     # 动态色生成器（HCT→Tonal Palette→Color Roles→--ci-* 映射）
├── apply.js             # 应用入口（注册主题到 ThemeEngine）
└── README.md            # 本文件
```

## Manifest 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema` | string | ✓ | Schema 版本，当前 `classintra-theme-extension/v1` |
| `id` | string | ✓ | 扩展 id（kebab-case，禁止 `light`/`dark`） |
| `name` | string | ✓ | 显示名称 |
| `version` | string |   | semver 版本号（缺省 `0.0.0`） |
| `kind` | string |   | 类型，固定 `extension` |
| `type` | string |   | `static` 或 `dynamic`（缺省 `static`） |
| `colorMode` | string |   | `light`/`dark`/`both`（缺省 `both`） |
| `base` | string |   | 继承基础主题 `auto`/`light`/`dark`（缺省 `auto`） |
| `defaultSeed` | string |   | 默认种子色（`type=dynamic` 时使用） |
| `shape` | object |   | 静态圆角 token 覆盖 |
| `motion` | object |   | 静态动效 token 覆盖 |
| `shadow` | object |   | 静态阴影 token 覆盖（分 light/dark） |
| `entry` | string | ✓ | 应用入口文件路径（如 `./apply.js`） |
| `tokens` | string |   | 静态 token 文件路径 |
| `dynamicColor` | string |   | 动态色生成器路径（`type=dynamic` 时必填） |
| `capabilities` | string[] |   | 能力声明：`dynamic-color`/`shape-shift`/`tonal-palette`/`motion-tuning` |

## 架构兼容性

### 与现有系统的关系
- **不修改内置主题**：light/dark 主题保持 iPadOS 风格不变
- **复用 ClassIntra Token 体系**：动态色生成器输出 `--ci-color-*` 变量，由 ThemeEngine 写入 DOM
- **iOS 组件库自动跟随**：所有组件用 `var(--ci-color-*)`，扩展主题切换后自动应用
- **毛玻璃材质保留**：`--ci-color-glass-*` 由 dynamic-color 派生，保持 iOS 材质语言

### 加载流程
```
1. ThemeEngine.getThemeEngine()          → 初始化内置 light/dark 主题
2. loadThemeExtensions()                 → 扫描 theme-extensions/ 目录
3. theme-extension-loader.scanExtensions() → 验证 manifest，解析 entry/tokens/dynamicColor 模块
4. apply.js: apply(engine, manifest)     → 注册 material-you-light / material-you-dark 主题
5. engine.registerExtension(id, state)   → 保存 buildTokens 函数与种子色
6. 用户切换主题 → engine.setTheme('material-you-light')
7. 用户切换种子色 → engine.setDynamicColor('material-you', '#FF6B6B')
```

## 使用示例

### 启用扩展主题
```js
import { loadThemeExtensions, getThemeEngine } from '@/core/theme-engine';

// 1. 加载所有扩展主题
loadThemeExtensions().then(function(ids) {
  console.log('已加载扩展主题:', ids);
  // ['material-you-light', 'material-you-dark']
});

// 2. 切换到 Material You 浅色主题
const engine = getThemeEngine();
engine.setTheme('material-you-light');
```

### 动态切换种子色
```js
const engine = getThemeEngine();

// 用户从壁纸提取主色后，立即重算配色
engine.setDynamicColor('material-you', '#FF6B6B');

// 查询当前种子色
const seed = engine.getCurrentSeedColor();
console.log('当前种子色:', seed);
```

### 查询可用扩展
```js
const engine = getThemeEngine();
const extensions = engine.listExtensions();
// [{ id: 'material-you', name: 'Material You', type: 'dynamic', hasDynamicColor: true, ... }]
```

## 实现说明

### HCT 色彩空间的 HSL 近似
M3 原生使用 HCT (Hue/Chroma/Tone) 色彩空间，感知更均匀。本实现采用 HSL 近似：
- Tone 直接映射为 HSL Lightness
- Chroma 近似为 HSL Saturation
- 在 tone ≤ 10 或 ≥ 95 时降低饱和度，模拟 HCT 的 chroma 收敛

**未来升级路径**：当浏览器普遍支持 `oklch()` CSS 函数后，可平滑升级为完整 HCT→CAM16→RGB 实现。

### 角色色映射策略
M3 角色色（primary/onPrimary/primaryContainer/...）按以下规则取值：
- 亮色模式：角色色取低 tone（深），on-色取高 tone（亮）
- 深色模式：角色色取高 tone（亮），on-色取低 tone（暗）
- Container 色取相反方向（亮色用 tone 90，深色用 tone 30）

### ClassIntra Token 映射
M3 角色色映射到 ClassIntra 现有 `--ci-*` 变量：
- `roles.primary` → `--ci-color-primary`
- `roles.surface` → `--ci-color-bg-card`
- `roles.onSurface` → `--ci-color-text-primary`
- `roles.surfaceContainer` → `--ci-color-bg-glass`（毛玻璃材质）
- ...（详见 `dynamic-color.js` 的 `rolesToCiTokens` 函数）

## 兼容性

- Chrome 80+（ES5 风格，无可选链、无 BigInt、无原生 oklch）
- 与 Vite 5+ 静态分析兼容（`import.meta.glob` eager 加载）
- 与 ThemeEngine 单例模式兼容
- 不影响内置 light/dark 主题

## 后续演进

- [ ] 壁纸主色自动提取（Canvas + 频率分析）
- [ ] 完整 HCT 色彩空间实现（依赖 oklch 浏览器支持）
- [ ] M3 组件形态（Large/Full 按钮、FAB、Chip 等）
- [ ] 用户自定义种子色 UI（Settings 页集成）
- [ ] 种子色持久化（localStorage）
