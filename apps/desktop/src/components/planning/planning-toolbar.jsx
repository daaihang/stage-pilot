import { Search, SlidersHorizontal } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanningViewSwitcher } from "@/components/planning/planning-view-switcher";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlanningToolbar({ title, query, onQueryChange, views, view, onViewChange, status = "all", onStatusChange }) {
  return <div className="flex flex-col gap-3 border-y py-3 xl:flex-row xl:items-center">
    <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索${title}…`} className="pl-8" aria-label={`搜索${title}`} /></div>
    {onStatusChange ? <Select items={[{ value: "all", label: "全部状态" }, { value: "planned", label: "计划中" }, { value: "live", label: "进行中" }, { value: "completed", label: "已结束" }, { value: "canceled", label: "已取消" }]} value={status} onValueChange={onStatusChange}><SelectTrigger className="w-28"><SlidersHorizontal className="size-3.5" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="planned">计划中</SelectItem><SelectItem value="live">进行中</SelectItem><SelectItem value="completed">已结束</SelectItem><SelectItem value="canceled">已取消</SelectItem></SelectContent></Select> : <Button variant="outline"><SlidersHorizontal className="size-3.5" />筛选</Button>}
    <div className="xl:ml-auto"><PlanningViewSwitcher views={views} value={view} onValueChange={onViewChange} /></div>
  </div>;
}
