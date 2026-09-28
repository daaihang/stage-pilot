# Select 使用规范

业务代码统一使用 `@/components/ui/select` 提供的 shadcn/Base UI `Select.Root`。每个 Root 必须显式传入完整的 `items` 映射，数据形状为 `{ value, label, disabled? }`；`value` 保持既有 API/表单契约，`label` 只负责展示用户可读名称。

## 完整选项映射

- `items` 是所选值到展示名称的权威映射，不是弹层当前可见项的副本。
- 搜索、筛选、分组或权限视图可以缩小 `Select.Content` 中渲染的项目，但不得缩小 Root 的完整映射。当前值暂时被过滤时仍显示原标签。
- 静态值也必须显式映射，例如状态、排序字段、“未指定”和“无”。禁止把数据库 ID、枚举内部码或 `user_id` 当作展示文案。
- Root 映射与 `SelectItem` 应使用相同的 value/label。禁用项目在两边都标记为 `disabled`。

## 动态、异步与失效值

对异步实体或可能停用/删除的选项，使用 `resolveSelectItems`（`@/lib/select-options`）构建 Root 映射：

```jsx
const resolved = resolveSelectItems(
  activePeople.map((person) => ({ value: person.id, label: person.name })),
  { value: selectedPersonId, loading: peopleLoading, selectedLabel: cachedPersonName },
);

<Select items={resolved.items} value={selectedPersonId} onValueChange={setSelectedPersonId}>
  <SelectTrigger><SelectValue placeholder="选择人员" /></SelectTrigger>
  <SelectContent>
    {resolved.items.map((item) => (
      <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
        {item.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

- 加载中保留选中值；优先使用已知缓存名称，否则显示“正在加载选项…”，不能把暂时缺失判为失效。
- 加载完成后，当前值若已停用或不存在，保留该值并显示已知名称（已停用）或“选项不可用”；对应旧项禁用，用户可另选可用项。
- 不要因搜索过滤、异步刷新或选项停用而静默清空受控值。若该值不可再用于提交，应在提交校验中明确阻止并提示用户改选。
- `resolveSelectItems` 返回的 `items` 同时用于 Root 和弹层，确保失效值在弹层中也有明确的禁用说明。

## 防回归

`pnpm --filter @stagepilot/desktop test:select-options` 检查 Root 是否提供显式映射，并验证完整映射、加载中保留值、停用/未知值兜底。新增动态 Select 时，应补充纯函数或组件测试覆盖当前选中值缺失的情况。基础 Select 实现位于 `src/components/ui`，不在业务扫描范围内。
