export const PROGRAM_SHEET_SEGMENT_TYPE_STORE_VERSION = 1;

export const SYSTEM_SEGMENT_TYPES = [
  ["opening", "开场", "演出", "#2563eb", 300, true, true, true],
  ["host", "主持", "演出", "#7c3aed", 180, true, true, true],
  ["speech", "致辞/发言", "演出", "#9333ea", 300, true, true, true],
  ["ceremony", "仪式", "演出", "#c026d3", 300, true, true, true],
  ["award", "颁奖", "演出", "#db2777", 300, true, true, true],
  ["announcement", "公告", "演出", "#ea580c", 120, true, true, true],
  ["sponsor", "赞助商环节", "演出", "#ca8a04", 180, true, true, true],
  ["video", "视频", "媒体", "#0891b2", 300, true, true, true],
  ["audio", "音频/播报", "媒体", "#0284c7", 180, true, true, true],
  ["interaction", "互动", "演出", "#059669", 600, true, true, true],
  ["photo", "合影", "演出", "#16a34a", 300, true, true, true],
  ["transition", "转场", "制作", "#65a30d", 120, false, false, true],
  ["technical", "技术环节", "制作", "#4f46e5", 300, false, false, true],
  ["doors", "开门", "制作", "#64748b", 600, true, true, true],
  ["closing", "结束", "演出", "#475569", 180, true, true, true],
  ["other", "其他", "其他", "#6b7280", 0, false, false, false],
].map(([systemKey, name, category, color, defaultDurationSeconds, countsTowardDuration, audienceVisible, requiresExecution], sortOrder) => ({
  id: `system-${systemKey}`,
  systemKey,
  name,
  category,
  color,
  defaultDurationSeconds,
  countsTowardDuration,
  audienceVisible,
  requiresExecution,
  isSystem: true,
  isActive: true,
  sortOrder,
  usageCount: 0,
}));

export function normalizeSegmentType(type, index = 0) {
  const system = SYSTEM_SEGMENT_TYPES.find((item) => item.id === type?.id || item.systemKey === type?.systemKey);
  const source = system ? { ...system, ...type, id: system.id, systemKey: system.systemKey, isSystem: true, isActive: true } : type || {};
  return {
    id: source.id || `segment-type-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    systemKey: source.systemKey || null,
    name: String(source.name || "未命名环节"),
    category: String(source.category || "自定义"),
    color: /^#[0-9a-f]{6}$/i.test(source.color) ? source.color : "#64748b",
    defaultDurationSeconds: Math.max(0, Number(source.defaultDurationSeconds ?? source.default_duration_seconds ?? 0) || 0),
    countsTowardDuration: source.countsTowardDuration !== false && source.counts_toward_duration !== false,
    audienceVisible: source.audienceVisible !== false && source.audience_visible !== false,
    requiresExecution: source.requiresExecution !== false && source.requires_execution !== false,
    isSystem: Boolean(source.isSystem || source.is_system_default || system),
    isActive: source.isActive !== false && source.is_active !== false,
    sortOrder: Number.isFinite(Number(source.sortOrder ?? source.sort_order)) ? Number(source.sortOrder ?? source.sort_order) : index,
    usageCount: Math.max(0, Number(source.usageCount ?? source.usage_count ?? 0) || 0),
  };
}

export function defaultSegmentTypes() {
  return SYSTEM_SEGMENT_TYPES.map((item) => ({ ...item }));
}

export function getSegmentTypeById(types, id) {
  return (types || []).find((type) => type.id === id) || SYSTEM_SEGMENT_TYPES.find((type) => type.id === id) || null;
}

export function getDefaultItemBehavior(kind, segmentType) {
  if (kind === "program" || kind === "interval") return { countsTowardDuration: true, audienceVisible: true, requiresExecution: true };
  if (kind === "section" || kind === "note") return { countsTowardDuration: false, audienceVisible: false, requiresExecution: false };
  return {
    countsTowardDuration: segmentType?.countsTowardDuration !== false,
    audienceVisible: segmentType?.audienceVisible !== false,
    requiresExecution: segmentType?.requiresExecution !== false,
  };
}

export function sortSegmentTypes(types) {
  const normalized = (types || []).map(normalizeSegmentType).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  const other = normalized.find((item) => item.systemKey === "other");
  return [...normalized.filter((item) => item !== other), ...(other ? [{ ...other, isActive: true, sortOrder: normalized.length - 1 }] : [])].map((item, index) => ({ ...item, sortOrder: index }));
}
