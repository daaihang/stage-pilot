import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Circle, ClipboardCheck, Copy, FileText, MapPin, MoreHorizontal, Pencil, Sparkles, UsersRound, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatProductionInstant, productionStatusLabel } from "@/lib/production-api";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { DateTimePicker } from "@/components/reui/date-time-picker";
import { ProductionLocations } from "@/components/production-locations";

const defaultActivityNamePattern = /^活动-\d+$/;

function ChecklistItem({ complete, icon: Icon, title, description, future = false }) {
  return <div className="flex items-start gap-3 border-b py-3 last:border-b-0"><div className="mt-0.5">{complete ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}</div><Icon className="mt-0.5 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>{future && <Badge variant="outline">即将开放</Badge>}</div>;
}

function ProductionActions() {
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="活动操作"><MoreHorizontal /></Button>} /><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>活动操作</DropdownMenuLabel><DropdownMenuItem disabled><Copy />复制活动</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem disabled>更多操作即将开放</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function InlineField({ value, displayValue, label, multiline = false, type = "text", placeholder, onSave, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  // 日期时间字段由调用方注入 DateTimePicker（children）；无 children 时保持
  // 文本编辑 + 铅笔按钮的行内模式。
  const pickerMode = Boolean(children);
  const commit = async () => {
    if (saving) return;
    const next = type === "text" ? draft.trim() : draft;
    if (next === (value || "")) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok !== false) setEditing(false);
  };
  if (pickerMode) return <div className="min-w-0 flex-1">{children}</div>;
  if (editing) {
    const props = { value: draft, autoFocus: true, disabled: saving, placeholder, onChange: (event) => setDraft(event.target.value), onBlur: commit, onKeyDown: (event) => { if (event.key === "Enter" && !multiline) { event.preventDefault(); commit(); } if (event.key === "Escape") { setDraft(value || ""); setEditing(false); } } };
    return multiline ? <textarea {...props} className="min-h-24 w-full resize-y border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" maxLength={500} /> : <Input {...props} type={type} maxLength={type === "text" ? 160 : undefined} />;
  }
  return <div className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1 whitespace-pre-wrap">{displayValue || placeholder || "未设置"}</span><Button variant="ghost" size="icon-xs" aria-label={`编辑${label}`} title={`编辑${label}`} onClick={() => setEditing(true)}><Pencil /></Button></div>;
}

function ProductionSummary({ workspace, production, editing, form, setField, onSave, disabled = false }) {
  const fields = [[CalendarClock, "开始时间", "startsAt"], [CalendarClock, "结束时间", "endsAt"], [CalendarClock, "时区", "timezone"]];
  return <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Card><CardHeader><CardDescription>主地点</CardDescription><CardTitle><ProductionLocations workspace={workspace} production={production} compact /></CardTitle></CardHeader></Card>{fields.map(([Icon, label, key]) => {
    const raw = editing ? form[key] : production[key];
    const isTime = key === "startsAt" || key === "endsAt";
    const display = raw ? (key === "venue" || key === "timezone" ? raw : formatProductionInstant(raw, production.timezone)) : (key === "venue" ? "待接入场地库" : "未设置");
    return <Card key={key}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="flex min-h-8 items-center gap-2 text-lg"><Icon className="size-4 shrink-0 text-muted-foreground" />{editing
      ? isTime
        ? <DateTimePicker value={raw || ""} timezone={production.timezone} disabled={disabled} onChange={(instant) => { setField(key, instant); onSave(key, instant); }} placeholder="选择日期与时间" />
        : <Input type="text" value={raw || ""} disabled={disabled} onChange={(event) => setField(key, event.target.value)} onBlur={() => onSave(key)} placeholder={label} maxLength={160} />
      : <InlineField value={raw} displayValue={display} label={label} onSave={(value) => onSave(key, value)}>{isTime
        ? <DateTimePicker value={raw || ""} timezone={production.timezone} onChange={(instant) => onSave(key, instant)} placeholder="选择日期与时间" />
        : undefined}</InlineField>}</CardTitle></CardHeader></Card>;
  })}</section>;
}

export function ProductionOverviewPage({ workspace, production, onUpdateProduction, onLeaveCreation, creationBusy = false }) {
  const isCreationSession = Boolean(production.isCreationSession);
  const status = productionStatusLabel(production.status);
  const [editing, setEditing] = useState(isCreationSession);
  const [form, setForm] = useState({ name: production.name || "", startsAt: production.startsAt || "", endsAt: production.endsAt || "", venue: production.venue || "", timezone: production.timezone || "Asia/Shanghai", description: production.description || "" });
  useEffect(() => { if (!editing) setForm({ name: production.name || "", startsAt: production.startsAt || "", endsAt: production.endsAt || "", venue: production.venue || "", timezone: production.timezone || "Asia/Shanghai", description: production.description || "" }); }, [production.id, production.name, production.startsAt, production.endsAt, production.venue, production.timezone, production.description, editing]);
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const saveField = async (key, explicitValue) => onUpdateProduction?.({ [key]: explicitValue ?? form[key] });
  const complete = Boolean(form.name?.trim() && !defaultActivityNamePattern.test(form.name.trim()) && form.startsAt && form.endsAt);
  const checklist = useMemo(() => [[complete, Sparkles, "设置基本信息", "名称、时间、地点与简介"], [false, ClipboardCheck, "添加节目", "节目库和活动节目将在后续阶段接入", true], [false, UsersRound, "邀请工作人员", "人员与岗位模块将在后续阶段接入", true], [false, Workflow, "创建 Rundown", "流程编排将在后续阶段接入", true]], [complete]);
  return <div className="space-y-6"><ProductionPageHeader workspace={workspace} production={production} onLeaveCreation={isCreationSession ? onLeaveCreation : undefined} subtitle={isCreationSession ? "活动工作区 · 填写基础信息后创建正式活动" : `${workspace.name} · 活动工作区`} actions={<ProductionActions />} titleContent={<div className="flex flex-wrap items-center gap-3">{editing ? <Input className="h-9 w-full max-w-xl text-2xl font-semibold" value={form.name} disabled={creationBusy} onChange={(event) => setField("name", event.target.value)} onBlur={() => saveField("name")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} maxLength={120} /> : <h1 className="flex items-center gap-1 truncate text-2xl font-semibold tracking-tight"><InlineField value={production.name} displayValue={production.name || "未命名活动"} label="活动名称" onSave={(value) => saveField("name", value)} /></h1>}{!isCreationSession && <Badge className={status.className} variant="secondary">{status.label}</Badge>}</div>} />
    <ProductionSummary workspace={workspace} production={production} editing={editing} form={form} setField={setField} onSave={saveField} disabled={creationBusy} />
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>活动说明</CardTitle></CardHeader><CardContent className="min-h-28 text-sm text-muted-foreground">{editing ? <textarea className="min-h-28 w-full resize-y border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" value={form.description} disabled={creationBusy} onChange={(event) => setField("description", event.target.value)} onBlur={() => saveField("description")} placeholder="添加这场活动的内部说明…" maxLength={500} /> : <InlineField value={production.description} displayValue={production.description || "尚未填写描述。"} label="活动说明" multiline onSave={(value) => saveField("description", value)} />}</CardContent></Card><Card><CardHeader><CardTitle>下一步</CardTitle><CardDescription>根据当前已接入模块显示。</CardDescription></CardHeader><CardContent>{checklist.map(([done, Icon, title, description, future]) => <ChecklistItem key={title} complete={done} icon={Icon} title={title} description={description} future={future} />)}</CardContent></Card></section>
    <Card className="border-dashed"><CardContent className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground"><FileText className="size-5" />征集、节目、人员、文件与现场模块尚未接入。本次概览不展示虚构业务指标。</CardContent></Card>
  </div>;
}
