import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { contentWidthClass } from "@/lib/content-width";
import { usePageChrome } from "@/components/page-chrome";
import { normalizeDetailOpenMode, resolveDetailLayoutMode, resolveDetailPresentation, resolveRestoredDetailMode } from "@/lib/detail-open-mode";
import { createDetailSurfaceState, transitionDetailSurface } from "@/lib/detail-surface-state";

const MIN_DETAIL_WIDTH = 280;
const DEFAULT_DETAIL_WIDTH = 420;
const MIN_MAIN_WIDTH = 320;
const INLINE_MIN_WIDTH = 960;

function maxDetailWidth(containerWidth) {
  return Math.max(MIN_DETAIL_WIDTH, Math.floor(containerWidth - MIN_MAIN_WIDTH));
}

function clampDetailWidth(width, containerWidth) {
  return Math.min(maxDetailWidth(containerWidth), Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
}

function transitionDurationMs(element) {
  if (!element) return 0;
  const styles = window.getComputedStyle(element);
  const durations = styles.transitionDuration.split(",").map((value) => {
    const trimmed = value.trim();
    if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed) || 0;
    return (Number.parseFloat(trimmed) || 0) * 1000;
  });
  return Math.max(...durations, 0);
}

/**
 * Window-level master/detail surface. The detail content is rendered exactly
 * once; only its geometry changes between inline, exclusive and overlay.
 */
export function DetailSplitPane({
  children,
  detail,
  detailLabel = "详情",
  open,
  onOpenChange,
  storageKey,
  triggerRef,
  onDetailWidthChange,
  onPresentationChange,
  contentWidth = "standard",
  detailOpenMode = "inline",
  className,
}) {
  const containerRef = useRef(null);
  const surfaceRef = useRef(null);
  const saveTimerRef = useRef(null);
  const fallbackFrameRef = useRef(null);
  const openFocusRef = useRef(null);
  const wasOpenRef = useRef(open);
  const exclusiveRef = useRef(false);
  const surfaceStateRef = useRef(createDetailSurfaceState());
  const surfaceTimeoutRef = useRef(null);
  const surfacePaintedRef = useRef(false);
  const restoreExclusiveFocusRef = useRef(false);
  const closeFocusToTriggerRef = useRef(false);
  const activeOpenModeRef = useRef(null);
  const widePresentationRef = useRef(null);
  const layoutModeRef = useRef(null);
  const previousOpenForModeRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const [exclusive, setExclusive] = useState(false);
  const [surfaceMounted, setSurfaceMounted] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState("overlay");
  const [surfacePhase, setSurfacePhase] = useState("idle");
  const [layoutMode, setLayoutMode] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const { setDetailAction } = usePageChrome();

  const isSurfaceOpen = surfacePhase === "open";
  exclusiveRef.current = exclusive;

  const setExclusiveMode = useCallback((nextMode) => {
    const next = typeof nextMode === "function" ? nextMode(exclusiveRef.current) : Boolean(nextMode);
    exclusiveRef.current = next;
    setExclusive(next);
    return next;
  }, []);

  const cancelSurfaceTransition = useCallback(() => {
    if (fallbackFrameRef.current) cancelAnimationFrame(fallbackFrameRef.current);
    if (surfaceTimeoutRef.current) clearTimeout(surfaceTimeoutRef.current);
    fallbackFrameRef.current = null;
    surfaceTimeoutRef.current = null;
  }, []);

  const commitSurfaceState = useCallback((nextState) => {
    surfaceStateRef.current = nextState;
    setSurfaceMounted(nextState.mounted);
    setSurfacePhase(nextState.phase);
  }, []);

  const enterExclusive = useCallback(() => {
    if (!exclusiveRef.current) openFocusRef.current = document.activeElement;
    restoreExclusiveFocusRef.current = false;
    activeOpenModeRef.current = "exclusive";
    widePresentationRef.current = "exclusive";
    setExclusiveMode(true);
    notify.info("详情已独占工作区");
  }, [setExclusiveMode]);

  const exitExclusive = useCallback(() => {
    restoreExclusiveFocusRef.current = true;
    activeOpenModeRef.current = "inline";
    widePresentationRef.current = "inline";
    setExclusiveMode(false);
    notify.info("已退出独占详情");
  }, [setExclusiveMode]);

  const closeDetail = useCallback(() => {
    closeFocusToTriggerRef.current = true;
    restoreExclusiveFocusRef.current = false;
    setExclusiveMode(false);
    onOpenChange(false);
  }, [onOpenChange, setExclusiveMode]);

  // Do not mount a surface until the host has a real size.  Otherwise the
  // first render can briefly resolve to the narrow overlay geometry and then
  // switch to the inline geometry once ResizeObserver reports the width,
  // which makes the panel appear to enter from the wrong edge.
  const hasMeasuredContainer = containerWidth > 0;
  const preferredMode = normalizeDetailOpenMode(detailOpenMode);
  const activeOpenMode = open ? (activeOpenModeRef.current || preferredMode) : preferredMode;
  const canInline = open && hasMeasuredContainer && layoutMode === "wide";
  const desiredMode = resolveDetailPresentation({
    open,
    measured: hasMeasuredContainer,
    containerWidth,
    layoutMode,
    preferredMode: activeOpenMode,
    exclusive,
    inlineMinWidth: INLINE_MIN_WIDTH,
  });
  const isInline = open && desiredMode === "inline";
  const isOverlay = open && desiredMode === "overlay";
  const isExclusivePresentation = open && desiredMode === "exclusive";
  const constrainedWidth = clampDetailWidth(detailWidth, containerWidth || INLINE_MIN_WIDTH);
  const exclusiveInset = containerWidth >= 1280 ? "32px" : containerWidth >= 1080 ? "24px" : "16px";

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previousOpen = previousOpenForModeRef.current;
    if (open && !previousOpen) {
      activeOpenModeRef.current = preferredMode;
      widePresentationRef.current = null;
      layoutModeRef.current = null;
      if (layoutMode !== null) setLayoutMode(null);
    }
    if (!open && previousOpen) {
      activeOpenModeRef.current = null;
      widePresentationRef.current = null;
      layoutModeRef.current = null;
      if (layoutMode !== null) setLayoutMode(null);
    }
    if (open && canInline && activeOpenModeRef.current === "exclusive" && !exclusive) setExclusiveMode(true);
    previousOpenForModeRef.current = open;
  }, [canInline, exclusive, layoutMode, open, preferredMode, setExclusiveMode]);

  useEffect(() => {
    if (!open || !hasMeasuredContainer) return;
    const previousMode = layoutModeRef.current;
    const nextMode = resolveDetailLayoutMode(containerWidth, previousMode);
    if (!nextMode || nextMode === previousMode) return;
    if (!activeOpenModeRef.current) activeOpenModeRef.current = preferredMode;

    if (previousMode === "wide" && nextMode === "narrow") {
      widePresentationRef.current = activeOpenModeRef.current || preferredMode;
    } else if (previousMode === "narrow" && nextMode === "wide") {
      const restoredMode = resolveRestoredDetailMode({
        savedMode: widePresentationRef.current,
        activeMode: activeOpenModeRef.current,
        preferredMode,
      });
      activeOpenModeRef.current = restoredMode;
      if (restoredMode === "exclusive") setExclusiveMode(true);
    } else if (nextMode === "wide" && activeOpenModeRef.current === "exclusive") {
      setExclusiveMode(true);
    }

    layoutModeRef.current = nextMode;
    setLayoutMode(nextMode);
  }, [containerWidth, hasMeasuredContainer, open, preferredMode, setExclusiveMode]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!storageKey) return;
      try {
        await appStore.init?.();
        const stored = await appStore.get(storageKey);
        if (active && Number.isFinite(stored)) setDetailWidth(stored);
      } catch {
        // Layout preferences are non-critical and must never block rendering.
      }
    };
    void load();
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if ((!open || !canInline) && exclusive) {
      setExclusiveMode(false);
    }
  }, [canInline, exclusive, open, setExclusiveMode]);

  useEffect(() => { onDetailWidthChange?.(constrainedWidth); }, [constrainedWidth, onDetailWidthChange]);

  useEffect(() => {
    if (open && desiredMode) onPresentationChange?.(desiredMode);
  }, [desiredMode, onPresentationChange, open]);

  const finishClose = useCallback((sequence) => {
    const current = surfaceStateRef.current;
    if (current.sequence !== sequence || current.phase !== "closing") return;
    surfacePaintedRef.current = false;
    commitSurfaceState(transitionDetailSurface(current, { type: "close-settled", sequence }));
  }, [commitSurfaceState]);

  // Keep one surface mounted through mode changes and make every transition
  // cancellable. A stale RAF or transition callback must never settle a newer
  // open or close request.
  useEffect(() => {
    cancelSurfaceTransition();
    if (open && desiredMode) {
      setSurfaceMode(desiredMode);
      const nextState = transitionDetailSurface(surfaceStateRef.current, { type: "open" });
      commitSurfaceState(nextState);
      if (nextState.phase === "open") return undefined;
      const sequence = nextState.sequence;
      const openAfterPaint = () => {
        if (surfaceStateRef.current.sequence !== sequence) return;
        surfacePaintedRef.current = true;
        commitSurfaceState(transitionDetailSurface(surfaceStateRef.current, { type: "open-settled", sequence }));
      };
      fallbackFrameRef.current = requestAnimationFrame(() => {
        fallbackFrameRef.current = requestAnimationFrame(openAfterPaint);
      });
      return cancelSurfaceTransition;
    }
    if (open) return undefined;
    if (!surfaceStateRef.current.mounted) {
      commitSurfaceState(createDetailSurfaceState({ sequence: surfaceStateRef.current.sequence }));
      return undefined;
    }
    const nextState = transitionDetailSurface(surfaceStateRef.current, { type: "close" });
    if (nextState.phase === "closing" && !surfacePaintedRef.current) {
      commitSurfaceState(transitionDetailSurface(nextState, { type: "close-settled", sequence: nextState.sequence }));
      return undefined;
    }
    commitSurfaceState(nextState);
    const sequence = nextState.sequence;
    const duration = transitionDurationMs(surfaceRef.current);
    surfaceTimeoutRef.current = setTimeout(() => finishClose(sequence), duration + 50);
    return cancelSurfaceTransition;
  }, [cancelSurfaceTransition, commitSurfaceState, desiredMode, finishClose, open]);

  useEffect(() => {
    if (!open) {
      setDetailAction(null);
      return undefined;
    }
    setDetailAction({
      label: "关闭详情",
      detailLabel,
      presentation: desiredMode,
      exclusive: isExclusivePresentation,
      onClose: closeDetail,
      onToggleExclusive: canInline ? (isExclusivePresentation ? exitExclusive : enterExclusive) : undefined,
    });
    return () => setDetailAction(null);
  }, [canInline, closeDetail, desiredMode, detailLabel, enterExclusive, exitExclusive, isExclusivePresentation, open, setDetailAction]);

  // Focus the surface on entering either exclusive or narrow page mode.
  useEffect(() => {
    if (!open || !surfaceMounted || !isSurfaceOpen) return undefined;
    const enteringExclusive = isExclusivePresentation && surfaceMode === "exclusive";
    const enteringOverlay = isOverlay && surfaceMode === "overlay";
    if (!enteringExclusive && !enteringOverlay) return undefined;
    const frame = requestAnimationFrame(() => surfaceRef.current?.focus?.());
    return () => cancelAnimationFrame(frame);
  }, [isExclusivePresentation, isOverlay, isSurfaceOpen, open, surfaceMode, surfaceMounted]);

  // Explicit exclusive exit restores the focus that was active before entry.
  useEffect(() => {
    if (exclusive || !restoreExclusiveFocusRef.current) return undefined;
    restoreExclusiveFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      const element = openFocusRef.current;
      if (element && document.contains(element) && !element.closest("[inert]")) element.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [exclusive]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const frame = requestAnimationFrame(() => {
        if (closeFocusToTriggerRef.current) {
          closeFocusToTriggerRef.current = false;
          triggerRef?.current?.focus?.();
        }
      });
      wasOpenRef.current = open;
      return () => cancelAnimationFrame(frame);
    }
    wasOpenRef.current = open;
    return undefined;
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open || (!isExclusivePresentation && !isOverlay)) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (isExclusivePresentation) exitExclusive();
      else closeDetail();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeDetail, exitExclusive, isExclusivePresentation, isOverlay, open]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    cancelSurfaceTransition();
  }, [cancelSurfaceTransition]);

  const commitWidth = (nextWidth) => {
    const next = clampDetailWidth(nextWidth, containerWidth || INLINE_MIN_WIDTH);
    setDetailWidth(next);
    onDetailWidthChange?.(next);
    if (!storageKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { appStore.set(storageKey, next).catch(() => {}); }, 150);
  };

  const resizeFromClientX = (clientX) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    commitWidth(bounds.right - clientX);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    setIsResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeFromClientX(event.clientX);
  };

  const onPointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    resizeFromClientX(event.clientX);
  };

  const onPointerUp = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsResizing(false);
  };

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); commitWidth(constrainedWidth + step); }
    if (event.key === "ArrowRight") { event.preventDefault(); commitWidth(constrainedWidth - step); }
    if (event.key === "Home") { event.preventDefault(); commitWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); commitWidth(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)); }
  };

  const handleSurfaceTransitionEnd = (event) => {
    if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
    if (surfaceStateRef.current.phase === "closing") finishClose(surfaceStateRef.current.sequence);
  };

  const mainInert = isExclusivePresentation || isOverlay;
  const mainWidth = isInline ? `calc(100% - ${constrainedWidth}px)` : "100%";
  const surfaceStyle = surfaceMode === "inline"
    ? {
      left: isSurfaceOpen ? `calc(100% - ${constrainedWidth}px)` : "100%",
      right: 0,
      top: 0,
      bottom: 0,
      opacity: isSurfaceOpen ? 1 : 0,
      transform: isSurfaceOpen ? "translateX(0)" : "translateX(8px)",
    }
    : surfaceMode === "exclusive"
      ? {
        left: exclusiveInset,
        right: exclusiveInset,
        top: exclusiveInset,
        bottom: exclusiveInset,
        opacity: isSurfaceOpen ? 1 : 0,
        transform: isSurfaceOpen ? "scale(1)" : "scale(0.96)",
      }
      : {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        opacity: isSurfaceOpen ? 1 : 0,
        transform: isSurfaceOpen ? "translateX(0)" : "translateX(16px)",
      };

  const effectiveSurfaceMode = surfaceMounted ? surfaceMode : (desiredMode || "overlay");
  return <div ref={containerRef} data-resizing={isResizing || undefined} data-main-inert={mainInert || undefined} className={cn("detail-split-pane relative flex h-full min-h-0 min-w-0", className)}>
    <div className={cn("t-resize flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden", mainInert && "pointer-events-none")} style={{ width: mainWidth }} inert={mainInert || undefined} aria-hidden={mainInert || undefined}>{children}</div>
    {surfaceMounted && surfaceMode === "exclusive" && <button type="button" aria-hidden="true" tabIndex={-1} className={cn("absolute inset-0 z-10 cursor-default border-0 bg-black/10 p-0 outline-none transition-opacity", isSurfaceOpen ? "opacity-100" : "pointer-events-none opacity-0")} onClick={exitExclusive} />}
    {surfaceMounted && <div
      ref={surfaceRef}
      data-detail-surface
      data-detail-mode={surfaceMode}
      data-detail-phase={surfacePhase}
      data-detail-closing={surfacePhase === "closing" ? "true" : undefined}
      role={effectiveSurfaceMode === "exclusive" ? "dialog" : "region"}
      aria-hidden={!isSurfaceOpen || undefined}
      aria-label={detailLabel}
      tabIndex={-1}
      className={cn(
        "detail-surface absolute z-10 flex min-h-0 min-w-0 flex-col overflow-hidden outline-none",
        surfaceMode === "exclusive" && "t-modal",
        surfaceMode === "exclusive" && surfacePhase === "open" && "is-open",
        surfaceMode === "exclusive" && surfacePhase === "closing" && "is-closing",
        surfaceMode === "inline" && "border-l border-border bg-background",
        surfaceMode === "exclusive" && "rounded-none bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-lg",
        surfaceMode === "overlay" && "bg-background shadow-none",
        !isSurfaceOpen && "pointer-events-none",
      )}
      style={surfaceStyle}
      onTransitionEnd={handleSurfaceTransitionEnd}
      onTransitionCancel={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
        requestAnimationFrame(() => {
          if (surfaceStateRef.current.phase === "closing" && transitionDurationMs(surfaceRef.current) === 0) finishClose(surfaceStateRef.current.sequence);
        });
      }}
    >
      <div className="app-content-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className={cn("min-h-full w-full", surfaceMode === "inline" ? "" : cn("mx-auto", contentWidthClass(contentWidth)))}>{detail}</div>
      </div>
      {surfaceMode === "inline" && <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整详情面板宽度"
        aria-valuemin={MIN_DETAIL_WIDTH}
        aria-valuemax={maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)}
        aria-valuenow={constrainedWidth}
        tabIndex={0}
        className={cn("absolute inset-y-0 -left-2 z-20 w-4 touch-none cursor-ew-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-200 after:ease-linear hover:after:bg-sidebar-border focus-visible:after:bg-ring", !isSurfaceOpen && "pointer-events-none opacity-0")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />}
    </div>}
  </div>;
}
