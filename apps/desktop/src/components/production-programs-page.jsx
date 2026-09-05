import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Copy, FileMusic, Plus, RefreshCw, RotateCcw } from "@/components/ui/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourcePage } from "@/components/resource-page";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { TimeText } from "@/components/time-text";
import { useWindowDetail } from "@/components/window-detail-context";
import { notify } from "@/components/ui/sonner";
import { listResource, listResourceTypes } from "@/lib/resource-api";
import { listProductionOccurrences } from "@/lib/production-api";
import { loadProgramSheetState, makeSheetItem, nowIso, saveProgramSheetState } from "@/lib/program-sheet-store";
import { archiveProductionProgram, copyWorkspaceProgram, createProductionProgram, duplicateProductionProgram, getProductionProgramMissingInfo, loadProductionPrograms, productionProgramSourceLabels, productionProgramStatusLabels, restoreProductionProgram, updateProductionProgram } from "@/lib/production-program-store";
import { AddProgramToSheetsDialog, ProductionProgramFormDialog, ProductionProgramPickerDialog } from "@/components/production-program-dialogs";
import { ProductionProgramDetail } from "@/components/production-program-detail";

function canWriteProductionPrograms(workspace, production) {
  return ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");
}

function statusClass(status) {
  if (status === "confirmed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "needs_info") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function ProgramListRow({ program, timezone, selected, onSelect, canWrite, onDuplicate, onArchive, onRestore }) {
  const missing = getProductionProgramMissingInfo(program);
  return <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 ${selected ? "bg-muted/50" : "hover:bg-muted/30"}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(program.id)}><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{program.name}</p><Badge className={statusClass(program.status)} variant="secondary">{productionProgramStatusLabels[program.status] || program.status}</Badge><Badge variant="outline">{productionProgramSourceLabels[program.sourceKind] || "活动节目"}</Badge>{program.programTypeName ? <Badge variant="outline">{program.programTypeName}</Badge> : null}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{program.durationSeconds ? `${Math.round(program.durationSeconds / 60)} 分钟` : "时长待补充"}</span><span>{program.performers?.length ? program.performers.join("、") : "演出者待补充"}</span><span>更新于 <TimeText instant={program.updatedAt} timezone={timezone} /></span></div>{missing.length ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">待补：{missing.join("、")}</p> : null}</button><div className="flex items-center gap-1">{canWrite && program.status !== "archived" ? <Button variant="ghost" size="icon-sm" onClick={() => onDuplicate(program)} aria-label={`复制${program.name}`} title="复制活动节目"><Copy /></Button> : null}{canWrite && program.status !== "archived" ? <Button variant="ghost" size="icon-sm" onClick={() => onArchive(program)} aria-label={`归档${program.name}`} title="归档"><Archive /></Button> : null}{canWrite && program.status === "archived" ? <Button variant="ghost" size="icon-sm" onClick={() => onRestore(program)} aria-label={`恢复${program.name}`} title="恢复"><RotateCcw /></Button> : null}</div></div>;
}

export function ProductionProgramsPage({ route, workspace, production }) {
  const canWrite = canWriteProductionPrograms(workspace, production);
  const [programs, setPrograms] = useState([]);
  const [workspacePrograms, setWorkspacePrograms] = useState([]);
  const [programTypes, setProgramTypes] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [typeId, setTypeId] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const triggerRef = useRef(null);
  const requestSequence = useRef(0);
  const { registerDetail, setDetailOpen } = useWindowDetail();

  const load = useCallback(async ({ toast = false } = {}) => {
    const requestId = ++requestSequence.current;
    setLoading((current) => current || !programs.length);
    if (programs.length) setRefreshing(true);
    try {
      const [localState, workspaceResult, typesResult] = await Promise.all([
        loadProgramSheetState(production.id),
        listResource(workspace.id, "programs"),
        listResourceTypes(workspace.id, "programs"),
      ]);
      if (requestId !== requestSequence.current) return;
      setPrograms(localState.productionPrograms || []);
      setSheets(localState.sheets || []);
      setWorkspacePrograms(workspaceResult.items || []);
      setProgramTypes(typesResult.items || []);
      if (toast) notify.success("活动节目已刷新");
    } catch (error) {
      if (requestId === requestSequence.current && toast) notify.error("活动节目刷新失败", { description: error?.message || String(error) });
    } finally {
      if (requestId === requestSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [production.id, workspace.id, programs.length]);

  useEffect(() => { load(); return () => { requestSequence.current += 1; }; }, [load]);

  const selectedProgram = useMemo(() => programs.find((item) => item.id === selectedId) || null, [programs, selectedId]);

  useEffect(() => registerDetail({
    key: `production-programs:${production.id}`,
    storageKey: `detailPane:production-programs:${production.id}:v1`,
    triggerRef,
    detailLabel: "活动节目详情",
    onClose: () => setSelectedId(null),
    getDetail: () => selectedProgram ? <ProductionProgramDetail program={selectedProgram} programTypes={programTypes} canWrite={canWrite} onSave={async (patch) => { try { const updated = await updateProductionProgram(production.id, selectedProgram.id, patch); setPrograms((current) => current.map((item) => item.id === updated.id ? updated : item)); notify.success("活动节目已保存"); } catch (error) { notify.error("活动节目保存失败", { description: error?.message || String(error) }); throw error; } }} onDuplicate={(program) => setDialog({ type: "duplicate", program })} onArchive={(program) => setDialog({ type: "archive", program })} onRestore={async (program) => { try { const restored = await restoreProductionProgram(production.id, program.id); setPrograms((current) => current.map((item) => item.id === restored.id ? restored : item)); notify.success("活动节目已恢复"); } catch (error) { notify.error("活动节目恢复失败", { description: error?.message || String(error) }); } }} onAddToSheets={(program) => setDialog({ type: "assign", program })} /> : null,
  }), [canWrite, production.id, programTypes, selectedProgram, registerDetail]);

  useEffect(() => { if (selectedProgram) setDetailOpen(true, { announce: false }); }, [selectedProgram, setDetailOpen]);

  const filteredPrograms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return programs.filter((program) => {
      const matchesQuery = !needle || `${program.name} ${program.description} ${program.technicalNotes} ${(program.performers || []).join(" ")}`.toLowerCase().includes(needle);
      const matchesStatus = status === "all" || program.status === status;
      const matchesSource = source === "all" || program.sourceKind === source;
      const matchesType = typeId === "all" || program.programTypeId === typeId;
      return matchesQuery && matchesStatus && matchesSource && matchesType;
    }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [programs, query, source, status, typeId]);

  const createProgram = async (values) => {
    try {
      const created = await createProductionProgram(production.id, values);
      setPrograms((current) => [...current, created]);
      setDialog(null);
      setSelectedId(created.id);
      notify.success("活动节目已创建");
    } catch (error) { notify.error("活动节目创建失败", { description: error?.message || String(error) }); }
  };

  const duplicateProgram = async (program) => {
    try {
      const copy = await duplicateProductionProgram(production.id, program.id);
      setPrograms((current) => [...current, copy]);
      setDialog(null);
      setSelectedId(copy.id);
      notify.success("活动节目已复制");
    } catch (error) { notify.error("活动节目复制失败", { description: error?.message || String(error) }); }
  };

  const archiveProgram = async (program) => {
    try { const archived = await archiveProductionProgram(production.id, program.id); setPrograms((current) => current.map((item) => item.id === archived.id ? archived : item)); setDialog(null); notify.success("活动节目已归档"); } catch (error) { notify.error("活动节目归档失败", { description: error?.message || String(error) }); }
  };

  const copyWorkspacePrograms = async (values) => {
    const toastId = notify.loading("正在复制工作空间节目");
    try {
      const copied = [];
      for (const value of values) {
        const programTypeName = value.programTypeName || value.program_type_name || programTypes.find((type) => type.id === (value.programTypeId || value.program_type_id))?.name || "";
        copied.push((await copyWorkspaceProgram(production.id, { ...value, programTypeName })).program);
      }
      const next = await loadProductionPrograms(production.id);
      setPrograms(next);
      setDialog(null);
      if (copied[0]) setSelectedId(copied[0].id);
      notify.success("工作空间节目已复制到本场活动", { id: toastId });
    } catch (error) { notify.error("复制工作空间节目失败", { id: toastId, description: error?.message || String(error) }); }
  };

  const addExistingToSheets = async (program, sheetIds) => {
    const toastId = notify.loading("正在添加到节目单");
    try {
      const current = await loadProgramSheetState(production.id);
      const selectedSheets = new Set(sheetIds);
      const next = { ...current, sheets: current.sheets.map((sheet) => selectedSheets.has(sheet.id) ? { ...sheet, items: [...sheet.items, makeSheetItem("program", { productionProgramId: program.id, title: program.name, durationSeconds: program.durationSeconds, order: sheet.items.length })], updatedAt: nowIso() } : sheet) };
      await saveProgramSheetState(production.id, next);
      setSheets(next.sheets);
      setDialog(null);
      notify.success(`已将“${program.name}”添加到节目单`, { id: toastId });
    } catch (error) {
      notify.error("添加到节目单失败", { id: toastId, description: error?.message || String(error) });
    }
  };

  return <div className="space-y-5" ref={triggerRef}><ProductionPageHeader workspace={workspace} production={production} title="节目" subtitle={route.meta.description} actions={<div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => load({ toast: true })} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : ""} />刷新</Button>{canWrite && <Button variant="outline" onClick={() => setDialog({ type: "picker" })}><Copy />从工作空间复制</Button>}{canWrite && <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目</Button>}</div>} /><ResourcePage title="活动节目" description="本场活动的节目资料与准备状态。节目单负责排序和编排。" count={filteredPrograms.length} search={{ value: query, onChange: setQuery, placeholder: "搜索节目、演出者或技术备注" }} filters={<><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(productionProgramStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={source} onValueChange={setSource}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem>{Object.entries(productionProgramSourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={typeId} onValueChange={setTypeId}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{programTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></>} showViewToggle={false} summary={<span>活动时区：{production.timezone}</span>} loading={loading} empty={!filteredPrograms.length ? { icon: FileMusic, title: query || status !== "all" || source !== "all" || typeId !== "all" ? "没有匹配的节目" : "还没有活动节目", description: canWrite ? "从工作空间复制或创建一个本场活动节目。" : "当前活动还没有可查看的节目。", action: canWrite && !query && status === "all" && source === "all" && typeId === "all" ? <div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => setDialog({ type: "picker" })}><Copy />从工作空间复制</Button><Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目</Button></div> : null } : null}><Card variant="flush"><CardContent className="p-0">{filteredPrograms.map((program) => <ProgramListRow key={program.id} program={program} timezone={production.timezone} selected={program.id === selectedId} onSelect={setSelectedId} canWrite={canWrite} onDuplicate={(item) => setDialog({ type: "duplicate", program: item })} onArchive={(item) => setDialog({ type: "archive", program: item })} onRestore={async (item) => { try { const restored = await restoreProductionProgram(production.id, item.id); setPrograms((current) => current.map((candidate) => candidate.id === restored.id ? restored : candidate)); notify.success("活动节目已恢复"); } catch (error) { notify.error("活动节目恢复失败", { description: error?.message || String(error) }); } }} />)}</CardContent></Card></ResourcePage><ProductionProgramFormDialog open={dialog?.type === "new"} onOpenChange={(open) => !open && setDialog(null)} programTypes={programTypes} onSubmit={createProgram} submitLabel="创建节目" /><ProductionProgramPickerDialog open={dialog?.type === "picker"} onOpenChange={(open) => !open && setDialog(null)} productionPrograms={programs} workspacePrograms={workspacePrograms} programTypes={programTypes} onAddExisting={(values) => { if (values[0]) { setSelectedId(values[0].id); notify.info("已选择本场节目，可在详情中编辑或添加到节目单"); } }} onCopyWorkspace={copyWorkspacePrograms} onCreateCustom={createProgram} /><AddProgramToSheetsDialog open={dialog?.type === "assign"} onOpenChange={(open) => !open && setDialog(null)} program={dialog?.program} sheets={sheets} onConfirm={(sheetIds) => addExistingToSheets(dialog.program, sheetIds)} /><AlertDialog open={dialog?.type === "archive" || dialog?.type === "duplicate"} onOpenChange={(open) => !open && setDialog(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{dialog?.type === "archive" ? "归档活动节目" : "复制活动节目"}</AlertDialogTitle><AlertDialogDescription>{dialog?.type === "archive" ? `归档“${dialog?.program?.name || "此节目"}”后，它不会再出现在新节目单的选择器中，已有节目单条目不受影响。` : `将“${dialog?.program?.name || "此节目"}”复制为新的活动节目草稿。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => dialog?.type === "archive" ? archiveProgram(dialog.program) : duplicateProgram(dialog.program)}>{dialog?.type === "archive" ? "确认归档" : "复制草稿"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}
