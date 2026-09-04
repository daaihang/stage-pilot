import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { StageResizableGroup, StageResizableHandle, StageResizablePanel } from "@/components/ui/resizable";
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

function maxDetailWidth(containerWidth) { return Math.max(MIN_DETAIL_WIDTH, Math.floor(containerWidth - MIN_MAIN_WIDTH)); }
function clampDetailWidth(width, containerWidth) { return Math.min(maxDetailWidth(containerWidth), Math.max(MIN_DETAIL_WIDTH, Math.round(width))); }

export function DetailSplitPane({ children, detail, open, onOpenChange, storageKey, triggerRef, onDetailWidthChange, onPresentationChange, contentWidth = "standard", className }) {
  const containerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const wasOpenRef = useRef(open);
  const [containerWidth, setContainerWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const [exclusive, setExclusive] = useState(false);
  const { setDetailAction } = usePageChrome();
  const canInline = containerWidth >= INLINE_MIN_WIDTH;
  const isInline = open && canInline && !exclusive;
  const constrainedWidth = clampDetailWidth(detailWidth, containerWidth || INLINE_MIN_WIDTH);
  const defaultDetailPercentage = containerWidth ? (constrainedWidth / containerWidth) * 100 : 40;

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

  useEffect(() => {
    if (open && containerWidth > 0 && !canInline) setExclusive(true);
  }, [canInline, containerWidth, open]);
  useEffect(() => { onDetailWidthChange?.(constrainedWidth); }, [constrainedWidth, onDetailWidthChange]);
  useEffect(() => { if (open) onPresentationChange?.(exclusive ? "exclusive" : isInline ? "inline" : "overlay"); }, [exclusive, isInline, onPresentationChange, open]);

  useEffect(() => {
    if (!open) { setDetailAction(null); return undefined; }
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
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const persistWidth = (nextWidth) => {
    if (!storageKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { appStore.set(storageKey, nextWidth).catch(() => {}); }, 150);
  };
  const commitWidth = (nextWidth) => {
    const next = clampDetailWidth(nextWidth, containerWidth || INLINE_MIN_WIDTH);
    setDetailWidth(next);
    persistWidth(next);
    onDetailWidthChange?.(next);
  };
  const closeDetail = () => { setExclusive(false); onOpenChange(false); notify.info("右侧详情已关闭"); };
  const handleLayout = (layout) => {
    if (!isInline || !Array.isArray(layout) || layout.length < 2 || !containerWidth) return;
    const nextWidth = (layout[1] / 100) * containerWidth;
    if (nextWidth < MIN_DETAIL_WIDTH) return;
    commitWidth(nextWidth);
  };
  const handleHandleKeyDown = (event) => {
    if (!isInline) return;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); commitWidth(constrainedWidth + step); }
    if (event.key === "ArrowRight") { event.preventDefault(); if (constrainedWidth - step < MIN_DETAIL_WIDTH) closeDetail(); else commitWidth(constrainedWidth - step); }
    if (event.key === "Home") { event.preventDefault(); commitWidth(MIN_DETAIL_WIDTH); }
    if (event.key === "End") { event.preventDefault(); commitWidth(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH)); }
  };
  const handleExclusiveKeyDown = (event) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    if (canInline) { setExclusive(false); notify.info("已退出独占详情"); } else closeDetail();
  };

  return <div ref={containerRef} className={cn("relative flex h-full min-h-0 min-w-0", className)}>
    {exclusive && <section className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200">
      <div role="separator" aria-orientation="vertical" aria-label="向右拖动以退出独占详情" tabIndex={0} className="absolute inset-y-0 left-0 z-10 w-px cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-left-2 before:w-4 focus-visible:bg-ring focus-visible:before:bg-ring/20" onKeyDown={handleExclusiveKeyDown} />
      <div className="min-h-full p-4 md:p-6"><div className={cn("mx-auto w-full", contentWidthClassName[contentWidth] || contentWidthClassName.standard)}>{detail}</div></div>
    </section>}
    {!exclusive && <StageResizableGroup orientation="horizontal" className={cn("min-h-0", !isInline && "hidden")} onLayout={handleLayout}>
      <StageResizablePanel defaultSize={100 - defaultDetailPercentage} minSize={(MIN_MAIN_WIDTH / Math.max(containerWidth, INLINE_MIN_WIDTH)) * 100}>{children}</StageResizablePanel>
      <StageResizableHandle withHandle onKeyDown={handleHandleKeyDown} aria-label="调整详情面板宽度" />
      <StageResizablePanel defaultSize={defaultDetailPercentage} minSize={(MIN_DETAIL_WIDTH / Math.max(containerWidth, INLINE_MIN_WIDTH)) * 100} maxSize={(maxDetailWidth(containerWidth || INLINE_MIN_WIDTH) / Math.max(containerWidth, INLINE_MIN_WIDTH)) * 100}>{detail}</StageResizablePanel>
    </StageResizableGroup>}
  </div>;
}
