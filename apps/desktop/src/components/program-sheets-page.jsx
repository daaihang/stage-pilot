import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Archive, Clock3, Copy, ListMusic, Plus, RefreshCw } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResourcePage } from "@/components/resource-page";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { TimeText } from "@/components/time-text";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { listProductionOccurrences } from "@/lib/production-api";
import { createProgramSheet, listProductionPrograms, listProgramSheets, normalizeProductionProgramsResponse, normalizeProgramSheetResponse, updateProgramSheet, archiveProgramSheet as archiveProgramSheetApi, copyProgramSheet as copyProgramSheetApi, publishProgramSheet as publishProgramSheetApi, previewPublishProgramSheet, updateProgramSheetOccurrences } from "@/lib/program-sheet-api";
import { listResource, listResourceTypes } from "@/lib/resource-api";
import { makeProgramSheet, makeSheetItem, makePublishedSnapshot, normalizeProgramSheetState, nowIso } from "@/lib/program-sheet-store";
import { programSheetSegmentTypePanelPath, workspacePath } from "@/lib/navigation";
import { assignedOccurrenceIds, formatDuration, getProgramItemCount, getTotalDurationSeconds, occurrenceTitle, programSheetStatusLabels } from "@/lib/program-sheet-utils";
import { notify } from "@/components/ui/sonner";
import { ArchiveProgramSheetDialog, AssignOccurrencesDialog, CopyProgramSheetDialog, NewProgramSheetDialog, PublishCheckDialog, PublishProgramSheetDialog } from "@/components/program-sheet-dialogs";
import { ProgramSheetDetail } from "@/components/program-sheet-detail";
import { ProductionProgramCreateDetail } from "@/components/production-program-create-detail";
import { listSegmentTypes } from "@/lib/program-sheet-api";
import { migrateLegacySegmentTypes } from "@/lib/program-sheet-segment-type-migration";
import { migrateLegacyProgramSheets } from "@/lib/program-sheet-migration";
import { resolveSelectItems } from "@/lib/select-options";

function canWriteProgramSheets(workspace, production) {
  return ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit");
}

function canPublishProgramSheets(workspace, production) {
  return ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.publish");
}

function canShareProgramSheets(workspace, production) {
  return ["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.share");
}

function sheetStatusClass(status) {
  if (status === "published") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  if (status === "review") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function SheetListRow({ sheet, occurrences, production, selected, canWrite, onSelect, onCopy, onArchive }) {
  const assigned = (occurrences || []).filter((occurrence) => assignedOccurrenceIds(sheet).has(occurrence.id));
  return <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 ${selected ? "bg-muted/50" : "hover:bg-muted/30"}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={(event) => onSelect(sheet.id, event)}><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{sheet.name}</p><Badge className={sheetStatusClass(sheet.status)} variant="secondary">{programSheetStatusLabels[sheet.status]}</Badge><Badge variant="outline">v{sheet.revision}</Badge></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{getProgramItemCount(sheet)} 个节目 · {formatDuration(getTotalDurationSeconds(sheet))}</span><span>{assigned.length ? `正式：${assigned.map(occurrenceTitle).join("、")}` : "未关联正式场次"}</span><span>更新于 <TimeText instant={sheet.updatedAt} timezone={production.timezone} /></span></div>{sheet.changeNote ? <p className="mt-1 truncate text-xs text-muted-foreground">{sheet.changeNote}</p> : null}</button><div className="flex items-center gap-1">{canWrite && sheet.status !== "archived" ? <Button variant="ghost" size="icon-sm" onClick={() => onCopy(sheet)} aria-label={`复制${sheet.name}`} title="复制为新草稿"><Copy /></Button> : null}{canWrite && sheet.status === "draft" ? <Button variant="ghost" size="icon-sm" onClick={() => onArchive(sheet)} aria-label={`归档${sheet.name}`} title="归档"><Archive /></Button> : null}</div></div>;
}

export function ProgramSheetsPage({ route, workspace, production }) {
  const canWrite = canWriteProgramSheets(workspace, production);
  const canPublish = canPublishProgramSheets(workspace, production);
  const canShare = canShareProgramSheets(workspace, production);
  const [state, setState] = useState(() => normalizeProgramSheetState(null, production.id));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [occurrences, setOccurrences] = useState([]);
  const [workspacePrograms, setWorkspacePrograms] = useState([]);
  const [programTypes, setProgramTypes] = useState([]);
  const [segmentTypes, setSegmentTypes] = useState([]);
  const [segmentTypeLoading, setSegmentTypeLoading] = useState(true);
  const [segmentTypeError, setSegmentTypeError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [occurrenceFilter, setOccurrenceFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(route.detailId || null);
  const [dialog, setDialog] = useState(null);
  const [programCreateContext, setProgramCreateContext] = useState(null);
  const [publishCheck, setPublishCheck] = useState(null);
  const triggerRef = useRef(null);
  const detailTriggerRef = useRef(null);
  const requestSequence = useRef(0);
  const { setDetailOpen } = useWindowDetail();
  const navigate = useNavigate();
  const location = useLocation();
  const updateDetailRoute = useCallback((nextId) => {
    const params = new URLSearchParams(location.search);
    if (nextId) params.set("detail", nextId); else params.delete("detail");
    const search = params.toString();
    setSelectedId(nextId || null);
    navigate(`${location.pathname}${search ? `?${search}` : ""}`, { preventScrollReset: true });
  }, [location.pathname, location.search, navigate]);
  useEffect(() => { setSelectedId(route.detailId || null); }, [route.detailId]);

  const load = useCallback(async ({ toast = false } = {}) => {
    const requestId = ++requestSequence.current;
    setError(null);
    setLoading((current) => current && !stateRef.current.sheets.length);
    if (stateRef.current.sheets.length) setRefreshing(true);
    try {
      await migrateLegacyProgramSheets(production.id, { isAdmin: ["owner", "admin"].includes(workspace?.role) });
      const [sheetResult, nextOccurrences, activityProgramResult, workspaceProgramResult, typesResult] = await Promise.all([
        listProgramSheets(production.id),
        listProductionOccurrences(production.id),
        listProductionPrograms(production.id),
        listResource(workspace.id, "programs").catch(() => ({ items: [] })),
        listResourceTypes(workspace.id, "programs").catch(() => ({ items: [] })),
      ]);
      if (requestId !== requestSequence.current) return;
      const cloudPrograms = normalizeProductionProgramsResponse(activityProgramResult, production.id);
      const cloudSheets = normalizeProgramSheetResponse(sheetResult, production.id);
      const nextState = normalizeProgramSheetState({ version: 1, productionId: production.id, productionPrograms: cloudPrograms, sheets: cloudSheets }, production.id);
      stateRef.current = nextState;
      setState(nextState);
      setOccurrences(Array.isArray(nextOccurrences) ? nextOccurrences : []);
      setWorkspacePrograms(Array.isArray(workspaceProgramResult?.items) ? workspaceProgramResult.items : Array.isArray(workspaceProgramResult) ? workspaceProgramResult : []);
      setProgramTypes(Array.isArray(typesResult?.items) ? typesResult.items : Array.isArray(typesResult) ? typesResult : []);
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
    let active = true;
    setSegmentTypeLoading(true);
    setSegmentTypeError(null);
    migrateLegacySegmentTypes(workspace.id, { isAdmin: ["owner", "admin"].includes(workspace?.role) }).then(() => listSegmentTypes(workspace.id)).then((result) => (result?.items || result || []).map((item) => ({ ...item, systemKey: item.system_key || item.systemKey, isSystem: item.is_system ?? item.isSystem, isActive: item.is_active ?? item.isActive, sortOrder: item.sort_order ?? item.sortOrder, defaultDurationSeconds: item.default_duration_seconds ?? item.defaultDurationSeconds, countsTowardDuration: item.counts_toward_duration ?? item.countsTowardDuration, audienceVisible: item.audience_visible ?? item.audienceVisible, requiresExecution: item.requires_execution ?? item.requiresExecution }))).then((nextTypes) => {
      if (active) setSegmentTypes(nextTypes);
    }).catch((nextError) => {
      if (active) {
        setSegmentTypes([]);
        setSegmentTypeError(nextError);
        notify.error("环节类型加载失败", { description: "节目单仍可查看；环节条目暂时不可添加，请稍后重试。" });
      }
    }).finally(() => { if (active) setSegmentTypeLoading(false); });
    return () => { active = false; };
  }, [workspace.id]);

  useEffect(() => {
    if (route.panel !== "segment-types") return;
    const params = new URLSearchParams(location.search);
    params.delete("panel");
    const search = params.toString();
    navigate(workspacePath(workspace.id, "program-sheet-segment-types"), { replace: true, state: { from: `${location.pathname}${search ? `?${search}` : ""}` } });
  }, [location.pathname, location.search, navigate, route.panel, workspace.id]);

  useEffect(() => {
    load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const selectedSheet = useMemo(() => state.sheets.find((item) => item.id === selectedId) || null, [selectedId, state.sheets]);
  const commit = useCallback(async (nextState, message) => {
    const previous = stateRef.current;
    const normalized = normalizeProgramSheetState(nextState, production.id);
    stateRef.current = normalized;
    setState(normalized);
    const toastId = message ? notify.loading(message) : null;
    try {
      const results = await Promise.all(normalized.sheets.filter((sheet) => sheet.status !== "published" && sheet.status !== "archived").map((sheet) => updateProgramSheet(sheet.id, {
        name: sheet.name,
        change_note: sheet.changeNote,
        status: sheet.status,
        items: sheet.items.map((item, index) => ({ ...item, id: item.id, sort_order: index })),
        assignments: sheet.assignments.map((assignment) => ({ occurrence_id: assignment.occurrenceId, role: assignment.role })),
      })));
      if (toastId) notify.success("节目单已保存到云端", { id: toastId });
      return results;
    } catch (nextError) {
      stateRef.current = previous;
      setState(previous);
      if (toastId) notify.error("节目单云端保存失败，已恢复原内容", { id: toastId, description: nextError?.message || String(nextError) });
      else notify.error("节目单云端保存失败，已恢复原内容", { description: nextError?.message || String(nextError) });
      throw nextError;
    }
  }, [production.id]);
  const changeSheet = useCallback((sheetId, updater, options = {}) => {
    const current = stateRef.current;
    const existing = current.sheets.find((item) => item.id === sheetId);
    if (!existing) return;
    const nextSheet = typeof updater === "function" ? updater(existing) : { ...existing, ...updater };
    commit({ ...current, sheets: current.sheets.map((item) => item.id === sheetId ? nextSheet : item) }, options.toast);
  }, [commit]);
  const onAddItem = useCallback((kind, values = {}) => {
    if (!selectedSheet) return;
    changeSheet(selectedSheet.id, (current) => ({
      ...current,
      items: [...current.items, makeSheetItem(kind, {
        title: kind === "section" ? "新章节" : kind === "interval" ? "休息" : kind === "note" ? "现场备注" : "新环节",
        durationSeconds: kind === "interval" ? 15 * 60 : 0,
        ...values,
        order: current.items.length,
      })],
      updatedAt: nowIso(),
    }), { toast: `正在添加${kind === "segment" ? "环节" : kind === "section" ? "章节" : kind === "interval" ? "休息" : "备注"}` });
  }, [changeSheet, selectedSheet]);

  const getDetail = useCallback(() => selectedSheet ? (programCreateContext ? <ProductionProgramCreateDetail workspacePrograms={workspacePrograms} programTypes={programTypes} programTypesLoading={loading} existingPrograms={state.productionPrograms} mode={programCreateContext.mode} sourceProgram={programCreateContext.sourceProgram} initialDraft={programCreateContext.initialDraft} onCancel={() => setProgramCreateContext(null)} onSave={async (values) => {
    const result = await createProductionProgram(production.id, { name: values.name, program_type_id: values.programTypeId || null, program_type_name: values.programTypeName || "", performers: values.performers || [], duration_seconds: Number(values.durationSeconds || 0), description: values.description || "", technical_notes: values.technicalNotes || "", source_kind: values.sourceKind || (programCreateContext.mode === "workspace-copy" ? "workspace_copy" : "manual"), workspace_program_id: values.sourceProgramId || programCreateContext.sourceProgram?.id || null });
    const created = result?.program || result;
    const current = stateRef.current;
    const target = current.sheets.find((candidate) => candidate.id === selectedSheet.id);
    if (created?.id && target) await commit({ ...current, sheets: current.sheets.map((candidate) => candidate.id === target.id ? { ...candidate, items: [...candidate.items, makeSheetItem("program", { productionProgramId: created.id, programSnapshot: created, title: created.name || values.name, durationSeconds: Number(created.durationSeconds ?? created.duration_seconds ?? values.durationSeconds ?? 0), order: candidate.items.length })] } : candidate) }, "正在添加活动节目");
    setProgramCreateContext(null);
    await load();
    notify.success("活动节目已保存，并已加入节目单");
  }} /> : <ProgramSheetDetail production={production} sheet={selectedSheet} productionPrograms={state.productionPrograms} workspacePrograms={workspacePrograms} programTypes={programTypes} programTypesLoading={loading} segmentTypes={segmentTypes} segmentTypeLoading={segmentTypeLoading} segmentTypeError={segmentTypeError} occurrences={occurrences} canWrite={canWrite} canPublish={canPublish} canShare={canShare} onSheetChange={(updater, options) => changeSheet(selectedSheet.id, updater, options)} onAddExistingPrograms={(values) => {
        const current = stateRef.current;
        const items = values.map((program) => makeSheetItem("program", { productionProgramId: program.id, programSnapshot: program, title: program.name, durationSeconds: program.durationSeconds, order: current.sheets.find((candidate) => candidate.id === selectedSheet.id)?.items.length || 0 }));
        commit({ ...current, sheets: current.sheets.map((candidate) => candidate.id === selectedSheet.id ? { ...candidate, items: [...candidate.items, ...items.map((item, index) => ({ ...item, order: candidate.items.length + index }))], updatedAt: nowIso() } : candidate) }, "正在添加本场节目");
      }} onCopyWorkspacePrograms={(program) => { if (program) { setProgramCreateContext({ mode: "workspace-copy", sourceProgram: program, initialDraft: null }); } }} onCreateCustomProgram={(payload) => { const draft = payload?.draft; setProgramCreateContext({ mode: "program-sheet", sourceProgram: null, initialDraft: draft ? { ...draft, durationMinutes: String(Math.round(Number(draft.durationSeconds || 0) / 60)) } : null }); }} onAddItem={onAddItem} onDuplicate={(sheet) => setDialog({ type: "copy", sheet })} onAssign={(sheet) => setDialog({ type: "assign", sheet })} onPublish={(sheet) => setDialog({ type: "publish", sheet })} onArchive={(sheet) => setDialog({ type: "archive", sheet })} />) : null,
   [canPublish, canShare, canWrite, changeSheet, commit, loading, occurrences, onAddItem, production, programCreateContext, programTypes, selectedSheet, segmentTypeError, segmentTypeLoading, segmentTypes, state.productionPrograms, workspace, workspacePrograms]);
  useWindowDetailRegistration({ key: `program-sheets:${production.id}`, storageKey: `detailPane:program-sheets:${production.id}:v1`, triggerRef: detailTriggerRef, detailLabel: "节目单详情", getDetail, onClose: () => { setProgramCreateContext(null); updateDetailRoute(null); } });
  useEffect(() => { setDetailOpen(Boolean(selectedSheet), { announce: false }); }, [selectedSheet, setDetailOpen]);

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
    setDialog(null);
    updateDetailRoute(sheet.id);
    createProgramSheet(production.id, { name: sheet.name, change_note: sheet.changeNote, revision }).then((created) => {
      const next = normalizeProgramSheetResponse([created], production.id)[0] || sheet;
      commit({ ...stateRef.current, sheets: [...stateRef.current.sheets, next] }, "正在创建节目单");
      updateDetailRoute(next.id || sheet.id);
    }).catch((error) => notify.error("创建节目单失败", { description: error?.message || String(error) }));
  };
  const duplicateSheet = (source, name) => {
    const revision = nextRevision;
    const sourceItems = source.publishedSnapshot?.items || source.items;
    const copy = makeProgramSheet(production.id, { name, revision, changeNote: `复制自 ${source.name}`, items: sourceItems.map((item) => makeSheetItem(item.kind, { ...item, id: undefined, title: item.title, programSnapshot: item.programSnapshot, segmentTypeSnapshot: item.segmentTypeSnapshot })) });
    copyProgramSheetApi(source.id, name).then((created) => {
      const next = normalizeProgramSheetResponse([created], production.id)[0] || copy;
      commit({ ...stateRef.current, sheets: [...stateRef.current.sheets, next] }, "正在复制节目单");
      updateDetailRoute(next.id || copy.id);
    }).catch((error) => notify.error("复制节目单失败", { description: error?.message || String(error) }));
    setDialog(null);
    updateDetailRoute(copy.id);
  };
  const archiveSheet = (sheet) => {
    archiveProgramSheetApi(sheet.id).then(() => commit({ ...stateRef.current, sheets: stateRef.current.sheets.map((item) => item.id === sheet.id ? { ...item, status: "archived", updatedAt: nowIso() } : item) }, "正在归档节目单")).catch((error) => notify.error("归档节目单失败", { description: error?.message || String(error) }));
    setDialog(null);
  };
  const applyAssignments = (sheet, occurrenceIds) => {
    updateProgramSheetOccurrences(sheet.id, occurrenceIds).then(() => changeSheet(sheet.id, { assignments: occurrenceIds.map((occurrenceId) => ({ occurrenceId, role: "official", assignedAt: nowIso() })), updatedAt: nowIso() }, { toast: "正在保存场次关联" })).catch((error) => notify.error("保存场次关联失败", { description: error?.message || String(error) }));
    setDialog(null);
  };
  const replacementsFor = (sheet) => {
    const targetIds = assignedOccurrenceIds(sheet);
    return occurrences.filter((occurrence) => targetIds.has(occurrence.id) && stateRef.current.sheets.some((candidate) => candidate.id !== sheet.id && candidate.status === "published" && assignedOccurrenceIds(candidate).has(occurrence.id)));
  };
  const publishSheet = async (sheet) => {
    if (!canPublish) return notify.error("当前账号没有发布节目单的权限");
    const targetIds = assignedOccurrenceIds(sheet);
    if (!targetIds.size) return notify.error("请先关联至少一个场次");
    try {
      const check = await previewPublishProgramSheet(sheet.id);
      setPublishCheck({ sheet, check });
      setDialog(null);
      return;
    } catch (error) { return notify.error("发布检查失败", { description: error?.message || String(error) }); }
  };

  const confirmPublish = async (sheet) => {
    try {
      await publishProgramSheetApi(sheet.id);
      setPublishCheck(null);
      notify.success("节目单已发布");
      await load();
    } catch (error) {
      notify.error("发布节目单失败", { description: error?.message || String(error) });
    }
  };

  const assignedFilterOptions = occurrences.filter((occurrence) => state.sheets.some((sheet) => assignedOccurrenceIds(sheet).has(occurrence.id)));
  const statusFilterOptions = [{ value: "all", label: "全部状态" }, { value: "draft", label: "草稿" }, { value: "review", label: "待审核" }, { value: "published", label: "正式" }, { value: "archived", label: "已归档" }];
  const statusFilterSelect = resolveSelectItems(statusFilterOptions, { value: status });
  const occurrenceOptions = occurrences.map((occurrence) => ({ value: occurrence.id, label: occurrenceTitle(occurrence) || "未命名场次" }));
  const occurrenceFilterOptions = [{ value: "all", label: "全部场次" }, ...occurrenceOptions];
  const occurrenceFilterSelect = resolveSelectItems(occurrenceFilterOptions, { value: occurrenceFilter });
  const openSegmentTypes = () => {
    const params = new URLSearchParams(location.search);
    params.delete("panel");
    const search = params.toString();
    navigate(programSheetSegmentTypePanelPath(workspace.id, production.id), { state: { from: `${location.pathname}${search ? `?${search}` : ""}` } });
  };
  return <div className="space-y-5" ref={triggerRef}><ProductionPageHeader workspace={workspace} production={production} title="节目单" subtitle={route.meta.description} actions={{ primary: canWrite ? <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目单</Button> : null, secondary: [<Button key="refresh" variant="outline" onClick={() => load({ toast: true })} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : ""} />刷新</Button>, canWrite ? <Button key="segment-types" variant="outline" onClick={() => navigate(programSheetSegmentTypePanelPath(workspace.id, production.id))}>环节类型</Button> : null] }} floatingPrimary={canWrite ? <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目单</Button> : null} /><ResourcePage headingLevel="h2" title="节目单版本" description="云端节目单版本 · 发布后可受控分享" count={filteredSheets.length} search={{ value: query, onChange: setQuery, placeholder: "搜索节目单名称或变更说明" }} filters={<><Select items={statusFilterSelect.items} value={status} onValueChange={setStatus}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent>{statusFilterSelect.missingOption ? <SelectItem value={statusFilterSelect.missingOption.value} disabled>{statusFilterSelect.missingOption.label}</SelectItem> : null}{statusFilterOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select items={occurrenceFilterSelect.items} value={occurrenceFilter} onValueChange={setOccurrenceFilter} disabled={loading}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent>{occurrenceFilterSelect.missingOption ? <SelectItem value={occurrenceFilterSelect.missingOption.value} disabled>{occurrenceFilterSelect.missingOption.label}</SelectItem> : null}<SelectItem value="all">全部场次</SelectItem>{assignedFilterOptions.map((occurrence) => <SelectItem key={occurrence.id} value={occurrence.id}>{occurrenceTitle(occurrence)}</SelectItem>)}</SelectContent></Select></>} showViewToggle={false} summary={<span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />活动时区：{production.timezone}</span>} loading={loading} empty={error ? { icon: ListMusic, title: "无法加载节目单", description: error.message, action: <Button variant="outline" onClick={() => load({ toast: true })}>重试</Button> } : !filteredSheets.length ? { icon: ListMusic, title: query || status !== "all" ? "没有匹配的节目单" : "还没有节目单版本", description: canWrite ? "创建一个草稿，开始编排节目顺序。" : "当前活动还没有可查看的节目单。", action: canWrite && !query && status === "all" ? <Button onClick={() => setDialog({ type: "new" })}><Plus />新建节目单</Button> : null } : null}><Card variant="flush"><CardContent className="p-0">{filteredSheets.map((sheet) => <SheetListRow key={sheet.id} sheet={sheet} occurrences={occurrences} production={production} selected={sheet.id === selectedId} canWrite={canWrite} onSelect={(id, event) => { detailTriggerRef.current = event?.currentTarget || null; updateDetailRoute(id); }} onCopy={(item) => setDialog({ type: "copy", sheet: item })} onArchive={(item) => setDialog({ type: "archive", sheet: item })} />)}</CardContent></Card></ResourcePage><NewProgramSheetDialog open={dialog?.type === "new"} onOpenChange={(open) => !open && setDialog(null)} nextRevision={nextRevision} onCreate={createSheet} />{dialog?.type === "copy" && <CopyProgramSheetDialog open sheet={dialog.sheet} nextRevision={nextRevision} onOpenChange={(open) => !open && setDialog(null)} onConfirm={(name) => duplicateSheet(dialog.sheet, name)} />}{dialog?.type === "archive" && <ArchiveProgramSheetDialog open sheet={dialog.sheet} nextRevision={nextRevision} onOpenChange={(open) => !open && setDialog(null)} onConfirm={() => archiveSheet(dialog.sheet)} />}{dialog?.type === "assign" && <AssignOccurrencesDialog open sheet={dialog.sheet} timezone={production.timezone} occurrences={occurrences} onOpenChange={(open) => !open && setDialog(null)} onApply={(ids) => applyAssignments(dialog.sheet, ids)} />}{dialog?.type === "publish" && <PublishProgramSheetDialog open sheet={dialog.sheet} occurrences={occurrences} replacements={replacementsFor(dialog.sheet)} onOpenChange={(open) => !open && setDialog(null)} onConfirm={() => confirmPublish(dialog.sheet)} />}{publishCheck && <PublishCheckDialog open sheet={publishCheck.sheet} check={publishCheck.check} onOpenChange={(open) => !open && setPublishCheck(null)} onConfirm={() => confirmPublish(publishCheck.sheet)} />}</div>;
}
