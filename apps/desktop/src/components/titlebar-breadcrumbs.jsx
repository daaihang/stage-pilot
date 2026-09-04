import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

const TEXT_SWAP_DURATION = 150;
const TITLEBAR_SAFE_GAP = 12;

function useTextSwap(target) {
  const [state, setState] = useState({ value: target, phase: "idle" });
  const stateRef = useRef(state);
  const timerRef = useRef(null);
  const frameRefs = useRef([]);

  const cancelPending = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    frameRefs.current.forEach((frame) => window.cancelAnimationFrame(frame));
    frameRefs.current = [];
  };

  const commit = (next) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    cancelPending();
    const current = stateRef.current;
    if (target === current.value) {
      if (current.phase !== "idle") commit({ value: target, phase: "idle" });
      return undefined;
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      commit({ value: target, phase: "idle" });
      return undefined;
    }

    commit({ value: current.value, phase: "exit" });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commit({ value: target, phase: "enter-start" });
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(() => {
          frameRefs.current = [];
          commit({ value: target, phase: "idle" });
        });
        frameRefs.current = [secondFrame];
      });
      frameRefs.current = [firstFrame];
    }, TEXT_SWAP_DURATION);

    return () => {
      cancelPending();
    };
  }, [target]);

  return state;
}

function useTitlebarSafeArea(rootRef) {
  const [safeArea, setSafeArea] = useState({ left: TITLEBAR_SAFE_GAP, right: TITLEBAR_SAFE_GAP, width: 0 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root?.parentElement;
    if (!header) return undefined;

    const update = () => {
      const headerRect = header.getBoundingClientRect();
      const leftRect = root.previousElementSibling?.getBoundingClientRect();
      const spacerRect = root.nextElementSibling?.getBoundingClientRect();
      const left = Math.max(TITLEBAR_SAFE_GAP, (leftRect?.right || headerRect.left) - headerRect.left + TITLEBAR_SAFE_GAP);
      const right = Math.max(TITLEBAR_SAFE_GAP, headerRect.right - (spacerRect?.right || headerRect.right) + TITLEBAR_SAFE_GAP);
      const width = Math.max(0, headerRect.width - left - right);
      setSafeArea((current) => current.left === left && current.right === right && current.width === width ? current : { left, right, width });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    if (root.previousElementSibling) observer.observe(root.previousElementSibling);
    if (root.nextElementSibling) observer.observe(root.nextElementSibling);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rootRef]);

  return safeArea;
}

export function TitlebarBreadcrumbs({ items = [], title, showTitle = true }) {
  const rootRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = (hovered || focused) && items.length > 0;
  const collapsedLabel = showTitle ? title : "";
  const safeArea = useTitlebarSafeArea(rootRef);
  const swap = useTextSwap(expanded);
  const swapClassName = (isExpanded) => cn(
    "t-text-swap",
    swap.value === isExpanded ? "" : "t-text-swap-hidden",
    swap.value === isExpanded && swap.phase === "exit" && "is-exit",
    swap.value === isExpanded && swap.phase === "enter-start" && "is-enter-start",
  );
  const compactItems = safeArea.width > 0 && safeArea.width < 460 && items.length > 2;
  const visibleItems = compactItems ? [items[0], { ellipsis: true, label: "更多路径" }, items[items.length - 1]] : items;
  const labelMaxWidth = safeArea.width > 0 ? Math.max(48, Math.floor((safeArea.width - (visibleItems.length - 1) * 28) / Math.max(visibleItems.length, 1))) : 220;

  return (
    <div
      ref={rootRef}
      className="titlebar-breadcrumbs pointer-events-none absolute inset-y-0 z-10 flex h-full min-w-0 items-center justify-center"
      style={{ "--titlebar-breadcrumb-max": `${labelMaxWidth}px`, "--titlebar-safe-left": `${safeArea.left}px`, "--titlebar-safe-right": `${safeArea.right}px` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClickCapture={() => {
        setHovered(false);
        setFocused(false);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.blur();
          setFocused(false);
        }
      }}
      aria-label="当前页面路径"
    >
      <div className="relative flex w-full min-w-0 max-w-[900px] items-center justify-center">
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 flex h-6 max-w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden whitespace-nowrap",
          )}
          aria-hidden={swap.value || !collapsedLabel}
        >
          <span className={cn("titlebar-breadcrumb-label px-1 text-xs font-medium", swapClassName(false))}>{collapsedLabel}</span>
        </div>
        <div
          className={cn(
            "pointer-events-auto flex h-6 max-w-full items-center justify-center overflow-hidden whitespace-nowrap",
          )}
          aria-hidden={!swap.value}
        >
          <div className={cn(swapClassName(true), swap.value !== true && "pointer-events-none")}>
            <Breadcrumb>
              <BreadcrumbList className="titlebar-breadcrumb-list">
              {visibleItems.map((item, index) => (
                <Fragment key={`${item.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {item.ellipsis ? (
                      <BreadcrumbEllipsis />
                    ) : item.current || !item.to ? (
                      <BreadcrumbPage className="titlebar-breadcrumb-label">{item.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={item.to} />} className="titlebar-breadcrumb-label">
                        {item.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>
      </div>
    </div>
  );
}
