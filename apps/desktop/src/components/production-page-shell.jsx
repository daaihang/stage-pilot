import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { productionStatusLabel } from "@/lib/production-api";
import { workspacePath } from "@/lib/navigation";
import { roleLabel } from "@/lib/workspace-api";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";

export function ProductionPageBackLink({ workspace, children = "活动" }) {
  return <Button variant="ghost" size="sm" className="-ml-2" render={<Link to={workspacePath(workspace.id, "productions")} />}><ArrowLeft />{children}</Button>;
}

export function ProductionPageHeader({ workspace, production, title, titleContent, subtitle, actions, children }) {
  const status = production ? productionStatusLabel(production.status) : null;
  return <header className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-2"><ProductionPageBackLink workspace={workspace} />{titleContent || <div className="flex flex-wrap items-center gap-3"><h1 className="truncate text-2xl font-semibold tracking-tight">{title || production?.name || "活动"}</h1>{status && <Badge className={status.className} variant="secondary">{status.label}</Badge>}</div>}<p className="text-sm text-muted-foreground">{subtitle || `${workspace.name} · 活动工作区`}</p>{children}</div>{actions}</header>;
}

export function ProductionPermissionStatus({ role, canManage, draft = false }) {
  return <div className={`flex items-start gap-3 border p-3 text-sm ${draft ? "opacity-50 blur-[1px]" : ""}`}><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{draft ? "正式活动后可配置" : canManage ? "可管理活动设置" : "只读活动设置"}</span>{!draft && <Badge variant="outline">{roleLabel(role)}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{draft ? "草稿只能编辑概览中的基础信息。" : canManage ? "你的工作空间角色允许修改活动级配置。" : "当前工作空间角色只能查看配置。"}</p></div></div>;
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
