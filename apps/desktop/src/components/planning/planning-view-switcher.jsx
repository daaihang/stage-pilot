import { CalendarDays, GanttChartSquare, LayoutGrid, LayoutList } from "@/components/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const viewIcons = { list: LayoutList, grid: LayoutGrid, calendar: CalendarDays, timeline: GanttChartSquare, agenda: LayoutList };

export function PlanningViewSwitcher({ views, value, onValueChange }) {
  return <Tabs value={value} onValueChange={onValueChange}><TabsList>{views.map((view) => {
    const Icon = viewIcons[view.id] || LayoutList;
    return <TabsTrigger key={view.id} value={view.id}><Icon className="size-3.5" />{view.label}</TabsTrigger>;
  })}</TabsList></Tabs>;
}
