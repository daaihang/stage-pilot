import { migrateFileTypes } from "@/lib/resource-api";
import { removeAppStoreValue, appStore, workspaceFileTypesStoreKey } from "@/lib/app-store";
import { FILE_TYPE_SCOPES } from "@/lib/file-type-config";

// Legacy storage is intentionally confined to this adapter. The management
// page reads and writes the server resource API exclusively.
const inFlight = new Map();

function normalizeLegacyScopes(value) {
  const source = value && typeof value === "object" && value.scopes && typeof value.scopes === "object"
    ? value.scopes
    : {};
  const scopes = {};
  for (const scope of FILE_TYPE_SCOPES) {
    const items = Array.isArray(source[scope]) ? source[scope] : [];
    scopes[scope] = items
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const templateKey = typeof item.templateKey === "string" && item.templateKey ? item.templateKey : null;
        const sortOrder = Number.isInteger(item.sortOrder) && item.sortOrder >= 0 ? item.sortOrder : index;
        const isUncategorized = templateKey?.endsWith(".uncategorized");
        return {
          legacy_id: typeof item.id === "string" ? item.id : `${scope}:legacy:${index}`,
          template_key: templateKey,
          name,
          description: typeof item.description === "string" ? item.description.trim() : "",
          sort_order: sortOrder,
          is_system_default: Boolean(item.isSystemDefault),
          is_active: isUncategorized ? true : item.isActive !== false,
          deleted_at: item.deletedAt || null,
        };
      })
      .filter((item) => item.name || item.deleted_at);
  }
  return scopes;
}

export function hasLegacyFileTypeSnapshot(value) {
  return Boolean(value && typeof value === "object" && value.scopes && typeof value.scopes === "object");
}

export async function migrateLegacyFileTypes(workspaceId, { canWrite = false } = {}) {
  if (!workspaceId || !canWrite) return { status: "skipped" };
  if (inFlight.has(workspaceId)) return inFlight.get(workspaceId);
  const task = (async () => {
    const key = workspaceFileTypesStoreKey(workspaceId);
    const legacy = await appStore.get(key);
    if (!hasLegacyFileTypeSnapshot(legacy)) return { status: "none" };
    const scopes = normalizeLegacyScopes(legacy);
    const result = await migrateFileTypes(workspaceId, scopes);
    await removeAppStoreValue(key);
    return result;
  })().finally(() => {
    inFlight.delete(workspaceId);
  });
  inFlight.set(workspaceId, task);
  return task;
}
