import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, ListMusic, Pencil, Plus, RefreshCw, Trash2 } from "@/components/ui/icons";
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
import { createProgramType, deleteProgramType, listProgramTypes, reorderProgramTypes, updateProgramType } from "@/lib/resource-api";
import { roleAtLeast } from "@/lib/workspace-api";

const initialForm = { name: "", color: "#2563eb", is_active: true, sort_order: 1 };

const filterFields = [
  {
    id: "status",
    label: "状态",
    type: "select",
    defaultOperator: "is_any_of",
    options: [
      { value: "active", label: "启用" },
      { value: "inactive", label: "停用" },
    ],
  },
  {
    id: "usage",
    label: "使用情况",
    type: "select",
    defaultOperator: "is_any_of",
    options: [
      { value: "used", label: "有节目" },
      { value: "unused", label: "无节目" },
    ],
  },
];

const sortOptions = [
  ["sort_order", "排序位置"],
  ["name", "名称"],
  ["program_count", "节目数量"],
  ["updated_at", "更新时间"],
];

const programTypeGridColumns = {
  readOnly: [
    "grid-cols-[1.75rem_0.75rem_2rem_minmax(0,1fr)_3rem]",
    "sm:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_3rem]",
    "md:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_6rem]",
    "lg:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_7rem_6rem]",
  ].join(" "),
  editable: [
    "grid-cols-[1.75rem_0.75rem_2rem_minmax(0,1fr)_3rem_4.5rem]",
    "sm:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_3rem_4.5rem]",
    "md:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_6rem_4.5rem]",
    "lg:grid-cols-[1.75rem_1.75rem_0.75rem_2rem_minmax(0,1fr)_5rem_7rem_6rem_4.5rem]",
  ].join(" "),
};

function programTypeGridClassName(canWrite) {
  return `grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 ${canWrite ? programTypeGridColumns.editable : programTypeGridColumns.readOnly}`;
}

function displayPosition(value) {
  const sortOrder = Number(value);
  return Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder + 1 : 1;
}

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

function errorDescription(error) {
  if (!error) return "请求失败";
  if (error.program_count != null) return `${error.message || "请求失败"}（${error.program_count} 个节目）`;
  return error.message || String(error);
}

function filterValues(query, field) {
  const condition = getResourceFilterConditions(query).find(
    (item) => item.field === field && item.operator === "is_any_of"
  );
  return condition?.values?.filter(Boolean) || [];
}

function filterState(query) {
  const statusValues = filterValues(query, "status");
  const usageValues = filterValues(query, "usage");
  return {
    status: statusValues.length === 1 ? statusValues[0] : "all",
    usage: usageValues.length === 1 ? usageValues[0] : "all",
  };
}

function filtersToParams(query) {
  const { status, usage } = filterState(query);
  return {
    ...(status !== "all" ? { status } : {}),
    ...(usage !== "all" ? { has_programs: usage === "used" ? "true" : "false" } : {}),
  };
}

function TypeDialog({ workspaceId, open, onOpenChange, item, onSaved }) {
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(item);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? { name: item.name, color: item.color, is_active: item.is_active, sort_order: displayPosition(item.sort_order) }
      : initialForm);
    setBusy(false);
  }, [open, item]);

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const color = form.color.trim();
    if ([...name].length < 1 || [...name].length > 120) {
      notify.error("节目类型名称长度必须为 1–120 个字符");
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      notify.error("颜色必须是 #RRGGBB 格式");
      return;
    }
    const displaySortOrder = Number(form.sort_order);
    if (!Number.isInteger(displaySortOrder) || displaySortOrder < 1) {
      notify.error("排序位置必须是正整数");
      return;
    }
    const sortOrder = displaySortOrder - 1;

    const toast = notify.loading(editing ? "正在保存节目类型…" : "正在创建节目类型…");
    setBusy(true);
    try {
      const payload = { name, color, is_active: Boolean(form.is_active), sort_order: sortOrder };
      const saved = editing
        ? await updateProgramType(workspaceId, item.id, payload)
        : await createProgramType(workspaceId, payload);
      notify.success(editing ? "节目类型已保存" : "节目类型已创建", { id: toast });
      onOpenChange(false);
      onSaved(saved);
    } catch (error) {
      notify.error(editing ? "保存节目类型失败" : "创建节目类型失败", {
        id: toast,
        description: errorDescription(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑节目类型" : "新建节目类型"}</DialogTitle>
          <DialogDescription>名称会按去除首尾空格后的结果保存，并在当前工作空间内保持唯一。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-sm font-medium">名称</span>
            <Input
              autoFocus
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">颜色</span>
            <div className="flex items-center gap-2">
              <input
                aria-label="节目类型颜色"
                className="size-9 cursor-pointer border bg-background p-0.5"
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(form.color) ? form.color : "#2563eb"}
                onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              />
              <Input
                value={form.color}
                onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                placeholder="#2563eb"
              />
            </div>
          </label>
          <label className="flex items-center justify-between gap-3 border-y py-3">
            <span>
              <span className="block text-sm font-medium">启用</span>
              <span className="text-xs text-muted-foreground">停用后不能用于新建节目。</span>
            </span>
            <Switch
              checked={form.is_active}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">排序位置</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={form.sort_order}
              onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTypeDialog({ workspace, item, types, open, onOpenChange, onDeleted }) {
  const [strategy, setStrategy] = useState("unassign");
  const [replacementTypeId, setReplacementTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [availableTypes, setAvailableTypes] = useState([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const programCount = Number(item?.program_count ?? 0);
  const targets = availableTypes.filter((type) => type.id !== item?.id && type.is_active);

  useEffect(() => {
    if (!open) return;
    setAvailableTypes(types);
    setLoadingTargets(programCount > 0);
    setStrategy(programCount > 0 ? "unassign" : "delete");
    setReplacementTypeId("");
    setBusy(false);
    if (programCount === 0) return undefined;

    let active = true;
    listProgramTypes(workspace.id, { status: "active", sort: "sort_order", direction: "asc" })
      .then((result) => {
        if (!active) return;
        setAvailableTypes(result.items);
        const replacement = result.items.find((type) => type.id !== item.id);
        setStrategy(replacement ? "move" : "unassign");
        setReplacementTypeId(replacement?.id || "");
      })
      .catch(() => {
        // Unassignment remains available if the target lookup fails.
      })
      .finally(() => {
        if (active) setLoadingTargets(false);
      });
    return () => { active = false; };
  }, [open, item, programCount, types, workspace.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!item) return;
    if (strategy === "move" && (!replacementTypeId || loadingTargets)) {
      notify.error("请选择目标节目类型");
      return;
    }

    const isDeactivate = strategy === "deactivate";
    const toast = notify.loading(isDeactivate ? "正在停用节目类型…" : "正在处理节目类型…");
    setBusy(true);
    try {
      if (isDeactivate) await updateProgramType(workspace.id, item.id, { is_active: false });
      else await deleteProgramType(workspace.id, item.id, strategy, replacementTypeId);
      notify.success(isDeactivate ? "节目类型已停用" : "节目类型已删除", { id: toast });
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      notify.error(isDeactivate ? "停用节目类型失败" : "删除节目类型失败", {
        id: toast,
        description: errorDescription(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>处理“{item?.name}”</DialogTitle>
          <DialogDescription>
            {programCount > 0
              ? `当前有 ${programCount} 个未删除节目引用此类型，请先选择处理方式。`
              : "此类型没有未删除节目引用，可以直接删除。"}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <RadioGroup value={strategy} onValueChange={setStrategy} className="gap-2">
            {programCount === 0 ? (
              <label className="flex cursor-pointer items-start gap-2 border p-3">
                <RadioGroupItem value="delete" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">直接删除</span>
                  <span className="text-xs text-muted-foreground">类型会被软删除。</span>
                </span>
              </label>
            ) : (
              <>
                {targets.length > 0 && (
                  <label className="block cursor-pointer border p-3">
                    <span className="flex items-start gap-2">
                      <RadioGroupItem value="move" className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium">移动到其他启用类型</span>
                        <span className="text-xs text-muted-foreground">现有节目会迁移到所选类型。</span>
                      </span>
                    </span>
                    {strategy === "move" && (
                      <Select
                        items={targets.map((type) => ({ value: type.id, label: type.name }))}
                        value={replacementTypeId}
                        onValueChange={setReplacementTypeId}
                      >
                        <SelectTrigger className="mt-3 w-full min-w-0 max-w-full" disabled={loadingTargets}>
                          <SelectValue placeholder="选择目标节目类型" />
                        </SelectTrigger>
                        <SelectContent className="max-w-[calc(100vw-2rem)]">
                          {targets.map((type) => (
                            <SelectItem key={type.id} value={type.id} label={type.name}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </label>
                )}
                <label className="flex cursor-pointer items-start gap-2 border p-3">
                  <RadioGroupItem value="unassign" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">改为未分配</span>
                    <span className="text-xs text-muted-foreground">保留节目，但清空类型。</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 border p-3">
                  <RadioGroupItem value="deactivate" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">仅停用</span>
                    <span className="text-xs text-muted-foreground">保留类型和现有节目引用。</span>
                  </span>
                </label>
              </>
            )}
          </RadioGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="destructive" disabled={busy || loadingTargets}>
              {busy ? "处理中…" : strategy === "deactivate" ? "停用" : strategy === "delete" ? "删除" : "确认"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManagementSkeleton() {
  return (
    <Card variant="flush">
      <CardContent className="divide-y p-0">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex min-h-32 items-center gap-4 px-4 py-4">
            <Skeleton className="size-8 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
              <Skeleton className="h-3 w-full max-w-xl" />
            </div>
            <Skeleton className="hidden h-8 w-20 sm:block" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProgramTypeRow({ item, value, className, canWrite, reorderable, pendingToggleId, onToggle, onEdit, onDelete }) {
  return (
    <SortableItem value={value || item.id} disabled={!reorderable} className={`border-b last:border-b-0 ${className || ""}`}>
        <div className={`${programTypeGridClassName(canWrite)} py-3 transition-colors hover:bg-muted/40`}>
          <SortableItemHandle
            className="flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={reorderable ? `拖动${item.name}调整排序` : "排序仅在默认排序视图可用"}
            title={reorderable ? "拖动调整排序" : "清除筛选后可调整排序"}
          >
            <GripVertical className="size-4" />
          </SortableItemHandle>
          <Badge variant="outline" className="hidden size-7 justify-center px-0 tabular-nums sm:inline-flex">{displayPosition(item.sort_order)}</Badge>
          <span className="size-3" style={{ backgroundColor: item.color }} aria-label={`颜色 ${item.color}`} title={item.color} />
          <div className="flex size-8 items-center justify-center bg-muted text-muted-foreground">
            <ListMusic className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.name}</p>
          </div>
          <div className="hidden min-w-20 text-right md:block">
            <p className="text-sm tabular-nums">{Number(item.program_count ?? 0)}</p>
          </div>
          <div className="hidden min-w-28 text-right lg:block">
            <p className="text-xs tabular-nums text-muted-foreground">{formatDate(item.updated_at)}</p>
          </div>
          <div className="flex w-full items-center justify-center">
            <Switch
              checked={Boolean(item.is_active)}
              disabled={!canWrite || pendingToggleId === item.id}
              onCheckedChange={canWrite ? (checked) => onToggle(item, checked) : undefined}
              aria-label={`${item.is_active ? "停用" : "启用"}${item.name}`}
            />
          </div>
          {canWrite && (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label={`编辑${item.name}`} title={`编辑${item.name}`}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item)} aria-label={`删除${item.name}`} title={`删除${item.name}`}>
                <Trash2 />
              </Button>
            </div>
          )}
      </div>
    </SortableItem>
  );
}

export function ProgramTypeManagementPage({ workspace }) {
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
  const viewGeneration = useRef(0);
  const activeWorkspaceRef = useRef(workspaceId);

  const { status, usage } = useMemo(() => filterState(filterQuery), [filterQuery]);
  const requestFilters = useMemo(() => ({
    q: search.trim(),
    ...filtersToParams(filterQuery),
    sort,
    direction,
  }), [direction, filterQuery, search, sort]);
  const reorderable = canWrite
    && !search.trim()
    && getResourceFilterConditions(filterQuery).length === 0
    && status === "all"
    && usage === "all"
    && sort === "sort_order"
    && direction === "asc";

  const loadTypes = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const requestWorkspaceId = workspaceId;
    setLoading(true);
    try {
      const result = await listProgramTypes(requestWorkspaceId, requestFilters);
      if (requestId !== requestSequence.current || activeWorkspaceRef.current !== requestWorkspaceId) return result;
      setTypes(result.items);
      setTotal(result.total);
      setError(null);
      return result;
    } catch (nextError) {
      if (requestId !== requestSequence.current || activeWorkspaceRef.current !== requestWorkspaceId) return null;
      setError(nextError);
      throw nextError;
    } finally {
      if (requestId === requestSequence.current && activeWorkspaceRef.current === requestWorkspaceId) setLoading(false);
    }
  }, [requestFilters, workspaceId]);

  useEffect(() => {
    activeWorkspaceRef.current = workspaceId;
    viewGeneration.current += 1;
    requestSequence.current += 1;
    setTypes([]);
    setTotal(0);
    setSearch("");
    setFilterQuery(createFilterQuery());
    setSort("sort_order");
    setDirection("asc");
    setError(null);
    setLoading(true);
    setPendingToggleId(null);
  }, [workspaceId]);

  useEffect(() => {
    viewGeneration.current += 1;
    requestSequence.current += 1;
    setPendingToggleId(null);
    const timer = setTimeout(() => loadTypes().catch(() => {}), 180);
    return () => {
      clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [loadTypes]);

  const retry = async () => {
    const toast = notify.loading("正在刷新节目类型…");
    try {
      await loadTypes();
      notify.success("节目类型已刷新", { id: toast });
    } catch (nextError) {
      notify.error("刷新节目类型失败", { id: toast, description: errorDescription(nextError) });
    }
  };

  const handleSaved = useCallback(async () => {
    if (activeWorkspaceRef.current !== workspaceId) return;
    await loadTypes().catch(() => {});
  }, [loadTypes, workspaceId]);

  const handleDeleted = useCallback(async () => {
    if (activeWorkspaceRef.current !== workspaceId) return;
    await loadTypes().catch(() => {});
  }, [loadTypes, workspaceId]);

  const handleToggle = useCallback(async (item, checked) => {
    if (!canWrite || pendingToggleId) return;
    const previousValue = types;
    const operationWorkspaceId = workspaceId;
    const operationSequence = ++mutationSequence.current;
    const operationViewGeneration = viewGeneration.current;
    requestSequence.current += 1;
    setPendingToggleId(item.id);
    setTypes((current) => current.map((type) => type.id === item.id ? { ...type, is_active: checked } : type));
    const toast = notify.loading(checked ? "正在启用节目类型…" : "正在停用节目类型…");
    try {
      await updateProgramType(operationWorkspaceId, item.id, { is_active: checked });
      notify.success(checked ? "节目类型已启用" : "节目类型已停用", { id: toast });
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) await loadTypes().catch(() => {});
    } catch (nextError) {
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) setTypes(previousValue);
      notify.error(checked ? "启用节目类型失败" : "停用节目类型失败", { id: toast, description: errorDescription(nextError) });
    } finally {
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) setPendingToggleId(null);
    }
  }, [canWrite, loadTypes, pendingToggleId, types, workspaceId]);

  const handleValueCommit = useCallback(async (next, meta) => {
    if (!reorderable) return;
    const operationWorkspaceId = workspaceId;
    const previousValue = meta.previousValue;
    const operationSequence = ++mutationSequence.current;
    const operationViewGeneration = viewGeneration.current;
    requestSequence.current += 1;
    const toast = notify.loading("正在保存节目类型排序…");
    try {
      await reorderProgramTypes(operationWorkspaceId, next.map((item, index) => ({ id: item.id, sort_order: index })));
      notify.success("节目类型排序已保存", { id: toast });
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) await loadTypes().catch(() => {});
    } catch (nextError) {
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) {
        setTypes(previousValue);
        await loadTypes().catch(() => {});
      }
      notify.error("保存节目类型排序失败", { id: toast, description: errorDescription(nextError) });
    }
  }, [loadTypes, reorderable, workspaceId]);

  const empty = error
    ? {
      icon: ListMusic,
      title: "无法加载节目类型",
      description: errorDescription(error),
      action: <Button variant="outline" onClick={retry}><RefreshCw />重试</Button>,
    }
    : total === 0
      ? {
        icon: ListMusic,
        title: search.trim() || status !== "all" || usage !== "all" ? "没有匹配的节目类型" : "还没有节目类型",
        description: search.trim() || status !== "all" || usage !== "all" ? "调整搜索词或筛选条件后再试。" : "创建节目类型后，节目库中的类型会统一使用这里的配置。",
        action: canWrite ? <Button onClick={() => setDialog({ type: "create" })}><Plus />新建节目类型</Button> : null,
      }
      : null;

  const sortControls = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">排序</span>
      <Select
        items={sortOptions.map(([value, label]) => ({ value, label }))}
        value={sort}
        onValueChange={setSort}
      >
        <SelectTrigger className="w-28" aria-label="排序字段"><SelectValue /></SelectTrigger>
        <SelectContent>
          {sortOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}
        aria-label={direction === "asc" ? "切换为降序" : "切换为升序"}
        title={direction === "asc" ? "切换为降序" : "切换为升序"}
      >
        {direction === "asc" ? <ArrowUp /> : <ArrowDown />}
        <span>{direction === "asc" ? "升序" : "降序"}</span>
      </Button>
    </div>
  );

  return (
    <>
      <ResourcePage
        title="节目类型"
        description="管理当前工作空间的节目类型、排序和使用情况。"
        count={total}
        search={{ value: search, onChange: setSearch, placeholder: "搜索节目类型…" }}
        filters={<><ResourceFilters fields={filterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />{sortControls}</>}
        showViewToggle={false}
        onCreate={canWrite ? () => setDialog({ type: "create" }) : undefined}
        createLabel="新建节目类型"
        loading={loading}
        loadingContent={<ManagementSkeleton />}
        empty={empty}
        summary={reorderable ? <span className="inline-flex items-center gap-1"><GripVertical className="size-3" />可拖动调整排序</span> : null}
      >
        <Card variant="flush">
          <CardContent className="p-0">
            <div className={`${programTypeGridClassName(canWrite)} hidden border-b bg-muted/30 py-2 text-xs text-muted-foreground md:grid`}>
              <span aria-hidden="true" />
              <span className="text-center">位置</span>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span>节目类型</span>
              <span className="text-right">节目数量</span>
              <span className="hidden text-right lg:block">更新时间</span>
              <span className="whitespace-nowrap text-center">启用状态</span>
              {canWrite && <span aria-hidden="true" />}
            </div>
            <Sortable
              value={types}
              onValueChange={setTypes}
              onValueCommit={handleValueCommit}
              getItemValue={(item) => item.id}
              strategy="vertical"
              className="divide-y-0"
            >
              {types.map((item, index) => (
                <ProgramTypeRow
                  key={item.id}
                  item={item}
                  value={item.id}
                  canWrite={canWrite}
                  reorderable={reorderable}
                  pendingToggleId={pendingToggleId}
                  onToggle={handleToggle}
                  onEdit={(selected) => setDialog({ type: "edit", item: selected })}
                  onDelete={(selected) => setDialog({ type: "delete", item: selected })}
                />
              ))}
            </Sortable>
          </CardContent>
        </Card>
      </ResourcePage>
      {dialog?.type !== "delete" && (
        <TypeDialog
          workspaceId={workspaceId}
          open={dialog?.type === "create" || dialog?.type === "edit"}
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          item={dialog?.type === "edit" ? dialog.item : null}
          onSaved={handleSaved}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteTypeDialog
          workspace={workspace}
          item={dialog.item}
          types={types}
          open
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
