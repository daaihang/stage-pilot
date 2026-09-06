import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Pencil, Star } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { listProductionLocations } from "@/lib/production-api";
import { useWindowDetail } from "@/components/window-detail-context";
import { ProductionLocationsPage } from "@/components/production-locations-page";

const locationName = (location) => `${location.venueName || "未命名场地"}${location.spaceName ? ` · ${location.spaceName}` : " · 整个场地"}`;

export function ProductionLocations({ workspace, production, compact = false }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const triggerRef = useRef(null);
  const { registerDetail, setDetailOpen } = useWindowDetail();
  const canWrite = ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLocations(await listProductionLocations(production.id));
    } catch (error) {
      setLocations([]);
      notify.error("无法加载活动地点", { description: error?.message || String(error) });
    } finally {
      setLoading(false);
    }
  }, [production.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => registerDetail({
    key: `production-locations:${production.id}`,
    storageKey: `detailPane:production-locations:${production.id}:v2`,
    detailLabel: "活动地点",
    triggerRef,
    getDetail: () => <ProductionLocationsPage workspace={workspace} production={production} onChanged={load} key={production.id} />,
  }), [load, production, registerDetail, workspace]);
  const open = () => setDetailOpen(true);
  const primary = locations.find((location) => location.isPrimary);

  if (compact) {
    return <div className="flex items-center gap-2 text-sm"><MapPin className="size-4 text-muted-foreground" />{loading ? <span className="text-muted-foreground">地点加载中…</span> : primary ? <span className="truncate">{locationName(primary)}</span> : <span className="text-muted-foreground">地点待定</span>}<Button ref={triggerRef} type="button" variant="ghost" size="icon-xs" disabled={!canWrite} onClick={open} aria-label="打开活动地点" title="打开活动地点"><Pencil /></Button></div>;
  }

  return <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>活动地点</CardTitle><CardDescription>地点属于活动资源配置，排程记录会引用这里的场地和空间。</CardDescription></div><Button ref={triggerRef} type="button" variant="outline" size="sm" disabled={!canWrite} onClick={open}><Pencil />管理地点</Button></div></CardHeader><CardContent>{loading ? <p className="text-sm text-muted-foreground">地点加载中…</p> : locations.length ? <div className="divide-y">{locations.map((location) => <div key={location.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><MapPin className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{locationName(location)}</p>{location.notes && <p className="mt-1 truncate text-xs text-muted-foreground">{location.notes}</p>}</div>{location.isPrimary && <Badge variant="secondary"><Star className="mr-1 size-3" />主地点</Badge>}</div>)}</div> : <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">尚未添加活动地点。</p>{canWrite && <Button type="button" variant="outline" size="sm" onClick={open}>添加地点</Button>}</div>}</CardContent></Card>;
}
