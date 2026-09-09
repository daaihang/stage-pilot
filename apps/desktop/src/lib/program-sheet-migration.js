import { appStore, removeAppStoreValue } from "@/lib/app-store";
import { programSheetStoreKey, normalizeProgramSheetState } from "@/lib/program-sheet-store";
import { request } from "@/lib/auth";

// Compatibility boundary: no page may read the legacy key directly. This is
// the only code allowed to inspect it, and it deletes it only after the server
// confirms a successful import.
export async function migrateLegacyProgramSheets(productionId, { isAdmin = false } = {}) {
  const key = programSheetStoreKey(productionId);
  const legacy = await appStore.get(key);
  if (!legacy || !isAdmin) return { migrated: false, state: null };
  const state = normalizeProgramSheetState(legacy, productionId);
  const result = await request(`/v1/productions/${encodeURIComponent(productionId)}/program-sheets/migrate`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
  await removeAppStoreValue(key);
  return { migrated: true, state, result };
}
