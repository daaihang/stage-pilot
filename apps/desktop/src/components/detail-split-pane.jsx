import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { usePageChrome } from "@/components/page-chrome";

const MIN_DETAIL_WIDTH = 320;
const DEFAULT_DETAIL_WIDTH = 420;
const MIN_MAIN_WIDTH = 560;
const EXCLUSIVE_ENTER_WIDTH = 360;
const EXCLUSIVE_EXIT_WIDTH = 360;
const INLINE_MIN_WIDTH = MIN_MAIN_WIDTH + MIN_DETAIL_WIDTH;
const contentWidthClassName = { standard: "max-w-6xl", wide: "max-w-7xl", full: "max-w-none" };

function maxDetailWidth(containerWidth) {
  return Math.max(MIN_DETAIL_WIDTH, Math.floor(containerWidth - MIN_MAIN_WIDTH));
}

function clampDetailWidth(width, containerWidth) {
  return Math.min(maxDetailWidth(containerWidth), Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
}

export function DetailSplitPane({ children, detail, open, onOpenChange, storageKey, triggerRef, onDetailWidthChange, onPresentationChange, contentWidth = "standard", className }) {
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

  const canInline = containerWidth >= INLINE_MIN_WIDTH;
  const isInline = open && canInline && !exclusive;
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
      try {
        await appStore.init?.();
        const stored = await appStore.get(storageKey);
        if (active && Number.isFinite(stored)) setDetailWidth(stored);
      } catch { /* layout preferences are non-critical */ }
    };
    if (storageKey) void load();
    return () => { active = false; };
  }, [storageKey]);

  // A narrow workspace cannot render two usable panes: opening detail is exclusive.
  useEffect(() => {
    if (open && containerWidth > 0 && !canInline) setExclusive(true);
  }, [canInline, containerWidth, open]);

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
      onToggleExclusive: () => setExclusive((current) => {
        const next = !current;
        if (next) notify.info("详情已独占工作区");
        else if (canInline) notify.info("已退出独占详情");
        else return current;
        return next;
      }),
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

  const setWidth = (nextWidth, { persist = true } = {}) => {
    const next = clampDetailWidth(nextWidth, containerWidth || INLINE_MIN_WIDTH);
    setDetailWidth(next);
    if (!persist || !storageKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { appStore.set(storageKey, next).catch(() => {}); }, 150);
  };

  const closeDetail = () => {
    setExclusive(false);
    onOpenChange(false);
    notify.info("右侧详情已关闭");
  };

  const resizeFromClientX = (clientX) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const mainWidth = clientX - bounds.left;
    const requestedWidth = bounds.right - clientX;
    if (mainWidth <= EXCLUSIVE_ENTER_WIDTH) {
      setExclusive(true);
      notify.info("详情已独占工作区");
      return;
    }
    if (requestedWidth < MIN_DETAIL_WIDTH) {
      closeDetail();
      return;
    }
    setWidth(requestedWidth);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeFromClientX(event.clientX);
  };
  const onPointerMove = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) resizeFromClientX(event.clientX);
  };
  const onExclusivePointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onExclusivePointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || event.clientX - bounds.left < EXCLUSIVE_EXIT_WIDTH) return;
    if (canInline) {
      setExclusive(false);
      notify.info("已退出独占详情");
    } else closeDetail();
  };
  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); resizeFromClientX((containerRef.current?.getBoundingClientRect().right ?? 0) - constrainedWidth - step); }
    if (event.key === "ArrowRight") { event.preventDefault(); resizeFromClientX((containerRef.current?.getBoundingClientRect().right ?? 0) - constrainedWidth + step); }
    if (event.key === "Home") { event.preventDefault(); setWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); setWidth(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)); }
  };

  return <div ref={containerRef} className={cn("relative flex h-full min-h-0 min-w-0", className)}>
    <div className={cn("min-h-0 min-w-0 flex-1", exclusive && "hidden")} aria-hidden={exclusive}>{children}</div>
    {exclusive && <section className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200">
      <div role="separator" aria-orientation="vertical" aria-label="向右拖动以退出独占详情" tabIndex={0} className="absolute inset-y-0 left-0 z-10 w-px cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20" onPointerDown={onExclusivePointerDown} onPointerMove={onExclusivePointerMove} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); if (canInline) { setExclusive(false); notify.info("已退出独占详情"); } else closeDetail(); } }} />
      <div className="min-h-full p-4 md:p-6"><div className={cn("mx-auto w-full", contentWidthClassName[contentWidth] || contentWidthClassName.standard)}>{detail}</div></div>
    </section>}
    {inlineMounted && <div className="flex min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: inlineVisible ? constrainedWidth + 1 : 0 }}>
      <div role="separator" aria-orientation="vertical" aria-label="调整详情面板宽度" aria-valuemin={MIN_DETAIL_WIDTH} aria-valuemax={maxDetailWidth(containerWidth)} aria-valuenow={constrainedWidth} tabIndex={0} className={cn("relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20", !inlineVisible && "pointer-events-none opacity-0")} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={onKeyDown} />
      <aside className={cn("min-h-0 shrink-0 overflow-y-auto bg-background", !inlineVisible && "pointer-events-none translate-x-2 opacity-0")} style={{ width: constrainedWidth }}>{detail}</aside>
    </div>}
  </div>;
}
