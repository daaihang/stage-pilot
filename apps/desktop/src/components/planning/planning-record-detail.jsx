import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DateTimePicker } from "@/components/reui/date-time-picker";
import { listProductionLocations, listProductionOccurrences, listRehearsalSessions, createProductionOccurrence, createRehearsalSession, createScheduleItem, updateProductionOccurrence, updateRehearsalSession, updateScheduleItem } from "@/lib/production-api";
import { notify } from "@/components/ui/sonner";
import { DetailFormLayout } from "@/components/detail-form-layout";
import { FormActionBar } from "@/components/form-action-bar";

const occurrenceKinds = [["preview", "预演"], ["performance", "正式演出"], ["encore", "加演"], ["other", "其他"]];
const rehearsalKinds = [["rehearsal", "普通彩排"], ["technical", "技术彩排"], ["dress", "带妆彩排"], ["cue_to_cue", "Cue-to-cue"], ["other", "其他"]];
const itemKinds = [["load_in", "装台/进场"], ["crew_call", "工作人员集合"], ["technical_check", "技术检查"], ["rehearsal", "彩排"], ["doors", "开门"], ["performance", "演出"], ["break", "休息"], ["strike", "撤台"], ["travel", "转场"], ["other", "其他"]];
const statusLabels = { planned: "计划中", live: "进行中", completed: "已结束", canceled: "已取消" };

export function PlanningRecordDetail({ production, entityType, record, onSaved, occurrences = [] }) {
  const isSchedule = entityType === "schedule";
  const isRehearsal = entityType === "rehearsal";
  const [locations, setLocations] = useState([]);
  const [relatedOccurrences, setRelatedOccurrences] = useState(occurrences); const [relatedRehearsals, setRelatedRehearsals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ title: "", name: "", kind: isRehearsal ? "rehearsal" : isSchedule ? "other" : "performance", contextType: "production", occurrenceId: "", start: "", end: "", locationId: "", locationIds: [], notes: "" });
  const options = useMemo(() => isSchedule ? itemKinds : isRehearsal ? rehearsalKinds : occurrenceKinds, [isRehearsal, isSchedule]);

  useEffect(() => {
    let active = true;
    listProductionLocations(production.id).then((items) => active && setLocations(items)).catch(() => active && setLocations([]));
    if (isRehearsal) listProductionOccurrences(production.id).then((items) => active && setRelatedOccurrences(items)).catch(() => {});
    if (isSchedule) listRehearsalSessions(production.id).then((items) => active && setRelatedRehearsals(items)).catch(() => {});
    const source = record || {};
    setForm({ title: source.title || "", name: source.name || "", kind: source.itemType || source.kind || (isRehearsal ? "rehearsal" : isSchedule ? "other" : "performance"), contextType: source.contextType || "production", occurrenceId: source.occurrenceId || "", start: source.scheduledStartAt || "", end: source.scheduledEndAt || "", locationId: source.productionLocationId || "", locationIds: source.productionLocationIds || [], notes: source.notes || "" });
    return () => { active = false; };
  }, [production.id, production.timezone, record, isRehearsal]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const title = (isSchedule ? form.title : form.name).trim();
    if (!title) { const message = "请输入名称"; setError(message); notify.error(message); return; }
    if (form.start && form.end && new Date(form.end) < new Date(form.start)) { const message = "结束时间不能早于开始时间"; setError(message); notify.error(message); return; }
    setBusy(true); const toast = notify.loading(record ? "正在保存…" : "正在创建…");
    try {
    const payload = isSchedule ? { title, item_type: form.kind, context_type: form.contextType, occurrence_id: form.contextType === "occurrence" ? form.occurrenceId || null : null, rehearsal_session_id: form.contextType === "rehearsal" ? form.occurrenceId || null : null, scheduled_start_at: form.start || null, scheduled_end_at: form.end || null, production_location_ids: form.locationIds, notes: form.notes.trim() } : { name: title, kind: form.kind, occurrence_id: isRehearsal ? form.occurrenceId || null : undefined, scheduled_start_at: form.start || null, scheduled_end_at: form.end || null, production_location_id: form.locationId || null, notes: form.notes.trim() };
      const result = record ? (isSchedule ? await updateScheduleItem(production.id, record.id, payload) : isRehearsal ? await updateRehearsalSession(production.id, record.id, payload) : await updateProductionOccurrence(production.id, record.id, payload)) : (isSchedule ? await createScheduleItem(production.id, payload) : isRehearsal ? await createRehearsalSession(production.id, payload) : await createProductionOccurrence(production.id, payload));
      notify.success(record ? "已保存" : "已创建", { id: toast }); onSaved(result);
    } catch (error) { setError(error); notify.error(record ? "保存失败" : "创建失败", { id: toast, description: error?.message || String(error) }); } finally { setBusy(false); }
  };
  const status = record?.status;
  return <DetailFormLayout scrollBoundary="parent" onSubmit={submit} busy={busy} error={error} contentClassName="space-y-5 p-4 md:p-6" actions={<FormActionBar busy={busy} submitLabel={record ? "保存" : "创建"} busyLabel={record ? "保存中…" : "创建中…"} />}>
    <div><p className="text-lg font-semibold">{record ? "编辑" : "新建"}{isSchedule ? "安排" : isRehearsal ? "彩排" : "场次"}</p><p className="mt-1 text-sm text-muted-foreground">时间记录现场安排，不代表活动项目周期。</p></div>
    {status && <Badge variant="secondary" className="w-fit">{statusLabels[status] || status}</Badge>}
    <label className="space-y-1.5"><span className="text-sm font-medium">{isSchedule ? "安排名称" : isRehearsal ? "彩排名称" : "场次名称"}</span><Input value={isSchedule ? form.title : form.name} onChange={(e) => set(isSchedule ? "title" : "name", e.target.value)} maxLength={160} autoFocus /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-sm font-medium">类型</span><Select value={form.kind} onValueChange={(value) => set("kind", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><div className="space-y-1.5"><span className="text-sm font-medium">时间解释</span><div className="flex h-9 items-center border bg-muted/30 px-3 text-sm text-muted-foreground">继承活动时区：{production.timezone || "Asia/Shanghai"}</div></div></div>
    {isSchedule && <label className="space-y-1.5"><span className="text-sm font-medium">所属上下文</span><Select value={form.contextType} onValueChange={(value) => set("contextType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">项目级</SelectItem><SelectItem value="occurrence">场次</SelectItem><SelectItem value="rehearsal">彩排</SelectItem></SelectContent></Select></label>}
    {isSchedule && form.contextType !== "production" && <label className="space-y-1.5"><span className="text-sm font-medium">关联记录</span><Select value={form.occurrenceId || "none"} onValueChange={(value) => set("occurrenceId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">请选择</SelectItem>{(form.contextType === "occurrence" ? relatedOccurrences : relatedRehearsals).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>}
    {isRehearsal && <label className="space-y-1.5"><span className="text-sm font-medium">关联场次</span><Select value={form.occurrenceId || "none"} onValueChange={(value) => set("occurrenceId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联场次</SelectItem>{relatedOccurrences.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>}
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-sm font-medium">计划开始</span><DateTimePicker value={form.start} timezone={production.timezone} step={15} onChange={(value) => set("start", value)} /></label><label className="space-y-1.5"><span className="text-sm font-medium">计划结束</span><DateTimePicker value={form.end} timezone={production.timezone} step={15} onChange={(value) => set("end", value)} /></label></div>
    {isSchedule ? <fieldset className="space-y-2"><legend className="text-sm font-medium">地点资源</legend>{locations.length ? locations.map((location) => <label key={location.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.locationIds.includes(location.id)} onChange={(e) => set("locationIds", e.target.checked ? [...form.locationIds, location.id] : form.locationIds.filter((id) => id !== location.id))} /><span>{location.venueName}{location.spaceName ? ` · ${location.spaceName}` : " · 整个场地"}</span></label>) : <p className="text-sm text-muted-foreground">尚未配置活动地点</p>}</fieldset> : <label className="space-y-1.5"><span className="text-sm font-medium">地点</span><Select value={form.locationId || "none"} onValueChange={(value) => set("locationId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指定地点</SelectItem>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.venueName}{location.spaceName ? ` · ${location.spaceName}` : ""}</SelectItem>)}</SelectContent></Select></label>}
    <label className="space-y-1.5"><span className="text-sm font-medium">备注</span><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} /></label>
  </DetailFormLayout>;
}
