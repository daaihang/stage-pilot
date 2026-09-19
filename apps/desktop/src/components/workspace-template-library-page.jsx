import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Copy, FileText, Pencil, Plus, RefreshCw, ShieldCheck } from "@/components/ui/icons";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { ResourcePage } from "@/components/resource-page";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { CampaignFormBuilder, CampaignFormPreview, CampaignResultsEditor, CampaignReviewEditor, CampaignRulesEditor } from "@/components/campaign-form-builder";
import { TemplateDraftProvider, TemplateEditorShell } from "@/components/workspace-template-draft-context";
import { useCampaignRevisionDraft } from "@/components/campaign-revision-draft-context";
import {
  createWorkspaceCampaignTemplate,
  createCampaignTemplateVersion,
  createWorkspaceReviewRecipe,
  createReviewRecipeVersion,
  getCampaignTemplate,
  getReviewRecipe,
  listCampaignTemplateVersions,
  listCampaignTemplates,
  listReviewRecipes,
  listWorkspaceCampaignTemplates,
  listWorkspaceReviewRecipes,
  listReviewRecipeVersions,
  publishCampaignTemplateVersion,
  publishReviewRecipeVersion,
  updateCampaignTemplate,
  updateReviewRecipe,
} from "@/lib/campaign-api";

const Edit3 = Pencil;

const EMPTY_FORM_DEFINITION = {
  form: { schema_version: 1, blocks: [], fields: [], logic_rules: [], end_screen: {} },
  availability_policy: {},
  review_workflow: { schema_version: 1, mode: "AUTO_ACCEPT", rounds: [], request_changes: { enabled: false, target: "same_round" }, final_decision: "auto_accept" },
  materialization_plan: {},
};

const kindLabels = { REGISTRATION: "活动报名", SUBMISSION: "节目征集", RECRUITMENT: "人员招募", COLLECTION: "通用收集" };

function TemplateLibraryFilters({ scope, status, onScopeChange, onStatusChange, entityLabel }) {
  return <div className="flex flex-wrap gap-2">
    <Select value={scope} onValueChange={onScopeChange}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem><SelectItem value="system">系统{entityLabel}</SelectItem><SelectItem value="workspace">工作空间{entityLabel}</SelectItem></SelectContent></Select>
    <Select value={status} onValueChange={onStatusChange}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="published">已发布</SelectItem><SelectItem value="archived">已归档</SelectItem></SelectContent></Select>
  </div>;
}
const statusLabels = { draft: "草稿", published: "已发布", archived: "已归档", superseded: "历史版本" };

function statusBadge(status) {
  return <Badge variant={status === "published" ? "default" : status === "archived" ? "secondary" : "outline"}>{statusLabels[status] || status}</Badge>;
}

function VersionHistoryDialog({ open, mode, item, onClose, onCopyVersion, onOpenVersion }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !item) return;
    let active = true;
    setLoading(true);
    const loadVersions = mode === "recipe" ? listReviewRecipeVersions(item.id) : listCampaignTemplateVersions(item.id);
    loadVersions.then((result) => { if (active) setVersions(result.items || []); }).catch((error) => { if (active) notify.error("读取版本历史失败", { description: error?.message || String(error) }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item, mode, open]);
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{item?.name || "模板"} · 版本历史</DialogTitle><DialogDescription>已发布版本是不可变快照；需要修改时请创建新的草稿版本。</DialogDescription></DialogHeader><div className="max-h-80 divide-y overflow-auto rounded-md border">{loading ? <p className="p-4 text-sm text-muted-foreground">正在加载…</p> : versions.length ? versions.map((version) => { const versionStatus = version.status || (version.publishedAt ? "published" : "draft"); return <div key={version.id} className="flex items-center gap-3 px-3 py-2 text-sm"><Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenVersion?.(version)}>v{version.version}</Button>{statusBadge(versionStatus)}<span className="min-w-0 flex-1 text-xs text-muted-foreground">{version.publishedAt ? `发布于 ${new Date(version.publishedAt).toLocaleString()}` : "草稿"}</span>{versionStatus !== "draft" ? <Button type="button" variant="outline" size="sm" onClick={() => onCopyVersion?.(version)}>复制为草稿</Button> : null}</div>; }) : <p className="p-4 text-sm text-muted-foreground">暂无版本。</p>}</div><DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter></DialogContent></Dialog>;
}

function TemplatePreview({ mode, template }) {
  const draft = useCampaignRevisionDraft();
  if (mode === "recipe") {
    return <Card><CardHeader><CardTitle className="text-sm">审核方案预览</CardTitle><CardDescription>当前版本的可复用角色和审核轮次快照。</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><p>模式：{draft.reviewWorkflow?.mode || "AUTO_ACCEPT"}</p><p>审核轮次：{Array.isArray(draft.reviewWorkflow?.rounds) ? draft.reviewWorkflow.rounds.length : 0}</p><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(draft.reviewWorkflow || {}, null, 2)}</pre></CardContent></Card>;
  }
  return <div className="space-y-3"><div className="text-xs text-muted-foreground">预览使用当前 Draft 的规范化 FormVersion，不会创建提交记录。</div><CampaignFormPreview form={draft.form} campaignKind={template?.kind} reviewWorkflow={draft.reviewWorkflow} descriptionFallback={template?.description} title={template?.name || "表单模板预览"} /></div>;
}

function TemplateDetailPanel({ mode, template, version, workspace, onChanged }) {
  const [tab, setTab] = useState(mode === "recipe" ? "review" : "form");
  useEffect(() => setTab(mode === "recipe" ? "review" : "form"), [mode, version?.id]);
  if (!version) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">正在加载版本…</div>;
  const groups = mode === "recipe" ? [{ value: "review", label: "审核" }, { value: "preview", label: "预览" }] : [{ value: "form", label: "表单" }, { value: "rules", label: "规则" }, { value: "review", label: "审核" }, { value: "results", label: "结果" }, { value: "preview", label: "预览" }];
  const versionStatus = version.status || (version.publishedAt ? "published" : "draft");
  return <div className="min-h-full space-y-4 p-1"><div className="border-b pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{mode === "recipe" ? "审核方案" : "表单模板"} · v{version.version}</p><h2 className="truncate text-lg font-semibold">{template.name}</h2><p className="mt-1 text-xs text-muted-foreground">{versionStatus === "draft" ? "草稿可编辑，发布后将成为不可变快照。" : "已发布版本只读；需要修改时请创建新版本。"}</p></div>{statusBadge(versionStatus)}</div></div><TemplateDraftProvider mode={mode} template={template} version={version} workspace={workspace} onSaved={() => onChanged?.()} onPublished={() => onChanged?.()}><TemplateEditorShell mode={mode}><div className="space-y-4"><div className="flex flex-wrap gap-1 border-b pb-2">{groups.map((item) => <Button key={item.value} type="button" size="sm" variant={tab === item.value ? "secondary" : "ghost"} onClick={() => setTab(item.value)}>{item.label}</Button>)}</div>{tab === "form" ? <CampaignFormBuilder /> : null}{tab === "rules" ? <CampaignRulesEditor /> : null}{tab === "review" ? <CampaignReviewEditor /> : null}{tab === "results" ? <CampaignResultsEditor /> : null}{tab === "preview" ? <TemplatePreview mode={mode} template={template} /> : null}</div></TemplateEditorShell></TemplateDraftProvider></div>;
}

function CreateDialog({ open, mode, workspaceId, source, onClose, onCreated }) {
  const [name, setName] = useState(source?.name || "");
  const [description, setDescription] = useState(source?.description || "");
  const [kind, setKind] = useState(source?.kind || "SUBMISSION");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(source?.name || ""); setDescription(source?.description || ""); setKind(source?.kind || "SUBMISSION");
    }
  }, [open, source]);
  const submit = async () => {
    if (!name.trim()) return notify.error("名称不能为空");
    setBusy(true);
    try {
      const result = mode === "recipe"
        ? await notify.promise(createWorkspaceReviewRecipe(workspaceId, { name, description, source_recipe_version_id: source?.versionId }), { loading: "正在创建审核方案…", success: "审核方案草稿已创建", error: (error) => `创建失败：${error?.message || String(error)}` })
        : await notify.promise(createWorkspaceCampaignTemplate(workspaceId, { name, description, kind, source_template_version_id: source?.versionId }), { loading: "正在创建表单模板…", success: "表单模板草稿已创建", error: (error) => `创建失败：${error?.message || String(error)}` });
      onCreated(result);
      onClose();
    } catch { /* notify.promise owns feedback */ } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{source ? `复制${mode === "recipe" ? "审核方案" : "表单模板"}` : `新建${mode === "recipe" ? "审核方案" : "表单模板"}`}</DialogTitle><DialogDescription>{source ? "只复制已发布版本的结构和配置，不复制活动提交或审核任务。" : "创建后会生成一个可编辑的 Draft Version。"}</DialogDescription></DialogHeader><div className="space-y-4"><Field><FieldLabel htmlFor="template-name">名称</FieldLabel><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field><Field><FieldLabel htmlFor="template-description">描述</FieldLabel><Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{mode !== "recipe" && <Field><FieldLabel htmlFor="template-kind">类型</FieldLabel><Select value={kind} onValueChange={setKind}><SelectTrigger id="template-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kindLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>}</div><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button onClick={submit} disabled={busy}>创建草稿</Button></DialogFooter></DialogContent></Dialog>;
}

export function WorkspaceTemplateLibraryPage({ route, workspace }) {
  const [tab, setTab] = useState("campaign");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [campaignTemplates, setCampaignTemplates] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [historyDialog, setHistoryDialog] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailVersion, setDetailVersion] = useState(null);
  const detailTriggerRef = useRef(null);
  const { setDetailOpen } = useWindowDetail();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [systemCampaignResult, campaignResult, systemRecipeResult, recipeResult] = await Promise.all([
        listCampaignTemplates({ status: status === "all" ? undefined : status }),
        listWorkspaceCampaignTemplates(workspace.id, { status: status === "all" ? undefined : status }),
        listReviewRecipes({ status: status === "all" ? undefined : status }),
        listWorkspaceReviewRecipes(workspace.id, { status: status === "all" ? undefined : status }),
      ]);
      setCampaignTemplates([...(systemCampaignResult.items || []), ...(campaignResult.items || [])]); setRecipes([...(systemRecipeResult.items || []), ...(recipeResult.items || [])]);
    } catch (error) {
      notify.error("模板库加载失败", { description: error?.message || String(error) });
    } finally { if (!silent) setLoading(false); }
  }, [status, workspace.id]);
  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (mode, item, trigger = null) => {
    if (trigger) detailTriggerRef.current = trigger;
    setDetail({ mode, item });
    setDetailVersion(null);
    try {
      const result = mode === "recipe" ? await listReviewRecipeVersions(item.id) : await listCampaignTemplateVersions(item.id);
      const versions = result.items || [];
      const selectedVersion = item.draftVersionId
        ? versions.find((version) => version.id === item.draftVersionId)
        : null;
      setDetailVersion(selectedVersion || versions.find((version) => version.id === item.publishedVersionId) || versions[0] || null);
    } catch (error) {
      setDetail(null);
      notify.error("读取模板详情失败", { description: error?.message || String(error) });
    }
  }, []);
  const openVersionDetail = useCallback((mode, item, version) => {
    setDetail({ mode, item });
    setDetailVersion(version);
    setHistoryDialog(null);
  }, []);

  const detailContent = useCallback(() => detail ? <TemplateDetailPanel mode={detail.mode} template={detail.item} version={detailVersion} workspace={workspace} onChanged={async () => { await load(true); }} /> : null, [detail, detailVersion, load, workspace]);
  useWindowDetailRegistration({ key: `workspace-template-library:${workspace.id}`, storageKey: "detailPane:workspace-template-library:v1", detailLabel: detail?.mode === "recipe" ? "审核方案详情" : "表单模板详情", triggerRef: detailTriggerRef, getDetail: detailContent, onClose: () => { setDetail(null); setDetailVersion(null); } });
  useEffect(() => {
    setDetailOpen(Boolean(detail), { announce: false });
  }, [detail, setDetailOpen]);

  const filteredCampaigns = useMemo(() => campaignTemplates.filter((item) => (scope === "all" || item.scope === scope) && (!search.trim() || `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()))), [campaignTemplates, scope, search]);
  const filteredRecipes = useMemo(() => recipes.filter((item) => (scope === "all" || item.scope === scope) && (!search.trim() || `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()))), [recipes, scope, search]);
  const copyTemplate = (item) => setDialog({ mode: "campaign", source: { ...item, versionId: item.publishedVersionId } });
  const copyRecipe = async (item) => {
    try {
      const versions = await listReviewRecipeVersions(item.id);
      const published = versions.items.find((version) => version.id === item.publishedVersionId) || versions.items.find((version) => version.publishedAt);
      setDialog({ mode: "recipe", source: { ...item, versionId: published?.id } });
    } catch (error) { notify.error("读取审核方案版本失败", { description: error?.message || String(error) }); }
  };
  const createDraft = async (item, mode) => {
    try {
      await notify.promise(mode === "recipe" ? createReviewRecipeVersion(item.id) : createCampaignTemplateVersion(item.id), { loading: "正在创建新草稿…", success: "新草稿已创建", error: (error) => `创建失败：${error?.message || String(error)}` });
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const copyVersion = async (item, mode, version) => {
    try {
      await notify.promise(
        mode === "recipe"
          ? createReviewRecipeVersion(item.id, { definition: version.definition })
          : createCampaignTemplateVersion(item.id, { definition: version.definition, review_recipe_version_id: version.reviewRecipeVersionId || null }),
        { loading: "正在复制版本…", success: "已创建新草稿", error: (error) => `复制失败：${error?.message || String(error)}` },
      );
      setHistoryDialog(null);
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const editTemplate = (item) => item.draftVersionId ? void openDetail("campaign", item) : notify.message("当前没有草稿版本", { description: "请先创建一个新版本。" });
  const editRecipe = (item) => item.draftVersionId ? void openDetail("recipe", item) : notify.message("当前没有草稿版本", { description: "请先创建一个新版本。" });
  const publish = async (item, mode) => {
    try {
      if (mode === "recipe") {
        const versions = await listReviewRecipeVersions(item.id); const draft = versions.items.find((version) => !version.publishedAt);
        if (!draft) return notify.message("没有可发布的草稿");
        await notify.promise(publishReviewRecipeVersion(item.id, draft.id, { etag: draft.etag }), { loading: "正在发布审核方案…", success: "审核方案已发布", error: (error) => `发布失败：${error?.message || String(error)}` });
      } else {
        const versions = await listCampaignTemplateVersions(item.id); const draft = versions.items.find((version) => version.status === "draft");
        if (!draft) return notify.message("没有可发布的草稿");
        await notify.promise(publishCampaignTemplateVersion(item.id, draft.id, { etag: draft.etag }), { loading: "正在发布模板…", success: "模板已发布", error: (error) => `发布失败：${error?.message || String(error)}` });
      }
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const archive = async (item, mode) => {
    try {
      await notify.promise((async () => {
        const current = mode === "recipe" ? await getReviewRecipe(item.id) : await getCampaignTemplate(item.id);
        return mode === "recipe" ? updateReviewRecipe(item.id, { status: "archived" }, { etag: current.etag }) : updateCampaignTemplate(item.id, { status: "archived" }, { etag: current.etag });
      })(), { loading: "正在归档…", success: "已归档", error: (error) => `归档失败：${error?.message || String(error)}` });
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };

  const renderCampaignCard = (item) => <Card key={item.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{item.description || "暂无描述"}</CardDescription></div>{statusBadge(item.status)}</div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{kindLabels[item.kind] || item.kind}</Badge><span>最新 v{item.latestVersion || "—"}</span><span>发布 v{item.publishedVersion || "—"}</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={(event) => void openDetail("campaign", item, event.currentTarget)}>查看详情</Button>{item.scope === "system" ? <Button size="sm" variant="outline" onClick={() => copyTemplate(item)}><Copy />复制到工作空间</Button> : item.status === "archived" ? <span className="text-xs text-muted-foreground">已归档，只读</span> : <><Button size="sm" variant="outline" onClick={() => item.draftVersionId ? void editTemplate(item) : void createDraft(item, "campaign")}><Edit3 />{item.draftVersionId ? "编辑草稿" : "新建版本"}</Button>{item.draftVersionId ? <Button size="sm" onClick={() => void publish(item, "campaign")}><ShieldCheck />发布</Button> : null}<Button size="sm" variant="ghost" onClick={() => setHistoryDialog({ mode: "campaign", item })}>版本历史</Button><Button size="sm" variant="ghost" onClick={() => void archive(item, "campaign")}><Archive />归档</Button></>}</div></CardContent></Card>;
  const renderRecipeCard = (item) => <Card key={item.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{item.description || "暂无描述"}</CardDescription></div>{statusBadge(item.status)}</div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{item.scope === "system" ? "系统方案" : "工作空间方案"}</Badge><span>最新 v{item.latestVersion || "—"}</span><span>发布 v{item.publishedVersion || "—"}</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={(event) => void openDetail("recipe", item, event.currentTarget)}>查看详情</Button>{item.scope === "system" ? <Button size="sm" variant="outline" onClick={() => void copyRecipe(item)}><Copy />复制到工作空间</Button> : item.status === "archived" ? <span className="text-xs text-muted-foreground">已归档，只读</span> : <><Button size="sm" variant="outline" onClick={() => item.draftVersionId ? void editRecipe(item) : void createDraft(item, "recipe")}><Edit3 />{item.draftVersionId ? "编辑草稿" : "新建版本"}</Button>{item.draftVersionId ? <Button size="sm" onClick={() => void publish(item, "recipe")}><ShieldCheck />发布</Button> : null}<Button size="sm" variant="ghost" onClick={() => setHistoryDialog({ mode: "recipe", item })}>版本历史</Button><Button size="sm" variant="ghost" onClick={() => void archive(item, "recipe")}><Archive />归档</Button></>}</div></CardContent></Card>;
  const cards = tab === "campaign" ? filteredCampaigns.map(renderCampaignCard) : filteredRecipes.map(renderRecipeCard);

  const campaignEmpty = filteredCampaigns.length ? null : { title: "还没有表单模板", description: "从系统模板复制，或创建一份空白模板。", action: <Button onClick={() => setDialog({ mode: "campaign" })}><Plus />新建模板</Button> };
  const recipeEmpty = filteredRecipes.length ? null : { title: "还没有审核方案", description: "从系统方案复制，或创建一份自动确认方案。", action: <Button onClick={() => setDialog({ mode: "recipe" })}><Plus />新建方案</Button> };
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={workspace.role} title="模板与审核方案" description="管理可复用的表单模板和审核方案。已发布版本可供活动选择，草稿发布后形成不可变快照。" actions={<Button variant="outline" onClick={() => void load()}><RefreshCw />刷新</Button>} /><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="campaign"><FileText />表单模板</TabsTrigger><TabsTrigger value="recipe"><ShieldCheck />审核方案</TabsTrigger></TabsList><TabsContent value="campaign" className="mt-5"><ResourcePage title="表单模板" description="系统模板只读；工作空间模板可复制、编辑和发布。" count={filteredCampaigns.length} search={{ value: search, onChange: setSearch, placeholder: "搜索模板…" }} filters={<TemplateLibraryFilters scope={scope} status={status} onScopeChange={setScope} onStatusChange={setStatus} entityLabel="模板" />} view="grid" showViewToggle={false} onCreate={() => setDialog({ mode: "campaign" })} createLabel="新建模板" loading={loading} empty={campaignEmpty}>{<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div>}</ResourcePage></TabsContent><TabsContent value="recipe" className="mt-5"><ResourcePage title="审核方案" description="审核方案只保存可复用的 Production 角色，具体成员在 Campaign 内选择。" count={filteredRecipes.length} search={{ value: search, onChange: setSearch, placeholder: "搜索审核方案…" }} filters={<TemplateLibraryFilters scope={scope} status={status} onScopeChange={setScope} onStatusChange={setStatus} entityLabel="方案" />} view="grid" showViewToggle={false} onCreate={() => setDialog({ mode: "recipe" })} createLabel="新建方案" loading={loading} empty={recipeEmpty}>{<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div>}</ResourcePage></TabsContent></Tabs><CreateDialog open={Boolean(dialog)} mode={dialog?.mode} workspaceId={workspace.id} source={dialog?.source} onClose={() => setDialog(null)} onCreated={() => void load(true)} /><VersionHistoryDialog open={Boolean(historyDialog)} mode={historyDialog?.mode} item={historyDialog?.item} onClose={() => setHistoryDialog(null)} onCopyVersion={(version) => void copyVersion(historyDialog.item, historyDialog.mode, version)} onOpenVersion={(version) => openVersionDetail(historyDialog.mode, historyDialog.item, version)} /></div>;
}
