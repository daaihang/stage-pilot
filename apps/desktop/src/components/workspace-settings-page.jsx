import { useCallback, useEffect, useState } from "react";
import { Bell, Cable, Database, FileText, KeyRound, LockKeyhole, Save, Settings2, ShieldAlert } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { SettingsTabs } from "@/components/settings-tabs";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { getWorkspaceReviewCatalog } from "@/lib/campaign-api";
import { getWorkspace, getWorkspacePlanningSettings, roleAtLeast, updateWorkspace, updateWorkspacePlanningSettings, updateWorkspaceReviewSettings } from "@/lib/workspace-api";
import { isReviewCatalogDefaultSelectable, updateReviewCatalogSelection } from "@/lib/review-workflow-options";

const settingGroups = [["general", "常规", Settings2], ["forms", "表单与审核", FileText], ["notifications", "通知", Bell], ["integrations", "集成", Cable], ["security", "安全与数据", LockKeyhole], ["danger", "危险区域", ShieldAlert]];

function PlanningSettings({ workspaceId, canManage }) { const [value, setValue] = useState(true); const [loaded, setLoaded] = useState(false); useEffect(() => { getWorkspacePlanningSettings(workspaceId).then((data) => { setValue(data.require_actual_start_before_completion !== false); setLoaded(true); }).catch(() => setLoaded(true)); }, [workspaceId]); const save = async (checked) => { setValue(checked); const toast = notify.loading("正在保存排程规则…"); try { await updateWorkspacePlanningSettings(workspaceId, { require_actual_start_before_completion: checked }); notify.success("排程规则已保存", { id: toast }); } catch (error) { setValue(!checked); notify.error("排程规则保存失败", { id: toast, description: error?.message || String(error) }); } }; return <Card><CardHeader><CardTitle>排程规则</CardTitle><CardDescription>设置场次和彩排是否必须先开始，才能标记为已结束。</CardDescription></CardHeader><CardContent><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">必须先开始才能结束</p><p className="mt-1 text-xs text-muted-foreground">Production 未单独覆盖时继承此默认值。</p></div><Switch checked={value} disabled={!canManage || !loaded} onCheckedChange={save} /></div></CardContent></Card>; }

function DefaultActivityTimezone({ workspaceId, timezone, canManage, onSaved }) {
    const [value, setValue] = useState(timezone || "Asia/Shanghai");
    const [saving, setSaving] = useState(false);
    useEffect(() => { setValue(timezone || "Asia/Shanghai"); }, [timezone]);
    const save = async (nextTimezone) => {
      // Base UI may return either the option object or its raw value depending
      // on the trigger path. Normalize it before updating local state or
      // serializing the PATCH body; JSON.stringify drops undefined fields.
      const resolvedTimezone = typeof nextTimezone === "string"
        ? nextTimezone.trim()
        : nextTimezone?.value?.trim?.() || "";
      if (!resolvedTimezone) {
        notify.error("默认活动时区保存失败", { description: "请选择一个有效的时区。" });
        return;
      }
      setValue(resolvedTimezone);
      setSaving(true);
      try {
        const settings = await updateWorkspacePlanningSettings(workspaceId, { default_timezone: resolvedTimezone });
        setValue(settings.default_timezone || resolvedTimezone);
        onSaved?.(settings.default_timezone || resolvedTimezone);
      notify.success("默认活动时区已保存");
    } catch (error) {
      setValue(timezone || "Asia/Shanghai");
      notify.error("默认活动时区保存失败", { description: error?.message || String(error) });
    } finally {
      setSaving(false);
    }
  };
  return <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium">默认活动时区</p><p className="text-xs text-muted-foreground">新建活动时的默认时区；已有活动不会自动跟随修改。</p></div><div className="shrink-0"><TimezoneCombobox value={value} onValueChange={save} disabled={!canManage || saving} className="w-64" /></div></div>;
}

function ReviewCatalogSettings({ workspaceId, canManage }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCatalog(await getWorkspaceReviewCatalog(workspaceId));
    } catch (error) {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
      notify.error("审核目录加载失败", { description: error?.message || String(error) });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (enabledKeys, defaultKey) => {
    setSaving(true);
    try {
      const updated = await notify.promise((async () => {
        await updateWorkspaceReviewSettings(workspaceId, {
          enabled_review_recipe_keys: enabledKeys,
          default_review_recipe_key: defaultKey,
        });
        return getWorkspaceReviewCatalog(workspaceId);
      })(), {
        loading: "正在保存审核目录…",
        success: "审核目录已保存",
        error: (error) => `保存失败：${error?.message || String(error)}`,
      });
      setCatalog(updated);
    } catch { /* notify.promise owns feedback */ } finally {
      setSaving(false);
    }
  };

  const toggleRecipe = (key, checked) => {
    if (!catalog) return;
    const selection = updateReviewCatalogSelection(catalog.enabledKeys, catalog.defaultKey, key, checked);
    if (selection.changed) void save(selection.enabledKeys, selection.defaultKey);
  };

  const setDefault = (key) => {
    if (!catalog || !isReviewCatalogDefaultSelectable(catalog.enabledKeys, key)) return;
    void save(catalog.enabledKeys, key);
  };

  const enabledItems = catalog?.availableItems.filter((item) => catalog.enabledKeys.includes(item.key)) || [];
  return <Card>
    <CardHeader>
      <CardTitle>审核方式目录</CardTitle>
      <CardDescription>控制本工作空间的活动表单和表单模板可以选择哪些系统审核方式，并指定新建表单的默认方式。修改只影响之后的选择和发布，不会改写已发布内容。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      {loadError ? <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-sm"><span className="text-muted-foreground">{loadError.message}</span><Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button></div> : null}
      {loading ? <p className="text-sm text-muted-foreground">正在加载审核目录…</p> : null}
      {catalog ? <>
        <div className="space-y-2">
          <p className="text-sm font-medium">表单可选方式</p>
          <div className="divide-y rounded-md border">
            {catalog.availableItems.map((item) => {
              const checked = catalog.enabledKeys.includes(item.key);
              const locked = checked && catalog.enabledKeys.length === 1;
              return <label key={item.key} className="flex items-start gap-3 p-3">
                <Checkbox checked={checked} disabled={!canManage || saving || locked} onCheckedChange={(value) => toggleRecipe(item.key, value === true)} />
                <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{item.name}{catalog.defaultKey === item.key ? <Badge variant="secondary">默认</Badge> : null}{locked ? <Badge variant="outline">至少保留一种</Badge> : null}</span><span className="mt-1 block text-xs text-muted-foreground">{item.description || "由系统提供的已发布方案"} · v{item.publishedVersion}</span></span>
              </label>;
            })}
            {catalog.availableItems.length === 0 ? <p className="p-3 text-sm text-muted-foreground">当前没有已发布且可运行的系统审核方式，无法配置目录。</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">只有已发布且可运行的系统方式会显示；未完成的审核模式不会作为选项出现。</p>
        </div>
        <Field>
          <FieldLabel htmlFor="workspace-default-review-recipe">新建表单默认方式</FieldLabel>
          <Select items={enabledItems.map((item) => ({ value: item.key, label: `${item.name} · v${item.publishedVersion}` }))} value={catalog.defaultKey} disabled={!canManage || saving || enabledItems.length < 2} onValueChange={setDefault}>
            <SelectTrigger id="workspace-default-review-recipe" className="w-full sm:max-w-md"><SelectValue /></SelectTrigger>
            <SelectContent>{enabledItems.map((item) => <SelectItem key={item.key} value={item.key}>{item.name} · v{item.publishedVersion}</SelectItem>)}</SelectContent>
          </Select>
          {enabledItems.length < 2 ? <p className="text-xs text-muted-foreground">当前只有一种可运行方式，它也是必需的默认方式。</p> : null}
        </Field>
        {!canManage ? <p className="text-xs text-muted-foreground">只有工作空间 Owner/Admin 可以修改审核目录。</p> : null}
      </> : null}
    </CardContent>
  </Card>;
}

function UnavailableRow({ icon: Icon, title, description, value = "尚未接入" }) {
  return <div className="flex items-center gap-3 border-b py-4 last:border-b-0 opacity-55 blur-[1px]"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Badge variant="outline">{value}</Badge></div>;
}

function GeneralSettings({ workspace, canManage, form, setForm, saving, onSave, onTimezoneSaved }) {
  return <div className="space-y-4"><Card><CardHeader><CardDescription>工作空间的身份信息。{canManage ? "修改后保存本组设置。" : "当前角色只能查看。"}</CardDescription></CardHeader><CardContent className="space-y-5"><form className="space-y-4" onSubmit={onSave}><label className="block space-y-1.5"><span className="text-sm font-medium">名称</span><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} disabled={!canManage} /></label><label className="block space-y-1.5"><span className="text-sm font-medium">描述</span><Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} disabled={!canManage} /></label><div className="space-y-1.5"><span className="text-sm font-medium">Slug</span><p className="flex h-9 items-center border bg-muted/40 px-3 text-sm text-muted-foreground">{workspace.slug}</p></div>{canManage && <Button type="submit" disabled={saving}><Save />{saving ? "保存中…" : "保存常规设置"}</Button>}</form><DefaultActivityTimezone workspaceId={workspace.id} timezone={workspace.default_timezone} canManage={canManage} onSaved={onTimezoneSaved} /></CardContent></Card><PlanningSettings workspaceId={workspace.id} canManage={canManage} /></div>;
}

function WorkspaceSettingsContent({ group, workspace, canManage, form, setForm, saving, onSave, onTimezoneSaved }) {
  if (group === "general") return <GeneralSettings workspace={workspace} canManage={canManage} form={form} setForm={setForm} saving={saving} onSave={onSave} onTimezoneSaved={onTimezoneSaved} />;
  if (group === "forms") return <ReviewCatalogSettings workspaceId={workspace.id} canManage={canManage} />;
  if (group === "notifications") return <Card><CardHeader><CardDescription>工作空间级通知配置尚未接入。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Bell} title="成员加入通知" description="成员加入或离开工作空间时通知管理员" /><UnavailableRow icon={Bell} title="新活动通知" description="工作空间创建新活动时通知成员" /><UnavailableRow icon={Bell} title="系统通知" description="接收 StagePilot 工作空间系统消息" /></CardContent></Card>;
  if (group === "integrations") return <Card><CardHeader><CardDescription>工作空间共享的外部服务连接。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Cable} title="日历" description="同步工作空间活动到外部日历" value="未连接" /><UnavailableRow icon={Cable} title="文件存储" description="连接工作空间文件存储服务" value="未连接" /><UnavailableRow icon={Cable} title="Webhook / API" description="向外部系统推送工作空间事件" value="未连接" /></CardContent></Card>;
  if (group === "security") return <Card><CardHeader><CardDescription>工作空间的安全和数据治理能力尚未接入。</CardDescription></CardHeader><CardContent><UnavailableRow icon={Database} title="审计日志" description="查看成员和数据操作记录" /><UnavailableRow icon={Database} title="数据导出" description="导出工作空间中的业务数据" /><UnavailableRow icon={LockKeyhole} title="会话与安全" description="管理工作空间安全策略" /></CardContent></Card>;
  return <Card className="border-destructive/30"><CardHeader><CardDescription>这些高影响操作尚未接入后端 API。</CardDescription></CardHeader><CardContent className="space-y-3"><UnavailableRow icon={KeyRound} title="转移 Owner" description="将工作空间所有权转移给其他成员" /><UnavailableRow icon={ShieldAlert} title="归档工作空间" description="停止使用但保留工作空间数据" /><UnavailableRow icon={ShieldAlert} title="删除工作空间" description="永久删除工作空间及其数据" /></CardContent></Card>;
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
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={membershipRole} title="工作空间设置" description={`${workspace.name} · 工作空间治理与配置`} /><SettingsTabs groups={settingGroups} activeGroup={activeGroup} onGroupChange={setActiveGroup} ariaLabel="工作空间设置分类"><WorkspaceSettingsContent group={activeGroup} workspace={workspace} canManage={canManage} form={form} setForm={setForm} saving={saving} onSave={save} onTimezoneSaved={(defaultTimezone) => { setWorkspace((current) => ({ ...current, default_timezone: defaultTimezone })); void refreshWorkspaces(); }} /></SettingsTabs></div>;
}
