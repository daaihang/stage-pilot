# StagePilot

**StagePilot 是面向演出与活动制作团队的桌面优先协作运营平台。** 它希望把团队长期积累的资源，与每一场活动的筹备、协作和执行连接起来：工作空间沉淀可复用的组织资产，Production 则组织单场活动的制作工作。

> 项目仍在积极开发中。部分业务流程和桌面页面尚在迭代，文中的“已接入”表示仓库已有对应实现，不代表所有模块都已达到生产环境部署或运营就绪状态。

## 核心概念

```text
User / Account
└── Workspace（工作空间：团队、长期资源与协作边界）
    ├── 节目、人员、机构、场地、设备与文件
    └── Production（活动：单场演出的筹备与制作上下文）
        ├── 活动成员、邀请与权限
        ├── 征集、投稿与审核
        ├── 节目单、场次与分享
        └── 日程、排练、现场流程等持续建设中的模块
```

- **Workspace** 是团队及长期资产的组织边界，成员资格决定对工作空间资源的访问。
- **Production** 属于一个 Workspace，围绕某一场活动组织人员、内容和工作流程；活动权限还可以由直接成员角色补充。
- **User / Account** 是平台级身份，可加入多个工作空间或直接协作的活动。

## 当前项目能力

仓库中的桌面端与服务端持续演进，当前代码包含以下能力：

- **账户与会话**：注册、登录、令牌刷新、账户资料与偏好；桌面端 refresh token 使用系统凭据存储。
- **工作空间协作**：Workspace 创建、切换、成员与角色，以及基于成员资格的访问控制。
- **活动管理**：Production 基础信息、成员、邀请与权限边界。
- **长期资源**：节目、人员、机构、场地、设备及其类型管理。
- **征集与审核**：Campaign 模板/修订、发布、公开提交及审核相关服务端流程。
- **节目单**：节目单内容、排序、发布与分享能力持续完善。
- **文件与附件**：S3 兼容对象存储、上传与版本能力；附件按所属业务对象执行授权。Worker 负责部分存储维护任务。
- **桌面体验**：跨平台 Tauri 桌面壳、Workspace / Production 导航、响应式详情区域、系统集成和开发工具。

部分 Production 页面仍是占位或开发中的体验，例如排程、场次、排练、舞台执行等。具体状态以当前 UI、API 和领域文档为准。

## 技术架构

```text
┌──────────────────────────────────────────────┐
│ StagePilot Desktop                            │
│ Tauri 2 / Rust · React 19 · Vite · shadcn/ui │
└───────────────────────┬──────────────────────┘
                        │ HTTP API
                        ▼
┌──────────────────────────────────────────────┐
│ Go API                                        │
│ 认证、业务 API、授权、上传签名与健康检查       │
└────────────┬─────────────────────┬───────────┘
             │                     │ S3 API
             ▼                     ▼
      PostgreSQL 17          MinIO / S3 存储
             ▲
             │ 数据库与后台维护任务
      Go Worker

  Migrations 在 API / Worker 启动前应用数据库变更
```

项目采用 **pnpm workspace + Turborepo** 管理前端、Go 服务和任务。API 与 Worker 使用 Go、PostgreSQL 和原生 SQL；本地文件对象存储由 MinIO 提供，生产部署可配置兼容的 S3 服务。

## 仓库结构

```text
apps/desktop/       Tauri 2 桌面应用（React / Vite）
backend/api/        Go HTTP API
backend/worker/     Go 后台 Worker
backend/migrations/ PostgreSQL up/down 迁移
packages/           预留的共享包 workspace
docker/             本地开发 Compose 配置
docs/               架构、领域与集成说明
scripts/            桌面开发进程维护脚本
```

## 快速开始

### 环境要求

- Node.js **22 或更高版本**
- pnpm **9.12.0**（见根目录 `package.json` 的 `packageManager`）
- Rust stable 与 Cargo（运行或构建 Tauri 桌面端）
- Go **1.26 或更高版本**（API 与 Worker 的 `go.mod` 要求）
- Docker Desktop（运行本地 API、数据库、对象存储和 Worker）
- Windows 桌面开发需安装 Tauri 所需的 Microsoft C++ Build Tools 和 WebView2；macOS/Linux 请按 Tauri 官方平台要求安装对应依赖

### 1. 安装 JS 依赖并准备环境变量

```bash
pnpm install
```

首次启动本地服务前，在仓库根目录复制环境模板：

```powershell
Copy-Item .env.example .env
```

`.env` 只用于本机开发，不要提交真实凭据。生产部署必须为数据库、JWT、邀请凭据加密/哈希和对象存储设置独立强密钥，并保持 `AUTH_EXPOSE_DEV_TOKENS=false`。

### 2. 启动本地后端依赖

```bash
pnpm docker:up
```

Compose 会启动 PostgreSQL、MinIO、数据库迁移、Go API、Worker 和 ClamAV 文件扫描服务。API 健康检查：

```text
http://localhost:18080/healthz
http://localhost:18080/readyz
```

`/healthz` 检查进程存活；`/readyz` 检查 API 是否可连接数据库。首次启动 ClamAV 可能需要下载病毒库，健康状态可能需要等待一段时间。

### 3. 启动桌面应用

浏览器开发预览（仅 Vite，不包含 Tauri 原生能力）：

```bash
pnpm desktop:dev
```

运行完整桌面应用：

```bash
pnpm desktop:tauri:dev
```

`desktop:tauri:dev` 会先尝试清理当前项目遗留的开发进程，再启动 Tauri 与 Vite HMR。停止开发进程：

```bash
pnpm desktop:stop
```

结束本地基础设施：

```bash
pnpm docker:down
```

### 本地默认端口

| 服务 | 默认端口 | 说明 |
| --- | ---: | --- |
| Vite | `1420` | 桌面前端开发服务 |
| Vite HMR | `1421` | 开发热更新 |
| PostgreSQL | `15432` | 主机映射端口 |
| Go API | `18080` | 主机映射端口 |
| MinIO API | `19000` | S3 兼容 API |
| MinIO Console | `19001` | 本地对象存储管理界面 |

端口及服务参数可通过根目录 `.env` 覆盖。容器网络内部使用各服务自己的端口（例如 PostgreSQL `5432`、API `8080`、MinIO `9000`）。

## 常用开发命令

在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | Turborepo 启动各包开发任务 |
| `pnpm build` | 构建 workspace 项目 |
| `pnpm check` | 执行各包静态检查/检查任务 |
| `pnpm test` | 执行各包测试任务 |
| `pnpm desktop:dev` | 启动 Vite 浏览器预览 |
| `pnpm desktop:build` | 构建桌面端 Web 前端资源 |
| `pnpm desktop:tauri:dev` | 启动完整 Tauri 桌面开发环境 |
| `pnpm desktop:tauri:build` | 构建 Tauri 桌面应用 |
| `pnpm backend:dev` | 本机启动 Go API（默认连接 `localhost:15432`） |
| `pnpm docker:up` / `pnpm docker:down` | 启动 / 停止本地服务栈 |

单独检查后端：

```bash
pnpm --filter @stagepilot/backend-api check
pnpm --filter @stagepilot/backend-api test
pnpm --filter @stagepilot/backend-worker check
pnpm --filter @stagepilot/backend-worker test
```

也可以在相应 Go 模块目录中使用 `go test ./...`、`go vet ./...`。桌面端脚本以 `apps/desktop/package.json` 为准。

后端集成测试使用单独的 PostgreSQL/MinIO 测试项目和 `TEST_DATABASE_URL`，启动、连接与成套清理步骤见[集成测试隔离](docs/integration-test-isolation.md)。

## 配置与安全提示

配置模板位于 [`.env.example`](.env.example)，主要包含：

- **数据库与服务端口**：PostgreSQL 数据库名、账号和端口，以及 API 端口。
- **认证与邀请凭据**：JWT 签名密钥、开发 token 暴露开关、邀请短码哈希密钥和加密密钥。
- **对象存储与文件**：S3/MinIO endpoint、bucket、访问凭据、TLS/寻址模式、上传链接有效期和文件大小上限。
- **后台任务与扫描**：Worker 间隔；ClamAV 扫描服务由 Compose 内部网络连接。

模板中的凭据仅用于本地开发。生产部署不得使用默认值；不要将 `.env`、token、密码或真实密钥提交到 Git。邮箱验证/密码找回 token 的开发回显选项仅能在受控开发环境中启用。

## 开发与设计文档

建议从以下文档开始：

- [Workspace / Production 导航与后端集成](docs/sidebar-backend-integration.md)
- [窗口级详情侧栏接入指南](docs/window-detail-sidebar.md)
- [文件与附件能力](docs/file-attachments.md) · [文件附件接入契约](docs/file-attachment-integration.md)
- [邀请短码安全模型](docs/invitation-short-codes.md)
- [页面头部约定](docs/page-header.md)
- [Tauri 常见问题](docs/tauri-pitfalls.md)
- [领域文档目录](docs/domain/)

修改前端用户操作时，应遵守共享 `notify` 反馈约定；接入详情页面时先阅读窗口级详情侧栏指南；修改租户 API 时应保留 Workspace membership 和 Production 父子关系的服务端授权边界。仓库级工程约定见 [`AGENTS.md`](AGENTS.md)。

## 贡献与项目状态

欢迎通过代码、问题报告和设计讨论帮助 StagePilot 演进。提交改动前建议运行与改动相关的 `check`、`test` 和 `build` 命令；代码变更应提供适当验证，提交只包含本任务相关文件。请不要提交本地环境文件、生成物、调试残留或任何凭据。

仓库当前未包含根目录 `LICENSE` 文件；在正式许可声明加入前，请不要假定本项目采用特定开源许可证。
