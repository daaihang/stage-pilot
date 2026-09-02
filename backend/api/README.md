# @stagepilot/backend-api

StagePilot 云端 HTTP API。当前提供：

- `GET /healthz`：进程存活状态
- `GET /readyz`：PostgreSQL 就绪状态
- 账号 API：`/auth/*`、`/me`

开发环境如需在响应中取得邮箱验证/密码找回 token，可设置 `AUTH_EXPOSE_DEV_TOKENS=true`；生产环境必须保持关闭并接入邮件投递服务。

本地运行：

```bash
go run ./cmd/server
```
