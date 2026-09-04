import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { appStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";

const SETTINGS_TABS_MEDIA_QUERY = "(min-width: 1024px)";
export const CATEGORY_TABS_STICKY_STORE_KEY = "categoryTabsSticky:v1";

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
  const orientation = useSettingsTabsOrientation();
  const [tabsListRef, scrollState] = useHorizontalScrollIndicators(orientation === "horizontal");
  const preference = useCategoryTabsPreference();
  const shouldPin = pinned ?? sticky ?? preference.pinned;

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
      <div className={cn(
        "relative w-full min-w-0 lg:h-fit",
        shouldPin && "sticky top-0 z-20 self-start bg-background/95 py-1 backdrop-blur-sm",
      )}>
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

// Compatibility export: existing role, file-type, workspace and production
// settings pages can migrate independently without changing their layout API.
export const SettingsTabs = SectionTabsLayout;
