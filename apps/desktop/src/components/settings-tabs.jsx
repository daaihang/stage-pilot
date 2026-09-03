import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const SETTINGS_TABS_MEDIA_QUERY = "(min-width: 1024px)";

function useSettingsTabsOrientation() {
  const [isWide, setIsWide] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(SETTINGS_TABS_MEDIA_QUERY).matches
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia(SETTINGS_TABS_MEDIA_QUERY);
    const onChange = () => setIsWide(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return isWide ? "vertical" : "horizontal";
}

function useHorizontalScrollIndicators(enabled) {
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const threshold = 1;
    const nextState = {
      canScrollLeft: element.scrollLeft > threshold,
      canScrollRight: element.scrollWidth - element.clientWidth - element.scrollLeft > threshold,
    };
    setScrollState((current) => (
      current.canScrollLeft === nextState.canScrollLeft && current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState
    ));
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !enabled) {
      setScrollState({ canScrollLeft: false, canScrollRight: false });
      return undefined;
    }

    updateScrollState();
    element.addEventListener("scroll", updateScrollState, { passive: true });
    const onWheel = (event) => {
      if (event.ctrlKey) return;

      const delta = event.deltaX || event.deltaY;
      if (!delta) return;

      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, element.scrollLeft + delta * unit));

      if (nextScrollLeft === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = nextScrollLeft;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState);
    observer?.observe(element);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(updateScrollState);
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true });

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      element.removeEventListener("wheel", onWheel);
      observer?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [enabled, updateScrollState]);

  return [scrollRef, scrollState];
}

export function SettingsTabs({
  groups,
  activeGroup,
  onGroupChange,
  disabled = false,
  children,
  ariaLabel = "设置分类",
  className,
}) {
  const orientation = useSettingsTabsOrientation();
  const [tabsListRef, scrollState] = useHorizontalScrollIndicators(orientation === "horizontal");

  return (
    <Tabs
      value={activeGroup}
      onValueChange={(value) => {
        if (value != null) onGroupChange(value);
      }}
      orientation={orientation}
      className={cn(
        "w-full items-start gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]",
        disabled && "opacity-50 blur-[1px]",
        className,
      )}
      aria-disabled={disabled}
    >
      <div className="relative w-full min-w-0 lg:h-fit">
        <TabsList
          ref={tabsListRef}
          aria-label={ariaLabel}
          className="w-full min-w-0 justify-start overflow-x-auto overflow-y-hidden scrollbar-none lg:h-fit lg:w-full lg:flex-col lg:items-stretch lg:overflow-visible"
        >
          {groups.map(([id, label, Icon]) => (
            <TabsTrigger key={id} value={id} disabled={disabled} className="max-lg:min-w-28">
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {orientation === "horizontal" && scrollState.canScrollLeft && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-muted via-muted/80 to-transparent" />
        )}
        {orientation === "horizontal" && scrollState.canScrollRight && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-muted via-muted/80 to-transparent" />
        )}
      </div>
      <TabsContent value={activeGroup} className="w-full min-w-0">
        {children}
      </TabsContent>
    </Tabs>
  );
}
