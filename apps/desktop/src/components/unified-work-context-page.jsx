import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Link2, Plus, Search, SlidersHorizontal } from "@/components/ui/icons";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { directProductionPath, workspacePath } from "@/lib/navigation";
import { listAccessibleProductions, toProductionSummary } from "@/lib/production-api";
import { notify } from "@/components/ui/sonner";
import { useUserPreferences } from "@/components/user-preferences-provider";
import { formatInstantInTimeZone } from "@/lib/timezone";
import { PageHeader, PageHeaderActions } from "@/components/page-header";

const tabs = [
  ["workspaces", "工作空间"],
  ["participating", "参与的活动"],
  ["collaboration", "我的协作"],
];

function EmptyState({ title, description }) {
  return <Card className="border-dashed bg-muted/20 py-10 text-center">
    <CardContent className="space-y-2">
      <div className="mx-auto flex size-10 items-center justify-center bg-muted text-muted-foreground"><Building2 className="size-5" /></div>
      <p className="font-medium">{title}</p>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
    </CardContent>
  </Card>;
}

function WorkspaceCard({ workspace, onEnter }) {
  return <button type="button" onClick={() => onEnter(workspace)} className="group text-left">
    <Card className="h-full min-h-48 transition-colors group-hover:ring-primary/40 group-focus-visible:ring-2 group-focus-visible:ring-ring">
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center bg-primary/10 text-sm font-semibold text-primary">{workspace.logo || "W"}</span>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </div>
        <div className="space-y-1">
          <CardTitle className="truncate text-base">{workspace.name}</CardTitle>
          <p className="text-xs text-muted-foreground">{workspace.plan || "工作空间"}</p>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-12 items-end">
        <p className="line-clamp-2 text-sm text-muted-foreground">{workspace.description || "进入工作空间，继续管理活动与团队资源。"}</p>
      </CardContent>
    </Card>
  </button>;
}

export function UnifiedWorkContextPage({ onCreateWorkspace, onEnterWorkspace, onJoinInvitation, initialTab = "workspaces" }) {
  const { timezone } = useUserPreferences();
  const { workspaces, status } = useWorkspaceContext();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [participating, setParticipating] = useState([]);
  useEffect(() => { listAccessibleProductions().then((items) => setParticipating(items.map(toProductionSummary).filter((item) => item.contextKind === "participating"))).catch(() => setParticipating([])); }, []);
  const tab = tabs.some(([value]) => value === initialTab) ? initialTab : "workspaces";
  const filteredWorkspaces = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return workspaces;
    return workspaces.filter((workspace) => workspace.name.toLocaleLowerCase().includes(normalized));
  }, [query, workspaces]);
  const changeTab = (nextTab) => navigate(`/work?tab=${encodeURIComponent(nextTab)}`);
  const enter = async (workspace) => {
    try {
      await onEnterWorkspace(workspace);
    } catch (error) {
      notify.error("无法切换工作空间", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  const onboarding = status === "none";

  return <div className="@container/work-context mx-auto min-w-0 w-full space-y-6">
    <PageHeader title="我的工作" description="访问你的工作空间、参与的活动和协作事项" actions={<PageHeaderActions><Button variant="outline" onClick={onJoinInvitation}><Link2 />加入工作空间或活动</Button><Button onClick={onCreateWorkspace}><Plus />创建工作空间</Button></PageHeaderActions>} />

    <Tabs value={tab} onValueChange={changeTab}>
      <TabsList variant="line" className="w-full justify-start border-b">
        {tabs.map(([value, label]) => <TabsTrigger key={value} value={value} className="flex-none px-4">{label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="workspaces" className="space-y-5 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前内容" className="pl-8" aria-label="搜索工作空间" /></div>
          <Button variant="outline" disabled><SlidersHorizontal />筛选</Button>
        </div>
        {onboarding ? <EmptyState title="还没有工作空间" description="创建你的第一个工作空间，开始沉淀活动与团队资源。" />
          : filteredWorkspaces.length ? <div className="grid gap-4 @min-[40rem]/work-context:grid-cols-2 @min-[56rem]/work-context:grid-cols-3">{filteredWorkspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} onEnter={enter} />)}</div>
          : <EmptyState title="没有匹配的工作空间" description="尝试修改搜索关键词，或创建一个新的工作空间。" />}
      </TabsContent>
      <TabsContent value="participating" className="space-y-3 pt-5">{participating.length ? participating.map((item) => <button key={item.id} type="button" onClick={() => navigate(directProductionPath(item.id))} className="flex w-full items-center gap-4 border p-4 text-left hover:bg-muted/40"><div className="min-w-0 flex-1"><p className="font-medium">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{item.workspaceName} · {item.directRole || "Viewer"}</p></div><span className="text-xs text-muted-foreground">{item.expiresAt ? `访问至 ${formatInstantInTimeZone(item.expiresAt, timezone, { dateStyle: "short", timeStyle: undefined })}` : "长期访问"}</span></button>) : <EmptyState title="暂无参与的活动" description="当你被邀请或分配到其他工作空间的活动时，活动会显示在这里。" />}</TabsContent>
      <TabsContent value="collaboration" className="pt-5"><EmptyState title="暂无协作事项" description="节目报名、招募申请和其他协作事项接入后，会显示在这里。" /></TabsContent>
    </Tabs>
  </div>;
}
