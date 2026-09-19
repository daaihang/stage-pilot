import { useLocation } from "react-router-dom";
import { ShieldCheck } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { productionStatusLabel } from "@/lib/production-api";
import { matchStagePilotRoute, resolvePageBack } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";
import { AppBackLink } from "@/components/app-back-link";
import { PageHeader, PageHeaderActions } from "@/components/page-header";

export function ProductionPageBackLink({ workspace, production, children = "活动概览", backTo, onLeaveCreation }) {
  const location = useLocation();
  const route = matchStagePilotRoute(location.pathname, location.search);
  const resolvedBack = resolvePageBack({ route, workspace, production });
  const target = backTo || resolvedBack?.to;
  if (!target) return null;
  const label = backTo ? children : (resolvedBack?.label || children);
  return <AppBackLink to={target} label={label} onBeforeNavigate={onLeaveCreation ? async () => { await onLeaveCreation(); return false; } : undefined} />;
}

export function ProductionPageHeader({ workspace, production, title, titleContent, subtitle, actions, children, onLeaveCreation, backTo, backLabel = "活动概览" }) {
  const status = production ? productionStatusLabel(production.status) : null;
  return <PageHeader
    back={<ProductionPageBackLink workspace={workspace} production={production} onLeaveCreation={onLeaveCreation} backTo={backTo}>{backLabel}</ProductionPageBackLink>}
    title={title || production?.name || "活动"}
    titleContent={titleContent}
    titleAccessory={!titleContent && status ? <Badge className={status.className} variant="secondary">{status.label}</Badge> : null}
    description={subtitle || `${workspace.name} · 活动工作区`}
    actions={actions ? <PageHeaderActions>{actions}</PageHeaderActions> : null}
  >{children}</PageHeader>;
}

export function ProductionPermissionStatus({ role, canManage }) {
  return <div className="flex items-start gap-3 border p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{canManage ? "可管理活动设置" : "只读活动设置"}<Badge variant="outline" className="ml-2">{roleLabel(role)}</Badge></span></div><p className="mt-1 text-xs text-muted-foreground">{canManage ? "你的工作空间角色允许修改活动级配置。" : "当前工作空间角色只能查看配置。"}</p></div></div>;
}

export const SettingsLayout = SettingsTabs;
export const ProductionSettingsLayout = SettingsTabs;

export function useProductionActionFeedback() {
  return async (action, { loading = "正在保存…", success = "已保存", error = "保存失败" } = {}) => {
    const toastId = notify.loading(loading);
    try {
      const result = await action();
      notify.success(success, { id: toastId });
      return result;
    } catch (nextError) {
      notify.error(error, { id: toastId, description: nextError instanceof Error ? nextError.message : String(nextError) });
      throw nextError;
    }
  };
}
