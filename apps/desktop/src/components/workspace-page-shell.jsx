import { Badge } from "@/components/ui/badge";
import { workspacePath } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { AppBackLink } from "@/components/app-back-link";

export function WorkspacePageHeader({ workspace, role, title, description, actions, backTo, backLabel }) {
  return <header className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-2"><AppBackLink to={backTo || workspacePath(workspace.id)} label={backLabel || workspace.name} /><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-semibold tracking-tight">{title || workspace.name}</h1>{role && <Badge variant="outline">{roleLabel(role)}</Badge>}</div>{description && <p className="text-sm text-muted-foreground">{description}</p>}</div>{actions}</header>;
}
