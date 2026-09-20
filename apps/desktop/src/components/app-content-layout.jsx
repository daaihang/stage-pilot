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
  floatingActionLayout: { inlineStart: 0, inlineSize: 0 },
  contentEndVisible: false,
  registerFloatingAction: () => () => {},
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
  const layoutRef = useRef(null);
  const contentEndRef = useRef(null);
  const [floatingActionHost, setFloatingActionHost] = useState(null);
  const [floatingAction, setFloatingAction] = useState(null);
  const [floatingActionHeight, setFloatingActionHeight] = useState(0);
  const [floatingActionLayout, setFloatingActionLayout] = useState({ inlineStart: 0, inlineSize: 0 });
  const [contentEndVisible, setContentEndVisible] = useState(false);
  const { toastHeight } = useOverlayAvoidance();
  const assignFloatingActionHost = useCallback((node) => setFloatingActionHost(node), []);
  const registerFloatingAction = useCallback((nextAction) => {
    if (!nextAction?.id || !nextAction.node) return () => {};
    setFloatingAction((current) => {
      if (current && current.id !== nextAction.id) return current;
      return { ...nextAction, open: current?.id === nextAction.id ? current.open : false };
    });
    return () => setFloatingAction((current) => current?.id === nextAction.id ? null : current);
  }, []);
  const setFloatingActionOpen = useCallback((id, open) => {
    setFloatingAction((current) => current?.id === id && current.open !== Boolean(open)
      ? { ...current, open: Boolean(open) }
      : current);
  }, []);

  useLayoutEffect(() => {
    const floatingActionNode = floatingAction?.node;
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
  }, [floatingAction?.node]);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const anchor = floatingAction?.anchorNode;
    if (!layout || !anchor) {
      setFloatingActionLayout({ inlineStart: 0, inlineSize: 0 });
      return undefined;
    }
    const updateLayout = () => {
      const layoutRect = layout.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const next = {
        inlineStart: Math.max(0, Math.round(anchorRect.left - layoutRect.left)),
        inlineSize: Math.max(0, Math.round(Math.min(anchorRect.width, layoutRect.width))),
      };
      setFloatingActionLayout((current) => current.inlineStart === next.inlineStart && current.inlineSize === next.inlineSize ? current : next);
    };
    updateLayout();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(layout);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [floatingAction?.anchorNode]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const sentinel = contentEndRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") {
      setContentEndVisible(false);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setContentEndVisible(Boolean(entry?.isIntersecting));
    }, { root, threshold: [0] });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [contentWidth, mode]);

  const overlayLayout = resolveOverlayLayout({
    toastHeight,
    floatingActionHeight,
    floatingActionOpen: Boolean(floatingAction?.open),
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
    floatingActionLayout,
    contentEndVisible,
    registerFloatingAction,
    setFloatingActionOpen,
  }), [contentWidth, contentEndVisible, floatingActionHost, floatingActionLayout, registerFloatingAction, scrollRef, setFloatingActionOpen]);
  const scrollStyle = {
    "--app-overlay-clearance": `calc(env(safe-area-inset-bottom, 0px) + ${overlayLayout.overlayClearance}px)`,
  };
  const floatingActionStyle = {
    bottom: `calc(env(safe-area-inset-bottom, 0px) + ${overlayLayout.floatingActionBottom}px)`,
  };

  return <AppContentLayoutContext.Provider value={contextValue}>
    <div ref={layoutRef} className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div ref={scrollRef} className={scrollClassName} style={scrollStyle}>
        <ContentWidthContainer className="min-h-full">{children}<div ref={contentEndRef} data-slot="app-content-end" className="h-px w-full" aria-hidden="true" /></ContentWidthContainer>
      </div>
      <div data-slot="floating-action-position" className="app-floating-action-position pointer-events-none absolute inset-x-0 z-20" style={floatingActionStyle}>
        <div ref={assignFloatingActionHost} className="pointer-events-none relative h-full w-full" />
      </div>
      {bottomBar}
    </div>
  </AppContentLayoutContext.Provider>;
}
