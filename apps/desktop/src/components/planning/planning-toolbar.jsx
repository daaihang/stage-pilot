import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanningViewSwitcher } from "@/components/planning/planning-view-switcher";

export function PlanningToolbar({ title, query, onQueryChange, views, view, onViewChange }) {
  return <div className="flex flex-col gap-3 border-y py-3 xl:flex-row xl:items-center">
    <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索${title}…`} className="pl-8" aria-label={`搜索${title}`} /></div>
    <Button variant="outline" disabled><SlidersHorizontal className="size-3.5" />筛选</Button>
    <div className="xl:ml-auto"><PlanningViewSwitcher views={views} value={view} onValueChange={onViewChange} /></div>
  </div>;
}
