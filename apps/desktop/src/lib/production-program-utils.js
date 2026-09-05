export const productionProgramSourceLabels = {
  workspace_copy: "工作空间复制",
  manual: "手工创建",
  submission: "征集转正",
};

export const productionProgramStatusLabels = {
  draft: "草稿",
  needs_info: "待补资料",
  confirmed: "已确认",
  archived: "已归档",
};

export function getProductionProgramMissingInfo(program = {}) {
  const missing = [];
  if (!(Number(program.durationSeconds) > 0)) missing.push("时长");
  if (!Array.isArray(program.performers) || !program.performers.some((value) => String(value).trim())) missing.push("演出者");
  if (!String(program.technicalNotes || "").trim()) missing.push("技术备注");
  return missing;
}

export function productionProgramHasMissingInfo(program) {
  return getProductionProgramMissingInfo(program).length > 0;
}
