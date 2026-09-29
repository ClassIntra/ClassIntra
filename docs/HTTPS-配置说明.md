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