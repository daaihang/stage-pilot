import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ClipboardList, ListTree } from "lucide-react";
import { PageBreadcrumbs } from "@/components/stagepilot-pages";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { PlanningEmptyState } from "@/components/planning/planning-empty-state";
import { PlanningToolbar } from "@/components/planning/planning-toolbar";
import { StagePilotEventCalendar } from "@/components/reui/event-calendar/stagepilot-event-calendar";
import { Card, CardContent } from "@/components/ui/card";
import { appStore } from "@/lib/app-store";

const pageConfig = {
  schedule: { title: "总日程", views: [{ id: "list", label: "列表" }, { id: "calendar", label: "日历" }, { id: "timeline", label: "时间轴" }], defaultView: "calendar", icon: CalendarRange, emptyTitle: "暂无排程安排", emptyDescription: "后续可以在这里管理装台、彩排、演出和撤台等时间。" },
  occurrences: { title: "场次", views: [{ id: "list", label: "列表" }, { id: "grid", label: "网格" }, { id: "calendar", label: "日历" }], defaultView: "list", icon: ListTree, emptyTitle: "暂无场次安排", emptyDescription: "场次数据接入后，正式演出、预演和加演场会显示在这里。" },
  rehearsals: { title: "彩排", views: [{ id: "calendar", label: "日历" }, { id: "agenda", label: "议程" }], defaultView: "calendar", icon: ClipboardList, emptyTitle: "暂无彩排安排", emptyDescription: "彩排、技术彩排和带妆彩排接入后，会显示在这里。" },
};

const viewStoreKey = (productionId, page) => `planningView:${productionId}:${page}`;

function TimelineEmpty({ config }) {
  return <Card className="border-dashed"><CardContent className="flex min-h-72 items-center justify-center px-6 text-center"><div><p className="font-medium">{config.emptyTitle}</p><p className="mt-1 text-sm text-muted-foreground">时间轴数据接入后会显示制作阶段和时间安排。</p></div></CardContent></Card>;
}

export function PlanningPage({ route, workspace, production }) {
  const config = pageConfig[route.page] || pageConfig.schedule;
  const [view, setView] = useState(config.defaultView);
  const [query, setQuery] = useState("");
  const validViews = useMemo(() => new Set(config.views.map((item) => item.id)), [config.views]);

  useEffect(() => {
    let active = true;
    appStore.get(viewStoreKey(production.id, route.page)).then((stored) => {
      if (active && validViews.has(stored)) setView(stored);
    }).catch(() => {});
    return () => { active = false; };
  }, [production.id, route.page, validViews]);

  const changeView = (nextView) => {
    if (!validViews.has(nextView)) return;
    setView(nextView);
    appStore.set(viewStoreKey(production.id, route.page), nextView).catch(() => {});
  };

  const empty = <PlanningEmptyState icon={config.icon} title={config.emptyTitle} description={config.emptyDescription} />;
  return <div className="space-y-5">
    <PageBreadcrumbs route={route} workspace={workspace} production={production} />
    <ProductionPageHeader workspace={workspace} production={production} title={config.title} subtitle={route.meta.description} />
    <PlanningToolbar title={config.title} query={query} onQueryChange={setQuery} views={config.views} view={view} onViewChange={changeView} />
    {view === "calendar" && <div className="space-y-4"><StagePilotEventCalendar defaultView="month" /><div>{empty}</div></div>}
    {view === "list" && empty}
    {view === "grid" && empty}
    {view === "agenda" && empty}
    {view === "timeline" && <TimelineEmpty config={config} />}
  </div>;
}
