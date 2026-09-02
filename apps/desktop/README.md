# @stagepilot/desktop

StagePilot 的桌面应用。React/Vite 前端作为静态资源打包进 Tauri 2，Rust 负责原生能力和本地运行时。

## Commands

```bash
pnpm --filter @stagepilot/desktop dev
pnpm --filter @stagepilot/desktop build
pnpm --filter @stagepilot/desktop tauri:dev
pnpm --filter @stagepilot/desktop tauri:build
```

Tauri manifest 位于 `apps/desktop/src-tauri/Cargo.toml`。
