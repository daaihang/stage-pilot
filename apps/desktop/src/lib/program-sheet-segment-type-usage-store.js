import { appStore } from "./app-store.js";

export const PROGRAM_SHEET_SEGMENT_TYPE_USAGE_STORE_VERSION = 1;

export function segmentTypeUsageStoreKey(workspaceId) {
  return `workspaceProgramSheetSegmentTypeUsage:${workspaceId}:v${PROGRAM_SHEET_SEGMENT_TYPE_USAGE_STORE_VERSION}`;
}

function normalizeIndex(value) {
  const productions = value && typeof value === "object" && value.productions && typeof value.productions === "object"
    ? value.productions
    : {};
  const normalized = {};
  for (const [productionId, usage] of Object.entries(productions)) {
    if (!usage || typeof usage !== "object") continue;
    normalized[productionId] = {};
    for (const [typeId, sheetIds] of Object.entries(usage)) {
      const ids = [...new Set((Array.isArray(sheetIds) ? sheetIds : []).filter(Boolean).map(String))].sort();
      if (ids.length) normalized[productionId][typeId] = ids;
    }
  }
  return { version: PROGRAM_SHEET_SEGMENT_TYPE_USAGE_STORE_VERSION, productions: normalized };
}

export function collectSegmentTypeUsage(state) {
  const usage = {};
  for (const sheet of Array.isArray(state?.sheets) ? state.sheets : []) {
    const typeIds = new Set();
    const items = [
      ...(Array.isArray(sheet.items) ? sheet.items : []),
      ...(Array.isArray(sheet.publishedSnapshot?.items) ? sheet.publishedSnapshot.items : []),
    ];
    for (const item of items) {
      if (item?.kind !== "segment" || !item.segmentTypeId) continue;
      typeIds.add(String(item.segmentTypeId));
    }
    for (const typeId of typeIds) {
      if (!usage[typeId]) usage[typeId] = [];
      usage[typeId].push(String(sheet.id));
    }
  }
  return Object.fromEntries(Object.entries(usage).map(([typeId, sheetIds]) => [typeId, [...new Set(sheetIds)].sort()]));
}

export async function loadSegmentTypeUsageIndex(workspaceId) {
  return normalizeIndex(await appStore.get(segmentTypeUsageStoreKey(workspaceId)));
}

export async function saveSegmentTypeUsageIndex(workspaceId, index) {
  const normalized = normalizeIndex(index);
  await appStore.set(segmentTypeUsageStoreKey(workspaceId), normalized);
  return normalized;
}

export async function updateSegmentTypeUsage(workspaceId, productionId, state) {
  if (!workspaceId || !productionId) return null;
  const current = await loadSegmentTypeUsageIndex(workspaceId);
  return saveSegmentTypeUsageIndex(workspaceId, {
    ...current,
    productions: { ...current.productions, [productionId]: collectSegmentTypeUsage(state) },
  });
}

export function segmentTypeUsageCounts(index) {
  const sheetIdsByType = {};
  for (const usage of Object.values(normalizeIndex(index).productions)) {
    for (const [typeId, sheetIds] of Object.entries(usage)) {
      if (!sheetIdsByType[typeId]) sheetIdsByType[typeId] = new Set();
      for (const sheetId of sheetIds) sheetIdsByType[typeId].add(sheetId);
    }
  }
  return Object.fromEntries(Object.entries(sheetIdsByType).map(([typeId, sheetIds]) => [typeId, sheetIds.size]));
}

export async function reconcileSegmentTypeUsage(workspaceId, productionIds, loadState) {
  const current = await loadSegmentTypeUsageIndex(workspaceId);
  const nextProductions = { ...current.productions };
  const failedProductionIds = [];
  for (const productionId of [...new Set((productionIds || []).filter(Boolean).map(String))]) {
    try {
      nextProductions[productionId] = collectSegmentTypeUsage(await loadState(productionId));
    } catch {
      failedProductionIds.push(productionId);
    }
  }
  const index = await saveSegmentTypeUsageIndex(workspaceId, { ...current, productions: nextProductions });
  return { index, failedProductionIds };
}
