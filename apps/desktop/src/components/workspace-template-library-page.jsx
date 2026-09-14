import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Copy, FileText, Pencil, Plus, RefreshCw, ShieldCheck } from "@/components/ui/icons";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { ResourcePage } from "@/components/resource-page";
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
  updateCampaignTemplateVersion,
  updateReviewRecipe,
  updateReviewRecipeVersion,
} from "@/lib/campaign-api";

const Edit3 = Pencil;

const EMPTY_FORM_DEFINITION = {
  form: { schema_version: 1, blocks: [], fields: [], logic_rules: [], end_screen: {} },
  availability_policy: {},
  review_workflow: { schema_version: 1, mode: "AUTO_ACCEPT", rounds: [], request_changes: { enabled: false, target: "same_round" }, final_decision: "auto_accept" },
  materialization_plan: {},
};

const kindLabels = { REGISTRATION: "活动报名", SUBMISSION: "节目征集", RECRUITMENT: "人员招募", COLLECTION: "通用收集" };
const statusLabels = { draft: "草稿", published: "已发布", archived: "已归档", superseded: "历史版本" };

function statusBadge(status) {
  return <Badge variant={status === "published" ? "default" : status === "archived" ? "secondary" : "outline"}>{statusLabels[status] || status}</Badge>;
}

function DefinitionDialog({ open, title, initial, onClose, onSubmit, busy }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue(JSON.stringify(initial || {}, null, 2));
  }, [initial, open]);
  const submit = () => {
    try {
      onSubmit(JSON.parse(value));
    } catch (error) {
      notify.error("定义格式无效", { description: error?.message || "请输入合法 JSON" });
    }
  };
  return <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>草稿版本可编辑；发布后会形成不可变快照。</DialogDescription></DialogHeader><Textarea value={value} onChange={(event) => setValue(event.target.value)} className="min-h-80 font-mono text-xs" spellCheck={false} /><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button onClick={submit} disabled={busy}>保存草稿</Button></DialogFooter></DialogContent></Dialog>;
}

function VersionHistoryDialog({ open, mode, item, onClose }) {
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
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{item?.name || "模板"} · 版本历史</DialogTitle><DialogDescription>已发布版本是不可变快照；需要修改时请创建新的草稿版本。</DialogDescription></DialogHeader><div className="max-h-80 divide-y overflow-auto rounded-md border">{loading ? <p className="p-4 text-sm text-muted-foreground">正在加载…</p> : versions.length ? versions.map((version) => <div key={version.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="font-medium">v{version.version}</span>{statusBadge(version.status || (version.publishedAt ? "published" : "draft"))}<span className="min-w-0 flex-1 text-xs text-muted-foreground">{version.publishedAt ? `发布于 ${new Date(version.publishedAt).toLocaleString()}` : "草稿"}</span></div>) : <p className="p-4 text-sm text-muted-foreground">暂无版本。</p>}</div><DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter></DialogContent></Dialog>;
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
  return <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{source ? `复制${mode === "recipe" ? "审核方案" : "表单模板"}` : `新建${mode === "recipe" ? "审核方案" : "表单模板"}`}</DialogTitle><DialogDescription>{source ? "只复制已发布版本的结构和配置，不复制活动提交或审核任务。" : "创建后会生成一个可编辑的 Draft Version。"}</DialogDescription></DialogHeader><div className="space-y-4"><label className="block space-y-1 text-sm"><span>名称</span><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><label className="block space-y-1 text-sm"><span>描述</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>{mode !== "recipe" && <label className="block space-y-1 text-sm"><span>类型</span><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}</div><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button onClick={submit} disabled={busy}>创建草稿</Button></DialogFooter></DialogContent></Dialog>;
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
  const [definitionDialog, setDefinitionDialog] = useState(null);
  const [historyDialog, setHistoryDialog] = useState(null);

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
  const editTemplate = async (item) => {
    try {
      const versions = await listCampaignTemplateVersions(item.id);
      const draft = versions.items.find((version) => version.status === "draft");
      if (draft) setDefinitionDialog({ mode: "campaign", item, version: draft });
      else notify.message("当前没有草稿版本", { description: "请先创建一个新版本。" });
    } catch (error) { notify.error("读取模板版本失败", { description: error?.message || String(error) }); }
  };
  const editRecipe = async (item) => {
    try {
      const versions = await listReviewRecipeVersions(item.id);
      const draft = versions.items.find((version) => !version.publishedAt);
      if (draft) setDefinitionDialog({ mode: "recipe", item, version: draft });
      else notify.message("当前没有草稿版本", { description: "请先创建一个新版本。" });
    } catch (error) { notify.error("读取审核方案版本失败", { description: error?.message || String(error) }); }
  };
  const saveDefinition = async (definition) => {
    const current = definitionDialog;
    if (!current) return;
    try {
      await notify.promise(current.mode === "recipe" ? updateReviewRecipeVersion(current.item.id, current.version.id, { definition }, { etag: current.version.etag }) : updateCampaignTemplateVersion(current.item.id, current.version.id, { definition }, { etag: current.version.etag }), { loading: "正在保存草稿…", success: "草稿已保存", error: (error) => `保存失败：${error?.message || String(error)}` });
      setDefinitionDialog(null); await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
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

  const renderCampaignCard = (item) => <Card key={item.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{item.description || "暂无描述"}</CardDescription></div>{statusBadge(item.status)}</div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{kindLabels[item.kind] || item.kind}</Badge><span>最新 v{item.latestVersion || "—"}</span><span>发布 v{item.publishedVersion || "—"}</span></div><div className="flex flex-wrap gap-2">{item.scope === "system" ? <Button size="sm" variant="outline" onClick={() => copyTemplate(item)}><Copy />复制到工作空间</Button> : item.status === "archived" ? <span className="text-xs text-muted-foreground">已归档，只读</span> : <><Button size="sm" variant="outline" onClick={() => item.draftVersionId ? void editTemplate(item) : void createDraft(item, "campaign")}><Edit3 />{item.draftVersionId ? "编辑草稿" : "新建版本"}</Button>{item.draftVersionId ? <Button size="sm" onClick={() => void publish(item, "campaign")}><ShieldCheck />发布</Button> : null}<Button size="sm" variant="ghost" onClick={() => setHistoryDialog({ mode: "campaign", item })}>版本历史</Button><Button size="sm" variant="ghost" onClick={() => void archive(item, "campaign")}><Archive />归档</Button></>}</div></CardContent></Card>;
  const renderRecipeCard = (item) => <Card key={item.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{item.description || "暂无描述"}</CardDescription></div>{statusBadge(item.status)}</div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{item.scope === "system" ? "系统方案" : "工作空间方案"}</Badge><span>最新 v{item.latestVersion || "—"}</span><span>发布 v{item.publishedVersion || "—"}</span></div><div className="flex flex-wrap gap-2">{item.scope === "system" ? <Button size="sm" variant="outline" onClick={() => void copyRecipe(item)}><Copy />复制到工作空间</Button> : item.status === "archived" ? <span className="text-xs text-muted-foreground">已归档，只读</span> : <><Button size="sm" variant="outline" onClick={() => item.draftVersionId ? void editRecipe(item) : void createDraft(item, "recipe")}><Edit3 />{item.draftVersionId ? "编辑草稿" : "新建版本"}</Button>{item.draftVersionId ? <Button size="sm" onClick={() => void publish(item, "recipe")}><ShieldCheck />发布</Button> : null}<Button size="sm" variant="ghost" onClick={() => setHistoryDialog({ mode: "recipe", item })}>版本历史</Button><Button size="sm" variant="ghost" onClick={() => void archive(item, "recipe")}><Archive />归档</Button></>}</div></CardContent></Card>;
  const cards = tab === "campaign" ? filteredCampaigns.map(renderCampaignCard) : filteredRecipes.map(renderRecipeCard);

  const campaignEmpty = filteredCampaigns.length ? null : { title: "还没有表单模板", description: "从系统模板复制，或创建一份空白模板。", action: <Button onClick={() => setDialog({ mode: "campaign" })}><Plus />新建模板</Button> };
  const recipeEmpty = filteredRecipes.length ? null : { title: "还没有审核方案", description: "从系统方案复制，或创建一份自动确认方案。", action: <Button onClick={() => setDialog({ mode: "recipe" })}><Plus />新建方案</Button> };
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={workspace.role} title="模板与审核方案" description="管理可复用的表单模板和审核方案。已发布版本可供活动选择，草稿发布后形成不可变快照。" actions={<Button variant="outline" onClick={() => void load()}><RefreshCw />刷新</Button>} /><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="campaign"><FileText />表单模板</TabsTrigger><TabsTrigger value="recipe"><ShieldCheck />审核方案</TabsTrigger></TabsList><TabsContent value="campaign" className="mt-5"><ResourcePage title="表单模板" description="系统模板只读；工作空间模板可复制、编辑和发布。" count={filteredCampaigns.length} search={{ value: search, onChange: setSearch, placeholder: "搜索模板…" }} filters={<><select className="h-9 rounded-md border bg-background px-3 text-sm" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全部来源</option><option value="system">系统模板</option><option value="workspace">工作空间模板</option></select><select className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></>} view="grid" showViewToggle={false} onCreate={() => setDialog({ mode: "campaign" })} createLabel="新建模板" loading={loading} empty={campaignEmpty}>{<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div>}</ResourcePage></TabsContent><TabsContent value="recipe" className="mt-5"><ResourcePage title="审核方案" description="审核方案只保存可复用的 Production 角色，具体成员在 Campaign 内选择。" count={filteredRecipes.length} search={{ value: search, onChange: setSearch, placeholder: "搜索审核方案…" }} filters={<><select className="h-9 rounded-md border bg-background px-3 text-sm" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全部来源</option><option value="system">系统方案</option><option value="workspace">工作空间方案</option></select><select className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></>} view="grid" showViewToggle={false} onCreate={() => setDialog({ mode: "recipe" })} createLabel="新建方案" loading={loading} empty={recipeEmpty}>{<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div>}</ResourcePage></TabsContent></Tabs><CreateDialog open={Boolean(dialog)} mode={dialog?.mode} workspaceId={workspace.id} source={dialog?.source} onClose={() => setDialog(null)} onCreated={() => void load(true)} /><DefinitionDialog open={Boolean(definitionDialog)} title={definitionDialog?.mode === "recipe" ? "编辑审核方案草稿" : "编辑表单模板草稿"} initial={definitionDialog?.version?.definition} onClose={() => setDefinitionDialog(null)} onSubmit={saveDefinition} busy={false} /><VersionHistoryDialog open={Boolean(historyDialog)} mode={historyDialog?.mode} item={historyDialog?.item} onClose={() => setHistoryDialog(null)} /></div>;
}
