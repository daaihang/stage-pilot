import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, MapPin, Pencil, Plus, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResourcePage } from "@/components/resource-page";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { listResource, listVenueSpaces } from "@/lib/resource-api";
import { createProductionLocation, deleteProductionLocation, listProductionLocations, reorderProductionLocations, updateProductionLocation } from "@/lib/production-api";

export const productionLocationPurposes = [["performance", "演出"], ["rehearsal", "排练"], ["office", "办公"], ["other", "其他"]];
const purposeLabel = (value) => value === "primary" ? "其他" : productionLocationPurposes.find(([key]) => key === value)?.[1] || value || "其他";
const locationName = (location) => (location.venueName || "未命名场地") + (location.spaceName ? " · " + location.spaceName : " · 整个场地");
const canManageLocations = (workspace, production) => ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");
const locationGridClassName = (canWrite) => canWrite
  ? "grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 grid-cols-[1.75rem_minmax(0,1fr)_5rem_5rem_4.5rem] sm:grid-cols-[1.75rem_1.75rem_1.25rem_minmax(0,1fr)_5rem_6rem_minmax(6rem,1fr)_4.5rem]"
  : "grid min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 grid-cols-[1.75rem_minmax(0,1fr)_5rem_5rem] sm:grid-cols-[1.75rem_1.75rem_1.25rem_minmax(0,1fr)_5rem_6rem_minmax(6rem,1fr)]";
const purposeFilter = { id: "purpose", label: "使用场景", type: "select", defaultOperator: "is_any_of", options: productionLocationPurposes.map(([value, label]) => ({ value, label })) };
const primaryFilter = { id: "primary", label: "默认地点", type: "select", defaultOperator: "is_any_of", options: [{ value: "default", label: "默认地点" }, { value: "other", label: "其他地点" }] };
const filterValues = (query, field) => getResourceFilterConditions(query).find((item) => item.field === field && item.operator === "is_any_of")?.values?.filter(Boolean) || [];

function initialForm(location) {
  return { id: location?.id || null, venueId: location?.venueId || "", venueSpaceId: location?.venueSpaceId || "", purpose: location?.purpose === "primary" ? "other" : location?.purpose || "other", isPrimary: Boolean(location?.isPrimary), notes: location?.notes || "" };
}

function LocationDetail({ workspace, production, location, venues, locationCount, busy, onSaved, onCancel }) {
  const [form, setForm] = useState(() => initialForm(location));
  const [spaces, setSpaces] = useState([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [error, setError] = useState("");
  const canWrite = canManageLocations(workspace, production);
  const venueOptions = useMemo(() => venues.map((venue) => ({ value: venue.id, label: venue.name })), [venues]);
  const venueIds = useMemo(() => venueOptions.map((venue) => venue.value), [venueOptions]);
  const venueLabel = useCallback((value) => venueOptions.find((venue) => venue.value === value)?.label || "", [venueOptions]);
  const spaceOptions = useMemo(() => [{ value: "none", label: "整个场地" }, ...spaces.filter((space) => space.status !== "archived").map((space) => ({ value: space.id, label: space.name }))], [spaces]);
  const purposeOptions = useMemo(() => productionLocationPurposes.map(([value, label]) => ({ value, label })), []);
  const loadSpaces = useCallback(async (venueId) => {
    if (!venueId) { setSpaces([]); return; }
    setLoadingSpaces(true);
    try { setSpaces(await listVenueSpaces(workspace.id, venueId)); }
    catch (nextError) { setSpaces([]); notify.error("无法加载场地空间", { description: nextError?.message || String(nextError) }); }
    finally { setLoadingSpaces(false); }
  }, [workspace.id]);
  useEffect(() => { loadSpaces(form.venueId); }, [form.venueId, loadSpaces]);
  const submit = async (event) => {
    event.preventDefault();
    if (!canWrite || !form.venueId || busy) return;
    setError("");
    const toast = notify.loading(form.id ? "正在保存活动地点…" : "正在添加活动地点…");
    const payload = { venue_id: form.venueId, venue_space_id: form.venueSpaceId || null, purpose: form.purpose, is_primary: form.isPrimary, notes: form.notes.trim() };
    try {
      const saved = form.id ? await updateProductionLocation(production.id, form.id, payload) : await createProductionLocation(production.id, { ...payload, sort_order: locationCount });
      notify.success(form.id ? "活动地点已保存" : "活动地点已添加", { id: toast });
      onSaved(saved);
    } catch (nextError) {
      const message = nextError?.message || String(nextError);
      setError(message);
      notify.error(form.id ? "保存活动地点失败" : "添加活动地点失败", { id: toast, description: message });
    }
  };
  return <form className="space-y-4" onSubmit={submit}>
    <label className="space-y-1.5"><span className="text-sm font-medium">场地</span><Combobox items={venueIds} value={form.venueId || null} onValueChange={(value) => setForm((current) => ({ ...current, venueId: value || "", venueSpaceId: "" }))} itemToStringValue={(value) => value || ""} itemToStringLabel={venueLabel}><ComboboxInput className="w-full" placeholder="搜索并选择场地" /><ComboboxContent><ComboboxEmpty>没有匹配的场地</ComboboxEmpty><ComboboxList>{venueOptions.map((venue) => <ComboboxItem key={venue.value} value={venue.value}>{venue.label}</ComboboxItem>)}</ComboboxList></ComboboxContent></Combobox></label>
    <label className="space-y-1.5"><span className="text-sm font-medium">空间</span><Select items={spaceOptions} value={form.venueSpaceId || "none"} onValueChange={(value) => setForm((current) => ({ ...current, venueSpaceId: value === "none" ? "" : value }))} disabled={!form.venueId || loadingSpaces}><SelectTrigger className="w-full"><SelectValue placeholder={loadingSpaces ? "空间加载中…" : "整个场地"} /></SelectTrigger><SelectContent><SelectItem value="none">整个场地</SelectItem>{spaceOptions.slice(1).map((space) => <SelectItem key={space.value} value={space.value}>{space.label}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">选择具体空间后，只约束该空间；留空表示整个场地。</p></label>
    <label className="space-y-1.5"><span className="text-sm font-medium">使用场景</span><Select items={purposeOptions} value={form.purpose} onValueChange={(value) => setForm((current) => ({ ...current, purpose: value }))}><SelectTrigger className="w-full"><SelectValue placeholder="选择使用场景" /></SelectTrigger><SelectContent>{purposeOptions.map((purposeOption) => <SelectItem key={purposeOption.value} value={purposeOption.value}>{purposeOption.label}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">描述这个地点在活动中的实际用途，与默认地点设置相互独立。</p></label>
    <div className="flex items-center justify-between gap-3 border-y py-3"><div><p className="text-sm font-medium">是否是默认地点</p><p className="mt-1 text-xs text-muted-foreground">一个活动只能有一个默认地点；设置后会替换当前默认地点。</p></div><Switch checked={form.isPrimary} onCheckedChange={(checked) => setForm((current) => ({ ...current, isPrimary: checked }))} aria-label="是否是默认地点" /></div>
    <label className="space-y-1.5"><span className="text-sm font-medium">备注</span><Input value={form.notes} maxLength={500} placeholder="备注（可选）" onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button type="submit" disabled={busy || !canWrite || !form.venueId}>{busy ? "保存中…" : form.id ? "保存" : "添加"}</Button></DialogFooter>
  </form>;
}

function ProductionLocationRow({ location, index, count, canWrite, reorderable, pendingPrimaryId, onEdit, onRemove, onMove, onPrimaryToggle }) {
  const grid = locationGridClassName(canWrite);
  return <SortableItem value={location.id} disabled={!reorderable} className="border-b last:border-b-0"><div className={`${grid} py-3 transition-colors hover:bg-muted/40`}>
    {reorderable ? <SortableItemHandle className="flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`拖动${locationName(location)}调整排序`} title="拖动调整排序"><GripVertical className="size-4" /></SortableItemHandle> : <span className="size-7" aria-hidden="true" />}
    <Badge variant="outline" className="hidden size-7 justify-center px-0 tabular-nums sm:inline-flex">{index + 1}</Badge>
    <MapPin className="hidden size-4 text-muted-foreground sm:block" />
    <div className="min-w-0"><p className="truncate text-sm font-medium">{locationName(location)}</p><p className="mt-1 truncate text-xs text-muted-foreground md:hidden">{location.notes || "地点关联"}</p></div>
    <Badge variant="outline" className="justify-self-start">{purposeLabel(location.purpose)}</Badge>
    <div className="flex w-full items-center justify-center"><Switch className="duration-200 ease-out" checked={Boolean(location.isPrimary)} disabled={!canWrite || pendingPrimaryId === location.id} onCheckedChange={(checked) => onPrimaryToggle(location, checked)} aria-label={`${location.isPrimary ? "取消" : "设为"}默认地点：${locationName(location)}`} /></div>
    <p className="hidden truncate text-xs text-muted-foreground md:block">{location.notes || "—"}</p>
    {canWrite && <div className="flex items-center justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" disabled={!reorderable || index === 0} onClick={() => onMove(index, -1)} aria-label="上移地点" title="上移地点"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-sm" disabled={!reorderable || index === count - 1} onClick={() => onMove(index, 1)} aria-label="下移地点" title="下移地点"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(location)} aria-label="编辑活动地点" title="编辑活动地点"><Pencil /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onRemove(location)} aria-label="移除活动地点" title="移除活动地点"><Trash2 /></Button></div>}
  </div></SortableItem>;
}

function LocationManagementSkeleton({ canWrite }) {
  return <Card variant="flush"><CardContent className="divide-y p-0">{Array.from({ length: 5 }, (_, index) => <div key={index} className={`${locationGridClassName(canWrite)} min-h-16 py-3`}><Skeleton className="size-7" /><Skeleton className="hidden size-7 sm:block" /><Skeleton className="hidden size-4 sm:block" /><div className="space-y-2"><Skeleton className="h-4 w-44" /><Skeleton className="h-3 w-28" /></div><Skeleton className="h-5 w-14" /><Skeleton className="h-5 w-16" /><Skeleton className="hidden h-4 w-28 md:block" />{canWrite && <Skeleton className="h-8 w-24" />}</div>)}</CardContent></Card>;
}

export function ProductionLocationsPage({ workspace, production, onChanged }) {
  const [locations, setLocations] = useState([]);
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [filterQuery, setFilterQuery] = useState(() => createFilterQuery());
  const [sort, setSort] = useState("sort_order");
  const [direction, setDirection] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingPrimaryId, setPendingPrimaryId] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setLocations(await listProductionLocations(production.id)); setError(null); }
    catch (nextError) { setLocations([]); setError(nextError); notify.error("无法加载活动地点", { description: nextError?.message || String(nextError) }); }
    finally { setLoading(false); }
  }, [production.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canManageLocations(workspace, production)) return undefined;
    let active = true;
    listResource(workspace.id, "venues", { limit: 200 }).then((result) => { if (active) setVenues(result.items.filter((venue) => venue.status !== "archived")); }).catch((nextError) => { if (active) notify.error("无法加载场地资源", { description: nextError?.message || String(nextError) }); });
    return () => { active = false; };
  }, [production, workspace]);
  const canWrite = canManageLocations(workspace, production);
  const filterState = useMemo(() => ({ purpose: filterValues(filterQuery, "purpose"), primary: filterValues(filterQuery, "primary") }), [filterQuery]);
  const visible = useMemo(() => locations.filter((location) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [location.venueName, location.spaceName, location.notes].some((value) => String(value || "").toLowerCase().includes(needle));
    const matchesPurpose = !filterState.purpose.length || filterState.purpose.includes(location.purpose === "primary" ? "other" : location.purpose);
    const matchesPrimary = !filterState.primary.length || filterState.primary.includes(location.isPrimary ? "default" : "other");
    return matchesSearch && matchesPurpose && matchesPrimary;
  }), [filterState, locations, search]);
  const sortedLocations = useMemo(() => [...visible].sort((left, right) => {
    const result = sort === "name" ? locationName(left).localeCompare(locationName(right), "zh-CN") : sort === "updated_at" ? new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime() : Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    return direction === "asc" ? result || String(left.id).localeCompare(String(right.id)) : -(result || String(left.id).localeCompare(String(right.id)));
  }), [direction, sort, visible]);
  const reorderable = canWrite && !search.trim() && getResourceFilterConditions(filterQuery).length === 0 && sort === "sort_order" && direction === "asc";
  const openEditor = (location) => setEditor(location ? { id: location.id } : { id: null });
  const remove = async (location) => {
    if (!canWrite || busy || !window.confirm("确定移除“" + locationName(location) + "”吗？")) return;
    setBusy(true); const toast = notify.loading("正在移除活动地点…");
    try { await deleteProductionLocation(production.id, location.id); notify.success("活动地点已移除", { id: toast }); await load(); onChanged?.(); }
    catch (nextError) { notify.error("移除活动地点失败", { id: toast, description: nextError?.message || String(nextError) }); }
    finally { setBusy(false); }
  };
  const setPrimary = async (location, checked) => {
    if (!canWrite || busy || pendingPrimaryId) return;
    const previous = locations;
    setPendingPrimaryId(location.id);
    setLocations((current) => current.map((item) => ({ ...item, isPrimary: checked ? item.id === location.id : item.id === location.id ? false : item.isPrimary })));
    const toast = notify.loading(checked ? "正在设置默认地点…" : "正在取消默认地点…");
    try {
      const saved = await updateProductionLocation(production.id, location.id, { is_primary: checked });
      setLocations((current) => current.map((item) => item.id === location.id ? { ...item, ...saved, isPrimary: Boolean(saved?.isPrimary ?? checked) } : checked ? { ...item, isPrimary: false } : item));
      notify.success(checked ? "默认地点已更新" : "已取消默认地点", { id: toast });
      onChanged?.();
    } catch (nextError) {
      setLocations(previous);
      notify.error(checked ? "设置默认地点失败" : "取消默认地点失败", { id: toast, description: nextError?.message || String(nextError) });
    } finally { setPendingPrimaryId(null); }
  };
  const move = async (index, delta) => {
    const target = index + delta; if (!reorderable || target < 0 || target >= sortedLocations.length || busy) return;
    const next = [...locations]; [next[index], next[target]] = [next[target], next[index]]; setLocations(next);
    try { await reorderProductionLocations(production.id, next.map((item, order) => ({ id: item.id, sort_order: order }))); notify.success("地点顺序已保存"); onChanged?.(); }
    catch (nextError) { setLocations(locations); notify.error("地点排序失败", { description: nextError?.message || String(nextError) }); }
  };
  const empty = error ? { icon: MapPin, title: "无法加载活动地点", description: error.message || String(error), action: <Button variant="outline" onClick={load}>重试</Button> } : { icon: MapPin, title: search || getResourceFilterConditions(filterQuery).length ? "没有匹配的活动地点" : "尚未添加活动地点", description: "从工作空间场地资源中选择本活动会使用的场地或空间。", action: canWrite ? <Button onClick={() => openEditor(null)}><Plus />添加地点</Button> : null };
  const content = <Card variant="flush"><CardContent className="p-0"><div className={`${locationGridClassName(canWrite)} hidden border-b bg-muted/30 py-2 text-xs text-muted-foreground md:grid`}><span aria-hidden="true" /><span className="text-center">位置</span><span aria-hidden="true" /><span>地点与空间</span><span>使用场景</span><span>默认地点</span><span>备注</span>{canWrite && <span aria-hidden="true" />}</div><Sortable value={sortedLocations} onValueChange={(next) => reorderable && setLocations(next)} onValueCommit={async (next, meta) => { if (!reorderable) return; try { await reorderProductionLocations(production.id, next.map((item, order) => ({ id: item.id, sort_order: order }))); notify.success("地点顺序已保存"); await load(); onChanged?.(); } catch (nextError) { setLocations(meta.previousValue); notify.error("地点排序失败", { description: nextError?.message || String(nextError) }); } }} getItemValue={(item) => item.id} strategy="vertical" className="divide-y-0">{sortedLocations.map((location, index) => <ProductionLocationRow key={location.id} location={location} index={index} count={sortedLocations.length} canWrite={canWrite} reorderable={reorderable} pendingPrimaryId={pendingPrimaryId} onEdit={openEditor} onRemove={remove} onMove={move} onPrimaryToggle={setPrimary} />)}</Sortable></CardContent></Card>;
  const filterFields = [purposeFilter, primaryFilter];
  const sortControls = <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">排序</span><Select items={[["sort_order", "排序位置"], ["name", "地点名称"], ["updated_at", "更新时间"]].map(([value, label]) => ({ value, label }))} value={sort} onValueChange={setSort}><SelectTrigger className="w-28" aria-label="排序字段"><SelectValue /></SelectTrigger><SelectContent>{[["sort_order", "排序位置"], ["name", "地点名称"], ["updated_at", "更新时间"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={direction === "asc" ? "切换为降序" : "切换为升序"}>{direction === "asc" ? <ArrowUp /> : <ArrowDown />}<span>{direction === "asc" ? "升序" : "降序"}</span></Button></div>;
  return <><ResourcePage title="场地与空间" description="配置本活动使用的场地、空间和地点顺序。" count={sortedLocations.length} search={{ value: search, onChange: setSearch, placeholder: "搜索场地、空间或备注…" }} filters={<><ResourceFilters fields={filterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />{sortControls}</>} showViewToggle={false} headerActions={canWrite ? <Button onClick={() => openEditor(null)}><Plus />添加地点</Button> : undefined} loading={loading} loadingContent={<LocationManagementSkeleton canWrite={canWrite} />} empty={sortedLocations.length ? null : empty} summary={reorderable ? <span className="inline-flex items-center gap-1"><GripVertical className="size-3" />可拖动调整地点顺序</span> : null}>{content}</ResourcePage><Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open && !busy) setEditor(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editor?.id ? "编辑活动地点" : "添加活动地点"}</DialogTitle><DialogDescription>选择工作空间场地资源，并配置使用场景和默认地点状态。</DialogDescription></DialogHeader><LocationDetail key={editor?.id || "new"} workspace={workspace} production={production} location={editor?.id ? locations.find((item) => item.id === editor.id) : null} venues={venues} locationCount={locations.length} busy={busy} onCancel={() => setEditor(null)} onSaved={async (saved) => { setEditor(null); await load(); onChanged?.(saved); }} /></DialogContent></Dialog></>;
}
