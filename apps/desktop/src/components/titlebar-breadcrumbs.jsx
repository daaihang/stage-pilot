import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

const TEXT_SWAP_DURATION = 150;

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

export function TitlebarBreadcrumbs({ items = [], title, showTitle = true }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = (hovered || focused) && items.length > 0;
  const collapsedLabel = showTitle ? title : "";
  const swap = useTextSwap(expanded);
  const swapClassName = (isExpanded) => cn(
    "t-text-swap",
    swap.value === isExpanded ? "" : "t-text-swap-hidden",
    swap.value === isExpanded && swap.phase === "exit" && "is-exit",
    swap.value === isExpanded && swap.phase === "enter-start" && "is-enter-start",
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex h-full items-center justify-center"
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
      <div className="relative flex min-w-0 max-w-[min(78vw,900px)] items-center justify-center">
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 flex h-6 max-w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden whitespace-nowrap",
          )}
          aria-hidden={swap.value || !collapsedLabel}
        >
          <span className={cn("max-w-[min(40vw,320px)] truncate px-1 text-xs font-medium", swapClassName(false))}>{collapsedLabel}</span>
        </div>
        <div
          className={cn(
            "pointer-events-auto flex h-6 max-w-full items-center justify-center overflow-hidden whitespace-nowrap",
          )}
          aria-hidden={!swap.value}
        >
          <div className={cn(swapClassName(true), swap.value !== true && "pointer-events-none")}>
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap whitespace-nowrap">
              {items.map((item, index) => (
                <Fragment key={`${item.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {item.current || !item.to ? (
                      <BreadcrumbPage className="max-w-[min(20vw,220px)] truncate">{item.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={item.to} />} className="max-w-[min(20vw,220px)] truncate">
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
