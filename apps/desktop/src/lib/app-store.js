import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

export const isTauriRuntime = isTauri();

const browserStore = {
  async init() {},
  async get(key) {
    try {
      const value = window.localStorage.getItem(`stagepilot:${key}`);
      return value === null ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try { window.localStorage.setItem(`stagepilot:${key}`, JSON.stringify(value)); } catch {}
  },
};

export const appStore = isTauriRuntime ? new LazyStore("stagepilot.json", { autoSave: 150 }) : browserStore;

export const RECENT_CONTEXTS_STORE_VERSION = 1;
export function recentContextsStoreKey(accountKey) {
  return `recentContexts:${accountKey || "anonymous"}:v${RECENT_CONTEXTS_STORE_VERSION}`;
}

export async function getRecentContexts(accountKey) {
  const value = await appStore.get(recentContextsStoreKey(accountKey));
  return Array.isArray(value) ? value.filter((item) => item?.id && item?.type && item?.path) : [];
}

export async function saveRecentContext(accountKey, context, limit = 10) {
  if (!context?.id || !context?.type || !context?.path) return [];
  const key = recentContextsStoreKey(accountKey);
  const current = await getRecentContexts(accountKey);
  const next = [context, ...current.filter((item) => !(item.id === context.id && item.type === context.type))]
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    .slice(0, limit);
  await appStore.set(key, next);
  return next;
}

// Workspace data lives in a namespaced key so local-only configuration cannot
// leak when the user switches tenants. The namespace is versioned for the
// later server-backed migration.
export const WORKSPACE_FILE_TYPES_STORE_VERSION = 1;
export function workspaceFileTypesStoreKey(workspaceId) {
  return `workspaceFileTypes:${workspaceId}:v${WORKSPACE_FILE_TYPES_STORE_VERSION}`;
}
