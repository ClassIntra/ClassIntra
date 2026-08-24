# ClassIntra 账号与 API 教程

> 本教程以主仓库 `server/src/routes/` 的实际实现为准，示例只使用占位变量，不包含真实账号、密码、Token 或密钥。

## 1. 请求约定

默认地址：

```bash
BASE_URL="http://localhost:9001"
```

HTTP 响应通常包含 `code`、`message`、`data`。成功一般为 `code: 200`；创建 Gomoku 房间为 `201`。部分错误同时使用 HTTP 状态码和 JSON `code`，客户端应优先检查 HTTP 状态码，再检查业务码。

## 2. 注册与登录

注册要求姓名在预注册名单中，且提交 `net_name`、`real_name`、`password`、`confirm_password`。密码强度和重复注册由服务端校验。

```bash
curl -i -c cookies.txt -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"net_name":"YOUR_NICKNAME","real_name":"YOUR_REAL_NAME","password":"YOUR_PASSWORD","confirm_password":"YOUR_PASSWORD"}'
```

登录账号可以是姓名、用户 ID 或网名：

```bash
curl -i -c cookies.txt -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"account":"YOUR_ACCOUNT","password":"YOUR_PASSWORD"}'
```

成功响应的 `data` 包含 `token` 和 `user_info`。服务端同时设置名为 `token` 的 `httpOnly` Cookie，有效期为 7 天；浏览器不能通过 JavaScript 读取该 Cookie。

## 3. Bearer Token 与 Cookie

服务端认证中间件会从 Cookie 或 `Authorization` 请求头提取 Token。脚本、移动端和跨域客户端建议显式使用 Bearer：

```bash
TOKEN="TOKEN_FROM_LOGIN_RESPONSE"
curl "$BASE_URL/api/auth/check-status" \
  -H "Authorization: Bearer $TOKEN"
```

浏览器同源请求可依赖 Cookie；跨域请求需要 `credentials: 'include'`，并由服务端正确配置 CORS：

```js
var response = await fetch(BASE_URL + '/api/auth/check-status', {
  credentials: 'include'
})
var result = await response.json()
if (!response.ok || result.code !== 200) throw new Error(result.message || '请求失败')
```

Bearer 和 Cookie 可以同时发送，但不要把 Token 写入日志、URL、代码仓库或错误上报内容。

## 4. 刷新 Token 与退出

刷新接口接受 Cookie 或 Bearer，并会重新设置 Cookie：

```bash
curl -i -b cookies.txt -c cookies.txt -X POST "$BASE_URL/api/auth/refresh-token"
```

Bearer 版本：

```bash
curl -X POST "$BASE_URL/api/auth/refresh-token" \
  -H "Authorization: Bearer $TOKEN"
```

Token 无效或过期时刷新返回 `401`，需要重新登录。退出登录会清除 Cookie：

```bash
curl -i -b cookies.txt -X POST "$BASE_URL/api/auth/logout"
```

## 5. 用户资料、设置与权限字段

以下接口需要认证：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/auth/check-status` | 检查登录状态并获取最新用户信息 |
| GET | `/api/user/profile` | 获取资料 |
| PATCH | `/api/user/profile` | 修改网名和允许的 `info` 字段 |
| POST | `/api/user/change-password` | 修改密码 |
| GET/POST | `/api/user/settings` | 读取或更新主题、壁纸、通知、头像颜色、桌面布局 |
| GET | `/api/system/app-control` | 获取启用应用和锁屏配置 |

资料更新示例：

```js
var response = await fetch(BASE_URL + '/api/user/profile', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
  body: JSON.stringify({
    net_name: 'YOUR_NEW_NICKNAME',
    info: { email: 'YOUR_EMAIL', signature: 'YOUR_SIGNATURE' }
  })
})
var result = await response.json()
```

`user_info` 和 JWT 可能包含以下权限相关字段：

| 字段 | 含义 |
|------|------|
| `is_admin` | 管理员标记 |
| `is_class_admin` | 班管标记；用户 ID 以 `00` 结尾的班管由服务端识别 |
| `role` | 角色，普通用户通常为 `user`，班干为 `officer` |
| `officer_permissions` | 班干权限列表；可能以 JSON 字符串返回，经过权限中间件后会解析为数组 |
| `officer_title` | 班干称号 |
| `status` | 账号状态，如 `active` |

权限判断应以后端响应为准，不要只依赖前端隐藏按钮。管理员/班管通常可执行管理操作；班干只有具备具体 permission 时才通过 `requirePermission`。

## 6. Axios 封装与自动刷新

项目内前端已有统一 API 封装时，应复用它的 Token 注入和 401 处理。独立客户端可使用 Axios：

```js
import axios from 'axios'

var api = axios.create({ baseURL: BASE_URL, withCredentials: true })
api.interceptors.request.use(function (config) {
  if (TOKEN) config.headers.Authorization = 'Bearer ' + TOKEN
  return config
})

async function requestWithRefresh(config) {
  try {
    return await api.request(config)
  } catch (error) {
    if (!error.response || error.response.status !== 401) throw error
    var refreshed = await api.post('/api/auth/refresh-token')
    TOKEN = refreshed.data.data.token
    config.headers = config.headers || {}
    config.headers.Authorization = 'Bearer ' + TOKEN
    return api.request(config)
  }
}
```

生产客户端应避免并发请求重复刷新，可使用共享 refresh Promise；刷新失败则清理本地状态并回到登录页。

## 7. 系统与市场 API

公开系统接口：

```bash
curl "$BASE_URL/api/system/version"
curl "$BASE_URL/api/system/heartbeat"
curl "$BASE_URL/api/system/health"
```

市场目录支持 `gitee`、`github`、`local`，默认使用 Gitee 并按服务端策略回退：

```bash
curl "$BASE_URL/api/market/catalog?source=gitee" \
  -H "Authorization: Bearer $TOKEN"
curl "$BASE_URL/api/market/installed" \
  -H "Authorization: Bearer $TOKEN"
```

安装、更新、卸载需要管理员或班管权限：

```bash
curl -X POST "$BASE_URL/api/market/install" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"gomoku","source":"local"}'
```

## 8. 错误处理

| HTTP/业务码 | 常见含义 | 客户端动作 |
|-------------|----------|------------|
| 400 | 字段缺失、格式或密码校验失败 | 展示字段级错误，不重试 |
| 401 | 未登录、Token 过期或账号密码错误 | 仅对已登录请求尝试一次刷新；登录接口不要盲目重试 |
| 403 | 账号禁用或权限不足 | 展示权限/禁用原因，不重复请求 |
| 404 | 用户、房间或资源不存在 | 清理过期本地状态 |
| 409 | 网名冲突或资源状态冲突 | 使用响应中的最新数据恢复 |
| 502 | 市场源不可用 | 更换 source 或稍后重试 |
| 500 | 服务端异常 | 记录 request context，不记录凭据；指数退避重试幂等请求 |

网络断开、超时和 WebSocket 断线不等同于业务失败。恢复连接后重新调用状态接口，再决定是否重放操作。

## 9. WebSocket 连接

默认聊天 WebSocket 端口为 `10001`，Token 通过首条 `connect` 消息发送：

```js
var socket = new WebSocket('ws://localhost:10001')
socket.addEventListener('open', function () {
  socket.send(JSON.stringify({ type: 'connect', user_id: 'YOUR_USER_ID', token: TOKEN }))
})
socket.addEventListener('message', function (event) {
  var message = JSON.parse(event.data)
  if (message.type === 'error') console.error(message.message)
})
```

服务端会先返回 `connected`，聊天事件包括 `new_message`、`private_message`、`group_message` 等。客户端应处理 `error`、`pong`、连接关闭和重连；重连后重新发送 `connect`，不要假设旧连接仍有效。

## 10. 安全检查清单

- 使用 HTTPS/WSS 传输生产环境 Token。
- 不提交真实密码、Cookie、JWT、Relay Secret 或市场源私钥。
- 不把 Token 放在 URL 查询参数中。
- 服务端权限校验必须保留，前端权限字段只用于界面提示。
- 对 401 只做一次受控刷新，避免刷新循环。
- 日志中使用用户 ID 或请求 ID，禁止输出完整 Authorization、Cookie 和密码。
