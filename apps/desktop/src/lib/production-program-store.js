import {
  loadProgramSheetState,
  makeProductionProgram,
  normalizeProgramSheetState,
  nowIso,
  saveProgramSheetState,
} from "@/lib/program-sheet-store";
export { getProductionProgramMissingInfo, productionProgramHasMissingInfo, productionProgramSourceLabels, productionProgramStatusLabels } from "@/lib/production-program-utils";

async function updateDocument(productionId, updater) {
  const current = await loadProgramSheetState(productionId);
  const next = normalizeProgramSheetState(updater(current), productionId);
  await saveProgramSheetState(productionId, next);
  return next;
}

export async function loadProductionPrograms(productionId) {
  const state = await loadProgramSheetState(productionId);
  return state.productionPrograms || [];
}

export async function createProductionProgram(productionId, values = {}) {
  const program = makeProductionProgram(productionId, { ...values, sourceKind: values.sourceKind || "manual" });
  await updateDocument(productionId, (current) => ({ ...current, productionPrograms: [...current.productionPrograms, program] }));
  return program;
}

export async function updateProductionProgram(productionId, id, patch = {}) {
  let updated = null;
  await updateDocument(productionId, (current) => ({
    ...current,
    productionPrograms: current.productionPrograms.map((program) => {
      if (program.id !== id) return program;
      updated = {
        ...program,
        ...patch,
        id: program.id,
        productionId,
        sourceKind: program.sourceKind,
        sourceProgramId: program.sourceProgramId,
        sourceEntryId: program.sourceEntryId,
        copiedAt: program.copiedAt,
        updatedAt: nowIso(),
      };
      return updated;
    }),
  }));
  if (!updated) throw new Error("活动节目不存在");
  return updated;
}

export async function duplicateProductionProgram(productionId, id) {
  let copy = null;
  await updateDocument(productionId, (current) => {
    const source = current.productionPrograms.find((program) => program.id === id);
    if (!source) throw new Error("活动节目不存在");
    const timestamp = nowIso();
    copy = makeProductionProgram(productionId, {
      ...source,
      id: undefined,
      name: `${source.name}（复制）`,
      sourceKind: source.sourceKind,
      sourceProgramId: source.sourceProgramId,
      sourceEntryId: source.sourceEntryId,
      copiedAt: source.copiedAt,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    });
    return { ...current, productionPrograms: [...current.productionPrograms, copy] };
  });
  return copy;
}

export async function archiveProductionProgram(productionId, id) {
  return updateProductionProgram(productionId, id, { status: "archived", archivedAt: nowIso() });
}

export async function restoreProductionProgram(productionId, id) {
  return updateProductionProgram(productionId, id, { status: "draft", archivedAt: null });
}

export async function copyWorkspaceProgram(productionId, workspaceProgram = {}) {
  const current = await loadProgramSheetState(productionId);
  const sourceId = workspaceProgram.id || workspaceProgram.sourceProgramId || null;
  const existing = sourceId ? current.productionPrograms.find((program) => program.sourceProgramId === sourceId) : null;
  if (existing) return { program: existing, reused: true };
  const program = makeProductionProgram(productionId, {
    ...workspaceProgram,
    sourceKind: "workspace_copy",
    sourceProgramId: sourceId,
    sourceEntryId: null,
    copiedAt: nowIso(),
    programTypeId: workspaceProgram.programTypeId || workspaceProgram.program_type_id || null,
    programTypeName: workspaceProgram.programTypeName || workspaceProgram.program_type_name || workspaceProgram.programType || "",
    description: workspaceProgram.description || "",
    technicalNotes: workspaceProgram.technicalNotes || workspaceProgram.technical_notes || "",
  });
  await saveProgramSheetState(productionId, { ...current, productionPrograms: [...current.productionPrograms, program] });
  return { program, reused: false };
}

export async function saveProductionPrograms(productionId, productionPrograms) {
  const current = await loadProgramSheetState(productionId);
  const next = normalizeProgramSheetState({ ...current, productionPrograms }, productionId);
  await saveProgramSheetState(productionId, next);
  return next.productionPrograms;
}
