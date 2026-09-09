import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Gauge,
  Info,
  LayoutTemplate,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  UsersRound,
  Workflow,
  X,
} from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { ResourcePage } from "@/components/resource-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsTabs } from "@/components/settings-tabs";
import { notify } from "@/components/ui/sonner";
import { createCampaign, createCampaignRevision, getCampaign, listCampaignRevisions, listCampaigns, listCampaignTemplates, listWorkspaceCampaignTemplates, archiveCampaign, updateCampaign } from "@/lib/campaign-api";
import { CampaignFormBuilder, CampaignPreviewRegistration, CampaignResultsEditor, CampaignReviewEditor, CampaignRulesEditor } from "@/components/campaign-form-builder";
import { CampaignRevisionDraftProvider, RevisionEditorShell, useCampaignRevisionDraft } from "@/components/campaign-revision-draft-context";
import { directProductionCampaignPath, productionCampaignPath, productionPath } from "@/lib/navigation";

const ACTIVITY_INFO_GROUPS = [
  ["basic", "基础信息", FileText],
  ["public", "对外信息", Info],
  ["schedule", "时间与地点", CalendarDays],
  ["contact", "联系信息", UsersRound],
];

const CAMPAIGN_DETAIL_GROUPS = [
  ["overview", "概览", Gauge],
  ["form", "表单", FileText],
  ["rules", "规则", SlidersHorizontal],
  ["review", "审核", ClipboardCheck],
  ["entries", "提交记录", ClipboardList],
  ["results", "结果", CheckCircle2],
  ["settings", "设置", Settings],
];

const FORM_TYPES = [
  { id: "submission", apiKind: "SUBMISSION", label: "征集", description: "接收节目、作品、方案或资料提交。", icon: FileText, tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  { id: "recruitment", apiKind: "RECRUITMENT", label: "招募", description: "面向岗位、班次或职责收集人员申请。", icon: UsersRound, tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { id: "registration", apiKind: "REGISTRATION", label: "报名", description: "收集活动参与者，并处理名额与候补。", icon: ClipboardCheck, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { id: "collection", apiKind: "COLLECTION", label: "通用收集", description: "自由配置字段，收集不直接归入业务对象的信息。", icon: LayoutTemplate, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
];

function formatValue(value, fallback = "未设置") {
  return value || fallback;
}

function InfoRows({ rows }) {
  return <dl className="divide-y border">
    {rows.map(([label, value]) => <div key={label} className="grid gap-1 px-4 py-3 @min-[40rem]/info-rows:grid-cols-[9rem_minmax(0,1fr)] @min-[40rem]/info-rows:items-center">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{value}</dd>
    </div>)}
  </dl>;
}

function PlaceholderCard({ icon: Icon, title, description, children, action }) {
  return <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4 text-muted-foreground" /></div>
        <div className="min-w-0"><CardTitle className="text-base">{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>
      </div>
      {action}
    </CardHeader>
    {children ? <CardContent>{children}</CardContent> : null}
  </Card>;
}

function ActivityInfoContent({ group, production }) {
  const basicRows = [
    ["活动名称", formatValue(production?.name)],
    ["活动状态", formatValue(production?.status, "进行中")],
    ["活动时区", formatValue(production?.timezone, "Asia/Shanghai")],
  ];
  const publicRows = [
    ["对外标题", formatValue(production?.name)],
    ["公开简介", formatValue(production?.description, "还没有设置对外简介")],
    ["报名页品牌", "跟随工作空间品牌（占位）"],
  ];
  const scheduleRows = [
    ["计划开始", formatValue(production?.plannedStartAt, "待定")],
    ["计划结束", formatValue(production?.plannedEndAt, "待定")],
    ["活动地点", formatValue(production?.locationName || production?.venueName, "待设置")],
  ];
  const contactRows = [
    ["活动联系人", "尚未配置"],
    ["对外邮箱", "尚未配置"],
    ["现场联系电话", "尚未配置"],
  ];
  const content = {
    basic: <PlaceholderCard icon={FileText} title="活动基础信息" description="活动名称、状态与时区等基础字段。" action={<Button variant="outline" size="sm" onClick={() => notify.info("活动信息编辑将在数据服务接入后开放")}>编辑</Button>}><InfoRows rows={basicRows} /></PlaceholderCard>,
    public: <PlaceholderCard icon={Info} title="对外信息" description="这些内容可以在表单说明、报名页和公开链接中复用。" action={<Button variant="outline" size="sm" onClick={() => notify.info("对外信息编辑将在数据服务接入后开放")}>编辑</Button>}><InfoRows rows={publicRows} /></PlaceholderCard>,
    schedule: <PlaceholderCard icon={CalendarDays} title="时间与地点" description="统一维护表单展示时使用的活动时间和地点信息。" action={<Button variant="outline" size="sm" onClick={() => notify.info("时间与地点编辑将在数据服务接入后开放")}>编辑</Button>}><InfoRows rows={scheduleRows} /></PlaceholderCard>,
    contact: <PlaceholderCard icon={UsersRound} title="联系信息" description="为报名者或申请者提供统一的对外联系渠道。" action={<Button variant="outline" size="sm" onClick={() => notify.info("联系信息编辑将在数据服务接入后开放")}>编辑</Button>}><InfoRows rows={contactRows} /></PlaceholderCard>,
  };
  return content[group] || content.basic;
}

export function ProductionActivityInfoPage({ route, workspace, production }) {
  const [activeGroup, setActiveGroup] = useState("basic");
  return <div className="@container/production-activity-info min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="活动信息" subtitle={route.meta.description} actions={<Button variant="outline" onClick={() => notify.info("活动信息编辑将在数据服务接入后开放")}><Settings />管理信息</Button>} />
    <SettingsTabs groups={ACTIVITY_INFO_GROUPS} activeGroup={activeGroup} onGroupChange={setActiveGroup} ariaLabel="活动信息分类">
      <ActivityInfoContent group={activeGroup} production={production} />
    </SettingsTabs>
  </div>;
}

function CampaignCreateDialog({ open, onOpenChange, production, template, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("COLLECTION");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(template?.name || "");
    setDescription(template?.description || "");
    setKind(template?.kind || "COLLECTION");
  }, [open, template]);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      notify.error("请输入表单名称");
      return;
    }
    setBusy(true);
    try {
      const payload = { name: trimmed, description: description.trim() };
      if (template) payload.template_id = template.id;
      else payload.kind = kind;
      const created = await notify.promise(createCampaign(production.id, payload), {
        loading: "正在创建表单…",
        success: "表单已创建",
        error: (error) => `创建表单失败：${error?.message || String(error)}`,
      });
      onOpenChange(false);
      await onCreated?.(created);
    } catch {
      // notify.promise 已经展示错误提示。
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{template ? `使用模板：${template.name}` : "从空白创建表单"}</DialogTitle><DialogDescription>{template ? "创建后会复制模板版本，之后可以独立编辑活动表单。" : "选择表单类型，创建一个可继续配置的活动表单。"}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1.5"><span className="text-sm font-medium">表单名称</span><Input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="例如：2026 青年音乐节节目征集" /></label>
        {!template && <label className="block space-y-1.5"><span className="text-sm font-medium">表单类型</span><Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{FORM_TYPES.map((item) => <SelectItem key={item.apiKind} value={item.apiKind}>{item.label}</SelectItem>)}</SelectContent></Select></label>}
        <label className="block space-y-1.5"><span className="text-sm font-medium">描述（可选）</span><Input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="说明这份表单的用途" /></label>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button><Button type="submit" disabled={busy}>{busy ? "创建中…" : "创建表单"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function TemplateCard({ template, onUse }) {
  const type = FORM_TYPES.find((item) => item.apiKind === template.kind);
  const Icon = type?.icon || LayoutTemplate;
  return <Card className="flex h-full flex-col">
    <CardHeader>
      <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${type?.tone || "bg-muted text-muted-foreground"}`}><Icon className="size-4" /></div><CardTitle className="truncate text-base">{template.name}</CardTitle></div><Badge variant="outline">{template.scope === "workspace" ? "工作空间模板" : "系统模板"}</Badge></div>
      <CardDescription>{template.description}</CardDescription>
    </CardHeader>
    <CardContent className="mt-auto space-y-3"><div className="flex flex-wrap gap-1.5">{(template.tags || []).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div><Button className="w-full" variant="outline" onClick={() => onUse(template)}>使用模板</Button></CardContent>
  </Card>;
}

export function ProductionFormTemplatesPage({ route, workspace, production }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createTemplate, setCreateTemplate] = useState(null);
  const loadTemplates = async () => {
    setLoading(true);
    try {
      const [system, workspaceTemplates] = await Promise.all([
        listCampaignTemplates({ status: "all" }),
        workspace?.id ? listWorkspaceCampaignTemplates(workspace.id, { status: "all" }) : Promise.resolve({ items: [] }),
      ]);
      setTemplates([...system.items, ...workspaceTemplates.items]);
    } catch (error) {
      setTemplates([]);
      notify.error("无法加载表单模板", { description: error?.message || String(error) });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadTemplates(); }, [workspace?.id]);
  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesQuery = !needle || `${template.name} ${template.description} ${(template.tags || []).join(" ")}`.toLowerCase().includes(needle);
      const matchesScope = scope === "all" || template.scope === scope;
      return matchesQuery && matchesScope;
    });
  }, [query, scope, templates]);
  const empty = scope === "workspace" ? { icon: LayoutTemplate, title: "还没有工作空间模板", description: "从系统模板开始自定义后，可以保存为工作空间模板供活动复用。", action: <Button onClick={() => notify.info("创建工作空间模板将在后端模板编辑器接入后开放")}><Plus />创建工作空间模板</Button> } : { icon: LayoutTemplate, title: "没有匹配的模板", description: "调整搜索条件，或从空白表单开始。" };
  return <div className="@container/production-form-templates min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="表单模板" subtitle={route.meta.description} actions={<Button onClick={() => setCreateTemplate(false)}><Plus />从空白创建</Button>} />
    <ResourcePage title="可用模板" description="系统模板只读；工作空间模板用于沉淀本团队的最佳实践。" count={filteredTemplates.length} search={{ value: query, onChange: setQuery, placeholder: "搜索模板名称或用途" }} filters={<div className="flex items-center gap-1"><Button type="button" size="sm" variant={scope === "all" ? "secondary" : "ghost"} onClick={() => setScope("all")}>全部模板</Button><Button type="button" size="sm" variant={scope === "system" ? "secondary" : "ghost"} onClick={() => setScope("system")}>系统模板</Button><Button type="button" size="sm" variant={scope === "workspace" ? "secondary" : "ghost"} onClick={() => setScope("workspace")}>工作空间模板</Button></div>} showViewToggle={false} loading={loading} summary={<span>模板会在创建表单时复制为活动快照</span>} empty={filteredTemplates.length ? null : empty}>
      <div className="grid gap-4 @min-[40rem]/resource-page:grid-cols-2 @min-[72rem]/resource-page:grid-cols-3">{filteredTemplates.map((template) => <TemplateCard key={`${template.scope}-${template.id}`} template={template} onUse={setCreateTemplate} />)}</div>
    </ResourcePage>
    <CampaignCreateDialog open={createTemplate !== null} template={createTemplate || null} production={production} onOpenChange={(open) => !open && setCreateTemplate(null)} onCreated={(created) => { setCreateTemplate(null); if (created?.campaign?.id) navigate(productionCampaignPath(workspace.id, production.id, created.campaign.id)); }} />
  </div>;
}

function FormTypeCard({ type }) {
  const Icon = type.icon;
  return <Card><CardContent className="flex items-start gap-3 p-4"><div className={`flex size-9 shrink-0 items-center justify-center rounded-md ${type.tone}`}><Icon className="size-4" /></div><div className="min-w-0"><p className="font-medium">{type.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{type.description}</p></div></CardContent></Card>;
}

export function ProductionFormsPage({ route, workspace, production }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const typeLabel = type === "all" ? "全部类型" : FORM_TYPES.find((item) => item.id === type)?.label;
  const statusLabel = { all: "全部状态", draft: "草稿", published: "已发布", paused: "已暂停", closed: "已关闭", archived: "已归档" };
  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const result = await listCampaigns(production.id, { status: "all" });
      setCampaigns(result.items);
    } catch (error) {
      setCampaigns([]);
      notify.error("无法加载活动表单", { description: error?.message || String(error) });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadCampaigns(); }, [production.id]);
  const filteredCampaigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const matchesQuery = !needle || `${campaign.name} ${campaign.description}`.toLowerCase().includes(needle);
      const matchesType = type === "all" || campaign.kind === FORM_TYPES.find((item) => item.id === type)?.apiKind;
      const matchesStatus = status === "all" || campaign.status === status;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [campaigns, query, status, type]);
  const createDone = async (created) => {
    setCreateOpen(false);
    await loadCampaigns();
    if (created?.campaign?.id) navigate(productionCampaignPath(workspace.id, production.id, created.campaign.id));
  };
  return <div className="@container/production-forms min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="全部表单" subtitle={route.meta.description} actions={<Button onClick={() => setCreateOpen(true)}><Plus />新建表单</Button>} />
    <Card><CardHeader><CardTitle className="text-base">统一收集入口</CardTitle><CardDescription>先从业务需要出发选择表单；审核通过后的结果再按规则进入活动级资源或成员库。</CardDescription></CardHeader><CardContent className="grid gap-3 @min-[40rem]/production-forms:grid-cols-2 @min-[72rem]/production-forms:grid-cols-4">{FORM_TYPES.map((item) => <FormTypeCard key={item.id} type={item} />)}</CardContent></Card>
    <ResourcePage title="全部表单" description="征集、招募、报名和通用收集统一在这里管理。" count={filteredCampaigns.length} search={{ value: query, onChange: setQuery, placeholder: "搜索表单名称" }} filters={<div className="flex items-center gap-1"><Button type="button" size="sm" variant={type === "all" ? "secondary" : "ghost"} onClick={() => setType("all")}>全部类型</Button>{FORM_TYPES.map((item) => <Button key={item.id} type="button" size="sm" variant={type === item.id ? "secondary" : "ghost"} onClick={() => setType(item.id)}>{item.label}</Button>)}<span className="mx-1 h-4 w-px bg-border" />{Object.entries(statusLabel).map(([value, label]) => <Button key={value} type="button" size="sm" variant={status === value ? "secondary" : "ghost"} onClick={() => setStatus(value)}>{label}</Button>)}</div>} showViewToggle={false} loading={loading} summary={<span>{typeLabel} · {statusLabel[status]}</span>} empty={{ icon: ClipboardCheck, title: query || type !== "all" || status !== "all" ? "没有匹配的表单" : "还没有活动表单", description: "创建表单后，它会在这里进入统一收件箱，并通过详情页配置规则与审核流程。", action: !query && type === "all" && status === "all" ? <Button onClick={() => setCreateOpen(true)}><Plus />新建表单</Button> : null }}>
      <div className="grid gap-4 @min-[40rem]/resource-page:grid-cols-2 @min-[72rem]/resource-page:grid-cols-3">{filteredCampaigns.map((campaign) => { const item = FORM_TYPES.find((typeItem) => typeItem.apiKind === campaign.kind); const Icon = item?.icon || ClipboardCheck; return <Card key={campaign.id} className="cursor-pointer transition-colors hover:border-foreground/30" role="button" tabIndex={0} onClick={() => navigate(productionCampaignPath(workspace.id, production.id, campaign.id))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(productionCampaignPath(workspace.id, production.id, campaign.id)); } }}><CardHeader><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${item?.tone || "bg-muted text-muted-foreground"}`}><Icon className="size-4" /></div><CardTitle className="truncate text-base">{campaign.name}</CardTitle></div><Badge variant="outline">{item?.label || campaign.kind}</Badge></div><CardDescription className="line-clamp-2">{campaign.description || "暂无描述"}</CardDescription></CardHeader><CardContent className="flex items-center justify-between text-xs text-muted-foreground"><Badge variant="secondary">{statusLabel[campaign.status] || campaign.status}</Badge><span>提交 {campaign.stats?.totalEntries ?? 0}</span></CardContent></Card>; })}</div>
    </ResourcePage>
    <CampaignCreateDialog open={createOpen} template={null} production={production} onOpenChange={setCreateOpen} onCreated={createDone} />
  </div>;
}

export function ProductionCollectionWorkflowsPage({ route, workspace, production }) {
  const [activeGroup, setActiveGroup] = useState("overview");
  const groups = [["overview", "工作流概览", Workflow], ["stages", "审核阶段", ClipboardCheck], ["automation", "自动化", Settings]];
  const panels = {
    overview: <PlaceholderCard icon={Workflow} title="收集工作流" description="把 Entry 从提交、审核、决定到转化串成可复用流程。" action={<Button onClick={() => notify.info("工作流创建将在后端流程引擎接入后开放")}><Plus />新建工作流</Button>}><InfoRows rows={[["当前工作流", "尚未配置"], ["可用阶段", "提交 → 审核 → 决定 → 转化"], ["执行方式", "手动推进（占位）"]]} /></PlaceholderCard>,
    stages: <PlaceholderCard icon={ClipboardCheck} title="审核阶段" description="未来可在这里配置多阶段审核、评分量表和分配规则。"><div className="space-y-2 text-sm text-muted-foreground"><p>阶段 1 · 资格检查</p><p>阶段 2 · 内容评分</p><p>阶段 3 · 最终决定</p></div></PlaceholderCard>,
    automation: <PlaceholderCard icon={Settings} title="自动化规则" description="未来可根据字段答案、评分和名额自动推进状态。"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />自动化触发器和通知规则尚未开放。</div></PlaceholderCard>,
  };
  return <div className="@container/production-collection-workflows min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="收集工作流" subtitle={route.meta.description} />
    <SettingsTabs groups={groups} activeGroup={activeGroup} onGroupChange={setActiveGroup} ariaLabel="收集工作流分类">{panels[activeGroup]}</SettingsTabs>
  </div>;
}

const CAMPAIGN_STATUS_LABELS = { draft: "草稿", published: "已发布", paused: "已暂停", closed: "已关闭", archived: "已归档" };

function formatCampaignDate(value) {
  if (!value) return "未设置";
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; }
}

function CampaignOverviewEditor({ campaign, production, policy, stats, revision, onCampaignUpdated, onOpenActivityInfo }) {
  const draft = useCampaignRevisionDraft();
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState({ name: campaign?.name || "", description: campaign?.description || "" });
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  useEffect(() => { if (!editing) setValue({ name: campaign?.name || "", description: campaign?.description || "" }); }, [campaign?.description, campaign?.name, editing]);
  const save = async () => {
    const name = value.name.trim();
    if (!name) { notify.error("表单名称不能为空"); return; }
    try {
      const result = await notify.promise(updateCampaign(campaign.id, { name, description: value.description.trim() }), { loading: "正在保存表单基础信息…", success: "表单基础信息已保存", error: (error) => `保存失败：${error?.message || String(error)}` });
      onCampaignUpdated?.(result.campaign);
      setEditing(null);
    } catch {
      // notify.promise 已展示错误提示。
    }
  };
  const goActivityInfo = () => {
    if (draft.dirty || draft.saveState === "保存中") setLeaveOpen(true);
    else onOpenActivityInfo?.();
  };
  const saveAndGo = async () => {
    setLeaveBusy(true);
    try {
      await notify.promise(draft.flushPendingSave(), { loading: "正在保存当前表单草稿…", success: "草稿已保存", error: (error) => `保存失败：${error?.message || String(error)}` });
      setLeaveOpen(false);
      onOpenActivityInfo?.();
    } catch {
      // notify.promise 已展示错误提示，并保留当前页面草稿。
    } finally { setLeaveBusy(false); }
  };
  const rows = [
    ["类型", FORM_TYPES.find((item) => item.apiKind === campaign?.kind)?.label || campaign?.kind || "未设置"],
    ["来源模板", campaign?.sourceTemplateId || "从空白创建"],
    ["所属活动", production?.name || "未设置"],
    ["当前版本", revision ? `Revision ${revision.revisionNo}` : "未创建"],
  ];
  return <div className="grid gap-4 @min-[40rem]/campaign-detail:grid-cols-2"><Card><CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-sm">Campaign 基础信息</CardTitle><CardDescription>这里只编辑这份表单本身；活动资料请到“活动信息”维护。</CardDescription></div>{!draft.readOnly ? <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(editing ? null : "name")}>{editing ? <><X />取消编辑</> : <><Pencil />编辑</>}</Button> : null}</CardHeader><CardContent className="space-y-4"><div className="space-y-3"><div className="flex items-start gap-2"><span className="w-24 shrink-0 pt-2 text-xs text-muted-foreground">表单名称</span>{editing ? <div className="flex min-w-0 flex-1 gap-2"><Input autoFocus value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))} /><Button type="button" size="icon" aria-label="确认保存表单名称" onClick={save}>保存</Button></div> : <p className="min-w-0 flex-1 text-sm">{campaign?.name || "未设置"}</p>}</div><div className="flex items-start gap-2"><span className="w-24 shrink-0 pt-2 text-xs text-muted-foreground">表单描述</span>{editing ? <div className="flex min-w-0 flex-1 gap-2"><Textarea value={value.description} rows={3} onChange={(event) => setValue((current) => ({ ...current, description: event.target.value }))} /><Button type="button" size="icon" aria-label="确认保存表单描述" onClick={save}>保存</Button></div> : <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-muted-foreground">{campaign?.description || "暂无描述"}</p>}</div></div><InfoRows rows={rows} /></CardContent></Card><div className="space-y-4"><PlaceholderCard icon={Gauge} title="状态与开放摘要" description="规则 Tab 负责编辑，概览只展示摘要。"><InfoRows rows={[["状态", CAMPAIGN_STATUS_LABELS[campaign?.status] || campaign?.status || "未设置"], ["开放时间", formatCampaignDate(policy.opens_at)], ["截止时间", formatCampaignDate(policy.closes_at)], ["收集上限", policy.submission_limit || policy.capacity || "未设置"]]} /></PlaceholderCard><PlaceholderCard icon={Info} title="活动信息" description="活动名称、地点、时区和对外信息属于 Production，不复制到表单快照。" action={<Button type="button" variant="outline" size="sm" onClick={goActivityInfo}>去活动信息编辑</Button>}><InfoRows rows={[["活动", production?.name || "未设置"], ["时区", production?.timezone || "Asia/Shanghai"], ["公开简介", production?.description || "尚未设置"]]} /></PlaceholderCard><PlaceholderCard icon={ClipboardList} title="收集漏斗" description="Entry 统计摘要。"><InfoRows rows={[["已提交", stats.submittedEntries ?? 0], ["已确认", stats.acceptedEntries ?? 0], ["候补", stats.waitlistedEntries ?? 0], ["已转化", stats.convertedEntries ?? 0], ["全部 Entry", stats.totalEntries ?? 0]]} /></PlaceholderCard></div><Dialog open={leaveOpen} onOpenChange={(open) => !leaveBusy && setLeaveOpen(open)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>当前表单有未保存修改</DialogTitle><DialogDescription>前往活动信息后，当前页面草稿会被卸载。请选择如何处理。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={leaveBusy} onClick={() => setLeaveOpen(false)}>取消</Button><Button type="button" variant="ghost" disabled={leaveBusy} onClick={() => { setLeaveOpen(false); onOpenActivityInfo?.(); }}>放弃并前往</Button><Button type="button" disabled={leaveBusy} onClick={() => void saveAndGo()}>{leaveBusy ? "保存中…" : "保存并前往"}</Button></DialogFooter></DialogContent></Dialog></div>;
}

function CampaignDetailPanel({ tab, detail, production, onArchive, onPublished, onCreateDraft, onCloneRevision, onOpenActivityInfo, onCampaignUpdated }) {
  const campaign = detail?.campaign;
  const revision = detail?.draftRevision || detail?.publishedRevision;
  const policy = detail?.availabilityPolicy || {};
  const stats = detail?.stats || campaign?.stats || {};
  const panels = {
    overview: <CampaignOverviewEditor campaign={campaign} production={production} policy={policy} stats={stats} revision={revision} onCampaignUpdated={onCampaignUpdated} onOpenActivityInfo={onOpenActivityInfo} />,
    form: <div className="space-y-4"><RevisionEditorShell showPreview><CampaignFormBuilder /></RevisionEditorShell>{revision?.status !== "draft" && campaign?.status !== "archived" ? <Button variant="outline" onClick={onCreateDraft}><Plus />创建新的草稿版本</Button> : null}</div>,
    rules: <RevisionEditorShell><CampaignRulesEditor /></RevisionEditorShell>,
    review: <RevisionEditorShell><CampaignReviewEditor /></RevisionEditorShell>,
    entries: <PlaceholderCard icon={ClipboardList} title="Entry 收件箱" description="提交记录会先进入暂存层，再根据决定转化为活动级业务数据。"><div className="flex min-h-36 items-center justify-center border border-dashed text-sm text-muted-foreground">尚未有提交记录</div></PlaceholderCard>,
    results: <RevisionEditorShell><CampaignResultsEditor /></RevisionEditorShell>,
    settings: <PlaceholderCard icon={Settings} title="表单设置" description="管理归档、版本历史和保存为工作空间模板。" action={<Button variant="outline" onClick={() => notify.info("保存为工作空间模板将在模板编辑器接入后开放")}>保存为模板</Button>}><div className="space-y-4 text-sm"><div className="flex min-h-24 flex-col items-start gap-3 border border-dashed px-4 py-4 text-muted-foreground"><p>来源模板：{campaign?.sourceTemplateId || "从空白创建"}</p><p>创建时间：{formatCampaignDate(campaign?.createdAt)}</p>{campaign?.status !== "archived" && <Button variant="destructive" size="sm" onClick={onArchive}>归档此表单</Button>}</div><div><p className="mb-2 font-medium text-foreground">Revision 历史</p><div className="divide-y rounded-md border">{(detail?.revisions || []).map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="font-medium">v{item.revisionNo}</span><Badge variant="outline">{CAMPAIGN_STATUS_LABELS[item.status] || item.status}</Badge><span className="min-w-0 flex-1 text-xs text-muted-foreground">{item.changeNote || "无变更说明"}</span>{item.status !== "draft" && campaign?.status !== "archived" ? <Button size="sm" variant="ghost" onClick={() => onCloneRevision?.(item)}>复制为草稿</Button> : null}</div>)}{!(detail?.revisions || []).length ? <p className="px-3 py-3 text-xs text-muted-foreground">暂无版本历史。</p> : null}</div></div></div></PlaceholderCard>,
  };
  return panels[tab] || panels.overview;
}

export function ProductionCampaignDetailPage({ route, workspace, production }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(CAMPAIGN_DETAIL_GROUPS.some(([id]) => id === route.detailTab) ? route.detailTab : "overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadDetail = async () => {
    setLoading(true);
    try {
      const [campaignDetail, revisions] = await Promise.all([getCampaign(route.campaignId), listCampaignRevisions(route.campaignId)]);
      const next = { ...campaignDetail, revisions: revisions.items };
      setDetail(next);
      return next;
    } catch (error) {
      setDetail(null);
      notify.error("无法加载表单详情", { description: error?.message || String(error) });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadDetail(); }, [route.campaignId]);
  const goToTab = (tab) => {
    setActiveTab(tab);
    const path = route.direct ? directProductionCampaignPath(production.id, route.campaignId, tab) : productionCampaignPath(workspace.id, production.id, route.campaignId, tab);
    navigate(path);
  };
  const archive = async () => {
    try {
      await notify.promise(archiveCampaign(route.campaignId), { loading: "正在归档表单…", success: "表单已归档", error: (error) => `归档失败：${error?.message || String(error)}` });
      navigate(route.direct ? directProductionPath(production.id, "forms") : productionPath(workspace.id, production.id, "forms"));
    } catch {
      // notify.promise 已经展示错误提示。
    }
  };
  const createDraft = async () => {
    try {
      await notify.promise(createCampaignRevision(route.campaignId, { change_note: "从已发布版本创建草稿" }), { loading: "正在创建草稿版本…", success: "草稿版本已创建", error: (error) => `创建草稿失败：${error?.message || String(error)}` });
      await loadDetail();
      goToTab("form");
    } catch {
      // notify.promise 已经展示错误提示。
    }
  };
  const cloneRevision = async (source) => {
    try {
      await notify.promise(createCampaignRevision(route.campaignId, { change_note: `从 Revision ${source.revisionNo} 复制`, form: source.formVersion, availability_policy: source.availabilityPolicy, review_recipe_version_id: source.reviewRecipeVersionId || null, review_workflow: source.reviewWorkflow, materialization_plan: source.materializationPlan }), { loading: "正在复制版本…", success: "已创建新的草稿版本", error: (error) => `复制版本失败：${error?.message || String(error)}` });
      await loadDetail();
      goToTab("form");
    } catch {
      // notify.promise 已经展示错误提示。
    }
  };
  return <div className="@container/production-campaign-detail min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title={detail?.campaign?.name || "表单详情"} subtitle={`${production?.name || "活动"} · ${detail?.campaign?.kind || "Campaign"}`} actions={<Button variant="outline" onClick={() => navigate(route.direct ? directProductionPath(production.id, "forms") : productionPath(workspace.id, production.id, "forms"))}>返回全部表单</Button>} />
    {loading ? <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">正在加载表单详情…</CardContent></Card> : detail ? <CampaignRevisionDraftProvider key={detail.draftRevision?.id || detail.publishedRevision?.id || "empty"} campaign={detail.campaign} revision={detail.draftRevision || detail.publishedRevision} production={production} onSaved={(saved) => setDetail((current) => current ? ({ ...current, draftRevision: saved }) : current)} onPublished={async () => { await loadDetail(); goToTab("overview"); }} onReload={() => loadDetail()}><CampaignPreviewRegistration campaign={detail.campaign} /><SettingsTabs groups={CAMPAIGN_DETAIL_GROUPS} activeGroup={activeTab} onGroupChange={goToTab} ariaLabel="表单详情分类"><CampaignDetailPanel tab={activeTab} detail={detail} production={production} onArchive={archive} onPublished={async () => { await loadDetail(); goToTab("overview"); }} onCreateDraft={createDraft} onCloneRevision={cloneRevision} onOpenActivityInfo={() => navigate(route.direct ? directProductionPath(production.id, "activity-info") : productionPath(workspace.id, production.id, "activity-info"))} onCampaignUpdated={(nextCampaign) => setDetail((current) => current ? ({ ...current, campaign: nextCampaign }) : current)} /></SettingsTabs></CampaignRevisionDraftProvider> : <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">暂时无法显示表单详情。</CardContent></Card>}
  </div>;
}
