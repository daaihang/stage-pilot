import { appStore } from "@/lib/app-store";
import { getDefaultItemBehavior, normalizeSegmentType } from "@/lib/program-sheet-segment-types";
import { updateSegmentTypeUsage } from "@/lib/program-sheet-segment-type-usage-store";

export const PROGRAM_SHEET_STORE_VERSION = 1;

export function programSheetStoreKey(productionId) {
  return `productionProgramSheets:${productionId}:v${PROGRAM_SHEET_STORE_VERSION}`;
}

function makeId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createLocalId(prefix = "item") {
  return makeId(prefix);
}

export function nowIso() {
  return new Date().toISOString();
}

export function emptyProgramSheetState(productionId) {
  return { version: PROGRAM_SHEET_STORE_VERSION, productionId, productionPrograms: [], sheets: [] };
}

const statuses = new Set(["draft", "review", "published", "archived"]);
const itemKinds = new Set(["program", "segment", "section", "interval", "note"]);
const productionProgramStatuses = new Set(["draft", "needs_info", "confirmed", "archived"]);
const productionProgramSources = new Set(["workspace_copy", "manual", "submission"]);

function normalizeProductionProgram(item, productionId) {
  const sourceKind = productionProgramSources.has(item?.sourceKind || item?.source_kind)
    ? (item.sourceKind || item.source_kind)
    : item?.sourceProgramId || item?.source_program_id ? "workspace_copy" : "manual";
  const description = item?.description ?? item?.notes ?? "";
  const programTypeName = String(item?.programTypeName || item?.program_type_name || item?.programType || item?.program_type || "");
  return {
    id: item?.id || makeId("production-program"),
    productionId,
    sourceKind,
    sourceProgramId: item?.sourceProgramId || item?.source_program_id || null,
    sourceEntryId: item?.sourceEntryId || item?.source_entry_id || null,
    copiedAt: item?.copiedAt || item?.copied_at || null,
    name: String(item?.name || "未命名节目"),
    programTypeId: item?.programTypeId || item?.program_type_id || null,
    programTypeName,
    programType: programTypeName,
    performers: Array.isArray(item?.performers) ? item.performers.map(String) : [],
    durationSeconds: Math.max(0, Number(item?.durationSeconds ?? item?.duration_seconds ?? 0) || 0),
    description: String(description),
    notes: String(description),
    technicalNotes: String(item?.technicalNotes ?? item?.technical_notes ?? ""),
    status: productionProgramStatuses.has(item?.status) ? item.status : "draft",
    createdAt: item?.createdAt || item?.created_at || nowIso(),
    updatedAt: item?.updatedAt || item?.updated_at || nowIso(),
    archivedAt: item?.archivedAt || item?.archived_at || null,
  };
}

function defaultTitle(kind) {
  return kind === "section" ? "新章节" : kind === "interval" ? "休息" : kind === "note" ? "现场备注" : kind === "segment" ? "新环节" : "未命名节目";
}

function normalizeProgramSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: value.id || null,
    name: String(value.name || "未命名节目"),
    programTypeId: value.programTypeId || value.program_type_id || null,
    programTypeName: String(value.programTypeName || value.program_type_name || value.programType || ""),
    performers: Array.isArray(value.performers) ? value.performers.map(String) : [],
    durationSeconds: Math.max(0, Number(value.durationSeconds ?? value.duration_seconds ?? 0) || 0),
    description: String(value.description || value.notes || ""),
    technicalNotes: String(value.technicalNotes || value.technical_notes || ""),
  };
}

function normalizeItem(item, index, programsById = new Map()) {
  const kind = itemKinds.has(item?.kind) ? item.kind : "program";
  const productionProgramId = item?.productionProgramId || item?.production_program_id || null;
  const programSnapshot = normalizeProgramSnapshot(item?.programSnapshot || item?.program_snapshot || (productionProgramId ? programsById.get(productionProgramId) : null));
  const segmentTypeSnapshot = item?.segmentTypeSnapshot || item?.segment_type_snapshot ? normalizeSegmentType(item.segmentTypeSnapshot || item.segment_type_snapshot) : null;
  const behavior = getDefaultItemBehavior(kind, segmentTypeSnapshot);
  return {
    id: item?.id || makeId("sheet-item"),
    kind,
    productionProgramId,
    programSnapshot,
    segmentTypeId: kind === "segment" ? item?.segmentTypeId || item?.segment_type_id || segmentTypeSnapshot?.id || null : null,
    segmentTypeSnapshot,
    title: String(item?.title ?? programSnapshot?.name ?? defaultTitle(kind)),
    titleOverride: item?.titleOverride ?? item?.title_override ?? null,
    durationSeconds: Math.max(0, Number(item?.durationSeconds ?? item?.duration_seconds ?? programSnapshot?.durationSeconds ?? (kind === "segment" ? segmentTypeSnapshot?.defaultDurationSeconds : kind === "interval" ? 900 : 0)) || 0),
    durationSecondsOverride: item?.durationSecondsOverride == null && item?.duration_seconds_override == null ? null : Math.max(0, Number(item?.durationSecondsOverride ?? item?.duration_seconds_override) || 0),
    countsTowardDuration: item?.countsTowardDuration == null && item?.counts_toward_duration == null ? behavior.countsTowardDuration : Boolean(item.countsTowardDuration ?? item.counts_toward_duration),
    audienceVisible: item?.audienceVisible == null && item?.audience_visible == null ? behavior.audienceVisible : Boolean(item.audienceVisible ?? item.audience_visible),
    requiresExecution: item?.requiresExecution == null && item?.requires_execution == null ? behavior.requiresExecution : Boolean(item.requiresExecution ?? item.requires_execution),
    notes: String(item?.notes || ""),
    order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
  };
}

function normalizeAssignment(item) {
  return {
    occurrenceId: item?.occurrenceId || item?.occurrence_id || null,
    role: item?.role === "official" ? "official" : "official",
    assignedAt: item?.assignedAt || item?.assigned_at || nowIso(),
  };
}

function normalizePublishedSnapshot(value, programsById) {
  if (!value || typeof value !== "object") return null;
  return {
    publishedAt: value.publishedAt || value.published_at || null,
    items: Array.isArray(value.items) ? value.items.map((item, index) => normalizeItem(item, index, programsById)).sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index })) : [],
    occurrenceOverrides: Array.isArray(value.occurrenceOverrides) ? value.occurrenceOverrides.map(normalizeOccurrenceOverride) : [],
  };
}

function normalizeOccurrenceOverride(item) {
  return { id: item?.id || makeId("occurrence-override"), occurrenceId: item?.occurrenceId || item?.occurrence_id || null, itemId: item?.itemId || item?.item_id || null, titleOverride: item?.titleOverride ?? item?.title_override ?? null, durationSecondsOverride: item?.durationSecondsOverride ?? item?.duration_seconds_override ?? null, performersOverride: Array.isArray(item?.performersOverride) ? item.performersOverride.map(String) : null };
}

function normalizeSheet(sheet, productionId, index, programsById) {
  const items = Array.isArray(sheet?.items) ? sheet.items.map((item, itemIndex) => normalizeItem(item, itemIndex, programsById)).sort((a, b) => a.order - b.order).map((item, itemIndex) => ({ ...item, order: itemIndex })) : [];
  const assignments = Array.isArray(sheet?.assignments)
    ? sheet.assignments.map(normalizeAssignment).filter((item, itemIndex, list) => item.occurrenceId && list.findIndex((candidate) => candidate.occurrenceId === item.occurrenceId) === itemIndex)
    : [];
  return {
    id: sheet?.id || makeId("program-sheet"),
    productionId,
    name: String(sheet?.name || `节目单 ${index + 1}`),
    revision: Math.max(1, Number(sheet?.revision) || 1),
    status: statuses.has(sheet?.status) ? sheet.status : "draft",
    changeNote: String(sheet?.changeNote || sheet?.change_note || ""),
    assignments,
    items,
    occurrenceOverrides: Array.isArray(sheet?.occurrenceOverrides) ? sheet.occurrenceOverrides.map(normalizeOccurrenceOverride) : [],
    createdAt: sheet?.createdAt || sheet?.created_at || nowIso(),
    updatedAt: sheet?.updatedAt || sheet?.updated_at || nowIso(),
    publishedAt: sheet?.publishedAt || sheet?.published_at || null,
    publishedBy: sheet?.publishedBy || sheet?.published_by || null,
    publishedSnapshot: normalizePublishedSnapshot(sheet?.publishedSnapshot || sheet?.published_snapshot, programsById),
  };
}

export function normalizeProgramSheetState(value, productionId) {
  const source = value && typeof value === "object" ? value : {};
  const productionPrograms = Array.isArray(source.productionPrograms)
    ? source.productionPrograms.map((item) => normalizeProductionProgram(item, productionId))
    : [];
  const programsById = new Map(productionPrograms.map((item) => [item.id, item]));
  const sheets = Array.isArray(source.sheets)
    ? source.sheets.map((item, index) => normalizeSheet(item, productionId, index, programsById))
    : [];
  return { version: PROGRAM_SHEET_STORE_VERSION, productionId, productionPrograms, sheets };
}

export async function loadProgramSheetState(productionId) {
  const value = await appStore.get(programSheetStoreKey(productionId));
  return normalizeProgramSheetState(value, productionId);
}

export async function saveProgramSheetState(productionId, value, { workspaceId } = {}) {
  const normalized = normalizeProgramSheetState(value, productionId);
  await appStore.set(programSheetStoreKey(productionId), normalized);
  if (workspaceId) {
    // The usage index is a derived safety aid. A failed index write must not
    // make an otherwise successful program-sheet save look like it failed;
    // the workspace manager reconciles it before allowing deletion.
    try {
      await updateSegmentTypeUsage(workspaceId, productionId, normalized);
    } catch {
      // Keep the primary document saved. Unknown usage is handled safely by
      // the manager as a non-deletable state until reconciliation succeeds.
    }
  }
  return normalized;
}

export function makeProductionProgram(productionId, source = {}) {
  const timestamp = nowIso();
  const sourceKind = productionProgramSources.has(source.sourceKind) ? source.sourceKind : source.id ? "workspace_copy" : "manual";
  return normalizeProductionProgram({
    id: makeId("production-program"),
    productionId,
    sourceKind,
    sourceProgramId: source.sourceProgramId || (sourceKind === "workspace_copy" ? source.id : null),
    sourceEntryId: source.sourceEntryId || null,
    copiedAt: source.copiedAt || (sourceKind === "workspace_copy" ? timestamp : null),
    name: source.name || "未命名节目",
    programTypeId: source.programTypeId || source.program_type_id || null,
    programTypeName: source.programTypeName || source.program_type_name || source.programType || source.program_type || "",
    performers: source.performers || [],
    durationSeconds: source.durationSeconds ?? source.default_duration_seconds ?? 0,
    description: source.description || source.notes || "",
    technicalNotes: source.technicalNotes || source.technical_notes || "",
    status: source.status || "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  }, productionId);
}

export function makeProgramSheet(productionId, { name, revision = 1, changeNote = "", items = [] } = {}) {
  const timestamp = nowIso();
  return normalizeSheet({
    id: makeId("program-sheet"),
    productionId,
    name: name || "未命名节目单",
    revision,
    status: "draft",
    changeNote,
    assignments: [],
    items,
    occurrenceOverrides: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }, productionId, revision - 1);
}

export function makeSheetItem(kind = "program", values = {}) {
  return normalizeItem({ id: makeId("sheet-item"), kind, ...values }, 0);
}

export function makePublishedSnapshot(sheet, { occurrenceOverrides = [] } = {}) {
  return {
    publishedAt: nowIso(),
    items: (sheet?.items || []).map((item, index) => normalizeItem({ ...item, id: item.id || makeId("sheet-item"), order: index }, index)),
    occurrenceOverrides: occurrenceOverrides.map(normalizeOccurrenceOverride),
  };
}
