import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { contentWidthClass } from "@/lib/content-width";
import { GLOBAL_UTILITY_BAR_HEIGHT_PX } from "@/lib/app-shell-layout";
import { resolveOverlayLayout } from "@/lib/overlay-layout";
import { useOverlayAvoidance } from "@/components/overlay-avoidance-context";

/**
 * Owns the scroll boundary below the application titlebar.
 *
 * Document and workspace pages share the same centred content canvas. Workspace
 * pages additionally provide a full-height main-area scroll boundary so the
 * window detail host can keep the detail surface independently scrollable.
 */
const defaultAppContentLayout = {
  contentWidth: "standard",
  scrollRef: null,
  floatingActionHost: null,
  registerFloatingActionNode: () => {},
  setFloatingActionOpen: () => {},
};
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
  const [floatingActionHost, setFloatingActionHost] = useState(null);
  const [floatingActionNode, setFloatingActionNode] = useState(null);
  const [floatingActionHeight, setFloatingActionHeight] = useState(0);
  const [floatingActionOpen, setFloatingActionOpen] = useState(false);
  const { toastHeight } = useOverlayAvoidance();
  const assignFloatingActionHost = useCallback((node) => setFloatingActionHost(node), []);
  const registerFloatingActionNode = useCallback((node) => setFloatingActionNode(node), []);

  useLayoutEffect(() => {
    if (!floatingActionNode) {
      setFloatingActionHeight(0);
      return undefined;
    }

    const updateHeight = () => {
      const nextHeight = Math.max(0, Math.ceil(floatingActionNode.getBoundingClientRect().height));
      setFloatingActionHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(floatingActionNode);
    return () => observer.disconnect();
  }, [floatingActionNode]);

  const overlayLayout = resolveOverlayLayout({
    toastHeight,
    floatingActionHeight,
    floatingActionOpen,
    bottomBarHeight: bottomBar ? GLOBAL_UTILITY_BAR_HEIGHT_PX : 0,
  });
  const scrollClassName = cn(
    "app-content-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 md:p-6",
    mode === "workspace" && !bottomBar ? "h-full" : "flex-1",
  );
  const contextValue = useMemo(() => ({
    contentWidth,
    scrollRef,
    floatingActionHost,
    registerFloatingActionNode,
    setFloatingActionOpen,
  }), [contentWidth, floatingActionHost, registerFloatingActionNode, scrollRef]);
  const scrollStyle = {
    "--app-overlay-clearance": `calc(env(safe-area-inset-bottom, 0px) + ${overlayLayout.overlayClearance}px)`,
  };
  const floatingActionStyle = {
    bottom: `calc(env(safe-area-inset-bottom, 0px) + ${overlayLayout.floatingActionBottom}px)`,
  };

  return <AppContentLayoutContext.Provider value={contextValue}>
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div ref={scrollRef} className={scrollClassName} style={scrollStyle}>
        <ContentWidthContainer className="min-h-full">{children}</ContentWidthContainer>
      </div>
      <div data-slot="floating-action-position" className="app-floating-action-position pointer-events-none absolute inset-x-0 z-20 flex justify-end px-4 md:px-6" style={floatingActionStyle}>
        <ContentWidthContainer className="flex justify-end">
          <div ref={assignFloatingActionHost} className="pointer-events-none max-w-full" />
        </ContentWidthContainer>
      </div>
      {bottomBar}
    </div>
  </AppContentLayoutContext.Provider>;
}
