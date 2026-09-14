# ReviewRecipe 审核方案库契约 V1

状态：已冻结（2026-09-09）
范围：审核方案定义、版本快照、Campaign/Revision 的来源引用和发布前置校验。本文件不定义运行时审核任务或工作流引擎。

## 1. 设计目标

审核是表单收集之后的可复用策略，不是任意可编程的流程图。方案采用三层结构：

```text
ReviewRecipeTemplate       可复用方案名称与租户归属
        ↓
ReviewRecipeVersion         不可变、可发布的 JSON 定义
        ↓
CampaignRevision.review_workflow
                             创建时复制的运行时快照
```

模板或版本之后的修改不得影响已经创建的 Campaign、已发布 Revision 或历史 Entry。`review_recipe_version_id` 只记录来源；`review_workflow` 快照才是未来运行时的权威配置。

系统方案属于 StagePilot、只读且全局可见；工作空间方案只对该 Workspace 成员可见。工作空间方案不能引用其他 Workspace 的版本。

## 2. ReviewRecipeTemplate 与 Version

`ReviewRecipeTemplate` 的核心字段：

```text
id, scope(system|workspace), workspace_id?, key, name, description
status(draft|published|archived), latest_version, source_template_id?
created_by, created_at, updated_at, archived_at?
```

`ReviewRecipeVersion` 保存不可变定义：

```text
template_id, workspace_id, version, schema_version(1), definition(JSONB)
created_by, created_at, published_at?
```

已发布版本禁止原地更新或删除。Workspace Owner/Admin 可以从系统方案或已发布 Workspace 方案复制出 Draft，编辑后发布；每个方案最多一个 Draft。Workspace 方案只保存可复用的 `production_roles`，具体活动成员必须在 Campaign 内配置。普通 Workspace Member 只能查看已发布方案。

## 3. 固定的 V1 定义

```json
{
  "schema_version": 1,
  "mode": "AUTO_ACCEPT | MANUAL_DECISION | SCORED_REVIEW | MULTI_STAGE_REVIEW",
  "rounds": [
    {
      "key": "qualification",
      "name": "资格筛选",
      "execution": "parallel",
      "reviewer_policy": {
        "source": "explicit_members | production_roles",
        "member_ids": [],
        "role_keys": []
      },
      "completion": { "mode": "all | any | at_least_n", "n": 1 },
      "feedback": { "kind": "binary | score" },
      "scorecard": {
        "criteria": [
          { "key": "quality", "label": "内容质量", "description": "", "scale_min": 1, "scale_max": 5, "weight": 100 }
        ]
      }
    }
  ],
  "request_changes": { "enabled": true, "target": "same_round" },
  "final_decision": "manual | auto_accept"
}
```

语义不变量：

- `AUTO_ACCEPT` 不包含审核轮次，`final_decision` 必须为 `auto_accept`。
- `MANUAL_DECISION` 至少一轮人工审核；`SCORED_REVIEW` 至少一轮 `feedback.kind=score`；`MULTI_STAGE_REVIEW` 至少两轮。
- 轮次按数组顺序串行推进；同一轮的审核人并行工作。`execution` V1 固定为 `parallel`。
- `all`、`any`、`at_least_n` 只表示本轮审核任务的完成条件，不表示通过或拒绝；最终结果由独立 `Decision` 决定。
- `explicit_members` 指定当前 Production 成员；`production_roles` 指定当前 Production 已存在的角色。角色成员在未来每轮启动时解析，并保存当时的审核人快照。
- 发布前必须能解析所有审核人；草稿可以暂时没有审核人，以便先编辑参数。
- 评分标准随版本保存，`weight` 必须为正数且总和为 100；量表上下限必须有效。
- `request_changes.target` V1 只能为 `same_round`。补件通过新的 EntryRevision 返回原轮次，不覆盖旧审核意见。
- 不允许脚本、任意条件图、BPMN 节点、跨 Campaign 跳转或用户自定义执行器。

## 4. 内置方案

系统提供以下只读模板及 v1 版本：

```text
review_recipe_auto_accept          无审核 / 自动确认
review_recipe_single_manual        单轮人工审核
review_recipe_parallel_panel       单轮平行审核
review_recipe_multi_stage          多轮顺序审核
review_recipe_multi_stage_scored   多轮评分审核
```

现有系统 Campaign 模板默认来源映射：

```text
节目征集       → review_recipe_multi_stage_scored
工作人员招募   → review_recipe_single_manual
普通活动报名   → review_recipe_auto_accept
通用信息收集   → review_recipe_auto_accept
```

平行审核不是独立引擎类型，而是同一轮内多个审核人并行；多轮审核只表示多个轮次顺序推进。

## 5. Campaign 与 Revision 规则

创建 Campaign 或草稿 Revision 时，审核配置解析优先级为：

1. 请求中的完整 `review_workflow`；
2. 请求中的 `review_recipe_version_id`；
3. 当前已发布 Revision 的快照；
4. `review_recipe_auto_accept` v1。

服务端必须校验方案版本属于系统或当前 Workspace、状态为 `published`，并校验快照符合本文件结构及当前 Production 的成员/角色。`review_recipe_version_id` 可为空以兼容旧的 `legacy` Revision；legacy 快照只能读取，不能作为新的可发布版本。

发布 Revision 时必须在同一事务中锁定 Campaign/Revision，执行表单、开放规则、结果映射和 ReviewRecipe 语义校验；归档 Campaign 不可发布。发布后 Revision 和 FormVersion 均不可原地编辑，修改必须新建 Revision。

## 6. API

```text
GET /v1/review-recipes?status=
GET /v1/workspaces/{workspaceId}/review-recipes?status=
GET /v1/review-recipes/{recipeId}/versions
GET /v1/review-recipes/{recipeId}
GET /v1/review-recipes/{recipeId}/versions/{versionId}
POST /v1/workspaces/{workspaceId}/review-recipes
PATCH /v1/review-recipes/{recipeId}
POST /v1/review-recipes/{recipeId}/versions
PATCH /v1/review-recipes/{recipeId}/versions/{versionId}
POST /v1/review-recipes/{recipeId}/versions/{versionId}/publish
```

返回统一 `{items, next_cursor, total}`。系统方案全局可见；Workspace 方案和其版本遵守现有 Workspace 成员校验。模板/方案创建、复制、创建版本支持 `Idempotency-Key`；草稿更新和发布使用 `If-Match`，冲突返回 `412`。归档后不能用于新的 Campaign 或 Revision。

本阶段不实现公开 Entry 提交、ReviewRun/Assignment/Feedback、评分执行、补件执行、Decision/Materialization API 或异步 Worker。
