import { LayoutGrid, LayoutList, Plus, Search, SlidersHorizontal, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// 卡片型页面使用统一的响应式列数：窄屏 1 列，sm 2 列，xl 3 列，2xl 4 列。
// 活动页和长期资源库共用该规则，避免各页在相同宽度下出现不同分栏。
export const resourceGridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export function ResourcePage({
  title,
  description,
  count,
  search,
  filters,
  view,
  onViewChange,
  onCreate,
  createLabel = "新建",
  headerActions,
  showViewToggle = true,
  loading,
  loadingContent,
  empty,
  summary,
  children,
}) {
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>
      <div className="flex shrink-0 items-center gap-2">{headerActions}{onCreate && <Button onClick={onCreate}><Plus />{createLabel}</Button>}</div>
    </div>
    <div className="flex flex-col gap-2 border-y py-3 xl:flex-row xl:items-center">
      <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder || `搜索${title}…`} className="pl-8" aria-label={`搜索${title}`} /></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2"><SlidersHorizontal className="size-3.5 text-muted-foreground" />{filters}</div>
      {showViewToggle && <Tabs value={view} onValueChange={onViewChange} className="xl:ml-auto"><TabsList>{[["list", "列表", LayoutList], ["grid", "网格", LayoutGrid]].map(([id, label, Icon]) => <TabsTrigger key={id} value={id} aria-label={`${label}视图`}><Icon />{label}</TabsTrigger>)}</TabsList></Tabs>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>共 {count} 项</span>{summary}{search.value && <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => search.onChange("")}>清除搜索<X className="size-3" /></button>}</div>
    {loading ? (loadingContent || <ResourceSkeleton />) : empty ? <ResourceEmpty {...empty} /> : children}
  </div>;
}

function ResourceSkeleton() {
  return <div className={resourceGridClassName}>{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardContent className="space-y-3 p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></CardContent></Card>)}</div>;
}

export function ResourceEmpty({ icon: Icon, title, description, action }) {
  return <Card className="border-dashed"><CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"><Icon className="size-8 text-muted-foreground" /><div><p className="font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p></div>{action}</CardContent></Card>;
}
