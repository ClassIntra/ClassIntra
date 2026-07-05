# ClassIntra 集成开发指南

> 本文档面向第三方开发者，说明如何与 ClassIntra 进行双向集成。
> ClassIntra 提供两种集成方式：**postMessage**（前端 iframe 嵌入）和 **webhook**（服务器到服务器）。

## 目录

1. [概述](#1-概述)
2. [集成方式](#2-集成方式)
3. [Token 管理](#3-token-管理)
4. [postMessage 协议](#4-postmessage-协议)
5. [Webhook 协议](#5-webhook-协议)
6. [示例代码](#6-示例代码)

---

## 1. 概述

ClassIntra 是一个教育桌面系统，支持外部网站/系统与之双向联动：

- **学校官网**嵌入 ClassIntra "今日课表" widget（iframe + postMessage）
- **成绩系统** webhook 推送成绩到 ClassIntra 通知中心
- **班级博客** OAuth 调用 ClassIntra API 获取班级成员
- ClassIntra 用户点击"作业系统"图标，嵌入外部作业系统并自动登录

---

## 2. 集成方式

### 双向接口架构

```
外部系统 ──① postMessage(iframe 嵌入,双向)──→ ClassIntra 前端
       ──② webhook(服务器到服务器)────────→ ClassIntra 后端
       ←─③ outbound iframe(ClassIntra→外部)── ClassIntra 前端
       ←─④ outbound webhook(ClassIntra→外部)─ ClassIntra 后端
```

| 方式 | 方向 | 适用场景 |
|------|------|---------|
| postMessage | 双向 | 前端 iframe 嵌入，实时交互 |
| webhook 入站 | 外部→ClassIntra | 服务器到服务器事件推送 |
| webhook 出站 | ClassIntra→外部 | ClassIntra 事件通知外部系统 |

---

## 3. Token 管理

### 3.1 签发 Token

管理员在 ClassIntra 的 `/integration` 页面签发 token：

1. 填写名称、Webhook URL、Origin 白名单、权限范围
2. 点击"签发 Token"
3. 系统返回 `token`（公开标识）和 `secret`（私钥，**仅显示一次**）

### 3.2 Token 结构

```json
{
  "id": 1,
  "name": "学校官网",
  "token": "a1b2c3d4...",      // 64 字节 hex
  "secret": "e5f6g7h8...",      // 128 字节 hex，仅签发时返回
  "scopes": ["user:read", "app:write"],
  "webhookUrl": "https://school.example.com/webhook",
  "origins": ["https://school.example.com"],
  "expiresAt": "2026-08-04T10:00:00.000Z"
}
```

### 3.3 权限范围（Scopes）

| Scope | 说明 |
|-------|------|
| `app:read` / `app:write` | 应用读取/打开 |
| `user:read` / `user:write` | 用户信息读取/写入 |
| `notification:write` | 发送通知 |
| `data:read` / `data:write` | 数据查询/更新 |
| `calendar:read` / `calendar:write` | 日历事件 |
| `countdown:read` | 倒数日 |
| `message:read` / `message:write` | 消息 |
| `community:read` / `community:write` | 社区 |

---

## 4. postMessage 协议

### 4.1 Envelope 信封格式

所有 postMessage 消息必须符合此格式：

```typescript
{
  v: "1.0",                      // 协议版本
  type: "classintra-integration", // 消息类型标识
  id: "ci_xxx",                  // 消息唯一 id
  kind: "request" | "response" | "event" | "error",
  channel: "user:info",          // 通道名
  source: "classintra" | null,   // 来源
  target: null,                  // 目标
  payload: {},                   // 消息体
  requestId: null,               // 关联的请求 id（response/error 必填）
  error: null,                   // 错误信息（kind=error 时）
  timestamp: 1234567890          // 时间戳（ms）
}
```

### 4.2 通道（Channels）

| Channel | 方向 | Scope | 说明 |
|---------|------|-------|------|
| `handshake:request` / `handshake:response` | 双向 | 无 | 握手 |
| `ping` | 双向 | 无 | 心跳 |
| `app:open` | 入站 | `app:write` | 打开应用 |
| `user:info` | 入站 | `user:read` | 查询用户信息 |
| `user:signed-out` | 出站 | `user:read` | 用户登出通知 |
| `notification:send` | 入站 | `notification:write` | 发送通知 |
| `data:query` | 入站 | `data:read` | 数据查询 |
| `event:subscribe` | 入站 | `data:read` | 订阅事件 |
| `event:push` | 出站 | `data:read` | 推送事件 |

### 4.3 握手流程

```
外部页面                          ClassIntra
   │                                  │
   │──── handshake:request ──────────→│
   │                                  │
   │←── handshake:response ───────────│
   │   (userInfo, allowChannels)      │
   │                                  │
   │──── ping ───────────────────────→│
   │                                  │
   │←── { pong: true } ───────────────│
   │                                  │
```

### 4.4 请求-响应流程

```
外部页面                          ClassIntra
   │                                  │
   │──── user:info (request) ────────→│
   │                                  │
   │←── user:info (response) ─────────│
   │   { user_id, real_name }         │
   │                                  │
```

---

## 5. Webhook 协议

### 5.1 入站 Webhook（外部→ClassIntra）

**端点**：`POST /api/integrations/webhook`

**Headers**：

| Header | 说明 |
|--------|------|
| `X-ClassIntra-Token` | 集成 token |
| `X-ClassIntra-Signature` | 签名，格式 `sha256=<hex>` |
| `X-ClassIntra-Timestamp` | 时间戳（ms） |
| `X-ClassIntra-Event` | 事件类型 |

**签名计算**：

```javascript
var crypto = require('crypto');
var signature = 'sha256=' + crypto.createHmac('sha256', secretHash)
  .update(timestamp + '.' + rawBody)
  .digest('hex');
```

**响应**：

```json
{
  "code": 200,
  "message": "webhook 接收成功",
  "data": {
    "event": "custom.event",
    "receivedAt": "2026-07-05T10:00:00.000Z"
  }
}
```

### 5.2 出站 Webhook（ClassIntra→外部）

ClassIntra 在特定事件发生时，向配置了 `webhookUrl` 的集成推送：

**事件类型**：

| 事件 | 说明 | 所需 Scope |
|------|------|-----------|
| `user.signed_in` | 用户登录 | `user:read` |
| `user.signed_out` | 用户登出 | `user:read` |
| `message.received` | 收到消息 | `message:read` |
| `announcement.published` | 公告发布 | `notification:write` |
| `countdown.reached` | 倒数日到达 | `countdown:read` |
| `calendar.event_created` | 日历事件创建 | `calendar:read` |

**推送 Body**：

```json
{
  "event": "user.signed_out",
  "data": { "user_id": "240101" },
  "timestamp": "1751700000000",
  "source": "classintra"
}
```

---

## 6. 示例代码

### 6.1 外部页面嵌入 ClassIntra（iframe）

```html
<iframe id="ci-frame" src="https://classintra.example.com/" allow="fullscreen"></iframe>
<script>
var iframe = document.getElementById('ci-frame');
var targetOrigin = 'https://classintra.example.com';

window.addEventListener('message', function(event) {
  if (event.origin !== targetOrigin) return;
  var env = event.data;
  if (env.type !== 'classintra-integration') return;

  // 握手
  if (env.channel === 'handshake:request' && env.kind === 'request') {
    var response = {
      v: '1.0',
      type: 'classintra-integration',
      id: 'resp_' + Date.now(),
      kind: 'response',
      channel: 'handshake:response',
      requestId: env.id,
      payload: { protocolVersion: '1.0' },
      timestamp: Date.now()
    };
    iframe.contentWindow.postMessage(response, targetOrigin);
  }

  // 接收事件
  if (env.kind === 'event') {
    console.log('收到 ClassIntra 事件:', env.channel, env.payload);
  }
});

// 发起握手
setTimeout(function() {
  var handshake = {
    v: '1.0',
    type: 'classintra-integration',
    id: 'hs_' + Date.now(),
    kind: 'request',
    channel: 'handshake:request',
    payload: null,
    timestamp: Date.now()
  };
  iframe.contentWindow.postMessage(handshake, targetOrigin);
}, 1000);
</script>
```

### 6.2 发送 Webhook（Node.js）

```javascript
var crypto = require('crypto');
var http = require('http');

var TOKEN = 'your_token';
var SECRET_HASH = 'your_secret_hash';  // 注意：实际用 secret_hash，非明文 secret

var timestamp = String(Date.now());
var body = JSON.stringify({ custom: 'data' });

var signature = 'sha256=' + crypto.createHmac('sha256', SECRET_HASH)
  .update(timestamp + '.' + body)
  .digest('hex');

var options = {
  hostname: 'classintra.example.com',
  path: '/api/integrations/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ClassIntra-Token': TOKEN,
    'X-ClassIntra-Signature': signature,
    'X-ClassIntra-Timestamp': timestamp,
    'X-ClassIntra-Event': 'custom.event'
  }
};

var req = http.request(options, function(res) {
  console.log('状态码:', res.statusCode);
});
req.write(body);
req.end();
```

### 6.3 验证 Webhook 签名（接收出站 Webhook）

```javascript
var crypto = require('crypto');

function verifyWebhook(secretHash, timestamp, rawBody, signature) {
  if (!signature || signature.indexOf('sha256=') !== 0) return false;
  var provided = signature.slice(7);
  var expected = crypto.createHmac('sha256', secretHash)
    .update(timestamp + '.' + rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// Express 中间件示例
app.post('/webhook', express.raw({ type: 'application/json' }), function(req, res) {
  var token = req.headers['x-classintra-token'];
  var signature = req.headers['x-classintra-signature'];
  var timestamp = req.headers['x-classintra-timestamp'];
  var event = req.headers['x-classintra-event'];

  // 1. 查找集成（通过 token）
  var integration = lookupIntegration(token);
  if (!integration) return res.status(401).send('Invalid token');

  // 2. 验证签名
  if (!verifyWebhook(integration.secret_hash, timestamp, req.body.toString(), signature)) {
    return res.status(401).send('Invalid signature');
  }

  // 3. 处理事件
  var payload = JSON.parse(req.body.toString());
  console.log('收到 ClassIntra 事件:', event, payload);

  res.json({ received: true });
});
```

---

## 附录：API 速查

| 接口 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/integrations/tokens` | POST | 管理员 | 签发 token |
| `/api/integrations/tokens` | GET | 管理员 | 列出所有集成 |
| `/api/integrations/tokens/:id` | GET | 管理员 | 获取单个集成 |
| `/api/integrations/tokens/:id` | PUT | 管理员 | 更新集成 |
| `/api/integrations/tokens/:id` | DELETE | 管理员 | 撤销 token |
| `/api/integrations/tokens/:id/regenerate-secret` | POST | 管理员 | 重生成 secret |
| `/api/integrations/origins` | GET | 已登录 | 获取 origin 白名单 |
| `/api/integrations/webhook` | POST | Token | webhook 接收 |
