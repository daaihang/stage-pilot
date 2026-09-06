import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/sonner";
import { productionProgramSourceLabels, productionProgramStatusLabels, getProductionProgramMissingInfo } from "@/lib/production-program-store";
import { DetailFormLayout } from "@/components/detail-form-layout";
import { FormActionBar } from "@/components/form-action-bar";

function initialForm(program) {
  return {
    name: program?.name || "",
    programTypeId: program?.programTypeId || "",
    durationSeconds: program?.durationSeconds ? String(Math.round(program.durationSeconds / 60)) : "0",
    performers: Array.isArray(program?.performers) ? program.performers.join(", ") : "",
    description: program?.description || program?.notes || "",
    technicalNotes: program?.technicalNotes || "",
    status: program?.status || "draft",
  };
}

export function ProductionProgramFormDialog({ open, onOpenChange, program, programTypes = [], onSubmit, title, submitLabel = "保存" }) {
  const [form, setForm] = useState(() => initialForm(program));
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setForm(initialForm(program)); setError(null); } }, [open, program]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) { setError("请输入节目名称"); return; }
    const selectedType = programTypes.find((item) => item.id === form.programTypeId);
    onSubmit({
      name,
      programTypeId: form.programTypeId || null,
      programTypeName: selectedType?.name || program?.programTypeName || "",
      durationSeconds: Math.max(0, Number(form.durationSeconds || 0) * 60),
      performers: form.performers.split(",").map((item) => item.trim()).filter(Boolean),
      description: form.description.trim(),
      technicalNotes: form.technicalNotes.trim(),
      status: form.status,
    });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col"><DialogHeader><DialogTitle>{title || (program ? "编辑活动节目" : "新建活动节目")}</DialogTitle><DialogDescription>活动节目是当前活动的独立快照，不会自动同步工作空间节目库。</DialogDescription></DialogHeader><DetailFormLayout className="min-h-0 flex-1" scrollBoundary="self" onSubmit={submit} error={error} contentClassName="grid gap-4 pr-1 sm:grid-cols-2" actions={<FormActionBar onCancel={() => onOpenChange(false)} submitLabel={submitLabel} />}><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">节目名称</span><Input autoFocus value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={160} placeholder="例如：开场舞蹈" /></label><label className="space-y-1"><span className="text-sm font-medium">节目类型</span><Select value={form.programTypeId || "none"} onValueChange={(value) => set("programTypeId", value === "none" ? "" : value)}><SelectTrigger className="w-full"><SelectValue placeholder="未设置" /></SelectTrigger><SelectContent><SelectItem value="none">未设置</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.is_active === false ? "（已停用）" : ""}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1"><span className="text-sm font-medium">默认时长（分钟）</span><Input type="number" min="0" step="1" value={form.durationSeconds} onChange={(event) => set("durationSeconds", event.target.value)} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">演出者（逗号分隔）</span><Input value={form.performers} onChange={(event) => set("performers", event.target.value)} placeholder="例如：张三, 李四" /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">说明</span><Textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="节目内容、形式或注意事项" /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">技术备注</span><Textarea value={form.technicalNotes} onChange={(event) => set("technicalNotes", event.target.value)} placeholder="音频、灯光、视频、舞台或设备需求" /></label><label className="space-y-1"><span className="text-sm font-medium">准备状态</span><Select value={form.status} onValueChange={(value) => set("status", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(productionProgramStatusLabels).filter(([value]) => value !== "archived").map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label></DetailFormLayout></DialogContent></Dialog>;
}

function ProgramChoice({ program, checked, onCheckedChange, sourceLabel }) {
  const durationSeconds = Number(program.durationSeconds ?? program.default_duration_seconds ?? 0) || 0;
  const performers = Array.isArray(program.performers) ? program.performers : [];
  const technicalNotes = program.technicalNotes || program.technical_notes || "";
  const normalized = { ...program, durationSeconds, performers, technicalNotes };
  const missing = getProductionProgramMissingInfo(normalized);
  const typeName = program.programTypeName || program.program_type_name || program.programType || "";
  return <label className="flex cursor-pointer items-start gap-3 border p-3 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{program.name}</span><Badge variant="outline">{sourceLabel}</Badge>{typeName ? <Badge variant="secondary">{typeName}</Badge> : null}</span><span className="mt-1 block text-xs text-muted-foreground">{durationSeconds ? `${Math.round(durationSeconds / 60)} 分钟` : "时长待补充"}{performers.length ? ` · ${performers.join("、")}` : " · 演出者待补充"}</span>{program.description ? <span className="mt-1 block truncate text-xs text-muted-foreground">{program.description}</span> : null}{technicalNotes ? <span className="mt-1 block truncate text-xs text-muted-foreground">技术：{technicalNotes}</span> : null}{missing.length ? <span className="mt-1 block text-xs text-amber-600 dark:text-amber-300">待补：{missing.join("、")}</span> : null}</span></label>;
}

export function AddProgramToSheetsDialog({ open, onOpenChange, program, sheets = [], onConfirm }) {
  const available = sheets.filter((sheet) => sheet.status === "draft");
  const [selected, setSelected] = useState(new Set());
  useEffect(() => { if (open) setSelected(new Set()); }, [open, program]);
  const toggle = (id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>添加到节目单</DialogTitle><DialogDescription>{program?.name || "活动节目"}可以加入一个或多个草稿节目单；正式和归档版本不可直接修改。</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-y-auto">{available.length ? available.map((sheet) => <label key={sheet.id} className="flex cursor-pointer items-center gap-3 border p-3 hover:bg-muted/40"><Checkbox checked={selected.has(sheet.id)} onCheckedChange={(value) => toggle(sheet.id, Boolean(value))} /><span className="min-w-0 flex-1"><span className="text-sm font-medium">{sheet.name}</span><span className="ml-2 text-xs text-muted-foreground">v{sheet.revision} · {sheet.items?.length || 0} 个条目</span></span></label>) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">当前没有可编辑的草稿节目单，请先新建节目单。</p>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!selected.size} onClick={() => { onConfirm([...selected]); onOpenChange(false); }}><Plus />添加到选中节目单</Button></DialogFooter></DialogContent></Dialog>;
}

export function ProductionProgramPickerDialog({ open, onOpenChange, productionPrograms = [], workspacePrograms = [], programTypes = [], initialTab = "production", onAddExisting, onCopyWorkspace, onCreateCustom }) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [typeId, setTypeId] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [custom, setCustom] = useState({ name: "", programTypeId: "", durationSeconds: "0", performers: "", description: "", technicalNotes: "", status: "draft" });
  const [customError, setCustomError] = useState(null);
  useEffect(() => { if (open) { setTab(initialTab); setQuery(""); setTypeId("all"); setSelected(new Set()); setCustom({ name: "", programTypeId: "", durationSeconds: "0", performers: "", description: "", technicalNotes: "", status: "draft" }); setCustomError(null); } }, [initialTab, open]);
  const filterPrograms = (programs) => programs.filter((program) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${program.name} ${program.description || ""} ${program.technicalNotes || program.technical_notes || ""} ${(program.performers || []).join(" ")}`.toLowerCase().includes(needle);
    const matchesType = typeId === "all" || (program.programTypeId || program.program_type_id || "") === typeId;
    return matchesQuery && matchesType;
  }).slice(0, 80);
  const currentPrograms = useMemo(() => filterPrograms(productionPrograms.filter((program) => program.status !== "archived")), [productionPrograms, query, typeId]);
  const libraryPrograms = useMemo(() => filterPrograms(workspacePrograms.filter((program) => program.status !== "archived")), [workspacePrograms, query, typeId]);
  const toggle = (id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  const confirmSelected = () => {
    const values = tab === "production" ? currentPrograms : libraryPrograms;
    const selectedValues = values.filter((program) => selected.has(program.id));
    if (tab === "production") onAddExisting(selectedValues); else onCopyWorkspace(selectedValues);
    onOpenChange(false);
  };
  const submitCustom = (event) => { event.preventDefault(); if (!custom.name.trim()) { const message = "请输入节目名称"; setCustomError(message); notify.error(message); return; } setCustomError(null); const type = programTypes.find((item) => item.id === custom.programTypeId); onCreateCustom({ name: custom.name.trim(), programTypeId: custom.programTypeId || null, programTypeName: type?.name || "", durationSeconds: Math.max(0, Number(custom.durationSeconds || 0) * 60), performers: custom.performers.split(",").map((item) => item.trim()).filter(Boolean), description: custom.description.trim(), technicalNotes: custom.technicalNotes.trim(), status: custom.status }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col"><DialogHeader><DialogTitle>添加节目</DialogTitle><DialogDescription>选择本场节目，或把工作空间节目复制为本场活动的独立快照。</DialogDescription></DialogHeader><Tabs value={tab} onValueChange={(value) => { setTab(value); setSelected(new Set()); }}><TabsList className="w-full"><TabsTrigger value="production">本场节目</TabsTrigger><TabsTrigger value="workspace">从工作空间节目库复制</TabsTrigger><TabsTrigger value="custom">新建活动节目</TabsTrigger></TabsList><div className="mt-3 flex flex-wrap gap-2">{tab !== "custom" ? <><Input className="min-w-52 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节目名称、演出者或技术备注" aria-label="搜索节目" /><Select value={typeId} onValueChange={setTypeId}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></> : null}</div><TabsContent value="production" className="mt-3"><div className="max-h-80 space-y-2 overflow-y-auto">{currentPrograms.length ? currentPrograms.map((program) => <ProgramChoice key={program.id} program={program} checked={selected.has(program.id)} onCheckedChange={(checked) => toggle(program.id, checked)} sourceLabel={productionProgramSourceLabels[program.sourceKind] || "活动节目"} />) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">暂无可添加的本场节目。</p>}</div></TabsContent><TabsContent value="workspace" className="mt-3"><div className="max-h-80 space-y-2 overflow-y-auto">{libraryPrograms.length ? libraryPrograms.map((program) => <ProgramChoice key={program.id} program={program} checked={selected.has(program.id)} onCheckedChange={(checked) => toggle(program.id, checked)} sourceLabel="工作空间节目库" />) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">暂无匹配的工作空间节目。</p>}</div></TabsContent><TabsContent value="custom" className="mt-3"><DetailFormLayout className="min-h-0 flex-1" scrollBoundary="self" onSubmit={submitCustom} error={customError} contentClassName="grid gap-4 pr-1 sm:grid-cols-2" actions={<FormActionBar onCancel={() => onOpenChange(false)} submitLabel="创建并添加" />}><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">节目名称</span><Input autoFocus value={custom.name} onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))} /></label><label className="space-y-1"><span className="text-sm font-medium">节目类型</span><Select value={custom.programTypeId || "none"} onValueChange={(value) => setCustom((current) => ({ ...current, programTypeId: value === "none" ? "" : value }))}><SelectTrigger className="w-full"><SelectValue placeholder="未设置" /></SelectTrigger><SelectContent><SelectItem value="none">未设置</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1"><span className="text-sm font-medium">默认时长（分钟）</span><Input type="number" min="0" step="1" value={custom.durationSeconds} onChange={(event) => setCustom((current) => ({ ...current, durationSeconds: event.target.value }))} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">演出者（逗号分隔）</span><Input value={custom.performers} onChange={(event) => setCustom((current) => ({ ...current, performers: event.target.value }))} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">说明</span><Textarea value={custom.description} onChange={(event) => setCustom((current) => ({ ...current, description: event.target.value }))} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">技术备注</span><Textarea value={custom.technicalNotes} onChange={(event) => setCustom((current) => ({ ...current, technicalNotes: event.target.value }))} /></label></DetailFormLayout></TabsContent></Tabs><DialogFooter>{tab !== "custom" ? <><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!selected.size} onClick={confirmSelected}><Plus />添加选中节目</Button></> : null}</DialogFooter></DialogContent></Dialog>;
}
