import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";
import { resolveSettingsTabsOrientation } from "@/lib/settings-tabs-layout";

export const CATEGORY_TABS_STICKY_STORE_KEY = "categoryTabsSticky:v1";

function useSettingsTabsOrientation(containerRef) {
  const [orientation, setOrientation] = useState("horizontal");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const update = () => setOrientation(resolveSettingsTabsOrientation(container.clientWidth));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    return () => observer?.disconnect();
  }, [containerRef]);

  return orientation;
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

function useVerticalScrollIndicators(enabled) {
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canScrollTop: false, canScrollBottom: false });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const threshold = 1;
    const nextState = {
      canScrollTop: element.scrollTop > threshold,
      canScrollBottom: element.scrollHeight - element.clientHeight - element.scrollTop > threshold,
    };
    setScrollState((current) => (
      current.canScrollTop === nextState.canScrollTop && current.canScrollBottom === nextState.canScrollBottom
        ? current
        : nextState
    ));
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !enabled) {
      setScrollState({ canScrollTop: false, canScrollBottom: false });
      return undefined;
    }

    updateScrollState();
    element.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState);
    observer?.observe(element);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(updateScrollState);
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true });

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      observer?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [enabled, updateScrollState]);

  return [scrollRef, scrollState];
}

export function useCategoryTabsPreference() {
  const [pinned, setPinnedState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.resolve(appStore.init?.())
      .then(() => appStore.get(CATEGORY_TABS_STICKY_STORE_KEY))
      .then((stored) => {
        if (active && typeof stored === "boolean") setPinnedState(stored);
      })
      .catch((error) => {
        if (active) notify.error("分类导航偏好加载失败", { description: error?.message || String(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const setPinned = useCallback(async (nextPinned) => {
    const next = Boolean(nextPinned);
    const previous = pinned;
    setPinnedState(next);
    try {
      await appStore.set(CATEGORY_TABS_STICKY_STORE_KEY, next);
      notify.success(next ? "分类导航已设置为置顶" : "分类导航已取消置顶");
    } catch (error) {
      setPinnedState(previous);
      notify.error("分类导航偏好保存失败", { description: error?.message || String(error) });
      throw error;
    }
  }, [pinned]);

  return { pinned, loading, setPinned };
}

export function SectionTabsLayout({
  groups,
  activeGroup,
  onGroupChange,
  disabled = false,
  children,
  ariaLabel = "设置分类",
  className,
  sticky,
  pinned,
}) {
  const containerRef = useRef(null);
  const orientation = useSettingsTabsOrientation(containerRef);
  const preference = useCategoryTabsPreference();
  const shouldPin = pinned ?? sticky ?? preference.pinned;
  const [tabsListRef, horizontalScrollState] = useHorizontalScrollIndicators(orientation === "horizontal");
  const [verticalTabsListRef, verticalScrollState] = useVerticalScrollIndicators(orientation === "vertical" && shouldPin);
  const activeTabsListRef = orientation === "horizontal" ? tabsListRef : verticalTabsListRef;

  useEffect(() => {
    if (orientation !== "vertical" || !shouldPin) return;
    const activeTab = Array.from(verticalTabsListRef.current?.querySelectorAll("[data-category-tab]") || [])
      .find((element) => element.dataset.categoryTab === activeGroup);
    activeTab?.scrollIntoView({ block: "nearest" });
  }, [activeGroup, orientation, shouldPin, verticalTabsListRef]);

  return (
    <div ref={containerRef} className="@container/settings-tabs min-w-0">
      <Tabs
        value={activeGroup}
        onValueChange={(value) => {
          if (value != null) onGroupChange(value);
        }}
        orientation={orientation}
        className={cn(
          "w-full items-start gap-6 @min-[56rem]/settings-tabs:grid @min-[56rem]/settings-tabs:grid-cols-[220px_minmax(0,1fr)]",
          disabled && "opacity-50 blur-[1px]",
          className,
        )}
        aria-disabled={disabled}
      >
        <div className={cn(
          "relative w-full min-w-0 @min-[56rem]/settings-tabs:h-fit",
          shouldPin && "sticky top-0 z-20 self-start bg-background/95 py-1 backdrop-blur-sm",
        )}>
          <TabsList
            ref={activeTabsListRef}
            aria-label={ariaLabel}
            className={cn(
              "w-full min-w-0 justify-start overflow-x-auto overflow-y-hidden scrollbar-none @min-[56rem]/settings-tabs:h-fit @min-[56rem]/settings-tabs:w-full @min-[56rem]/settings-tabs:flex-col @min-[56rem]/settings-tabs:items-stretch",
              shouldPin && orientation === "horizontal" && "shadow-[0_5px_12px_-8px_rgba(0,0,0,0.45)]",
              shouldPin && orientation === "vertical" && "max-h-[calc(100dvh-var(--app-titlebar-height)-2rem)] overflow-y-auto overflow-x-hidden scrollbar-thin",
              orientation === "vertical" && !shouldPin && "@min-[56rem]/settings-tabs:overflow-visible",
            )}
          >
            {groups.map(([id, label, Icon]) => (
              <TabsTrigger key={id} value={id} data-category-tab={id} disabled={disabled} className="min-w-28">
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {orientation === "horizontal" && horizontalScrollState.canScrollLeft && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-muted via-muted/80 to-transparent" />
          )}
          {orientation === "horizontal" && horizontalScrollState.canScrollRight && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-muted via-muted/80 to-transparent" />
          )}
          {orientation === "vertical" && shouldPin && verticalScrollState.canScrollTop && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1 z-10 h-5 bg-gradient-to-b from-background via-background/80 to-transparent" />
          )}
          {orientation === "vertical" && shouldPin && verticalScrollState.canScrollBottom && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-1 z-10 h-5 bg-gradient-to-t from-background via-background/80 to-transparent" />
          )}
        </div>
        <TabsContent value={activeGroup} className="w-full min-w-0">
          {children}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Compatibility export: existing role, file-type, workspace and production
// settings pages can migrate independently without changing their layout API.
export const SettingsTabs = SectionTabsLayout;
