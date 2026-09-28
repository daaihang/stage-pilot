export const workspacePages = {
  home: { title: "工作台", description: "掌握近期活动、待处理事项和团队动态。" },
  productions: { title: "活动", description: "创建并管理工作空间中的演出与制作活动。" },
  calendar: { title: "日历", description: "从时间维度查看活动、彩排和执行计划。" },
  programs: { title: "节目库", description: "沉淀可在不同活动中复用的长期节目资产。" },
  "file-types": { title: "文件类型", description: "管理当前工作空间各类资产的文件分类。" },
  "program-sheet-segment-types": { title: "节目单环节类型", description: "管理工作空间节目单环节的分类、默认行为和使用情况。" },
  "forms-review": { title: "表单与审核", description: "配置工作空间可用的审核方式和表单默认审核方式。" },
  people: { title: "人员", description: "管理艺人、工作人员和其他长期联系人。" },
  organizations: { title: "机构", description: "管理品牌、学校、合作方和供应商资料。" },
  venues: { title: "场地", description: "管理场地资料、舞台条件和历史使用记录。" },
  equipment: { title: "设备", description: "管理工作空间长期持有或常用的设备资源。" },
  members: { title: "成员", description: "管理可以访问这个工作空间的团队成员。" },
  roles: { title: "角色与权限", description: "查看工作空间角色和可用权限范围。" },
  templates: { title: "模板", description: "维护活动、征集、流程和表单模板。" },
  settings: { title: "工作空间设置", description: "管理成员、权限、品牌、集成和安全设置。" },
  files: { title: "文件资料", description: "管理工作空间共享的文档和媒体文件。" },
};

export const productionPages = {
  overview: { title: "概览", description: "查看本场活动的状态、关键日期和待办事项。" },
  "activity-info": { title: "活动信息", description: "维护活动对内与对外展示信息，供报名和收集表单复用。" },
  "form-templates": { title: "表单模板", description: "从系统模板或工作空间模板开始创建收集表单。" },
  forms: { title: "全部表单", description: "统一管理征集、招募、报名和通用收集表单。" },
  "collection-workflows": { title: "收集工作流", description: "配置收集后的审核、评分、决定和转化流程。" },
  // 旧版入口保留用于兼容已保存的活动链接；侧栏使用 forms 作为新入口。
  recruitment: { title: "全部表单", description: "统一管理征集、招募、报名和通用收集表单。" },
  programs: { title: "节目", description: "管理本场节目、演出者、技术需求和来源。" },
  "program-sheets": { title: "节目单", description: "管理本场活动的节目单版本、场次关联和正式发布状态。" },
  people: { title: "人员", description: "配置本场参与人员、岗位、排班和职责。" },
  organizations: { title: "合作机构", description: "管理本场赞助商、合作方、供应商和合同关系。" },
  "venues-equipment": { title: "场地与设备", description: "配置本场使用的区域、时段、设备和技术条件。" },
  schedule: { title: "总日程", description: "查看装台、彩排、演出和撤台等制作时间安排。" },
  occurrences: { title: "场次", description: "管理正式演出、预演和加演等独立场次。" },
  rehearsals: { title: "彩排", description: "安排技术彩排、带妆彩排和其他排练会话。" },
  rundown: { title: "流程编排", description: "编排 Rundown、彩排计划和现场时间线。" },
  stage: { title: "舞台执行", description: "管理灯光、音响、视频和舞台 Cue。" },
  access: { title: "通行与签到", description: "管理通行证、区域权限、报名与签到。" },
  files: { title: "文件", description: "集中管理仅属于本场活动的文档和媒体文件。" },
  members: { title: "成员", description: "管理本场活动的协作成员与访问期限。" },
  roles: { title: "角色与权限", description: "查看固定活动角色及其权限范围。" },
  settings: { title: "活动设置", description: "管理活动信息、权限、功能模块和归档。" },
  locations: { title: "场地与空间", description: "配置本活动使用的场地、空间和地点顺序。" },
};

export const accountPages = {
  profile: { title: "个人资料", description: "管理你的个人身份信息和邮箱。" },
  preferences: { title: "偏好与通知", description: "控制 StagePilot 的外观和通知体验。" },
  security: { title: "登录与安全", description: "保护账号、密码和登录安全。" },
  billing: { title: "方案与账单", description: "查看当前方案和可用能力。" },
  storage: { title: "存储用量", description: "查看工作空间的文件额度、临时预留和实际对象存储占用。" },
  developer: { title: "开发工具", description: "验证桌面能力和 UI 组件（仅开发构建）。", devOnly: true },
};

export const workTabs = new Set(["workspaces", "participating", "collaboration"]);

// Production 生命周期状态（Production Foundation）：只表达生命周期，
// 不表达节目征集或现场状态。与后端 CHECK 约束保持一致。
export const productionStatus = {
  active: { label: "进行中", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "已结束", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  archived: { label: "已归档", className: "bg-muted text-muted-foreground" },
};

export function workspacePath(workspaceId, page = "home") {
  const paths = {
    home: "home", productions: "productions", calendar: "calendar",
    programs: "library/programs", people: "library/people", organizations: "library/organizations",
    "file-types": "library/file-types", "program-sheet-segment-types": "library/program-sheet-segment-types", venues: "library/venues", equipment: "library/equipment", files: "files", members: "members", roles: "roles", templates: "templates", "forms-review": "forms-review", settings: "settings",
  };
  return `/w/${workspaceId}/${paths[page] ?? paths.home}`;
}

export function resourcePath(workspaceId, resourceType, resourceId) {
  const paths = { programs: "library/programs", people: "library/people", organizations: "library/organizations", venues: "library/venues", equipment: "library/equipment" };
  return `/w/${workspaceId}/${paths[resourceType]}/${resourceId}`;
}

export function resourceTypePanelPath(workspaceId, resourceType) {
  return `${workspacePath(workspaceId, resourceType)}?panel=types`;
}

export function productionPath(workspaceId, productionId, page = "overview") {
  return `/w/${workspaceId}/p/${productionId}/${productionPages[page] ? page : "overview"}`;
}

export function productionCampaignPath(workspaceId, productionId, campaignId, tab = "overview") {
  const suffix = tab && tab !== "overview" ? `/${tab}` : "";
  return `/w/${workspaceId}/p/${productionId}/forms/${campaignId}${suffix}`;
}

export function programSheetSegmentTypePanelPath(workspaceId) {
  // Deprecated name kept for existing callers; segment types are workspace-scoped.
  return workspacePath(workspaceId, "program-sheet-segment-types");
}

export function directProductionPath(productionId, page = "overview") {
  return `/p/${productionId}/${productionPages[page] ? page : "overview"}`;
}

export function directProductionCampaignPath(productionId, campaignId, tab = "overview") {
  const suffix = tab && tab !== "overview" ? `/${tab}` : "";
  return `/p/${productionId}/forms/${campaignId}${suffix}`;
}

/**
 * Resolve the global context exit (Workspace/Production shell boundary).
 * This is intentionally different from a page-level back link: a child page
 * should return to its Production overview, while the shell exit leaves the
 * current context entirely.
 */
export function resolveContextExit({ route, workspace } = {}) {
  if (!route) return "/work";
  if (route.mode === "production") {
    if (workspace?.workspaceNavigable === false || !workspace?.id) return "/work?tab=participating";
    return workspace?.id ? workspacePath(workspace.id, "productions") : "/work";
  }
  if (route.mode === "workspace") return workspace?.id ? workspacePath(workspace.id, "home") : "/work";
  if (route.mode === "account") return "/work";
  return "/work";
}

/**
 * Resolve a deterministic page hierarchy destination. Do not replace this
 * with navigate(-1): direct/deep links may not have a useful history entry.
 */
export function resolvePageBack({ route, workspace, production, accountReturn } = {}) {
  if (!route) return null;
  if (route.mode === "production") {
    const contextExit = resolveContextExit({ route, workspace });
    if (route.campaignId && production) {
      return {
        kind: "route",
        to: route.direct ? directProductionPath(production.id, "forms") : productionPath(workspace?.id, production.id, "forms"),
        label: "全部表单",
      };
    }
    if (route.page === "overview") return { kind: "route", to: contextExit, label: workspace?.workspaceNavigable === false || !workspace?.id ? "我的活动" : "活动" };
    if (!production?.id) return { kind: "route", to: contextExit, label: workspace?.workspaceNavigable === false || !workspace?.id ? "我的活动" : "活动" };
    return {
      kind: "route",
      to: workspace?.workspaceNavigable === false || !workspace?.id ? directProductionPath(production.id, "overview") : productionPath(workspace.id, production.id, "overview"),
      label: "活动概览",
    };
  }
  if (route.mode === "workspace") {
    if (route.resourceId) return { kind: "close-detail", to: workspacePath(route.workspaceId, route.page), label: "资源库" };
    if (route.page === "home" || route.page === "productions") return null;
    return { kind: "route", to: workspacePath(route.workspaceId, "home"), label: workspace?.name || "工作台" };
  }
  if (route.mode === "account") return { kind: "route", to: accountReturn || "/work", label: "返回" };
  return null;
}

/** Resolve the canonical URL used when a window-level detail surface closes. */
export function resolveDetailClose({ route, workspace, production } = {}) {
  if (!route) return null;
  if (route.mode === "workspace" && route.resourceId) return workspacePath(route.workspaceId, route.page);
  if (route.mode === "workspace" && route.panel === "types") return workspacePath(route.workspaceId, route.page);
  if (route.mode === "workspace" && route.page === "members" && route.panel === "invitations") return workspacePath(route.workspaceId, "members");
  if (route.mode === "production" && route.page === "forms" && route.campaignId && production) {
    return route.direct ? directProductionPath(production.id, "forms") : productionPath(workspace?.id, production.id, "forms");
  }
  if (route.mode === "production" && route.page === "members" && route.panel === "invitations" && production) {
    return route.direct ? directProductionPath(production.id, "members") : productionPath(workspace?.id, production.id, "members");
  }
  if (route.mode === "production" && route.panel === "locations" && production) {
    return route.direct ? directProductionPath(production.id, route.page) : productionPath(workspace?.id, production.id, route.page);
  }
  return null;
}

export function accountPath(page = "profile", from) {
  const nextPage = accountPages[page] && (!accountPages[page].devOnly || import.meta.env.DEV) ? page : "profile";
  const path = `/account/${nextPage}`;
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}

/**
 * Shared navigation model for page and titlebar breadcrumbs.
 * The model intentionally contains routes only; callers decide how to render it.
 */
export function buildBreadcrumbItems({ route, workspace, production } = {}) {
  if (!route) return [];
  if (route.mode === "account") {
    return [
      { label: "账户", to: accountPath("profile") },
      { label: route.meta?.title || "个人资料", current: true },
    ];
  }
  if (route.mode === "work") return [{ label: "我的工作", current: true }];
  if (route.mode === "invite") return [{ label: "接受邀请", current: true }];
  if (route.mode !== "workspace" && route.mode !== "production") return [];
  if (!workspace) return [];

  const items = [{ label: workspace.name, to: workspacePath(workspace.id, "home") }];
  if (route.mode === "production") {
    items.push({ label: "活动", to: workspacePath(workspace.id, "productions") });
    if (production) {
      items.push({
        label: production.isCreationSession ? "新建活动" : production.name,
        to: production.isCreationSession ? undefined : productionPath(workspace.id, production.id, "overview"),
      });
    }
  }
  items.push({ label: route.meta?.title || "当前页面", current: true });
  return items;
}

export function resolveAccountReturnTarget(search, fallback) {
  const candidate = new URLSearchParams(search || "").get("from");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/account")) return fallback;
  return candidate;
}

export function matchStagePilotRoute(pathname, search = "") {
  const publicCampaignLongMatch = pathname.match(/^\/share\/campaign\/([^/]+)\/?$/);
  if (publicCampaignLongMatch) return { mode: "public-campaign", token: publicCampaignLongMatch[1], short: false, meta: { title: "公开表单" } };
  const publicCampaignShortMatch = pathname.match(/^\/s\/c\/([^/]+)\/?$/);
  if (publicCampaignShortMatch) return { mode: "public-campaign", token: publicCampaignShortMatch[1], short: true, meta: { title: "公开表单" } };
  const publicLongMatch = pathname.match(/^\/share\/program-sheet\/([^/]+)\/?$/);
  if (publicLongMatch) return { mode: "public-program-sheet", token: publicLongMatch[1], meta: { title: "节目单" } };
  const publicShortMatch = pathname.match(/^\/s\/ps\/([^/]+)\/?$/);
  if (publicShortMatch) return { mode: "public-program-sheet", token: publicShortMatch[1], meta: { title: "节目单" } };
  const inviteMatch = pathname.match(/^\/join\/([^/]+)\/?$/);
  if (inviteMatch) return { mode: "invite", code: inviteMatch[1], meta: { title: "接受邀请", description: "加入受邀请的工作空间或活动" } };
  if (pathname === "/work") {
    const requestedTab = new URLSearchParams(search).get("tab");
    return { mode: "work", page: "work", tab: workTabs.has(requestedTab) ? requestedTab : "workspaces", meta: { title: "我的工作", description: "访问你的工作空间、参与的活动和协作事项" } };
  }
  const accountMatch = pathname.match(/^\/account\/([^/]+)\/?$/);
  if (accountMatch) {
    const [, page] = accountMatch;
    if (!accountPages[page] || (accountPages[page].devOnly && !import.meta.env.DEV)) return null;
    return { mode: "account", page, meta: accountPages[page] };
  }
  const productionCampaignMatch = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)\/forms\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (productionCampaignMatch) {
    const [, workspaceId, productionId, campaignId, requestedTab] = productionCampaignMatch;
    const detailTab = requestedTab || "overview";
    return { mode: "production", workspaceId, productionId, page: "forms", campaignId, detailTab, panel: null, meta: productionPages.forms };
  }
  const productionMatch = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)\/([^/]+)\/?$/);
  if (productionMatch) {
    const [, workspaceId, productionId, page] = productionMatch;
    const params = new URLSearchParams(search);
    const panelValue = params.get("panel");
    const panel = page === "program-sheets" && panelValue === "segment-types" ? panelValue : (page === "members" && panelValue === "invitations" ? panelValue : (["overview", "settings"].includes(page) && panelValue === "locations" ? panelValue : null));
    return productionPages[page] ? { mode: "production", workspaceId, productionId, page, panel, detailId: params.get("detail") || undefined, meta: productionPages[page] } : null;
  }
  const directProductionCampaignMatch = pathname.match(/^\/p\/([^/]+)\/forms\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (directProductionCampaignMatch) {
    const [, productionId, campaignId, requestedTab] = directProductionCampaignMatch;
    const detailTab = requestedTab || "overview";
    return { mode: "production", workspaceId: null, productionId, page: "forms", campaignId, detailTab, direct: true, panel: null, meta: productionPages.forms };
  }
  const directProductionMatch = pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (directProductionMatch) {
    const [, productionId, requestedPage] = directProductionMatch;
    const page = requestedPage || "overview";
    const params = new URLSearchParams(search);
    const panelValue = params.get("panel");
    return productionPages[page] ? { mode: "production", workspaceId: null, productionId, page, direct: true, panel: page === "members" && panelValue === "invitations" ? panelValue : (["overview", "settings"].includes(page) && panelValue === "locations" ? panelValue : null), detailId: params.get("detail") || undefined, meta: productionPages[page] } : null;
  }
  const resourceMatch = pathname.match(/^\/w\/([^/]+)\/library\/(programs|people|organizations|venues|equipment)(?:\/([^/]+))?\/?$/);
  if (resourceMatch) {
    const [, workspaceId, page, resourceId] = resourceMatch;
    const panelValue = new URLSearchParams(search).get("panel");
    const panel = !resourceId && panelValue === "types" ? panelValue : null;
    return { mode: "workspace", workspaceId, productionId: null, page, resourceId, panel: panel === "types" ? panel : null, meta: workspacePages[page] };
  }
  const workspaceMatch = pathname.match(/^\/w\/([^/]+)\/(home|productions|calendar|files|members|roles|templates|forms-review|settings|library\/(programs|file-types|program-sheet-segment-types|people|organizations|venues|equipment))\/?$/);
  if (!workspaceMatch) return null;
  const [, workspaceId, routePage, libraryPage] = workspaceMatch;
  const page = libraryPage || routePage;
  const panelValue = new URLSearchParams(search).get("panel");
  const panel = page === "members" && panelValue === "invitations" ? panelValue : (panelValue === "types" ? panelValue : null);
  return { mode: "workspace", workspaceId, productionId: null, page, panel, meta: workspacePages[page] };
}

export function formatProductionDate(production) {
  if (!production) return "";
  // 日期区间按活动自己的时区展示；缺少时间时返回占位，避免 Invalid Date。
  const timezone = production.timezone || "Asia/Shanghai";
  if (!production.plannedStartAt || !production.plannedEndAt) return "时间待定";
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: timezone });
  const start = new Date(production.plannedStartAt);
  const end = new Date(production.plannedEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "时间待定";
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

/** 侧栏二级菜单预览的活动数量上限。 */
export const SIDEBAR_PRODUCTION_PREVIEW_LIMIT = 5;

const isArchivedProduction = (item) => Boolean(item?.archivedAt) || item?.status === "archived";

/**
 * 侧栏二级菜单的活动预览选取规则（纯函数）：
 * active（进行中）→ upcoming（未开始）→ past（已结束）→ undated（时间待定），
 * archived 不进预览，只能通过「查看全部活动」到达；最多返回 limit 条。
 * upcoming 按 plannedStartAt 升序（越临近越靠前）；past 按 plannedEndAt 降序（越刚结束越靠前）。
 */
export function pickSidebarProductions(productions, { limit = SIDEBAR_PRODUCTION_PREVIEW_LIMIT, now = Date.now() } = {}) {
  if (!Array.isArray(productions)) return [];
  const startedAt = (item) => (item.plannedStartAt ? new Date(item.plannedStartAt).getTime() : null);
  const endedAt = (item) => (item.plannedEndAt ? new Date(item.plannedEndAt).getTime() : null);
  const valid = (value) => value !== null && !Number.isNaN(value);
  const buckets = { active: [], upcoming: [], past: [], undated: [] };
  for (const item of productions) {
    if (!item || isArchivedProduction(item)) continue;
    const start = startedAt(item);
    const end = endedAt(item);
    if (item.status === "active" || (valid(start) && valid(end) && start <= now && end >= now)) buckets.active.push(item);
    else if (valid(start) && start > now) buckets.upcoming.push(item);
    else if (valid(end) && end < now) buckets.past.push(item);
    else buckets.undated.push(item);
  }
  const stamp = (item) => {
    const time = new Date(item.createdAt ?? item.updatedAt ?? 0).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  // 无日期的 active 活动排在同级末尾，避免比较器产生 NaN 导致顺序不稳定。
  const byStartAsc = (a, b) => (startedAt(a) ?? Number.MAX_SAFE_INTEGER) - (startedAt(b) ?? Number.MAX_SAFE_INTEGER);
  const byEndDesc = (a, b) => (endedAt(b) ?? Number.MIN_SAFE_INTEGER) - (endedAt(a) ?? Number.MIN_SAFE_INTEGER);
  const byCreatedDesc = (a, b) => stamp(b) - stamp(a);
  return [
    ...buckets.active.sort(byStartAsc),
    ...buckets.upcoming.sort(byStartAsc),
    ...buckets.past.sort(byEndDesc),
    ...buckets.undated.sort(byCreatedDesc),
  ].slice(0, limit);
}

/** 二级菜单副标题：超出预览上限时提示剩余数量，与「查看全部活动」衔接。 */
export function sidebarProductionBadge(total, limit = SIDEBAR_PRODUCTION_PREVIEW_LIMIT) {
  return total > limit ? `${limit} / 共 ${total} 个` : `${total} 个可用活动`;
}
