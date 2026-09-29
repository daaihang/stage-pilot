# 表单提交后处理与 ReviewRecipe 契约 V1

状态：2026-09-29。四种处理方式均可发布和公开收件；审核配方只参与“单轮审核后人工决定”路径。

## 处理方式（稳定标识）

| 标识 | 新 Entry 与执行 | 权限 | 容量与收件 |
|---|---|---|---|
| `COLLECT_ONLY` 仅收集 | `submitted`；不创建 ReviewRun、任务或 Decision | `campaign.view` 查看 | 开放时间、总提交上限、每邮箱次数约束收件；接受容量和候补不适用 |
| `DIRECT_MANUAL_DECISION` 免评审、人工决定 | `submitted`；不创建 ReviewRun、审核任务或初始 Decision | `campaign.decide` 直接接受、候补、拒绝或修正 | 收件不受接受容量约束；决定时检查接受容量、候补开关和候补上限 |
| `MANUAL_DECISION` 单轮审核后决定 | `in_review`；原子创建 ReviewRun 和审核任务；达到反馈门槛后由人工决定 | 当前任务分配者凭 `campaign.review` 反馈；`campaign.manage` 维护分配；`campaign.decide` 作决定 | 收件上限在提交时检查；接受/候补上限在决定时检查 |
| `AUTO_ACCEPT` 自动接受 | 同一提交事务创建系统主体 Decision，Entry 为 `accepted`；不建 ReviewRun 或审核任务 | `campaign.decide` 可追加人工修正；每次修正必须填写原因 | 提交时检查接受容量；满额返回冲突、不创建 Entry、不自动候补；公开 GET 显示不可提交 |

`AUTO_ACCEPT` 是自动作出最终结果，**不是**公开页的中性“已收到提交”回执。系统 Decision 使用 `actor_type=system`、空 `decided_by`，并记录自动化标识、公开提交触发源及 Campaign Revision；后续人工决定通过 supersede 链追加，绝不覆盖系统历史。四种稳定标识互斥且均出现在处理方式选择器；审核来源与参数只在单轮人工审核模式下执行，其他模式保留的快照不参与校验或运行。截止后集中审核、通知、评分、多轮、补件和 Materialization 仍不在当前运行时内。

## 当前可运行的不可变系统版本

当前目录只有 `review_recipe_single_manual` 的已发布 v2 可选：

```json
{
  "schema_version": 1,
  "mode": "MANUAL_DECISION",
  "rounds": [{
    "key": "review", "name": "单轮审核", "execution": "parallel",
    "reviewer_policy": { "source": "explicit_members", "member_ids": [], "role_keys": [] },
    "completion": { "mode": "all" }, "feedback": { "kind": "binary" }
  }],
  "request_changes": { "enabled": false, "target": "same_round" },
  "final_decision": "manual"
}
```

系统模板、空白 Campaign 和空白表单模板复制该版本，审核人保持空白。活动发布前，操作者必须明确选择有效 Production 成员或角色；模板不能绑定具体活动成员，只保存可复用的 Production 角色，应用到活动后可再指定成员。全部完成是默认门槛，也可设至少 N 人（原 `any` 等价 N=1），N 不得大于可解析人数。评审反馈由建议 `recommend` / `do_not_recommend` / `no_opinion` 和必填文字意见构成，不自动改变 Entry 结果。审核人失效时任务保留，管理员按原因改派；提交时人数不足不会降低门槛。

原 v1 内置方案版本保留以满足外键和历史快照，但自动确认、平行、评分和多轮模板在目录中归档；单轮模板的 v1 也不再是当前发布版本。系统版本只读，发布后不可原地修改。四个系统表单模板均在原 v2 基础上追加 v3，并指向单轮方案 v2；节目 Demo 改为必填 URL，招募岗位偏好改为文本。历史版本不修改。

## 来源、快照与隔离

```text
ReviewRecipeVersion（已发布的系统来源）
    → CampaignTemplateVersion.review_recipe_version_id + definition.review_workflow
    → CampaignRevision.review_recipe_version_id + review_workflow
    → Entry.campaign_revision_id + EntryRevision / ReviewRun
```

来源版本 ID 是出处；模板和 Campaign Revision 各自保存**完整独立快照**，实际执行只读 Entry 固定的 Campaign Revision。模板或系统方案后续升级，不重写已发布 Revision、Entry、任务或意见。新建 Campaign 的明确优先级是：请求内完整 `review_workflow`、请求内指定的来源版本、模板自己的工作流快照、工作空间默认方案。模板快照不得被它链接的来源版本无意覆盖。

单轮人工审核草稿可以没有审核人，但草稿校验和发布必须指出缺少已发布来源、有效审核人或不可达门槛。只有该模式校验单轮审核快照；其他三种方式忽略其保留的审核配置。四种模式都校验表单、开放策略及适用的收件限制。`campaign.review`、`campaign.manage`、`campaign.decide` 在每个请求上分别授权，`campaign.materialize` 当前仍未开放。

## 工作空间有效目录

工作空间不拥有可编辑的审核方案副本。`workspace_settings.enabled_review_recipe_keys` 保存允许选择的稳定系统方案 key，`default_review_recipe_key` 必须属于该非空目录。当前只有 `single_manual` 可运行，因此它是必选默认项；目录 API 只返回当前已发布且符合单轮执行契约的系统版本，不暴露草稿、归档或未实现方式。

```text
GET   /v1/workspaces/{id}/review-catalog  工作空间成员可读
PATCH /v1/workspaces/{id}/settings        Owner/Admin 可更新目录和默认 key
```

更新会原子校验目录非空、key 全部可运行、默认 key 属于目录。模板编辑器与活动表单编辑器都读取该目录。新选择绑定当前已发布版本；草稿若引用某 key 的旧不可变来源版本，只要该 key 仍在目录中，仍可发布。若 key 被停用，活动或模板的新版本必须切换到允许项。

目录变化仅影响后续选择和发布，不追溯重写或撤销已发布活动 Revision、模板快照、Entry 或审核任务。已发布模板即使来源 key 后续停用，仍可查看和复制；其副本必须在发布前改为当前允许的来源。表单模板继续负责复用完整表单与审核参数；它保存自己的来源版本 ID 和定义快照，不是工作空间级方案库。

工作空间审核方案写入路由和方案库编辑器已移除；历史方案表、记录和外键保留，不做破坏性清理。系统方案仍通过只读目录及只读来源查询使用。

## 当前单轮运行时

公开提交在 Campaign 行锁下核对预期 Revision、幂等键、开放和收件次数规则；相同的成功请求先于 Revision 检查回放。`COLLECT_ONLY` 与 `DIRECT_MANUAL_DECISION` 在同一事务创建 `submitted` Entry 和 EntryRevision，不创建 ReviewRun；前者不支持决定，后者由 `campaign.decide` 直接作决定。`AUTO_ACCEPT` 在同一事务检查容量并创建 `accepted` Entry、EntryRevision、系统 Decision 及当前决定指针；GET 的满额提示只是预检，竞态中的 POST 仍会返回容量冲突且不留下半成品。`MANUAL_DECISION` 在同一事务创建 `in_review` Entry、EntryRevision、ReviewRun 和当前有效审核人的任务。相同请求幂等重放不重复建任务或系统决定。ReviewRun 保存 Revision、答案版本、完成门槛和分配快照。达到门槛后未完成任务仍可反馈；最终 Decision 提交后关闭它们。反馈、改派和决定按 ReviewRun 行锁串行化；意见修订和 Decision 修正只追加历史，不覆盖旧记录。

当前 API：

```text
GET  /v1/review-recipes?status=published
GET  /v1/review-recipes/{recipeId}/versions
GET  /v1/workspaces/{id}/review-catalog
GET  /v1/me/review-tasks
GET  /v1/review-tasks/{taskId}
POST /v1/review-tasks/{taskId}/feedback
POST /v1/entries/{entryId}/review-tasks
POST /v1/entries/{entryId}/decisions
```

工作空间审核方案写入 API 已退役。审核任务与管理员 Entry 收件箱是两个视角：前者处理“分配给我”的意见，后者管理分配、门槛和最终决定。
