import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Clock3, Copy, ListMusic, Plus, RefreshCw } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourcePage } from "@/components/resource-page";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { TimeText } from "@/components/time-text";
import { useWindowDetail } from "@/components/window-detail-context";
import { listProductionOccurrences } from "@/lib/production-api";
import { listResource, listResourceTypes } from "@/lib/resource-api";
import { makeProductionProgram, makeProgramSheet, makeSheetItem, loadProgramSheetState, makePublishedSnapshot, normalizeProgramSheetState, nowIso, saveProgramSheetState } from "@/lib/program-sheet-store";
import { loadSegmentTypes } from "@/lib/program-sheet-segment-type-store";
import { programSheetSegmentTypePanelPath, productionPath } from "@/lib/navigation";
import { assignedOccurrenceIds, formatDuration, getProgramItemCount, getTotalDurationSeconds, occurrenceTitle, programSheetStatusLabels } from "@/lib/program-sheet-utils";
import { notify } from "@/components/ui/sonner";
import { ArchiveProgramSheetDialog, AssignOccurrencesDialog, CopyProgramSheetDialog, NewProgramSheetDialog, PublishProgramSheetDialog } from "@/components/program-sheet-dialogs";
import { ProgramSheetDetail } from "@/components/program-sheet-detail";
import { ProgramSheetSegmentTypeManagementPanel } from "@/components/program-sheet-segment-type-management-panel";

function canWriteProgramSheets(workspace, production) {
  return ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");
}

function sheetStatusClass(status) {
  if (status === "published") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  if (status === "review") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function SheetListRow({ sheet, occurrences, production, selected, canWrite, onSelect, onCopy, onArchive }) {
  const assigned = (occurrences || []).filter((occurrence) => assignedOccurrenceIds(sheet).has(occurrence.id));
  return <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 ${selected ? "bg-muted/50" : "hover:bg-muted/30"}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(sheet.id)}><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{sheet.name}</p><Badge className={sheetStatusClass(sheet.status)} variant="secondary">{programSheetStatusLabels[sheet.status]}</Badge><Badge variant="outline">v{sheet.revision}</Badge></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{getProgramItemCount(sheet)} 个节目 · {formatDuration(getTotalDurationSeconds(sheet))}</span><span>{assigned.length ? `正式：${assigned.map(occurrenceTitle).join("、")}` : "未关联正式场次"}</span><span>更新于 <TimeText instant={sheet.updatedAt} timezone={production.timezone} /></span></div>{sheet.changeNote ? <p className="mt-1 truncate text-xs text-muted-foreground">{sheet.changeNote}</p> : null}</button><div className="flex items-center gap-1">{canWrite && sheet.status !== "archived" ? <Button variant="ghost" size="icon-sm" onClick={() => onCopy(sheet)} aria-label={`复制${sheet.name}`} title="复制为新草稿"><Copy /></Button> : null}{canWrite && sheet.status === "draft" ? <Button variant="ghost" size="icon-sm" onClick={() => onArchive(sheet)} aria-label={`归档${sheet.name}`} title="归档"><Archive /></Button> : null}</div></div>;
}

export function ProgramSheetsPage({ route, workspace, production }) {
  const canWrite = canWriteProgramSheets(workspace, production);
  const [state, setState] = useState(() => normalizeProgramSheetState(null, production.id));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [occurrences, setOccurrences] = useState([]);
  const [workspacePrograms, setWorkspacePrograms] = useState([]);
  const [programTypes, setProgramTypes] = useState([]);
  const [segmentTypes, setSegmentTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [occurrenceFilter, setOccurrenceFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const triggerRef = useRef(null);
  const requestSequence = useRef(0);
  const { registerDetail, setDetailOpen } = useWindowDetail();
  const navigate = useNavigate();

  const load = useCallback(async ({ toast = false } = {}) => {
    const requestId = ++requestSequence.current;
    setError(null);
    setLoading((current) => current && !stateRef.current.sheets.length);
    if (stateRef.current.sheets.length) setRefreshing(true);
    try {
      const [localState, nextOccurrences, programResult, typesResult, nextSegmentTypes] = await Promise.all([
        loadProgramSheetState(production.id),
        listProductionOccurrences(production.id),
        listResource(workspace.id, "programs").catch(() => ({ items: [] })),
        listResourceTypes(workspace.id, "programs").catch(() => ({ items: [] })),
        loadSegmentTypes(workspace.id),
      ]);
      if (requestId !== requestSequence.current) return;
      stateRef.current = localState;
      setState(localState);
      setOccurrences(Array.isArray(nextOccurrences) ? nextOccurrences : []);
      setWorkspacePrograms(Array.isArray(programResult?.items) ? programResult.items : Array.isArray(programResult) ? programResult : []);
      setProgramTypes(Array.isArray(typesResult?.items) ? typesResult.items : Array.isArray(typesResult) ? typesResult : []);
      setSegmentTypes(nextSegmentTypes);
      if (toast) notify.success("节目单数据已刷新");
    } catch (nextError) {
      if (requestId === requestSequence.current) {
        setError(nextError);
        if (toast) notify.error("节目单刷新失败", { description: nextError?.message || String(nextError) });
      }
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [production.id, workspace.id]);

  useEffect(() => {
    load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const selectedSheet = useMemo(() => state.sheets.find((item) => item.id === selectedId) || null, [selectedId, state.sheets]);
  const commit = useCallback((nextState, message) => {
    const normalized = normalizeProgramSheetState(nextState, production.id);
    stateRef.current = normalized;
    setState(normalized);
    const toastId = message ? notify.loading(message) : null;
    saveProgramSheetState(production.id, normalized).then(() => {
      if (toastId) notify.success("已保存到本机", { id: toastId });
    }).catch((nextError) => {
      if (toastId) notify.error("本地保存失败", { id: toastId, description: nextError?.message || String(nextError) });
      else notify.error("本地保存失败", { description: nextError?.message || String(nextError) });
    });
  }, [production.id]);
  const changeSheet = useCallback((sheetId, updater, options = {}) => {
    const current = stateRef.current;
    const existing = current.sheets.find((item) => item.id === sheetId);
    if (!existing) return;
    const nextSheet = typeof updater === "function" ? updater(existing) : { ...existing, ...updater };
    commit({ ...current, sheets: current.sheets.map((item) => item.id === sheetId ? nextSheet : item) }, options.toast);
  }, [commit]);

  useEffect(() => {
    const cleanup = registerDetail({
      key: `program-sheets:${production.id}`,
      storageKey: `detailPane:program-sheets:${production.id}:v1`,
      triggerRef,
      detailLabel: "节目单详情",
      onClose: () => { setSelectedId(null); if (route.panel) navigate(productionPath(workspace.id, production.id, "program-sheets")); },
      getDetail: () => route.panel === "segment-types" ? <ProgramSheetSegmentTypeManagementPanel workspace={workspace} canWrite={canWrite && ["owner", "admin"].includes(workspace?.role)} usedTypeIds={[...new Set(state.sheets.flatMap((item) => item.items.filter((entry) => entry.kind === "segment").map((entry) => entry.segmentTypeId).filter(Boolean)))]} /> : selectedSheet ? <ProgramSheetDetail production={production} sheet={selectedSheet} productionPrograms={state.productionPrograms} workspacePrograms={workspacePrograms} programTypes={programTypes} segmentTypes={segmentTypes} occurrences={occurrences} canWrite={canWrite} onSheetChange={(updater, options) => changeSheet(selectedSheet.id, updater, options)} onAddExistingPrograms={(values) => {
        const current = stateRef.current;
        const items = values.map((program) => makeSheetItem("program", { productionProgramId: program.id, programSnapshot: program, title: program.name, durationSeconds: program.durationSeconds, order: current.sheets.find((candidate) => candidate.id === selectedSheet.id)?.items.length || 0 }));
        commit({ ...current, sheets: current.sheets.map((candidate) => candidate.id === selectedSheet.id ? { ...candidate, items: [...candidate.items, ...items.map((item, index) => ({ ...item, order: candidate.items.length + index }))], updatedAt: nowIso() } : candidate) }, "正在添加本场节目");
      }} onCopyWorkspacePrograms={(values) => {
        const current = stateRef.current;
        let nextPrograms = [...current.productionPrograms];
        const added = values.map((program) => {
          const existing = nextPrograms.find((item) => item.sourceProgramId === program.id);
          const programTypeName = program.programTypeName || program.program_type_name || programTypes.find((type) => type.id === (program.programTypeId || program.program_type_id))?.name || "";
          const productionProgram = existing || makeProductionProgram(production.id, { ...program, sourceKind: "workspace_copy", programTypeId: program.programTypeId || program.program_type_id, programTypeName });
          if (!existing) nextPrograms.push(productionProgram);
          return productionProgram;
        });
        commit({ ...current, productionPrograms: nextPrograms, sheets: current.sheets.map((candidate) => candidate.id === selectedSheet.id ? { ...candidate, items: [...candidate.items, ...added.map((program, index) => ({ ...makeSheetItem("program", { productionProgramId: program.id, programSnapshot: program, title: program.name, durationSeconds: program.durationSeconds }), order: candidate.items.length + index }))], updatedAt: nowIso() } : candidate) }, "正在复制并添加工作空间节目");
      }} onCreateCustomProgram={(values = {}) => {
        const current = stateRef.current;
        const productionProgram = makeProductionProgram(production.id, { ...values, sourceKind: "manual" });
        const item = makeSheetItem("program", { productionProgramId: productionProgram.id, programSnapshot: productionProgram, title: productionProgram.name, durationSeconds: productionProgram.durationSeconds });
        commit({ ...current, productionPrograms: [...current.productionPrograms, productionProgram], sheets: current.sheets.map((candidate) => candidate.id === selectedSheet.id ? { ...candidate, items: [...candidate.items, { ...item, order: candidate.items.length }], updatedAt: nowIso() } : candidate) }, "正在创建并添加活动节目");
      }} onAddItem={(kind, values = {}) => changeSheet(selectedSheet.id, (current) => ({ ...current, items: [...current.items, makeSheetItem(kind, { title: kind === "section" ? "新章节" : kind === "interval" ? "休息" : kind === "note" ? "现场备注" : "新环节", durationSeconds: kind === "interval" ? 15 * 60 : 0, ...values, order: current.items.length })], updatedAt: nowIso() }), { toast: `正在添加${kind === "segment" ? "环节" : kind === "section" ? "章节" : kind === "interval" ? "休息" : "备注"}` })} onDuplicate={(sheet) => setDialog({ type: "copy", sheet })} onAssign={(sheet) => setDialog({ type: "assign", sheet })} onPublish={(sheet) => setDialog({ type: "publish", sheet })} onArchive={(sheet) => setDialog({ type: "archive", sheet })} /> : null,
    });
    if (selectedSheet || route.panel) setDetailOpen(true, { announce: false });
    return cleanup;
  }, [canWrite, changeSheet, commit, navigate, occurrences, production, programTypes, registerDetail, route.panel, selectedSheet, segmentTypes, setDetailOpen, state.productionPrograms, workspace, workspacePrograms]);

  const nextRevision = useMemo(() => Math.max(0, ...state.sheets.map((item) => Number(item.revision) || 0)) + 1, [state.sheets]);
  const filteredSheets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.sheets.filter((sheet) => {
      const matchesQuery = !needle || `${sheet.name} ${sheet.changeNote}`.toLowerCase().includes(needle);
      const matchesStatus = status === "all" || sheet.status === status;
      const matchesOccurrence = occurrenceFilter === "all" || assignedOccurrenceIds(sheet).has(occurrenceFilter);
      return matchesQuery && matchesStatus && matchesOccurrence;
    }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [occurrenceFilter, query, state.sheets, status]);

  const createSheet = ({ name, changeNote, revision }) => {
    const sheet = makeProgramSheet(production.id, { name, changeNote, revision });
    commit({ ...stateRef.current, sheets: [...stateRef.current.sheets, sheet] }, "正在创建节目单");
    setDialog(null);
    setSelectedId(sheet.id);
  };
  const duplicateSheet = (source, name) => {
    const revision = nextRevision;
    const sourceItems = source.publishedSnapshot?.items || source.items;
    const copy = makeProgramSheet(production.id, { name, revision, changeNote: `复制自 ${source.name}`, items: sourceItems.map((item) => makeSheetItem(item.kind, { ...item, id: undefined, title: item.title, programSnapshot: item.programSnapshot, segmentTypeSnapshot: item.segmentTypeSnapshot })) });
    commit({ ...stateRef.current, sheets: [...stateRef.current.sheets, copy] }, "正在复制节目单");
    setDialog(null);
    setSelectedId(copy.id);
  };
  const archiveSheet = (sheet) => {
    commit({ ...stateRef.current, sheets: stateRef.current.sheets.map((item) => item.id === sheet.id ? { ...item, status: "archived", updatedAt: nowIso() } : item) }, "正在归档节目单");
    setDialog(null);
  };
  const applyAssignments = (sheet, occurrenceIds) => {
    changeSheet(sheet.id, { assignments: occurrenceIds.map((occurrenceId) => ({ occurrenceId, role: "official", assignedAt: nowIso() })), updatedAt: nowIso() }, { toast: "正在保存场次关联" });
    setDialog(null);
  };
  const replacementsFor = (sheet) => {
    const targetIds = assignedOccurrenceIds(sheet);
    return occurrences.filter((occurrence) => targetIds.has(occurrence.id) && stateRef.current.sheets.some((candidate) => candidate.id !== sheet.id && candidate.status === "published" && assignedOccurrenceIds(candidate).has(occurrence.id)));
  };
  const publishSheet = (sheet) => {
    const targetIds = assignedOccurrenceIds(sheet);
    if (!targetIds.size) return notify.error("请先关联至少一个场次");
    const publishedAt = nowIso();
    const nextSheets = stateRef.current.sheets.map((candidate) => {
      if (candidate.id === sheet.id) return { ...candidate, status: "published", publishedAt, publishedSnapshot: makePublishedSnapshot(candidate, { occurrenceOverrides: [] }), updatedAt: publishedAt };
      if (candidate.status !== "published") return candidate;
      return { ...candidate, assignments: candidate.assignments.filter((assignment) => !targetIds.has(assignment.occurrenceId)), updatedAt: publishedAt };
    });
    commit({ ...stateRef.current, sheets: nextSheets }, "正在发布节目单");
    setDialog(null);
  };

  const assignedFilterOptions = occurrences.filter((occurrence) => state.sheets.some((sheet) => assignedOccurrenceIds(sheet).has(occurrence.id)));
  return <div className="space-y-5" ref={triggerRef}><ProductionPageHeader workspace={workspace} production={production} title="节目单" subtitle={route.meta.description} actions={<div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => load({ toast: true })} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : ""} />刷新</Button>{canWrite && <Button variant="outline" onClick={() => navigate(programSheetSegmentTypePanelPath(workspace.id, production.id))}>环节类型</Button>}{canWrite && <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目单</Button>}</div>} /><ResourcePage title="节目单版本" description="本地前端预览 · 尚未同步到服务器" count={filteredSheets.length} search={{ value: query, onChange: setQuery, placeholder: "搜索节目单名称或变更说明" }} filters={<><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="review">待审核</SelectItem><SelectItem value="published">正式</SelectItem><SelectItem value="archived">已归档</SelectItem></SelectContent></Select><Select value={occurrenceFilter} onValueChange={setOccurrenceFilter}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部场次</SelectItem>{occurrences.map((occurrence) => <SelectItem key={occurrence.id} value={occurrence.id}>{occurrenceTitle(occurrence)}</SelectItem>)}</SelectContent></Select></>} showViewToggle={false} summary={<span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />活动时区：{production.timezone}</span>} loading={loading} empty={error ? { icon: ListMusic, title: "无法加载节目单", description: error.message, action: <Button variant="outline" onClick={() => load({ toast: true })}>重试</Button> } : !filteredSheets.length ? { icon: ListMusic, title: query || status !== "all" ? "没有匹配的节目单" : "还没有节目单版本", description: canWrite ? "创建一个草稿，开始编排节目顺序。" : "当前活动还没有可查看的节目单。", action: canWrite && !query && status === "all" ? <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目单</Button> : null } : null}><Card variant="flush"><CardContent className="p-0">{filteredSheets.map((sheet) => <SheetListRow key={sheet.id} sheet={sheet} occurrences={occurrences} production={production} selected={sheet.id === selectedId} canWrite={canWrite} onSelect={(id) => setSelectedId(id)} onCopy={(item) => setDialog({ type: "copy", sheet: item })} onArchive={(item) => setDialog({ type: "archive", sheet: item })} />)}</CardContent></Card></ResourcePage><NewProgramSheetDialog open={dialog?.type === "new"} onOpenChange={(open) => !open && setDialog(null)} nextRevision={nextRevision} onCreate={createSheet} />{dialog?.type === "copy" && <CopyProgramSheetDialog open sheet={dialog.sheet} nextRevision={nextRevision} onOpenChange={(open) => !open && setDialog(null)} onConfirm={(name) => duplicateSheet(dialog.sheet, name)} />}{dialog?.type === "archive" && <ArchiveProgramSheetDialog open sheet={dialog.sheet} onOpenChange={(open) => !open && setDialog(null)} onConfirm={() => archiveSheet(dialog.sheet)} />}{dialog?.type === "assign" && <AssignOccurrencesDialog open sheet={dialog.sheet} timezone={production.timezone} occurrences={occurrences} onOpenChange={(open) => !open && setDialog(null)} onApply={(ids) => applyAssignments(dialog.sheet, ids)} />}{dialog?.type === "publish" && <PublishProgramSheetDialog open sheet={dialog.sheet} occurrences={occurrences} replacements={replacementsFor(dialog.sheet)} onOpenChange={(open) => !open && setDialog(null)} onConfirm={() => publishSheet(dialog.sheet)} />}</div>;
}
