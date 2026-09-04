import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { usePageChrome } from "@/components/page-chrome";

const MIN_DETAIL_WIDTH = 280;
const DEFAULT_DETAIL_WIDTH = 420;
const MIN_MAIN_WIDTH = 320;
const EXCLUSIVE_ENTER_WIDTH = 360;
const EXCLUSIVE_EXIT_WIDTH = 360;
const INLINE_MIN_WIDTH = 960;
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
  const wasOpenRef = useRef(open);
  const [containerWidth, setContainerWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const [inlineMounted, setInlineMounted] = useState(false);
  const [inlineVisible, setInlineVisible] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const { setDetailAction } = usePageChrome();

  const canInline = open && containerWidth >= INLINE_MIN_WIDTH;
  const isInline = canInline && !exclusive;
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
    if ((!open || !canInline) && exclusive) setExclusive(false);
  }, [canInline, exclusive, open]);

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
    if (inlineMounted) inlineCloseTimerRef.current = setTimeout(() => setInlineMounted(false), 180);
    return undefined;
  }, [inlineMounted, isInline]);

  useEffect(() => {
    if (!open) {
      setDetailAction(null);
      return undefined;
    }
    setDetailAction({
      label: "关闭详情",
      exclusive,
      onClose: () => { setExclusive(false); onOpenChange(false); },
      onToggleExclusive: canInline ? () => {
        const next = !exclusive;
        setExclusive(next);
        notify.info(next ? "详情已独占工作区" : "已退出独占详情");
      } : undefined,
    });
    return () => setDetailAction(null);
  }, [canInline, exclusive, onOpenChange, open, setDetailAction]);

  useEffect(() => {
    if (wasOpenRef.current && !open) requestAnimationFrame(() => triggerRef?.current?.focus?.());
    wasOpenRef.current = open;
  }, [open, triggerRef]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (inlineCloseTimerRef.current) clearTimeout(inlineCloseTimerRef.current);
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
    if (requestedWidth >= bounds.width - EXCLUSIVE_ENTER_WIDTH) {
      commitWidth(maxDetailWidth(bounds.width));
      if (!exclusive) {
        setExclusive(true);
        notify.info("详情已独占工作区");
      }
      return;
    }
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

  const onExclusivePointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const closeDetail = () => { setExclusive(false); onOpenChange(false); };
  const onExclusivePointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || event.clientX - bounds.left < EXCLUSIVE_EXIT_WIDTH) return;
    closeDetail();
  };

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); commitWidth(constrainedWidth + step); }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (constrainedWidth - step < MIN_DETAIL_WIDTH) closeDetail();
      else commitWidth(constrainedWidth - step);
    }
    if (event.key === "Home") { event.preventDefault(); commitWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); commitWidth(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)); }
  };

  const onExclusiveKeyDown = (event) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    closeDetail();
  };

  const mainWidth = isInline ? `calc(100% - ${constrainedWidth + 1}px)` : "100%";
  return <div ref={containerRef} className={cn("relative flex h-full min-h-0 min-w-0", className)}>
    <div className={cn("min-h-0 min-w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none", exclusive && "hidden")} style={{ width: exclusive ? 0 : mainWidth }} aria-hidden={exclusive}>{children}</div>
    {exclusive && <section className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200">
      <div role="separator" aria-orientation="vertical" aria-label="向右拖动以退出独占详情" tabIndex={0} className="absolute inset-y-0 left-0 z-10 w-px cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20" onPointerDown={onExclusivePointerDown} onPointerMove={onExclusivePointerMove} onKeyDown={onExclusiveKeyDown} />
      <div className="min-h-full p-4 md:p-6"><div className={cn("mx-auto w-full", contentWidthClassName[contentWidth] || contentWidthClassName.standard)}>{detail}</div></div>
    </section>}
    {inlineMounted && <div className="flex min-h-0 shrink-0 overflow-hidden border-l border-border transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: inlineVisible ? constrainedWidth + 1 : 0 }}>
      <div role="separator" aria-orientation="vertical" aria-label="调整详情面板宽度" aria-valuemin={MIN_DETAIL_WIDTH} aria-valuemax={maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)} aria-valuenow={constrainedWidth} tabIndex={0} className={cn("relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20", !inlineVisible && "pointer-events-none opacity-0")} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={onKeyDown} />
      <aside className={cn("min-h-0 shrink-0 overflow-y-auto bg-background transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none", !inlineVisible && "pointer-events-none translate-x-2 opacity-0")} style={{ width: constrainedWidth }}>{detail}</aside>
    </div>}
    {open && !canInline && <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" overlayClassName="top-[var(--app-titlebar-height)] bottom-0" className="top-[var(--app-titlebar-height)] bottom-0 h-auto w-full max-w-none overflow-y-auto border-l shadow-none sm:w-[min(30rem,100vw)] sm:max-w-none" showCloseButton={false}>
        <SheetHeader className="sr-only"><SheetTitle>详情面板</SheetTitle><SheetDescription>当前选中内容的详情。</SheetDescription></SheetHeader>
        {detail}
      </SheetContent>
    </Sheet>}
  </div>;
}
