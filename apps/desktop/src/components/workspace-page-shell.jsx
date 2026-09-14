import { useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { matchStagePilotRoute, resolvePageBack, workspacePath } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { AppBackLink } from "@/components/app-back-link";

export function WorkspacePageHeader({ workspace, role, title, description, actions, backTo, backLabel }) {
  const location = useLocation();
  const route = matchStagePilotRoute(location.pathname, location.search);
  const resolvedBack = resolvePageBack({ route, workspace });
  const target = backTo || resolvedBack?.to || workspacePath(workspace.id);
  const label = backLabel || resolvedBack?.label || workspace.name;
  return <header className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-2"><AppBackLink to={target} label={label} /><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-semibold tracking-tight">{title || workspace.name}</h1>{role && <Badge variant="outline">{roleLabel(role)}</Badge>}</div>{description && <p className="text-sm text-muted-foreground">{description}</p>}</div>{actions}</header>;
}
