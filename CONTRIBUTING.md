# 贡献指南

感谢参与 ClassIntra。提交代码或文档前，请先阅读现有实现与对应文档，并保持改动聚焦。

## 开发约定

- 使用 Node.js 18+、pnpm 8+，遵循仓库现有的 Vue 2 Options API、JavaScript、单引号和 2 空格风格。
- 联机 Gomoku 的房间 API、棋盘规则、WebSocket 事件和断线恢复约定见 [docs/gomoku-online.md](./docs/gomoku-online.md)。
- 账号、Token、Cookie、权限字段和 API 调用约定见 [docs/account-and-api-guide.md](./docs/account-and-api-guide.md)。
- 第三方市场源、应用生命周期和应用包结构见 [docs/third-party-market.md](./docs/third-party-market.md)。默认市场源为 ClassIntra/market 的 Raw 地址。
- 不要提交真实密码、Token、Cookie、API Key、JWT 密钥或其他敏感信息。

## 验证

```bash
pnpm install
pnpm --filter server test
pnpm build
```

涉及联机 Gomoku、市场应用或 API 时，应同时更新相关文档，并覆盖正常流程、错误响应和权限边界。

## 提交内容

Pull Request 请说明目的、主要改动、验证命令和已知限制。若参考或迁移了 iFlyCompass 的开源代码、交互方向或实现思路，请保留相应许可证和署名要求，并在文档中注明 [iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass) 致谢。
