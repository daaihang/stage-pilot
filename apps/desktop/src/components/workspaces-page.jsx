import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { PageHeader, PageHeaderActions } from "@/components/page-header";

/**
 * 工作空间入口页：没有工作空间时是 onboarding，
 * 有多个工作空间且无可恢复记录时是 selector。
 * 路由：/workspaces
 */
export function WorkspacesPage({ onCreateWorkspace }) {
  const { workspaces, status, switchWorkspace } = useWorkspaceContext();
  const navigate = useNavigate();

  const enter = async (workspaceId) => {
    await switchWorkspace(workspaceId);
    navigate(workspaceHomePath(workspaceId), { replace: true });
  };

  const onboarding = status === "none";
  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <PageHeader title={onboarding ? "创建你的第一个工作空间" : "选择工作空间"} description={onboarding ? "工作空间沉淀长期组织资产，未来的活动都在它里面进行。" : "你拥有多个工作空间，选择一个继续，或创建新的工作空间。"} actions={<PageHeaderActions><Button onClick={onCreateWorkspace}>＋ 创建新的工作空间</Button></PageHeaderActions>} />
      {!onboarding && workspaces.length > 0 && (
        <div className="space-y-2">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => enter(workspace.id)}
              className="flex w-full items-center gap-3 border p-4 text-left transition-colors hover:border-primary/50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center bg-primary/10 text-sm font-semibold text-primary">{workspace.logo}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{workspace.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{workspace.plan}</span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
      {onboarding && <Card><CardHeader><CardTitle>还没有工作空间</CardTitle><CardDescription>点击右上角按钮创建你的第一个工作空间。</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onCreateWorkspace}>打开创建弹窗</Button></CardContent></Card>}
    </div>
  );
}

function workspaceHomePath(workspaceId) {
  return `/w/${workspaceId}/home`;
}
