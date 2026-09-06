import { useMemo, useState } from "react";
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
  Plus,
  Settings,
  SlidersHorizontal,
  UsersRound,
  Workflow,
} from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { ResourcePage } from "@/components/resource-page";
import { SettingsTabs } from "@/components/settings-tabs";
import { notify } from "@/components/ui/sonner";
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
  { id: "submission", label: "征集", description: "接收节目、作品、方案或资料提交。", icon: FileText, tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  { id: "recruitment", label: "招募", description: "面向岗位、班次或职责收集人员申请。", icon: UsersRound, tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { id: "registration", label: "报名", description: "收集活动参与者，并处理名额与候补。", icon: ClipboardCheck, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { id: "collection", label: "通用收集", description: "自由配置字段，收集不直接归入业务对象的信息。", icon: LayoutTemplate, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
];

const SYSTEM_TEMPLATES = [
  { id: "program-submission", title: "节目征集", description: "节目名称、演出者、时长、附件和舞台需求。", type: "submission", tags: ["多阶段审核", "附件"] },
  { id: "crew-recruitment", title: "工作人员招募", description: "岗位偏好、可用时间、技能和联系方式。", type: "recruitment", tags: ["岗位", "候补"] },
  { id: "event-registration", title: "普通活动报名", description: "参与者信息、名额、审核和候补名单。", type: "registration", tags: ["名额", "候补"] },
  { id: "general-collection", title: "通用信息收集", description: "从空白字段开始，适用于资料、需求和反馈收集。", type: "collection", tags: ["自由字段"] },
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

function TemplateCard({ template }) {
  const type = FORM_TYPES.find((item) => item.id === template.type);
  const Icon = type?.icon || LayoutTemplate;
  return <Card className="flex h-full flex-col">
    <CardHeader>
      <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${type?.tone || "bg-muted text-muted-foreground"}`}><Icon className="size-4" /></div><CardTitle className="truncate text-base">{template.title}</CardTitle></div><Badge variant="outline">系统模板</Badge></div>
      <CardDescription>{template.description}</CardDescription>
    </CardHeader>
    <CardContent className="mt-auto space-y-3"><div className="flex flex-wrap gap-1.5">{template.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div><Button className="w-full" variant="outline" onClick={() => notify.info(`“${template.title}”模板创建流程将在数据服务接入后开放`)}>使用模板</Button></CardContent>
  </Card>;
}

export function ProductionFormTemplatesPage({ route, workspace, production }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return SYSTEM_TEMPLATES.filter((template) => {
      const matchesQuery = !needle || `${template.title} ${template.description} ${template.tags.join(" ")}`.toLowerCase().includes(needle);
      return matchesQuery && scope !== "workspace";
    });
  }, [query, scope]);
  const empty = scope === "workspace" ? { icon: LayoutTemplate, title: "还没有工作空间模板", description: "从系统模板开始自定义后，可以保存为工作空间模板供活动复用。", action: <Button onClick={() => notify.info("创建工作空间模板将在数据服务接入后开放")}><Plus />创建工作空间模板</Button> } : { icon: LayoutTemplate, title: "没有匹配的模板", description: "调整搜索条件，或从空白表单开始。" };
  return <div className="@container/production-form-templates min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="表单模板" subtitle={route.meta.description} actions={<Button onClick={() => notify.info("空白表单创建将在数据服务接入后开放")}><Plus />从空白创建</Button>} />
    <ResourcePage title="可用模板" description="系统模板只读；工作空间模板用于沉淀本团队的最佳实践。" count={filteredTemplates.length} search={{ value: query, onChange: setQuery, placeholder: "搜索模板名称或用途" }} filters={<div className="flex items-center gap-1"><Button type="button" size="sm" variant={scope === "all" ? "secondary" : "ghost"} onClick={() => setScope("all")}>全部模板</Button><Button type="button" size="sm" variant={scope === "system" ? "secondary" : "ghost"} onClick={() => setScope("system")}>系统模板</Button><Button type="button" size="sm" variant={scope === "workspace" ? "secondary" : "ghost"} onClick={() => setScope("workspace")}>工作空间模板</Button></div>} showViewToggle={false} summary={<span>模板会在创建表单时复制为活动快照</span>} empty={filteredTemplates.length ? null : empty}>
      <div className="grid gap-4 @min-[40rem]/resource-page:grid-cols-2 @min-[72rem]/resource-page:grid-cols-3">{filteredTemplates.map((template) => <TemplateCard key={template.id} template={template} />)}</div>
    </ResourcePage>
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
  const typeLabel = type === "all" ? "全部类型" : FORM_TYPES.find((item) => item.id === type)?.label;
  const openDetailPreview = () => navigate(productionCampaignPath(workspace.id, production.id, "preview"));
  return <div className="@container/production-forms min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="全部表单" subtitle={route.meta.description} actions={<Button onClick={() => notify.info("新建表单将在数据服务接入后开放")}><Plus />新建表单</Button>} />
    <Card><CardHeader><CardTitle className="text-base">统一收集入口</CardTitle><CardDescription>先从业务需要出发选择表单；审核通过后的结果再按规则进入活动级资源或成员库。</CardDescription></CardHeader><CardContent className="grid gap-3 @min-[40rem]/production-forms:grid-cols-2 @min-[72rem]/production-forms:grid-cols-4">{FORM_TYPES.map((item) => <FormTypeCard key={item.id} type={item} />)}</CardContent></Card>
    <ResourcePage title="全部表单" description="征集、招募、报名和通用收集统一在这里管理。" count={0} search={{ value: query, onChange: setQuery, placeholder: "搜索表单名称" }} filters={<div className="flex items-center gap-1"><Button type="button" size="sm" variant={type === "all" ? "secondary" : "ghost"} onClick={() => setType("all")}>全部类型</Button>{FORM_TYPES.map((item) => <Button key={item.id} type="button" size="sm" variant={type === item.id ? "secondary" : "ghost"} onClick={() => setType(item.id)}>{item.label}</Button>)}</div>} showViewToggle={false} summary={<span>{typeLabel} · 暂无活动表单</span>} empty={{ icon: ClipboardCheck, title: query || type !== "all" ? "没有匹配的表单" : "还没有活动表单", description: "创建表单后，它会在这里进入统一收件箱，并通过详情页配置规则与审核流程。", action: !query && type === "all" ? <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => notify.info("新建表单将在数据服务接入后开放")}><Plus />新建表单</Button><Button variant="outline" onClick={openDetailPreview}>查看详情布局示例</Button></div> : null }} />
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

function CampaignDetailPanel({ tab }) {
  const panels = {
    overview: <div className="grid gap-4 @min-[40rem]/campaign-detail:grid-cols-2"><PlaceholderCard icon={Gauge} title="状态与开放期" description="查看当前活动表单是否开放、何时截止以及名额状态。"><InfoRows rows={[["状态", "草稿（占位）"], ["开放时间", "尚未设置"], ["截止条件", "时间或收齐数量，待配置"]]} /></PlaceholderCard><PlaceholderCard icon={ClipboardList} title="收集漏斗" description="从访问、开始填写到通过和转化的阶段统计。"><InfoRows rows={[["访问", "—"], ["已提交", "—"], ["已确认 / 候补", "—"]]} /></PlaceholderCard></div>,
    form: <PlaceholderCard icon={FileText} title="表单内容" description="配置内容块、字段、字段语义和条件逻辑。" action={<Button variant="outline" onClick={() => notify.info("表单编辑器将在前端组件接入后开放")}>打开编辑器</Button>}><div className="grid gap-2 text-sm text-muted-foreground"><div className="border p-3">内容块 · 基本信息</div><div className="border p-3">字段 · 尚未配置</div><div className="border p-3">条件逻辑 · 尚未配置</div></div></PlaceholderCard>,
    rules: <PlaceholderCard icon={SlidersHorizontal} title="收集规则" description="设置可见性、开放截止、提交次数、草稿和候补。"><InfoRows rows={[["可见性", "公开链接（占位）"], ["重复提交", "尚未设置"], ["候补策略", "尚未设置"]]} /></PlaceholderCard>,
    review: <PlaceholderCard icon={ClipboardCheck} title="审核流程" description="配置审核阶段、评分量表、分配和最终决定。"><InfoRows rows={[["审核阶段", "尚未配置"], ["评分量表", "尚未配置"], ["决定方式", "人工决定（占位）"]]} /></PlaceholderCard>,
    entries: <PlaceholderCard icon={ClipboardList} title="Entry 收件箱" description="提交记录会先进入暂存层，再根据决定转化为活动级业务数据。"><div className="flex min-h-36 items-center justify-center border border-dashed text-sm text-muted-foreground">尚未有提交记录</div></PlaceholderCard>,
    results: <PlaceholderCard icon={CheckCircle2} title="收集结果" description="查看已确认、候补、已转化和异常条目。"><InfoRows rows={[["已确认", "—"], ["候补", "—"], ["已转化", "—"], ["异常", "—"]]} /></PlaceholderCard>,
    settings: <PlaceholderCard icon={Settings} title="表单设置" description="管理归档、危险操作和保存为工作空间模板。" action={<Button variant="outline" onClick={() => notify.info("表单设置将在数据服务接入后开放")}>保存为模板</Button>}><div className="flex min-h-24 items-center border border-dashed px-4 text-sm text-muted-foreground">危险操作和归档设置尚未开放。</div></PlaceholderCard>,
  };
  return panels[tab] || panels.overview;
}

export function ProductionCampaignDetailPage({ route, workspace, production }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(CAMPAIGN_DETAIL_GROUPS.some(([id]) => id === route.detailTab) ? route.detailTab : "overview");
  const goToTab = (tab) => {
    setActiveTab(tab);
    const path = route.direct ? directProductionCampaignPath(production.id, route.campaignId, tab) : productionCampaignPath(workspace.id, production.id, route.campaignId, tab);
    navigate(path);
  };
  return <div className="@container/production-campaign-detail min-w-0 space-y-6">
    <ProductionPageHeader workspace={workspace} production={production} title="表单详情" subtitle={`${production?.name || "活动"} · Campaign ${route.campaignId}`} actions={<Button variant="outline" onClick={() => navigate(route.direct ? directProductionPath(production.id, "forms") : productionPath(workspace.id, production.id, "forms"))}>返回全部表单</Button>} />
    <SettingsTabs groups={CAMPAIGN_DETAIL_GROUPS} activeGroup={activeTab} onGroupChange={goToTab} ariaLabel="表单详情分类"><CampaignDetailPanel tab={activeTab} /></SettingsTabs>
  </div>;
}
