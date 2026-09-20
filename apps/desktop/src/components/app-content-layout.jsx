import { createContext, useContext, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { contentWidthClass } from "@/lib/content-width";

/**
 * Owns the scroll boundary below the application titlebar.
 *
 * Document and workspace pages share the same centred content canvas. Workspace
 * pages additionally provide a full-height main-area scroll boundary so the
 * window detail host can keep the detail surface independently scrollable.
 */
const defaultAppContentLayout = { contentWidth: "standard", scrollRef: null };
const AppContentLayoutContext = createContext(defaultAppContentLayout);

export function useAppContentLayout() {
  return useContext(AppContentLayoutContext);
}

export function ContentWidthContainer({ children, className }) {
  const { contentWidth } = useAppContentLayout();
  return <div className={cn("mx-auto min-w-0 w-full", contentWidthClass(contentWidth), className)}>{children}</div>;
}

export function AppContentLayout({ mode = "document", contentWidth = "standard", children, bottomBar, className }) {
  const scrollRef = useRef(null);
  const scrollClassName = cn(
    "app-content-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 md:p-6",
    mode === "workspace" && !bottomBar ? "h-full" : "flex-1",
  );
  const contextValue = useMemo(() => ({ contentWidth, scrollRef }), [contentWidth, scrollRef]);

  return <AppContentLayoutContext.Provider value={contextValue}>
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div ref={scrollRef} className={scrollClassName}>
        <ContentWidthContainer className="min-h-full">{children}</ContentWidthContainer>
      </div>
      {bottomBar}
    </div>
  </AppContentLayoutContext.Provider>;
}
