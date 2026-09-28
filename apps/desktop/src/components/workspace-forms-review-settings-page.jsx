import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { getWorkspaceReviewCatalog } from "@/lib/campaign-api";
import { isReviewCatalogDefaultSelectable, updateReviewCatalogSelection } from "@/lib/review-workflow-options";
import { roleAtLeast, updateWorkspaceReviewSettings } from "@/lib/workspace-api";

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

  return <Card variant="flush">
    <CardHeader className="border-b">
      <CardTitle>审核方式目录</CardTitle>
      <CardDescription>控制本工作空间的活动表单和表单模板可以选择哪些系统审核方式，并指定新建表单的默认方式。修改只影响之后的选择和发布，不会改写已发布内容。</CardDescription>
    </CardHeader>
    <CardContent className="p-0">
      {loadError ? <div className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm sm:px-5"><span className="min-w-0 text-muted-foreground">{loadError.message}</span><Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button></div> : null}
      {loading ? <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">正在加载审核目录…</p> : null}
      {catalog ? <>
        <div className="divide-y">
          {catalog.availableItems.map((item) => {
            const checked = catalog.enabledKeys.includes(item.key);
            const locked = checked && catalog.enabledKeys.length === 1;
            return <label key={item.key} className="flex cursor-pointer items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:bg-transparent sm:px-5">
              <Checkbox checked={checked} disabled={!canManage || saving || locked} onCheckedChange={(value) => toggleRecipe(item.key, value === true)} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{item.name}</span>
                  {catalog.defaultKey === item.key ? <Badge variant="secondary">默认</Badge> : null}
                  {locked ? <Badge variant="outline">至少保留一种</Badge> : null}
                  <Badge variant="outline">v{item.publishedVersion}</Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.description || "由系统提供的已发布方案"}</span>
              </span>
            </label>;
          })}
          {catalog.availableItems.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">当前没有已发布且可运行的系统审核方式，无法配置目录。</p> : null}
        </div>
        <div className="space-y-4 border-t px-4 py-4 sm:px-5">
          <p className="text-xs text-muted-foreground">只有已发布且可运行的系统方式会显示；未完成的审核模式不会作为选项出现。</p>
          <Field className="max-w-md">
            <FieldLabel htmlFor="workspace-default-review-recipe">新建表单默认方式</FieldLabel>
            <Select items={enabledItems.map((item) => ({ value: item.key, label: `${item.name} · v${item.publishedVersion}` }))} value={catalog.defaultKey} disabled={!canManage || saving || enabledItems.length < 2} onValueChange={setDefault}>
              <SelectTrigger id="workspace-default-review-recipe" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{enabledItems.map((item) => <SelectItem key={item.key} value={item.key}>{item.name} · v{item.publishedVersion}</SelectItem>)}</SelectContent>
            </Select>
            {enabledItems.length < 2 ? <p className="text-xs text-muted-foreground">当前只有一种可运行方式，它也是必需的默认方式。</p> : null}
          </Field>
          {!canManage ? <p className="text-xs text-muted-foreground">只有工作空间 Owner/Admin 可以修改审核目录。</p> : null}
        </div>
      </> : null}
    </CardContent>
  </Card>;
}

export function WorkspaceFormsReviewSettingsPage({ workspace }) {
  const { membershipRole } = useWorkspaceContext();
  const canManage = roleAtLeast(membershipRole, "admin");

  return <div className="space-y-6">
    <WorkspacePageHeader
      workspace={workspace}
      role={membershipRole}
      title="表单与审核"
      description="配置工作空间可用的审核方式，以及新建表单时采用的默认方式。"
    />
    <ReviewCatalogSettings workspaceId={workspace.id} canManage={canManage} />
  </div>;
}
