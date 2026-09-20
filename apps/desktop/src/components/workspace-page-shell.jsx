import { useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { matchStagePilotRoute, resolvePageBack } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { AppBackLink } from "@/components/app-back-link";
import { PageHeader, PageHeaderActions } from "@/components/page-header";

export function WorkspacePageHeader({ workspace, role, title, description, actions, backTo, backLabel }) {
  const location = useLocation();
  const route = matchStagePilotRoute(location.pathname, location.search);
  const resolvedBack = resolvePageBack({ route, workspace });
  const target = backTo || resolvedBack?.to;
  const label = backLabel || resolvedBack?.label || workspace.name;
  return <PageHeader
    back={target ? <AppBackLink to={target} label={label} /> : null}
    title={title || workspace.name}
    titleAccessory={role ? <Badge variant="outline">{roleLabel(role)}</Badge> : null}
    description={description}
    actions={actions ? <PageHeaderActions {...actions} /> : null}
  />;
}
