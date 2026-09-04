import { useCallback, useEffect, useState } from "react";
import { Bell, Cable, Database, KeyRound, LockKeyhole, Save, Settings2, ShieldAlert } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { getWorkspace, getWorkspacePlanningSettings, roleAtLeast, updateWorkspace, updateWorkspacePlanningSettings } from "@/lib/workspace-api";

const settingGroups = [["general", "常规", Settings2], ["notifications", "通知", Bell], ["integrations", "集成", Cable], ["security", "安全与数据", LockKeyhole], ["danger", "危险区域", ShieldAlert]];

function PlanningSettings({ workspaceId, canManage }) { const [value, setValue] = useState(true); const [loaded, setLoaded] = useState(false); useEffect(() => { getWorkspacePlanningSettings(workspaceId).then((data) => { setValue(data.require_actual_start_before_completion !== false); setLoaded(true); }).catch(() => setLoaded(true)); }, [workspaceId]); const save = async (checked) => { setValue(checked); const toast = notify.loading("正在保存排程规则…"); try { await updateWorkspacePlanningSettings(workspaceId, { require_actual_start_before_completion: checked }); notify.success("排程规则已保存", { id: toast }); } catch (error) { setValue(!checked); notify.error("排程规则保存失败", { id: toast, description: error?.message || String(error) }); } }; return <Card><CardHeader><CardTitle>排程规则</CardTitle><CardDescription>设置场次和彩排是否必须先开始，才能标记为已结束。</CardDescription></CardHeader><CardContent><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">必须先开始才能结束</p><p className="mt-1 text-xs text-muted-foreground">Production 未单独覆盖时继承此默认值。</p></div><Switch checked={value} disabled={!canManage || !loaded} onCheckedChange={save} /></div></CardContent></Card>; }

function UnavailableRow({ icon: Icon, title, description, value = "尚未接入" }) {
  return <div className="flex items-center gap-3 border-b py-4 last:border-b-0 opacity-55 blur-[1px]"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Badge variant="outline">{value}</Badge></div>;
}

function GeneralSettings({ workspace, canManage, form, setForm, saving, onSave }) {
  return <div className="space-y-4"><Card><CardHeader><CardTitle>常规</CardTitle><CardDescription>工作空间的身份信息。{canManage ? "修改后保存本组设置。" : "当前角色只能查看。"}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={onSave}><label className="block space-y-1.5"><span className="text-sm font-medium">名称</span><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} disabled={!canManage} /></label><label className="block space-y-1.5"><span className="text-sm font-medium">描述</span><Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} disabled={!canManage} /></label><div className="space-y-1.5"><span className="text-sm font-medium">Slug</span><p className="flex h-9 items-center border bg-muted/40 px-3 text-sm text-muted-foreground">{workspace.slug}</p></div>{canManage && <Button type="submit" disabled={saving}><Save />{saving ? "保存中…" : "保存常规设置"}</Button>}</form></CardContent></Card><PlanningSettings workspaceId={workspace.id} canManage={canManage} /></div>;
}

function WorkspaceSettingsContent({ group, workspace, canManage, form, setForm, saving, onSave }) {
  if (group === "general") return <GeneralSettings workspace={workspace} canManage={canManage} form={form} setForm={setForm} saving={saving} onSave={onSave} />;
  if (group === "notifications") return <Card><CardHeader><CardTitle>通知</CardTitle><CardDescription>工作空间级通知配置尚未接入。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Bell} title="成员加入通知" description="成员加入或离开工作空间时通知管理员" /><UnavailableRow icon={Bell} title="新活动通知" description="工作空间创建新活动时通知成员" /><UnavailableRow icon={Bell} title="系统通知" description="接收 StagePilot 工作空间系统消息" /></CardContent></Card>;
  if (group === "integrations") return <Card><CardHeader><CardTitle>集成</CardTitle><CardDescription>工作空间共享的外部服务连接。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Cable} title="日历" description="同步工作空间活动到外部日历" value="未连接" /><UnavailableRow icon={Cable} title="文件存储" description="连接工作空间文件存储服务" value="未连接" /><UnavailableRow icon={Cable} title="Webhook / API" description="向外部系统推送工作空间事件" value="未连接" /></CardContent></Card>;
  if (group === "security") return <Card><CardHeader><CardTitle>安全与数据</CardTitle><CardDescription>工作空间的安全和数据治理能力尚未接入。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Database} title="审计日志" description="查看成员和数据操作记录" /><UnavailableRow icon={Database} title="数据导出" description="导出工作空间中的业务数据" /><UnavailableRow icon={LockKeyhole} title="会话与安全" description="管理工作空间安全策略" /></CardContent></Card>;
  return <Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><ShieldAlert className="size-4" />危险区域</CardTitle><CardDescription>这些高影响操作尚未接入后端 API。</CardDescription></CardHeader><CardContent className="space-y-3"><UnavailableRow icon={KeyRound} title="转移 Owner" description="将工作空间所有权转移给其他成员" /><UnavailableRow icon={ShieldAlert} title="归档工作空间" description="停止使用但保留工作空间数据" /><UnavailableRow icon={ShieldAlert} title="删除工作空间" description="永久删除工作空间及其数据" /></CardContent></Card>;
}

export function WorkspaceSettingsPage({ workspaceId }) {
  const { membershipRole, refreshWorkspaces } = useWorkspaceContext();
  const canManage = roleAtLeast(membershipRole, "admin");
  const [workspace, setWorkspace] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [activeGroup, setActiveGroup] = useState("general");
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { setLoadError(null); try { const found = await getWorkspace(workspaceId); setWorkspace(found); setForm({ name: found.name || "", description: found.description || "" }); } catch (error) { setLoadError(error instanceof Error ? error : new Error(String(error))); } }, [workspaceId]);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => { event.preventDefault(); const name = form.name.trim(); if (!name) { notify.error("工作空间名称不能为空"); return; } setSaving(true); try { const updated = await updateWorkspace(workspaceId, { name, description: form.description }); setWorkspace((current) => ({ ...current, ...updated })); await refreshWorkspaces(); notify.success("工作空间设置已保存"); } catch (error) { notify.error("工作空间设置保存失败", { description: error instanceof Error ? error.message : String(error) }); } finally { setSaving(false); } };
  if (loadError) return <Card><CardHeader><CardTitle>无法加载工作空间设置</CardTitle><CardDescription>{loadError.message}</CardDescription></CardHeader><CardContent><Button onClick={load}>重试</Button></CardContent></Card>;
  if (!workspace) return <div className="py-16 text-center text-sm text-muted-foreground">正在加载设置…</div>;
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={membershipRole} title="工作空间设置" description={`${workspace.name} · 工作空间治理与配置`} /><SettingsTabs groups={settingGroups} activeGroup={activeGroup} onGroupChange={setActiveGroup} ariaLabel="工作空间设置分类"><WorkspaceSettingsContent group={activeGroup} workspace={workspace} canManage={canManage} form={form} setForm={setForm} saving={saving} onSave={save} /></SettingsTabs></div>;
}
