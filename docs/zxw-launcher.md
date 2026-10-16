# ZW 设备启动器（/zxw）

把一个「启动页」从 ClassIntra 服务器下发给设备端宿主 App：启动页借助宿主注入的 JS 桥，将「负载页」写入设备本地存储并打开。同名文件已存在时由设备端原生短路，不重复传输。典型用途：为平板等设备提供一个本地化的锁屏/入口页，解锁后跳回 ClassIntra。

## 架构与保密边界

| 文件 | 是否入库 | 说明 |
| --- | --- | --- |
| `server/src/routes/zxw.js` | ✅ | 通用服务端逻辑：静态下发 + 事件取证，**不含任何宿主适配常量** |
| `server/public/zxw/launcher.html` | ✅ | 启动页**反阅读构建产物**：密文 + 无密钥（见下），仓库静态不可解 |
| `server/public/zxw/launcher.src.html` | ❌ | 启动页源码，含宿主桥适配常量（内部资料） |
| `server/public/zxw/classintra.html` | ✅ | 负载页（锁屏/入口页，无敏感数据） |
| `server/config/zxw.json` | ❌ | 部署配置（含内部环境地址） |
| `server/config/zxw-boot.json` | ❌ | 启动页一次性填充流（构建自动生成，与产物密文配对） |
| `server/config/zxw.json.example` | ✅ | 配置结构示例（占位值） |
| `scripts/build-zxw-launcher.mjs` | ✅ | 构建脚本：源码 → 反阅读产物 |

> 入库的 `launcher.html` = 密文 + 解码壳，**密钥不在仓库**：构建时以 `crypto.randomBytes` 生成与明文等长的一次性填充流（OTP）对 BODY/JS 做 XOR，填充流只存在于不入库的 `zxw-boot.json`，服务端下发启动页时才注入。因此对仓库静态产物的还原在信息论意义上不可行——与算力（含 AI）无关，是密钥信息根本不存在。重新构建即轮换密钥。
>
> 已知边界（任何 JS 方案的物理极限）：能访问运行中服务的人可截获「注入的填充流 + 公开的密文」；真机调试 / 内存转储可取到解码后的明文。若需对抗这两层，需要在宿主 App 侧引入认证或加固，超出本框架职责。

## 构建

```bash
node scripts/build-zxw-launcher.mjs
# launcher.src.html → launcher.html（含 round-trip 校验与 JS 语法预检）
```

## 服务端配置（server/config/zxw.json）

| 字段 | 说明 |
| --- | --- |
| `payloadFile` | `server/public/zxw/` 下允许被下发的负载页文件名（白名单，仅此一个） |
| `urlToken` | 非空时，下发负载页会把页内该默认地址替换为当前请求的 origin（用于把页面默认跳转指向本服务器）；留空不替换 |

## 端点

| 端点 | 作用 |
| --- | --- |
| `GET /zxw` | 启动页 |
| `GET /zxw/<payloadFile>` | 负载页（注入 origin 替换与渲染信标） |
| `GET/POST /zxw/evt` | 设备端事件上报 |
| `GET /zxw/log` | 事件取证（最近 200 条，`?reset=1` 清空） |

旧路径 `/zx/*` 以 308 永久重定向到 `/zxw/*`。

## 启动页行为（无感设计）

1. **首次访问（或标记失效）**：经宿主桥下发负载页 → 轮询 `/zxw/log` 判定（`served` 出现 = 真传输；1.5s 未出现 = 设备已有同名文件，原生短路）→ 打开 → 写入「就绪标记」（localStorage，按版本 `v<N>` 记账）。
2. **后续访问**：标记命中 → 跳过下发通道，仅调用一次打开桥，秒开无感。
3. **渲染确认**：负载页每次渲染回发 `lock_beacon(v=N)`（服务端注入的信标，file:// 场景以 Image 请求穿透）；启动页核对版本一致后显示「已确认渲染」。
4. **强制更新**：落盘名变 `classintra_v<N+1>.html` 绕开同名短路，并使就绪标记失效。

## 事件链（取证判读）

```
zxw_write → served(src=native|webview) → zxw_open(cached?) → lock_beacon(v=N)
```

- `served` 有且 `src=native`：宿主原生客户端真的取了字节（发生了传输）
- `served` 未出现：设备端同名短路（已存在，未传输）
- `lock_beacon`：负载页真的渲染了，且 `v` 可核对设备副本版本
