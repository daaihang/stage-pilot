import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { areTitlebarItemsEqual, normalizeTitlebarItems, resolveTitlebarDisplay } from "@/lib/titlebar-display";

const TEXT_SWAP_DURATION = 150;

function useTitlebarCenterWidth() {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [containerRef, width];
}

function useCanonicalBreadcrumbItems(items) {
  const candidate = normalizeTitlebarItems(items);
  const canonicalRef = useRef(candidate);

  if (!areTitlebarItemsEqual(canonicalRef.current, candidate)) {
    canonicalRef.current = candidate;
  }

  return canonicalRef.current;
}

function useTextSwap(value, active) {
  const [state, setState] = useState({ value, phase: "idle" });
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!active) {
      if (stateRef.current.value !== value || stateRef.current.phase !== "idle") {
        setState({ value, phase: "idle" });
      }
      return undefined;
    }

    if (stateRef.current.value === value) {
      return undefined;
    }

    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setState({ value, phase: "idle" });
      return undefined;
    }

    setState((current) => ({ ...current, phase: "exit" }));
    let frame = 0;
    let enterFrame = 0;
    const timer = window.setTimeout(() => {
      setState({ value, phase: "enter-start" });
      frame = window.requestAnimationFrame(() => {
        enterFrame = window.requestAnimationFrame(() => {
          setState({ value, phase: "idle" });
        });
      });
    }, TEXT_SWAP_DURATION);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(enterFrame);
    };
  }, [active, value]);

  return state;
}

function BreadcrumbPath({ items, maxLabelWidth }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="titlebar-breadcrumb-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${item.to ?? index}`}>
              <BreadcrumbItem>
                {item.to && !isLast ? (
                  <Link
                    className="titlebar-breadcrumb-label"
                    data-slot="breadcrumb-link"
                    style={{ "--titlebar-breadcrumb-max": maxLabelWidth }}
                    to={item.to}
                    title={item.label}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <BreadcrumbPage
                    className="titlebar-breadcrumb-label"
                    style={{ "--titlebar-breadcrumb-max": maxLabelWidth }}
                    title={item.label}
                  >
                    {item.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function TitlebarTextSwap({ active, value }) {
  const { value: displayedValue, phase } = useTextSwap(value, active);

  return (
    <span
      aria-hidden={active ? undefined : true}
      className={cn(
        "titlebar-title-surface pointer-events-none px-1 text-xs font-medium",
      )}
      data-slot="titlebar-title"
      data-active={active ? "true" : "false"}
    >
      <span
        className={cn(
          "t-text-swap",
          !active && "t-text-swap-hidden",
          active && phase === "exit" && "is-exit",
          active && phase === "enter-start" && "is-enter-start",
        )}
      >
        {displayedValue}
      </span>
    </span>
  );
}

export function TitlebarBreadcrumbs({
  items,
  pageHeaderVisible = true,
  showTitle = true,
  titlebarTitleMode = "page",
  pageTitle,
  appTitle = "StagePilot",
}) {
  const canonicalItems = useCanonicalBreadcrumbItems(items);
  const [expanded, setExpanded] = useState(false);
  const [centerRef, centerWidth] = useTitlebarCenterWidth();
  const display = resolveTitlebarDisplay({
    appTitle,
    expanded,
    items: canonicalItems,
    pageHeaderVisible,
    pageTitle,
    showTitle,
    titlebarTitleMode,
  });
  const breadcrumbActive = display.kind === "breadcrumb";
  const titleActive = display.kind === "title";
  const canFocusToExpand = canonicalItems.length > 0 && !breadcrumbActive;
  const maxLabelWidth = Math.max(72, Math.floor((centerWidth - Math.max(0, canonicalItems.length - 1) * 28) / Math.max(1, canonicalItems.length)));

  useEffect(() => {
    setExpanded(false);
  }, [pageHeaderVisible, pageTitle, titlebarTitleMode]);

  return (
    <div
      ref={centerRef}
      className="titlebar-breadcrumbs relative flex h-full min-w-0 flex-1 items-center justify-center"
      tabIndex={canFocusToExpand ? 0 : undefined}
      aria-label={canFocusToExpand ? "展开当前页面路径" : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setExpanded(false);
        }
      }}
      onFocus={() => {
        if (canFocusToExpand) {
          setExpanded(true);
        }
      }}
      onMouseEnter={() => {
        if (canonicalItems.length > 0) {
          setExpanded(true);
        }
      }}
      onMouseLeave={() => setExpanded(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setExpanded(false);
          event.currentTarget.blur();
        }
      }}
    >
      <div aria-hidden="true" className="absolute inset-0" data-tauri-drag-region />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-2">
        {canonicalItems.length > 0 && (
          <div
            aria-hidden={breadcrumbActive ? undefined : true}
            className={cn(
              "titlebar-breadcrumb-surface pointer-events-none min-w-0 max-w-full",
              !breadcrumbActive && "titlebar-breadcrumb-surface-hidden",
              breadcrumbActive && "[&_[data-slot=breadcrumb-link]]:pointer-events-auto",
            )}
            data-active={breadcrumbActive ? "true" : "false"}
            data-slot="titlebar-breadcrumb"
            inert={breadcrumbActive ? undefined : ""}
          >
            <BreadcrumbPath items={canonicalItems} maxLabelWidth={`${maxLabelWidth}px`} />
          </div>
        )}
        <TitlebarTextSwap active={titleActive} value={display.label} />
      </div>
    </div>
  );
}
