# StagePilot 侧栏后端接入指南

本文说明桌面端 Workspace / Production 双上下文侧栏的数据边界。Workspace / Tenant Foundation 与 Production Foundation 阶段均已接入真实后端：登录态使用 `apiNavigationRepository`（数据来自 `/v1/workspaces` 与 `/v1/workspaces/:id/productions` 等接口），`mockNavigationRepository` 仅保留给无后端的 UI 开发预览。

## 账户中心（单窗口）

账户中心不再创建独立 Tauri 窗口，而是主窗口中的第三种导航上下文。路由为：

| 路由 | 页面 |
| --- | --- |
| `/account/profile` | 个人资料，使用 `PATCH /me` 更新显示名称，并上传、更换或移除账户头像 |
| `/account/preferences` | 偏好与通知；主题、页面宽度、标题栏、侧栏热区、分类导航、Dock、详情方式、时区和通知开关同步到账户云端；窗口尺寸与开发者工具状态仍保存在本机 |
| `/account/security` | 登录与安全；密码修改使用 `PATCH /me/password`，邮箱验证、会话和注销暂为占位 |
| `/account/billing` | 方案与账单；当前套餐为本地状态，支付、发票和升级暂为占位 |
| `/account/developer` | 开发工具，仅开发构建显示 |

从 Workspace 或 Production 进入账户中心时，使用 `?from=<编码后的内部路径>` 保存来源。前端只接受已知的内部路由，并拒绝外部 URL、`/account/*` 或非法路径；无效来源回退到当前 Workspace 首页。账户侧栏顶部的返回按钮因此可以回到进入前的具体页面。

账户导航顺序由 `src/lib/navigation.js` 的前端配置控制，不依赖后端返回菜单数组。后端只提供用户资料、权限和实体数据；新增账户页面时需同步更新路由元数据、账户侧栏配置、页面标题和开发构建条件。

账户头像通过 `PUT /v1/me/avatar`（multipart 字段 `avatar`）上传，`DELETE /v1/me/avatar` 移除；仅接受不超过 5 MiB 的静态 JPEG、PNG、WebP，服务端重新编码并限制输出尺寸。头像存入独立的用户对象路径，不进入 Workspace 文件库或附件。用户资料和成员响应仍以 `avatar_url` 返回显示地址；托管头像使用 `GET /v1/users/:userId/avatar`，桌面端携带登录态读取。本人及能在共同 Workspace 成员列表或有权限查看的 Production 成员列表中看到该用户的协作者可读，其他请求返回 404；旧的外部 `avatar_url` 继续作为兼容回退值，但 `PATCH /me` 不接受直接改写。

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
- `workspace_memberships`：workspace_id + user_id 唯一，role ∈ owner > admin > member，status ∈ active / invited / suspended / revoked；撤销只更新状态与时间戳，不删除 membership
- `membership_audit_events`：Workspace 与 Production 成员角色、状态和撤销动作的追加式审计记录
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
| `PATCH /v1/workspaces/:id/members/:memberId` | 修改 Owner/Admin/Member 角色，或暂停/恢复成员 | ADMIN |
| `DELETE /v1/workspaces/:id/members/:memberId` | 软移除成员，写入 revoked，不物理删除 | ADMIN |
| `GET /v1/workspaces/:id/invitations` | 成员邀请列表（服务端派生状态） | ADMIN |
| `POST /v1/workspaces/:id/invitations` | 创建指定邮箱邀请（默认 7 天） | ADMIN |
| `GET /v1/workspaces/:id/invitations/:invitationId/credential` | 读取当前短码（不缓存） | ADMIN |
| `POST /v1/workspaces/:id/invitations/:invitationId/rotate` | 在原记录上轮换短码 | ADMIN |
| `DELETE /v1/workspaces/:id/invitations/:invitationId` | 撤销未接受邀请 | ADMIN |
| `GET /me/last-workspace` | 最近工作空间 id（membership 失效时返回空） | 登录 |
| `PUT /me/last-workspace` | 保存最近工作空间 id（服务端校验 membership） | 登录 |

工作空间不存在与无权限统一返回 `403 workspace_forbidden`；production 不存在、越权或父子伪造统一返回 `404 production_not_found`，不泄露实体是否存在。Workspace Owner 可以管理全部固定角色，Admin 只能管理普通 Member；最后一个 active Owner 不允许降级、暂停或移除，返回 `409 workspace_last_owner`。

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
| `GET/POST/PATCH/DELETE /v1/productions/:pid/members` | 查看或管理直接活动成员；PATCH 修改固定角色/状态/时间窗口，DELETE 为 revoked | members.view / members.manage |
| `GET/POST/DELETE /v1/productions/:pid/invitations` | 列出、创建、撤销短码邀请 | members.manage |
| `GET /v1/productions/:pid/invitations/:invitationId/credential` | 读取当前短码（不缓存） | members.manage |
| `POST /v1/productions/:pid/invitations/:invitationId/rotate` | 在原记录上轮换短码 | members.manage |
| `POST /v1/invitations/accept` | 已登录用户统一接受 Workspace/Production 短码邀请 | 登录 |

时间模型：`planned_end_at < planned_start_at` 与非法 IANA 时区在服务端拒绝（400）。前端展示一律使用 production.timezone，不使用运行机器本地时区；计划结束不会自动完成 Production。

邀请使用 `/#/join/XXXXX-XXXXX` 短码入口。短码为 10 位 Crockford Base32，服务端保存 HMAC hash 和加密密文；列表不返回明文短码，管理员复制时通过 `credential` 接口按需读取，响应禁止缓存。Workspace 邀请必须指定已验证邮箱且只能领取一次；Production 邀请可指定已验证邮箱或配置 1–100 次通用领取。复制不会生成新码，活动中的 pending/scheduled/active 邀请可以在原记录上轮换短码，旧码立即失效。邀请撤销只阻止尚未接受的邀请，已建立的 Membership 仍在成员页单独撤销。Workspace revoked membership 重新接受邀请时复用原关联并记录 reinstated 审计事件；Production revoked membership 保留历史，重新邀请创建新的有效关联。Workspace 与 Production 是独立授权关系，Workspace 暂停/移除不会自动撤销用户已有的直接 Production 访问。`status`、`remaining_uses`、`invite_kind`、`credential_state` 等列表字段由服务端统一计算，接受时使用行锁、接受记录和 Membership 写入同一事务。Production 的角色变更会保护最后一个有效 Producer；active Workspace Owner/Admin 计入 Producer 等价治理者。旧 `/invite/<token>` 链接和旧 Token 接受接口返回 `410 legacy_invitation_disabled`。

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

页面返回、上下文退出和详情关闭分别由前端导航协议处理：`resolvePageBack` 返回当前层级父页面，`resolveContextExit` 离开 Workspace/Production 上下文，`resolveDetailClose` 清理窗口级详情 URL。标题栏 Breadcrumbs 仅表示当前位置和祖先链接，不能替代页面返回按钮；普通导航使用真实 `Link`，只有等待草稿保存、删除或接受邀请等状态转换才使用 `useNavigate`。浏览器前进/后退保留为历史导航，不作为业务页面返回实现。

Production 子页面统一返回当前活动概览；活动概览返回活动列表（Production-only 返回 `/work?tab=participating`）。表单详情返回全部表单；资源详情、邀请面板和其他窗口详情只移除详情 ID/面板参数并保留列表筛选。排程、节目单和活动节目详情必须通过 URL 表达选中记录，刷新、深链和前进/后退不得依赖本地 React state。

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

## 文件 API 的 Workspace / Production 授权

文件 URL 保持 `/v1/workspaces/{id}/files`，但服务端以文件记录中的 `production_id` 判定归属。创建与列表通过请求中的 `production_id` 选择范围；省略参数或传 `workspace` 只列出 Workspace 文件，不再返回活动文件的混合列表。活动 ID 必须属于 URL 指定的 Workspace。文件 ID 操作重新读取归属并校验权限，不能通过修改参数绕过授权。

| 文件范围 | 列表、下载 | 创建、完成上传 | 软删除 |
| --- | --- | --- | --- |
| Workspace | active Member 及以上 | active Member 及以上 | active Admin/Owner |
| Production | 有效 `production.view` | 有效 `production.edit`，完成上传仅限原上传者 | 有效 `production.edit` |

Production 权限包含当前 Workspace 角色继承及有效的活动直接成员关系；仅加入活动的用户也可使用同一文件 API。活动权限过期、暂停或撤销后，新请求会重新授权。已签发的对象存储下载链接仍按现有五分钟有效期工作。

文件 DELETE 是软删除：文件、版本、附件关联和审计记录不会立即物理删除，并进入 30 天回收期。删除/解除关联时立即释放用户配额，但全部对象仍计入真实物理占用；恢复会再次校验当前权限和 Workspace 配额。回收期届满后 Worker 为每个版本执行可租约、可退避重试的物理清理；仅在对象删除成功后减少物理账本，文件、版本哈希、来源追溯和审计元数据仍保留。活跃文件的全部历史版本长期保留并计入配额；软删除时全部版本一起进入 30 天回收期。Production 副本是独立文件，不随来源删除，也不继承来源保留锁。历史上已删除的记录从迁移上线时重新获得至少 30 天宽限。

文件大小有两个不同口径：系统单件上限固定为十进制 `2,000,000,000` 字节；具体用途以后只能设置更小限制。Workspace 用户配额计算仍在使用的版本字节，创建上传会话时并发安全地预留，完成/拒绝/取消/软删除/恢复时结算或释放；独立活动副本单独计一次。物理安全上限则按正式、回收站、隔离、临时对象和未完成分段的对象内容字节计算，不代表云厂商账单或底层磁盘开销。生产部署必须配置 `FILES_WORKSPACE_PHYSICAL_MAX_BYTES`；对账发现孤儿对象、缺失引用或物理空间不足时会暂停该 Workspace 的新上传，不自动删除来源不明对象。

新上传不再签发无大小约束的 PUT：不超过 100,000,000 字节使用带内容长度策略的预签名 POST；更大的文件使用 64 MiB 分段上传。临时对象进入独立的 `S3_STAGING_BUCKET`，不可变正式版本仍保留在 `S3_BUCKET`。完成时服务端再核对大小、用途策略和分段 SHA-256，随后跨桶复制到不可变版本对象并等待 Worker 安全扫描。会话有效期 24 小时、签名链接最长 15 分钟；Worker 清理过期临时对象与未完成分段。Compose 只对临时桶配置两天生命周期兜底；旧 PUT 会话仍按其数据库记录中的原桶和有效期兼容处理。

`GET /v1/me/workspace-storage` 仅列出本人 active Workspace membership 的汇总，不返回文件名；用户配额默认不设限。平台运维使用 `storage-quota show --workspace <id>` 查询，使用 `storage-quota set --workspace <id> --bytes <字节数> --actor <操作者>` 或 `unset` 调整，并在 append-only 账本记录操作。文件类型归类、预览和公开表单上传不属于此阶段。

平台运维可通过 `docker compose exec api storage-retention check-storage` 确认正式桶和暂存桶均存在、分离且关闭对象版本控制。版本控制启用或暂停都会使普通删除无法代表对象字节已物理清除，因此 API 会关闭文件存储，Worker 会 fail-closed 停止清理和物理对账。`storage-retention show --workspace <id> [--file <id>]` 查询清理状态；`hold` / `release-hold` 为逻辑文件添加/解除应用级保留锁；`purge --confirm <file-id>` 申请提前清除软删除文件。变更都要求操作者、原因和案件/工单引用，并写入追加式账本。保留锁覆盖该文件所有及后续版本，不授予读取权限、不恢复用户配额；它不是对象存储 WORM，也不作法规合规承诺。`storage-quota show` 会另列被锁定的物理字节，用户配额与真实对象占用仍是不同指标。

文件版本、节目附件、统一授权动作及活动固定副本见 [文件版本与节目附件基座](file-attachments.md)；其他纵向模块的接入契约见[文件与附件模块接入契约](file-attachment-integration.md)。附件文件不进入上述独立文件库列表；分类不等于访问授权。

## Mock 移除检查

- API Repository 已通过鉴权、404/403、空列表场景的租户隔离集成测试（`backend/api/cmd/server/workspace_test.go` 与 `production_test.go`，设置 `DATABASE_URL` 运行；后者覆盖列表隔离、读隔离、父子伪造、角色权限、归档与时间/时区校验）。
- Workspace 切换失败不会改变当前路由（`switchWorkspace` 失败时保持原上下文）。
- Production 必须同时匹配 URL 中的 `workspaceId`，防止跨租户读取（后端 `requireProductionAccess` 已落实：先 `requireWorkspaceRole` 再校验父子关系）。
- 生产运行路径已切换到 `apiNavigationRepository`；`mockNavigationRepository` 仅保留给无后端预览。
- 「创建工作空间」「管理工作空间」「新建活动」已接入真实流程；全局搜索仍是占位，接入时继续使用共享 `notify` API 提供成功与失败反馈。
