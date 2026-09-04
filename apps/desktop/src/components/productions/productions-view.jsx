import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, FolderKanban, GanttChartSquare, LayoutGrid, LayoutList, MapPin, Plus } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appStore } from "@/lib/app-store";
import { formatProductionDate, productionPath, productionStatus } from "@/lib/navigation";
import { ProductionGantt } from "@/components/productions/production-gantt";
import { resourceGridClassName } from "@/components/resource-page";

const views = [["list", "列表", LayoutList], ["grid", "网格", LayoutGrid], ["gantt", "甘特图", GanttChartSquare]];
const viewStoreKey = (workspaceId) => `productionsView:${workspaceId}`;

function ProductionMeta({ production }) {
  const status = productionStatus[production.status] ?? productionStatus.draft;
  return <>
    <span className="flex min-w-0 items-center gap-1"><CalendarDays className="size-3 shrink-0" />{formatProductionDate(production)}</span>
    <span className="flex min-w-0 items-center gap-1"><MapPin className="size-3 shrink-0" /><span className="truncate">{production.venue || "地点待定"}</span></span>
    {production.isLocalDraft && <Badge variant="outline" className="shrink-0">前端草稿</Badge>}
    <Badge className={status.className} variant="secondary">{status.label}</Badge>
  </>;
}

function ProductionStatusBadge({ production }) {
  const status = productionStatus[production.status] ?? productionStatus.active;
  return <Badge className={status.className} variant="secondary">{status.label}</Badge>;
}

function ProductionRow({ workspace, production }) {
  return <Link to={productionPath(workspace.id, production.id)} className="group flex items-center gap-4 border p-3 transition-colors hover:bg-muted/40">
    <div className="flex size-9 shrink-0 items-center justify-center bg-primary/10 text-primary"><FolderKanban className="size-4" /></div>
    <div className="grid min-w-0 flex-1 gap-1"><span className="truncate text-sm font-medium">{production.name}</span><span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><ProductionMeta production={production} /></span></div>
    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
  </Link>;
}

function ProductionCard({ workspace, production }) {
  return <Link to={productionPath(workspace.id, production.id)} className="group"><Card className="h-full transition-colors group-hover:border-primary/50"><CardHeader>
    <div className="flex items-start justify-between gap-3"><div className="flex size-9 shrink-0 items-center justify-center bg-primary/10 text-primary"><FolderKanban className="size-4" /></div><ProductionStatusBadge production={production} /></div>
    <CardTitle className="line-clamp-2 pt-2 text-base">{production.name}</CardTitle>
    <CardDescription className="space-y-1"><span className="flex min-w-0 items-center gap-1"><CalendarDays className="size-3 shrink-0" />{formatProductionDate(production)}</span><span className="flex min-w-0 items-center gap-1"><MapPin className="size-3 shrink-0" /><span className="truncate">{production.venue || "地点待定"}</span></span></CardDescription>
  </CardHeader><CardContent className="flex items-center gap-1 text-sm text-primary">打开活动<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" /></CardContent></Card></Link>;
}

function ProductionsSkeleton() {
  return <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex items-center gap-4 border p-3"><Skeleton className="size-9" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div><Skeleton className="h-5 w-12" /></div>)}</div>;
}

function EmptyProductions({ onCreate }) {
  return <Card className="border-dashed"><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><FolderKanban className="size-8 text-muted-foreground" /><div><p className="font-medium">还没有活动</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">创建一个前端草稿，先体验活动工作区的搭建流程。</p></div><Button onClick={onCreate}><Plus />新建活动</Button></CardContent></Card>;
}

export function ProductionsViewSwitcher({ workspace, productions, loading = false, onCreate }) {
  const navigate = useNavigate();
  const [view, setView] = useState("list");

  useEffect(() => {
    let active = true;
    appStore.get(viewStoreKey(workspace.id)).then((stored) => {
      if (active && views.some(([id]) => id === stored)) setView(stored);
    }).catch(() => {});
    return () => { active = false; };
  }, [workspace.id]);

  const changeView = (nextView) => {
    setView(nextView);
    appStore.set(viewStoreKey(workspace.id), nextView).catch(() => {});
  };

  if (loading) return <ProductionsSkeleton />;
  if (!productions.length) return <EmptyProductions onCreate={onCreate} />;

  return <div className="space-y-4">
    <Tabs value={view} onValueChange={changeView}><TabsList>{views.map(([id, label, Icon]) => <TabsTrigger key={id} value={id}><Icon className="size-3.5" />{label}</TabsTrigger>)}</TabsList></Tabs>
    {view === "list" && <div className="space-y-2">{productions.map((production) => <ProductionRow key={production.id} workspace={workspace} production={production} />)}</div>}
    {view === "grid" && <div className={resourceGridClassName}>{productions.map((production) => <ProductionCard key={production.id} workspace={workspace} production={production} />)}</div>}
    {view === "gantt" && <ProductionGantt productions={productions} onOpenProduction={(productionId) => navigate(productionPath(workspace.id, productionId))} />}
  </div>;
}
