import { useState } from "react";
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

export function TitlebarBreadcrumbs({ items = [], title, showTitle = true }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = (hovered || focused) && items.length > 0;
  const collapsedLabel = showTitle ? title : "";

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
            "pointer-events-none absolute left-1/2 top-1/2 flex h-6 max-w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden whitespace-nowrap transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            expanded ? "translate-y-[calc(-50%-2px)] opacity-0" : "translate-y-[-50%] opacity-100",
          )}
          aria-hidden={expanded || !collapsedLabel}
        >
          <span className="max-w-[min(40vw,320px)] truncate px-1 text-xs font-medium">{collapsedLabel}</span>
        </div>
        <div
          className={cn(
            "pointer-events-auto flex h-6 max-w-full items-center justify-center overflow-hidden whitespace-nowrap transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            expanded ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          )}
          aria-hidden={!expanded}
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
