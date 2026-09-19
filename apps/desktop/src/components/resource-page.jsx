import { FileText, LayoutGrid, LayoutList, Search, SlidersHorizontal, X } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppBackLink } from "@/components/app-back-link";
import { PageHeader, PageHeaderActions } from "@/components/page-header";
import { resolveResourcePageHeader, resolveResourcePageHeaderMode } from "@/lib/resource-page-header";

// 卡片型页面根据网格容器的实际宽度决定列数，而不是绑定窗口 viewport 断点。
// 14rem（默认 224px）是卡片保持可读性的最小宽度；auto-fill 保持未填满的列轨道，避免最后一行卡片异常变宽。
// 活动页、资源库和场次网格共用该规则，因此右侧详情收窄主区时会自然重排。
export const resourceGridClassName = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))] [&>*]:w-full [&>*]:min-w-0";

export function ResourceToolbar({ title = "资源", search, filters, view, onViewChange, showViewToggle = true, className }) {
  return <div className={cn("flex flex-col gap-2 border-y py-3 @min-[64rem]/resource-page:flex-row @min-[64rem]/resource-page:items-center", className)}>
    <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search?.value || ""} onChange={(event) => search?.onChange?.(event.target.value)} placeholder={search?.placeholder || `搜索${title}…`} className="pl-8" aria-label={`搜索${title}`} /></div>
    <div className="flex min-w-0 flex-wrap items-center gap-2"><SlidersHorizontal className="size-3.5 text-muted-foreground" />{filters}</div>
    {showViewToggle && <Tabs value={view} onValueChange={onViewChange} className="@min-[64rem]/resource-page:ml-auto"><TabsList>{[["list", "列表", LayoutList], ["grid", "网格", LayoutGrid]].map(([id, label, Icon]) => <TabsTrigger key={id} value={id} aria-label={`${label}视图`}><Icon />{label}</TabsTrigger>)}</TabsList></Tabs>}
  </div>;
}

export function ListSurface({ as: Component = "div", children, className, ...props }) {
  return <Component className={cn("min-w-0", className)} {...props}>{children}</Component>;
}

export function ResourcePage({
  title,
  description,
  count,
  search,
  filters,
  view,
  onViewChange,
  actions,
  showViewToggle = true,
  loading,
  loadingContent,
  empty,
  summary,
  back,
  headingLevel = "h1",
  headerMode,
  headerTitle,
  children,
}) {
  const resolvedHeaderMode = resolveResourcePageHeaderMode({ headingLevel, headerMode });
  const header = resolveResourcePageHeader({ title, headerTitle, headerMode: resolvedHeaderMode });
  const headerActionContent = actions ? <PageHeaderActions {...actions} /> : null;
  return <div className="@container/resource-page min-w-0 space-y-5">
    {header.showHeader && <PageHeader
      back={back ? <AppBackLink to={back.to} label={back.label} onBeforeNavigate={back.onBeforeNavigate} replace={back.replace} preventScrollReset={back.preventScrollReset} /> : null}
      title={header.title}
      description={description}
      headingLevel={headingLevel}
      actions={headerActionContent}
    />}
    {!header.showHeader && headerActionContent && <div className="@container/page-header flex justify-end">{headerActionContent}</div>}
    <ResourceToolbar title={title} search={search} filters={filters} view={view} onViewChange={onViewChange} showViewToggle={showViewToggle} />
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>共 {count} 项</span>{summary}{search.value && <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => search.onChange("")}>清除搜索<X className="size-3" /></button>}</div>
    {loading ? (loadingContent || <ResourceSkeleton />) : empty ? <ResourceEmpty {...empty} /> : children}
  </div>;
}

function ResourceSkeleton() {
  return <div className={resourceGridClassName}>{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardContent className="space-y-3 p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></CardContent></Card>)}</div>;
}

export function ResourceEmpty({ icon: Icon = FileText, title, description, action }) {
  return <Card className="border-dashed"><CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"><Icon className="size-8 text-muted-foreground" aria-hidden="true" /><div><p className="font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p></div>{action}</CardContent></Card>;
}
