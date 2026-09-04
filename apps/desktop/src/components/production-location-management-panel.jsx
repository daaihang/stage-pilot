import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowDown, ArrowUp, MapPin, Pencil, Plus, Star, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { useWindowDetail } from "@/components/window-detail-context";
import { listResource, listVenueSpaces } from "@/lib/resource-api";
import {
  createProductionLocation,
  deleteProductionLocation,
  listProductionLocations,
  reorderProductionLocations,
  updateProductionLocation,
} from "@/lib/production-api";

export const productionLocationPurposes = [
  ["primary", "主地点"],
  ["performance", "演出"],
  ["rehearsal", "排练"],
  ["office", "办公"],
  ["other", "其他"],
];

const purposeLabel = (value) => productionLocationPurposes.find(([key]) => key === value)?.[1] || value || "其他";
const canManageLocations = (workspace, production) => ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");
const locationName = (location) => `${location.venueName || "未命名场地"}${location.spaceName ? ` · ${location.spaceName}` : " · 整个场地"}`;

function initialLocationForm(location) {
  return {
    id: location?.id || null,
    venueId: location?.venueId || "",
    venueSpaceId: location?.venueSpaceId || "",
    purpose: location?.purpose || "primary",
    isPrimary: Boolean(location?.isPrimary),
    notes: location?.notes || "",
  };
}

function LocationForm({ form, venues, spaces, busy, error, onChange, onVenueChange, onCancel, onSubmit }) {
  const availableSpaces = spaces.filter((space) => space.status !== "archived");
  return (
    <form className="flex min-h-full flex-col gap-5 p-5" onSubmit={onSubmit}>
      <div className="flex items-start justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-lg font-semibold">{form.id ? "编辑活动地点" : "添加活动地点"}</p>
          <p className="mt-1 text-sm text-muted-foreground">选择本活动实际允许使用的场地或空间。</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>返回列表</Button>
      </div>

      <label className="space-y-1.5"><span className="text-sm font-medium">场地</span><Select value={form.venueId} onValueChange={onVenueChange} disabled={busy}><SelectTrigger className="w-full"><SelectValue placeholder="选择场地" /></SelectTrigger><SelectContent>{venues.map((venue) => <SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1.5"><span className="text-sm font-medium">空间</span><Select value={form.venueSpaceId || "none"} onValueChange={(value) => onChange("venueSpaceId", value === "none" ? "" : value)} disabled={busy || !form.venueId}><SelectTrigger className="w-full"><SelectValue placeholder="整个场地" /></SelectTrigger><SelectContent><SelectItem value="none">整个场地</SelectItem>{availableSpaces.map((space) => <SelectItem key={space.id} value={space.id}>{space.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">留空表示占用整个场地；选择空间后只约束该空间。</p></label>
      <label className="space-y-1.5"><span className="text-sm font-medium">用途</span><Select value={form.purpose} onValueChange={(value) => onChange("purpose", value)} disabled={busy}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{productionLocationPurposes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} disabled={busy} onChange={(event) => onChange("isPrimary", event.target.checked)} />设为活动主地点</label>
      <label className="space-y-1.5"><span className="text-sm font-medium">备注</span><Input value={form.notes} disabled={busy} maxLength={500} placeholder="备注（可选）" onChange={(event) => onChange("notes", event.target.value)} /></label>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button type="submit" disabled={busy || !form.venueId}>{busy ? "保存中…" : form.id ? "保存" : "添加"}</Button></div>
    </form>
  );
}

export function ProductionLocationManagementPanel({ workspace, production, onChanged }) {
  const canWrite = canManageLocations(workspace, production);
  const [locations, setLocations] = useState([]);
  const [venues, setVenues] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [editor, setEditor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLocations(await listProductionLocations(production.id));
      setError("");
    } catch (nextError) {
      setLocations([]);
      setError(nextError?.message || String(nextError));
      notify.error("无法加载活动地点", { description: nextError?.message || String(nextError) });
    } finally {
      setLoading(false);
    }
  }, [production.id]);

  const loadVenues = useCallback(async () => {
    if (!workspace?.id || !canWrite) return;
    try {
      const result = await listResource(workspace.id, "venues", { limit: 200 });
      setVenues(result.items.filter((venue) => venue.status !== "archived"));
    } catch (nextError) {
      setVenues([]);
      notify.error("无法加载场地资源", { description: nextError?.message || String(nextError) });
    }
  }, [canWrite, workspace?.id]);

  useEffect(() => { load(); loadVenues(); }, [load, loadVenues]);

  const loadSpaces = useCallback(async (venueId) => {
    if (!venueId || !workspace?.id) {
      setSpaces([]);
      return;
    }
    try {
      setSpaces(await listVenueSpaces(workspace.id, venueId));
    } catch (nextError) {
      setSpaces([]);
      notify.error("无法加载场地空间", { description: nextError?.message || String(nextError) });
    }
  }, [workspace?.id]);

  const beginCreate = () => {
    setError("");
    setSpaces([]);
    setEditor({ ...initialLocationForm(), isPrimary: locations.length === 0 });
  };

  const beginEdit = (location) => {
    setError("");
    setEditor(initialLocationForm(location));
    loadSpaces(location.venueId);
  };

  const updateForm = (key, value) => setEditor((current) => ({ ...current, [key]: value }));
  const changeVenue = (venueId) => {
    setEditor((current) => ({ ...current, venueId, venueSpaceId: "" }));
    loadSpaces(venueId);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!editor?.venueId || busy) return;
    setBusy(true);
    setError("");
    const toast = notify.loading(editor.id ? "正在保存活动地点…" : "正在添加活动地点…");
    const payload = {
      venue_id: editor.venueId,
      // Explicit null is intentional: the API uses it to clear a selected space.
      venue_space_id: editor.venueSpaceId || null,
      purpose: editor.purpose,
      is_primary: editor.isPrimary,
      notes: editor.notes.trim(),
    };
    try {
      if (editor.id) await updateProductionLocation(production.id, editor.id, payload);
      else await createProductionLocation(production.id, { ...payload, sort_order: locations.length });
      notify.success(editor.id ? "活动地点已保存" : "活动地点已添加", { id: toast });
      setEditor(null);
      await load();
      onChanged?.();
    } catch (nextError) {
      const message = nextError?.message || String(nextError);
      setError(message);
      notify.error(editor.id ? "保存活动地点失败" : "添加活动地点失败", { id: toast, description: message });
    } finally {
      setBusy(false);
    }
  };

  const setPrimary = async (location) => {
    if (busy) return;
    setBusy(true);
    const toast = notify.loading("正在设置主地点…");
    try {
      await updateProductionLocation(production.id, location.id, { is_primary: true });
      notify.success("主地点已更新", { id: toast });
      await load();
      onChanged?.();
    } catch (nextError) {
      notify.error("设置主地点失败", { id: toast, description: nextError?.message || String(nextError) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (location) => {
    if (busy || !window.confirm(`确定移除“${locationName(location)}”吗？`)) return;
    setBusy(true);
    const toast = notify.loading("正在移除活动地点…");
    try {
      await deleteProductionLocation(production.id, location.id);
      notify.success("活动地点已移除", { id: toast });
      await load();
      onChanged?.();
    } catch (nextError) {
      const description = nextError?.status === 409 ? nextError.message || "该地点仍被排程记录引用，请先解除引用。" : nextError?.message || String(nextError);
      notify.error("移除活动地点失败", { id: toast, description });
    } finally {
      setBusy(false);
    }
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (busy || target < 0 || target >= locations.length) return;
    const next = [...locations];
    [next[index], next[target]] = [next[target], next[index]];
    setLocations(next);
    try {
      await reorderProductionLocations(production.id, next.map((item, order) => ({ id: item.id, sort_order: order })));
      notify.success("地点顺序已保存");
      onChanged?.();
    } catch (nextError) {
      notify.error("地点排序失败", { description: nextError?.message || String(nextError) });
      await load();
    }
  };

  if (editor) {
    return <LocationForm form={editor} venues={venues} spaces={spaces} busy={busy} error={error} onChange={updateForm} onVenueChange={changeVenue} onCancel={() => !busy && setEditor(null)} onSubmit={save} />;
  }

  return (
    <section className="flex min-h-full flex-col p-5">
      <header className="flex items-start justify-between gap-3 border-b pb-4">
        <div><p className="text-lg font-semibold">活动地点</p><p className="mt-1 text-sm text-muted-foreground">管理本活动可使用的场地和空间资源。</p></div>
        {canWrite && <Button type="button" size="sm" onClick={beginCreate} disabled={busy || !venues.length}><Plus />添加地点</Button>}
      </header>
      {!canWrite && <p className="mt-4 text-sm text-muted-foreground">当前角色只能查看活动地点。</p>}
      {loading ? <p className="py-8 text-sm text-muted-foreground">地点加载中…</p> : error && !locations.length ? <div className="space-y-3 py-8"><p className="text-sm text-destructive" role="alert">{error}</p><Button type="button" variant="outline" size="sm" onClick={load}>重试</Button></div> : locations.length ? <div className="divide-y">{locations.map((location, index) => <div key={location.id} className="flex items-start gap-3 py-4"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{locationName(location)}</p><div className="mt-1 flex flex-wrap gap-1">{location.isPrimary && <Badge variant="secondary"><Star className="mr-1 size-3" />主地点</Badge>}<Badge variant="outline">{purposeLabel(location.purpose)}</Badge></div>{location.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{location.notes}</p>}</div>{canWrite && <div className="flex shrink-0 items-center gap-0.5"><Button type="button" variant="ghost" size="icon-sm" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label="上移地点" title="上移地点"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-sm" disabled={busy || index === locations.length - 1} onClick={() => move(index, 1)} aria-label="下移地点" title="下移地点"><ArrowDown /></Button>{!location.isPrimary && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPrimary(location)}>设为主地点</Button>}<Button type="button" variant="ghost" size="icon-sm" disabled={busy} onClick={() => beginEdit(location)} aria-label="编辑活动地点" title="编辑活动地点"><Pencil /></Button><Button type="button" variant="ghost" size="icon-sm" disabled={busy} onClick={() => remove(location)} aria-label="移除活动地点" title="移除活动地点"><Trash2 /></Button></div>}</div>)}</div> : <div className="py-10 text-center"><MapPin className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">尚未添加活动地点</p><p className="mt-1 text-xs text-muted-foreground">从工作空间场地资源中选择本活动会使用的场地。</p></div>}
      {canWrite && !venues.length && !loading && <p className="mt-auto border-t pt-4 text-xs text-muted-foreground">请先在工作空间场地库中创建可用场地。</p>}
    </section>
  );
}

export function useProductionLocationDetail({ workspace, production, triggerRef, onChanged }) {
  const { registerDetail, setDetailOpen } = useWindowDetail();
  const workspaceRef = useRef(workspace);
  const productionRef = useRef(production);
  const changedRef = useRef(onChanged);
  workspaceRef.current = workspace;
  productionRef.current = production;
  changedRef.current = onChanged;

  useEffect(() => registerDetail({
    key: `production-locations:${production.id}`,
    detailLabel: "活动地点",
    triggerRef,
    storageKey: `detailPane:production-locations:${production.id}:v1`,
    getDetail: () => <ProductionLocationManagementPanel workspace={workspaceRef.current} production={productionRef.current} onChanged={() => changedRef.current?.()} />,
  }), [production.id, registerDetail, triggerRef]);

  return useMemo(() => ({ open: () => setDetailOpen(true, { announce: false }) }), [setDetailOpen]);
}
