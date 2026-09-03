import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, CalendarClock, CheckCircle2, ChevronLeft, Circle, ClipboardCheck, Copy, FileText, MapPin, MoreHorizontal, Pencil, Sparkles, Trash2, UsersRound, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatProductionInstant } from "@/lib/production-api";
import { productionStatus, workspacePath } from "@/lib/navigation";

const draftNamePattern = /^活动-\d+$/;

function toDatetimeLocal(instant, timezone) {
  if (!instant) return "";
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(instant));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  } catch { return ""; }
}

function fromDatetimeLocal(value) { return value ? new Date(value).toISOString() : ""; }

function ChecklistItem({ complete, icon: Icon, title, description, future = false }) {
  return <div className="flex items-start gap-3 border-b py-3 last:border-b-0"><div className="mt-0.5">{complete ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}</div><Icon className="mt-0.5 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>{future && <Badge variant="outline">即将开放</Badge>}</div>;
}

function ProductionActions({ isDraft, onDiscard }) {
  const [discardOpen, setDiscardOpen] = useState(false);
  return <>
    <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="活动操作"><MoreHorizontal /></Button>} /><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>活动操作</DropdownMenuLabel><DropdownMenuItem disabled><Copy />复制活动</DropdownMenuItem><DropdownMenuItem disabled><Archive />归档活动</DropdownMenuItem>{isDraft && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDiscardOpen(true)}><Trash2 />放弃草稿</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent><DialogHeader><DialogTitle>放弃这个前端草稿？</DialogTitle><DialogDescription>它仅保存在当前会话，放弃后无法恢复，也不会影响任何后端活动。</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>取消</DialogClose><Button variant="destructive" onClick={() => { setDiscardOpen(false); onDiscard?.(); }}>放弃草稿</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function InlineField({ value, displayValue, label, multiline = false, type = "text", placeholder, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  const commit = async () => {
    if (saving) return;
    const next = type === "text" ? draft.trim() : draft;
    if (next === (value || "")) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok !== false) setEditing(false);
  };
  if (editing) {
    const props = { value: draft, autoFocus: true, disabled: saving, placeholder, onChange: (event) => setDraft(event.target.value), onBlur: commit, onKeyDown: (event) => { if (event.key === "Enter" && !multiline) { event.preventDefault(); commit(); } if (event.key === "Escape") { setDraft(value || ""); setEditing(false); } } };
    return multiline ? <textarea {...props} className="min-h-24 w-full resize-y border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" maxLength={500} /> : <Input {...props} type={type} maxLength={type === "text" ? 160 : undefined} />;
  }
  return <div className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1 whitespace-pre-wrap">{displayValue || placeholder || "未设置"}</span><Button variant="ghost" size="icon-xs" aria-label={`编辑${label}`} title={`编辑${label}`} onClick={() => setEditing(true)}><Pencil /></Button></div>;
}

function ProductionSummary({ production, editing, form, setField, onSave }) {
  const fields = [[CalendarClock, "开始时间", "startsAt", "datetime-local"], [CalendarClock, "结束时间", "endsAt", "datetime-local"], [MapPin, "地点", "venue", "text"], [CalendarClock, "时区", "timezone", "text"]];
  return <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{fields.map(([Icon, label, key, type]) => {
    const raw = editing ? form[key] : production[key];
    const display = raw ? (key === "venue" || key === "timezone" ? raw : formatProductionInstant(raw, production.timezone)) : (key === "venue" ? "待接入场地库" : "未设置");
    return <Card key={key}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="flex min-h-8 items-center gap-2 text-lg"><Icon className="size-4 shrink-0 text-muted-foreground" />{editing ? <Input type={type} value={type === "datetime-local" ? toDatetimeLocal(raw, production.timezone) : raw || ""} onChange={(event) => setField(key, type === "datetime-local" ? fromDatetimeLocal(event.target.value) : event.target.value)} onBlur={() => onSave(key)} placeholder={label} maxLength={160} /> : <InlineField value={raw} displayValue={display} label={label} onSave={(value) => onSave(key, value)} />}</CardTitle></CardHeader></Card>;
  })}</section>;
}

export function ProductionOverviewPage({ workspace, production, onUpdateDraft, onDiscardDraft }) {
  const dataIsDraft = Boolean(production.isLocalDraft);
  const [presentationMode] = useState(dataIsDraft ? "draft-editing" : "formal-readonly");
  const editing = presentationMode === "draft-editing";
  const [form, setForm] = useState({ name: production.name || "", startsAt: production.startsAt || "", endsAt: production.endsAt || "", venue: production.venue || "", timezone: production.timezone || "Asia/Shanghai", description: production.description || "" });
  useEffect(() => { if (!editing) setForm({ name: production.name || "", startsAt: production.startsAt || "", endsAt: production.endsAt || "", venue: production.venue || "", timezone: production.timezone || "Asia/Shanghai", description: production.description || "" }); }, [production.id, production.name, production.startsAt, production.endsAt, production.venue, production.timezone, production.description, editing]);
  const status = productionStatus[production.status] ?? productionStatus.draft;
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const saveField = async (key, explicitValue) => onUpdateDraft?.({ [key]: explicitValue ?? form[key] });
  const complete = Boolean(form.name?.trim() && !draftNamePattern.test(form.name.trim()) && form.startsAt && form.endsAt && form.venue?.trim() && form.description?.trim());
  const checklist = useMemo(() => [[complete, Sparkles, "设置基本信息", "名称、时间、地点与简介"], [false, ClipboardCheck, "添加节目", "节目库和活动节目将在后续阶段接入", true], [false, UsersRound, "邀请工作人员", "人员与岗位模块将在后续阶段接入", true], [false, Workflow, "创建 Rundown", "流程编排将在后续阶段接入", true]], [complete]);
  return <div className="space-y-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-2"><Button variant="ghost" size="sm" className="-ml-2" render={<Link to={workspacePath(workspace.id, "productions")} />}><ChevronLeft />{workspace.name}</Button><div className="flex flex-wrap items-center gap-3">{editing ? <Input className="h-9 w-full max-w-xl text-2xl font-semibold" value={form.name} onChange={(event) => setField("name", event.target.value)} onBlur={() => saveField("name")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} maxLength={120} /> : <h1 className="flex items-center gap-1 truncate text-2xl font-semibold tracking-tight"><InlineField value={production.name} displayValue={production.name || "未命名活动"} label="活动名称" onSave={(value) => saveField("name", value)} /></h1>}<Badge className={status.className} variant="secondary">{status.label}</Badge></div><p className="text-sm text-muted-foreground">{dataIsDraft ? "活动工作区 · 基础资料编辑中" : `${workspace.name} · 活动工作区`}</p></div><ProductionActions isDraft={dataIsDraft} onDiscard={onDiscardDraft} /></div>
    <ProductionSummary production={production} editing={editing} form={form} setField={setField} onSave={saveField} />
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>活动说明</CardTitle><CardDescription>活动时区：{production.timezone || "Asia/Shanghai"}</CardDescription></CardHeader><CardContent className="min-h-28 text-sm text-muted-foreground">{editing ? <textarea className="min-h-28 w-full resize-y border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" value={form.description} onChange={(event) => setField("description", event.target.value)} onBlur={() => saveField("description")} placeholder="添加这场活动的内部说明…" maxLength={500} /> : <InlineField value={production.description} displayValue={production.description || "尚未填写描述。"} label="活动说明" multiline onSave={(value) => saveField("description", value)} />}</CardContent></Card><Card><CardHeader><CardTitle>下一步</CardTitle><CardDescription>根据当前已接入模块显示。</CardDescription></CardHeader><CardContent>{checklist.map(([done, Icon, title, description, future]) => <ChecklistItem key={title} complete={done} icon={Icon} title={title} description={description} future={future} />)}</CardContent></Card></section>
    <Card className="border-dashed"><CardContent className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground"><FileText className="size-5" />征集、节目、人员、文件与现场模块尚未接入。本次概览不展示虚构业务指标。</CardContent></Card>
  </div>;
}
