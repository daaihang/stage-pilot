import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { normalizeTitlebarItems, resolveTitlebarDisplay } from "@/lib/titlebar-display";
import { cn } from "@/lib/utils";

function useTitlebarCenterWidth(rootRef) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const update = () => {
      const nextWidth = Math.round(root.getBoundingClientRect().width);
      setWidth((current) => current === nextWidth ? current : nextWidth);
    };

    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);

  return width;
}

function BreadcrumbPath({ items, labelMaxWidth }) {
  return <Breadcrumb className="min-w-0 max-w-full overflow-hidden">
    <BreadcrumbList className="titlebar-breadcrumb-list">
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 && <BreadcrumbSeparator />}
          <BreadcrumbItem>
            {item.current || !item.to ? (
              <BreadcrumbPage title={item.label} className="titlebar-breadcrumb-label" style={{ maxWidth: `${labelMaxWidth}px` }}>{item.label}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink render={<Link to={item.to} />} title={item.label} className="titlebar-breadcrumb-label" style={{ maxWidth: `${labelMaxWidth}px` }}>
                {item.label}
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        </Fragment>
      ))}
    </BreadcrumbList>
  </Breadcrumb>;
}

export function TitlebarBreadcrumbs({ items = [], title, showTitle = true, pageHeaderVisible = true, titlebarTitleMode = "page", appTitle = "StagePilot" }) {
  const rootRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const normalizedItems = normalizeTitlebarItems(items);
  const expanded = hovered || focused;
  const display = resolveTitlebarDisplay({
    pageHeaderVisible,
    showTitle,
    titlebarTitleMode,
    pageTitle: title,
    appTitle,
    items: normalizedItems,
    expanded,
  });
  const width = useTitlebarCenterWidth(rootRef);
  const labelMaxWidth = Math.max(48, Math.floor((Math.max(width, 220) - Math.max(0, normalizedItems.length - 1) * 24) / Math.max(normalizedItems.length, 1)));
  const canFocusToExpand = normalizedItems.length > 0 && display.kind !== "breadcrumb";

  return (
    <div
      ref={rootRef}
      data-slot="titlebar-center"
      className="relative min-w-8 flex-1 self-stretch overflow-hidden"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
      tabIndex={canFocusToExpand ? 0 : undefined}
      aria-label="当前页面路径"
    >
      <div className="absolute inset-0" data-tauri-drag-region aria-hidden="true" />
      <div
        className={cn(
          "titlebar-breadcrumbs pointer-events-none absolute inset-0 z-10 flex min-w-0 items-center justify-center overflow-hidden",
          display.kind === "breadcrumb" && "[&_[data-slot=breadcrumb-link]]:pointer-events-auto",
        )}
      >
        {display.kind === "breadcrumb" && <div className="pointer-events-none min-w-0 max-w-full"><BreadcrumbPath items={display.items} labelMaxWidth={labelMaxWidth} /></div>}
        {display.kind === "title" && <span className="titlebar-breadcrumb-label pointer-events-none px-1 text-xs font-medium">{display.label}</span>}
      </div>
    </div>
  );
}
