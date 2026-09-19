export const SETTINGS_TABS_VERTICAL_MIN_WIDTH = 56 * 16;

export function resolveSettingsTabsOrientation(width) {
  return Number(width) >= SETTINGS_TABS_VERTICAL_MIN_WIDTH ? "vertical" : "horizontal";
}
