import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, ListMusic, Pencil, Plus, RefreshCw, Trash2 } from "@/components/ui/icons";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { ResourcePage } from "@/components/resource-page";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { roleAtLeast } from "@/lib/workspace-api";
import { listProductions } from "@/lib/production-api";
import { loadProgramSheetState } from "@/lib/program-sheet-store";
import { createSegmentType, deleteSegmentType, loadSegmentTypes, reorderSegmentTypes, restoreSegmentTypes, updateSegmentType } from "@/lib/program-sheet-segment-type-store";
import { loadSegmentTypeUsageIndex, reconcileSegmentTypeUsage, segmentTypeUsageCounts } from "@/lib/program-sheet-segment-type-usage-store";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { sortSegmentTypes } from "@/lib/program-sheet-segment-types";

const emptyForm = { name: "", category: "自定义", color: "#64748b", defaultDurationSeconds: 0, countsTowardDuration: true, audienceVisible: true, requiresExecution: true, isActive: true };
const statusFilter = { id: "status", label: "状态", type: "select", defaultOperator: "is_any_of", options: [{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }] };
const usageFilter = { id: "usage", label: "使用情况", type: "select", defaultOperator: "is_any_of", options: [{ value: "used", label: "已使用" }, { value: "unused", label: "未使用" }] };

function filterValues(query, field) {
  return getResourceFilterConditions(query).find((item) => item.field === field && item.operator === "is_any_of")?.values?.filter(Boolean) || [];
}

function formatDuration(seconds) {
  const minutes = Math.round(Number(seconds || 0) / 60);
  return minutes ? `${minutes} 分钟` : "未设置";
}

function displayPosition(value) {
  const position = Number(value);
  return Number.isInteger(position) && position >= 0 ? position + 1 : 1;
}

function gridClassName(canWrite) {
  return `grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 ${canWrite
    ? "grid-cols-[1.75rem_2rem_0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem_4.5rem]"
    : "grid-cols-[1.75rem_0.75rem_0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem]"}`;
}

function SegmentTypeManagementSkeleton() {
  return <Card variant="flush"><CardContent className="divide-y p-0">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex min-h-16 items-center gap-4 px-4 py-4"><Skeleton className="size-7 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div><Skeleton className="hidden h-8 w-20 sm:block" /></div>)}</CardContent></Card>;
}

function SegmentTypeRow({ item, canWrite, reorderable, usageKnown, pendingToggleId, onToggle, onEdit, onDelete }) {
  const system = Boolean(item.isSystem);
  const other = item.systemKey === "other";
  const usageCount = usageKnown ? item.usageCount : null;
  return <SortableItem value={item.id} disabled={!reorderable || other} className="border-b last:border-b-0"><div className={`${gridClassName(canWrite)} py-3 transition-colors hover:bg-muted/40`}>
    {other ? <span className="size-7" aria-hidden="true" /> : <SortableItemHandle className="flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={reorderable ? `拖动${item.name}调整排序` : "清除筛选后可调整排序"} title={reorderable ? "拖动调整排序" : "清除筛选后可调整排序"}><GripVertical className="size-4" /></SortableItemHandle>}
    <Badge variant="outline" className="hidden size-7 justify-center px-0 tabular-nums sm:inline-flex">{displayPosition(item.sortOrder)}</Badge>
    <span className="size-3 rounded-full" style={{ backgroundColor: item.color }} aria-label={`颜色 ${item.color}`} title={item.color} />
    <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{item.name}</p><Badge variant="outline">{item.category}</Badge>{system && <Badge variant="secondary">系统</Badge>}{!item.isActive && <Badge variant="secondary">已停用</Badge>}</div>
    <div className="text-right text-sm tabular-nums">{usageCount == null ? <span className="text-muted-foreground" title="使用情况尚未完全核对">—</span> : <><span>{usageCount}</span><span className="ml-1 text-xs text-muted-foreground">个节目单</span></>}</div>
    <div className="text-right text-xs text-muted-foreground">{formatDuration(item.defaultDurationSeconds)}</div>
    <div className="flex justify-center"><Switch checked={Boolean(item.isActive)} disabled={!canWrite || pendingToggleId === item.id || other} onCheckedChange={(checked) => onToggle(item, checked)} aria-label={`${item.isActive ? "停用" : "启用"}${item.name}`} /></div>
    {canWrite ? <div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label={`编辑${item.name}`} title={`编辑${item.name}`}><Pencil /></Button>{!system && <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item)} aria-label={`删除${item.name}`} title={`删除${item.name}`}><Trash2 /></Button>}</div> : null}
  </div></SortableItem>;
}

export function ProgramSheetSegmentTypeManagementPage({ workspace, embedded = false }) {
  const workspaceId = workspace.id;
  const canWrite = roleAtLeast(workspace.role, "admin");
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState(() => createFilterQuery());
  const [sort, setSort] = useState("sort_order");
  const [direction, setDirection] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usageIndex, setUsageIndex] = useState(null);
  const [usageStatus, setUsageStatus] = useState("loading");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [pendingToggleId, setPendingToggleId] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadTypes = useCallback(async ({ toast = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadSegmentTypes(workspaceId);
      setTypes(next);
      if (toast) notify.success("环节类型已刷新");
      return next;
    } catch (nextError) {
      setError(nextError);
      if (toast) notify.error("环节类型刷新失败", { description: nextError?.message || String(nextError) });
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadUsage = useCallback(async ({ toast = false } = {}) => {
    setUsageStatus("loading");
    try {
      const result = await listProductions(workspaceId);
      const productions = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : null;
      if (!productions) throw new Error("工作空间活动列表格式无效");
      const reconciled = await reconcileSegmentTypeUsage(workspaceId, productions.map((item) => item.id), loadProgramSheetState);
      setUsageIndex(reconciled.index);
      setUsageStatus(reconciled.failedProductionIds.length ? "partial" : "ready");
      if (reconciled.failedProductionIds.length) notify.error("部分节目单使用情况无法核对", { description: "为避免误删，使用情况不完整时只能停用环节类型。" });
      else if (toast) notify.success("环节类型使用情况已刷新");
    } catch (nextError) {
      setUsageIndex(await loadSegmentTypeUsageIndex(workspaceId).catch(() => null));
      setUsageStatus("error");
      notify.error("环节类型使用情况加载失败", { description: "仍可查看和停用类型，但在核对完成前不能删除。" });
      if (toast) throw nextError;
    }
  }, [workspaceId]);

  useEffect(() => { loadTypes().catch(() => {}); loadUsage().catch(() => {}); }, [loadTypes, loadUsage]);

  const usageCounts = useMemo(() => segmentTypeUsageCounts(usageIndex), [usageIndex]);
  const usageKnown = usageStatus === "ready";
  const { status, usage } = useMemo(() => ({ status: filterValues(filterQuery, "status")[0] || "all", usage: filterValues(filterQuery, "usage")[0] || "all" }), [filterQuery]);
  const visibleTypes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const filtered = types.map((item) => ({ ...item, usageCount: usageCounts[item.id] || 0 })).filter((item) => {
      const matchesQuery = !needle || `${item.name} ${item.category}`.toLocaleLowerCase("zh-CN").includes(needle);
      const matchesStatus = status === "all" || (status === "active" ? item.isActive : !item.isActive);
      const matchesUsage = usage === "all" || (usageKnown && (usage === "used" ? item.usageCount > 0 : item.usageCount === 0));
      return matchesQuery && matchesStatus && matchesUsage;
    });
    return filtered.sort((left, right) => {
      if (left.systemKey === "other" && right.systemKey !== "other") return 1;
      if (right.systemKey === "other" && left.systemKey !== "other") return -1;
      let result = sort === "name" ? left.name.localeCompare(right.name, "zh-CN") : sort === "usage" ? left.usageCount - right.usageCount : Number(left.sortOrder) - Number(right.sortOrder);
      if (result === 0) result = Number(left.sortOrder) - Number(right.sortOrder) || left.name.localeCompare(right.name, "zh-CN");
      return direction === "asc" ? result : -result;
    });
  }, [direction, query, sort, status, types, usage, usageCounts, usageKnown]);

  const reorderable = canWrite && !query.trim() && getResourceFilterConditions(filterQuery).length === 0 && sort === "sort_order" && direction === "asc";
  const openEdit = (item) => { setForm({ ...item, defaultDurationSeconds: Math.round(Number(item.defaultDurationSeconds || 0) / 60) }); setDialog({ type: "edit", item }); };

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    const name = form.name.trim();
    if (!name) return notify.error("请输入环节类型名称");
    const editing = dialog?.type === "edit" && Boolean(dialog?.item);
    const item = dialog?.item;
    const system = Boolean(item?.isSystem);
    if (system && (name !== item.name || form.category !== item.category || form.color.toLowerCase() !== String(item.color).toLowerCase())) return notify.error("系统环节类型不能修改名称、分类或颜色");
    setBusy(true);
    const toast = notify.loading(editing ? "正在保存环节类型…" : "正在创建环节类型…");
    try {
      const payload = { ...form, name, defaultDurationSeconds: Math.max(0, Number(form.defaultDurationSeconds || 0) * 60), isActive: Boolean(form.isActive) };
      const saved = editing ? await updateSegmentType(workspaceId, item.id, payload) : await createSegmentType(workspaceId, payload);
      setTypes((current) => current.some((candidate) => candidate.id === saved.id) ? current.map((candidate) => candidate.id === saved.id ? saved : candidate) : [...current, saved]);
      setDialog(null);
      notify.success(editing ? "环节类型已保存" : "环节类型已创建", { id: toast });
    } catch (nextError) {
      notify.error(editing ? "环节类型保存失败" : "环节类型创建失败", { id: toast, description: nextError?.message || String(nextError) });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item, checked) => {
    if (!canWrite || pendingToggleId) return;
    setPendingToggleId(item.id);
    const toast = notify.loading(checked ? "正在启用环节类型…" : "正在停用环节类型…");
    try {
      const saved = await updateSegmentType(workspaceId, item.id, { isActive: checked });
      setTypes((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      notify.success(checked ? "环节类型已启用" : "环节类型已停用", { id: toast });
    } catch (nextError) {
      notify.error("环节类型状态更新失败", { id: toast, description: nextError?.message || String(nextError) });
    } finally {
      setPendingToggleId(null);
    }
  };

  const remove = async () => {
    const item = dialog?.item;
    if (!item || !canWrite) return;
    if (!usageKnown) return notify.error("使用情况尚未核对完成", { description: "请刷新后再删除；当前可以先停用此类型。" });
    if (item.usageCount > 0) return notify.error("该环节类型仍在使用", { description: `已有 ${item.usageCount} 个节目单使用，请先停用。` });
    setBusy(true);
    const toast = notify.loading("正在删除环节类型…");
    try {
      await deleteSegmentType(workspaceId, item.id, []);
      setTypes((current) => current.filter((candidate) => candidate.id !== item.id));
      setDialog(null);
      notify.success("环节类型已删除", { id: toast });
    } catch (nextError) {
      notify.error("环节类型删除失败", { id: toast, description: nextError?.message || String(nextError) });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!canWrite) return;
    const toast = notify.loading("正在恢复默认环节类型…");
    try {
      setTypes(await restoreSegmentTypes(workspaceId));
      notify.success("默认环节类型已恢复", { id: toast });
    } catch (nextError) {
      notify.error("恢复默认环节类型失败", { id: toast, description: nextError?.message || String(nextError) });
    }
  };

  const refresh = () => { loadTypes({ toast: true }).catch(() => {}); loadUsage({ toast: false }).catch(() => {}); };
  const content = <ResourcePage title="节目单环节类型" description="工作空间级节目单环节类型；当前保存在本机，尚未同步到服务器。" count={visibleTypes.length} search={{ value: query, onChange: setQuery, placeholder: "搜索环节类型或分类" }} filters={<><ResourceFilters fields={[statusFilter, usageFilter]} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} /><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">排序</span><Select value={sort} onValueChange={setSort}><SelectTrigger className="w-28" aria-label="排序字段"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sort_order">排序位置</SelectItem><SelectItem value="name">名称</SelectItem><SelectItem value="usage">使用数量</SelectItem></SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={direction === "asc" ? "切换为降序" : "切换为升序"}>{direction === "asc" ? <ArrowUp /> : <ArrowDown />}<span>{direction === "asc" ? "升序" : "降序"}</span></Button></div></>} showViewToggle={false} onCreate={canWrite ? () => { setForm({ ...emptyForm }); setDialog({ type: "create", item: null }); } : undefined} createLabel="新建环节类型" headerActions={<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={refresh}><RefreshCw />刷新</Button>{canWrite && <Button variant="outline" size="sm" onClick={restore}><RefreshCw />恢复默认</Button>}</div>} loading={loading} loadingContent={<SegmentTypeManagementSkeleton />} empty={error ? { icon: ListMusic, title: "无法加载环节类型", description: error.message || String(error), action: <Button variant="outline" onClick={() => loadTypes({ toast: true }).catch(() => {})}><RefreshCw />重试</Button> } : !visibleTypes.length ? { icon: ListMusic, title: query.trim() || status !== "all" || usage !== "all" ? "没有匹配的环节类型" : "暂无环节类型", description: query.trim() || status !== "all" || usage !== "all" ? "请调整搜索词或筛选条件。" : "恢复内置类型或新建自定义类型。", action: canWrite && !query.trim() && status === "all" && usage === "all" ? <Button variant="outline" onClick={restore}><RefreshCw />恢复默认</Button> : null } : null} summary={<span>{usageStatus === "ready" ? "使用数量已核对" : usageStatus === "loading" ? "正在核对使用数量…" : "使用数量未完全核对，暂不可删除"}</span>}><Card variant="flush"><CardContent className="p-0"><div className={`${gridClassName(canWrite)} hidden border-b bg-muted/30 py-2 text-xs text-muted-foreground md:grid`}><span aria-hidden="true" /><span className="text-center">位置</span><span aria-hidden="true" /><span>环节类型</span><span className="text-right">使用节目单数</span><span className="text-right">默认时长</span><span className="text-center">启用状态</span>{canWrite && <span aria-hidden="true" />}</div><Sortable value={visibleTypes} getItemValue={(item) => item.id} strategy="vertical" onValueChange={(next) => reorderable && setTypes(sortSegmentTypes(next))} onValueCommit={async (next, meta) => { if (!reorderable) return; const toast = notify.loading("正在保存环节类型排序…"); try { const saved = await reorderSegmentTypes(workspaceId, next); setTypes(saved); notify.success("环节类型排序已保存", { id: toast }); } catch (nextError) { setTypes(meta.previousValue); notify.error("环节类型排序保存失败", { id: toast, description: nextError?.message || String(nextError) }); } }} className="divide-y-0">{visibleTypes.map((item) => <SegmentTypeRow key={item.id} item={item} canWrite={canWrite} reorderable={reorderable} usageKnown={usageKnown} pendingToggleId={pendingToggleId} onToggle={toggle} onEdit={openEdit} onDelete={(candidate) => { if (!usageKnown) return notify.error("使用情况尚未核对完成", { description: "请刷新后再删除；当前可以先停用此类型。" }); if (candidate.usageCount > 0) return notify.error("该环节类型仍在使用", { description: `已有 ${candidate.usageCount} 个节目单使用，请先停用。` }); setDialog({ type: "delete", item: candidate }); }} />)}</Sortable></CardContent></Card></ResourcePage>;
  const manager = <>{embedded ? null : <WorkspacePageHeader workspace={workspace} role={workspace.role} title="节目单环节类型" description="集中管理当前工作空间所有节目单可用的环节类型。" />}{content}<Dialog open={dialog?.type === "edit" || dialog?.type === "create"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{dialog?.item ? `编辑${dialog.item.name}` : "新建环节类型"}</DialogTitle><DialogDescription>类型默认行为只影响新建条目，已有条目会保留创建时快照。</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={save}><label className="block space-y-1"><span>名称</span><Input value={form.name} disabled={Boolean(dialog?.item?.isSystem)} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="block space-y-1"><span>分类</span><Input value={form.category} disabled={Boolean(dialog?.item?.isSystem)} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label><label className="block space-y-1"><span>颜色</span><div className="flex items-center gap-2"><input aria-label="环节类型颜色" disabled={Boolean(dialog?.item?.isSystem)} className="size-9 cursor-pointer border bg-background p-0.5" type="color" value={/^#[0-9a-f]{6}$/i.test(form.color) ? form.color : "#64748b"} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /><Input disabled={Boolean(dialog?.item?.isSystem)} value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} placeholder="#64748b" /></div></label><label className="block space-y-1"><span>默认时长（分钟）</span><Input type="number" min="0" step="1" value={form.defaultDurationSeconds} onChange={(event) => setForm((current) => ({ ...current, defaultDurationSeconds: event.target.value }))} /></label>{[["countsTowardDuration", "默认计入总时长"], ["audienceVisible", "默认面向观众"], ["requiresExecution", "默认需要执行"], ["isActive", "启用"]].map(([key, label]) => <label key={key} className="flex items-center justify-between border-y py-2"><span>{label}</span><Switch checked={Boolean(form[key])} disabled={dialog?.item?.systemKey === "other" && key === "isActive"} onCheckedChange={(value) => setForm((current) => ({ ...current, [key]: value }))} /></label>)}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></DialogFooter></form></DialogContent></Dialog><AlertDialog open={dialog?.type === "delete"} onOpenChange={(open) => !open && setDialog(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除环节类型</AlertDialogTitle><AlertDialogDescription>确认删除“{dialog?.item?.name || "此环节类型"}”？删除后不能用于新建节目单条目；历史节目单中的快照不受影响。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={remove}>{busy ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
  return embedded ? <div className="min-h-full space-y-4 p-4">{manager}</div> : <div className="space-y-6">{manager}</div>;
}

export function ProgramSheetSegmentTypeManagementPanel(props) {
  return <ProgramSheetSegmentTypeManagementPage {...props} embedded />;
}
