import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  Copy,
  FileMusic,
  Plus,
  RefreshCw,
  RotateCcw,
} from "@/components/ui/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
AlertDialogBody, } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListSurface, ResourcePage } from "@/components/resource-page";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { TimeText } from "@/components/time-text";
import {
  useWindowDetail,
  useWindowDetailRegistration,
} from "@/components/window-detail-context";
import { notify } from "@/components/ui/sonner";
import { listResource, listResourceTypes } from "@/lib/resource-api";
import { listProductionOccurrences } from "@/lib/production-api";
import { makeSheetItem } from "@/lib/program-sheet-store";
import {
  archiveProductionProgram as archiveProductionProgramApi,
  createProductionProgram as createProductionProgramApi,
  listProductionPrograms,
  listProgramSheets,
  normalizeProductionProgramsResponse,
  normalizeProgramSheetResponse,
  restoreProductionProgram as restoreProductionProgramApi,
  updateProductionProgram as updateProductionProgramApi,
  updateProgramSheet,
} from "@/lib/program-sheet-api";
import {
  getProductionProgramMissingInfo,
  productionProgramSourceLabels,
  productionProgramStatusLabels,
} from "@/lib/production-program-utils";
import { resolveSelectItems } from "@/lib/select-options";
import { AddProgramToSheetsDialog, ProductionProgramPickerDialog } from "@/components/production-program-dialogs";
import { ProductionProgramDetail } from "@/components/production-program-detail";
import { ProductionProgramCreateDetail } from "@/components/production-program-create-detail";
import { migrateLegacyProgramSheets } from "@/lib/program-sheet-migration";

function canWriteProductionPrograms(workspace, production) {
  return (
    ["owner", "admin"].includes(workspace?.role) ||
    production?.permissionKeys?.includes("production.edit")
  );
}

function statusClass(status) {
  if (status === "confirmed")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "needs_info")
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function ProgramListRow({
  program,
  timezone,
  selected,
  onSelect,
  canWrite,
  onDuplicate,
  onArchive,
  onRestore,
}) {
  const missing = getProductionProgramMissingInfo(program);
  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 ${selected ? "bg-muted/50" : "hover:bg-muted/30"}`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={(event) => onSelect(program.id, event)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{program.name}</p>
          <Badge className={statusClass(program.status)} variant="secondary">
            {productionProgramStatusLabels[program.status] || program.status}
          </Badge>
          <Badge variant="outline">
            {productionProgramSourceLabels[program.sourceKind] || "活动节目"}
          </Badge>
          {program.programTypeName ? (
            <Badge variant="outline">{program.programTypeName}</Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {program.durationSeconds
              ? `${Math.round(program.durationSeconds / 60)} 分钟`
              : "时长待补充"}
          </span>
          <span>
            {program.performers?.length
              ? program.performers.join("、")
              : "演出者待补充"}
          </span>
          <span>
            更新于 <TimeText instant={program.updatedAt} timezone={timezone} />
          </span>
        </div>
        {missing.length ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            待补：{missing.join("、")}
          </p>
        ) : null}
      </button>
      <div className="flex items-center gap-1">
        {canWrite && program.status !== "archived" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDuplicate(program)}
            aria-label={`复制${program.name}`}
            title="复制活动节目"
          >
            <Copy />
          </Button>
        ) : null}
        {canWrite && program.status !== "archived" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onArchive(program)}
            aria-label={`归档${program.name}`}
            title="归档"
          >
            <Archive />
          </Button>
        ) : null}
        {canWrite && program.status === "archived" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRestore(program)}
            aria-label={`恢复${program.name}`}
            title="恢复"
          >
            <RotateCcw />
          </Button>
        ) : null}
      </div>
    </div>
  );
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
  const [selectedId, setSelectedId] = useState(route.detailId || null);
  const [dialog, setDialog] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationContext, setCreationContext] = useState({ mode: "create", sourceProgram: null, initialDraft: null });
  const triggerRef = useRef(null);
  const detailTriggerRef = useRef(null);
  const requestSequence = useRef(0);
  const { setDetailOpen } = useWindowDetail();
  const location = useLocation();
  const navigate = useNavigate();
  const updateDetailRoute = useCallback((nextId) => { const params = new URLSearchParams(location.search); if (nextId) params.set("detail", nextId); else params.delete("detail"); const search = params.toString(); setSelectedId(nextId || null); setCreating(nextId === "new"); navigate(`${location.pathname}${search ? `?${search}` : ""}`, { preventScrollReset: true }); }, [location.pathname, location.search, navigate]);
  useEffect(() => { setSelectedId(route.detailId || null); setCreating(route.detailId === "new"); }, [route.detailId]);

  const load = useCallback(
    async ({ toast = false } = {}) => {
      const requestId = ++requestSequence.current;
      setLoading((current) => current || !programs.length);
      if (programs.length) setRefreshing(true);
      try {
        await migrateLegacyProgramSheets(production.id, { isAdmin: ["owner", "admin"].includes(workspace?.role) });
        const [programResult, sheetResult, workspaceResult, typesResult] =
          await Promise.all([
            listProductionPrograms(production.id),
            listProgramSheets(production.id),
            listResource(workspace.id, "programs"),
            listResourceTypes(workspace.id, "programs"),
          ]);
        if (requestId !== requestSequence.current) return;
        setPrograms(
          normalizeProductionProgramsResponse(programResult, production.id),
        );
        setSheets(normalizeProgramSheetResponse(sheetResult, production.id));
        setWorkspacePrograms(workspaceResult.items || []);
        setProgramTypes(typesResult.items || []);
        if (toast) notify.success("活动节目已刷新");
      } catch (error) {
        if (requestId === requestSequence.current && toast)
          notify.error("活动节目刷新失败", {
            description: error?.message || String(error),
          });
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [production.id, workspace.id, programs.length],
  );

  useEffect(() => {
    load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const selectedProgram = useMemo(
    () => programs.find((item) => item.id === selectedId) || null,
    [programs, selectedId],
  );

  const onCloseDetail = useCallback(() => {
    updateDetailRoute(null);
    setCreationContext({ mode: "create", sourceProgram: null, initialDraft: null });
  }, [updateDetailRoute]);
  const getDetail = useCallback(
    () =>
      creating ? (
        <ProductionProgramCreateDetail
          workspacePrograms={workspacePrograms}
          programTypes={programTypes}
          programTypesLoading={loading}
          existingPrograms={programs}
          mode={creationContext.mode}
          sourceProgram={creationContext.sourceProgram}
          initialDraft={creationContext.initialDraft}
          onCancel={() => {
            updateDetailRoute(null);
            setDetailOpen(false);
          }}
          onSave={async (values) => {
            if (values.openExistingId) {
              setCreating(false);
              updateDetailRoute(values.openExistingId);
              return;
            }
            try {
              const created = await createProductionProgramApi(production.id, {
                name: values.name,
                program_type_id: values.programTypeId || null,
                program_type_name: values.programTypeName || "",
                performers: values.performers || [],
                duration_seconds: values.durationSeconds || 0,
                description: values.description || "",
                technical_notes: values.technicalNotes || "",
                source_kind: values.sourceKind || "manual",
                workspace_program_id: values.sourceProgramId || null,
              });
              await load();
              setCreating(false);
              updateDetailRoute(created?.id || created?.program?.id);
              notify.success("活动节目已创建");
            } catch (error) {
              notify.error("活动节目创建失败", {
                description: error?.message || String(error),
              });
              throw error;
            }
          }}
        />
      ) : selectedProgram ? (
        <ProductionProgramDetail
          program={selectedProgram}
          workspace={workspace}
          production={production}
          programTypes={programTypes}
          programTypesLoading={loading}
          canWrite={canWrite}
          onSave={async (patch) => {
            try {
              await updateProductionProgramApi(
                production.id,
                selectedProgram.id,
                {
                  ...patch,
                  program_type_id: patch.programTypeId,
                  program_type_name: patch.programTypeName,
                  duration_seconds: patch.durationSeconds,
                },
              );
              await load();
              notify.success("活动节目已保存");
            } catch (error) {
              notify.error("活动节目保存失败", {
                description: error?.message || String(error),
              });
              throw error;
            }
          }}
          onDuplicate={(program) => setDialog({ type: "duplicate", program })}
          onArchive={(program) => setDialog({ type: "archive", program })}
          onRestore={async (program) => {
            try {
              await restoreProductionProgramApi(production.id, program.id);
              await load();
              notify.success("活动节目已恢复");
            } catch (error) {
              notify.error("活动节目恢复失败", {
                description: error?.message || String(error),
              });
            }
          }}
          onAddToSheets={(program) => setDialog({ type: "assign", program })}
        />
      ) : null,
    [
      canWrite,
      creating,
      creationContext,
      production.id,
      programTypes,
      programs,
      selectedProgram,
      setDetailOpen,
      updateDetailRoute,
      workspace.id,
      workspacePrograms,
    ],
  );
  useWindowDetailRegistration({
    key: `production-programs:${production.id}`,
    storageKey: `detailPane:production-programs:${production.id}:v1`,
    triggerRef: detailTriggerRef,
    detailLabel: "活动节目详情",
    getDetail,
    onClose: onCloseDetail,
  });

  useEffect(() => {
    setDetailOpen(Boolean(selectedProgram || creating), { announce: false });
  }, [creating, selectedProgram, setDetailOpen]);

  const filteredPrograms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return programs
      .filter((program) => {
        const matchesQuery =
          !needle ||
          `${program.name} ${program.description} ${program.technicalNotes} ${(program.performers || []).join(" ")}`
            .toLowerCase()
            .includes(needle);
        const matchesStatus = status === "all" || program.status === status;
        const matchesSource = source === "all" || program.sourceKind === source;
        const matchesType =
          typeId === "all" || program.programTypeId === typeId;
        return matchesQuery && matchesStatus && matchesSource && matchesType;
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [programs, query, source, status, typeId]);
  const statusFilterOptions = [{ value: "all", label: "全部状态" }, ...Object.entries(productionProgramStatusLabels).map(([value, label]) => ({ value, label }))];
  const sourceFilterOptions = [{ value: "all", label: "全部来源" }, ...Object.entries(productionProgramSourceLabels).map(([value, label]) => ({ value, label }))];
  const typeFilterOptions = [{ value: "all", label: "全部类型" }, ...programTypes.map((item) => ({ value: item.id, label: `${item.name || "未命名类型"}${item.is_active === false ? "（已停用）" : ""}` }))];
  const statusFilterSelect = resolveSelectItems(statusFilterOptions, { value: status });
  const sourceFilterSelect = resolveSelectItems(sourceFilterOptions, { value: source });
  const typeFilterSelect = resolveSelectItems(typeFilterOptions, { value: typeId, loading });

  const duplicateProgram = async (program) => {
    try {
      const copy = await createProductionProgramApi(production.id, {
        name: `${program.name}（复制）`,
        program_type_id: program.programTypeId || null,
        program_type_name: program.programTypeName || "",
        performers: program.performers || [],
        duration_seconds: program.durationSeconds || 0,
        description: program.description || "",
        technical_notes: program.technicalNotes || "",
        source_kind: program.sourceKind || "manual",
        workspace_program_id: program.sourceProgramId || null,
      });
      await load();
      setDialog(null);
      updateDetailRoute(copy?.id || copy?.program?.id);
      notify.success("活动节目已复制");
    } catch (error) {
      notify.error("活动节目复制失败", {
        description: error?.message || String(error),
      });
    }
  };

  const archiveProgram = async (program) => {
    try {
      await archiveProductionProgramApi(production.id, program.id);
      await load();
      setDialog(null);
      notify.success("活动节目已归档");
    } catch (error) {
      notify.error("活动节目归档失败", {
        description: error?.message || String(error),
      });
    }
  };

  const addExistingToSheets = async (program, sheetIds) => {
    const toastId = notify.loading("正在添加到节目单");
    try {
      const selectedSheets = new Set(sheetIds);
      await Promise.all(sheets.filter((sheet) => selectedSheets.has(sheet.id) && sheet.status !== "published" && sheet.status !== "archived").map((sheet) => updateProgramSheet(sheet.id, {
        name: sheet.name,
        change_note: sheet.changeNote,
        status: sheet.status,
        items: [...sheet.items, makeSheetItem("program", { productionProgramId: program.id, programSnapshot: program, title: program.name, durationSeconds: program.durationSeconds, order: sheet.items.length })],
        assignments: sheet.assignments || [],
      })));
      await load();
      setDialog(null);
      notify.success(`已将“${program.name}”添加到节目单`, { id: toastId });
    } catch (error) {
      notify.error("添加到节目单失败", {
        id: toastId,
        description: error?.message || String(error),
      });
    }
  };

  const createFromPicker = async (values) => {
    const created = await createProductionProgramApi(production.id, {
      name: values.name,
      program_type_id: values.programTypeId || null,
      program_type_name: values.programTypeName || "",
      performers: values.performers || [],
      duration_seconds: values.durationSeconds || 0,
      description: values.description || "",
      technical_notes: values.technicalNotes || "",
      source_kind: values.sourceKind || "manual",
      workspace_program_id: values.sourceProgramId || null,
    });
    await load();
    const id = created?.id || created?.program?.id;
    updateDetailRoute(id);
    return id;
  };

  return (
    <div className="space-y-5" ref={triggerRef}>
      <ProductionPageHeader
        workspace={workspace}
        production={production}
        title="节目"
        subtitle={route.meta.description}
        actions={{
          primary: canWrite ? <Button onClick={() => { setPickerOpen(true); }}><Plus />添加节目</Button> : null,
          secondary: [
            <Button key="refresh" variant="outline" onClick={() => load({ toast: true })} disabled={refreshing}>
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              刷新
            </Button>,
          ],
        }}
        floatingPrimary={canWrite ? <Button onClick={() => { setPickerOpen(true); }}><Plus />添加节目</Button> : null}
      />
      <ResourcePage
        headingLevel="h2"
        headerMode="none"
        title="活动节目"
        description="本场活动的节目资料与准备状态。节目单负责排序和编排。"
        count={filteredPrograms.length}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "搜索节目、演出者或技术备注",
        }}
        filters={
          <>
            <Select items={statusFilterSelect.items} value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusFilterSelect.missingOption ? <SelectItem value={statusFilterSelect.missingOption.value} disabled>{statusFilterSelect.missingOption.label}</SelectItem> : null}
                {statusFilterOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={sourceFilterSelect.items} value={source} onValueChange={setSource}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceFilterSelect.missingOption ? <SelectItem value={sourceFilterSelect.missingOption.value} disabled>{sourceFilterSelect.missingOption.label}</SelectItem> : null}
                {sourceFilterOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={typeFilterSelect.items} value={typeId} onValueChange={setTypeId} disabled={loading}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeFilterSelect.missingOption ? <SelectItem value={typeFilterSelect.missingOption.value} disabled>{typeFilterSelect.missingOption.label}</SelectItem> : null}
                {typeFilterOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
        showViewToggle={false}
        summary={<span>活动时区：{production.timezone}</span>}
        loading={loading}
        empty={
          !filteredPrograms.length
            ? {
                icon: FileMusic,
                title:
                  query ||
                  status !== "all" ||
                  source !== "all" ||
                  typeId !== "all"
                    ? "没有匹配的节目"
                    : "还没有活动节目",
                description: canWrite
                  ? "使用‘添加节目’选择工作空间模板或创建空白节目。"
                  : "当前活动还没有可查看的节目。",
                action:
                  canWrite &&
                  !query &&
                  status === "all" &&
                  source === "all" &&
                  typeId === "all" ? (
                    <Button
                      onClick={() => setPickerOpen(true)}
                    >
                      <Plus />
                      添加节目
                    </Button>
                  ) : null,
              }
            : null
        }
      >
        <ListSurface>
          {filteredPrograms.map((program) => (
            <ProgramListRow
              key={program.id}
              program={program}
              timezone={production.timezone}
              selected={program.id === selectedId}
              onSelect={(id, event) => { detailTriggerRef.current = event?.currentTarget || null; updateDetailRoute(id); }}
              canWrite={canWrite}
              onDuplicate={(item) =>
                setDialog({ type: "duplicate", program: item })
              }
              onArchive={(item) =>
                setDialog({ type: "archive", program: item })
              }
              onRestore={async (item) => {
                try {
                  await restoreProductionProgramApi(production.id, item.id);
                  await load();
                  notify.success("活动节目已恢复");
                } catch (error) {
                  notify.error("活动节目恢复失败", {
                    description: error?.message || String(error),
                  });
                }
              }}
            />
          ))}
        </ListSurface>
      </ResourcePage>
      <AddProgramToSheetsDialog
        open={dialog?.type === "assign"}
        onOpenChange={(open) => !open && setDialog(null)}
        program={dialog?.program}
        sheets={sheets}
        onConfirm={(sheetIds) => addExistingToSheets(dialog.program, sheetIds)}
      />
      <ProductionProgramPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="activity"
        productionPrograms={programs}
        workspacePrograms={workspacePrograms}
        programTypes={programTypes}
        programTypesLoading={loading}
        onSelectExisting={(values) => {
          const first = values[0];
          if (!first) return;
          setPickerOpen(false);
          updateDetailRoute(first.id);
          notify.info("该节目已在本场活动中，已打开节目详情");
        }}
        onCopyWorkspace={(program) => {
          if (!program) return;
          setCreationContext({ mode: "workspace-copy", sourceProgram: program, initialDraft: null });
          setPickerOpen(false);
          updateDetailRoute("new");
        }}
        onCreateCustom={(payload) => {
          const draft = payload?.draft;
          setCreationContext({ mode: "create", sourceProgram: null, initialDraft: draft ? { ...draft, durationMinutes: String(Math.round(Number(draft.durationSeconds || 0) / 60)) } : null });
          setPickerOpen(false);
          updateDetailRoute("new");
        }}
      />
      <AlertDialog
        open={dialog?.type === "archive" || dialog?.type === "duplicate"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.type === "archive" ? "归档活动节目" : "复制活动节目"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.type === "archive"
                ? `归档“${dialog?.program?.name || "此节目"}”后，它不会再出现在新节目单的选择器中，已有节目单条目不受影响。`
                : `将“${dialog?.program?.name || "此节目"}”复制为新的活动节目草稿。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                dialog?.type === "archive"
                  ? archiveProgram(dialog.program)
                  : duplicateProgram(dialog.program)
              }
            >
              {dialog?.type === "archive" ? "确认归档" : "复制草稿"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
