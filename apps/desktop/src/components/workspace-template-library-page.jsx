import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Copy, Pencil, Plus, RefreshCw, ShieldCheck } from "@/components/ui/icons";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  getCampaignTemplate,
  listCampaignTemplateVersions,
  listCampaignTemplates,
  listWorkspaceCampaignTemplates,
  publishCampaignTemplateVersion,
  updateCampaignTemplate,
} from "@/lib/campaign-api";

const Edit3 = Pencil;

const kindLabels = { REGISTRATION: "活动报名", SUBMISSION: "节目征集", RECRUITMENT: "人员招募", COLLECTION: "通用收集" };

function TemplateLibraryFilters({ scope, status, onScopeChange, onStatusChange, entityLabel }) {
  const scopeOptions = [{ value: "all", label: "全部来源" }, { value: "system", label: `系统${entityLabel}` }, { value: "workspace", label: `工作空间${entityLabel}` }];
  const statusOptions = [{ value: "all", label: "全部状态" }, { value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "archived", label: "已归档" }];
  return <div className="flex flex-wrap gap-2">
    <Select items={scopeOptions} value={scope} onValueChange={onScopeChange}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{scopeOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
    <Select items={statusOptions} value={status} onValueChange={onStatusChange}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
  </div>;
}
const statusLabels = { draft: "草稿", published: "已发布", archived: "已归档", superseded: "历史版本" };

function statusBadge(status) {
  return <Badge variant={status === "published" ? "default" : status === "archived" ? "secondary" : "outline"}>{statusLabels[status] || status}</Badge>;
}

function VersionHistoryDialog({ open, item, onClose, onCopyVersion, onOpenVersion }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !item) return undefined;
    let active = true;
    setLoading(true);
    listCampaignTemplateVersions(item.id)
      .then((result) => { if (active) setVersions(result.items || []); })
      .catch((error) => { if (active) notify.error("读取版本历史失败", { description: error?.message || String(error) }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item, open]);
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{item?.name || "模板"} · 版本历史</DialogTitle><DialogDescription>已发布版本是不可变快照；需要修改时请创建新的草稿版本。</DialogDescription></DialogHeader><div className="max-h-80 divide-y overflow-auto rounded-md border">{loading ? <p className="p-4 text-sm text-muted-foreground">正在加载…</p> : versions.length ? versions.map((version) => { const versionStatus = version.status || (version.publishedAt ? "published" : "draft"); return <div key={version.id} className="flex items-center gap-3 px-3 py-2 text-sm"><Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenVersion?.(version)}>v{version.version}</Button>{statusBadge(versionStatus)}<span className="min-w-0 flex-1 text-xs text-muted-foreground">{version.publishedAt ? `发布于 ${new Date(version.publishedAt).toLocaleString()}` : "草稿"}</span>{versionStatus !== "draft" ? <Button type="button" variant="outline" size="sm" onClick={() => onCopyVersion?.(version)}>复制为草稿</Button> : null}</div>; }) : <p className="p-4 text-sm text-muted-foreground">暂无版本。</p>}</div><DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter></DialogContent></Dialog>;
}

function TemplatePreview({ template }) {
  const draft = useCampaignRevisionDraft();
  return <div className="space-y-3"><div className="text-xs text-muted-foreground">预览使用当前 Draft 的规范化 FormVersion，不会创建提交记录。</div><CampaignFormPreview form={draft.form} campaignKind={template?.kind} reviewWorkflow={draft.reviewWorkflow} descriptionFallback={template?.description} title={template?.name || "表单模板预览"} /></div>;
}

function TemplateDetailPanel({ template, version, workspace, onChanged }) {
  const [tab, setTab] = useState("form");
  useEffect(() => setTab("form"), [version?.id]);
  if (!version) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">正在加载版本…</div>;
  const groups = [{ value: "form", label: "表单" }, { value: "rules", label: "规则" }, { value: "review", label: "审核" }, { value: "results", label: "结果" }, { value: "preview", label: "预览" }];
  const versionStatus = version.status || (version.publishedAt ? "published" : "draft");
  const versionDescription = versionStatus === "draft"
    ? "当前草稿可编辑；发布后成为不可变模板快照。"
    : versionStatus === "published"
      ? "当前发布版本只读；修改请创建新的草稿版本。"
      : "历史发布版本只读；复制后才能继续编辑。";
  return <div className="min-h-full space-y-4 p-1"><div className="border-b pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">表单模板 · v{version.version}</p><h2 className="truncate text-lg font-semibold">{template.name}</h2><p className="mt-1 text-xs text-muted-foreground">{versionDescription}</p></div>{statusBadge(versionStatus)}</div></div><TemplateDraftProvider template={template} version={version} workspace={workspace} onSaved={() => onChanged?.()} onPublished={() => onChanged?.()}><TemplateEditorShell><div className="space-y-4"><div className="flex flex-wrap gap-1 border-b pb-2">{groups.map((item) => <Button key={item.value} type="button" size="sm" variant={tab === item.value ? "secondary" : "ghost"} onClick={() => setTab(item.value)}>{item.label}</Button>)}</div>{tab === "form" ? <CampaignFormBuilder /> : null}{tab === "rules" ? <CampaignRulesEditor /> : null}{tab === "review" ? <CampaignReviewEditor /> : null}{tab === "results" ? <CampaignResultsEditor /> : null}{tab === "preview" ? <TemplatePreview template={template} /> : null}</div></TemplateEditorShell></TemplateDraftProvider></div>;
}

function CreateDialog({ open, workspaceId, source, onClose, onCreated }) {
  const [name, setName] = useState(source?.name || "");
  const [description, setDescription] = useState(source?.description || "");
  const [kind, setKind] = useState(source?.kind || "SUBMISSION");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(source?.name || ""); setDescription(source?.description || ""); setKind(source?.kind || "SUBMISSION"); }
  }, [open, source]);
  const submit = async () => {
    if (!name.trim()) return notify.error("名称不能为空");
    setBusy(true);
    try {
      const result = await notify.promise(createWorkspaceCampaignTemplate(workspaceId, { name, description, kind, source_template_version_id: source?.versionId }), { loading: "正在创建表单模板…", success: "表单模板草稿已创建", error: (error) => `创建失败：${error?.message || String(error)}` });
      onCreated(result);
      onClose();
    } catch { /* notify.promise owns feedback */ } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}><DialogContent><DialogHeader><DialogTitle>{source ? "复制表单模板" : "新建表单模板"}</DialogTitle><DialogDescription>{source ? "复制所选已发布模板版本的表单、审核来源和完整审核快照，不复制活动提交或审核任务。" : "创建后会生成一个可编辑的草稿版本。"}</DialogDescription></DialogHeader><div className="space-y-4"><Field><FieldLabel htmlFor="template-name">名称</FieldLabel><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field><Field><FieldLabel htmlFor="template-description">描述</FieldLabel><Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field><FieldLabel htmlFor="template-kind">类型</FieldLabel><Select items={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))} value={kind} onValueChange={setKind}><SelectTrigger id="template-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kindLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field></div><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button onClick={submit} disabled={busy}>创建草稿</Button></DialogFooter></DialogContent></Dialog>;
}

// Template definitions are reusable snapshots; review recipe policies are selected from the workspace catalog.
export function WorkspaceTemplateLibraryPage({ workspace }) {
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [campaignTemplates, setCampaignTemplates] = useState([]);
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
      const [system, workspaceTemplates] = await Promise.all([
        listCampaignTemplates({ status: status === "all" ? undefined : status }),
        listWorkspaceCampaignTemplates(workspace.id, { status: status === "all" ? undefined : status }),
      ]);
      setCampaignTemplates([...(system.items || []), ...(workspaceTemplates.items || [])]);
    } catch (error) {
      notify.error("模板库加载失败", { description: error?.message || String(error) });
    } finally { if (!silent) setLoading(false); }
  }, [status, workspace.id]);
  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (item, trigger = null) => {
    if (trigger) detailTriggerRef.current = trigger;
    setDetail(item);
    setDetailVersion(null);
    try {
      const result = await listCampaignTemplateVersions(item.id);
      const versions = result.items || [];
      const selected = item.draftVersionId ? versions.find((version) => version.id === item.draftVersionId) : null;
      setDetailVersion(selected || versions.find((version) => version.id === item.publishedVersionId) || versions[0] || null);
    } catch (error) {
      setDetail(null);
      notify.error("读取模板详情失败", { description: error?.message || String(error) });
    }
  }, []);
  const openVersionDetail = useCallback((item, version) => { setDetail(item); setDetailVersion(version); setHistoryDialog(null); }, []);
  const detailContent = useCallback(() => detail ? <TemplateDetailPanel template={detail} version={detailVersion} workspace={workspace} onChanged={() => load(true)} /> : null, [detail, detailVersion, load, workspace]);
  useWindowDetailRegistration({ key: `workspace-template-library:${workspace.id}`, storageKey: "detailPane:workspace-template-library:v1", detailLabel: "表单模板详情", triggerRef: detailTriggerRef, getDetail: detailContent, onClose: () => { setDetail(null); setDetailVersion(null); } });
  useEffect(() => { setDetailOpen(Boolean(detail), { announce: false }); }, [detail, setDetailOpen]);

  const filteredCampaigns = useMemo(() => campaignTemplates.filter((item) => (scope === "all" || item.scope === scope) && (!search.trim() || `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()))), [campaignTemplates, scope, search]);
  const copyTemplate = (item) => setDialog({ source: { ...item, versionId: item.publishedVersionId } });
  const createDraft = async (item) => {
    try {
      await notify.promise(createCampaignTemplateVersion(item.id), { loading: "正在创建新草稿…", success: "新草稿已创建", error: (error) => `创建失败：${error?.message || String(error)}` });
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const copyVersion = async (item, version) => {
    try {
      await notify.promise(createCampaignTemplateVersion(item.id, { definition: version.definition, review_recipe_version_id: version.reviewRecipeVersionId || null }), { loading: "正在复制版本…", success: "已创建新草稿", error: (error) => `复制失败：${error?.message || String(error)}` });
      setHistoryDialog(null);
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const editTemplate = (item) => item.draftVersionId ? void openDetail(item) : notify.message("当前没有草稿版本", { description: "请先创建一个新版本。" });
  const publish = async (item) => {
    try {
      const versions = await listCampaignTemplateVersions(item.id);
      const draft = versions.items.find((version) => version.status === "draft");
      if (!draft) return notify.message("没有可发布的草稿");
      await notify.promise(publishCampaignTemplateVersion(item.id, draft.id, { etag: draft.etag }), { loading: "正在发布模板…", success: "模板已发布", error: (error) => `发布失败：${error?.message || String(error)}` });
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };
  const archive = async (item) => {
    try {
      await notify.promise((async () => { const current = await getCampaignTemplate(item.id); return updateCampaignTemplate(item.id, { status: "archived" }, { etag: current.etag }); })(), { loading: "正在归档…", success: "已归档", error: (error) => `归档失败：${error?.message || String(error)}` });
      await load(true);
    } catch { /* notify.promise owns feedback */ }
  };

  const cards = filteredCampaigns.map((item) => <Card key={item.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{item.description || "暂无描述"}</CardDescription></div>{statusBadge(item.status)}</div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">{kindLabels[item.kind] || item.kind}</Badge><span>最新 v{item.latestVersion || "—"}</span><span>当前发布 v{item.publishedVersion || "—"}</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={(event) => void openDetail(item, event.currentTarget)}>查看详情</Button>{item.scope === "system" ? <Button size="sm" variant="outline" onClick={() => copyTemplate(item)}><Copy />复制已发布版本</Button> : item.status === "archived" ? <span className="text-xs text-muted-foreground">已归档，只读</span> : <><Button size="sm" variant="outline" onClick={() => item.draftVersionId ? void editTemplate(item) : void createDraft(item)}><Edit3 />{item.draftVersionId ? "编辑草稿" : "新建版本"}</Button>{item.draftVersionId ? <Button size="sm" onClick={() => void publish(item)}><ShieldCheck />发布</Button> : null}<Button size="sm" variant="ghost" onClick={() => setHistoryDialog(item)}>版本历史</Button><Button size="sm" variant="ghost" onClick={() => void archive(item)}><Archive />归档</Button></>}</div></CardContent></Card>);
  const empty = filteredCampaigns.length ? null : { title: "还没有表单模板", description: "从系统模板复制，或创建一份空白模板。", action: <Button onClick={() => setDialog({ source: null })}><Plus />新建模板</Button> };
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={workspace.role} title="表单模板" description="管理可复用的表单模板。审核人和门槛在活动表单的审核配置中设定。" actions={{ secondary: [<Button key="refresh" variant="outline" onClick={() => void load()}><RefreshCw />刷新</Button>] }} /><ResourcePage headingLevel="h2" title="模板目录" description="模板复用表单与审核参数；审核方案来源由工作空间目录控制。" count={filteredCampaigns.length} search={{ value: search, onChange: setSearch, placeholder: "搜索模板…" }} filters={<TemplateLibraryFilters scope={scope} status={status} onScopeChange={setScope} onStatusChange={setStatus} entityLabel="模板" />} view="grid" showViewToggle={false} actions={{ primary: <Button onClick={() => setDialog({ source: null })}><Plus />新建模板</Button> }} loading={loading} empty={empty}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div></ResourcePage><CreateDialog open={Boolean(dialog)} workspaceId={workspace.id} source={dialog?.source} onClose={() => setDialog(null)} onCreated={() => void load(true)} /><VersionHistoryDialog open={Boolean(historyDialog)} item={historyDialog} onClose={() => setHistoryDialog(null)} onCopyVersion={(version) => void copyVersion(historyDialog, version)} onOpenVersion={(version) => openVersionDetail(historyDialog, version)} /></div>;
}
