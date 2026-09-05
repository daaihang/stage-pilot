import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Building2, GripVertical, ListMusic, MapPin, Package, Pencil, Plus, RefreshCw, Trash2, UsersRound } from "@/components/ui/icons";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { ResourcePage } from "@/components/resource-page";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { createResourceType, deleteResourceType, listResourceTypes, reorderResourceTypes, updateResourceType } from "@/lib/resource-api";
import { roleAtLeast } from "@/lib/workspace-api";
import { useUserPreferences } from "@/components/user-preferences-provider";
import { formatInstantInTimeZone } from "@/lib/timezone";

export const ResourceTypeDefinition = Object.freeze({
  programs: {
    resourceType: "programs",
    title: "节目类型",
    description: "管理当前工作空间的节目类型、排序和使用情况。",
    resourceLabel: "节目",
    typeField: "program_type_id",
    icon: ListMusic,
    initialColor: "#2563eb",
    usageCountField: "program_count",
    usageQuery: (usage) => (usage === "all" ? {} : { has_programs: usage === "used" ? "true" : "false" }),
    sortOptions: [["sort_order", "排序位置"], ["name", "名称"], ["program_count", "节目数量"], ["updated_at", "更新时间"]],
    api: { list: (workspaceId, filters) => listResourceTypes(workspaceId, "programs", filters), create: (workspaceId, payload) => createResourceType(workspaceId, "programs", payload), update: (workspaceId, id, payload) => updateResourceType(workspaceId, "programs", id, payload), reorder: (workspaceId, items) => reorderResourceTypes(workspaceId, "programs", items), remove: (workspaceId, id, options) => deleteResourceType(workspaceId, "programs", id, options) },
    deletePolicy: "program",
  },
  venues: {
    resourceType: "venues",
    title: "场地类型",
    description: "管理当前工作空间的场地类型、排序和使用情况。",
    resourceLabel: "场地",
    typeField: "venue_type_id",
    icon: MapPin,
    initialColor: "#64748b",
    usageCountField: "venue_count",
    usageQuery: () => ({}),
    sortOptions: [["sort_order", "排序位置"], ["name", "名称"], ["venue_count", "场地数量"], ["updated_at", "更新时间"]],
    api: { list: (workspaceId, filters) => listResourceTypes(workspaceId, "venues", filters), create: (workspaceId, payload) => createResourceType(workspaceId, "venues", payload), update: (workspaceId, id, payload) => updateResourceType(workspaceId, "venues", id, payload), reorder: (workspaceId, items) => reorderResourceTypes(workspaceId, "venues", items), remove: (workspaceId, id, options) => deleteResourceType(workspaceId, "venues", id, options) },
    deletePolicy: "venue",
  },
  people: {
    resourceType: "people",
    title: "人员类型",
    description: "管理当前工作空间的人员类型、排序和使用情况。",
    resourceLabel: "人员",
    typeField: "person_type_id",
    icon: UsersRound,
    initialColor: "#2563eb",
    usageCountField: "person_count",
    usageQuery: (usage) => (usage === "all" ? {} : { has_people: usage === "used" ? "true" : "false" }),
    sortOptions: [["sort_order", "排序位置"], ["name", "名称"], ["person_count", "人员数量"], ["updated_at", "更新时间"]],
    api: { list: (workspaceId, filters) => listResourceTypes(workspaceId, "people", filters), create: (workspaceId, payload) => createResourceType(workspaceId, "people", payload), update: (workspaceId, id, payload) => updateResourceType(workspaceId, "people", id, payload), reorder: (workspaceId, items) => reorderResourceTypes(workspaceId, "people", items), remove: (workspaceId, id, options) => deleteResourceType(workspaceId, "people", id, options) },
    deletePolicy: "unassign",
  },
  organizations: {
    resourceType: "organizations",
    title: "机构类型",
    description: "管理当前工作空间的机构类型、排序和使用情况。",
    resourceLabel: "机构",
    typeField: "organization_type_id",
    icon: Building2,
    initialColor: "#7c3aed",
    usageCountField: "organization_count",
    usageQuery: (usage) => (usage === "all" ? {} : { has_organizations: usage === "used" ? "true" : "false" }),
    sortOptions: [["sort_order", "排序位置"], ["name", "名称"], ["organization_count", "机构数量"], ["updated_at", "更新时间"]],
    api: { list: (workspaceId, filters) => listResourceTypes(workspaceId, "organizations", filters), create: (workspaceId, payload) => createResourceType(workspaceId, "organizations", payload), update: (workspaceId, id, payload) => updateResourceType(workspaceId, "organizations", id, payload), reorder: (workspaceId, items) => reorderResourceTypes(workspaceId, "organizations", items), remove: (workspaceId, id, options) => deleteResourceType(workspaceId, "organizations", id, options) },
    deletePolicy: "unassign",
  },
  equipment: {
    resourceType: "equipment",
    title: "设备类型",
    description: "管理当前工作空间的设备类型、排序和使用情况。",
    resourceLabel: "设备",
    typeField: "equipment_type_id",
    icon: Package,
    initialColor: "#64748b",
    usageCountField: "equipment_count",
    usageQuery: (usage) => (usage === "all" ? {} : { has_equipment: usage === "used" ? "true" : "false" }),
    sortOptions: [["sort_order", "排序位置"], ["name", "名称"], ["equipment_count", "设备数量"], ["updated_at", "更新时间"]],
    api: { list: (workspaceId, filters) => listResourceTypes(workspaceId, "equipment", filters), create: (workspaceId, payload) => createResourceType(workspaceId, "equipment", payload), update: (workspaceId, id, payload) => updateResourceType(workspaceId, "equipment", id, payload), reorder: (workspaceId, items) => reorderResourceTypes(workspaceId, "equipment", items), remove: (workspaceId, id, options) => deleteResourceType(workspaceId, "equipment", id, options) },
    deletePolicy: "unassign",
  },
});

const statusFilter = {
  id: "status",
  label: "状态",
  type: "select",
  defaultOperator: "is_any_of",
  options: [{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }],
};

function filterValues(query, field) {
  return getResourceFilterConditions(query).find((item) => item.field === field && item.operator === "is_any_of")?.values?.filter(Boolean) || [];
}

function filterState(query) {
  const status = filterValues(query, "status");
  const usage = filterValues(query, "usage");
  return { status: status.length === 1 ? status[0] : "all", usage: usage.length === 1 ? usage[0] : "all" };
}

function displayPosition(value) {
  const position = Number(value);
  return Number.isInteger(position) && position >= 0 ? position + 1 : 1;
}

function formatDate(value, timezone) {
  return value ? (formatInstantInTimeZone(value, timezone) || "-") : "-";
}

function errorDescription(error, definition) {
  if (!error) return "请求失败";
  const count = error[definition.usageCountField];
  return count != null ? `${error.message || "请求失败"}（${count} 个${definition.resourceLabel}）` : error.message || String(error);
}

function gridClassName(canWrite) {
  const columns = canWrite
    ? "grid-cols-[1.75rem_0.75rem_2rem_minmax(0,1fr)_4rem_5rem_4.5rem] sm:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_6rem_4.5rem] md:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_6rem_6rem_4.5rem] lg:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_6rem_7rem_6rem_4.5rem]"
    : "grid-cols-[1.75rem_0.75rem_2rem_minmax(0,1fr)_4rem_5rem] sm:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_6rem] md:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_6rem_6rem] lg:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_6rem_7rem_6rem]";
  return `grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 ${columns}`;
}

export function ResourceTypeDialog({ definition, workspaceId, open, onOpenChange, item, onSaved }) {
  const [form, setForm] = useState({ name: "", color: definition.initialColor, is_active: true, sort_order: 1 });
  const [busy, setBusy] = useState(false);
  const editing = Boolean(item);
  const systemDefault = Boolean(item?.is_system_default);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? { name: item.name, color: item.color || definition.initialColor, is_active: Boolean(item.is_active), sort_order: displayPosition(item.sort_order) }
      : { name: "", color: definition.initialColor, is_active: true, sort_order: 1 });
    setBusy(false);
  }, [definition, item, open]);

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const color = form.color.trim();
    const displaySortOrder = Number(form.sort_order);
    if ([...name].length < 1 || [...name].length > 120) return notify.error(`${definition.title}名称必须为 1–120 个字符`);
    if (!/^#[0-9a-f]{6}$/i.test(color)) return notify.error("颜色必须是 #RRGGBB 格式");
    if (!Number.isInteger(displaySortOrder) || displaySortOrder < 1) return notify.error("排序位置必须是正整数");
    if (systemDefault) {
      const originalSortOrder = displayPosition(item.sort_order);
      if (name !== item.name || color.toLowerCase() !== String(item.color || definition.initialColor).toLowerCase() || displaySortOrder !== originalSortOrder) {
        return notify.error(`系统默认${definition.resourceLabel}类型不能修改`);
      }
      if (!form.is_active) return notify.error(`系统默认${definition.resourceLabel}类型不能停用，只能启用`);
    }

    const toast = notify.loading(editing ? `正在保存${definition.title}…` : `正在创建${definition.title}…`);
    setBusy(true);
    try {
      const payload = { name, color, is_active: Boolean(form.is_active), sort_order: displaySortOrder - 1 };
      const saved = editing
        ? await definition.api.update(workspaceId, item.id, payload)
        : await definition.api.create(workspaceId, payload);
      notify.success(editing ? `${definition.title}已保存` : `${definition.title}已创建`, { id: toast });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (error) {
      notify.error(editing ? `保存${definition.title}失败` : `创建${definition.title}失败`, { id: toast, description: errorDescription(error, definition) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑${definition.title}` : `新建${definition.title}`}</DialogTitle>
          <DialogDescription>
            {systemDefault ? `系统默认${definition.resourceLabel}类型只能重新启用，不能修改名称、颜色、排序或停用。` : definition.deletePolicy === "venue" ? `停用后不能用于新建${definition.resourceLabel}，已有${definition.resourceLabel}仍会保留其类型。` : `停用后不能用于新建${definition.resourceLabel}。`}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1"><span className="text-sm font-medium">名称</span><Input autoFocus maxLength={120} disabled={systemDefault} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="block space-y-1"><span className="text-sm font-medium">颜色</span><div className="flex items-center gap-2"><input aria-label={`${definition.title}颜色`} disabled={systemDefault} className="size-9 cursor-pointer border bg-background p-0.5" type="color" value={/^#[0-9a-f]{6}$/i.test(form.color) ? form.color : definition.initialColor} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /><Input disabled={systemDefault} value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} placeholder={definition.initialColor} /></div></label>
          <label className="flex items-center justify-between gap-3 border-y py-3"><span><span className="block text-sm font-medium">启用</span><span className="text-xs text-muted-foreground">停用类型不会出现在新建{definition.resourceLabel}选项中。</span></span><Switch checked={Boolean(form.is_active)} disabled={systemDefault && Boolean(form.is_active)} onCheckedChange={(checked) => { if (systemDefault && !checked) return; setForm((current) => ({ ...current, is_active: checked })); }} /></label>
          <label className="block space-y-1"><span className="text-sm font-medium">排序位置</span><Input disabled={systemDefault} type="number" min="1" step="1" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} /></label>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResourceTypeDeleteDialog({ definition, workspace, item, types, open, onOpenChange, onDeleted }) {
  const [strategy, setStrategy] = useState("delete");
  const [replacementTypeId, setReplacementTypeId] = useState("");
  const [availableTypes, setAvailableTypes] = useState([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [busy, setBusy] = useState(false);
  const usageCount = Number(item?.[definition.usageCountField] ?? 0);
  const isProgram = definition.deletePolicy === "program";
  const unassignOnDelete = definition.deletePolicy === "unassign";
  const blockedBySystem = Boolean(item?.is_system_default);
  const targets = availableTypes.filter((type) => type.id !== item?.id && type.is_active);
  const canDelete = Boolean(item) && !blockedBySystem && (isProgram ? usageCount === 0 || strategy !== "delete" : unassignOnDelete || usageCount === 0);

  useEffect(() => {
    if (!open) return;
    setAvailableTypes(types);
    setReplacementTypeId("");
    setBusy(false);
    setLoadingTargets(isProgram && usageCount > 0);
    setStrategy(blockedBySystem ? "deactivate" : isProgram && usageCount > 0 ? "unassign" : "delete");
    if (!isProgram || usageCount === 0) return undefined;
    let active = true;
    definition.api.list(workspace.id, { status: "active", sort: "sort_order", direction: "asc" })
      .then((result) => {
        if (!active) return;
        setAvailableTypes(result.items);
        const replacement = result.items.find((type) => type.id !== item.id);
        setStrategy(replacement ? "move" : "unassign");
        setReplacementTypeId(replacement?.id || "");
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingTargets(false); });
    return () => { active = false; };
  }, [definition, isProgram, item, open, types, usageCount, workspace.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!item || loadingTargets || (blockedBySystem && strategy !== "deactivate")) return;
    if (isProgram && strategy === "move" && !replacementTypeId) return notify.error("请选择目标节目类型");
    const isDeactivate = isProgram && strategy === "deactivate";
    const toast = notify.loading(isDeactivate ? "正在停用节目类型…" : `正在处理${definition.title}…`);
    setBusy(true);
    try {
      if (isDeactivate) await definition.api.update(workspace.id, item.id, { is_active: false });
      else if (isProgram) await definition.api.remove(workspace.id, item.id, { strategy, replacement_type_id: replacementTypeId });
      else await definition.api.remove(workspace.id, item.id);
      notify.success(isDeactivate ? "节目类型已停用" : `${definition.title}已删除`, { id: toast });
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      notify.error(isDeactivate ? "停用节目类型失败" : `删除${definition.title}失败`, { id: toast, description: errorDescription(error, definition) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isProgram ? `处理“${item?.name || definition.title}”` : `删除${definition.title}`}</DialogTitle><DialogDescription>{blockedBySystem ? `系统默认${definition.title}只能重新启用，不能修改、停用或删除。` : usageCount > 0 && unassignOnDelete ? `删除后，${usageCount} 个${definition.resourceLabel}会保留并改为未分类。` : usageCount > 0 ? `“${item?.name}”仍有 ${usageCount} 个${definition.resourceLabel}使用，请先调整类型。` : `删除“${item?.name}”后不可恢复。`}</DialogDescription></DialogHeader>
        {blockedBySystem ? <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter> : isProgram ? <form className="space-y-3" onSubmit={submit}><RadioGroup value={strategy} onValueChange={setStrategy} className="gap-2">
          {usageCount === 0 ? <label className="flex cursor-pointer items-start gap-2 border p-3"><RadioGroupItem value="delete" className="mt-0.5" /><span><span className="block text-sm font-medium">直接删除</span><span className="text-xs text-muted-foreground">类型会被软删除。</span></span></label> : <>
            {targets.length > 0 && <label className="block cursor-pointer border p-3"><span className="flex items-start gap-2"><RadioGroupItem value="move" className="mt-0.5" /><span><span className="block text-sm font-medium">移动到其他启用类型</span><span className="text-xs text-muted-foreground">现有节目会迁移到所选类型。</span></span></span>{strategy === "move" && <Select items={targets.map((type) => ({ value: type.id, label: type.name }))} value={replacementTypeId} onValueChange={setReplacementTypeId}><SelectTrigger className="mt-3 w-full" disabled={loadingTargets}><SelectValue placeholder="选择目标节目类型" /></SelectTrigger><SelectContent>{targets.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select>}</label>}
            <label className="flex cursor-pointer items-start gap-2 border p-3"><RadioGroupItem value="unassign" className="mt-0.5" /><span><span className="block text-sm font-medium">改为未分配</span><span className="text-xs text-muted-foreground">保留节目，但清空类型。</span></span></label>
            <label className="flex cursor-pointer items-start gap-2 border p-3"><RadioGroupItem value="deactivate" className="mt-0.5" /><span><span className="block text-sm font-medium">仅停用</span><span className="text-xs text-muted-foreground">保留类型和现有节目引用。</span></span></label>
          </>}
        </RadioGroup><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" variant="destructive" disabled={busy || loadingTargets || (strategy === "move" && !replacementTypeId)}>{busy ? "处理中…" : strategy === "deactivate" ? "停用" : strategy === "delete" ? "删除" : "确认"}</Button></DialogFooter></form> : <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button variant="destructive" disabled={!canDelete || busy} onClick={submit}>{busy ? "删除中…" : "确认删除"}</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function ManagementSkeleton() {
  return <Card variant="flush"><CardContent className="divide-y p-0">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex min-h-28 items-center gap-4 px-4 py-4"><Skeleton className="size-8 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div><Skeleton className="hidden h-8 w-20 sm:block" /></div>)}</CardContent></Card>;
}

export function ResourceTypeRow({ definition, item, timezone, canWrite, reorderable, pendingToggleId, onToggle, onEdit, onDelete }) {
  const Icon = definition.icon;
  const systemDefault = Boolean(item.is_system_default);
  const toggleDisabled = !canWrite || pendingToggleId === item.id || (systemDefault && item.is_active);
  return <SortableItem value={item.id} disabled={!reorderable || systemDefault} className="border-b last:border-b-0"><div className={`${gridClassName(canWrite)} py-3 transition-colors hover:bg-muted/40`}>
    <SortableItemHandle className="flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={systemDefault ? "系统默认类型不能调整排序" : reorderable ? `拖动${item.name}调整排序` : "排序仅在默认排序视图可用"} title={systemDefault ? "系统默认类型不能调整排序" : reorderable ? "拖动调整排序" : "清除筛选后可调整排序"}><GripVertical className="size-4" /></SortableItemHandle>
    <Badge variant="outline" className="hidden size-7 justify-center px-0 tabular-nums sm:inline-flex">{displayPosition(item.sort_order)}</Badge>
    <span className="size-3 rounded-full" style={{ backgroundColor: item.color }} aria-label={`颜色 ${item.color}`} title={item.color} />
    <div className="flex size-8 items-center justify-center bg-muted text-muted-foreground"><Icon className="size-4" /></div>
    <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{item.name}</p>{item.is_system_default && <Badge variant="outline">系统默认</Badge>}{!item.is_active && <Badge variant="secondary">已停用</Badge>}</div>
    <div className="text-right text-sm tabular-nums"><span>{Number(item[definition.usageCountField] ?? 0)}</span><span className="ml-1 text-xs text-muted-foreground">个</span></div>
    <div className="hidden text-right text-xs tabular-nums text-muted-foreground lg:block">{formatDate(item.updated_at, timezone)}</div>
    <div className="flex w-full items-center justify-center"><Switch checked={Boolean(item.is_active)} disabled={toggleDisabled} onCheckedChange={canWrite && (!systemDefault || !item.is_active) ? (checked) => onToggle(item, checked) : undefined} aria-label={`${item.is_active ? "停用" : "启用"}${item.name}`} /></div>
    {canWrite && !systemDefault && <div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label={`编辑${item.name}`} title={`编辑${item.name}`}><Pencil /></Button><Button variant="ghost" size="icon-sm" onClick={() => onDelete(item)} aria-label={`删除${item.name}`} title={`删除${item.name}`}><Trash2 /></Button></div>}
  </div></SortableItem>;
}

export function ResourceTypeManagementPanel({ workspace, resourceType, onChanged }) {
  const definition = ResourceTypeDefinition[resourceType];
  const { timezone } = useUserPreferences();
  const workspaceId = workspace.id;
  const canWrite = roleAtLeast(workspace.role, "admin");
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterQuery, setFilterQuery] = useState(() => createFilterQuery());
  const [sort, setSort] = useState("sort_order");
  const [direction, setDirection] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [pendingToggleId, setPendingToggleId] = useState(null);
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const activeWorkspaceRef = useRef(workspaceId);

  const { status, usage } = useMemo(() => filterState(filterQuery), [filterQuery]);
  const requestFilters = useMemo(() => ({ q: search.trim(), ...(status !== "all" ? { status } : {}), ...definition.usageQuery(usage), sort, direction }), [definition, direction, search, sort, status, usage]);
  const visibleTypes = useMemo(() => {
    const filtered = definition.deletePolicy === "venue" ? types.filter((item) => usage === "all" || (usage === "used" ? Number(item[definition.usageCountField] ?? 0) > 0 : Number(item[definition.usageCountField] ?? 0) === 0)) : types;
    return [...filtered].sort((left, right) => {
      let result = sort === "name" ? String(left.name).localeCompare(String(right.name), "zh-CN") : sort === definition.usageCountField ? Number(left[definition.usageCountField] ?? 0) - Number(right[definition.usageCountField] ?? 0) : sort === "sort_order" ? Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) : new Date(left.updated_at || 0).getTime() - new Date(right.updated_at || 0).getTime();
      if (result === 0) result = Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
      return direction === "asc" ? result : -result;
    });
  }, [definition, direction, sort, types, usage]);
  const reorderable = canWrite && !search.trim() && getResourceFilterConditions(filterQuery).length === 0 && sort === "sort_order" && direction === "asc";

  const loadTypes = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const requestWorkspaceId = workspaceId;
    setLoading(true);
    try {
      const result = await definition.api.list(requestWorkspaceId, requestFilters);
      if (requestId !== requestSequence.current || activeWorkspaceRef.current !== requestWorkspaceId) return result;
      setTypes(result.items);
      setTotal(result.total);
      setError(null);
      return result;
    } catch (nextError) {
      if (requestId === requestSequence.current && activeWorkspaceRef.current === requestWorkspaceId) setError(nextError);
      throw nextError;
    } finally {
      if (requestId === requestSequence.current && activeWorkspaceRef.current === requestWorkspaceId) setLoading(false);
    }
  }, [definition, requestFilters, workspaceId]);

  useEffect(() => {
    activeWorkspaceRef.current = workspaceId;
    requestSequence.current += 1;
    setTypes([]); setTotal(0); setSearch(""); setFilterQuery(createFilterQuery()); setSort("sort_order"); setDirection("asc"); setError(null); setLoading(true); setPendingToggleId(null);
  }, [workspaceId, resourceType]);

  useEffect(() => {
    const timer = setTimeout(() => loadTypes().catch(() => {}), 120);
    return () => { clearTimeout(timer); requestSequence.current += 1; };
  }, [loadTypes]);

  const retry = async () => {
    const toast = notify.loading(`正在刷新${definition.title}…`);
    try { await loadTypes(); notify.success(`${definition.title}已刷新`, { id: toast }); }
    catch (nextError) { notify.error(`刷新${definition.title}失败`, { id: toast, description: errorDescription(nextError, definition) }); }
  };
  const handleSaved = useCallback(async (saved) => { onChanged?.(saved); await loadTypes().catch(() => {}); }, [loadTypes, onChanged]);
  const handleDeleted = useCallback(async () => { onChanged?.(); await loadTypes().catch(() => {}); }, [loadTypes, onChanged]);
  const handleToggle = useCallback(async (item, checked) => {
    if (!canWrite || pendingToggleId) return;
    const previous = types;
    const sequence = ++mutationSequence.current;
    setPendingToggleId(item.id);
    setTypes((current) => current.map((type) => type.id === item.id ? { ...type, is_active: checked } : type));
    const toast = notify.loading(checked ? `正在启用${definition.title}…` : `正在停用${definition.title}…`);
    try { await definition.api.update(workspaceId, item.id, { is_active: checked }); notify.success(checked ? `${definition.title}已启用` : `${definition.title}已停用`, { id: toast }); if (mutationSequence.current === sequence) { onChanged?.(); await loadTypes().catch(() => {}); } }
    catch (nextError) { if (mutationSequence.current === sequence) setTypes(previous); notify.error(checked ? `启用${definition.title}失败` : `停用${definition.title}失败`, { id: toast, description: errorDescription(nextError, definition) }); }
    finally { if (mutationSequence.current === sequence) setPendingToggleId(null); }
  }, [canWrite, definition, loadTypes, onChanged, pendingToggleId, types, workspaceId]);
  const handleValueCommit = useCallback(async (next, meta) => {
    if (!reorderable) return;
    const toast = notify.loading(`正在保存${definition.title}排序…`);
    try { await definition.api.reorder(workspaceId, next.map((item, index) => ({ id: item.id, sort_order: index }))); notify.success(`${definition.title}排序已保存`, { id: toast }); onChanged?.(); await loadTypes().catch(() => {}); }
    catch (nextError) { setTypes(meta.previousValue); notify.error(`保存${definition.title}排序失败`, { id: toast, description: errorDescription(nextError, definition) }); await loadTypes().catch(() => {}); }
  }, [definition, loadTypes, onChanged, reorderable, workspaceId]);

  const filterFields = [statusFilter, { id: "usage", label: "使用情况", type: "select", defaultOperator: "is_any_of", options: [{ value: "used", label: `有${definition.resourceLabel}` }, { value: "unused", label: `无${definition.resourceLabel}` }] }];
  const empty = error ? { icon: definition.icon, title: `无法加载${definition.title}`, description: errorDescription(error, definition), action: <Button variant="outline" onClick={retry}><RefreshCw />重试</Button> } : visibleTypes.length === 0 ? { icon: definition.icon, title: search.trim() || status !== "all" || usage !== "all" ? `没有匹配的${definition.title}` : `还没有${definition.title}`, description: search.trim() || status !== "all" || usage !== "all" ? "调整搜索词或筛选条件后再试。" : `创建${definition.title}后，${definition.resourceLabel}库中的类型会统一使用这里的配置。`, action: canWrite ? <Button onClick={() => setDialog({ type: "create" })}><Plus />新建{definition.title}</Button> : null } : null;
  const sortControls = <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">排序</span><Select items={definition.sortOptions.map(([value, label]) => ({ value, label }))} value={sort} onValueChange={setSort}><SelectTrigger className="w-28" aria-label="排序字段"><SelectValue /></SelectTrigger><SelectContent>{definition.sortOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={direction === "asc" ? "切换为降序" : "切换为升序"}>{direction === "asc" ? <ArrowUp /> : <ArrowDown />}<span>{direction === "asc" ? "升序" : "降序"}</span></Button></div>;

  return <>
    <ResourcePage title={definition.title} description={definition.description} count={visibleTypes.length} search={{ value: search, onChange: setSearch, placeholder: `搜索${definition.title}…` }} filters={<><ResourceFilters fields={filterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />{sortControls}</>} showViewToggle={false} onCreate={canWrite ? () => setDialog({ type: "create" }) : undefined} createLabel={`新建${definition.title}`} loading={loading} loadingContent={<ManagementSkeleton />} empty={empty} summary={reorderable ? <span className="inline-flex items-center gap-1"><GripVertical className="size-3" />可拖动调整排序</span> : null}>
      <Card variant="flush"><CardContent className="p-0"><div className={`${gridClassName(canWrite)} hidden border-b bg-muted/30 py-2 text-xs text-muted-foreground md:grid`}><span aria-hidden="true" /><span className="text-center">位置</span><span aria-hidden="true" /><span aria-hidden="true" /><span>{definition.title}</span><span className="text-right">{definition.resourceLabel}数量</span><span className="hidden text-right lg:block">更新时间</span><span className="whitespace-nowrap text-center">启用状态</span>{canWrite && <span aria-hidden="true" />}</div><Sortable value={visibleTypes} onValueChange={(next) => { if (reorderable) setTypes(next); }} onValueCommit={handleValueCommit} getItemValue={(item) => item.id} strategy="vertical" className="divide-y-0">{visibleTypes.map((item) => <ResourceTypeRow key={item.id} definition={definition} item={item} timezone={timezone} canWrite={canWrite} reorderable={reorderable} pendingToggleId={pendingToggleId} onToggle={handleToggle} onEdit={(selected) => setDialog({ type: "edit", item: selected })} onDelete={(selected) => setDialog({ type: "delete", item: selected })} />)}</Sortable></CardContent></Card>
    </ResourcePage>
    {dialog?.type !== "delete" && <ResourceTypeDialog definition={definition} workspaceId={workspaceId} open={dialog?.type === "create" || dialog?.type === "edit"} onOpenChange={(open) => { if (!open) setDialog(null); }} item={dialog?.type === "edit" ? dialog.item : null} onSaved={handleSaved} />}
    {dialog?.type === "delete" && <ResourceTypeDeleteDialog definition={definition} workspace={workspace} item={dialog.item} types={types} open onOpenChange={(open) => { if (!open) setDialog(null); }} onDeleted={handleDeleted} />}
  </>;
}

export const resourceTypeManagementDefinitions = ResourceTypeDefinition;
