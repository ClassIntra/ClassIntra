# ClassIntra 主题目录

主题是 ClassIntra 的**独立视觉层**，与应用（apps/）和插件（plugins/）相互独立。

## 目录结构

```
themes/
├── light/
│   ├── manifest.json    # 主题元数据（id/name/type/version/tokens 路径）
│   └── tokens.js        # 主题 Token 数据（color/shadow/motion）
├── dark/
│   ├── manifest.json
│   └── tokens.js
└── README.md
```

## 与 global.scss 的关系

主题 tokens 中的颜色值与 `client/src/styles/global.scss` 中 `:root`（浅色）和 `[data-theme="dark"]`（深色）的 CSS 变量值保持同步：
- `themes/light/tokens.js` ↔ `global.scss :root`
- `themes/dark/tokens.js` ↔ `global.scss [data-theme="dark"]`

新代码使用 `--ci-*` 变量（由 ThemeEngine 从 tokens 注入），旧代码继续用 `--primary-color` 等旧变量（由 global.scss 提供）。

## 加载机制

- **前端**：`client/src/core/theme-loader.js` 用 `import.meta.glob` 扫描 `themes/*/manifest.json`
- **ThemeEngine**：`client/src/core/theme-engine.js` 通过 theme-loader 注册所有内置主题

## 新增主题

1. 在 `themes/` 下新建目录（kebab-case，如 `ocean-blue/`）
2. 创建 `manifest.json`：
   ```json
   {
     "id": "ocean-blue",
     "name": "海洋蓝",
     "type": "dark",
     "version": "1.0.0",
     "description": "...",
     "tokens": "./tokens.js",
     "icons": null
   }
   ```
3. 创建 `tokens.js`，导出 `TOKENS` 对象（结构参考 `light/tokens.js`）
4. 主题自动被 ThemeEngine 注册，可在设置页切换

## 外部主题包

通过 `ThemeEngine.loadExternalTheme(url)` 可加载远程主题包 JSON：
```json
{
  "id": "sunset",
  "name": "日落",
  "type": "dark",
  "tokens": { ... },
  "icons": null
}
```

注意：不允许覆盖内置主题（`light`/`dark`）。
