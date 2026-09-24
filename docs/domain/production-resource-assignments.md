# 后续：Production Resource Assignments

本文件描述下一阶段，不对应当前表或 UI。

- `ProductionProgram`：活动中的节目实例，可引用 Program 或为活动级节目；保存顺序、实际时长、演出者和现场备注。
- `ProductionPerson` / Crew Assignment：引用 Person，保存本场岗位、部门、班次和职责；不改变 Workspace 系统权限。
- Venue Selection：活动选择具体 VenueSpace，而非只选 Venue。
- Equipment Allocation：活动分配 EquipmentItem 的数量；事务内校验同一时间范围内的库存可用量。

所有关联表都必须同时保存 `workspace_id` 并使用复合外键，防止跨租户资源引用。
