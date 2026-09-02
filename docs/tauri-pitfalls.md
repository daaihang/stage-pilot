# StagePilot 踩坑记录

## Tauri 2 的窗口 API 默认不一定有权限

Tauri 2 的 Capability 采用默认拒绝策略。`core:default` 只授予基础 Core 命令，不代表前端可以调用全部窗口 API。

本项目的 React 页面调用了以下 `@tauri-apps/api/window` 方法，因此在 `apps/desktop/src-tauri/capabilities/default.json` 为 `main` 窗口显式授予对应的最小权限：

| 前端调用 | 所需权限 |
| --- | --- |
| `window.hide()` | `core:window:allow-hide` |
| `window.show()` | `core:window:allow-show` |
| `window.isVisible()` | `core:window:allow-is-visible` |
| `window.setFocus()` | `core:window:allow-set-focus` |

Rust 后端直接调用 `WebviewWindow` 不经过前端 IPC，不受这些前端 Capability 限制。排查这类报错时，应以错误提示中的 command 名称为准，在生成的 schema 中搜索 `allow-*` 权限；不要为图省事改成更宽泛的权限。

## “关闭到托盘”和“从页面隐藏窗口”是两条路径

- 用户点窗口关闭按钮：在 Rust 的 `WindowEvent::CloseRequested` 中 `prevent_close()`，再隐藏窗口。
- 用户点页面“隐藏到托盘”：前端调用 `window.hide()`，需要上述 `allow-hide` 权限。
- 退出应用：仅由原生菜单/托盘的退出动作调用 `app.exit(0)`。

因此，即便托盘逻辑已经正确，页面端仍需要独立配置窗口 API 的 Capability。

## Tabs 高度导致窗口右侧出现页面滚动条

原页面使用 `min-h-screen` 和普通的纵向文档流。Tabs 根节点和内容区没有可收缩高度，任一面板内容超过窗口高度时会撑高 `body`，于是浏览器/WebView 在整个窗口右侧添加滚动条。

修复采用固定应用壳层：

- `html`、`body`、`#root` 与主容器使用完整视口高度并禁用根滚动；
- 外层使用 `flex flex-col`，Tabs 设为 `flex-1 min-h-0`；
- Tabs 列表 `shrink-0`，每个活动面板使用 `min-h-0 overflow-y-auto`。

`min-h-0` 是关键：Flex 子项默认的最小高度是内容高度，省略它会让内容继续撑开父容器，导致“看似已经设置 overflow 但仍有右侧滚动条”。现在滚动仅发生在内容面板内，顶栏与 Tabs 切换栏保持固定。

## 开发时修改 Capability 后要重启原生进程

Vite 的热更新只负责前端资源。Capability 会被编译进 Tauri 原生应用，修改 `apps/desktop/src-tauri/capabilities/*.json` 后应让 `tauri dev` 重新编译/重启；若开发进程未自动重启，手动停止后重新运行 `pnpm desktop:tauri:dev`。
