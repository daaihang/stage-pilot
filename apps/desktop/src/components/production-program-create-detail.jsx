import { useMemo, useState } from "react";
import { FileMusic } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DetailFormLayout } from "@/components/detail-form-layout";
import { FormActionBar } from "@/components/form-action-bar";
import { notify } from "@/components/ui/sonner";

export function ProductionProgramCreateDetail({ workspacePrograms = [], programTypes = [], existingPrograms = [], onSave, onCancel, mode = "create", sourceProgram = null, initialDraft = null }) {
  const [templateId, setTemplateId] = useState("");
  const [query, setQuery] = useState("");
  const [typeId, setTypeId] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const template = workspacePrograms.find((item) => item.id === templateId) || null;
  const [draft, setDraft] = useState(() => initialDraft || (sourceProgram ? { name: sourceProgram.name || "", programTypeId: sourceProgram.programTypeId || sourceProgram.program_type_id || "", durationMinutes: String(Math.round(Number(sourceProgram.durationSeconds ?? sourceProgram.duration_seconds ?? sourceProgram.default_duration_seconds ?? 0) / 60)), performers: Array.isArray(sourceProgram.performers) ? sourceProgram.performers.join(", ") : "", description: sourceProgram.description || sourceProgram.notes || "", technicalNotes: sourceProgram.technicalNotes || sourceProgram.technical_notes || "" } : { name: "", programTypeId: "", durationMinutes: "0", performers: "", description: "", technicalNotes: "" }));
  useEffect(() => {
    if (initialDraft || sourceProgram) setDraft(initialDraft || { name: sourceProgram.name || "", programTypeId: sourceProgram.programTypeId || sourceProgram.program_type_id || "", durationMinutes: String(Math.round(Number(sourceProgram.durationSeconds ?? sourceProgram.duration_seconds ?? sourceProgram.default_duration_seconds ?? 0) / 60)), performers: Array.isArray(sourceProgram.performers) ? sourceProgram.performers.join(", ") : "", description: sourceProgram.description || sourceProgram.notes || "", technicalNotes: sourceProgram.technicalNotes || sourceProgram.technical_notes || "" });
  }, [initialDraft, sourceProgram]);
  const choose = (value) => { setTemplateId(value); const item = workspacePrograms.find((candidate) => candidate.id === value); if (item) setDraft({ name: item.name || "", programTypeId: item.programTypeId || item.program_type_id || "", durationMinutes: String(Math.round(Number(item.durationSeconds ?? item.default_duration_seconds ?? 0) / 60)), performers: Array.isArray(item.performers) ? item.performers.join(", ") : "", description: item.description || item.notes || "", technicalNotes: item.technicalNotes || item.technical_notes || "" }); };
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const choices = useMemo(() => workspacePrograms.filter((item) => (!query || `${item.name} ${item.description || item.notes || ""}`.toLowerCase().includes(query.trim().toLowerCase())) && (typeId === "all" || (item.programTypeId || item.program_type_id) === typeId)), [query, typeId, workspacePrograms]);
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!draft.name.trim()) {
      const message = "请输入节目名称";
      setError(message);
      notify.error(message);
      return;
    }
    setBusy(true);
    try {
      await onSave({ sourceKind: template ? "workspace_copy" : "manual", sourceProgramId: template?.id || null, name: draft.name.trim(), programTypeId: draft.programTypeId || null, programTypeName: programTypes.find((item) => item.id === draft.programTypeId)?.name || template?.programTypeName || template?.program_type_name || "", durationSeconds: Math.max(0, Number(draft.durationMinutes || 0) * 60), performers: draft.performers.split(",").map((item) => item.trim()).filter(Boolean), description: draft.description.trim(), technicalNotes: draft.technicalNotes.trim() });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };
  return <DetailFormLayout scrollBoundary="parent" busy={busy} error={error} contentClassName="space-y-4 p-4 md:p-6" onSubmit={submit} actions={<FormActionBar onCancel={onCancel} busy={busy} submitLabel="保存节目" busyLabel="保存中…" />}>
    <div><h2 className="text-lg font-semibold">{mode === "workspace-copy" ? "确认复制活动节目" : "添加节目"}</h2><p className="mt-1 text-xs text-muted-foreground">{mode === "workspace-copy" ? "已从工作空间节目库预填资料。保存后会生成当前活动的独立节目。" : "填写活动节目资料，保存后才会写入本场活动。"}</p></div>
    <Card variant="flush"><CardHeader className="border-b"><CardTitle className="text-sm">选择模板</CardTitle><CardDescription>已复制到本场活动的来源节目会标记为已在本场节目中。</CardDescription></CardHeader><CardContent className="space-y-3 p-3"><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作空间节目" /><Select value={typeId} onValueChange={setTypeId}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div><button type="button" className={`flex w-full items-center gap-3 border p-3 text-left ${!templateId ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`} onClick={() => { setTemplateId(""); setDraft({ name: "", programTypeId: "", durationMinutes: "0", performers: "", description: "", technicalNotes: "" }); }}><FileMusic className="size-4" /><span><span className="block text-sm font-medium">空白节目</span><span className="text-xs text-muted-foreground">手工创建本场节目</span></span></button><div className="max-h-52 space-y-2 overflow-y-auto">{choices.map((item) => { const already = existingPrograms.find((program) => program.sourceProgramId === item.id); return <button type="button" key={item.id} className={`flex w-full items-center justify-between gap-3 border p-3 text-left ${templateId === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`} onClick={() => already ? onSave({ openExistingId: already.id }) : choose(item.id)}><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="text-xs text-muted-foreground">{item.programTypeName || item.program_type_name || "未分类"} · {Math.round(Number(item.durationSeconds ?? item.default_duration_seconds ?? 0) / 60)} 分钟</span></span>{already ? <Badge variant="secondary">已在本场节目中</Badge> : null}</button>; })}</div></CardContent></Card>
    <Card variant="flush"><CardHeader className="border-b"><CardTitle className="text-sm">节目资料</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 sm:col-span-2"><span className="text-sm">名称</span><Input value={draft.name} onChange={(event) => set("name", event.target.value)} /></label><label className="space-y-1"><span className="text-sm">节目类型</span><Select value={draft.programTypeId || "none"} onValueChange={(value) => set("programTypeId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="未设置" /></SelectTrigger><SelectContent><SelectItem value="none">未设置</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1"><span className="text-sm">时长（分钟）</span><Input type="number" min="0" value={draft.durationMinutes} onChange={(event) => set("durationMinutes", event.target.value)} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm">演出者</span><Input value={draft.performers} onChange={(event) => set("performers", event.target.value)} placeholder="逗号分隔" /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm">说明</span><Textarea value={draft.description} onChange={(event) => set("description", event.target.value)} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm">技术备注</span><Textarea value={draft.technicalNotes} onChange={(event) => set("technicalNotes", event.target.value)} /></label></div></CardContent></Card>
  </DetailFormLayout>;
}
