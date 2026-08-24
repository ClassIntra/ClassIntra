# ClassIntra 联机五子棋 API

> 本文档对应 `market-apps/gomoku` 的真实路由、SQLite 状态和聊天 WebSocket 房间事件。示例使用占位 Token，不包含真实凭据。

## 1. 联机模型

Gomoku 市场应用通过 `/api/gomoku` 挂载。房间使用 6 位大写房间码，棋盘支持 `15`、`19`、`21` 三种规格。成员按加入顺序获得黑棋、白棋；第三位及之后的成员为观战者。房主退出时，最早留下的成员成为新房主。

状态对象核心字段：

```json
{
  "roomCode": "ABC123",
  "size": 15,
  "board": [[null]],
  "turn": "black",
  "winner": null,
  "status": "active",
  "gameId": 1,
  "members": [{"user_id":"USER_ID","role":"owner","color":"black"}]
}
```

## 2. HTTP 房间 API

```bash
BASE_URL="http://localhost:9001"
TOKEN="TOKEN_FROM_LOGIN_RESPONSE"
```

创建房间：

```bash
curl -X POST "$BASE_URL/api/gomoku/rooms" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"size":15}'
```

成功返回 HTTP `201`，从 `data.roomCode` 取得房间码：

```bash
ROOM_CODE="ABC123"
curl "$BASE_URL/api/gomoku/rooms/$ROOM_CODE" \
  -H "Authorization: Bearer $TOKEN"
```

加入、观战与退出：

```bash
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/join" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/watch" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/leave" -H "Authorization: Bearer $TOKEN"
```

落子坐标从 `0` 开始：

```bash
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/move" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"row":7,"col":7}'
```

历史、换色、重开和关闭：

```bash
curl "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/history" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/color" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/reset" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/gomoku/rooms/$ROOM_CODE/close" -H "Authorization: Bearer $TOKEN"
```

`close`、`reset` 要求房主；`color` 只允许玩家在没有进行中对局时交换黑白。旧版个人接口 `/api/gomoku/state`、`/api/gomoku/move`、`/api/gomoku/reset` 保留兼容，但新集成应使用房间 API。

## 3. fetch 调用示例

```js
async function gomokuRequest(path, options) {
  var response = await fetch(BASE_URL + path, Object.assign({
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }
  }, options || {}))
  var result = await response.json()
  if (!response.ok || result.code < 200 || result.code >= 300) {
    var error = new Error(result.message || 'Gomoku 请求失败')
    error.status = response.status
    error.data = result.data
    throw error
  }
  return result.data
}

var room = await gomokuRequest('/api/gomoku/rooms', {
  method: 'POST', body: JSON.stringify({ size: 19 })
})
await gomokuRequest('/api/gomoku/rooms/' + room.roomCode + '/join', { method: 'POST' })
```

## 4. WebSocket 房间同步

先按账号 API 教程连接 `ws://localhost:10001`，发送 `connect` 完成认证，再订阅房间：

```js
var socket = new WebSocket('ws://localhost:10001')
socket.addEventListener('open', function () {
  socket.send(JSON.stringify({ type: 'connect', user_id: 'YOUR_USER_ID', token: TOKEN }))
  socket.send(JSON.stringify({ type: 'gomoku_subscribe', room_code: ROOM_CODE }))
})
socket.addEventListener('message', function (event) {
  var message = JSON.parse(event.data)
  if (message.type === 'gomoku_room_state') renderState(message.state)
  if (message.type === 'gomoku_room_changed') renderState(message.state)
  if (message.type === 'gomoku_move_rejected') showError(message.reason)
})
```

落子和取消订阅：

```js
socket.send(JSON.stringify({ type: 'gomoku_move', room_code: ROOM_CODE, row: 7, col: 7 }))
socket.send(JSON.stringify({ type: 'gomoku_unsubscribe', room_code: ROOM_CODE }))
```

事件说明：

| 事件 | 说明 |
|------|------|
| `gomoku_room_state` | 订阅成功后的完整状态 |
| `gomoku_room_changed` | 合法落子后的房间状态与 `move` |
| `gomoku_move_rejected` | 房间不存在、非成员、观战者、回合不符或坐标非法 |
| `gomoku_game_continued` | 收到继续对局操作后的状态 |

房间状态以 HTTP GET 为最终恢复来源。WebSocket 断线重连后应重新认证、订阅，并调用 GET 防止漏事件。

## 5. 规则与错误恢复

- 只允许当前 `turn` 对应颜色落子。
- 坐标必须是整数且位于 `0 <= row,col < size`。
- 已有棋子、结束对局、观战者落子分别返回 `409` 或 `403`。
- 任意横、竖、斜线连续五子即获胜。
- 房间关闭后不能继续使用；状态接口返回 `404`。
- 网络超时不应直接重放落子；先 GET 状态确认该步是否已经落库。

推荐处理流程：

1. 用户点击棋盘后立即锁定重复提交。
2. 收到 `gomoku_room_changed` 或 HTTP 成功响应后更新棋盘。
3. 收到 `gomoku_move_rejected` 或 `409` 时使用响应中的状态恢复。
4. 连接关闭时显示离线状态并退避重连。
5. 重连成功后调用 `/rooms/:roomCode`，再发送 `gomoku_subscribe`。

## 6. 调试清单

- 确认市场应用已安装且 `/api/gomoku` 已挂载。
- 确认账号 Token 未过期，WebSocket 首条消息中的 `user_id` 与 Token 一致。
- 检查 `server/src/migrations/004_add_gomoku_rooms.js` 已运行。
- 使用两个不同账号验证黑棋、白棋和观战角色。
- 分别验证 15×15、19×19、21×21 坐标边界。
- 不在浏览器控制台、抓包文件或 Issue 中粘贴真实 Cookie、Bearer Token 或密码。
