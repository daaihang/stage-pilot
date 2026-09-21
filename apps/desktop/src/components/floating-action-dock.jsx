import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveFloatingActionPresentation } from "@/lib/floating-action-layout";
import { useAppContentLayout } from "@/components/app-content-layout";

/**
 * Application-shell primitive for a single page-level floating primary action.
 * Pages supply only an action and an optional horizontal anchor; placement,
 * safe-area avoidance, tail expansion, and motion stay outside domain modules.
 */
export function FloatingActionDock({ children, anchorRef, open = false }) {
  const dockId = useId();
  const [sizeNode, setSizeNode] = useState(null);
  const [compactWidth, setCompactWidth] = useState(0);
  const wasOpenRef = useRef(open);
  const {
    floatingActionAnchor,
    floatingActionHost,
    contentEndInSafeZone,
    registerFloatingAction,
    setFloatingActionOpen,
  } = useAppContentLayout();
  const presentation = resolveFloatingActionPresentation({
    open,
    contentEndInSafeZone,
    compactWidth,
    anchorWidth: floatingActionAnchor.inlineSize,
  });

  useLayoutEffect(() => {
    if (!sizeNode) return undefined;
    return registerFloatingAction({ id: dockId, node: sizeNode, anchorNode: anchorRef?.current });
  }, [anchorRef, dockId, registerFloatingAction, sizeNode]);

  useLayoutEffect(() => {
    // The compact width is the button's intrinsic width.  Measure it once,
    // before any full-width transition starts: observing the size layer while
    // it is animating would continuously replace the transition target and
    // make the return animation snap.
    if (!sizeNode || compactWidth > 0) return undefined;
    const updateWidth = () => {
      const nextWidth = Math.max(0, Math.ceil(sizeNode.getBoundingClientRect().width));
      if (nextWidth > 0) {
        setCompactWidth((current) => current === nextWidth ? current : nextWidth);
      }
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(sizeNode);
    return () => observer.disconnect();
  }, [compactWidth, sizeNode]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setFloatingActionOpen(dockId, true);
      return undefined;
    }
    if (!wasOpenRef.current) {
      setFloatingActionOpen(dockId, false);
      return undefined;
    }
    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      wasOpenRef.current = false;
      setFloatingActionOpen(dockId, false);
    }, reducedMotion ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [dockId, open, setFloatingActionOpen]);

  useEffect(() => () => setFloatingActionOpen(dockId, false), [dockId, setFloatingActionOpen]);

  if (!floatingActionHost) return null;
  return createPortal(
    <div
      data-slot="floating-action-anchor"
      className="pointer-events-none absolute max-w-full"
      style={{
        insetBlockEnd: 0,
        insetInlineStart: `${floatingActionAnchor.inlineStart}px`,
        inlineSize: `${floatingActionAnchor.inlineSize}px`,
      }}
    >
      <div
        ref={setSizeNode}
        data-page-header-floating-primary
        data-expanded={presentation.expanded ? "true" : "false"}
        className="app-floating-action-size t-resize pointer-events-none max-w-full"
        style={presentation.inlineSize ? { inlineSize: `${presentation.inlineSize}px` } : undefined}
      >
        <div
          data-open={open ? "true" : "false"}
          aria-hidden={!open || undefined}
          inert={!open ? "" : undefined}
          className="app-floating-action-motion pointer-events-auto [&_[data-slot=button]]:shadow-lg"
        >
          <div data-slot="floating-action-control">{children}</div>
        </div>
      </div>
    </div>,
    floatingActionHost,
  );
}
