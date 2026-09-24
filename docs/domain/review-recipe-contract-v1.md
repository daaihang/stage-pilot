# ReviewRecipe 审核方案库契约 V1

状态：方案定义已冻结（2026-09-09）；单轮人工审核运行时按 P1 契约实施（2026-09-24）
范围：审核方案定义、版本快照、单轮人工审核运行时及其 Entry/Revision 关联。本文件不定义多轮、评分或补件执行引擎。

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

### P1 当前可运行范围

方案库可以继续保存未来模式，便于维护来源模板；但 Campaign Revision 只有满足下列全部条件时才能发布并公开收件：`MANUAL_DECISION`、恰好一个 `parallel` 轮次、`request_changes.enabled=false`、`feedback.kind=binary`、人工最终决定。审核人必须能解析，完成门槛必须大于零且不能高于可用审核人数。`any` 在运行时按 N=1 处理。

审核意见固定为 `recommend`、`do_not_recommend`、`no_opinion` 三选一，加必填 1–5000 字意见。反馈只表示审核建议，不改变 Entry 状态或 Decision。每次修订追加一条记录并通过 `supersedes_feedback_id` 指向当前意见；反馈绑定提交时固定的 `campaign_revision_id` 和 `entry_revision_id`。

公开提交事务同时创建一个 ReviewRun、每位有效审核人的任务和当前分配快照。Entry 绑定的 Campaign Revision、FormVersion 与 Entry 答案版本不能被后续发布或成员变化改写。`all` 的所需人数按已分配任务数计算；补充新任务会增加全员门槛。`at_least_n` 达标后，其他任务仍可提交反馈，直到最终决定关闭未完成任务。反馈和最终决定先锁 ReviewRun，因此竞态结果按事务取得锁的顺序确定。

如果成员在任务完成前失效，任务和已有意见保留；管理员须填写原因并手动改派。提交时可解析人数少于门槛时仍接受 Entry，ReviewRun 进入 `awaiting_assignment`，绝不自动降低门槛。`campaign.manage` 可补充任务或改派未完成任务；已提交反馈的任务不能改派。

### P1 API 与权限

```text
GET  /v1/me/review-tasks?status=pending|completed|all
GET  /v1/review-tasks/{taskId}
POST /v1/review-tasks/{taskId}/feedback
POST /v1/entries/{entryId}/review-tasks
POST /v1/entries/{entryId}/decisions
```

`campaign.view` 保持现有 Entry Inbox 的可见范围；`campaign.review` 允许有效 Production 成员处理当前分配给自己的任务；`campaign.manage` 与 `campaign.decide` 分别保护分配维护和最终决定，二者映射到 Workspace Owner/Admin、Producer、Editor。一个人可以同时承担审核与决定。`campaign.materialize` 独立保留且默认不授予；P1 没有转化 API。

最终决定要求运行达到门槛。唯一例外是无兼容运行的存量 Entry：必须显式使用遗留覆盖并填写原因，Decision 保存审计标记。迁移只为未决且兼容的记录回填带 `migration` 来源标记的任务；这类分配表示迁移时按当前配置解析，不是历史分配事实。不兼容记录进入 `blocked_unsupported`。

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

仍不实现评分执行、多轮审核、补件执行、申请人通知、Materialization API 或异步 Worker。
