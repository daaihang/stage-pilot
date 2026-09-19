import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "@/components/ui/icons";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { ResourcePage } from "@/components/resource-page";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { migrateLegacyFileTypes } from "@/lib/file-type-migration";
import { FILE_TYPE_SCOPE_META, FILE_TYPE_SCOPES } from "@/lib/file-type-config";
import { createFileType, deleteFileType, listFileTypes, reorderFileTypes, restoreFileTypes, updateFileType } from "@/lib/resource-api";
import { roleAtLeast } from "@/lib/workspace-api";
import { DetailFormLayout } from "@/components/detail-form-layout";
import { FormActionBar } from "@/components/form-action-bar";

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
];

const sortOptions = [
  ["sort_order", "排序位置"],
  ["name", "名称"],
  ["updated_at", "更新时间"],
];

const fileTypeGridColumns = {
  readOnly: [
    "grid-cols-[1.75rem_2rem_minmax(0,1fr)_3rem]",
    "sm:grid-cols-[1.75rem_1.75rem_2rem_minmax(0,1fr)_3rem]",
    "md:grid-cols-[1.75rem_1.75rem_2rem_minmax(0,1fr)_6rem_3rem]",
  ].join(" "),
  editable: [
    "grid-cols-[1.75rem_2rem_minmax(0,1fr)_3rem_4.5rem]",
    "sm:grid-cols-[1.75rem_1.75rem_2rem_minmax(0,1fr)_3rem_4.5rem]",
    "md:grid-cols-[1.75rem_1.75rem_2rem_minmax(0,1fr)_6rem_3rem_4.5rem]",
  ].join(" "),
};

function fileTypeGridClassName(canWrite) {
  return `grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 ${canWrite ? fileTypeGridColumns.editable : fileTypeGridColumns.readOnly}`;
}

const initialForm = { name: "", description: "", isActive: true };

const isUncategorized = (item) => item?.template_key?.endsWith(".uncategorized");
const isProtected = (item) => Boolean(item?.is_system_default || item?.template_key) || isUncategorized(item);

function errorDescription(error) {
  return error?.message || String(error || "请求失败");
}

function filterStatus(query) {
  const condition = getResourceFilterConditions(query).find(
    (item) => item.field === "status" && item.operator === "is_any_of"
  );
  const values = condition?.values?.filter(Boolean) || [];
  return values.length === 1 ? values[0] : "all";
}

function displayPosition(item, index) {
  const position = Number(item?.sort_order);
  return Number.isInteger(position) && position >= 0 ? position + 1 : index + 1;
}

function FileTypeDialog({ open, onOpenChange, item, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const editing = Boolean(item);
  const protectedName = isProtected(item);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? { name: item.name, description: item.description || "", isActive: Boolean(item.is_active) }
      : initialForm);
    setError(null);
    setBusy(false);
  }, [item, open]);

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    if (!name || [...name].length > 120) {
      notify.error("文件类型名称必须为 1–120 个字符");
      return;
    }
    if ([...description].length > 500) {
      notify.error("描述不能超过 500 个字符");
      return;
    }
    setBusy(true);
    try {
      const saved = await onSubmit({
        name: protectedName ? item.name : name,
        description,
        isActive: isUncategorized(item) ? true : Boolean(form.isActive),
      });
      if (saved) onOpenChange(false);
      else setError("保存文件类型失败，请检查网络或权限后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑文件类型" : "新建文件类型"}</DialogTitle>
          <DialogDescription>
            {editing
              ? protectedName ? "系统默认类型的名称受保护，但可以调整描述。" : "名称在当前范围内必须唯一。"
              : "自定义类型只会添加到当前选中的文件归属范围。"}
          </DialogDescription>
        </DialogHeader>
        <DetailFormLayout className="min-h-0 flex-1" scrollBoundary="self" onSubmit={submit} error={error} busy={busy} contentClassName="space-y-4 pr-1" actions={<FormActionBar onCancel={() => onOpenChange(false)} busy={busy} submitLabel="保存" busyLabel="保存中…" />}>
          <label className="block space-y-1">
            <span className="text-sm font-medium">名称</span>
            <Input
              autoFocus
              maxLength={120}
              value={form.name}
              disabled={protectedName}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">描述</span>
            <textarea
              className="min-h-24 w-full border bg-background p-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="说明这类文件通常保存什么内容"
            />
          </label>
          {!isUncategorized(item) && (
            <label className="flex items-center justify-between gap-3 border-y py-3">
              <span>
                <span className="block text-sm font-medium">启用</span>
                <span className="text-xs text-muted-foreground">停用后不会作为新的文件归类选项。</span>
              </span>
              <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
            </label>
          )}
        </DetailFormLayout>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ open, title, description, confirmLabel, destructive = false, busy, onOpenChange, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagementSkeleton() {
  return (
    <Card variant="flush">
      <CardContent className="divide-y p-0">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-28 items-center gap-4 px-4 py-4">
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

function FileTypeRow({ item, index, canWrite, reorderable, pendingToggleId, onToggle, onEdit, onDelete }) {
  const Icon = FILE_TYPE_SCOPE_META[item.scope]?.icon || FileText;
  const uncategorized = isUncategorized(item);
  const itemReorderable = reorderable && !uncategorized;
  return (
    <SortableItem value={item.id} disabled={!itemReorderable} className="border-b last:border-b-0">
      <div className={`${fileTypeGridClassName(canWrite)} py-3 transition-colors hover:bg-muted/40`}>
        <SortableItemHandle
          className="flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={itemReorderable ? `拖动${item.name}调整排序` : uncategorized ? "未分类固定在列表底部" : "排序仅在默认排序视图可用"}
          title={itemReorderable ? "拖动调整排序" : uncategorized ? "未分类固定在列表底部" : "清除筛选后可调整排序"}
        >
          <GripVertical className="size-4" />
        </SortableItemHandle>
        <Badge variant="outline" className="hidden size-7 justify-center px-0 tabular-nums sm:inline-flex">{displayPosition(item, index)}</Badge>
        <div className="flex size-8 items-center justify-center bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{item.name}</p>
            {item.is_system_default && <Badge variant="secondary">系统默认</Badge>}
            {uncategorized && <Badge variant="outline">兜底类型</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description || "暂无描述"}</p>
        </div>
        <div className="hidden min-w-24 text-right text-xs text-muted-foreground md:block">
          {item.is_system_default ? "系统模板" : "自定义"}
        </div>
        <div className="flex w-full items-center justify-center">
          <Switch
            checked={Boolean(item.is_active)}
            disabled={!canWrite || uncategorized || pendingToggleId === item.id}
            onCheckedChange={canWrite && !uncategorized ? (checked) => onToggle(item, checked) : undefined}
            aria-label={`${item.is_active ? "停用" : "启用"}${item.name}`}
          />
        </div>
        {canWrite && (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label={`编辑${item.name}`} title={`编辑${item.name}`}>
              <Pencil />
            </Button>
            {!isProtected(item) && (
              <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item)} aria-label={`删除${item.name}`} title={`删除${item.name}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
    </SortableItem>
  );
}

export function FileTypeManagementPage({ workspace }) {
  const workspaceId = workspace.id;
  const canWrite = roleAtLeast(workspace.role, "admin");
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [activeScope, setActiveScope] = useState("workspace");
  const [search, setSearch] = useState("");
  const [filterQuery, setFilterQuery] = useState(() => createFilterQuery());
  const [sort, setSort] = useState("sort_order");
  const [direction, setDirection] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const viewGeneration = useRef(0);
  const activeWorkspaceRef = useRef(workspaceId);
  const migrationCheckedRef = useRef(false);

  const status = useMemo(() => filterStatus(filterQuery), [filterQuery]);
  const requestFilters = useMemo(() => ({
    scope: activeScope,
    q: search.trim(),
    ...(status !== "all" ? { status } : {}),
    sort,
    direction,
  }), [activeScope, direction, search, sort, status]);
  const reorderable = canWrite
    && !search.trim()
    && status === "all"
    && getResourceFilterConditions(filterQuery).length === 0
    && sort === "sort_order"
    && direction === "asc";

  const loadTypes = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const requestWorkspaceId = workspaceId;
    setLoading(true);
    try {
      if (!migrationCheckedRef.current) {
        migrationCheckedRef.current = true;
        if (canWrite) {
          try {
            const migration = await migrateLegacyFileTypes(workspaceId, { canWrite });
            if (migration.status === "migrated" && migration.migrated > 0) {
              notify.info("本地文件类型已迁移到云端");
              if (migration.warnings?.length) notify.info(`迁移完成，${migration.warnings.length} 项数据被跳过`);
            }
          } catch (migrationError) {
            migrationCheckedRef.current = false;
            notify.error("本地文件类型迁移失败", { description: errorDescription(migrationError) });
          }
        }
      }
      const result = await listFileTypes(requestWorkspaceId, requestFilters);
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
  }, [canWrite, requestFilters, workspaceId]);

  useEffect(() => {
    activeWorkspaceRef.current = workspaceId;
    migrationCheckedRef.current = false;
    viewGeneration.current += 1;
    requestSequence.current += 1;
    setTypes([]);
    setTotal(0);
    setActiveScope("workspace");
    setSearch("");
    setFilterQuery(createFilterQuery());
    setSort("sort_order");
    setDirection("asc");
    setError(null);
    setSaving(false);
    setPendingToggleId(null);
  }, [workspaceId]);

  useEffect(() => {
    viewGeneration.current += 1;
    requestSequence.current += 1;
    const timer = setTimeout(() => loadTypes().catch(() => {}), 180);
    return () => {
      clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [loadTypes]);

  const scopeItems = types;
  const visibleItems = types;

  const retry = async () => {
    const toast = notify.loading("正在刷新文件类型…");
    try {
      await loadTypes();
      notify.success("文件类型已刷新", { id: toast });
    } catch (nextError) {
      notify.error("刷新文件类型失败", { id: toast, description: errorDescription(nextError) });
    }
  };

  const handleToggle = useCallback(async (item, checked) => {
    if (!canWrite || saving || isUncategorized(item)) return;
    const previousValue = types;
    const operationSequence = ++mutationSequence.current;
    const operationViewGeneration = viewGeneration.current;
    requestSequence.current += 1;
    setPendingToggleId(item.id);
    setTypes((current) => current.map((type) => type.id === item.id ? { ...type, is_active: checked } : type));
    const toast = notify.loading(checked ? "正在启用文件类型…" : "正在停用文件类型…");
    try {
      await updateFileType(workspaceId, item.id, { is_active: checked });
      notify.success(checked ? "文件类型已启用" : "文件类型已停用", { id: toast });
      if (activeWorkspaceRef.current === workspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) await loadTypes().catch(() => {});
    } catch (nextError) {
      if (activeWorkspaceRef.current === workspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) setTypes(previousValue);
      notify.error(checked ? "启用文件类型失败" : "停用文件类型失败", { id: toast, description: errorDescription(nextError) });
    } finally {
      if (activeWorkspaceRef.current === workspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) setPendingToggleId(null);
    }
  }, [canWrite, loadTypes, saving, types, workspaceId]);

  const handleValueCommit = useCallback(async (next, meta) => {
    if (!reorderable || saving) return;
    const operationWorkspaceId = workspaceId;
    const operationSequence = ++mutationSequence.current;
    const operationViewGeneration = viewGeneration.current;
    requestSequence.current += 1;
    const fallback = next.find((item) => isUncategorized(item));
    const movable = next.filter((item) => !isUncategorized(item));
    const orderedItems = fallback ? [...movable, fallback] : movable;
    const toast = notify.loading("正在保存文件类型排序…");
    setSaving(true);
    try {
      await reorderFileTypes(operationWorkspaceId, activeScope, orderedItems.map((item, index) => ({ id: item.id, sort_order: index })));
      notify.success("文件类型排序已保存", { id: toast });
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) await loadTypes().catch(() => {});
    } catch (nextError) {
      if (activeWorkspaceRef.current === operationWorkspaceId && viewGeneration.current === operationViewGeneration && mutationSequence.current === operationSequence) {
        setTypes(meta.previousValue);
        await loadTypes().catch(() => {});
      }
      notify.error("保存文件类型排序失败", { id: toast, description: errorDescription(nextError) });
    } finally {
      setSaving(false);
    }
  }, [activeScope, loadTypes, reorderable, saving, workspaceId]);

  const handleCreate = async ({ name, description, isActive }) => {
    if (saving) return false;
    const toast = notify.loading("正在创建文件类型…");
    setSaving(true);
    try {
      await createFileType(workspaceId, { scope: activeScope, name: name.trim(), description: description.trim(), is_active: Boolean(isActive) });
      notify.success("文件类型已创建", { id: toast });
      await loadTypes().catch(() => {});
      return true;
    } catch (nextError) {
      notify.error("创建文件类型失败", { id: toast, description: errorDescription(nextError) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (item, { name, description, isActive }) => {
    if (saving) return false;
    const toast = notify.loading("正在保存文件类型…");
    setSaving(true);
    try {
      await updateFileType(workspaceId, item.id, {
        name: isProtected(item) ? item.name : name.trim(),
        description: description.trim(),
        is_active: isUncategorized(item) ? true : Boolean(isActive),
      });
      notify.success("文件类型已保存", { id: toast });
      await loadTypes().catch(() => {});
      return true;
    } catch (nextError) {
      notify.error("保存文件类型失败", { id: toast, description: errorDescription(nextError) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (isProtected(item) || saving) return false;
    const toast = notify.loading("正在删除文件类型…");
    setSaving(true);
    try {
      await deleteFileType(workspaceId, item.id);
      notify.success("文件类型已删除", { id: toast });
      setDialog(null);
      await loadTypes().catch(() => {});
      return true;
    } catch (nextError) {
      notify.error("删除文件类型失败", { id: toast, description: errorDescription(nextError) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (scope) => {
    if (saving) return false;
    const toast = notify.loading("正在恢复系统默认…");
    setSaving(true);
    try {
      const restored = await restoreFileTypes(workspaceId, scope);
      if (activeWorkspaceRef.current === workspaceId && activeScope === scope) {
        setTypes(restored.items);
        setTotal(restored.total);
        setError(null);
      }
      notify.success("当前范围已恢复默认", { id: toast });
      setDialog(null);
      return true;
    } catch (nextError) {
      notify.error("恢复文件类型失败", { id: toast, description: errorDescription(nextError) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const scopeGroups = FILE_TYPE_SCOPES.map((scope) => [scope, FILE_TYPE_SCOPE_META[scope].label, FILE_TYPE_SCOPE_META[scope].icon]);
  const currentMeta = FILE_TYPE_SCOPE_META[activeScope];
  const activeCount = scopeItems.filter((item) => item.is_active).length;
  const selectedItem = dialog?.type === "edit" || dialog?.type === "delete" ? dialog.item : null;
  const pageActions = canWrite ? {
    primary: <Button onClick={() => setDialog({ type: "create" })}><Plus />新建文件类型</Button>,
    secondary: [<Button key="restore" variant="outline" disabled={saving} onClick={() => setDialog({ type: "restore", scope: activeScope })}><RefreshCw />恢复默认</Button>],
  } : null;
  const selectedScope = selectedItem?.scope || activeScope;

  const empty = error
    ? {
      icon: FileText,
      title: "无法加载文件类型",
      description: errorDescription(error),
      action: <Button variant="outline" onClick={retry}><RefreshCw />重试</Button>,
    }
    : visibleItems.length === 0
      ? {
        icon: FileText,
        title: search.trim() || status !== "all" ? "没有匹配的文件类型" : "还没有文件类型",
        description: search.trim() || status !== "all" ? "调整搜索词或筛选条件后再试。" : "当前范围还没有可用的文件分类。",
        action: canWrite ? <Button onClick={() => setDialog({ type: "create" })}><Plus />新建文件类型</Button> : null,
      }
      : null;

  const sortControls = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">排序</span>
      <Select items={sortOptions.map(([value, label]) => ({ value, label }))} value={sort} onValueChange={setSort}>
        <SelectTrigger className="w-28" aria-label="排序字段"><SelectValue /></SelectTrigger>
        <SelectContent>{sortOptions.map(([itemValue, label]) => <SelectItem key={itemValue} value={itemValue}>{label}</SelectItem>)}</SelectContent>
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
    <div className="space-y-6">
      <WorkspacePageHeader
        workspace={workspace}
        role={workspace.role}
        title="文件类型"
        description="管理工作空间各类资源的文件分类。分类配置独立于文件本身，后续可由各资源页面复用。"
        actions={pageActions}
      />
      <SettingsTabs groups={scopeGroups} activeGroup={activeScope} onGroupChange={setActiveScope} ariaLabel="文件归属范围">
        <ResourcePage
          headingLevel="h2"
          title={currentMeta.label}
          description={currentMeta.description}
          count={visibleItems.length}
          search={{ value: search, onChange: setSearch, placeholder: `搜索${currentMeta.label}文件类型…` }}
          filters={<><ResourceFilters fields={filterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />{sortControls}</>}
          showViewToggle={false}
          loading={loading}
          loadingContent={<ManagementSkeleton />}
          empty={empty}
          summary={<span>{activeCount} 个启用 · 共 {scopeItems.length} 个</span>}
        >
          <Card variant="flush">
            <CardContent className="p-0">
              <div className={`${fileTypeGridClassName(canWrite)} hidden border-b bg-muted/30 py-2 text-xs text-muted-foreground sm:grid`}>
                <span aria-hidden="true" />
                <span className="text-center">位置</span>
                <span aria-hidden="true" />
                <span>文件类型</span>
                <span className="hidden text-right md:block">来源</span>
                <span className="whitespace-nowrap text-center">启用状态</span>
                {canWrite && <span aria-hidden="true" />}
              </div>
              <Sortable
                value={visibleItems}
                onValueChange={(next) => {
                  if (!reorderable) return;
                  const fallback = next.find((item) => isUncategorized(item));
                  const movable = next.filter((item) => !isUncategorized(item));
                  const ordered = fallback ? [...movable, fallback] : movable;
                  setTypes(ordered);
                }}
                onValueCommit={handleValueCommit}
                getItemValue={(item) => item.id}
                strategy="vertical"
                className="divide-y-0"
              >
                {visibleItems.map((item, index) => (
                  <FileTypeRow
                    key={item.id}
                    item={item}
                    index={index}
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
      </SettingsTabs>
      <FileTypeDialog
        open={dialog?.type === "create" || dialog?.type === "edit"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        item={dialog?.type === "edit" ? dialog.item : null}
        onSubmit={(payload) => dialog?.type === "edit" ? handleEdit(dialog.item, payload) : handleCreate(payload)}
      />
      <ConfirmDialog
        open={dialog?.type === "delete"}
        title={`删除“${selectedItem?.name || "文件类型"}”`}
        description="删除后它将不再出现在当前范围的文件类型列表中。未来接入文件关联后，相关文件会转入未分类。"
        confirmLabel="删除"
        destructive
        busy={saving}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        onConfirm={() => handleDelete(selectedItem)}
      />
      <ConfirmDialog
        open={dialog?.type === "restore"}
        title={`恢复“${FILE_TYPE_SCOPE_META[selectedScope].label}”默认`}
        description="当前范围的自定义类型会被移除，系统默认类型的名称、描述、顺序和启用状态会恢复。其他范围不受影响。"
        confirmLabel="恢复默认"
        busy={saving}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        onConfirm={() => handleRestore(dialog?.scope || activeScope)}
      />
    </div>
  );
}
