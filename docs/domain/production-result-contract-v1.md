# Production Result Contract V1

状态：已冻结（2026-09-08）
范围：`ProductionProgram`、`ProductionPerson`、`ProductionRegistration`、`Requirement`、`ResourceCommitment`、`FormResponse`。

本文件描述 Campaign 决定之后写入 Production 的最小结果对象。结果对象保存活动级快照；Workspace 资源只是可选引用，不是公开 Entry 的直接写入目标。

## 1. 共同约定

- 所有对象都有 `id`、`workspace_id`、`production_id`、`created_by`、`created_at`、`updated_at`。
- 所有对象都必须满足 `(workspace_id, production_id)` 对 `productions` 的复合外键，禁止跨 Workspace 关联。
- 结果对象可以带 `source_entry_id`，用于追溯产生它的 Entry；完整转化审计仍以 `EntryMaterialization` 为准。
- 可变结果使用归档或状态变更，不物理删除业务审计链。
- 快照字段使用 JSONB；JSONB 只保存当时提交/确认的数据，不承担任意 SQL 或任意表映射。

## 2. 结果对象

### 2.1 ProductionProgram

活动中的节目实例。转化时必须复制节目名称、节目类型、演出者、时长、说明和技术备注；可以同时保存 `workspace_program_id`，但后续 Workspace `Program` 修改不得改变活动快照。

```json
{
  "id": "pprog_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "workspace_program_id": "prog_…",
  "source_entry_id": "ent_…",
  "source_kind": "submission",
  "name": "节目名称",
  "program_type_id": "ptype_…",
  "program_type_name": "独唱",
  "performers": [{ "display_name": "张三" }],
  "duration_seconds": 240,
  "description": "节目介绍",
  "technical_notes": "两只无线麦克风",
  "status": "confirmed"
}
```

`source_kind`：`manual`、`workspace_copy`、`submission`。
`status`：`draft`、`needs_info`、`confirmed`、`archived`。

### 2.2 ProductionPerson

活动级现实人员记录。一个人只建立一条活动记录，岗位通过 `roles` 多选保存；`workspace_person_id` 可为空，允许外部候选人先进入活动人员库。此对象不代表登录身份，也不授予任何 Workspace 或 Production 权限。

```json
{
  "id": "pperson_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "workspace_person_id": null,
  "source_entry_id": "ent_…",
  "display_name": "李四",
  "primary_email": "li@example.com",
  "primary_phone": "",
  "bio": "",
  "roles": ["摄影师", "导播"],
  "department": "影像",
  "status": "candidate"
}
```

`status`：`candidate`、`confirmed`、`withdrawn`、`archived`。
V1 不创建 `CrewAssignment`、`Position` 或 `Slot`。

### 2.3 ProductionRegistration

活动报名记录。每个 Entry 最多生成一条；报名主体可以是个人、团队或组织，但报名本身不自动创建或链接 `ProductionPerson`。

```json
{
  "id": "preg_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "entry_id": "ent_…",
  "subject_kind": "team",
  "subject_snapshot": {
    "name": "南宁高中合唱团",
    "contact_email": "team@example.com"
  },
  "participant_count": 24,
  "status": "confirmed",
  "notes": ""
}
```

`subject_kind`：`person`、`team`、`organization`。
`status`：`confirmed`、`waitlisted`、`cancelled`。

### 2.4 Requirement

活动级需求，表示“还需要什么”，不表示 Workspace 已有资产。可以保留可选候选引用，候选确认后再决定是否提升为长期资源。

```json
{
  "id": "req_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "source_entry_id": "ent_…",
  "kind": "equipment",
  "title": "无线麦克风",
  "description": "主持人使用",
  "quantity_requested": 2,
  "unit": "件",
  "due_at": "2026-09-20T10:00:00Z",
  "candidate_equipment_item_id": null,
  "status": "open",
  "notes": ""
}
```

`status`：`open`、`fulfilled`、`cancelled`。
可选候选引用字段为 `candidate_person_id`、`candidate_organization_id`、`candidate_venue_id`、`candidate_venue_space_id`、`candidate_equipment_item_id`、`candidate_file_id`。

### 2.5 ResourceCommitment

活动级承诺，表示某个人、组织或资源已经提出/确认提供什么。它与 Requirement 分开维护状态和审计。

```json
{
  "id": "commit_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "requirement_id": "req_…",
  "source_entry_id": "ent_…",
  "commitment_snapshot": {
    "provider_name": "张三",
    "resource_name": "Sony A7 IV"
  },
  "committed_person_id": null,
  "committed_organization_id": null,
  "committed_equipment_item_id": null,
  "quantity_committed": 1,
  "unit": "件",
  "status": "proposed",
  "notes": ""
}
```

`status`：`proposed`、`confirmed`、`declined`、`withdrawn`。
可选承诺引用字段为 `committed_person_id`、`committed_organization_id`、`committed_venue_id`、`committed_venue_space_id`、`committed_equipment_item_id`、`committed_file_id`。

### 2.6 FormResponse

通用收集的业务结果。每个 `COLLECTION` Entry 最多生成一条；答案是提交当时的不可变快照。

```json
{
  "id": "fresp_…",
  "workspace_id": "ws_…",
  "production_id": "prod_…",
  "campaign_id": "cmp_…",
  "entry_id": "ent_…",
  "form_version_id": "frmv_…",
  "schema_version": 1,
  "answers": { "vehicle_type": "商务车" },
  "status": "active",
  "redacted_at": null
}
```

`status`：`active`、`redacted`。匿名化后保留记录和关联审计，只清理个人答案、联系人和附件内容。

## 3. Materialization 规则

默认目标：

```text
REGISTRATION  → ProductionRegistration
SUBMISSION    → ProductionProgram
RECRUITMENT   → ProductionPerson
COLLECTION    → FormResponse
```

任何 Campaign 类型都可以显式配置 `Requirement` 或 `ResourceCommitment`。物化由 API 在同一事务中完成；`EntryMaterialization` 记录幂等键、目标类型、目标 ID、操作、状态和错误。重复请求不得创建重复结果。

招募转化不得隐式创建 `WorkspaceMembership` 或 `ProductionMembership`；报名转化也不得隐式把参与者写入 Workspace People。
