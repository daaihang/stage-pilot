import { ShieldCheck } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { productionStatusLabel } from "@/lib/production-api";
import { directProductionPath, productionPath, workspacePath } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";
import { AppBackLink } from "@/components/app-back-link";

export function ProductionPageBackLink({ workspace, production, children = "活动概览", backTo, onLeaveCreation, isOverview = false }) {
  const contextExit = workspace?.workspaceNavigable === false ? "/work?tab=participating" : (workspace?.id ? workspacePath(workspace.id, "productions") : "/work");
  const productionOverview = production?.id
    ? (workspace?.workspaceNavigable === false ? directProductionPath(production.id, "overview") : productionPath(workspace.id, production.id, "overview"))
    : contextExit;
  const target = backTo || (isOverview ? contextExit : productionOverview);
  const label = backTo ? children : (isOverview ? (workspace?.workspaceNavigable === false ? "我的活动" : "活动") : children);
  return <AppBackLink to={target} label={label} onBeforeNavigate={onLeaveCreation ? async () => { await onLeaveCreation(); return false; } : undefined} />;
}

export function ProductionPageHeader({ workspace, production, title, titleContent, subtitle, actions, children, onLeaveCreation, backTo, backLabel = "活动概览", isOverview = false }) {
  const status = production ? productionStatusLabel(production.status) : null;
  const resolvedOverview = isOverview || Boolean(titleContent) || title === "概览";
  return <header className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-2"><ProductionPageBackLink workspace={workspace} production={production} isOverview={resolvedOverview} onLeaveCreation={onLeaveCreation} backTo={backTo}>{backLabel}</ProductionPageBackLink>{titleContent || <div className="flex flex-wrap items-center gap-3"><h1 className="truncate text-2xl font-semibold tracking-tight">{title || production?.name || "活动"}</h1>{status && <Badge className={status.className} variant="secondary">{status.label}</Badge>}</div>}<p className="text-sm text-muted-foreground">{subtitle || `${workspace.name} · 活动工作区`}</p>{children}</div>{actions}</header>;
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
