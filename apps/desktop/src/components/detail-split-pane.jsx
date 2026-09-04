import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { usePageChrome } from "@/components/page-chrome";

const MIN_DETAIL_WIDTH = 280;
const DEFAULT_DETAIL_WIDTH = 420;
const MIN_MAIN_WIDTH = 320;
const INLINE_MIN_WIDTH = 960;
const INLINE_TRANSITION_MS = 300;
const EXCLUSIVE_CLOSE_TRANSITION_MS = 150;
const OVERLAY_TRANSITION_MS = 200;
const contentWidthClassName = { standard: "max-w-6xl", wide: "max-w-7xl", full: "max-w-none" };

function maxDetailWidth(containerWidth) {
  return Math.max(MIN_DETAIL_WIDTH, Math.floor(containerWidth - MIN_MAIN_WIDTH));
}

function clampDetailWidth(width, containerWidth) {
  return Math.min(maxDetailWidth(containerWidth), Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
}

/**
 * Window-level master/detail surface. The main content remains mounted while
 * the detail changes presentation between inline, exclusive, and overlay.
 */
export function DetailSplitPane({
  children,
  detail,
  open,
  onOpenChange,
  storageKey,
  triggerRef,
  onDetailWidthChange,
  onPresentationChange,
  contentWidth = "standard",
  className,
}) {
  const containerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const inlineCloseTimerRef = useRef(null);
  const exclusiveCloseTimerRef = useRef(null);
  const overlayCloseTimerRef = useRef(null);
  const exclusiveFrameRef = useRef(null);
  const overlayFrameRef = useRef(null);
  const wasOpenRef = useRef(open);
  const [containerWidth, setContainerWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const [inlineMounted, setInlineMounted] = useState(false);
  const [inlineVisible, setInlineVisible] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const [exclusiveMounted, setExclusiveMounted] = useState(false);
  const [exclusiveVisible, setExclusiveVisible] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const exclusiveRef = useRef(false);
  const { setDetailAction } = usePageChrome();

  const setExclusiveMode = useCallback((nextMode) => {
    const next = typeof nextMode === "function" ? nextMode(exclusiveRef.current) : Boolean(nextMode);
    exclusiveRef.current = next;
    setExclusive(next);
    return next;
  }, []);

  const toggleExclusive = useCallback(() => {
    const next = setExclusiveMode((current) => !current);
    notify.info(next ? "详情已独占工作区" : "已退出独占详情");
  }, [setExclusiveMode]);

  const closeDetail = useCallback(() => {
    setExclusiveMode(false);
    onOpenChange(false);
  }, [onOpenChange, setExclusiveMode]);

  const canInline = open && containerWidth >= INLINE_MIN_WIDTH;
  const isInline = canInline && !exclusive;
  const isOverlay = open && !exclusive && containerWidth > 0 && containerWidth < INLINE_MIN_WIDTH;
  const constrainedWidth = clampDetailWidth(detailWidth, containerWidth || INLINE_MIN_WIDTH);

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
    if ((!open || !canInline) && exclusive) setExclusiveMode(false);
  }, [canInline, exclusive, open, setExclusiveMode]);

  useEffect(() => { onDetailWidthChange?.(constrainedWidth); }, [constrainedWidth, onDetailWidthChange]);

  useEffect(() => {
    if (open) onPresentationChange?.(exclusive ? "exclusive" : isInline ? "inline" : "overlay");
  }, [exclusive, isInline, onPresentationChange, open]);

  useEffect(() => {
    if (isInline) {
      if (inlineCloseTimerRef.current) clearTimeout(inlineCloseTimerRef.current);
      setInlineMounted(true);
      requestAnimationFrame(() => setInlineVisible(true));
      return undefined;
    }
    setInlineVisible(false);
    if (inlineMounted) inlineCloseTimerRef.current = setTimeout(() => setInlineMounted(false), INLINE_TRANSITION_MS);
    return undefined;
  }, [inlineMounted, isInline]);

  useEffect(() => {
    if (exclusive) {
      if (exclusiveCloseTimerRef.current) clearTimeout(exclusiveCloseTimerRef.current);
      setExclusiveMounted(true);
      exclusiveFrameRef.current = requestAnimationFrame(() => setExclusiveVisible(true));
      return () => {
        if (exclusiveFrameRef.current) cancelAnimationFrame(exclusiveFrameRef.current);
      };
    }
    setExclusiveVisible(false);
    if (exclusiveMounted) {
      exclusiveCloseTimerRef.current = setTimeout(() => setExclusiveMounted(false), EXCLUSIVE_CLOSE_TRANSITION_MS);
    }
    return undefined;
  }, [exclusive, exclusiveMounted]);

  useEffect(() => {
    if (isOverlay) {
      if (overlayCloseTimerRef.current) clearTimeout(overlayCloseTimerRef.current);
      setOverlayMounted(true);
      overlayFrameRef.current = requestAnimationFrame(() => setOverlayVisible(true));
      return () => {
        if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
      };
    }
    setOverlayVisible(false);
    if (overlayMounted) {
      overlayCloseTimerRef.current = setTimeout(() => setOverlayMounted(false), OVERLAY_TRANSITION_MS);
    }
    return undefined;
  }, [isOverlay, overlayMounted]);

  useEffect(() => {
    if (!open) {
      setDetailAction(null);
      return undefined;
    }
    setDetailAction({
      label: "关闭详情",
      exclusive,
      onClose: closeDetail,
      onToggleExclusive: canInline ? toggleExclusive : undefined,
    });
    return () => setDetailAction(null);
  }, [canInline, closeDetail, exclusive, open, setDetailAction, toggleExclusive]);

  useEffect(() => {
    if (wasOpenRef.current && !open) requestAnimationFrame(() => triggerRef?.current?.focus?.());
    wasOpenRef.current = open;
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open || (!isOverlay && !exclusive)) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeDetail();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeDetail, exclusive, isOverlay, open]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (inlineCloseTimerRef.current) clearTimeout(inlineCloseTimerRef.current);
    if (exclusiveCloseTimerRef.current) clearTimeout(exclusiveCloseTimerRef.current);
    if (overlayCloseTimerRef.current) clearTimeout(overlayCloseTimerRef.current);
    if (exclusiveFrameRef.current) cancelAnimationFrame(exclusiveFrameRef.current);
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
  }, []);

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
    const requestedWidth = bounds.right - clientX;
    commitWidth(requestedWidth);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeFromClientX(event.clientX);
  };

  const onPointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    resizeFromClientX(event.clientX);
  };

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); commitWidth(constrainedWidth + step); }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      commitWidth(constrainedWidth - step);
    }
    if (event.key === "Home") { event.preventDefault(); commitWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); commitWidth(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)); }
  };

  const mainWidth = isInline ? `calc(100% - ${constrainedWidth + 1}px)` : "100%";
  return <div ref={containerRef} className={cn("relative flex h-full min-h-0 min-w-0", className)}>
    <div className={cn("t-resize min-h-0 min-w-0 shrink-0 overflow-hidden", (exclusive || isOverlay) && "pointer-events-none")} style={{ width: mainWidth }} aria-hidden={exclusive || isOverlay}>{children}</div>
    {exclusiveMounted && <section aria-hidden={!exclusiveVisible} className={cn("absolute inset-0 z-10 flex min-h-0 min-w-0 overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none", exclusiveVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}>
      <div aria-hidden="true" className={cn("absolute inset-0 bg-black/10 transition-opacity duration-200 ease-out motion-reduce:transition-none", exclusiveVisible ? "opacity-100" : "opacity-0")} />
      <div className={cn("t-modal absolute inset-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-2xl md:inset-6 lg:inset-8", exclusiveVisible ? "is-open" : "is-closing")}>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"><div className={cn("mx-auto w-full", contentWidthClassName[contentWidth] || contentWidthClassName.standard)}>{detail}</div></div>
      </div>
    </section>}
    {inlineMounted && <div className="t-resize relative flex min-h-0 shrink-0 overflow-visible border-l border-border" style={{ width: inlineVisible ? constrainedWidth + 1 : 0 }}>
      <div role="separator" aria-orientation="vertical" aria-label="调整详情面板宽度" aria-valuemin={MIN_DETAIL_WIDTH} aria-valuemax={maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)} aria-valuenow={constrainedWidth} tabIndex={0} className={cn("absolute inset-y-0 -left-2 z-10 w-4 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-200 after:ease-linear hover:after:bg-sidebar-border focus-visible:after:bg-ring", !inlineVisible && "pointer-events-none opacity-0")} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={onKeyDown} />
      <div className="t-resize min-h-0 shrink-0 overflow-hidden" style={{ width: inlineVisible ? constrainedWidth : 0 }}>
        <aside className={cn("min-h-0 shrink-0 overflow-y-auto bg-background transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none", !inlineVisible && "pointer-events-none translate-x-2 opacity-0")} style={{ width: constrainedWidth }}>{detail}</aside>
      </div>
    </div>}
    {overlayMounted && <section role="region" aria-label="详情页面" aria-hidden={!overlayVisible} className={cn("absolute inset-0 z-10 min-h-0 min-w-0 overflow-y-auto bg-background transition-transform duration-200 ease-out motion-reduce:transition-none", overlayVisible ? "translate-x-0" : "pointer-events-none translate-x-4")}>
      <div className="min-h-full p-4 md:p-6"><div className={cn("mx-auto w-full", contentWidthClassName[contentWidth] || contentWidthClassName.standard)}>{detail}</div></div>
    </section>}
  </div>;
}
