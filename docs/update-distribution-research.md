# ClassIntra 更新分发链路调研

> 调研日期：2026-10-17　｜　状态：**仅调研，未改动任何代码**
> 目标：解决「每次发版后，部署节点要从 GitHub 全量下载再迁移，体验差」的问题

---

## TL;DR

**先划清一条边界：从 GitHub「下载」的只有代码，40MB。`Resources/` 被 `.gitignore` 排除，不在仓库里，不占下载流量。**

1. **下载这一环的唯一问题：GitHub 通道不通。** 源码仅 **40MB**，Gitee 完整 clone **6 秒**、浅克隆 **4 秒**；同一时刻 GitHub HTTPS 克隆是 `Connection was reset`（直接失败，不是慢）。
2. **`Resources/` 52.3GB 是另一件事，只在「换目录重装」时才进入更新路径。** 它不在 git 里 → clone 出来的新目录天然没有它 → 必须人工搬一次（`cloud` 25.3GB + `videos` 19.9GB + `public` 5.3GB + `music` 1.7GB）。**如果更新始终是原地 `fetch + reset`，这 52GB 完全不参与。**

所以：
- 若**原地更新** → 只需解决 ①换源（40MB/6s）②`pnpm install` 官方源 338MB ③每节点重复 `vite build` 3 分钟
- 若**换目录/换机器** → 额外面对 52GB 人工搬迁，此时「资源外置 + 原地更新」才是关键

---

## 一、现状链路（代码级拆解）

更新动作实际由 **ClassIntraOps** 发起（`ClassIntraOps/ops-server/server.js` 与 `launcher/Views/InstallPage.axaml.cs` 两套实现，逻辑一致）：

```
POST /api/install  (steps: detect → clone → install → build → start)

[1] 首次安装
    git clone --branch main https://github.com/ClassIntra/ClassIntra.git <target>
    ↑ 硬编码 GitHub HTTPS，600s 超时

    已有仓库时
    git fetch --all --tags && git checkout main && git pull --ff-only
    ↑ --all --tags：把所有分支和标签都拉一遍，远超实际需要

[2] pnpm install                    （1800s 超时）
[3] cd client && pnpm run build     （900s 超时，实测约 3 分钟）
[4] pm2 start ecosystem.config.js && pm2 save
```

关键事实：

| 项 | 现状 |
|---|---|
| 默认仓库地址 | `https://github.com/ClassIntra/ClassIntra.git`（`OpsServices.cs:16`、`server.js:34`） |
| 是否可改 | **可以**，安装页有「仓库」输入框，值持久化到 `AppState.Repo` |
| 浅克隆 | **未使用**，默认拉全部历史 |
| 失败处理 | 「失败即停、保留现场、不回滚」，无自动重试/无备用源 |
| 数据保护 | 依赖 `.gitignore`（db / `.env` / `Resources` / `market-apps` 都不入库），Ops 本身**不做备份** |
| DB 迁移 | `migration-runner.runAll()` 启动时幂等执行，**已自动化** |

> 所谓「迁移」，在当前实现里其实是两件事：**代码搬迁**（clone 到新目录）和**数据保留**（靠 gitignore 被动保护，无主动备份）。数据库结构迁移本身不构成负担。

---

## 二、实测数据（本机，2026-10-17 20:2x）

### 2.1 通道可用性

| 通道 | 结果 |
|---|---|
| `https://codeload.github.com/.../zip/refs/heads/main` | **http=000，SSL 连接失败** |
| `git clone https://github.com/...` | **`Recv failure: Connection was reset`** |
| `git ls-remote ssh://git@ssh.github.com:443/...` | 正常（443 端口 SSH 可用） |
| `https://gitee.com/classintra/ClassIntra/...` | 正常，归档下行 **2.65 MB/s** |

### 2.2 克隆耗时（Gitee）

| 方式 | 体积 | 耗时 |
|---|---|---|
| 完整 clone（单分支） | 40 MB | **6 s** |
| 浅 clone（`--depth 1 --single-branch`） | 25 MB | **4 s** |

### 2.3 镜像同步状态

| 来源 | HEAD |
|---|---|
| 本地工作区 | `0b48550`（含未推送改动） |
| Gitee | `3c53c14` ← `chore(release): prepare 1.4.1` |
| GitHub（SSH 443） | `3c53c14`（**与 Gitee 完全一致**） |

观察：几分钟前 `ls-remote` 拿到的 Gitee HEAD 还是 `85d9aad`（11:24 的 1.4.0），随后变为 `3c53c14`（20:27 的 1.4.1）——**镜像在分钟级内自动追平**。
→ 推断 Gitee 侧开启了「仓库镜像（Pull 模式）」自动同步。**待你确认**（见第六节）。

### 2.4 各环节体积/耗时

| 环节 | 数据量 | 耗时 | 备注 |
|---|---|---|---|
| 源码 clone | 40 MB | 6 s（Gitee） | GitHub 下为**失败** |
| `pnpm install` | **338 MB / 28705 文件** | 官方源下数分钟起 | registry 当前 = `registry.npmjs.org`（**未配国内镜像**） |
| `vite build` | 产出 60 MB（`assets/`） | ~3 min | 纯 CPU，每节点重复 |
| **运行时资产搬迁** | **52.3 GB / 7537 文件** | **数十分钟~数小时** | 换目录/重装时才发生；不在 git 内 |
| 合计（原地更新） | ~440 MB | **5–10 min（顺利时）** | 失败时无限 |
| 合计（换目录重装） | **~53 GB** | **不可接受** | 这是「迁移」的真实成本 |

### 2.5 运行时资产构成（`Resources/`，52.3 GB）

| 子目录 | 体积 | 文件数 | 内容 |
|---|---|---|---|
| `cloud` | **25.3 GB** | 2957 | 云端文件（学生上传的视频/附件，`botmedia` 为最大头） |
| `videos` | **19.9 GB** | 111 | 视频（单个平均约 180 MB） |
| `public` | 5.3 GB | 3858 | 壁纸/图标/等级图标等 |
| `music` | 1.7 GB | 339 | 音乐 |
| 其余（Pikafish/else/photos） | 41 MB | 263 | — |

> 关键：这 52GB **完全不在 git 里**（`.gitignore` 已排除）→ **`git clone` / `git pull` 都不会传输它，它不构成「下载量」**。
> 它只在一个动作里出现：**换目录重装**（新目录里天然没有它，必须人工搬）。
> 好消息是它**本来就可外置**——`RESOURCES_DIR` 是正式配置项（`server/src/config/index.js:65`、`.env.example:118`），
> 所有资源路由都读它（`apps/resource/backend/routes.js:8`、`cloud-routes.js:16`）。

### 2.6 更新频率

- 近 30 天：**150 次提交**
- 近 7 天：10 次
- 呈现「集中开发日 + 连续发版」的节奏（如 10-17 单日 6 次）

### 2.7 构建耗时实测（2026-10-17，同一份代码，只改一个开关）

| 配置 | vite 内部耗时 | 进程总耗时 | 产物文件 | 产物体积 |
|---|---|---|---|---|
| 默认（`LEGACY_CHUNKS=1`） | **4m 25s** | **269 s** | 323 | 21 MB |
| `LEGACY_CHUNKS=0` | **1m 25s** | **120 s** | 215 | 11 MB |
| **已实施**（默认关闭 + `targets: Chrome >= 80`） | **46 s** | **49 s** | 215 | 11 MB |
| 差值（相对默认） | **−219 s（−83%）** | **−220 s** | −108（全是 `*-legacy-*.js`） | −10 MB |

> 第三行是本次落地后的实测：`renderLegacyChunks` 默认关闭，`Targets` 从 `Chrome >= 89` 改为 `Chrome >= 80`，
> 让 modernPolyfills 覆盖 80~88 区间新增 API。冒烟结论：启动屏退场 ✓、`#app` 挂载 ✓、
> 产物 404 = 0、console error = 0；`index.html` 已无 `nomodule`，polyfills 以 `type="module"` 先于主包加载。

**根因：`@vitejs/plugin-legacy` 的 `renderLegacyChunks`。** 它把每个 chunk 用 Babel 再转译一遍，
生成一套 `nomodule` 脚本 —— 108 个文件、10MB，换掉 180 秒。

**这套产物在本项目是纯浪费：**
- `legacy()` 的 `targets: ['Chrome >= 89', 'Android >= 9']`，而 `build.target: 'chrome80'`
- 校园平板基线是 **Chrome 89（X5/TBS 046295，Chromium 89）**，原生支持 ESM（Chrome 61+）
- 支持 ESM 的浏览器会**忽略所有 `nomodule` 脚本** → 那 108 个文件从来不会被执行

剩余 85 秒的构成（`LEGACY_CHUNKS=0` 时）：

| 因素 | 现状 |
|---|---|
| 模块数 | **2674 个** |
| chunk 数 | **215 个**（mermaid 的动态图占大头：flowDiagram/c4/cynefin/swimlanes/sequence/architecture…） |
| 巨型单文件组件 | 6 个 200KB 级 SFC：`Community.vue` 230KB、`Music.vue` 223KB、`Notes.vue` 202KB、`Admin.vue` 202KB、`Chat.vue` 189KB、`AIChat.vue` 164KB |
| 最大产物 | `vendor-vhs` 984KB、`latex-renderer` 970KB、`cynefin` 675KB、`vendor-mermaid` 666KB |
| 压缩 | esbuild（已是最快档），`sourcemap: false` |

> 另注：线上 `client/dist` 实测 893 文件 / 55MB，但单次构建只产出 215~323 文件 / 11~21MB。
> 差额来自 `emptyOutDir: false` + `prune-dist.js` 的 **24h 年龄水位**——24 小时内的旧产物会被保留，
> 属于刻意设计（兜住「已打开未刷新」的旧页面），不是异常。

---

## 三、瓶颈归因（按影响排序）

| # | 瓶颈 | 影响 | 性质 |
|---|---|---|---|
| 1 | **GitHub HTTPS 不可达** | 更新直接失败 / 卡到超时 | **阻断性**（唯一的「做不成」） |
| 2 | **`pnpm install` 走官方源（338MB）** | 每次多花数分钟，且易失败 | 高 |
| 3 | **每节点重复 `vite build`（实测 4m25s）** | 其中 **180s（67%）** 是 legacy 二次转译，且产物在本项目零收益 | 中高 |
| 4 | `fetch --all --tags` + 无浅克隆 | 多拉不需要的分支/历史 | 中 |
| 5 | 无自动重试 / 无备用源 / 无回滚 | 失败后靠人工收拾 | 中 |
| 6 | 更新无主动备份 | 极端情况下有数据风险 | 低（gitignore 已挡） |
| 7 | *（条件性）52GB 资源需人工搬迁* | 仅「换目录重装」时发生 | 结构性，但可规避 |

> 两个反直觉点：
> ① **40MB 的「全量」在 Gitee 上根本不是问题**（6 秒），压缩源码体积收益有限；
> ② **52GB 的 `Resources/` 不在仓库里，不参与下载** —— 它是「换目录」这个动作的代价，不是「下载」的代价。
> 只要把更新方式固定为原地，它就可以完全不出现在流程里。

---

## 四、方案空间

### 方案 0：资源外置 + 原地更新（**已否决，2026-10-17**）

> **用户明确决定：`Resources/` 不外置。** 本方案仅作记录，不实施。
> 保留的前提结论：那 52GB 不进 git、不参与下载，只在「换目录重装」时成为人工搬迁成本。

> **适用前提**：更新方式包含「换目录 / 换机器重装」。
> 如果你一直是**原地** `git pull` 更新，那 52GB 压根不进流程，本条可跳过，直接看 A/B/C。

**把 52GB 从「换目录」这个动作里摘出去，此后重建代码目录只涉及 40MB。**

- 把 `Resources/` 移到代码目录之外（例：`D:\ClassIntraData\Resources`），`server/.env` 设 `RESOURCES_DIR=D:\ClassIntraData\Resources`
- 所有资源访问都经 `config.resourcesDir`，**代码零改动**（`server/src/config/index.js:65` 已是标准入口）
- Ops 侧把「更新」默认行为固定为**原地 `fetch + reset`**，并对「目标目录已存在 `Resources/` 但无 `.git`」的情况给出阻断式警告（这是最危险的场景：会被当成新装）
- 收益：换机器/重装/回滚都只动 40MB；备份策略也随之简化（`Resources` 是媒体资产，不属于「数据备份」范畴）
- 风险：Windows 下跨盘不能硬链，只能改配置指过去（可接受）；需确认无硬编码 `__dirname/../Resources` 的漏网之鱼（当前 grep 仅 `config/index.js` 兜底与 `init-db.js` 兜底两处，都优先读 env）

### 方案 A：换源 + 浅克隆（P0）

- 默认仓库改为 `https://gitee.com/classintra/ClassIntra.git`，GitHub 作为**自动兜底**
- 首次：`git clone --depth 1 --single-branch --branch main <repo> <target>`
- 更新：`git fetch --depth 1 origin main && git reset --hard FETCH_HEAD`
  - 去掉 `--all --tags`（省掉全部标签与旁支）
  - 用 `reset --hard` 替代 `pull --ff-only`：Ops 场景下目标就是「对齐到远端」，本地改动不该阻塞更新
- 成本：**改 2 个文件、~30 行**；收益：从「失败」到「6 秒」
- 风险：Gitee 单点（账号/限流/同步延迟）→ 用「Gitee 优先、GitHub 兜底、可手填」三重保险对冲

### 方案 B：依赖源国内镜像（P0）

- `.npmrc` 增加 `registry=https://registry.npmmirror.com`
- `better-sqlite3` 等原生模块需一并配二进制镜像（`better_sqlite3_binary_host`）或保持 `build_from_source=false`
- 成本：**一行配置**；收益：338MB 走国内源，通常 1 分钟内完成
- 风险：镜像偶发不同步（罕见）；保留 `--registry` 覆盖能力

### 方案 B2：关闭 legacy 转译（✅ 已于 2026-10-17 实施）

- `vite.config.mjs` 已改：`LEGACY_CHUNKS` 默认关闭（`LEGACY_CHUNKS=1` 可临时回退）
- 同时把 `legacy().targets` 从 `Chrome >= 89` 改为 **`Chrome >= 80`** —— 让 modernPolyfills 覆盖 80~88 区间新增 API
- 实测：**269s → 49s（−83%）**，产物 323 → 215 文件、21MB → 11MB
- 依据：设备基线 Chrome 80+ 原生支持 ESM，`nomodule` 产物从不执行
- Chrome 80 兜底三层：① `build.target: 'chrome80'`（语法）② `modernPolyfills` + `main.js` 手写 polyfill（API）③ `flex-gap-polyfill` PostCSS 插件（CSS，Chrome 84 才支持 gap）
- 风险：IE11 / Chrome < 61 这类不支持 ESM 的浏览器会白屏（校园 MDM 设备不存在）

### 方案 C：预构建产物分发（P1）

- 发版时产出 `dist-vX.Y.Z.zip`（60MB → 压缩 ~20MB），节点下载解压到 `client/dist`，**跳过 install + build**
- 源码仍需增量 pull（通常 < 1MB）
- 存放候选：Gitee Release 附件 / 对象存储 / 主节点自建分发端点
- 成本：发布脚本 + Ops 增加一个「仅更新前端」按钮；收益：单节点 3 min → 20 s
- 风险：**依赖变更时不能跳过 install** → 需要在 manifest 里记录 `package.json`/`pnpm-lock.yaml` 的 hash，变化时回退到完整流程

### 方案 D：文件级增量更新（P2，收益最高）

- 发布端生成 `manifest.json`：`{ version, files: [{ path, sha256, size }] }`
- 节点端 updater：本地清单比对 → 只下载差异文件 → 原子替换 → `pm2 restart`
- 典型一次更新：**几百 KB ~ 2MB**（vs 现在 440MB）
- 可复用现有基建：`server/src/core/market-service.js` 已有「gitee 优先 + github 兜底 + 逐文件下载 + 大小/路径/扩展名校验」的成熟实现
- 成本：中高（manifest 生成、静态托管、updater、原子替换、失败回滚）；收益：秒级更新
- 风险：原子性与一致性（半更新状态）、需要版本锚点防「脏树」

### 方案 E：多节点局域网分发（可选）

- 同一校园内多台机器：一台做「更新源」，其余走内网拉取，避免重复走公网
- 与方案 C/D 组合使用，不单独成案

### 方案对比

| 方案 | 开发量 | 单节点更新耗时 | 解决「GitHub 不通」 | 解决「重复构建」 | 解决「换目录搬 52GB」 |
|---|---|---|---|---|---|
| 0 资源外置+原地更新 | 极小（改配置） | 不含资源 | ❌ | ❌ | ✅（仅此场景） |
| A 换源+浅克隆 | 极小 | 6 s（源码） | ✅ | ❌ | ❌ |
| B 依赖镜像 | 极小 | — | 部分 | ❌ | ❌ |
| B2 关闭 legacy 转译 ✅已实施 | 极小（改默认值） | **build 269→49 s** | ❌ | 大部分（−83%） | ❌ |
| C 产物分发 | 中 | ~20 s | ✅ | ✅ | ❌ |
| D 文件级增量 | 大 | ~1–2 s | ✅ | ✅ | ❌ |
| A+B 组合 | 极小 | **~1 min** | ✅ | ❌ | ❌ |
| 0+A+B（换目录场景） | 极小 | **~1 min** | ✅ | ❌ | ✅ |
| 0+A+B+C | 中 | **~30 s** | ✅ | ✅ | ✅ |

---

## 五、推荐路线

### 第一步（立即可做，验证成本极低）
**A + B + B2**：换 Gitee 源 + 浅克隆 + 依赖国内镜像 + 关闭 legacy 转译。

- B2 **已实施**（2026-10-17）：`vite.config.mjs` 默认关闭 legacy chunks，`targets` 调整为 `Chrome >= 80`；实测 269s → 49s，冒烟全绿
- A 可以**现在就手工验证**：Ops 安装页的「仓库」输入框填 `https://gitee.com/classintra/ClassIntra.git`，立刻能感知差别
- B 是在 `.npmrc` 加一行

预期：更新从「失败 / 10 分钟」降到 **1 分钟以内**，且不再依赖 GitHub 连通性。

### 第一步·补（**仅当你的更新会换目录/换机器**）
**0**：把 `Resources/` 外置（`RESOURCES_DIR`），并让 Ops 默认走原地更新。

- 只需改 `server/.env` 并移动目录，代码零改动；先在一台非关键节点验证
- 若你从不换目录，这条跳过——52GB 本来就不在流程里

预期：换目录重装从「搬 52GB」变成「clone 40MB + 指个路径」。

### 第二步（1–2 天）
**C**：发布产物包，Ops 增加「快速更新（仅前端）」路径。
前置：发布脚本产出 `dist zip` + `build-info.json`（含 lock 文件 hash）。
预期：**~30 秒**，且保留「依赖变更 → 回退完整流程」的安全阀。

### 第三步（按需）
**D**：内置 updater（manifest + 增量 + 原子替换 + 回滚），并复用市场下载器。
适合节点数量继续增长、发版频率继续提高之后。

### 无论走哪步都建议补上的配套
1. **更新前自动备份**：`db`（含 wal/shm）、`server/.env`、`server/config/*.json`、`market-apps/` → `backup/pre-update-<ts>/`
2. **`Resources/` 明确排除在备份与同步之外**：52GB 媒体资产不是「数据」，重装不应触发任何搬迁
3. **更新后自检**：`/api/system/version` 的 `buildHash` 与目标版本一致 + 首页 200 + 关键 API 可达
4. **失败可回滚**：保留上一版 `client/dist` 与 DB 备份，一键还原
5. **去掉 `fetch --all --tags`**：改为只取 `main`，减少不确定耗时

---

## 六、风险与待确认

| # | 事项 | 说明 |
|---|---|---|
| 1 | **`Resources/` 是否已在各节点外置** | 18i 当前是默认的 `<项目根>/Resources`；8i 由 Syncthing 同步 `D:\NetWork\ClassIntra`。若要外置，两端 `RESOURCES_DIR` 需一起改，且确认 `.stignore` 不会因此重复传输 |
| 2 | Gitee 镜像是否为「自动 Pull 镜像」 | 观测到分钟级追平，但需在 Gitee 仓库设置里确认；若是手动推，需补一条 `git push gitee main --tags` 到发布脚本 |
| 3 | Gitee 免费额度 | 单仓库/单文件大小、Raw 流量限制；当前 40MB 远低于上限，但 `dist` 若也托管过去需评估 |
| 4 | Gitee 可用性 | 账号风控/限流可能导致新用户装不上 → 必须保留 GitHub 兜底与「手填源」 |
| 5 | `.stignore` / Syncthing 链路 | 8i 走 Syncthing 而非 Ops，两套更新路径需分别优化，不要混淆 |
| 6 | `dist` 60MB 是否可瘦身 | `assets/` 占 60MB，若能按需拆分/压缩，对首次加载与产物分发都有收益（另案） |
| 7 | 多节点规模 | 若只是自维护的 2–3 台，方案 C 的产物托管成本可能高于收益；若面向外部用户自助部署，则 C/D 必要 |

---

## 附：可复现的验证命令

```bash
# 通道可用性
curl -sL -o /dev/null -m 30 -w "%{http_code} %{speed_download}\n" \
  https://gitee.com/classintra/ClassIntra/repository/archive/main.zip
git ls-remote https://github.com/ClassIntra/ClassIntra.git refs/heads/main

# Gitee 克隆计时
time git clone --depth 1 --single-branch --branch main \
  https://gitee.com/classintra/ClassIntra.git /tmp/ci-probe

# 镜像是否追平
git ls-remote https://gitee.com/classintra/ClassIntra.git refs/heads/main
git ls-remote ssh://git@ssh.github.com:443/ClassIntra/ClassIntra.git refs/heads/main
```
