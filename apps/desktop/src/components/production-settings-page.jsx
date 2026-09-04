import { useEffect, useState } from "react";
import { Archive, Bell, Boxes, CheckCircle2, Eye, GitBranch, Link2, LockKeyhole, RotateCcw, Settings2, ShieldAlert, Trash2, UsersRound, Workflow, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { roleAtLeast } from "@/lib/workspace-api";
import { getProductionPlanningSettings, productionStatusLabel, updateProductionPlanningSettings } from "@/lib/production-api";
import { ProductionPageHeader, useProductionActionFeedback } from "@/components/production-page-shell";
import { SettingsTabs } from "@/components/settings-tabs";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { ProductionLocations } from "@/components/production-locations";

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

function AccessSettings() {
  return <div className="space-y-4"><UnavailableSection title="访问策略" description="活动权限当前继承所属工作空间，不单独建立活动成员。"><SettingRow icon={LockKeyhole} title="活动权限" description="沿用工作空间成员角色与权限"><Badge variant="secondary">Workspace</Badge></SettingRow><SettingRow icon={Eye} title="活动可见性" description="仅工作空间成员可以访问"><Badge variant="outline">内部</Badge></SettingRow><SettingRow icon={UsersRound} title="外部访问" description="公开链接和外部协作者尚未接入" disabled><Badge variant="outline">未启用</Badge></SettingRow></UnavailableSection></div>;
}

function WorkflowSettings() {
  const modules = [["节目征集", "收集外部节目提交", GitBranch], ["节目审核", "配置审核流程和审核人", CheckCircle2], ["工作人员", "管理活动工作人员和岗位", UsersRound], ["Rundown", "编排现场执行流程", Workflow], ["文件收集", "集中管理活动资料", Boxes]];
  return <UnavailableSection title="活动模块" description="这些模块将在各自领域上线后成为可配置的活动开关。">{modules.map(([title, description, Icon]) => <SettingRow key={title} icon={Icon} title={title} description={description} disabled><Switch checked={false} disabled /></SettingRow>)}</UnavailableSection>;
}

function NotificationSettings() {
  const items = [["活动通知", "活动相关通知总开关"], ["截止日期提醒", "在截止日期前提醒相关成员"], ["节目提交通知", "节目提交后通知活动负责人"], ["审核结果通知", "审核完成后通知提交人"], ["Rundown 变更通知", "流程编排发生变化时通知团队"], ["工作人员邀请通知", "工作人员邀请发出后通知对方"]];
  return <UnavailableSection title="通知偏好" description="通知配置尚未接入，当前仅展示规划中的设置。">{items.map(([title, description]) => <SettingRow key={title} icon={Bell} title={title} description={description} disabled><Switch checked={false} disabled /></SettingRow>)}</UnavailableSection>;
}

function PlanningPolicySetting({ production, canManage }) { const [value, setValue] = useState(null); const [loaded, setLoaded] = useState(false); useEffect(() => { getProductionPlanningSettings(production.id).then((data) => { setValue(data.require_actual_start_before_completion); setLoaded(true); }).catch(() => setLoaded(true)); }, [production.id]); const save = async (checked) => { const previous = value; setValue(checked); const toast = notify.loading("正在保存活动排程规则…"); try { await updateProductionPlanningSettings(production.id, { require_actual_start_before_completion: checked }); notify.success("活动排程规则已保存", { id: toast }); } catch (error) { setValue(previous); notify.error("活动排程规则保存失败", { id: toast, description: error?.message || String(error) }); } }; const inherit = async () => { const previous = value; setValue(null); const toast = notify.loading("正在恢复工作空间默认值…"); try { await updateProductionPlanningSettings(production.id, { require_actual_start_before_completion: null }); notify.success("已恢复工作空间默认值", { id: toast }); } catch (error) { setValue(previous); notify.error("恢复默认值失败", { id: toast, description: error?.message || String(error) }); } }; return <Card><CardHeader><CardTitle>排程规则</CardTitle><CardDescription>活动可以覆盖工作空间默认的完成规则。</CardDescription></CardHeader><CardContent><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">必须先开始才能结束</p><p className="mt-1 text-xs text-muted-foreground">关闭后可直接将计划中的记录标记为已结束；留空表示继承工作空间。</p></div><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={!canManage || !loaded || value === null} onClick={inherit}>继承默认</Button><Switch checked={value ?? true} disabled={!canManage || !loaded} onCheckedChange={save} /></div></div>{loaded && value === null && <p className="mt-3 text-xs text-muted-foreground">当前：继承工作空间默认值</p>}</CardContent></Card>; }

function IntegrationSettings() {
  const items = [["日历同步", "同步活动时间到外部日历"], ["文件存储", "连接外部文件存储服务"], ["邮件服务", "配置活动邮件发送服务"], ["Webhook", "向外部系统推送活动事件"], ["外部报名系统", "连接报名或票务平台"]];
  return <UnavailableSection title="外部连接" description="集成能力将在对应服务接入后开放。">{items.map(([title, description]) => <SettingRow key={title} icon={Link2} title={title} description={description} disabled><Badge variant="outline">未连接</Badge></SettingRow>)}</UnavailableSection>;
}

function LifecycleSettings({ production, canManage, onUpdateProduction }) {
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
  return <div className="space-y-4"><Card><CardHeader><CardTitle>活动状态</CardTitle><CardDescription>状态变更会同步到概览页、活动列表和侧栏。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between gap-4 border p-3"><div><p className="text-sm font-medium">当前状态</p><p className="mt-1 text-xs text-muted-foreground">活动状态由工作空间管理员管理。</p></div><Badge className={current.className} variant="secondary">{current.label}</Badge></div><div className="flex flex-wrap gap-2">{canManage ? targets.map(([status, label, Icon]) => <Button key={status} variant="outline" onClick={() => setPendingStatus([status, label, Icon])}><Icon />{label}</Button>) : <span className="text-xs text-muted-foreground">当前角色没有修改活动状态的权限。</span>}</div></CardContent></Card><Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><ShieldAlert className="size-4" />危险区域</CardTitle><CardDescription>删除活动接口尚未接入，当前不执行假删除。</CardDescription></CardHeader><CardContent><Button variant="outline" disabled><Trash2 />删除活动</Button></CardContent></Card></div>;
}

export function ProductionSettingsPage({ workspace, production, onUpdateProduction }) {
  const { membershipRole } = useWorkspaceContext();
  const canManage = roleAtLeast(membershipRole, "admin");
  const [activeGroup, setActiveGroup] = useState("access");
  const content = {
    access: <div className="space-y-4"><AccessSettings /><ProductionLocations workspace={workspace} production={production} /><PlanningPolicySetting production={production} canManage={canManage} /></div>,
    workflow: <WorkflowSettings />,
    notifications: <NotificationSettings />,
    integrations: <IntegrationSettings />,
    lifecycle: <LifecycleSettings production={production} canManage={canManage} onUpdateProduction={onUpdateProduction} />,
  };
  return <div className="space-y-6"><ProductionPageHeader workspace={workspace} production={production} title="活动设置" subtitle={`${production.name || "未命名活动"} · 活动行为与协作配置`} /><SettingsTabs groups={settingGroups} activeGroup={activeGroup} onGroupChange={setActiveGroup}>{content[activeGroup]}</SettingsTabs></div>;
}
