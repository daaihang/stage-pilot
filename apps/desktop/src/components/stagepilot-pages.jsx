import { useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { CalendarDays, Clock3, RefreshCw, ServerOff, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatProductionDate, productionPath, workspacePath } from "@/lib/navigation";
import { productionStatusLabel } from "@/lib/production-api";
import { ProductionsViewSwitcher } from "@/components/productions/productions-view";

function PageIntro({ route, action }) {
  return <div className="space-y-4"><div className="flex items-start justify-between gap-4"><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{route.meta.title}</h1><p className="text-sm text-muted-foreground">{route.meta.description}</p></div>{action}</div></div>;
}

export function WorkspaceHome({ route, workspace, productions, onCreate, onViewProductions, onOpenCalendar }) {
  const now = Date.now();
  const sorted = useMemo(() => [...productions].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)), [productions]);
  const upcoming = productions.filter((item) => item.plannedStartAt && new Date(item.plannedStartAt).getTime() >= now && item.status !== "archived").sort((a, b) => new Date(a.plannedStartAt) - new Date(b.plannedStartAt));
  const active = productions.filter((item) => item.status === "active");
  const archived = productions.filter((item) => item.status === "archived");
  const next = upcoming[0] || active[0];
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} action={<div className="flex flex-wrap gap-2"><Button onClick={onCreate}><Sparkles />新建活动</Button><Button variant="outline" onClick={onViewProductions}>查看全部活动</Button><Button variant="outline" onClick={onOpenCalendar}><CalendarDays />打开日历</Button></div>} /><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Card><CardHeader><CardDescription>活动总数</CardDescription><CardTitle className="text-3xl">{productions.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">当前工作空间活动</CardContent></Card><Card><CardHeader><CardDescription>进行中</CardDescription><CardTitle className="text-3xl">{active.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">正在执行的活动</CardContent></Card><Card><CardHeader><CardDescription>已归档</CardDescription><CardTitle className="text-3xl">{archived.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">已归档活动</CardContent></Card></section><section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>下一场活动</CardTitle><CardDescription>按活动时间排序</CardDescription></CardHeader><CardContent>{next ? <Link className="block border p-4 hover:bg-muted/50" to={productionPath(workspace.id, next.id)}><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{next.name}</p><p className="mt-1 text-sm text-muted-foreground">{formatProductionDate(next)}{next.venue ? ` · ${next.venue}` : ""}</p></div><Badge variant="secondary">{productionStatusLabel(next.status).label}</Badge></div></Link> : <EmptyState icon={Clock3} title="暂无下一场活动" description="创建活动后，它会出现在这里。" />}</CardContent></Card><Card><CardHeader><CardTitle>活动概览</CardTitle><CardDescription>按时间和生命周期查看工作空间活动。</CardDescription></CardHeader><CardContent><EmptyState icon={Sparkles} title={productions.length ? "活动已就绪" : "还没有活动"} description={productions.length ? "打开活动列表查看完整信息。" : "从新建活动开始建立工作空间。"} /></CardContent></Card></section><Card><CardHeader><CardTitle>最近活动</CardTitle><CardDescription>根据最近创建或更新时间排列</CardDescription></CardHeader><CardContent>{sorted.length ? <div className="divide-y">{sorted.slice(0, 6).map((item) => <Link key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:text-primary" to={productionPath(workspace.id, item.id)}><div className="flex size-8 items-center justify-center border"><Sparkles className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{formatProductionDate(item)}</p></div><Badge variant="outline">{productionStatusLabel(item.status).label}</Badge></Link>)}</div> : <EmptyState icon={Sparkles} title="还没有活动" description="从新建活动开始建立工作空间。" />}</CardContent></Card></div>;
}

function EmptyState({ icon: Icon, title, description }) {
  return <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><Icon className="size-5" /><p className="font-medium text-foreground">{title}</p><p>{description}</p></div>;
}

export function ProductionsPage({ route, workspace, productions, loading, onCreate }) {
  const navigate = useNavigate();
  const createCreation = () => {
    const session = onCreate();
    if (session) navigate(productionPath(workspace.id, session.id));
  };
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} action={<Button onClick={createCreation}>＋ 新建活动</Button>} />
    <ProductionsViewSwitcher workspace={workspace} productions={productions} loading={loading} onCreate={createCreation} />
  </div>;
}

export function PlaceholderPage({ route, workspace, production }) {
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} production={production} /><Card className="border-dashed"><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><ServerOff className="size-8 text-muted-foreground" /><div><p className="font-medium">页面结构已接入侧栏</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">当前使用前端导航骨架。后端提供数据后，此处将通过 Navigation Repository 和对应业务服务加载真实内容。</p></div><Badge variant="outline">等待后端接入</Badge></CardContent></Card></div>;
}

export function NavigationFailure({ title = "无法加载导航", description, onRetry, homePath }) {
  return <div className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-lg"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex gap-2">{onRetry && <Button onClick={onRetry}><RefreshCw />重试</Button>}{homePath && <Button variant="outline" render={<Link to={homePath} />}>返回工作台</Button>}</CardContent></Card></div>;
}
