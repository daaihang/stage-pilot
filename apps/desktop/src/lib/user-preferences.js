import { DEFAULT_TIMEZONE, isValidTimeZone } from "./timezone.js";

export const DEFAULT_USER_PREFERENCES = Object.freeze({
  theme: "light",
  language: "zh-CN",
  timezone: DEFAULT_TIMEZONE,
  notificationsEnabled: true,
  titlebarTitleMode: "page",
  showTitlebarTitle: true,
  detailOpenMode: "inline",
  contentWidth: "standard",
  sidebarRailEnabled: true,
  categoryTabsPinned: false,
  floatingActionExpandAtEnd: true,
});

const apiFieldByPreference = Object.freeze({
  theme: "theme",
  language: "language",
  timezone: "timezone",
  notificationsEnabled: "notifications_enabled",
  titlebarTitleMode: "titlebar_title_mode",
  showTitlebarTitle: "show_titlebar_title",
  detailOpenMode: "detail_open_mode",
  contentWidth: "content_width",
  sidebarRailEnabled: "sidebar_rail_enabled",
  categoryTabsPinned: "category_tabs_pinned",
  floatingActionExpandAtEnd: "floating_action_expand_at_end",
});

const themes = new Set(["light", "dark", "system"]);
const titlebarModes = new Set(["page", "app"]);
const detailOpenModes = new Set(["inline", "exclusive"]);
const contentWidths = new Set(["standard", "wide", "full"]);

export function normalizeUserPreference(key, value) {
  if (!Object.hasOwn(apiFieldByPreference, key)) return null;
  if (["theme"].includes(key)) return themes.has(value) ? value : null;
  if (key === "titlebarTitleMode") return titlebarModes.has(value) ? value : null;
  if (key === "detailOpenMode") return detailOpenModes.has(value) ? value : null;
  if (key === "contentWidth") return contentWidths.has(value) ? value : null;
  if (key === "timezone") return isValidTimeZone(value) ? value : null;
  if (["showTitlebarTitle", "notificationsEnabled", "sidebarRailEnabled", "categoryTabsPinned", "floatingActionExpandAtEnd"].includes(key)) {
    return typeof value === "boolean" ? value : null;
  }
  if (key === "language") return typeof value === "string" && value.trim() ? value : null;
  return null;
}

export function normalizeUserPreferences(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_USER_PREFERENCES).map(([key, fallback]) => {
    const normalized = normalizeUserPreference(key, value?.[apiFieldByPreference[key]]);
    return [key, normalized ?? fallback];
  }));
}

export function toUserPreferencePatch(patch = {}) {
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    const normalized = normalizeUserPreference(key, value);
    if (normalized === null) return null;
    result[apiFieldByPreference[key]] = normalized;
  }
  return result;
}
