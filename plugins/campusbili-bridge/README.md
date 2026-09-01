# CampusBili 桥接插件

> ClassIntra 与 CampusBili 网站的桥接插件。
> 当 ClassIntra 用户通过超能岛浏览器访问 CampusBili 时，CampusBili 顶部显示"返回 ClassIntra"按钮；视频页返回按钮只返回 CampusBili 内部上一页。

## 工作原理

```
ClassIntra (Browser.vue)                    CampusBili (AppHeader.vue)
    │                                              │
    │  ① iframe 加载 CampusBili                    │
    │ ───────────────────────────────────────────→ │
    │                                              │
    │  ② postMessage({ source:'classintra-browser',│
    │       user:{ user_id, net_name, ... } })     │
    │ ───────────────────────────────────────────→ │  ③ 监听 message，识别 ClassIntra 环境
    │                                              │     左上角显示"返回 ClassIntra"按钮
    │                                              │
    │  ④ 用户点击返回按钮                          │
    │ ←─────────────────────────────────────────── │  ⑤ postMessage({ action:'classintra-back' })
    │  ⑥ 收到 back 消息，$router.back()            │
    │                                              │
```

### 1. 身份注入（ClassIntra → CampusBili）

ClassIntra 的 `Browser.vue` 在 iframe 加载完成后，向子站点 `postMessage` 发送身份标识：

```js
{
  source: 'classintra-browser',
  user: {
    user_id: 'u123',
    net_name: '张三',
    is_admin: 1,
    role: 'officer'
  },
  timestamp: 1690000000000
}
```

- `source: 'classintra-browser'` 是固定标识，子站点据此辨认 ClassIntra 环境
- `user` 为当前 ClassIntra 用户信息（不含敏感凭证）
- `targetOrigin` 限定为 iframe 当前 URL 的 origin，避免消息泄漏

### 2. 返回动作（CampusBili → ClassIntra）

CampusBili 左上角"返回"按钮点击时，向父窗口 `postMessage`：

```js
window.parent.postMessage({ action: 'classintra-back' }, '*')
```

ClassIntra 的 `Browser.vue` 监听此消息，执行 `$router.back()` 返回桌面。

## CampusBili 侧实现

在 CampusBili 的 `client/src/components/layout/AppHeader.vue` 中：

1. **监听 message**：`mounted` 时注册 `window.addEventListener('message', handler)`
2. **识别环境**：收到 `source === 'classintra-browser'` 的消息，设置 `isClassIntraEmbed = true`
3. **显示返回按钮**：`<header>` 最左侧添加 `v-if="isClassIntraEmbed"` 的返回按钮
4. **点击返回**：`window.parent.postMessage({ action: 'classintra-back' }, '*')`

## 后端验证（可选）

CampusBili 内嵌时通过 URL 参数 `classintra=1` 自动跳过独立访问密码。若 CampusBili 后端需要确认 ClassIntra 用户身份（如同步数据），可调用：

```
POST /api/campusbili-bridge/verify
Authorization: Bearer <ClassIntra JWT>
```

返回当前 ClassIntra 用户信息。此接口需 ClassIntra JWT，适用于 CampusBili 后端已获取 ClassIntra token 的场景。

## 配置

插件 manifest 声明为 `category: "hidden"` + `canDisable: false`，不在桌面显示且不可禁用。

如需桥接其他站点，参考本插件创建新的 `apps/<site>-bridge` 插件，子站点按相同协议实现 `postMessage` 监听即可。

## 安全性

- `postMessage` 仅向 iframe 当前 origin 发送，不使用 `'*'`（返回消息除外，因为父窗口 origin 未知）
- ClassIntra 监听消息时验证 `event.source === frame.contentWindow`，防止恶意页面伪造
- 注入的用户信息不含密码/token 等敏感凭证
- 后端验证接口受 JWT 保护
