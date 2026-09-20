export const GLOBAL_UTILITY_BAR_HEIGHT = "3rem";
export const GLOBAL_UTILITY_BAR_HEIGHT_PX = 48;

export function resolveAppShellLayout(route) {
  const isWorkRoute = route?.mode === "work";
  return {
    showSidebar: !isWorkRoute,
    showSidebarTrigger: !isWorkRoute,
    showGlobalUtilityBar: isWorkRoute,
    toastSidebarVisible: !isWorkRoute,
    toastBottomOffset: isWorkRoute ? GLOBAL_UTILITY_BAR_HEIGHT : "0px",
  };
}
