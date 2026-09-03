import { useEffect, useState } from "react";
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
      <TabsList
        aria-label={ariaLabel}
        className="w-full min-w-0 justify-start overflow-x-auto lg:h-fit lg:w-full lg:flex-col lg:items-stretch lg:overflow-visible"
      >
        {groups.map(([id, label, Icon]) => (
          <TabsTrigger key={id} value={id} disabled={disabled}>
            <Icon className="size-4" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={activeGroup} className="w-full min-w-0">
        {children}
      </TabsContent>
    </Tabs>
  );
}
