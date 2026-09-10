import { appStore, removeAppStoreValue } from "@/lib/app-store";
import { segmentTypeStoreKey } from "@/lib/program-sheet-segment-type-store";
import { migrateSegmentTypes } from "@/lib/program-sheet-api";

export async function migrateLegacySegmentTypes(workspaceId, { isAdmin = false } = {}) {
  if (!isAdmin) return { migrated: false };
  const key = segmentTypeStoreKey(workspaceId);
  const value = await appStore.get(key);
  const items = Array.isArray(value) ? value : Array.isArray(value?.types) ? value.types : [];
  if (!items.length) return { migrated: false };
  await migrateSegmentTypes(workspaceId, items.map((item, index) => ({
    system_key: item.systemKey || item.system_key || null,
    name: String(item.name || "").trim(),
    category: item.category || "自定义",
    color: item.color || "#64748b",
    default_duration_seconds: Number(item.defaultDurationSeconds ?? item.default_duration_seconds ?? 0) || 0,
    counts_toward_duration: item.countsTowardDuration !== false && item.counts_toward_duration !== false,
    audience_visible: item.audienceVisible !== false && item.audience_visible !== false,
    requires_execution: item.requiresExecution !== false && item.requires_execution !== false,
    is_active: item.isActive !== false && item.is_active !== false,
    sort_order: Number(item.sortOrder ?? item.sort_order ?? index) || index,
    description: item.description || "",
  })).filter((item) => item.name));
  await removeAppStoreValue(key);
  return { migrated: true };
}
