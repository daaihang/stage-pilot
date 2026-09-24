import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { getPreferences, updatePreferences as patchUserPreferences } from "@/lib/auth";
import { DEFAULT_USER_PREFERENCES, normalizeUserPreferences, toUserPreferencePatch } from "@/lib/user-preferences";

const UserPreferencesContext = createContext(null);

export function UserPreferencesProvider({ authStatus, user, children }) {
  const [preferences, setPreferences] = useState(DEFAULT_USER_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [savingPreferences, setSavingPreferences] = useState({});
  const savingKeysRef = useRef(new Set());

  useEffect(() => {
    if (authStatus === "loading") return undefined;
    if (authStatus !== "authenticated" || !user?.id) {
      setPreferences(DEFAULT_USER_PREFERENCES);
      setLoading(false);
      setLoadError(null);
      setSavingPreferences({});
      savingKeysRef.current.clear();
      return undefined;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    getPreferences().then((saved) => {
      if (active) setPreferences(normalizeUserPreferences(saved));
    }).catch((error) => {
      if (active) {
        setLoadError(error);
        notify.error("用户偏好加载失败", { description: error?.message || String(error) });
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [authStatus, reloadCount, user?.id]);

  useEffect(() => {
    if (authStatus === "loading" || (authStatus === "authenticated" && loading)) return undefined;
    const media = typeof window === "undefined" ? null : window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = preferences.theme === "dark" || (preferences.theme === "system" && Boolean(media?.matches));
      document.documentElement.classList.toggle("dark", dark);
    };
    applyTheme();
    if (preferences.theme !== "system" || !media) return undefined;
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [authStatus, loading, preferences.theme]);

  const savePreferencePatch = useCallback(async (patch, label) => {
    if (loading || loadError) {
      const error = new Error("请先成功加载账户偏好，再修改设置。");
      notify.error(`${label}暂不可用`, { description: error.message });
      throw error;
    }
    const apiPatch = toUserPreferencePatch(patch);
    if (!apiPatch || Object.keys(apiPatch).length === 0) {
      notify.error(`${label}设置无效`);
      return;
    }
    const keys = Object.keys(patch);
    if (keys.some((key) => savingKeysRef.current.has(key))) return;
    const changedKeys = keys.filter((key) => preferences[key] !== patch[key]);
    if (changedKeys.length === 0) return;

    const previous = Object.fromEntries(changedKeys.map((key) => [key, preferences[key]]));
    for (const key of changedKeys) savingKeysRef.current.add(key);
    setSavingPreferences((current) => ({ ...current, ...Object.fromEntries(changedKeys.map((key) => [key, true])) }));
    setPreferences((current) => ({ ...current, ...Object.fromEntries(changedKeys.map((key) => [key, patch[key]])) }));
    const toastId = notify.loading(`正在同步${label}…`);
    try {
      const saved = await patchUserPreferences(apiPatch);
      const normalized = normalizeUserPreferences(saved);
      setPreferences((current) => ({ ...current, ...Object.fromEntries(changedKeys.map((key) => [key, normalized[key]])) }));
      notify.success(`${label}已同步到账户`, { id: toastId });
    } catch (error) {
      setPreferences((current) => ({ ...current, ...previous }));
      notify.error(`${label}同步失败`, { id: toastId, description: error?.message || String(error) });
      throw error;
    } finally {
      for (const key of changedKeys) savingKeysRef.current.delete(key);
      setSavingPreferences((current) => {
        const next = { ...current };
        for (const key of changedKeys) delete next[key];
        return next;
      });
    }
  }, [loadError, loading, preferences]);

  const updatePreference = useCallback((key, value, label) => savePreferencePatch({ [key]: value }, label), [savePreferencePatch]);
  const updateTheme = useCallback((value) => updatePreference("theme", value, "主题偏好"), [updatePreference]);
  const updateContentWidth = useCallback((value) => updatePreference("contentWidth", value, "页面宽度偏好"), [updatePreference]);
  const updateDetailOpenMode = useCallback((value) => updatePreference("detailOpenMode", value, "详情打开方式"), [updatePreference]);
  const updateTimezone = useCallback((value) => updatePreference("timezone", value, "时区偏好"), [updatePreference]);
  const updateNotificationsEnabled = useCallback((value) => updatePreference("notificationsEnabled", value, "桌面通知偏好"), [updatePreference]);
  const updateCategoryTabsPinned = useCallback((value) => updatePreference("categoryTabsPinned", value, "分类导航偏好"), [updatePreference]);
  const updateSidebarRailEnabled = useCallback((value) => updatePreference("sidebarRailEnabled", value, "侧栏热区偏好"), [updatePreference]);
  const updateFloatingActionExpandAtEnd = useCallback((value) => updatePreference("floatingActionExpandAtEnd", value, "悬浮主操作偏好"), [updatePreference]);
  const updateTitlebarDisplay = useCallback((patch) => savePreferencePatch(patch, "标题栏偏好"), [savePreferencePatch]);
  const reloadPreferences = useCallback(() => setReloadCount((current) => current + 1), []);

  const value = useMemo(() => ({
    ...preferences,
    loading,
    loadError,
    reloadPreferences,
    savingPreferences,
    detailOpenModeSaving: Boolean(savingPreferences.detailOpenMode),
    updateTheme,
    updateContentWidth,
    updateDetailOpenMode,
    updateTimezone,
    updateNotificationsEnabled,
    updateCategoryTabsPinned,
    updateSidebarRailEnabled,
    updateFloatingActionExpandAtEnd,
    updateTitlebarDisplay,
  }), [
    loading,
    loadError,
    preferences,
    reloadPreferences,
    savingPreferences,
    updateCategoryTabsPinned,
    updateContentWidth,
    updateDetailOpenMode,
    updateFloatingActionExpandAtEnd,
    updateNotificationsEnabled,
    updateSidebarRailEnabled,
    updateTheme,
    updateTimezone,
    updateTitlebarDisplay,
  ]);
  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences() {
  const value = useContext(UserPreferencesContext);
  if (!value) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return value;
}
