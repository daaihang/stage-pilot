import { useNavigate } from "react-router-dom";
import { RefreshCw, ServerOff, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatProductionDate, productionPath, workspacePath } from "@/lib/navigation";
import { ProductionsViewSwitcher } from "@/components/productions/productions-view";

export function PageBreadcrumbs({ route, workspace, production }) {
  return <Breadcrumb><BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink render={<Link to={workspacePath(workspace.id, "home")} />}>{workspace.name}</BreadcrumbLink></BreadcrumbItem>
    {route.mode === "production" && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink render={<Link to={workspacePath(workspace.id, "productions")} />}>活动</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink render={<Link to={productionPath(workspace.id, production.id, "overview")} />}>{production.name}</BreadcrumbLink></BreadcrumbItem></>}
    <BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{route.meta.title}</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList></Breadcrumb>;
}

function PageIntro({ route, workspace, production, action }) {
  return <div className="space-y-4"><PageBreadcrumbs route={route} workspace={workspace} production={production} /><div className="flex items-start justify-between gap-4"><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{route.meta.title}</h1><p className="text-sm text-muted-foreground">{route.meta.description}</p></div>{action}</div></div>;
}

export function WorkspaceHome({ route, workspace, productions }) {
  const next = productions[0];
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} /><section className="grid gap-4 md:grid-cols-3">
    <Card><CardHeader><CardDescription>工作空间</CardDescription><CardTitle className="text-lg">{workspace.name}</CardTitle></CardHeader><CardContent><Badge variant="secondary">{workspace.plan}</Badge></CardContent></Card>
    <Card><CardHeader><CardDescription>活动数量</CardDescription><CardTitle className="text-3xl">{productions.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">来自后端的真实统计</CardContent></Card>
    <Card><CardHeader><CardDescription>下一场活动</CardDescription><CardTitle className="text-lg">{next?.name ?? "暂无活动"}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{next ? `${formatProductionDate(next)} · ${next.venue}` : "创建活动后将在这里展示"}</CardContent></Card>
  </section><Card className="border-dashed"><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><Sparkles className="size-7 text-primary" /><div><p className="font-medium">StagePilot 工作台骨架已就绪</p><p className="mt-1 text-sm text-muted-foreground">待后续阶段开放待审核、排期冲突和团队动态。</p></div></CardContent></Card></div>;
}

export function ProductionsPage({ route, workspace, productions, loading, onCreateDraft }) {
  const navigate = useNavigate();
  const createDraft = () => {
    const draft = onCreateDraft();
    if (draft) navigate(productionPath(workspace.id, draft.id));
  };
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} action={<Button onClick={createDraft}>＋ 新建活动</Button>} />
    <ProductionsViewSwitcher workspace={workspace} productions={productions} loading={loading} onCreate={createDraft} />
  </div>;
}

export function PlaceholderPage({ route, workspace, production }) {
  return <div className="space-y-6"><PageIntro route={route} workspace={workspace} production={production} /><Card className="border-dashed"><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><ServerOff className="size-8 text-muted-foreground" /><div><p className="font-medium">页面结构已接入侧栏</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">当前使用前端导航骨架。后端提供数据后，此处将通过 Navigation Repository 和对应业务服务加载真实内容。</p></div><Badge variant="outline">等待后端接入</Badge></CardContent></Card></div>;
}

export function NavigationFailure({ title = "无法加载导航", description, onRetry, homePath }) {
  return <div className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-lg"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex gap-2">{onRetry && <Button onClick={onRetry}><RefreshCw />重试</Button>}{homePath && <Button variant="outline" render={<Link to={homePath} />}>返回工作台</Button>}</CardContent></Card></div>;
}
