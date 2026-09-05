export const programSheetStatusLabels = {
  draft: "草稿",
  review: "待审核",
  published: "正式",
  archived: "已归档",
};

export const programSheetItemKindLabels = {
  program: "节目",
  segment: "环节",
  section: "章节",
  interval: "休息",
  note: "备注",
};

export function getSheetItems(sheet) {
  return sheet?.status === "published" && sheet?.publishedSnapshot?.items ? sheet.publishedSnapshot.items : (sheet?.items || []);
}

export function getItemEffectiveTitle(item) {
  return item?.titleOverride != null && String(item.titleOverride).trim() ? String(item.titleOverride) : String(item?.title || "未命名条目");
}

export function getItemEffectiveDurationSeconds(item) {
  return Math.max(0, Number(item?.durationSecondsOverride ?? item?.durationSeconds) || 0);
}

export function getItemCountsTowardDuration(item) {
  if (item?.countsTowardDuration != null) return item.countsTowardDuration !== false;
  return item?.kind === "program" || item?.kind === "interval";
}

export function getItemBehaviorBadges(item) {
  return [item?.countsTowardDuration ? "计时" : "不计时", item?.audienceVisible ? "观众可见" : "内部", item?.requiresExecution ? "需执行" : "资料项"];
}

export function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}小时${String(minutes).padStart(2, "0")}分`;
  if (minutes) return `${minutes}分${remainder ? `${String(remainder).padStart(2, "0")}秒` : ""}`;
  return `${remainder}秒`;
}

export function formatMinutesInput(totalSeconds = 0) {
  return String(Math.max(0, Math.round(Number(totalSeconds) || 0)) / 60).replace(/\.0$/, "");
}

export function getTotalDurationSeconds(sheet) {
  return getSheetItems(sheet).reduce((total, item) => getItemCountsTowardDuration(item) ? total + getItemEffectiveDurationSeconds(item) : total, 0);
}

export function getProgramItemCount(sheet) {
  return getSheetItems(sheet).filter((item) => item.kind === "program" || item.kind === "segment").length;
}

export function assignedOccurrenceIds(sheet) {
  return new Set((sheet?.assignments || []).map((item) => item.occurrenceId).filter(Boolean));
}

export function occurrenceTitle(occurrence) {
  return occurrence?.name || occurrence?.title || occurrence?.kind || "未命名场次";
}

export function occurrenceType(occurrence) {
  return occurrence?.kind === "performance" ? "正式演出" : occurrence?.kind === "encore" ? "加演" : occurrence?.kind === "preview" ? "预演" : occurrence?.kind || "场次";
}

export function calculateSheetTiming(sheet, occurrence) {
  const start = occurrence?.scheduledStartAt ? new Date(occurrence.scheduledStartAt) : null;
  const end = occurrence?.scheduledEndAt ? new Date(occurrence.scheduledEndAt) : null;
  if (!start || Number.isNaN(start.getTime())) return { rows: [], totalSeconds: getTotalDurationSeconds(sheet), expectedEnd: null, availableSeconds: null, deltaSeconds: null };
  let cursor = start.getTime();
  const rows = getSheetItems(sheet).map((item) => {
    const duration = getItemCountsTowardDuration(item) ? getItemEffectiveDurationSeconds(item) : 0;
    const row = { item, start: new Date(cursor), end: new Date(cursor + duration * 1000) };
    cursor += duration * 1000;
    return row;
  });
  const expectedEnd = new Date(cursor);
  const availableSeconds = end && !Number.isNaN(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 1000) : null;
  const totalSeconds = getTotalDurationSeconds(sheet);
  return { rows, totalSeconds, expectedEnd, availableSeconds, deltaSeconds: availableSeconds == null ? null : totalSeconds - availableSeconds };
}

export function sortSheetItems(items) {
  return (items || []).map((item, index) => ({ ...item, order: index }));
}
