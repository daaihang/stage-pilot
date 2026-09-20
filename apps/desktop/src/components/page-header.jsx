import { Children, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { PAGE_HEADER_ACTION_MIN_INLINE_SIZE, resolvePageHeaderActionsLayout } from "@/lib/page-header-actions-layout";
import { resolvePageHeaderVisibilityFromRects, shouldTrackPageHeader } from "@/lib/page-header-visibility";
import { resolveFloatingPrimaryState } from "@/lib/page-header-floating";
import { resolveFloatingActionPresentation } from "@/lib/floating-action-layout";
import { useAppContentLayout } from "@/components/app-content-layout";
import { usePageChrome } from "@/components/page-chrome";

/**
 * Shared page-level heading. Navigation belongs above the page title, while
 * page actions remain separate from window-level detail controls.
 */
export function PageHeader({
  back,
  title,
  titleContent,
  titleAccessory,
  description,
  actions,
  floatingPrimary,
  headingLevel = "h1",
  children,
  className,
}) {
  const Heading = headingLevel;
  const headerRef = useRef(null);
  const pageHeaderId = useId();
  const { scrollRef } = useAppContentLayout();
  const { registerPageHeader, reportPageHeaderVisibility } = usePageChrome();
  const trackVisibility = shouldTrackPageHeader(headingLevel);
  const resolvedTitle = titleContent || (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Heading className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</Heading>
      {titleAccessory}
    </div>
  );

  useLayoutEffect(() => {
    if (!trackVisibility) return undefined;

    const unregister = registerPageHeader(pageHeaderId);
    const header = headerRef.current;
    const root = scrollRef?.current;
    if (!header || !root) {
      reportPageHeaderVisibility(pageHeaderId, true);
      return unregister;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      reportPageHeaderVisibility(pageHeaderId, resolvePageHeaderVisibilityFromRects(header.getBoundingClientRect(), root.getBoundingClientRect()));
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", scheduleMeasure, { passive: true });
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(scheduleMeasure, { root, threshold: [0] });
    observer?.observe(header);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(header);
    resizeObserver?.observe(root);

    return () => {
      root.removeEventListener("scroll", scheduleMeasure);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      resizeObserver?.disconnect();
      unregister();
    };
  }, [pageHeaderId, registerPageHeader, reportPageHeaderVisibility, scrollRef, trackVisibility]);

  return <>
    <header ref={headerRef} data-page-header={trackVisibility ? "root" : "section"} className={cn("@container/page-header min-w-0 space-y-2", className)}>
      {back}
      <div className="flex min-w-0 flex-col gap-4 @min-[40rem]/page-header:flex-row @min-[40rem]/page-header:items-start @min-[40rem]/page-header:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {resolvedTitle}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
        {actions}
      </div>
    </header>
    {floatingPrimary && trackVisibility && <FloatingPrimaryAction anchorRef={headerRef}>{floatingPrimary}</FloatingPrimaryAction>}
  </>;
}

export function FloatingPrimaryAction({ children, enabled = true, anchorRef }) {
  const { pageHeaderVisible } = usePageChrome();
  const { floatingActionHost } = useAppContentLayout();
  const state = resolveFloatingPrimaryState({ enabled, pageHeaderVisible, hasHost: Boolean(floatingActionHost) });

  if (!state.mounted) return null;
  return <FloatingActionDock anchorRef={anchorRef} state={state}>{children}</FloatingActionDock>;
}

function FloatingActionDock({ children, state, anchorRef }) {
  const dockId = useId();
  const [dockNode, setDockNode] = useState(null);
  const [compactWidth, setCompactWidth] = useState(0);
  const { floatingActionHost, floatingActionLayout, contentEndVisible, registerFloatingAction, setFloatingActionOpen } = useAppContentLayout();
  const wasOpenRef = useRef(state.open);
  const presentation = resolveFloatingActionPresentation({ open: state.open, contentEndVisible, compactWidth });

  useLayoutEffect(() => {
    if (!dockNode) return undefined;
    return registerFloatingAction({ id: dockId, node: dockNode, anchorNode: anchorRef?.current });
  }, [anchorRef, dockId, dockNode, registerFloatingAction]);

  useLayoutEffect(() => {
    if (!dockNode || presentation.expanded) return undefined;
    const updateWidth = () => {
      const width = Math.max(0, Math.ceil(dockNode.getBoundingClientRect().width));
      setCompactWidth((current) => current === width ? current : width);
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(dockNode);
    return () => observer.disconnect();
  }, [dockNode, presentation.expanded]);

  useEffect(() => {
    if (state.open) {
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
  }, [dockId, setFloatingActionOpen, state.open]);

  useEffect(() => () => setFloatingActionOpen(dockId, false), [dockId, setFloatingActionOpen]);

  return createPortal(
    <div
      data-slot="floating-action-anchor"
      className="pointer-events-none absolute max-w-full"
      style={{ insetInlineStart: `${floatingActionLayout.inlineStart}px`, inlineSize: `${floatingActionLayout.inlineSize}px` }}
    >
      <div
        ref={setDockNode}
        data-page-header-floating-primary
        data-open={state.open ? "true" : "false"}
        data-expanded={presentation.expanded ? "true" : "false"}
        aria-hidden={state.inert || undefined}
        inert={state.inert ? "" : undefined}
        className="app-floating-action-dock t-resize pointer-events-auto flex max-w-full justify-end [&_[data-slot=button]]:shadow-lg"
        style={{ inlineSize: presentation.expanded ? "100%" : presentation.compactWidth ? `${presentation.compactWidth}px` : "fit-content" }}
      >
        <div data-slot="floating-action-control">{children}</div>
      </div>
    </div>,
    floatingActionHost,
  );
}

/**
 * Page actions declare priority explicitly so responsive layout never depends
 * on source order or a Button variant. Secondary actions are direct, frequent
 * page operations; lower-frequency commands belong in an optional overflow
 * menu supplied by the caller.
 */
export function PageHeaderActions({ primary, secondary, overflow, ariaLabel = "页面操作", className }) {
  const secondaryActions = Children.toArray(secondary);
  const layout = resolvePageHeaderActionsLayout({
    hasPrimary: Boolean(primary),
    secondaryCount: secondaryActions.length,
    hasOverflow: Boolean(overflow),
  });
  const fillAvailableWidth = layout !== "secondary-only" && layout !== "empty";

  if (layout === "empty") return null;

  return (
    <div className={cn(
      "grid min-w-0 w-full gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--page-header-action-min-inline-size)),1fr))] @min-[40rem]/page-header:flex @min-[40rem]/page-header:w-auto @min-[40rem]/page-header:flex-row @min-[40rem]/page-header:flex-wrap @min-[40rem]/page-header:justify-end",
      fillAvailableWidth && "[&_[data-slot=button]]:w-full @min-[40rem]/page-header:[&_[data-slot=button]]:w-auto",
      layout === "secondary-only" && "justify-items-start",
      className,
    )} data-slot="page-header-actions" data-layout={layout} role="group" aria-label={ariaLabel} style={{ "--page-header-action-min-inline-size": PAGE_HEADER_ACTION_MIN_INLINE_SIZE }}>
      {primary && <div data-slot="page-header-action" data-priority="primary" className={cn("min-w-0 order-1 @min-[40rem]/page-header:order-2", layout === "primary-with-secondary-grid" && "col-span-full @min-[40rem]/page-header:col-auto")}>{primary}</div>}
      {secondaryActions.map((action, index) => <div key={index} data-slot="page-header-action" data-priority="secondary" className="min-w-0 order-2 @min-[40rem]/page-header:order-1">{action}</div>)}
      {overflow && <div data-slot="page-header-action" data-priority="overflow" className="min-w-0 order-3 @min-[40rem]/page-header:order-1">{overflow}</div>}
    </div>
  );
}
