# ClassIntra HTTPS 配置说明

## 方案：mkcert（免费、本地信任）

使用 mkcert 生成的证书会被本地浏览器信任，非常适合局域网使用。

### 步骤 1：安装 mkcert

**Windows 安装：**

1. 下载 mkcert：https://github.com/FiloSottile/mkcert/releases
   - 下载 `mkcert-v1.4.4-windows-amd64.exe`
   - 重命名为 `mkcert.exe`
   - 移动到 `C:\Windows\` 或添加到 PATH

2. 安装根证书：
   ```powershell
   mkcert -install
   ```

**其他系统：**
- macOS: `brew install mkcert`
- Linux: 下载对应版本或使用包管理器

### 步骤 2：生成证书

运行自动生成脚本：
```powershell
cd server/scripts
./generate-certs.ps1
```

或手动生成（需要知道局域网 IP）：
```powershell
# 查看本机局域网 IP
ipconfig | findstr IPv4

# 生成证书（替换你的局域网 IP）
mkcert localhost 127.0.0.1 192.168.x.x ::1
```

### 步骤 3：启动 HTTPS 服务

**方式 1：使用启动脚本**
```powershell
cd server
./start-https.ps1
```

**方式 2：手动启动**
```powershell
cd server/src
node app-https.js
```

### 步骤 4：访问应用

浏览器访问：
- `https://localhost:9001`
- `https://127.0.0.1:9001`
- `https://你的局域网IP:9001`

**局域网其他设备访问：**
- 需要在设备上信任证书（Windows/macOS 已信任）
- 或使用 HTTP 方式访问（不推荐）

### 证书文件位置

```
server/certs/
├── localhost+2.pem   # 证书文件
└── localhost+2-key.pem # 私钥文件
```

### 端口说明

- HTTP：9001（默认，不加密）
- HTTPS：9001（加密，推荐）

### 注意事项

1. **证书有效期**：mkcert 生成的证书有效期约 2 年，到期需重新生成
2. **局域网访问**：其他设备需要信任根证书或使用 HTTP
3. **生产环境**：生产环境请使用 Let's Encrypt 或购买证书
4. **防火墙**：确保端口 9443 在防火墙中开放

### 常见问题

**Q: 浏览器仍然警告证书不安全？**
A: 运行 `mkcert -install` 安装根证书，或检查证书是否包含你的局域网 IP

**Q: 局域网设备无法访问？**
A: 检查防火墙设置，确保端口 9443 开放；检查证书是否包含局域网 IP

**Q: WebSocket 连接失败？**
A: 确保 WebSocket 使用 HTTPS 端口（10001 或同步修改）
---

## 进程模型：主实例 + TLS 镜像（2026-10-21 起）

HTTPS 服务已纳入 PM2，与 9001 主实例并列：

| 应用 | 端口 | 职责 |
| --- | --- | --- |
| `classintra-server` | 9001 / WS 10001 / Relay 10011 | 主实例，持有全部「全局唯一」资源 |
| `classintra-https` | **9443**（默认，见下） | 只把同一份 express 应用套上层 TLS，供 `https://<局域网IP>:9443` 访问 |

> **443 是避让的，不是笔误。** 这台机器的 443 归用户自己的其他服务使用，
> ecosystem 里刻意把默认值写成 `HTTPS_PORT: '9443'`。曾经写成 `|| '443'`，
> 后果是 `pm2 start ecosystem.config.js` 一执行就抢端口，而 PM2 还会
> resurrect —— **开机就抢**，用户的服务永远起不来。
> 真要用 443，必须由 `server/.env` 显式写 `HTTPS_PORT=443`，属自愿行为。
> （`app-https.js` 自身的缺省值是 9001，这个文件只负责「显式指定」。）

镜像实例通过 `WS_MIRROR_MODE=true` 明确放弃以下资源（都在主实例）：

- WS(10001) / Relay(10011) 监听与 mesh 席位（`ws/chat-server.js` 顶部早退）
- AstrBot 机器人 relay 登录（`plugins/astrbot-relay/backend/relay.js` 的 `start()`）
- 网页代理端口 9101（`WEB_PROXY_AUTOSTART=0`）
- 天气提醒定时调度

**为什么必须这样**：这些资源都只允许一个所有者。两个实例同时当中枢去连 8i 节点，
8i 侧会反复 `removing existing peers with same ID`，两边互相把对方踢出 mesh，
跨班同步的数据在两边来回倒；机器人账号双登则是每 3 秒一轮的互踢循环。

### Cluss 在 HTTPS 下内嵌（/cluss-app）

HTTPS 页面 iframe 一个 `http://<host>:9003` 会被浏览器按混合内容直接拦掉，
所以新增了同源反代（`server/src/routes/cluss-proxy.js`）：

```
https://<host>:9443/cluss-app/           → http://127.0.0.1:9003/
https://<host>:9443/cluss-app/api/xxx    → http://127.0.0.1:9003/api/xxx
https://<host>:9443/cluss-app            → 302 /cluss-app/
```

（端口换成 `HTTPS_PORT` 实际值；反代路径与端口无关，因为它按 `req.url` 匹配前缀。）

- 前缀刻意不叫 `/cluss`：那是 `apps/cluss` 自己的应用壳路由（history 模式，
  由 `app.get('*')` 兜底），占了它学生点桌面图标会被反代截走。
- 反代挂在 **server 层**而不是 express 中间件链：Cluss 的对话/批改/写作全是
  SSE 长连接，必须绕过 compression 才不会被攒帧。
- `Set-Cookie` 的 `Path=/` 会被收窄成 `Path=/cluss-app`。
- Cluss 服务（9003）没起时，反代回一个说人话的 502 页面；应用壳侧也会先
  `fetch('/cluss-app/api/health')` 探活，不通就显示「Cluss 没有启动 + 重试」。
- HTTP 版（9001）下的 Cluss 应用壳仍走原来的 9003 直连，行为不变。

Cluss 侧的配合改动见其仓库 `README.md`「与 ClassIntra 联动」一节：
资源相对化（`vite base './'`）+ API 前缀跟随页面路径（`utils/base-path.js`）。
