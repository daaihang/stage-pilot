import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogBody, DialogFormGrid, DialogForm } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/sonner";
import { productionProgramSourceLabels, productionProgramStatusLabels, getProductionProgramMissingInfo } from "@/lib/production-program-store";
import { resolveSelectItems } from "@/lib/select-options";

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

function programTypeOptions(programTypes, includeUnset = false) {
  return [
    ...(includeUnset ? [{ value: "none", label: "未设置" }] : []),
    ...programTypes.map((item) => ({ value: item.id, label: `${item.name || "未命名类型"}${item.is_active === false ? "（已停用）" : ""}`, disabled: item.is_active === false })),
  ];
}

const programStatusOptions = Object.entries(productionProgramStatusLabels).map(([value, label]) => ({ value, label, ...(value === "archived" ? { disabled: true } : {}) }));

export function ProductionProgramFormDialog({ open, onOpenChange, program, programTypes = [], programTypesLoading = false, onSubmit, title, submitLabel = "保存" }) {
  const [form, setForm] = useState(() => initialForm(program));
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setForm(initialForm(program)); setError(null); } }, [open, program]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const types = programTypeOptions(programTypes, true);
  const typeSelect = resolveSelectItems(types, { value: form.programTypeId || "none", loading: programTypesLoading, selectedLabel: program?.programTypeName });
  const statusSelect = resolveSelectItems(programStatusOptions, { value: form.status });
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
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="lg" className="flex flex-col"><DialogForm onSubmit={submit}><DialogHeader><DialogTitle>{title || (program ? "编辑活动节目" : "新建活动节目")}</DialogTitle><DialogDescription>活动节目是当前活动的独立快照，不会自动同步工作空间节目库。</DialogDescription></DialogHeader><DialogBody><div className="space-y-4 pr-1">{error && <div className="mb-4 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" aria-live="polite">{typeof error === "string" ? error : error.message || String(error)}</div>}<label className="space-y-1 col-span-full"><span className="text-sm font-medium">节目名称</span><Input autoFocus value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={160} placeholder="例如：开场舞蹈" /></label><DialogFormGrid><label className="space-y-1"><span className="text-sm font-medium">节目类型</span><Select items={typeSelect.items} value={form.programTypeId || "none"} onValueChange={(value) => set("programTypeId", value === "none" ? "" : value)} disabled={programTypesLoading}><SelectTrigger className="w-full"><SelectValue placeholder={programTypesLoading ? "正在加载节目类型…" : "未设置"} /></SelectTrigger><SelectContent>{typeSelect.missingOption ? <SelectItem value={typeSelect.missingOption.value} disabled>{typeSelect.missingOption.label}</SelectItem> : null}{types.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1"><span className="text-sm font-medium">默认时长（分钟）</span><Input type="number" min="0" step="1" value={form.durationSeconds} onChange={(event) => set("durationSeconds", event.target.value)} /></label></DialogFormGrid><label className="space-y-1 col-span-full"><span className="text-sm font-medium">演出者（逗号分隔）</span><Input value={form.performers} onChange={(event) => set("performers", event.target.value)} placeholder="例如：张三, 李四" /></label><label className="space-y-1 col-span-full"><span className="text-sm font-medium">说明</span><Textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="节目内容、形式或注意事项" /></label><label className="space-y-1 col-span-full"><span className="text-sm font-medium">技术备注</span><Textarea value={form.technicalNotes} onChange={(event) => set("technicalNotes", event.target.value)} placeholder="音频、灯光、视频、舞台或设备需求" /></label><label className="space-y-1"><span className="text-sm font-medium">准备状态</span><Select items={statusSelect.items} value={form.status} onValueChange={(value) => set("status", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{statusSelect.missingOption ? <SelectItem value={statusSelect.missingOption.value} disabled>{statusSelect.missingOption.label}</SelectItem> : null}{programStatusOptions.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent></Select></label></div></DialogBody><DialogFooter layout="standard" cancel={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>} primary={<Button type="submit">{submitLabel}</Button>} /></DialogForm></DialogContent></Dialog>;
}

function ProgramChoice({ program, checked, onCheckedChange, sourceLabel, disabled = false }) {
  const durationSeconds = Number(program.durationSeconds ?? program.default_duration_seconds ?? 0) || 0;
  const performers = Array.isArray(program.performers) ? program.performers : [];
  const technicalNotes = program.technicalNotes || program.technical_notes || "";
  const normalized = { ...program, durationSeconds, performers, technicalNotes };
  const missing = getProductionProgramMissingInfo(normalized);
  const typeName = program.programTypeName || program.program_type_name || program.programType || "";
  return <label className={`flex items-start gap-3 border p-3 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`}><Checkbox disabled={disabled} checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{program.name}</span><Badge variant="outline">{sourceLabel}</Badge>{typeName ? <Badge variant="secondary">{typeName}</Badge> : null}</span><span className="mt-1 block text-xs text-muted-foreground">{durationSeconds ? `${Math.round(durationSeconds / 60)} 分钟` : "时长待补充"}{performers.length ? ` · ${performers.join("、")}` : " · 演出者待补充"}</span>{program.description ? <span className="mt-1 block truncate text-xs text-muted-foreground">{program.description}</span> : null}{technicalNotes ? <span className="mt-1 block truncate text-xs text-muted-foreground">技术：{technicalNotes}</span> : null}{missing.length ? <span className="mt-1 block text-xs text-amber-600 dark:text-amber-300">待补：{missing.join("、")}</span> : null}</span></label>;
}

export function AddProgramToSheetsDialog({ open, onOpenChange, program, sheets = [], onConfirm }) {
  const available = sheets.filter((sheet) => sheet.status === "draft");
  const [selected, setSelected] = useState(new Set());
  useEffect(() => { if (open) setSelected(new Set()); }, [open, program]);
  const toggle = (id, checked) => setSelected((current) => {
    const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next;
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="md"><DialogHeader><DialogTitle>添加到节目单</DialogTitle><DialogDescription>{program?.name || "活动节目"}可以加入一个或多个草稿节目单；正式和归档版本不可直接修改。</DialogDescription></DialogHeader><DialogBody><div className="max-h-80 space-y-2 overflow-y-auto">{available.length ? available.map((sheet) => <label key={sheet.id} className="flex cursor-pointer items-center gap-3 border p-3 hover:bg-muted/40"><Checkbox checked={selected.has(sheet.id)} onCheckedChange={(value) => toggle(sheet.id, Boolean(value))} /><span className="min-w-0 flex-1"><span className="text-sm font-medium">{sheet.name}</span><span className="ml-2 text-xs text-muted-foreground">v{sheet.revision} · {sheet.items?.length || 0} 个条目</span></span></label>) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">当前没有可编辑的草稿节目单，请先新建节目单。</p>}</div></DialogBody><DialogFooter layout="standard" cancel={<Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>} primary={<Button disabled={!selected.size} onClick={() => { onConfirm([...selected]); onOpenChange(false); }}><Plus />添加到选中节目单</Button>} /></DialogContent></Dialog>;
}

export function ProductionProgramPickerDialog({ open, onOpenChange, productionPrograms = [], workspacePrograms = [], programTypes = [], programTypesLoading = false, excludedProgramIds = [], initialTab = "production", mode = "sheet", onAddExisting, onSelectExisting, onCopyWorkspace, onCreateCustom }) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [typeId, setTypeId] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [custom, setCustom] = useState({ name: "", programTypeId: "", durationSeconds: "0", performers: "", description: "", technicalNotes: "", status: "draft" });
  const [customError, setCustomError] = useState(null);
  const typeFilterOptions = [{ value: "all", label: "全部类型" }, ...programTypes.map((item) => ({ value: item.id, label: `${item.name || "未命名类型"}${item.is_active === false ? "（已停用）" : ""}` }))];
  const typeFilterSelect = resolveSelectItems(typeFilterOptions, { value: typeId, loading: programTypesLoading });
  const customTypeOptions = programTypeOptions(programTypes, true);
  const customTypeSelect = resolveSelectItems(customTypeOptions, { value: custom.programTypeId || "none", loading: programTypesLoading });
  useEffect(() => { if (open) { setTab(initialTab); setQuery(""); setTypeId("all"); setSelected(new Set()); setCustom({ name: "", programTypeId: "", durationSeconds: "0", performers: "", description: "", technicalNotes: "", status: "draft" }); setCustomError(null); } }, [initialTab, open]);
  const filterPrograms = (programs) => programs.filter((program) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${program.name} ${program.description || ""} ${program.technicalNotes || program.technical_notes || ""} ${(program.performers || []).join(" ")}`.toLowerCase().includes(needle);
    const matchesType = typeId === "all" || (program.programTypeId || program.program_type_id || "") === typeId;
    return matchesQuery && matchesType;
  }).slice(0, 80);
  const currentPrograms = useMemo(() => filterPrograms(productionPrograms.filter((program) => program.status !== "archived" && !excludedProgramIds.includes(program.id))), [productionPrograms, query, typeId, excludedProgramIds]);
  const libraryPrograms = useMemo(() => filterPrograms(workspacePrograms.filter((program) => program.status !== "archived")), [workspacePrograms, query, typeId]);
  const toggle = (id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  const confirmSelected = () => {
    const values = tab === "production" ? currentPrograms : libraryPrograms;
    const selectedValues = values.filter((program) => selected.has(program.id));
    const payload = tab === "production"
      ? { source: "production", programs: selectedValues }
      : { source: "workspace", program: selectedValues[0] || null, programs: selectedValues };
    if (tab === "production") (onSelectExisting || onAddExisting)?.(selectedValues, payload);
    else onCopyWorkspace?.(selectedValues[0] || null, payload);
    if (tab !== "custom") onOpenChange(false);
  };
  const submitCustom = (event) => { event.preventDefault(); if (!custom.name.trim()) { const message = "请输入节目名称"; setCustomError(message); notify.error(message); return; } setCustomError(null); const type = programTypes.find((item) => item.id === custom.programTypeId); onCreateCustom?.({ source: "custom", draft: { name: custom.name.trim(), programTypeId: custom.programTypeId || null, programTypeName: type?.name || "", durationSeconds: Math.max(0, Number(custom.durationSeconds || 0) * 60), performers: custom.performers.split(",").map((item) => item.trim()).filter(Boolean), description: custom.description.trim(), technicalNotes: custom.technicalNotes.trim(), status: custom.status } }); onOpenChange(false); };
  const sourceHelp = mode === "activity"
    ? "从本场节目中选择不会创建新节目；复制工作空间节目或新建节目后，会生成当前活动的独立节目。"
    : "从本场节目中选择只会新增节目单条目；复制工作空间节目或新建节目后，会先创建活动节目。";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="lg"><DialogForm onSubmit={(event) => { if (tab === "custom") submitCustom(event); else event.preventDefault(); }}><DialogHeader><DialogTitle>{mode === "activity" ? "添加活动节目" : "添加节目单条目"}</DialogTitle><DialogDescription>{sourceHelp}</DialogDescription></DialogHeader><DialogBody><div className="grid gap-2 border-b pb-3 text-xs text-muted-foreground sm:grid-cols-3"><div><strong className="text-foreground">从本场节目中选择</strong><br />选择已有活动节目，不创建重复节目。</div><div><strong className="text-foreground">从工作空间节目库复制</strong><br />复制为当前活动的独立节目。</div><div><strong className="text-foreground">新建活动节目</strong><br />创建只属于当前活动的节目。</div></div><Tabs value={tab} onValueChange={(value) => { setTab(value); setSelected(new Set()); }}><TabsList className="w-full"><TabsTrigger value="production">从本场节目中选择</TabsTrigger><TabsTrigger value="workspace">从工作空间节目库复制</TabsTrigger><TabsTrigger value="custom">新建活动节目</TabsTrigger></TabsList><div className="mt-3 flex flex-wrap gap-2">{tab !== "custom" ? <><Input className="min-w-52 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节目名称、演出者或技术备注" aria-label="搜索节目" /><Select items={typeFilterSelect.items} value={typeId} onValueChange={setTypeId} disabled={programTypesLoading}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{typeFilterSelect.missingOption ? <SelectItem value={typeFilterSelect.missingOption.value} disabled>{typeFilterSelect.missingOption.label}</SelectItem> : null}{typeFilterOptions.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent></Select></> : null}</div><TabsContent value="production" className="mt-3"><div className="max-h-80 space-y-2 overflow-y-auto">{currentPrograms.length ? currentPrograms.map((program) => <ProgramChoice key={program.id} program={program} checked={selected.has(program.id)} onCheckedChange={(checked) => toggle(program.id, checked)} sourceLabel={productionProgramSourceLabels[program.sourceKind] || "活动节目"} />) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">暂无可选择的本场节目。</p>}</div></TabsContent><TabsContent value="workspace" className="mt-3"><div className="max-h-80 space-y-2 overflow-y-auto">{libraryPrograms.length ? libraryPrograms.map((program) => <ProgramChoice key={program.id} program={program} checked={selected.has(program.id)} onCheckedChange={(checked) => toggle(program.id, checked)} sourceLabel="工作空间节目库" />) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">暂无匹配的工作空间节目。</p>}</div></TabsContent><TabsContent value="custom" className="mt-3"><div className="space-y-4 pr-1">{customError && <div className="mb-4 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" aria-live="polite">{typeof customError === "string" ? customError : customError.message || String(customError)}</div>}<label className="space-y-1 col-span-full"><span className="text-sm font-medium">节目名称</span><Input autoFocus value={custom.name} onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))} /></label><DialogFormGrid><label className="space-y-1"><span className="text-sm font-medium">节目类型</span><Select items={customTypeSelect.items} value={custom.programTypeId || "none"} onValueChange={(value) => setCustom((current) => ({ ...current, programTypeId: value === "none" ? "" : value }))} disabled={programTypesLoading}><SelectTrigger className="w-full"><SelectValue placeholder={programTypesLoading ? "正在加载节目类型…" : "未设置"} /></SelectTrigger><SelectContent>{customTypeSelect.missingOption ? <SelectItem value={customTypeSelect.missingOption.value} disabled>{customTypeSelect.missingOption.label}</SelectItem> : null}{customTypeOptions.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1"><span className="text-sm font-medium">默认时长（分钟）</span><Input type="number" min="0" step="1" value={custom.durationSeconds} onChange={(event) => setCustom((current) => ({ ...current, durationSeconds: event.target.value }))} /></label></DialogFormGrid><label className="space-y-1 col-span-full"><span className="text-sm font-medium">演出者（逗号分隔）</span><Input value={custom.performers} onChange={(event) => setCustom((current) => ({ ...current, performers: event.target.value }))} /></label><label className="space-y-1 col-span-full"><span className="text-sm font-medium">说明</span><Textarea value={custom.description} onChange={(event) => setCustom((current) => ({ ...current, description: event.target.value }))} /></label><label className="space-y-1 col-span-full"><span className="text-sm font-medium">技术备注</span><Textarea value={custom.technicalNotes} onChange={(event) => setCustom((current) => ({ ...current, technicalNotes: event.target.value }))} /></label></div></TabsContent></Tabs></DialogBody><DialogFooter layout="standard" cancel={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>} primary={tab !== "custom" ? <Button type="button" disabled={!selected.size} onClick={confirmSelected}><Plus />{mode === "activity" && tab === "production" ? "打开已选节目" : "添加选中节目"}</Button> : <Button type="submit">创建并添加</Button>} /></DialogForm></DialogContent></Dialog>;
}
