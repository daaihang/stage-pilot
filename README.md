# StagePilot Monorepo

StagePilot 使用 pnpm workspace 和 Turborepo 管理桌面应用、云端服务与共享包。

```text
apps/
  desktop/          Tauri 2 + Vite + React
backend/
  api/              Go HTTP API
  worker/           Go background worker
  migrations/       PostgreSQL migrations
docker/
  compose.yaml      本地 PostgreSQL、API 和 Worker
packages/           共享包（按需新增）
```

## Requirements

- Node.js 22+
- pnpm 9+
- Rust stable（运行或构建 Desktop）
- Go 1.26+
- Docker Desktop（运行本地云端基础设施）

## Desktop

```bash
pnpm install
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:tauri:dev
```

## Backend and Docker

```bash
pnpm docker:up
curl http://localhost:18080/healthz
pnpm docker:down
```

本地 Compose project 固定为 `stagepilot`，默认映射 PostgreSQL `15432`、API `18080`，避免与 PAOP 及常见的 `5432/8080` 开发端口冲突。配置项见根目录 `.env.example`。

不使用 Docker 时，可以在本机直接启动 API：

```bash
pnpm backend:dev
```
