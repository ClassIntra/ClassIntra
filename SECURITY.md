# Security Policy / 安全策略

## Supported Versions / 支持版本

| Version | Supported |
| ------- | --------- |
| 1.7.x   | :white_check_mark: |
| 1.6.x   | :white_check_mark:（仅关键安全修复） |
| < 1.6   | :x: |

## Reporting a Vulnerability / 漏洞报告

**请勿在公开 Issue 中披露安全漏洞。**

ClassIntra 面向真实校园场景部署，常见部署形态为「教室局域网 + 单服务器」，但跨班中继、公网隧道（HTTPS）等部署可能将服务暴露到更大的网络面。以下几类问题尤其需要负责任披露：

- 鉴权绕过（JWT 签发/校验、`ADMIN_USER_IDS` 提权、第三方应用 token/scope 越权）
- 学元账本的资金安全（绕过支付密码/日额度风控、幂等键重放、跨班 HMAC 伪造）
- 路径遍历与任意文件读写（资源仓库、市场安装包、CDN 代理）
- 跨班中继/桥接信道的伪造与重放

### 报告渠道

1. **首选：GitHub Security Advisory**（仓库 Security 标签页 → Report a vulnerability）—— 私密披露，便于跟踪与致谢。
2. 备选：通过仓库主页作者联系方式私下联系。

### 响应承诺

- **48 小时内**确认收到；
- **7 天内**给出初步评估（是否成立、影响范围、严重级别）；
- 修复随下一个补丁版本发布，高危问题会提前在 Release 说明中提示升级；
- 修复发布后在 Advisory 中致谢报告者（除非要求匿名）。

## 安全设计速览（供报告者参考）

- 认证：RS256 JWT（httpOnly Cookie），私钥缺失时首启自动生成到 `server/keys/`；`JWT_SECRET` 仅用于过渡期校验旧 HS256 token
- 学元体系：复式记账内核唯一写入口 + ref 幂等 + 分组守恒不变量对账；转出统一过支付密码与日额度风控（pay-guard）；跨班走 HMAC 签名 + 时间窗防重放
- 第三方应用：token + scope 白名单（`integrations-api.js`），资金面走分层 `app-api`（拿不到真金口径）
- 更多设计细节见 [docs/economy-design.md](docs/economy-design.md) V 章与文档站 security 相关页面
