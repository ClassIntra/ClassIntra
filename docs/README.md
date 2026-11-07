# docs/ 索引

> 按项目约定：**面向使用者与第三方的对外文档在独立文档站 [ClassIntra_docs](https://classintra.github.io/)（仓库 ClassIntra/ClassIntra_docs，VitePress）**；本目录只保留**设计记录与运维研究**，不堆过程性文档。

## 文档站（对外）

| 主题 | 入口 |
|------|------|
| 快速开始 / 安装 | https://classintra.github.io/quick-start/installation |
| 账号与 API 教程 | https://classintra.github.io/quick-start/account-and-api |
| 架构概念（认证/Manifest/WS/主题） | https://classintra.github.io/concepts/architecture |
| API 参考（server / client / types） | https://classintra.github.io/api/server |
| 开发第一个应用 / SDK / 市场应用 | https://classintra.github.io/development/first-app |
| 学元体系与账本（第三方接入视角） | https://classintra.github.io/development/economy |
| 部署运维（生产/端口/监控/迁移） | https://classintra.github.io/deployment/production |

## 本目录（设计与运维记录）

| 文档 | 内容 |
|------|------|
| [economy-design.md](./economy-design.md) | 学元体系设计总纲 + 账本（ledger）完整设计与实施记录（V 章） |
| [ecosystem-design.md](./ecosystem-design.md) | 应用生态与市场契约设计 |
| [modular-architecture.md](./modular-architecture.md) | 模块化架构说明 |
| [version-management.md](./version-management.md) | 版本号管理红线（version.json / CHANGELOG / Release tag 三处一致） |
| [HTTPS-配置说明.md](./HTTPS-配置说明.md) | 本地 HTTPS 部署 |
| [zxw-launcher.md](./zxw-launcher.md) | zxw 启动器对接 |

## 约定

- 新的「怎么用 / 怎么接 / 怎么部署」类文档 → 写进 **ClassIntra_docs 站**（对应仓库在 `D:\NetWork\Integration\ClassIntra_docs` 或 GitHub ClassIntra/ClassIntra_docs）。
- 本目录新增文件仅限：架构/经济/协议**设计决策记录**与**运维研究结论**。
- `docs/superpowers/`、过程性 spec/plans 不入库（已在 .gitignore）。
