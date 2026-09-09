# Campaign / Form Intake Backend Contract V1

状态：已冻结（2026-09-09）
范围：`Campaign`、`CampaignTemplate`、`CampaignRevision`、`FormVersion`、`Entry`、`Decision`、`EntryMaterialization`，以及六类活动级结果对象 `ProductionProgram`、`ProductionPerson`、`ProductionRegistration`、`Requirement`、`ResourceCommitment`、`FormResponse`。
本文件只冻结契约，不代表数据库或 API 已经实现。

## 1. 设计原则

表单是填写界面，`Campaign` 才是一次有明确业务目的的收集。四种业务类型共用一套 Campaign：

```text
REGISTRATION  报名       “我/我们参加这场活动”
SUBMISSION    征集       “我提交一个节目、作品、方案或资料”
RECRUITMENT   招募       “我申请一个岗位、班次或职责”
COLLECTION    通用收集   “我提供这次运营需要的信息”
```

所有提交都先进入 `Entry` 暂存层。审核和决定不会直接写入 Workspace 资源表；通过后才通过显式、幂等的 `EntryMaterialization` 生成活动级结果。

## 2. 领域关系

```text
System CampaignTemplate
└── Workspace CampaignTemplate
    └── Campaign（属于一个 Production）
        ├── CampaignRevision（可编辑草稿 / 不可变发布快照）
        │   ├── FormVersion
        │   ├── AvailabilityPolicy（值对象）
        │   ├── ReviewRecipeVersion（来源引用）
        │   ├── ReviewWorkflow（ReviewRecipe 快照值对象）
        │   └── MaterializationPlan（值对象）
        └── Entry（固定关联提交时的 CampaignRevision）
            ├── EntryRevision / answers（追加式答案版本）
            ├── Decision（追加式决定历史，只有一个当前决定）
            └── EntryMaterialization（幂等转化记录，可有多个目标）
```

### 2.1 租户边界

- `Campaign`、`CampaignRevision`、`FormVersion`、`Entry`、`Decision`、`EntryMaterialization` 均必须能解析到 `workspace_id`。
- `Campaign` 同时保存 `production_id`；数据库关联使用 `(workspace_id, production_id)` 复合外键或等效服务端校验。
- Entry、审核、决定和转化查询必须同时校验 `workspace_id` 与父级 ID，不能只信任 URL 中的 ID。
- Workspace 的 `Person`、`Program`、`Venue`、`EquipmentItem`、`File` 是可被结果引用的长期资产，不是 Entry 的直接写入目标。

### 2.2 七个 V1 合约对象

以下字段名是 API 的 snake_case 形式。可变对象带 `id`、`created_at`、`updated_at`；追加式的 Revision、Decision 和 Materialization 以 `created_at` 为主。可归档对象使用 `archived_at`，不做物理删除。

#### Campaign

一次活动级的收集业务。

```json
{
  "id": "cmp_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "kind": "SUBMISSION",
  "name": "2026 青年音乐节节目征集",
  "description": "…",
  "status": "draft",
  "public_slug": "youth-music-festival-programs",
  "published_revision_id": null,
  "source_template_id": "tpl_…",
  "source_template_version": 3,
  "created_by": "usr_…",
  "created_at": "…",
  "updated_at": "…",
  "archived_at": null
}
```

`status`：`draft`、`published`、`paused`、`closed`、`archived`。Campaign 状态与 Production 生命周期独立；达到关闭时间或接收上限时由服务端转为 `closed`。

#### CampaignTemplate

系统或 Workspace 级的可复用起点。模板复制到 Campaign 时必须保存来源 ID 和版本，不实时继承。

```json
{
  "id": "tpl_…",
  "workspace_id": null,
  "scope": "system",
  "kind": "RECRUITMENT",
  "name": "工作人员招募",
  "description": "…",
  "status": "published",
  "latest_version": 4,
  "source_template_id": null,
  "created_by": null,
  "created_at": "…",
  "updated_at": "…"
}
```

`scope`：`system` 或 `workspace`。系统模板只读；Workspace 模板可以从系统模板、空白或已配置好的 Campaign 复制而来。模板版本包含完整的默认 Form、规则、审核配方、转化计划和展示配置，而不只是字段数组。

#### CampaignRevision

Campaign 的配置版本。草稿可编辑；发布后的 Revision 不可原地修改。

```json
{
  "id": "crev_…",
  "campaign_id": "cmp_…",
  "revision_no": 2,
  "status": "published",
  "form_version_id": "frmv_…",
  "availability_policy": {
    "visibility": "public",
    "opens_at": "2026-09-10T00:00:00Z",
    "closes_at": "2026-10-01T16:00:00Z",
    "submission_limit": 100,
    "per_actor_limit": 1,
    "capacity": 20,
    "target": 10,
    "waitlist_limit": 30,
    "close_behavior": "close_to_new_entries"
  },
  "review_recipe_version_id": "rrv_…",
  "review_workflow": {
    "schema_version": 1,
    "mode": "MULTI_STAGE_REVIEW",
    "rounds": [
      {
        "key": "qualification",
        "name": "资格筛选",
        "execution": "parallel",
        "reviewer_policy": { "source": "production_roles", "role_keys": ["producer"] },
        "completion": { "mode": "all" },
        "feedback": { "kind": "binary" }
      },
      {
        "key": "final",
        "name": "最终审核",
        "execution": "parallel",
        "reviewer_policy": { "source": "production_roles", "role_keys": ["producer"] },
        "completion": { "mode": "all" },
        "feedback": { "kind": "binary" }
      }
    ],
    "request_changes": { "enabled": true, "target": "same_round" },
    "final_decision": "manual"
  },
  "materialization_plan": {
    "primary_target": "production_program",
    "dedupe_policy": "review_before_link"
  },
  "change_note": "调整节目材料字段",
  "created_by": "usr_…",
  "created_at": "…",
  "published_at": "…"
}
```

`status`：`draft`、`published`、`superseded`、`archived`。同一 Campaign 同时最多存在一个可编辑 draft 和一个 published Revision。

Revision 编辑 API 使用完整 `FormVersion` 快照。读取、保存、校验和发布都会返回强 `ETag`；保存和发布必须携带匹配的 `If-Match`，缺失返回 `428 precondition_required`，过期返回 `412 revision_conflict`。校验接口返回结构化错误与警告；服务端校验通过后才可发布，发布会锁定 Revision 与 FormVersion。

规则值对象的约定：

- `visibility`：`public`、`workspace`、`invite_only`。
- `submission_limit` 是最多接收的 Entry 数；`capacity` 是最终录取/确认数量；`target` 只是运营目标；`waitlist_limit` 是候补数量上限，四者不能混用。
- `close_behavior`：`close_to_new_entries` 或 `accept_to_waitlist`。
- `review_recipe_version_id` 记录创建时所用的已发布 `ReviewRecipeVersion`；`review_workflow` 是复制到 Revision 的完整审核快照，也是运行时权威配置。方案后续升级不得改变历史 Revision。
- 新版本的 `review_workflow` 必须符合 [`review-recipe-contract-v1.md`](./review-recipe-contract-v1.md) 的 V1 结构。`AUTO_ACCEPT` 不需要审核轮次；其他模式必须在发布前解析出当前 Production 的成员或角色。旧 Revision 可以保留没有方案 ID 的 `legacy` 快照，但只能读取，不能直接发布。
- 轮次按顺序执行、轮次内部审核人并行；完成条件（`all`、`any`、`at_least_n`）与通过/拒绝决定分离。请求补件只能回到原轮次并产生新的 EntryRevision。
- `materialization_plan` 只能选择系统支持的目标和重复处理策略，不能提交任意表名、SQL 或脚本。

#### FormVersion

对外渲染所需的表单文档。draft Revision 关联的 FormVersion 可编辑；一旦发布就不可改变，新问题必须创建新的 Revision/FormVersion。

```json
{
  "id": "frmv_…",
  "schema_version": 1,
  "blocks": [
    { "id": "blk_intro", "type": "welcome", "title": "节目征集" },
    { "id": "blk_title", "type": "field", "field_key": "program_title" }
  ],
  "fields": [
    {
      "key": "program_title",
      "type": "text",
      "label": "节目名称",
      "required": true,
      "semantic_key": "PROGRAM_TITLE",
      "validation": { "max_length": 160 },
      "options": null
    }
  ],
  "logic_rules": [],
  "end_screen": { "kind": "message", "title": "提交成功" },
  "created_by": "usr_…",
  "created_at": "…"
}
```

`blocks` 是线性文档，可包含 `welcome`、`text`、`section`、`field`、`consent`、`upload`、`divider` 和 `end`。`fields` 中的 `semantic_key` 只对系统域字段使用；普通自定义字段不得直接映射到任意数据库表。V1 条件逻辑只允许回答条件驱动的显示、隐藏、必填和结束页跳转。

#### Entry

一份提交者正在填写或已经提交的暂存数据。Entry 永远固定 `campaign_revision_id`，以便历史提交可以解释当时看到的表单。

```json
{
  "id": "ent_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "campaign_id": "cmp_…",
  "campaign_revision_id": "crev_…",
  "status": "submitted",
  "respondent_user_id": null,
  "contact_email": "applicant@example.com",
  "submitted_at": "…",
  "last_activity_at": "…",
  "current_decision_id": null,
  "created_at": "…",
  "updated_at": "…"
}
```

答案放在追加式 `entry_revisions` 存储中，至少记录 `revision_no`、`answers`、`schema_version`、`created_at` 和提交来源。公开填写者不需要先注册 StagePilot；草稿恢复使用高熵、可撤销、可过期的 Entry access token，服务端只保存 hash。

`status`：`draft`、`submitted`、`in_review`、`needs_changes`、`accepted`、`waitlisted`、`rejected`、`withdrawn`、`converted`、`conversion_failed`。状态是当前投影，审核意见和决定历史不可覆盖。

#### Decision

对 Entry 的业务决定。决定记录追加写入；一个 Entry 只有一个当前有效决定，修正决定通过新记录 supersede 旧记录。

```json
{
  "id": "dec_…",
  "entry_id": "ent_…",
  "campaign_id": "cmp_…",
  "type": "accept",
  "reason": "材料完整",
  "supersedes_id": null,
  "decided_by": "usr_…",
  "decided_at": "…",
  "metadata": {}
}
```

`type`：`accept`、`waitlist`、`reject`、`request_changes`、`withdraw`、`cancel`。`Decision` 不直接创建人员、节目或成员权限；它只触发允许的 Materialization 计划。

#### EntryMaterialization

一次从已决定 Entry 生成或链接正式结果的幂等记录。

```json
{
  "id": "mat_…",
  "entry_id": "ent_…",
  "decision_id": "dec_…",
  "target_kind": "production_program",
  "operation": "create",
  "status": "succeeded",
  "idempotency_key": "ent_…:production_program:create",
  "target_id": "pprog_…",
  "error_code": null,
  "error_message": null,
  "requested_by": "usr_…",
  "created_at": "…",
  "started_at": "…",
  "completed_at": "…"
}
```

`target_kind` V1：`production_registration`、`production_program`、`production_person`、`requirement`、`resource_commitment`、`form_response`。V1 不包含 `crew_assignment`、`position` 或 `slot`；招募岗位信息暂存在 `ProductionPerson.roles` 与 `department`。`operation`：`create`、`link_existing`、`merge`、`skip`。
`status`：`pending`、`running`、`succeeded`、`failed`。服务端必须在事务中写入目标对象和成功记录；重复请求使用同一幂等键，不得重复创建。招募转化永远不会隐式创建 `WorkspaceMembership` 或 `ProductionMembership`。

### 2.3 结果目标映射

活动级结果对象的字段、状态和生命周期见 [`production-result-contract-v1.md`](./production-result-contract-v1.md)。Campaign 的默认目标映射为：

```text
REGISTRATION  → ProductionRegistration
SUBMISSION    → ProductionProgram
RECRUITMENT   → ProductionPerson
COLLECTION    → FormResponse
```

任何 Campaign 类型都可以在 `materialization_plan` 中显式配置 `Requirement` 或 `ResourceCommitment`。结果对象始终先保留活动级快照；对 Workspace `Person`、`Program`、`Venue`、`EquipmentItem`、`File` 的引用是可选链接，不会因为转化自动修改长期资源库或权限。

## 3. 状态和不变量

### 3.1 发布和版本

1. Campaign 创建时可以从模板复制，也可以空白创建；保存 `source_template_id` 与 `source_template_version`。
2. 一个 Campaign 最多一个可编辑草稿 Revision 和一个当前发布 Revision。
3. 发布前必须执行服务端校验：字段 key 唯一、语义字段类型兼容、逻辑无循环/死路、必填字段可达、时间和容量规则一致、公开上传有限制、审核负责人可执行、转化目标受支持。
4. 发布后的 CampaignRevision/FormVersion 不可更新。修改会产生新 Revision；旧 Entry 继续绑定旧 Revision。

### 3.2 Entry 和决定

1. 只有 `published` CampaignRevision 接受新的 submitted Entry；草稿 Entry 可以继续保存，但 Revision 失效时必须返回“表单版本已更新”，不能静默改变问题含义。
2. `Entry`、审核反馈和 `Decision` 都必须可追溯到 Campaign、Production、Workspace 和 Revision。
3. `request_changes` 后允许提交新的 EntryRevision；不能删除旧答案。
4. `accept`、`waitlist`、`reject` 等决定不会自动等价于转化成功；转化状态由 EntryMaterialization 单独记录。

### 3.3 租户、隐私和附件

1. 管理 API 只允许 Production 可访问成员调用；Workspace OWNER/ADMIN 具备完整治理权限。
2. V1 权限能力键冻结为：`campaign.view`、`campaign.manage`、`campaign.publish`、`campaign.review`、`campaign.decide`、`campaign.materialize`、`campaign.export`。初期可以映射到现有 `production.view` / `production.edit`，但 API 不应把它们混成一个概念。
3. 公开 API 只返回发布 Revision 中标记为 public 的内容，不返回审核、决定、内部备注或 Workspace 资源敏感字段；必须支持速率限制、重复提交限制和隐私同意记录。
4. 公开附件不能复用当前 Workspace 成员文件入口。上传 token 必须限定 Campaign、Entry 草稿、字段、字节数和过期时间，并保留扫描/隔离状态。

## 4. V1 API 表面

列表响应沿用现有约定：`{ "items": [], "next_cursor": null, "total": 0 }`。错误响应沿用 `{ "code": "…", "message": "…" }`。

### 4.1 管理端 API

```text
GET    /v1/productions/{productionId}/campaigns
POST   /v1/productions/{productionId}/campaigns
GET    /v1/campaigns/{campaignId}
PATCH  /v1/campaigns/{campaignId}

GET    /v1/campaign-templates?scope=system&kind=…
GET    /v1/workspaces/{workspaceId}/campaign-templates?kind=…
POST   /v1/workspaces/{workspaceId}/campaign-templates
GET    /v1/campaign-templates/{templateId}
POST   /v1/campaign-templates/{templateId}/versions

GET    /v1/review-recipes?status=…
GET    /v1/workspaces/{workspaceId}/review-recipes?status=…
GET    /v1/review-recipes/{recipeId}/versions

GET    /v1/campaigns/{campaignId}/revisions
POST   /v1/campaigns/{campaignId}/revisions
GET    /v1/campaigns/{campaignId}/revisions/{revisionId}
PATCH  /v1/campaigns/{campaignId}/revisions/{revisionId}
POST   /v1/campaigns/{campaignId}/revisions/{revisionId}/validate
POST   /v1/campaigns/{campaignId}/revisions/{revisionId}/publish

GET    /v1/campaigns/{campaignId}/entries
GET    /v1/entries/{entryId}
POST   /v1/entries/{entryId}/decisions
GET    /v1/entries/{entryId}/materializations
POST   /v1/entries/{entryId}/materializations
```

`POST` 创建 Campaign、Revision、Decision 和 Materialization 时支持 `Idempotency-Key`；批量决定/转化在 V1 仍复用单条语义并由服务端逐项返回结果。

### 4.2 公开填写 API

```text
GET    /v1/public/campaigns/{publicSlug}
POST   /v1/public/campaigns/{publicSlug}/entries
PATCH  /v1/public/entries/{entryAccessToken}
GET    /v1/public/entries/{entryAccessToken}
POST   /v1/public/entries/{entryAccessToken}/withdraw
```

公开 token 只在创建/恢复时返回一次；服务端保存 hash，响应禁止缓存。公开接口必须在服务端重新读取当前已发布 Revision 并执行所有校验，不能信任客户端携带的 `workspace_id`、`production_id`、`campaign_revision_id` 或结果目标。

## 5. 数据库落地边界

七个合约对象建议落地为以下聚合表；带“内部存储”的表不是额外的产品聚合 API：

```text
campaign_templates
campaign_template_versions       内部版本存储
campaigns
campaign_revisions
form_versions
entries
entry_revisions                  内部答案版本存储
decisions
entry_materializations
production_programs
production_people
production_registrations
requirements
resource_commitments
form_responses
```

所有表采用现有 TEXT ID、UTC 时间戳、软删除/归档和 Workspace 复合约束风格。`entry_revisions.answers`、`form_versions.blocks/fields/logic_rules`、Revision 中三个策略值对象使用 JSONB，但必须有服务端 schema 校验和版本号，不能把 JSONB 当作无约束扩展点。

## 6. V1 不做的事

- 不允许管理员写任意脚本、SQL、跨 Campaign 自动化或任意数据库映射。
- 不从普通 Collection 自动创建 Workspace 长期资产；先生成活动级 Requirement/ResourceCommitment 或 FormResponse。
- 不把现实人员、登录用户、审核人和 Workspace/Production 成员合并成一张表。
- 不把公开大文件、转码、病毒扫描、支付和外部官网同时纳入本次实现；公开附件安全链路必须先有最小可用版本。

## 7. 实现顺序

1. 新增活动结果迁移，再新增 Campaign/Entry 迁移和服务端模型：Template、Campaign、Revision、FormVersion、Entry、Decision、Materialization 及六类结果对象。
2. 先实现管理端 Campaign/Revision/Entry API 及租户、权限、发布校验、幂等约束。
3. 再实现公开读取、草稿/提交、Entry access token 和受限附件。
4. 前端把当前静态页面替换为 Campaign/Template API；Form Builder 只编辑 draft Revision。
5. 最后接入审核分配、评分和正式 Production 结果模型；每种结果都必须通过 EntryMaterialization。
