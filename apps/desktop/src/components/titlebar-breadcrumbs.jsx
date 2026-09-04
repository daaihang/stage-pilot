import { useEffect, useRef, useState } from "react";
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
  const timerRef = useRef(null);

  useEffect(() => {
    if (target === state.value) return undefined;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setState({ value: target, phase: "idle" });
      return undefined;
    }

    setState((current) => ({ ...current, phase: "exit" }));
    timerRef.current = window.setTimeout(() => {
      setState({ value: target, phase: "enter-start" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setState({ value: target, phase: "idle" }));
      });
    }, TEXT_SWAP_DURATION);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [state.value, target]);

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
            swapClassName(false),
          )}
          aria-hidden={swap.value || !collapsedLabel}
        >
          <span className="max-w-[min(40vw,320px)] truncate px-1 text-xs font-medium">{collapsedLabel}</span>
        </div>
        <div
          className={cn(
            "pointer-events-auto flex h-6 max-w-full items-center justify-center overflow-hidden whitespace-nowrap",
            swapClassName(true),
          )}
          aria-hidden={!swap.value}
        >
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap whitespace-nowrap">
              {items.map((item, index) => (
                <BreadcrumbItem key={`${item.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  {item.current || !item.to ? (
                    <BreadcrumbPage className="max-w-[min(20vw,220px)] truncate">{item.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link to={item.to} />} className="max-w-[min(20vw,220px)] truncate">
                      {item.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>
    </div>
  );
}
