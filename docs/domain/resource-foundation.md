# Workspace Resource Foundation

资源库是 Workspace 的长期资产层，不属于任何单一活动。所有资源行携带 `workspace_id`，服务端以 active `WorkspaceMembership` 授权；`OWNER`/`ADMIN` 可写，`MEMBER` 只读。

资源具有 `active`/`archived` 业务状态及 `deleted_at` 软删除。列表默认排除软删除记录。未来所有 Production 关联必须使用 `(workspace_id, id)` 复合外键，禁止只用资源 ID 关联。

首版资源是 Programs、People、Organizations、Venues/Spaces 与 Equipment Items。通用自定义字段、全局标签及活动资源分配不在本阶段范围内。

列表 API 返回 `{ items, next_cursor, total }`，支持白名单筛选；同字段多值为 OR，不同筛选字段为 AND。
