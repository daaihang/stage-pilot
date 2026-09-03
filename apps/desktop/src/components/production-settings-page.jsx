import { useState } from "react";
import { Archive, Bell, Boxes, CheckCircle2, Eye, GitBranch, Link2, LockKeyhole, RotateCcw, Settings2, ShieldAlert, Trash2, UsersRound, Workflow, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { roleAtLeast } from "@/lib/workspace-api";
import { productionStatusLabel } from "@/lib/production-api";
import { ProductionPageHeader, useProductionActionFeedback } from "@/components/production-page-shell";
import { SettingsTabs } from "@/components/settings-tabs";
import { useWorkspaceContext } from "@/components/workspace-provider";

const settingGroups = [
  ["access", "协作与访问", UsersRound],
  ["workflow", "工作流与模块", Workflow],
  ["notifications", "通知与提醒", Bell],
  ["integrations", "集成", Link2],
  ["lifecycle", "生命周期", Settings2],
];

function SettingRow({ icon: Icon, title, description, children, disabled = false }) {
  return <div className={`flex items-center gap-4 border-b py-4 last:border-b-0 ${disabled ? "opacity-50 blur-[1px]" : ""}`} aria-disabled={disabled}><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{children}</div>;
}

function UnavailableSection({ title, description, children }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>;
}

function AccessSettings({ draft }) {
  return <div className="space-y-4"><UnavailableSection title="访问策略" description="活动权限当前继承所属工作空间，不单独建立活动成员。"><SettingRow icon={LockKeyhole} title="活动权限" description="沿用工作空间成员角色与权限" disabled={draft}><Badge variant="secondary">Workspace</Badge></SettingRow><SettingRow icon={Eye} title="活动可见性" description="仅工作空间成员可以访问" disabled={draft}><Badge variant="outline">内部</Badge></SettingRow><SettingRow icon={UsersRound} title="外部访问" description="公开链接和外部协作者尚未接入" disabled><Badge variant="outline">未启用</Badge></SettingRow></UnavailableSection></div>;
}

function WorkflowSettings({ draft }) {
  const modules = [["节目征集", "收集外部节目提交", GitBranch], ["节目审核", "配置审核流程和审核人", CheckCircle2], ["工作人员", "管理活动工作人员和岗位", UsersRound], ["Rundown", "编排现场执行流程", Workflow], ["文件收集", "集中管理活动资料", Boxes]];
  return <UnavailableSection title="活动模块" description="这些模块将在各自领域上线后成为可配置的活动开关。">{modules.map(([title, description, Icon]) => <SettingRow key={title} icon={Icon} title={title} description={description} disabled><Switch checked={false} disabled /></SettingRow>)}</UnavailableSection>;
}

function NotificationSettings({ draft }) {
  const items = [["活动通知", "活动相关通知总开关"], ["截止日期提醒", "在截止日期前提醒相关成员"], ["节目提交通知", "节目提交后通知活动负责人"], ["审核结果通知", "审核完成后通知提交人"], ["Rundown 变更通知", "流程编排发生变化时通知团队"], ["工作人员邀请通知", "工作人员邀请发出后通知对方"]];
  return <UnavailableSection title="通知偏好" description="通知配置尚未接入，当前仅展示规划中的设置。">{items.map(([title, description]) => <SettingRow key={title} icon={Bell} title={title} description={description} disabled><Switch checked={false} disabled /></SettingRow>)}</UnavailableSection>;
}

function IntegrationSettings({ draft }) {
  const items = [["日历同步", "同步活动时间到外部日历"], ["文件存储", "连接外部文件存储服务"], ["邮件服务", "配置活动邮件发送服务"], ["Webhook", "向外部系统推送活动事件"], ["外部报名系统", "连接报名或票务平台"]];
  return <UnavailableSection title="外部连接" description="集成能力将在对应服务接入后开放。">{items.map(([title, description]) => <SettingRow key={title} icon={Link2} title={title} description={description} disabled={draft || true}><Badge variant="outline">未连接</Badge></SettingRow>)}</UnavailableSection>;
}

function LifecycleSettings({ production, canManage, onUpdateProduction, draft }) {
  const feedback = useProductionActionFeedback();
  const [pendingStatus, setPendingStatus] = useState(null);
  const current = productionStatusLabel(production.status);
  const targets = production.status === "archived" ? [["active", "恢复活动", RotateCcw]] : production.status === "completed" ? [["active", "重新启用", RotateCcw], ["archived", "归档活动", Archive]] : [["completed", "标记为已结束", CheckCircle2], ["archived", "归档活动", Archive]];
  const confirmStatus = async () => {
    if (!pendingStatus) return;
    const target = pendingStatus;
    setPendingStatus(null);
    try {
      await feedback(() => onUpdateProduction({ status: target[0] }), { loading: "正在更新活动状态…", success: "活动状态已更新", error: "活动状态更新失败" });
    } catch { /* feedback already notified */ }
  };
  return <div className="space-y-4"><Card><CardHeader><CardTitle>活动状态</CardTitle><CardDescription>状态变更会同步到概览页、活动列表和侧栏。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between gap-4 border p-3"><div><p className="text-sm font-medium">当前状态</p><p className="mt-1 text-xs text-muted-foreground">活动状态由工作空间管理员管理。</p></div><Badge className={current.className} variant="secondary">{current.label}</Badge></div><div className="flex flex-wrap gap-2">{canManage && !draft ? targets.map(([status, label, Icon]) => <Button key={status} variant="outline" onClick={() => setPendingStatus([status, label, Icon])}><Icon />{label}</Button>) : <span className="text-xs text-muted-foreground">{draft ? "活动正式化后可管理生命周期。" : "当前角色没有修改活动状态的权限。"}</span>}</div></CardContent></Card><Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><ShieldAlert className="size-4" />危险区域</CardTitle><CardDescription>删除活动接口尚未接入，当前不执行假删除。</CardDescription></CardHeader><CardContent><Button variant="outline" disabled><Trash2 />删除活动</Button></CardContent></Card></div>;
}

export function ProductionSettingsPage({ workspace, production, onUpdateProduction }) {
  const { membershipRole } = useWorkspaceContext();
  const canManage = roleAtLeast(membershipRole, "admin");
  const draft = Boolean(production.isLocalDraft);
  const [activeGroup, setActiveGroup] = useState("access");
  const content = {
    access: <AccessSettings draft={draft} />,
    workflow: <WorkflowSettings draft={draft} />,
    notifications: <NotificationSettings draft={draft} />,
    integrations: <IntegrationSettings draft={draft} />,
    lifecycle: <LifecycleSettings production={production} canManage={canManage} onUpdateProduction={onUpdateProduction} draft={draft} />,
  };
  return <div className="space-y-6"><ProductionPageHeader workspace={workspace} production={production} title="活动设置" subtitle={`${production.name || "未命名活动"} · 活动行为与协作配置`} /><SettingsTabs groups={settingGroups} activeGroup={activeGroup} onGroupChange={setActiveGroup} disabled={draft}>{content[activeGroup]}</SettingsTabs></div>;
}
