import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ClipboardList, ListTree, Plus, XCircle } from "@/components/ui/icons";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { PlanningToolbar } from "@/components/planning/planning-toolbar";
import { PlanningEmptyState } from "@/components/planning/planning-empty-state";
import { PlanningRecordDetail } from "@/components/planning/planning-record-detail";
import { StagePilotEventCalendar } from "@/components/reui/event-calendar/stagepilot-event-calendar";
import { ResourcePage, resourceGridClassName } from "@/components/resource-page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { appStore } from "@/lib/app-store";
import { listProductionOccurrences, listRehearsalSessions, listScheduleItems, updateProductionOccurrence, updateRehearsalSession, updateScheduleItem } from "@/lib/production-api";
import { TimeText } from "@/components/time-text";
import { notify } from "@/components/ui/sonner";
import { useWindowDetail } from "@/components/window-detail-context";

const configs = { occurrences: { title: "场次", description: "管理正式演出、预演和加演场。", icon: ListTree, views: [{ id: "list", label: "列表" }, { id: "grid", label: "网格" }, { id: "calendar", label: "日历" }], defaultView: "list", emptyTitle: "暂无场次安排", emptyDescription: "场次数据接入后，正式演出、预演和加演场会显示在这里。", type: "occurrence" }, rehearsals: { title: "彩排", description: "管理普通彩排、技术彩排和带妆彩排。", icon: ClipboardList, views: [{ id: "calendar", label: "日历" }, { id: "agenda", label: "议程" }], defaultView: "calendar", emptyTitle: "暂无彩排安排", emptyDescription: "彩排、技术彩排和带妆彩排接入后，会显示在这里。", type: "rehearsal" }, schedule: { title: "总日程", description: "查看装台、彩排、演出和撤台等制作时间安排。", icon: CalendarRange, views: [{ id: "list", label: "列表" }, { id: "calendar", label: "日历" }, { id: "timeline", label: "时间轴" }], defaultView: "list", emptyTitle: "暂无排程安排", emptyDescription: "后续可以在这里管理装台、彩排、演出和撤台等时间。", type: "schedule" } };
const kindLabels = { preview: "预演", performance: "正式演出", encore: "加演", rehearsal: "普通彩排", technical: "技术彩排", dress: "带妆彩排", cue_to_cue: "Cue-to-cue", load_in: "装台/进场", crew_call: "工作人员集合", technical_check: "技术检查", doors: "开门", break: "休息", strike: "撤台", travel: "转场", other: "其他" };
const statusLabels = { planned: "计划中", live: "进行中", completed: "已结束", canceled: "已取消" };
const statusClass = { planned: "bg-muted text-muted-foreground", live: "bg-emerald-500/10 text-emerald-700", completed: "bg-blue-500/10 text-blue-700", canceled: "bg-red-500/10 text-red-700" };

function titleOf(record, type) { return type === "schedule" ? record.title : record.name; }
function locationOf(record) { if (record.locations?.length) return record.locations.map((item) => `${item.venueName}${item.spaceName ? ` · ${item.spaceName}` : ""}`).join("、"); return record.venueName ? `${record.venueName}${record.spaceName ? ` · ${record.spaceName}` : ""}` : "未指定地点"; }
function RecordActions({ record, type, onEdit, onRefresh }) { const update = type === "schedule" ? updateScheduleItem : type === "rehearsal" ? updateRehearsalSession : updateProductionOccurrence; const action = async (status, label) => { if (status === "canceled" && !window.confirm("确定取消这条记录吗？取消后仍会保留历史记录。")) return; const toast = notify.loading(`正在${label}…`); try { await update(record.productionId, record.id, { status }); notify.success(`${label}成功`, { id: toast }); onRefresh(); } catch (error) { notify.error(`${label}失败`, { id: toast, description: error?.message || String(error) }); } }; return <div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => onEdit(record)}>编辑</Button>{record.status === "planned" && <Button size="sm" variant="ghost" onClick={() => action("live", "开始记录")}>开始</Button>}{record.status === "live" && <Button size="sm" variant="ghost" onClick={() => action("completed", "结束记录")}>结束</Button>}{record.status !== "completed" && record.status !== "canceled" && <Button size="sm" variant="ghost" onClick={() => action("canceled", "取消记录")}><XCircle className="size-3.5" />取消</Button>}</div>; }
function RecordRow({ record, type, timezone, onEdit, onRefresh }) { return <button type="button" className="flex w-full flex-wrap items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/40" onClick={() => onEdit(record)}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{titleOf(record, type)}</p><Badge variant="secondary">{kindLabels[record.itemType || record.kind] || record.itemType || record.kind}</Badge><Badge className={statusClass[record.status]} variant="secondary">{statusLabels[record.status] || record.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{record.scheduledStartAt ? <><TimeText instant={record.scheduledStartAt} timezone={timezone} />{record.scheduledEndAt ? <> — <TimeText instant={record.scheduledEndAt} timezone={timezone} /></> : null}</> : "尚未安排时间"} · {locationOf(record)}</p>{record.conflicts?.length ? <p className="mt-1 text-xs text-amber-600">存在 {record.conflicts.length} 个地点冲突</p> : null}</div><span onClick={(e) => e.stopPropagation()}><RecordActions record={record} type={type} onEdit={onEdit} onRefresh={onRefresh} /></span></button>; }

export function PlanningPage({ route, workspace, production }) {
  const page = configs[route.page] || configs.schedule; const { registerDetail, setDetailOpen } = useWindowDetail(); const triggerRef = useRef(null);
  const [view, setView] = useState(page.defaultView); const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [records, setRecords] = useState(null); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState(null); const [selected, setSelected] = useState(null);
  const requestIdRef = useRef(0);
  const recordsRef = useRef(null);
  recordsRef.current = records;
  const validViews = useMemo(() => new Set(page.views.map((item) => item.id)), [page]);
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const hasRecords = Array.isArray(recordsRef.current);
    setError(null);
    if (hasRecords) setRefreshing(true);
    else setLoading(true);
    try {
      const nextRecords = page.type === "schedule" ? await listScheduleItems(production.id) : page.type === "rehearsal" ? await listRehearsalSessions(production.id) : await listProductionOccurrences(production.id);
      if (requestId !== requestIdRef.current) return;
      setRecords(nextRecords);
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(nextError);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page.type, production.id]);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    recordsRef.current = null;
    setRecords(null);
    appStore.get(`planningView:${production.id}:${route.page}`).then((stored) => active && validViews.has(stored) && setView(stored)).catch(() => {});
    load();
    return () => { active = false; requestIdRef.current = Math.max(requestIdRef.current, requestId + 1); };
  }, [load, production.id, route.page, validViews]);
  useEffect(() => { const cleanup = registerDetail({ key: `planning-${production.id}-${page.type}`, storageKey: `detailPane:planning:${production.id}:${page.type}:v1`, triggerRef, detailLabel: `${page.title}详情`, getDetail: () => selected ? <PlanningRecordDetail production={production} entityType={page.type} record={selected.draft ? null : selected} onSaved={(result) => { setSelected(result); load(); }} /> : null }); if (selected) setDetailOpen(true, { announce: false }); return cleanup; }, [page.type, page.title, production, selected, registerDetail, setDetailOpen, load]);
  const open = (record) => { setSelected(record ? { ...record, draft: false } : { draft: true }); setDetailOpen(true); };
  const changeView = (next) => { if (!validViews.has(next)) return; setView(next); appStore.set(`planningView:${production.id}:${route.page}`, next).catch(() => {}); };
  const visible = (records || []).filter((item) => (!query.trim() || titleOf(item, page.type).toLowerCase().includes(query.trim().toLowerCase())) && (status === "all" || item.status === status));
  const events = visible.filter((item) => item.scheduledStartAt).map((item) => ({ id: item.id, title: titleOf(item, page.type), start: new Date(item.scheduledStartAt), end: new Date(item.scheduledEndAt || item.scheduledStartAt), color: item.status === "canceled" ? "gray" : "blue" }));
  let content = loading && !records ? <Card><CardContent className="p-8 text-sm text-muted-foreground">正在加载{page.title}…</CardContent></Card> : !visible.length ? <PlanningEmptyState icon={page.icon} title={query ? "没有匹配的安排" : error ? `无法加载${page.title}` : page.emptyTitle} description={query ? "请尝试其他搜索关键词。" : error ? error.message : page.emptyDescription} /> : <div className="space-y-3">{error && <Card><CardContent className="flex items-center justify-between gap-3 p-3 text-sm text-destructive"><span>{error.message}</span><Button size="sm" variant="outline" onClick={load}>重试</Button></CardContent></Card>}{view === "calendar" ? <div className="space-y-4"><StagePilotEventCalendar defaultView="month" timeZone={production.timezone} events={events} interactions={{ drag: false, resize: false, selectSlot: false }} onEventClick={(event) => open(records.find((item) => item.id === event.id))} /><Card><CardContent className="p-0">{visible.map((record) => <RecordRow key={record.id} record={record} type={page.type} timezone={production.timezone} onEdit={open} onRefresh={load} />)}</CardContent></Card></div> : view === "grid" ? <div className={resourceGridClassName}>{visible.map((record) => <Card key={record.id} className="cursor-pointer" onClick={() => open(record)}><CardContent className="space-y-3 p-4"><p className="font-medium">{titleOf(record, page.type)}</p><p className="text-sm text-muted-foreground">{kindLabels[record.itemType || record.kind] || record.itemType || record.kind}</p><Badge className={statusClass[record.status]} variant="secondary">{statusLabels[record.status]}</Badge><p className="text-sm text-muted-foreground">{record.scheduledStartAt ? <TimeText instant={record.scheduledStartAt} timezone={production.timezone} /> : "尚未安排时间"}</p></CardContent></Card>)}</div> : <Card><CardContent className="p-0">{visible.map((record) => <RecordRow key={record.id} record={record} type={page.type} timezone={production.timezone} onEdit={open} onRefresh={load} />)}</CardContent></Card>}</div>;
  return <div className="space-y-5" ref={triggerRef}><ProductionPageHeader workspace={workspace} production={production} title={page.title} subtitle={route.meta.description || page.description} actions={<Button onClick={() => open(null)}><Plus className="size-4" />新建{page.type === "schedule" ? "安排" : page.type === "rehearsal" ? "彩排" : "场次"}</Button>} /><PlanningToolbar title={page.title} query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} views={page.views} view={view} onViewChange={changeView} /><ResourcePage title="" description="" count={visible.length} showViewToggle={false} search={{ value: "", onChange: () => {} }} loading={false} summary={refreshing ? <span className="text-xs text-muted-foreground">正在刷新…</span> : null}><div>{content}</div></ResourcePage></div>;
}
