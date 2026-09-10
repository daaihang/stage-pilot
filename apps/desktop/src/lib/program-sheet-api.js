import { request } from "@/lib/auth";

const enc = (value) => encodeURIComponent(value);

export const listProductionPrograms = (productionId) => request(`/v1/productions/${enc(productionId)}/programs`);
export const createProductionProgram = (productionId, payload) => request(`/v1/productions/${enc(productionId)}/programs`, { method: "POST", body: JSON.stringify(payload) });
export const updateProductionProgram = (productionId, programId, payload) => request(`/v1/productions/${enc(productionId)}/programs/${enc(programId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const archiveProductionProgram = (productionId, programId) => request(`/v1/productions/${enc(productionId)}/programs/${enc(programId)}/archive`, { method: "POST", body: JSON.stringify({}) });
export const restoreProductionProgram = (productionId, programId) => request(`/v1/productions/${enc(productionId)}/programs/${enc(programId)}/restore`, { method: "POST", body: JSON.stringify({}) });

export const listProgramSheets = (productionId) => request(`/v1/productions/${enc(productionId)}/program-sheets`);
export const createProgramSheet = (productionId, payload) => request(`/v1/productions/${enc(productionId)}/program-sheets`, { method: "POST", body: JSON.stringify(payload) });
export const getProgramSheet = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}`);
export const updateProgramSheet = (sheetId, payload) => request(`/v1/program-sheets/${enc(sheetId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const reorderProgramSheetItems = (sheetId, items) => request(`/v1/program-sheets/${enc(sheetId)}/items/order`, { method: "PATCH", body: JSON.stringify({ items }) });
export const copyProgramSheet = (sheetId, name) => request(`/v1/program-sheets/${enc(sheetId)}/copy`, { method: "POST", body: JSON.stringify({ name }) });
export const archiveProgramSheet = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}/archive`, { method: "POST", body: JSON.stringify({}) });
export const getProgramSheetOccurrences = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}/occurrences`);
export const updateProgramSheetOccurrences = (sheetId, occurrenceIds) => request(`/v1/program-sheets/${enc(sheetId)}/occurrences`, { method: "PUT", body: JSON.stringify({ occurrence_ids: occurrenceIds }) });
export const publishProgramSheet = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}/publish`, { method: "POST", body: JSON.stringify({}) });
export const previewPublishProgramSheet = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}/publish/preview`, { method: "POST", body: JSON.stringify({}) });
export const reviseProgramSheet = (sheetId, payload = {}) => request(`/v1/program-sheets/${enc(sheetId)}/revise`, { method: "POST", body: JSON.stringify(payload) });
export const listProgramReleases = (sheetId) => request(`/v1/program-sheets/${enc(sheetId)}/releases`);
export const getProgramRelease = (releaseId) => request(`/v1/program-sheet-releases/${enc(releaseId)}`);
export const retractProgramRelease = (releaseId, note = "") => request(`/v1/program-sheet-releases/${enc(releaseId)}/retract`, { method: "POST", body: JSON.stringify({ note }) });
export const listShareLinks = (releaseId) => request(`/v1/program-sheet-releases/${enc(releaseId)}/share-links`);
export const createShareLink = (releaseId, accessScope) => request(`/v1/program-sheet-releases/${enc(releaseId)}/share-links`, { method: "POST", body: JSON.stringify({ access_scope: accessScope }) });
export const rotateShareLink = (linkId) => request(`/v1/program-sheet-share-links/${enc(linkId)}/rotate`, { method: "POST", body: JSON.stringify({}) });
export const revokeShareLink = (linkId) => request(`/v1/program-sheet-share-links/${enc(linkId)}/revoke`, { method: "POST", body: JSON.stringify({}) });

export const listSegmentTypes = (workspaceId) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types`);
export const createSegmentType = (workspaceId, payload) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types`, { method: "POST", body: JSON.stringify(payload) });
export const updateSegmentType = (workspaceId, id, payload) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types/${enc(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const reorderSegmentTypes = (workspaceId, items) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types/order`, { method: "PATCH", body: JSON.stringify({ items: items.map((item, index) => ({ id: item.id || item, sort_order: index })) }) }).then((result) => result?.items || result || []);
export const deleteSegmentType = (workspaceId, id) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types/${enc(id)}/delete`, { method: "POST", body: JSON.stringify({}) });
export const restoreSegmentTypes = (workspaceId) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types/restore`, { method: "POST", body: JSON.stringify({}) }).then((result) => result?.items || result || []);
export const migrateSegmentTypes = (workspaceId, items) => request(`/v1/workspaces/${enc(workspaceId)}/program-sheet-segment-types/migrate`, { method: "POST", body: JSON.stringify({ items }) });

export function normalizeProgramSheetResponse(value, productionId) {
  const source = value?.items || value || [];
  const sheets = Array.isArray(source) ? source : [];
  return sheets.map((sheet) => ({
    ...sheet,
    productionId: sheet.productionId || sheet.production_id || productionId,
    changeNote: sheet.changeNote ?? sheet.change_note ?? "",
    createdAt: sheet.createdAt || sheet.created_at,
    updatedAt: sheet.updatedAt || sheet.updated_at,
    publishedAt: sheet.publishedAt || sheet.published_at || null,
    publishedBy: sheet.publishedBy || sheet.published_by || null,
    publishedSnapshot: sheet.publishedSnapshot || sheet.published_snapshot || null,
    items: (sheet.items || []).map((item, index) => ({
      ...item,
      productionProgramId: item.productionProgramId || item.production_program_id || null,
      segmentTypeId: item.segmentTypeId || item.segment_type_id || null,
      titleOverride: item.titleOverride ?? item.title_override ?? null,
      durationSecondsOverride: item.durationSecondsOverride ?? item.duration_seconds_override ?? null,
      countsTowardDuration: item.countsTowardDuration ?? item.counts_toward_duration ?? true,
      audienceVisible: item.audienceVisible ?? item.audience_visible ?? true,
      requiresExecution: item.requiresExecution ?? item.requires_execution ?? false,
      title: item.title ?? "",
      durationSeconds: Number(item.durationSeconds ?? item.duration_seconds ?? 0),
      programSnapshot: item.programSnapshot ?? item.program_snapshot ?? null,
      segmentTypeSnapshot: item.segmentTypeSnapshot ?? item.segment_type_snapshot ?? null,
      order: Number(item.order ?? item.sort_order ?? index),
    })),
    assignments: (sheet.assignments || []).map((item) => ({
      occurrenceId: item.occurrenceId || item.occurrence_id,
      role: item.role || "official",
      assignedAt: item.assignedAt || item.assigned_at,
    })),
  }));
}

export function normalizeProductionProgramsResponse(value, productionId) {
  const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
  return items.map((item) => ({
    ...item,
    productionId: item.productionId || item.production_id || productionId,
    sourceKind: item.sourceKind || item.source_kind || "manual",
    sourceProgramId: item.sourceProgramId || item.workspace_program_id || null,
    programTypeId: item.programTypeId || item.program_type_id || null,
    programTypeName: item.programTypeName || item.program_type_name || "",
    durationSeconds: Number(item.durationSeconds ?? item.duration_seconds ?? 0),
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at,
  }));
}
