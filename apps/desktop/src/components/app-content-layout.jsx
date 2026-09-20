import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { contentWidthClass } from "@/lib/content-width";
import { GLOBAL_UTILITY_BAR_HEIGHT } from "@/lib/app-shell-layout";

/**
 * Owns the scroll boundary below the application titlebar.
 *
 * Document and workspace pages share the same centred content canvas. Workspace
 * pages additionally provide a full-height main-area scroll boundary so the
 * window detail host can keep the detail surface independently scrollable.
 */
const defaultAppContentLayout = { contentWidth: "standard", scrollRef: null, floatingActionHost: null };
const AppContentLayoutContext = createContext(defaultAppContentLayout);
const FLOATING_ACTION_BOTTOM_GAP = "5rem";

export function useAppContentLayout() {
  return useContext(AppContentLayoutContext);
}

export function ContentWidthContainer({ children, className }) {
  const { contentWidth } = useAppContentLayout();
  return <div className={cn("mx-auto min-w-0 w-full", contentWidthClass(contentWidth), className)}>{children}</div>;
}

export function AppContentLayout({ mode = "document", contentWidth = "standard", children, bottomBar, className }) {
  const scrollRef = useRef(null);
  const [floatingActionHost, setFloatingActionHost] = useState(null);
  const assignFloatingActionHost = useCallback((node) => setFloatingActionHost(node), []);
  const scrollClassName = cn(
    "app-content-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 md:p-6",
    mode === "workspace" && !bottomBar ? "h-full" : "flex-1",
  );
  const contextValue = useMemo(() => ({ contentWidth, scrollRef, floatingActionHost }), [contentWidth, floatingActionHost, scrollRef]);
  const floatingActionBottom = bottomBar ? `calc(${GLOBAL_UTILITY_BAR_HEIGHT} + ${FLOATING_ACTION_BOTTOM_GAP})` : FLOATING_ACTION_BOTTOM_GAP;

  return <AppContentLayoutContext.Provider value={contextValue}>
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div ref={scrollRef} className={scrollClassName}>
        <ContentWidthContainer className="min-h-full">{children}</ContentWidthContainer>
      </div>
      <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-end px-4 md:px-6" style={{ bottom: floatingActionBottom }}>
        <ContentWidthContainer className="flex justify-end">
          <div ref={assignFloatingActionHost} className="pointer-events-none max-w-full" />
        </ContentWidthContainer>
      </div>
      {bottomBar}
    </div>
  </AppContentLayoutContext.Provider>;
}
