# 声明与致谢 / Notices & Attributions

## Logo 使用声明 / Logo Disclaimer

> The logo used in this project is sourced from a public domain asset library and is used for non-commercial, educational purposes. All rights belong to their respective owners. Any resemblance to other projects' logos is purely coincidental.

本项目使用的 LOGO 来源于公共素材库，仅用于非商业教育目的。所有权利归其各自所有者。与其他项目 LOGO 的相似纯属巧合。

本声明适用于本项目仓库内所有品牌标识类素材，包括但不限于 `logo/`、`Banner.png`、`Resources/` 以及各应用与插件中引用的图标文件。

This notice applies to all brand/identity assets in this repository, including but not limited to files under `logo/`, `Banner.png`, `Resources/`, and icon files referenced by apps and plugins.

---

## 开源许可 / License

本项目代码基于 [MIT 协议](LICENSE) 开源（Copyright © Nevino）。Logo 等品牌素材不在 MIT 协议授权范围内，其权利归原始素材所有者所有。

The source code of this project is released under the [MIT License](LICENSE) (Copyright © Nevino). Brand assets such as the logo are **not** covered by the MIT License; all rights to such assets belong to their respective owners.

---

## 第三方组件与出处 / Third-Party Components

> **约定：借鉴任何第三方成果（代码、算法、界面与交互设计、素材、数据、字体）都必须在仓库内标明出处。**
> 各应用/插件在自己的 `README.md`「出处与致谢」中登记本模块的引用；仓库级依赖与许可证在此登记。

| 组件 | 用途 | 来源 | 许可 | 是否随仓分发 |
|---|---|---|---|---|
| Pikafish | 象棋应用的「人机练习 / 局面分析」引擎（服务端 UCI 进程调用） | https://github.com/official-pikafish/Pikafish | GPL-3.0 | **否**（二进制与权重不入库，由 `scripts/chess-engine-setup.mjs` 在目标机按需下载；许可原文见 `market-apps/chess/backend/engine/`） |
| Pikafish NNUE 权重 | 引擎评估网络 | https://github.com/official-pikafish/Networks | 见其 `NNUE-License.md` | **否**（同上） |

各模块的详细出处（含界面参考、自研与第三方的边界说明）见对应应用 README，例如
`market-apps/chess/README.md`。
