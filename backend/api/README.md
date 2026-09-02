# @stagepilot/backend-api

StagePilot 云端 HTTP API。当前提供：

- `GET /healthz`：进程存活状态
- `GET /readyz`：PostgreSQL 就绪状态

本地运行：

```bash
go run ./cmd/server
```
