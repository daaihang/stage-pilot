import { appStore } from "@/lib/app-store";
import { defaultSegmentTypes, normalizeSegmentType, PROGRAM_SHEET_SEGMENT_TYPE_STORE_VERSION, sortSegmentTypes } from "@/lib/program-sheet-segment-types";

export function segmentTypeStoreKey(workspaceId) {
  return `workspaceProgramSheetSegmentTypes:${workspaceId}:v${PROGRAM_SHEET_SEGMENT_TYPE_STORE_VERSION}`;
}

export async function loadSegmentTypes(workspaceId) {
  const value = await appStore.get(segmentTypeStoreKey(workspaceId));
  const custom = Array.isArray(value) ? value : Array.isArray(value?.types) ? value.types : [];
  return sortSegmentTypes([...defaultSegmentTypes(), ...custom.filter((item) => !item?.isSystem && !item?.systemKey).map(normalizeSegmentType)]);
}

export async function saveSegmentTypes(workspaceId, types) {
  const next = sortSegmentTypes(types);
  await appStore.set(segmentTypeStoreKey(workspaceId), next.filter((item) => !item.isSystem));
  return next;
}

export async function createSegmentType(workspaceId, values) {
  const current = await loadSegmentTypes(workspaceId);
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const next = normalizeSegmentType({ ...values, id: `segment-type-${uuid}`, isSystem: false }, current.length);
  return (await saveSegmentTypes(workspaceId, [...current, next])).find((item) => item.id === next.id);
}

export async function updateSegmentType(workspaceId, id, patch) {
  const current = await loadSegmentTypes(workspaceId);
  const target = current.find((item) => item.id === id);
  if (!target) throw new Error("环节类型不存在");
  if (target.isSystem && (patch.name || patch.color || patch.category)) throw new Error("系统环节类型不能修改名称或颜色");
  return (await saveSegmentTypes(workspaceId, current.map((item) => item.id === id ? normalizeSegmentType({ ...item, ...patch }) : item))).find((item) => item.id === id);
}

export async function reorderSegmentTypes(workspaceId, types) {
  return saveSegmentTypes(workspaceId, types);
}

export async function deleteSegmentType(workspaceId, id, usedTypeIds = []) {
  const current = await loadSegmentTypes(workspaceId);
  const target = current.find((item) => item.id === id);
  if (!target) throw new Error("环节类型不存在");
  if (target.isSystem || target.systemKey === "other") throw new Error("系统环节类型不能删除");
  if (usedTypeIds.includes(id) || target.usageCount > 0) throw new Error("该环节类型已被节目单使用，请先停用");
  await saveSegmentTypes(workspaceId, current.filter((item) => item.id !== id));
  return id;
}

export async function restoreSegmentTypes(workspaceId) {
  const current = await loadSegmentTypes(workspaceId);
  const custom = current.filter((item) => !item.isSystem);
  return saveSegmentTypes(workspaceId, [...defaultSegmentTypes(), ...custom]);
}
