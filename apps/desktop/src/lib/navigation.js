export const workspacePages = {
  home: { title: "工作台", description: "掌握近期活动、待处理事项和团队动态。" },
  productions: { title: "活动", description: "创建并管理工作空间中的演出与制作活动。" },
  calendar: { title: "日历", description: "从时间维度查看活动、彩排和执行计划。" },
  programs: { title: "节目库", description: "沉淀可在不同活动中复用的长期节目资产。" },
  "program-types": { title: "节目类型", description: "管理当前工作空间的节目类型、排序和使用情况。" },
  "file-types": { title: "文件类型", description: "管理当前工作空间各类资产的文件分类。" },
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
  recruitment: { title: "征集与审核", description: "管理征集活动、报名申请和审核流程。" },
  programs: { title: "节目", description: "管理本场节目、演出者、技术需求和来源。" },
  people: { title: "人员", description: "配置本场参与人员、岗位、排班和职责。" },
  organizations: { title: "合作机构", description: "管理本场赞助商、合作方、供应商和合同关系。" },
  "venues-equipment": { title: "场地与设备", description: "配置本场使用的区域、时段、设备和技术条件。" },
  rundown: { title: "流程编排", description: "编排 Rundown、彩排计划和现场时间线。" },
  stage: { title: "舞台执行", description: "管理灯光、音响、视频和舞台 Cue。" },
  access: { title: "通行与签到", description: "管理通行证、区域权限、报名与签到。" },
  files: { title: "文件", description: "集中管理仅属于本场活动的文档和媒体文件。" },
  members: { title: "成员", description: "管理本场活动的协作成员与访问期限。" },
  roles: { title: "角色与权限", description: "查看固定活动角色及其权限范围。" },
  settings: { title: "活动设置", description: "管理活动信息、权限、功能模块和归档。" },
};

export const accountPages = {
  profile: { title: "个人资料", description: "管理你的个人身份信息和邮箱。" },
  preferences: { title: "偏好与通知", description: "控制 StagePilot 的外观和通知体验。" },
  security: { title: "登录与安全", description: "保护账号、密码和登录安全。" },
  billing: { title: "方案与账单", description: "查看当前方案和可用能力。" },
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
    "program-types": "library/program-types", "file-types": "library/file-types", venues: "library/venues", equipment: "library/equipment", files: "files", members: "members", roles: "roles", templates: "templates", settings: "settings",
  };
  return `/w/${workspaceId}/${paths[page] ?? paths.home}`;
}

export function resourcePath(workspaceId, resourceType, resourceId) {
  const paths = { programs: "library/programs", people: "library/people", organizations: "library/organizations", venues: "library/venues", equipment: "library/equipment" };
  return `/w/${workspaceId}/${paths[resourceType]}/${resourceId}`;
}

export function productionPath(workspaceId, productionId, page = "overview") {
  return `/w/${workspaceId}/p/${productionId}/${productionPages[page] ? page : "overview"}`;
}

export function directProductionPath(productionId, page = "overview") {
  return `/p/${productionId}/${productionPages[page] ? page : "overview"}`;
}

export function accountPath(page = "profile", from) {
  const nextPage = accountPages[page] && (!accountPages[page].devOnly || import.meta.env.DEV) ? page : "profile";
  const path = `/account/${nextPage}`;
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}

export function resolveAccountReturnTarget(search, fallback) {
  const candidate = new URLSearchParams(search || "").get("from");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/account")) return fallback;
  return candidate;
}

export function matchStagePilotRoute(pathname, search = "") {
  const inviteMatch = pathname.match(/^\/invite\/([^/]+)\/?$/);
  if (inviteMatch) return { mode: "invite", token: inviteMatch[1], meta: { title: "接受活动邀请", description: "加入受邀请的活动" } };
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
  const productionMatch = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)\/([^/]+)\/?$/);
  if (productionMatch) {
    const [, workspaceId, productionId, page] = productionMatch;
    return productionPages[page] ? { mode: "production", workspaceId, productionId, page, meta: productionPages[page] } : null;
  }
  const directProductionMatch = pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (directProductionMatch) {
    const [, productionId, requestedPage] = directProductionMatch;
    const page = requestedPage || "overview";
    return productionPages[page] ? { mode: "production", workspaceId: null, productionId, page, direct: true, meta: productionPages[page] } : null;
  }
  const resourceMatch = pathname.match(/^\/w\/([^/]+)\/library\/(programs|people|organizations|venues|equipment)\/([^/]+)\/?$/);
  if (resourceMatch) {
    const [, workspaceId, page, resourceId] = resourceMatch;
    return { mode: "workspace", workspaceId, productionId: null, page, resourceId, meta: workspacePages[page] };
  }
  const workspaceMatch = pathname.match(/^\/w\/([^/]+)\/(home|productions|calendar|files|members|roles|templates|settings|library\/(programs|program-types|file-types|people|organizations|venues|equipment))\/?$/);
  if (!workspaceMatch) return null;
  const [, workspaceId, routePage, libraryPage] = workspaceMatch;
  const page = libraryPage || routePage;
  return { mode: "workspace", workspaceId, productionId: null, page, meta: workspacePages[page] };
}

export function formatProductionDate(production) {
  if (!production) return "";
  // 日期区间按活动自己的时区展示；缺少时间时返回占位，避免 Invalid Date。
  const timezone = production.timezone || "Asia/Shanghai";
  if (!production.startsAt || !production.endsAt) return "时间待定";
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: timezone });
  const start = new Date(production.startsAt);
  const end = new Date(production.endsAt);
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
 * upcoming 按 startsAt 升序（越临近越靠前）；past 按 endsAt 降序（越刚结束越靠前）。
 */
export function pickSidebarProductions(productions, { limit = SIDEBAR_PRODUCTION_PREVIEW_LIMIT, now = Date.now() } = {}) {
  if (!Array.isArray(productions)) return [];
  const startedAt = (item) => (item.startsAt ? new Date(item.startsAt).getTime() : null);
  const endedAt = (item) => (item.endsAt ? new Date(item.endsAt).getTime() : null);
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
