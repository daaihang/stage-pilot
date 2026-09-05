import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, MapPin, Pencil, Plus, Star, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ResourcePage, resourceGridClassName } from "@/components/resource-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { useWindowDetail } from "@/components/window-detail-context";
import { listResource, listVenueSpaces } from "@/lib/resource-api";
import { createProductionLocation, deleteProductionLocation, listProductionLocations, reorderProductionLocations, updateProductionLocation } from "@/lib/production-api";

export const productionLocationPurposes = [["primary", "主地点"], ["performance", "演出"], ["rehearsal", "排练"], ["office", "办公"], ["other", "其他"]];
const purposeLabel = (value) => productionLocationPurposes.find(([key]) => key === value)?.[1] || value || "其他";
const locationName = (location) => (location.venueName || "未命名场地") + (location.spaceName ? " · " + location.spaceName : " · 整个场地");
const canManageLocations = (workspace, production) => ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");

function initialForm(location) {
  return { id: location?.id || null, venueId: location?.venueId || "", venueSpaceId: location?.venueSpaceId || "", purpose: location?.purpose || "primary", isPrimary: Boolean(location?.isPrimary), notes: location?.notes || "" };
}

function LocationDetail({ workspace, production, location, venues, busy, onSaved, onCancel }) {
  const [form, setForm] = useState(() => initialForm(location));
  const [spaces, setSpaces] = useState([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [error, setError] = useState("");
  const canWrite = canManageLocations(workspace, production);
  const venueOptions = useMemo(() => venues.map((venue) => ({ value: venue.id, label: venue.name })), [venues]);
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
      const saved = form.id ? await updateProductionLocation(production.id, form.id, payload) : await createProductionLocation(production.id, { ...payload, sort_order: 0 });
      notify.success(form.id ? "活动地点已保存" : "活动地点已添加", { id: toast });
      onSaved(saved);
    } catch (nextError) {
      const message = nextError?.message || String(nextError);
      setError(message);
      notify.error(form.id ? "保存活动地点失败" : "添加活动地点失败", { id: toast, description: message });
    }
  };
  return <form className="flex min-h-full flex-col gap-5" onSubmit={submit}>
    <div className="border-b pb-4"><p className="text-lg font-semibold">{form.id ? "编辑活动地点" : "添加活动地点"}</p><p className="mt-1 text-sm text-muted-foreground">选择工作空间场地资源，并配置本活动的使用方式。</p></div>
    <label className="space-y-1.5"><span className="text-sm font-medium">场地</span><Combobox items={venueOptions} value={venueOptions.find((item) => item.value === form.venueId) || null} onValueChange={(item) => setForm((current) => ({ ...current, venueId: item?.value || "", venueSpaceId: "" }))} itemToStringValue={(item) => item?.value || ""} itemToStringLabel={(item) => item?.label || ""}><ComboboxInput className="w-full" placeholder="搜索并选择场地" /><ComboboxContent><ComboboxEmpty>没有匹配的场地</ComboboxEmpty><ComboboxList>{venueOptions.map((venue) => <ComboboxItem key={venue.value} value={venue}>{venue.label}</ComboboxItem>)}</ComboboxList></ComboboxContent></Combobox></label>
    <label className="space-y-1.5"><span className="text-sm font-medium">空间</span><Select value={form.venueSpaceId || "none"} onValueChange={(value) => setForm((current) => ({ ...current, venueSpaceId: value === "none" ? "" : value }))} disabled={!form.venueId || loadingSpaces}><SelectTrigger className="w-full"><SelectValue placeholder={loadingSpaces ? "空间加载中…" : "整个场地"} /></SelectTrigger><SelectContent><SelectItem value="none">整个场地</SelectItem>{spaces.filter((space) => space.status !== "archived").map((space) => <SelectItem key={space.id} value={space.id}>{space.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">选择具体空间后，只约束该空间；留空表示整个场地。</p></label>
    <label className="space-y-1.5"><span className="text-sm font-medium">用途</span><Select value={form.purpose} onValueChange={(value) => setForm((current) => ({ ...current, purpose: value }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{productionLocationPurposes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))} />设为活动主地点</label>
    <label className="space-y-1.5"><span className="text-sm font-medium">备注</span><Input value={form.notes} maxLength={500} placeholder="备注（可选）" onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="mt-auto flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button type="submit" disabled={busy || !canWrite || !form.venueId}>{busy ? "保存中…" : form.id ? "保存" : "添加"}</Button></div>
  </form>;
}

function LocationListItem({ location, index, count, canWrite, reorderable, onEdit, onRemove, onMove }) {
  return <SortableItem value={location.id} disabled={!reorderable} className="border-b last:border-b-0"><div className="flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4"><SortableItemHandle className="flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted" disabled={!reorderable} aria-label={reorderable ? "拖动" + locationName(location) + "调整排序" : "清除筛选后可调整排序"}><GripVertical className="size-4" /></SortableItemHandle><MapPin className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{locationName(location)}</p>{location.isPrimary && <Badge variant="secondary"><Star className="mr-1 size-3" />主地点</Badge>}<Badge variant="outline">{purposeLabel(location.purpose)}</Badge></div>{location.notes && <p className="mt-1 truncate text-xs text-muted-foreground">{location.notes}</p>}</div>{canWrite && <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" size="icon-sm" disabled={!reorderable || index === 0} onClick={() => onMove(index, -1)} aria-label="上移地点"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-sm" disabled={!reorderable || index === count - 1} onClick={() => onMove(index, 1)} aria-label="下移地点"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(location)} aria-label="编辑活动地点"><Pencil /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onRemove(location)} aria-label="移除活动地点"><Trash2 /></Button></div>}</div></SortableItem>;
}

export function ProductionLocationsPage({ workspace, production }) {
  const { registerDetail, setDetailOpen } = useWindowDetail();
  const [locations, setLocations] = useState([]);
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [purpose, setPurpose] = useState("all");
  const [primaryOnly, setPrimaryOnly] = useState("all");
  const [view, setView] = useState("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);
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
  const visible = useMemo(() => locations.filter((location) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [location.venueName, location.spaceName, location.notes].some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesSearch && (purpose === "all" || location.purpose === purpose) && (primaryOnly === "all" || (primaryOnly === "primary" ? location.isPrimary : !location.isPrimary));
  }), [locations, primaryOnly, purpose, search]);
  const reorderable = canWrite && !search.trim() && purpose === "all" && primaryOnly === "all";
  useEffect(() => {
    const unregister = registerDetail({ key: "production-locations:" + production.id, detailLabel: "活动地点", storageKey: "detailPane:production-locations:" + production.id + ":v2", triggerRef, onClose: () => setEditor(null), getDetail: () => editor ? <LocationDetail key={editor.id || "new"} workspace={workspace} production={production} location={editor.id ? locations.find((item) => item.id === editor.id) : null} venues={venues} busy={busy} onCancel={() => setDetailOpen(false)} onSaved={async () => { setEditor(null); setDetailOpen(false); await load(); }} /> : null });
    if (editor) setDetailOpen(true, { announce: false });
    return unregister;
  }, [busy, editor, load, locations, production, registerDetail, setDetailOpen, venues, workspace]);
  const openEditor = (location) => { setEditor(location ? { id: location.id } : { id: null }); setDetailOpen(true); };
  const remove = async (location) => {
    if (!canWrite || busy || !window.confirm("确定移除“" + locationName(location) + "”吗？")) return;
    setBusy(true); const toast = notify.loading("正在移除活动地点…");
    try { await deleteProductionLocation(production.id, location.id); notify.success("活动地点已移除", { id: toast }); await load(); }
    catch (nextError) { notify.error("移除活动地点失败", { id: toast, description: nextError?.message || String(nextError) }); }
    finally { setBusy(false); }
  };
  const move = async (index, delta) => {
    const target = index + delta; if (!reorderable || target < 0 || target >= locations.length || busy) return;
    const next = [...locations]; [next[index], next[target]] = [next[target], next[index]]; setLocations(next);
    try { await reorderProductionLocations(production.id, next.map((item, order) => ({ id: item.id, sort_order: order }))); notify.success("地点顺序已保存"); }
    catch (nextError) { setLocations(locations); notify.error("地点排序失败", { description: nextError?.message || String(nextError) }); }
  };
  const empty = error ? { icon: MapPin, title: "无法加载活动地点", description: error.message || String(error), action: <Button variant="outline" onClick={load}>重试</Button> } : { icon: MapPin, title: search || purpose !== "all" || primaryOnly !== "all" ? "没有匹配的活动地点" : "尚未添加活动地点", description: "从工作空间场地资源中选择本活动会使用的场地或空间。", action: canWrite ? <Button ref={triggerRef} onClick={() => openEditor(null)}><Plus />添加地点</Button> : null };
  const content = <Sortable value={visible} onValueChange={(next) => reorderable && setLocations(next)} onValueCommit={async (next, meta) => { if (!reorderable) return; try { await reorderProductionLocations(production.id, next.map((item, order) => ({ id: item.id, sort_order: order }))); notify.success("地点顺序已保存"); await load(); } catch (nextError) { setLocations(meta.previousValue); notify.error("地点排序失败", { description: nextError?.message || String(nextError) }); } }} getItemValue={(item) => item.id} strategy="vertical" className={view === "grid" ? resourceGridClassName : "divide-y"}>{visible.map((location, index) => view === "grid" ? <SortableItem key={location.id} value={location.id} disabled={!reorderable}><Card><CardHeader><div className="flex items-start justify-between gap-3"><MapPin className="size-5 text-muted-foreground" />{location.isPrimary && <Badge variant="secondary"><Star className="mr-1 size-3" />主地点</Badge>}</div><CardTitle className="truncate text-base">{locationName(location)}</CardTitle></CardHeader><CardContent className="flex items-center justify-between gap-2"><Badge variant="outline">{purposeLabel(location.purpose)}</Badge>{canWrite && <Button variant="ghost" size="icon-sm" onClick={() => openEditor(location)} aria-label="编辑活动地点"><Pencil /></Button>}</CardContent></Card></SortableItem> : <LocationListItem key={location.id} location={location} index={index} count={visible.length} canWrite={canWrite} reorderable={reorderable} onEdit={openEditor} onRemove={remove} onMove={move} />)}</Sortable>;
  return <ResourcePage title="场地与空间" description="配置本活动使用的场地、空间和地点顺序。" count={visible.length} search={{ value: search, onChange: setSearch, placeholder: "搜索场地、空间或备注…" }} filters={<><Select value={purpose} onValueChange={setPurpose}><SelectTrigger className="w-32" aria-label="按用途筛选"><SelectValue placeholder="用途" /></SelectTrigger><SelectContent><SelectItem value="all">全部用途</SelectItem>{productionLocationPurposes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={primaryOnly} onValueChange={setPrimaryOnly}><SelectTrigger className="w-32" aria-label="按主地点筛选"><SelectValue placeholder="地点类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部地点</SelectItem><SelectItem value="primary">仅主地点</SelectItem><SelectItem value="secondary">其他地点</SelectItem></SelectContent></Select></>} view={view} onViewChange={setView} headerActions={canWrite ? <Button ref={triggerRef} onClick={() => openEditor(null)}><Plus />添加地点</Button> : undefined} loading={loading} empty={visible.length ? null : empty} summary={reorderable ? <span>可拖动调整地点顺序</span> : null}>{content}</ResourcePage>;
}
