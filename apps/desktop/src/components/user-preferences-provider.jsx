import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { getPreferences, updatePreferences } from "@/lib/auth";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/timezone";

const UserPreferencesContext = createContext(null);

export function UserPreferencesProvider({ authStatus, user, children }) {
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user?.id) {
      setTimezone(DEFAULT_TIMEZONE);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    getPreferences().then((preferences) => {
      if (!active) return;
      setTimezone(isValidTimeZone(preferences?.timezone) ? preferences.timezone : DEFAULT_TIMEZONE);
    }).catch((error) => {
      if (active) notify.error("用户偏好加载失败", { description: error?.message || String(error) });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [authStatus, user?.id]);

  const updateTimezone = useCallback(async (nextTimezone) => {
    if (!isValidTimeZone(nextTimezone)) {
      notify.error("时区设置失败", { description: "请选择有效的 IANA 时区。" });
      return;
    }
    const previous = timezone;
    setTimezone(nextTimezone);
    const toastId = notify.loading("正在保存时区偏好…");
    try {
      const saved = await updatePreferences({ timezone: nextTimezone });
      const savedTimezone = isValidTimeZone(saved?.timezone) ? saved.timezone : nextTimezone;
      setTimezone(savedTimezone);
      notify.success("时区偏好已保存", { id: toastId });
    } catch (error) {
      setTimezone(previous);
      notify.error("时区偏好保存失败", { id: toastId, description: error?.message || String(error) });
      throw error;
    }
  }, [timezone]);

  const value = useMemo(() => ({ timezone, loading, updateTimezone }), [timezone, loading, updateTimezone]);
  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences() {
  const value = useContext(UserPreferencesContext);
  if (!value) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return value;
}
