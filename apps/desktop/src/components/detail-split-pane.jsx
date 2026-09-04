import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { usePageChrome } from "@/components/page-chrome";

const MIN_DETAIL_WIDTH = 320;
const DEFAULT_DETAIL_WIDTH = 420;
const MAX_DETAIL_WIDTH = 560;
const MIN_MAIN_WIDTH = 640;
const INLINE_MIN_WIDTH = MIN_DETAIL_WIDTH + MIN_MAIN_WIDTH;

function clampDetailWidth(width, containerWidth) {
  const maximum = Math.min(MAX_DETAIL_WIDTH, Math.floor(containerWidth * 0.45), containerWidth - MIN_MAIN_WIDTH);
  if (maximum < MIN_DETAIL_WIDTH) return MIN_DETAIL_WIDTH;
  return Math.min(maximum, Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
}

/**
 * A reusable, full-height master/detail workspace. On narrow containers it
 * keeps the main surface usable by presenting the same detail as a Sheet.
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
  className,
}) {
  const containerRef = useRef(null);
  const splitterRef = useRef(null);
  const saveTimerRef = useRef(null);
  const inlineCloseTimerRef = useRef(null);
  const wasOpenRef = useRef(open);
  const [containerWidth, setContainerWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const [inlineMounted, setInlineMounted] = useState(false);
  const [inlineVisible, setInlineVisible] = useState(false);
  const { setDetailAction } = usePageChrome();

  const isInline = open && containerWidth >= INLINE_MIN_WIDTH;
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
      } catch {
        // A layout preference must never prevent the workspace from rendering.
      }
    };
    if (storageKey) void load();
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    onDetailWidthChange?.(constrainedWidth);
  }, [constrainedWidth, onDetailWidthChange]);

  useEffect(() => {
    if (open) onPresentationChange?.(isInline ? "inline" : "overlay");
  }, [isInline, onPresentationChange, open]);

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
    setDetailAction({ label: "关闭详情", onClose: () => onOpenChange(false) });
    return () => setDetailAction(null);
  }, [onOpenChange, open, setDetailAction]);

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
    saveTimerRef.current = setTimeout(() => {
      appStore.set(storageKey, next).catch(() => {});
    }, 150);
  };

  const resizeFromClientX = (clientX) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setWidth(bounds.right - clientX);
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
    if (event.key === "ArrowLeft") { event.preventDefault(); setWidth(constrainedWidth + step); }
    if (event.key === "ArrowRight") { event.preventDefault(); setWidth(constrainedWidth - step); }
    if (event.key === "Home") { event.preventDefault(); setWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); setWidth(MAX_DETAIL_WIDTH); }
  };

  return <div ref={containerRef} className={cn("relative flex h-full min-h-0 min-w-0", className)}>
    <div className="min-h-0 min-w-0 flex-1">{children}</div>
    {inlineMounted && <div className="flex min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: inlineVisible ? constrainedWidth + 1 : 0 }}>
      <div
        ref={splitterRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整详情面板宽度"
        aria-valuemin={MIN_DETAIL_WIDTH}
        aria-valuemax={Math.min(MAX_DETAIL_WIDTH, Math.floor(containerWidth * 0.45), containerWidth - MIN_MAIN_WIDTH)}
        aria-valuenow={constrainedWidth}
        tabIndex={0}
        className={cn("relative z-10 w-px shrink-0 cursor-col-resize bg-border opacity-100 outline-none transition-opacity duration-150 before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20 motion-reduce:transition-none", !inlineVisible && "pointer-events-none opacity-0")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      />
      <aside className={cn("min-h-0 shrink-0 overflow-y-auto bg-background opacity-100 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none", !inlineVisible && "pointer-events-none translate-x-2 opacity-0")} style={{ width: constrainedWidth }}>
        {detail}
      </aside>
    </div>}
    {open && !isInline && <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" overlayClassName="top-[var(--app-titlebar-height)] bottom-0" className="top-[var(--app-titlebar-height)] bottom-0 h-auto w-full max-w-none border-l shadow-none sm:w-[min(30rem,100vw)] sm:max-w-none" showCloseButton={false}>
        <SheetHeader className="sr-only"><SheetTitle>详情面板</SheetTitle><SheetDescription>当前选中内容的详情。</SheetDescription></SheetHeader>
        {detail}
      </SheetContent>
    </Sheet>}
  </div>;
}
