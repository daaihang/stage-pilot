# StagePilot 侧栏后端接入指南

本文说明桌面端 Workspace / Production 双上下文侧栏的数据边界。Workspace / Tenant Foundation 与 Production Foundation 阶段均已接入真实后端：登录态使用 `apiNavigationRepository`（数据来自 `/v1/workspaces` 与 `/v1/workspaces/:id/productions` 等接口），`mockNavigationRepository` 仅保留给无后端的 UI 开发预览。

## 账户中心（单窗口）

账户中心不再创建独立 Tauri 窗口，而是主窗口中的第三种导航上下文。路由为：

| 路由 | 页面 |
| --- | --- |
| `/account/profile` | 个人资料，使用 `PATCH /me` 更新显示名称 |
| `/account/preferences` | 偏好与通知；主题、标题栏和桌面通知当前保存在本地 |
| `/account/security` | 登录与安全；密码修改使用 `PATCH /me/password`，邮箱验证、会话和注销暂为占位 |
| `/account/billing` | 方案与账单；当前套餐为本地状态，支付、发票和升级暂为占位 |
| `/account/developer` | 开发工具，仅开发构建显示 |

从 Workspace 或 Production 进入账户中心时，使用 `?from=<编码后的内部路径>` 保存来源。前端只接受已知的内部路由，并拒绝外部 URL、`/account/*` 或非法路径；无效来源回退到当前 Workspace 首页。账户侧栏顶部的返回按钮因此可以回到进入前的具体页面。

账户导航顺序由 `src/lib/navigation.js` 的前端配置控制，不依赖后端返回菜单数组。后端只提供用户资料、权限和实体数据；新增账户页面时需同步更新路由元数据、账户侧栏配置、页面标题和开发构建条件。

## 领域层级（Production Foundation 后）

User 是平台级账号；Workspace 是 SaaS 租户边界，通过 `workspace_memberships` 与 User 保持多对多关系；Production 属于且只属于一个 Workspace，是某一次具体活动的内部生产工作空间；Production Resources（节目、征集、Rundown 等）是后续阶段领域，本阶段仅建立父容器。

```text
User / Account
→ Workspace（租户边界，长期组织资产）
→ Production（某一场活动的生产上下文；本阶段已实现）
→ Production Resources（Program / Submission / Rundown / Crew / Credential…，暂缓）
```

后端实现位于 `backend/api/cmd/server/workspace.go`、`production.go`，迁移为 `000003_workspace` 与 `000004_production`：

- `workspaces`：id / name / slug（唯一）/ description / avatar_url / 时间戳 / 软删除
- `workspace_memberships`：workspace_id + user_id 唯一，role ∈ owner > admin > member，status ∈ active / invited / suspended
- `user_preferences.last_workspace_id`：服务端持久化最近工作空间，恢复时重新校验 membership
- `productions`：workspace_id（强制外键，CASCADE）/ name / status ∈ active|completed|archived / timezone（IANA）/ planned_start_at / planned_end_at / actual_completed_at / description / created_by / archived_at / 软删除；索引 workspace_id 与 workspace_id+status
- `production_memberships`：指定活动的直接授权；角色为 producer / editor / stage_manager / contributor / viewer，状态为 active / suspended / revoked，支持 `starts_at` / `expires_at` 时间窗口，访问状态在每次授权检查时即时计算。
- `production_invitations`：存短码 HMAC hash 与管理员复制所需的加密密文（不存明文）；支持邀请可用时间窗口、接受后的成员时间窗口、指定邮箱单次邀请和 1–100 次通用邀请码，不接入邮件投递。

## Workspace API

所有 workspace 作用域操作的后端安全边界是 authenticated user + active membership（`requireWorkspaceRole`），URL 中的 workspaceId 只是寻址：

| 方法与路径 | 说明 | 最低角色 |
| --- | --- | --- |
| `POST /v1/workspaces` | 创建工作空间，创建者自动成为 OWNER 并记为最近使用 | 登录 |
| `GET /v1/workspaces` | 当前用户拥有 active membership 的工作空间（含自己的 role） | 登录 |
| `GET /v1/workspaces/:id` | 单个工作空间 | MEMBER |
| `PATCH /v1/workspaces/:id` | 更新名称 / 描述 / 头像 | ADMIN |
| `GET /v1/workspaces/:id/members` | 成员列表（成员、角色、加入时间） | MEMBER |
| `GET /v1/workspaces/:id/invitations` | 成员邀请列表（服务端派生状态） | ADMIN |
| `POST /v1/workspaces/:id/invitations` | 创建指定邮箱邀请（默认 7 天） | ADMIN |
| `GET /v1/workspaces/:id/invitations/:invitationId/credential` | 读取当前短码（不缓存） | ADMIN |
| `POST /v1/workspaces/:id/invitations/:invitationId/rotate` | 在原记录上轮换短码 | ADMIN |
| `DELETE /v1/workspaces/:id/invitations/:invitationId` | 撤销未接受邀请 | ADMIN |
| `GET /me/last-workspace` | 最近工作空间 id（membership 失效时返回空） | 登录 |
| `PUT /me/last-workspace` | 保存最近工作空间 id（服务端校验 membership） | 登录 |

工作空间不存在与无权限统一返回 `403 workspace_forbidden`；production 不存在、越权或父子伪造统一返回 `404 production_not_found`，不泄露实体是否存在。

## Production API

Production 权限由 `requireProductionPermission(permission)` 统一计算：Workspace OWNER/ADMIN 具备完整活动治理权限，Workspace MEMBER 仅默认查看；直接 `ProductionMembership` 在单场活动中额外授予权限。活动归属 Workspace 不等于该 Workspace 可导航。

| 方法与路径 | 说明 | 最低角色 |
| --- | --- | --- |
| `GET /v1/workspaces/:id/productions` | 当前 workspace 的 production 列表，`?status=` 过滤 | MEMBER |
| `POST /v1/workspaces/:id/productions` | 创建；workspace_id 来自 URL，created_by 为当前用户；默认 active + Asia/Shanghai | ADMIN |
| `GET /v1/workspaces/:id/productions/:pid` | 详情（校验父子关系） | MEMBER |
| `PATCH /v1/workspaces/:id/productions/:pid` | 更新 name/description/timezone/planned_start_at/planned_end_at/status；status=completed 由服务端写 actual_completed_at，status=archived 同时写 archived_at | ADMIN |
| `GET /v1/productions` | 当前用户所有可访问活动，附访问来源和可导航 Workspace 标识 | 登录 |
| `GET/PATCH /v1/productions/:pid` | 规范的活动详情与编辑接口，支持 Production-only 成员 | production.view / production.edit |
| `GET/POST/PATCH/DELETE /v1/productions/:pid/members` | 查看或管理直接活动成员；DELETE 为 revoked | members.view / members.manage |
| `GET/POST/DELETE /v1/productions/:pid/invitations` | 列出、创建、撤销短码邀请 | members.manage |
| `GET /v1/productions/:pid/invitations/:invitationId/credential` | 读取当前短码（不缓存） | members.manage |
| `POST /v1/productions/:pid/invitations/:invitationId/rotate` | 在原记录上轮换短码 | members.manage |
| `POST /v1/invitations/accept` | 已登录用户统一接受 Workspace/Production 短码邀请 | 登录 |

时间模型：`planned_end_at < planned_start_at` 与非法 IANA 时区在服务端拒绝（400）。前端展示一律使用 production.timezone，不使用运行机器本地时区；计划结束不会自动完成 Production。

邀请使用 `/#/join/XXXXX-XXXXX` 短码入口。短码为 10 位 Crockford Base32，服务端保存 HMAC hash 和加密密文；列表不返回明文短码，管理员复制时通过 `credential` 接口按需读取，响应禁止缓存。Workspace 邀请必须指定已验证邮箱且只能领取一次；Production 邀请可指定已验证邮箱或配置 1–100 次通用领取。复制不会生成新码，活动中的 pending/scheduled/active 邀请可以在原记录上轮换短码，旧码立即失效。邀请撤销只阻止尚未接受的邀请，已建立的 Membership 仍在成员页单独撤销。`status`、`remaining_uses`、`invite_kind`、`credential_state` 等列表字段由服务端统一计算，接受时使用行锁、接受记录和 Membership 写入同一事务。旧 `/invite/<token>` 链接和旧 Token 接受接口返回 `410 legacy_invitation_disabled`。

## 导航层级

Workspace 保存长期资产，Production 保存某一场活动的关系和执行流程。

```text
StagePilot
└── Workspace
    ├── 工作台 / 活动 / 日历
    ├── 节目库 / 人员 / 机构 / 场地 / 设备
    ├── 模板 / 工作空间设置
    └── Production
        ├── 概览
        ├── 征集与审核 / 节目 / 人员 / 合作机构 / 场地与设备
        ├── 流程编排 / 舞台执行 / 通行与签到
        └── 文件 / 活动设置
```

菜单名称、顺序、图标与分组由前端产品配置控制。后端返回用户可以访问的实体与权限，不返回一棵用于直接渲染的菜单树。

侧栏 Header 显示合并后的「工作空间与活动」二级下拉：一级为工作空间列表，桌面端直接点击进入该空间工作台（悬停展开二级；触屏端 tap 仅展开，子菜单内提供「进入工作台」）；二级为该空间的活动预览与「查看全部活动」入口。预览选取规则在 `navigation.js` 的 `pickSidebarProductions`：active → upcoming（plannedStartAt 升序）→ past（plannedEndAt 降序）→ 时间待定，排除 archived，最多 `SIDEBAR_PRODUCTION_PREVIEW_LIMIT`（5）条。点击预览中的活动 = 必要时先切换工作空间，再直达该活动 `/overview`。预览数据来自 `listProductions(workspaceId)`，在子菜单首次展开时按需加载，加载与失败状态在菜单行内呈现，不弹 toast。该设计取代早期「活动下拉在侧栏内容区独立分组」的方案。

## Sidebar Context 切换（Supabase 式二级上下文）

进入 `/w/:workspaceId/p/:productionId/*` 后，侧栏正文切换为 Production Context：顶部「← 工作空间名」返回入口始终可见，下方是 Production 导航（概览 / 筹备 / 制作与现场 / 资料）。Workspace 导航与 Production 导览不同时堆叠。Production Foundation 阶段只实现「概览」与「活动设置」，其余入口（征集、节目、人员、流程编排、舞台执行、文件）以 disabled placeholder 呈现，待后续领域开放。

## 路由表

主窗口使用 Hash Router，打包后的地址形如 `index.html#/w/...`。

| 上下文 | 路由 | 阶段状态 |
| --- | --- | --- |
| Workspace | `/w/:workspaceId/home` | 骨架 |
| Workspace | `/w/:workspaceId/productions` | 已接真实 API（列表 / 网格 / 甘特视图 + 新建活动） |
| Workspace | `/w/:workspaceId/calendar` | placeholder |
| 资源库 | `/w/:workspaceId/library/programs` | `WorkspaceResourcePage` + `ResourceDetailPanel`，支持 `:resourceId` 右侧详情 |
| 资源库 | `/w/:workspaceId/library/people` | `WorkspaceResourcePage` + `ResourceDetailPanel`，支持 `:resourceId` 右侧详情 |
| 资源库 | `/w/:workspaceId/library/organizations` | `WorkspaceResourcePage` + `ResourceDetailPanel`，详情内管理机构联系人 |
| 资源库 | `/w/:workspaceId/library/venues` | `WorkspaceResourcePage` + `ResourceDetailPanel`，详情内管理场地空间 |
| 资源库 | `/w/:workspaceId/library/equipment` | `WorkspaceResourcePage` + `ResourceDetailPanel`，支持 `:resourceId` 右侧详情 |
| Workspace | `/w/:workspaceId/templates` | placeholder |
| Workspace | `/w/:workspaceId/settings` | 已接真实 API（General + Members） |
| Production | `/w/:workspaceId/p/:productionId/overview` | 已接真实 API |
| Production | `/w/:workspaceId/p/:productionId/settings` | 已接真实 API |
| Production | 其余 `recruitment/programs/people/organizations/venues-equipment/rundown/stage/access/files` | disabled placeholder（路由保留，未来子领域） |

Production 路由未来自然扩展为 `/w/:workspaceId/p/:productionId/programs` 等；Production 永远嵌套在 Workspace 下，不做平级。Deep-link（直接刷新或打开 production URL）生命周期：Auth → Load Workspace → Validate Membership → Load Production → Validate Parent → Render。

路由标题、说明和状态映射集中在 `apps/desktop/src/lib/navigation.js`。新增一级模块时，应同时更新这里的路由元数据、`app-sidebar.jsx` 中的前端导航配置和对应页面路由。

## Repository 契约

公开 JSDoc 契约位于 `apps/desktop/src/lib/navigation-repository.js`。

```js
WorkspaceSummary {
  id: string
  name: string
  slug: string
  plan: string
  logo: string
}

ProductionSummary {
  id: string
  workspaceId: string
  name: string
  status: "active" | "completed" | "archived"
  plannedStartAt: string // ISO 8601，可为空
  plannedEndAt: string   // ISO 8601，可为空
  venue: string    // Venue 领域暂缓，仅当前窗口展示，不提交 Production API
  timezone: string // IANA，展示与排期一律使用它
  description: string
  archivedAt: string | null
}

NavigationRepository {
  listWorkspaces(): Promise<WorkspaceSummary[]>
  getWorkspace(id): Promise<WorkspaceSummary | null>
  listProductions(workspaceId): Promise<ProductionSummary[]>
  getProduction(workspaceId, productionId): Promise<ProductionSummary | null>
}
```

即使数据来自本地 Mock，接口也始终异步。UI 只通过 `NavigationProvider` 使用该契约，不直接 import Mock fixture。

## 接入 API Repository

已完成：`apiNavigationRepository` 位于 `apps/desktop/src/lib/navigation-repository.js`，通过 `apps/desktop/src/lib/workspace-api.js` 与 `apps/desktop/src/lib/production-api.js` 调用后端，并将后端字段映射为稳定的 `WorkspaceSummary`（`plan` 字段承载当前用户的角色标签：OWNER / ADMIN / MEMBER）与 `ProductionSummary`（`toProductionSummary`）。Production Foundation 的列表、真实活动详情、设置与归档接口均走真实 API；mock fixture 保留给无后端预览与测试。

## Production 数据流与 Deep-link

- 列表缓存：`NavigationProvider.productionsByWorkspace`，按 workspaceId 分桶；进入 workspace 路由时惰性加载。
- 深链恢复：URL 指向列表缓存中没有的 production 时，`App.jsx` 单独调用 `getProduction(workspaceId, productionId)` 并把结果合并回列表缓存（`setProductionsByWorkspaceEntry`），保证单一事实源；404/403 统一渲染「活动不可访问」。
- 前端创建会话：`ProductionsPage` 的“新建活动”只在当前 React 窗口创建内存中的 `creation-session-*` 会话，不调用 API，也不会进入活动列表、侧栏预览或统计。默认名称 `活动-<时间戳>` 只是占位展示，不算有效字段；用户首次提交名称、描述、时区或任一时间字段时才调用 `POST`。创建成功后使用服务端真实 ID 替换临时路由并进入正式 `active` 活动；后续字段修改使用 `PATCH` 自动保存。正式活动的地点通过 `production_locations` API 管理，活动侧栏“场地与空间”页面复用资源页面布局，关联工作空间中的场地和空间资源。未提交的创建会话离开或刷新页面会静默丢弃内容，不提供恢复提示。
- 视图偏好（列表 / 网格 / 甘特）经 `appStore` 按 `productionsView:<workspaceId>` 持久化。

## 状态、权限与错误

- 未登录：主内容显示登录引导，不请求工作空间业务数据。
- 无 Workspace：显示首次创建引导；接入创建接口前不可跳转到伪造 ID。
- 无 Production：活动页显示空状态，Workspace 其他资源页仍可用。
- `404`：显示“工作空间/活动不存在”，返回第一个可访问工作空间。
- `403`：使用相同不可访问页面，不泄露实体是否存在；后端错误可附带可安全展示的说明。
- 网络或 `5xx`：保留当前 URL，显示错误与重试按钮；切换失败时保持原上下文。
- 页面组件运行期异常：由应用级 Error Boundary 显示可恢复错误页，提供返回工作台和重新加载，不允许退化为白屏。
- 加载中：使用页面骨架，不暂时渲染另一个 Workspace 或 Production 的旧数据。
- 权限：后端返回能力标识后，由前端基于静态导航配置过滤不可访问模块，不改变剩余菜单的顺序。

Production 生命周期状态到中文标签和颜色的映射位于 `productionStatus`（active 进行中 / completed 已结束 / archived 已归档），与后端 CHECK 约束一致。后端新增状态时，应先更新共享业务约定，再添加前端映射；未知状态临时降级为「进行中」样式，不应导致侧栏崩溃。

## Mock 移除检查

- API Repository 已通过鉴权、404/403、空列表场景的租户隔离集成测试（`backend/api/cmd/server/workspace_test.go` 与 `production_test.go`，设置 `DATABASE_URL` 运行；后者覆盖列表隔离、读隔离、父子伪造、角色权限、归档与时间/时区校验）。
- Workspace 切换失败不会改变当前路由（`switchWorkspace` 失败时保持原上下文）。
- Production 必须同时匹配 URL 中的 `workspaceId`，防止跨租户读取（后端 `requireProductionAccess` 已落实：先 `requireWorkspaceRole` 再校验父子关系）。
- 生产运行路径已切换到 `apiNavigationRepository`；`mockNavigationRepository` 仅保留给无后端预览。
- 「创建工作空间」「管理工作空间」「新建活动」已接入真实流程；全局搜索仍是占位，接入时继续使用共享 `notify` API 提供成功与失败反馈。
