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

## Navigation

桌面端使用 Workspace / Production 双上下文侧栏和 Hash Router。登录后的 Current Workspace Context 生命周期（恢复 / 切换 / onboarding / selector）由 `src/components/workspace-provider.jsx` 管理，路由守卫在 `src/App.jsx` 的 `RoutedMainShell`。路由契约与后端接入说明见 [`docs/sidebar-backend-integration.md`](../../docs/sidebar-backend-integration.md)。
