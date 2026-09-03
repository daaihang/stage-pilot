import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarDays,
  FileText,
  FolderOpen,
  GripVertical,
  IdCard,
  ListMusic,
  LayoutPanelTop,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
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
import {
  defaultScopeItems,
  FILE_TYPE_SCOPE_META,
  FILE_TYPE_SCOPES,
  loadWorkspaceFileTypes,
  saveWorkspaceFileTypes,
} from "@/lib/file-type-store";
import { roleAtLeast } from "@/lib/workspace-api";

const scopeIcons = {
  workspace: FileText,
  membership: IdCard,
  person: UserRound,
  organization: Building2,
  venue: MapPin,
  venue_space: LayoutPanelTop,
  equipment: Package,
  program: ListMusic,
  production: CalendarDays,
  file_library: FolderOpen,
};

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

const isUncategorized = (item) => item?.templateKey?.endsWith(".uncategorized");
const isProtected = (item) => Boolean(item?.isSystemDefault) || isUncategorized(item);

function createLocalId(scope) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${scope}:local:${crypto.randomUUID()}`;
  }
  return `${scope}:local:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

function compareItems(left, right, sort, direction) {
  let result = 0;
  if (sort === "name") {
    result = left.name.localeCompare(right.name, "zh-CN");
  } else if (sort === "updated_at") {
    result = String(left.updatedAt || "").localeCompare(String(right.updatedAt || ""));
  } else {
    result = Number(left.sortOrder) - Number(right.sortOrder);
  }
  if (result === 0) result = Number(left.sortOrder) - Number(right.sortOrder);
  if (result === 0) result = left.id.localeCompare(right.id);
  return direction === "desc" ? -result : result;
}

function displayPosition(item, index) {
  const position = Number(item?.sortOrder);
  return Number.isInteger(position) && position >= 0 ? position + 1 : index + 1;
}

function FileTypeDialog({ open, onOpenChange, item, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(item);
  const protectedName = isProtected(item);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? { name: item.name, description: item.description || "", isActive: Boolean(item.isActive) }
      : initialForm);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑文件类型" : "新建文件类型"}</DialogTitle>
          <DialogDescription>
            {editing
              ? protectedName ? "系统默认类型的名称受保护，但可以调整描述。" : "名称在当前范围内必须唯一。"
              : "自定义类型只会添加到当前选中的文件归属范围。"}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
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
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </form>
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
  const Icon = scopeIcons[item.scope] || FileText;
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
            {item.isSystemDefault && <Badge variant="secondary">系统默认</Badge>}
            {uncategorized && <Badge variant="outline">兜底类型</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description || "暂无描述"}</p>
        </div>
        <div className="hidden min-w-24 text-right text-xs text-muted-foreground md:block">
          {item.isSystemDefault ? "系统模板" : "自定义"}
        </div>
        <div className="flex w-full items-center justify-center">
          <Switch
            checked={Boolean(item.isActive)}
            disabled={!canWrite || uncategorized || pendingToggleId === item.id}
            onCheckedChange={canWrite && !uncategorized ? (checked) => onToggle(item, checked) : undefined}
            aria-label={`${item.isActive ? "停用" : "启用"}${item.name}`}
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
  const [value, setValue] = useState(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setValue(await loadWorkspaceFileTypes(workspaceId));
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setValue(null);
    setActiveScope("workspace");
    setSearch("");
    setFilterQuery(createFilterQuery());
    setSort("sort_order");
    setDirection("asc");
    setError(null);
    load().catch(() => {});
  }, [load, workspaceId]);

  const status = useMemo(() => filterStatus(filterQuery), [filterQuery]);
  const scopeItems = value?.scopes?.[activeScope] || [];
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return scopeItems
      .filter((item) => !query || `${item.name} ${item.description}`.toLocaleLowerCase().includes(query))
      .filter((item) => status === "all" || (status === "active" ? item.isActive : !item.isActive))
      .sort((left, right) => compareItems(left, right, sort, direction));
  }, [direction, scopeItems, search, sort, status]);
  const reorderable = canWrite
    && !search.trim()
    && status === "all"
    && getResourceFilterConditions(filterQuery).length === 0
    && sort === "sort_order"
    && direction === "asc";

  const commitScope = useCallback(async (scope, nextItems, loadingMessage, successMessage, previousValue = value) => {
    if (!value || saving) return false;
    const nextValue = {
      ...value,
      scopes: { ...value.scopes, [scope]: nextItems },
    };
    setValue(nextValue);
    setSaving(true);
    const toast = notify.loading(loadingMessage);
    try {
      await saveWorkspaceFileTypes(workspaceId, nextValue);
      notify.success(successMessage, { id: toast });
      return true;
    } catch (nextError) {
      setValue(previousValue);
      notify.error("保存文件类型失败", { id: toast, description: errorDescription(nextError) });
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving, value, workspaceId]);

  const retry = async () => {
    const toast = notify.loading("正在刷新文件类型…");
    try {
      await load();
      notify.success("文件类型已刷新", { id: toast });
    } catch (nextError) {
      notify.error("刷新文件类型失败", { id: toast, description: errorDescription(nextError) });
    }
  };

  const handleToggle = async (item, checked) => {
    if (!canWrite || saving || isUncategorized(item)) return;
    const nextItems = scopeItems.map((current) => current.id === item.id ? { ...current, isActive: checked } : current);
    setPendingToggleId(item.id);
    const previousValue = value;
    const saved = await commitScope(
      activeScope,
      nextItems,
      checked ? "正在启用文件类型…" : "正在停用文件类型…",
      checked ? "文件类型已启用" : "文件类型已停用",
      previousValue,
    );
    if (!saved && previousValue) setValue(previousValue);
    setPendingToggleId(null);
  };

  const handleValueCommit = async (next, meta) => {
    if (!reorderable || saving) return;
    const fallback = next.find((item) => isUncategorized(item));
    const movable = next.filter((item) => !isUncategorized(item));
    const orderedItems = (fallback ? [...movable, fallback] : movable)
      .map((item, index) => ({ ...item, sortOrder: index }));
    await commitScope(activeScope, orderedItems, "正在保存文件类型排序…", "文件类型排序已保存", value);
  };

  const handleCreate = async ({ name, description, isActive }) => {
    const normalizedName = name.trim().toLocaleLowerCase();
    if (scopeItems.some((item) => item.name.trim().toLocaleLowerCase() === normalizedName && !item.deletedAt)) {
      notify.error("当前范围内已经存在同名文件类型");
      return false;
    }
    const uncategorized = scopeItems.find((item) => isUncategorized(item));
    const customItem = {
      id: createLocalId(activeScope),
      scope: activeScope,
      templateKey: null,
      name: name.trim(),
      description: description.trim(),
      sortOrder: Math.max(0, scopeItems.length - (uncategorized ? 1 : 0)),
      isSystemDefault: false,
      isActive,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    };
    const nextItems = uncategorized
      ? [...scopeItems.filter((item) => item.id !== uncategorized.id), customItem, { ...uncategorized, sortOrder: scopeItems.length }]
      : [...scopeItems, customItem];
    return commitScope(activeScope, nextItems.map((item, index) => ({ ...item, sortOrder: index })), "正在创建文件类型…", "文件类型已创建");
  };

  const handleEdit = async (item, { name, description, isActive }) => {
    const items = value?.scopes?.[item.scope] || [];
    const normalizedName = name.trim().toLocaleLowerCase();
    if (items.some((current) => current.id !== item.id && current.name.trim().toLocaleLowerCase() === normalizedName && !current.deletedAt)) {
      notify.error("当前范围内已经存在同名文件类型");
      return false;
    }
    const nextItems = items.map((current) => current.id === item.id
      ? { ...current, name: isProtected(current) ? current.name : name.trim(), description: description.trim(), isActive: isUncategorized(current) ? true : isActive, updatedAt: new Date().toISOString() }
      : current);
    return commitScope(item.scope, nextItems, "正在保存文件类型…", "文件类型已保存");
  };

  const handleDelete = async (item) => {
    if (isProtected(item)) return false;
    const items = value?.scopes?.[item.scope] || [];
    const nextItems = items.filter((current) => current.id !== item.id).map((current, index) => ({ ...current, sortOrder: index }));
    const saved = await commitScope(item.scope, nextItems, "正在删除文件类型…", "文件类型已删除");
    if (saved) setDialog(null);
    return saved;
  };

  const handleRestore = async (scope) => {
    const saved = await commitScope(scope, defaultScopeItems(scope), "正在恢复系统默认…", "当前范围已恢复默认");
    if (saved) setDialog(null);
    return saved;
  };

  const scopeGroups = FILE_TYPE_SCOPES.map((scope) => [scope, FILE_TYPE_SCOPE_META[scope].label, scopeIcons[scope]]);
  const currentMeta = FILE_TYPE_SCOPE_META[activeScope];
  const activeCount = scopeItems.filter((item) => item.isActive).length;
  const selectedItem = dialog?.type === "edit" || dialog?.type === "delete" ? dialog.item : null;
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
      />
      <SettingsTabs groups={scopeGroups} activeGroup={activeScope} onGroupChange={setActiveScope} ariaLabel="文件归属范围">
        <ResourcePage
          title={currentMeta.label}
          description={currentMeta.description}
          count={visibleItems.length}
          search={{ value: search, onChange: setSearch, placeholder: `搜索${currentMeta.label}文件类型…` }}
          filters={<><ResourceFilters fields={filterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />{sortControls}</>}
          showViewToggle={false}
          onCreate={canWrite ? () => setDialog({ type: "create" }) : undefined}
          createLabel="新建文件类型"
          headerActions={<Button variant="outline" disabled={!canWrite || saving} onClick={() => setDialog({ type: "restore", scope: activeScope })}><RefreshCw />恢复默认</Button>}
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
                  setValue((current) => ({ ...current, scopes: { ...current.scopes, [activeScope]: ordered } }));
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
