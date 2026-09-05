import { useState } from "react";
import {
  ArrowLeft, Building2, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, ContactRound, FileCog, FileText, FolderKanban,
  Gauge, KeyRound, LayoutTemplate, ListMusic, ListTree, MapPin, Mic2, MonitorCog, Package, Plus,
  Search, Settings, Sparkles, Theater, UsersRound, Workflow, Check, ChevronsUpDown, Bell, CreditCard, LockKeyhole, UserRound, Terminal,
} from "@/components/ui/icons";
import { NavLink } from "react-router-dom";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import { accountPath, directProductionPath, productionPath, workspacePath } from "@/lib/navigation";
import { notify } from "@/components/ui/sonner";

const workspaceGroups = [
  { label: "核心", items: [["home", "工作台", Gauge], ["productions", "活动", FolderKanban], ["calendar", "日历", CalendarDays], ["files", "文件资料", FileText]] },
  { label: "资源库", items: [["programs", "节目库", Mic2], ["people", "人员库", ContactRound], ["organizations", "机构", Building2], ["venues", "场地", MapPin], ["equipment", "设备", Package]] },
  { label: "协作与权限", items: [["members", "成员", UsersRound], ["roles", "角色与权限", KeyRound]] },
  { label: "管理", items: [["file-types", "文件类型", FileCog], ["templates", "模板", LayoutTemplate], ["settings", "工作空间设置", Settings]] },
];

const productionGroups = [
  { label: null, items: [["overview", "概览", Gauge]] },
  { label: "筹备", items: [["recruitment", "征集与审核", ClipboardCheck], ["programs", "节目", Mic2], ["program-sheets", "节目单", ListMusic], ["locations", "场地与空间", MapPin], ["people", "人员", UsersRound]] },
  { label: "排程", items: [["schedule", "总日程", CalendarRange], ["occurrences", "场次", ListTree], ["rehearsals", "彩排", ClipboardList]] },
  { label: "制作与现场", items: [["rundown", "流程编排", Workflow], ["stage", "舞台执行", Theater]] },
  { label: "协作与权限", items: [["members", "成员", UsersRound], ["roles", "角色与权限", KeyRound]] },
  { label: "资料", items: [["settings", "活动设置", Settings]] },
];

const accountGroups = [
  { label: "账户", items: [["profile", "个人资料", UserRound], ["preferences", "偏好与通知", Bell], ["security", "登录与安全", LockKeyhole], ["billing", "方案与账单", CreditCard]] },
  ...(import.meta.env.DEV ? [{ label: "开发", items: [["developer", "开发工具", Terminal]] }] : []),
];

function RecentContextRow({ item, active, onClick }) {
  const Icon = item.type === "production" ? Theater : item.type === "workspace" ? Building2 : FolderKanban;
  const elapsed = Math.max(0, Date.now() - (item.lastOpenedAt || Date.now()));
  const relativeTime = elapsed < 60_000 ? "刚刚" : elapsed < 3_600_000 ? `${Math.floor(elapsed / 60_000)}分钟前` : elapsed < 86_400_000 ? `${Math.floor(elapsed / 3_600_000)}小时前` : `${Math.floor(elapsed / 86_400_000)}天前`;
  const subtitle = [item.workspaceName, item.role || (item.type === "workspace" ? "工作空间" : item.type === "production" ? "活动" : "协作"), relativeTime].filter(Boolean).join(" · ");
  return <DropdownMenuItem className="items-start gap-2 p-2" onClick={onClick}>
    <Icon className="mt-0.5 size-4" />
    <div className="grid min-w-0 flex-1"><span className="truncate text-sm">{item.name}</span><span className="truncate text-xs text-muted-foreground">{subtitle}</span></div>
    {active && <Check className="mt-0.5 size-3.5" aria-label="当前上下文" />}
  </DropdownMenuItem>;
}

function WorkspaceSwitcher({ workspace, production, recentContexts, onOpenRecentContext, onCreateWorkspace, onManageWorkspaces }) {
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  return <SidebarMenu><SidebarMenuItem><DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip="工作上下文" className="data-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center" />}>
    <div className="flex size-8 shrink-0 items-center justify-center bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">{workspace?.logo || <Sparkles className="size-4" />}</div>
    <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden"><span className="truncate text-sm font-medium">{workspace?.name || "选择工作空间"}</span><span className="truncate text-xs text-muted-foreground">{production ? production.name : workspace?.plan || "进入后解锁导航"}</span></div>
    <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
  </DropdownMenuTrigger><DropdownMenuContent className="min-w-80" side={isMobile ? "bottom" : "right"} align="start" sideOffset={4}>
    <DropdownMenuGroup><DropdownMenuLabel>最近访问</DropdownMenuLabel>
      {recentContexts.length ? recentContexts.map((item) => <RecentContextRow key={`${item.type}:${item.id}`} item={item} active={(item.type === "workspace" && item.id === workspace?.id) || (item.type === "production" && item.id === production?.id)} onClick={() => { closeMenu(); onOpenRecentContext(item); }} />) : <DropdownMenuItem disabled>暂无最近访问</DropdownMenuItem>}
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={() => { closeMenu(); onCreateWorkspace(); }}><Plus />创建工作空间</DropdownMenuItem>
    <DropdownMenuItem onClick={() => { closeMenu(); onManageWorkspaces(); }}><FolderKanban />查看全部工作</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu></SidebarMenuItem></SidebarMenu>;
}

function NavigationGroups({ groups, route, workspace, production, disabled = false, creationSession = false, account = false, accountReturnPath, onOpenAccountCenter }) {
  const canViewProductionMembers = production && (
    (Array.isArray(production.permissionKeys) && production.permissionKeys.includes("production.members.view"))
    || ["owner", "admin"].includes(workspace?.role)
    || ["producer", "editor", "stage_manager"].includes(production.directRole)
  );
  return groups.map((group, index) => <SidebarGroup key={group.label ?? `primary-${index}`}>
    {group.label && <SidebarGroupLabel className={disabled ? "opacity-50" : undefined}>{group.label}</SidebarGroupLabel>}
    <SidebarMenu>{group.items.filter(([page]) => !(production && ["members", "roles"].includes(page) && !canViewProductionMembers)).map(([page, label, Icon]) => {
      const itemDisabled = disabled || Boolean(creationSession && page !== "overview");
      const href = account ? accountPath(page, accountReturnPath) : (workspace ? (production ? (production.workspaceNavigable === false ? directProductionPath(production.id, page) : productionPath(workspace.id, production.id, page)) : workspacePath(workspace.id, page)) : undefined);
      const active = Boolean(route?.page === page);
      if (itemDisabled) {
        return <SidebarMenuItem key={page}><SidebarMenuButton disabled tooltip={`${label}（当前不可用）`} className="opacity-50 blur-[1px]"><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
      }
      if (account && page === "developer" && onOpenAccountCenter) return <SidebarMenuItem key={page}><SidebarMenuButton isActive={active} tooltip={label} onClick={() => onOpenAccountCenter(page)}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
      return <SidebarMenuItem key={page}><SidebarMenuButton isActive={active} tooltip={label} render={<NavLink to={href} aria-current={active ? "page" : undefined} />}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
    })}</SidebarMenu>
  </SidebarGroup>);
}

function AccountNavigation({ route, returnPath, returnLabel = "返回工作空间", onOpenAccountCenter }) {
  return <>
    <SidebarGroup className="pb-0"><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={returnLabel} render={<NavLink to={returnPath || "/"} />}><ArrowLeft /><span className="truncate">{returnLabel}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
    <NavigationGroups groups={accountGroups} route={route} account accountReturnPath={returnPath} onOpenAccountCenter={onOpenAccountCenter} />
  </>;
}

function SidebarNavigationLoading() {
  return <SidebarGroup aria-label="正在加载导航"><SidebarMenu>
    <SidebarMenuItem><SidebarMenuButton disabled className="animate-pulse"><Sparkles /><span>正在加载导航</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><div className="mx-2 h-7 bg-sidebar-accent/60 animate-pulse" /></SidebarMenuItem>
    <SidebarMenuItem><div className="mx-2 h-7 bg-sidebar-accent/60 animate-pulse" /></SidebarMenuItem>
  </SidebarMenu></SidebarGroup>;
}

export function AppSidebar({ route, workspace, production, navigationLoading = false, recentContexts = [], workspaceSelectionMode = false, railEnabled = true, accountReturnPath, accountReturnLabel, onOpenRecentContext, onLeaveCreation, onCreateWorkspace, onManageWorkspaces, onOpenDocuments, user, subscription, onOpenAccountCenter, onLogout, onRequireAuth, ...props }) {
  return <Sidebar collapsible="icon" {...props}>
    <SidebarHeader>{navigationLoading ? <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" disabled className="animate-pulse"><Sparkles /><span>正在加载导航</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu> : route?.mode === "account" || route?.mode === "work" ? <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" tooltip={route.mode === "work" ? "我的工作" : "账户中心"} className="group-data-[collapsible=icon]:justify-center"><div className="flex size-8 shrink-0 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">{route.mode === "work" ? <Sparkles className="size-4" /> : <UserRound className="size-4" />}</div><div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden"><span className="truncate text-sm font-medium">{route.mode === "work" ? "我的工作" : "账户中心"}</span><span className="truncate text-xs text-muted-foreground">{route.mode === "work" ? "全局工作上下文" : "个人设置"}</span></div></SidebarMenuButton></SidebarMenuItem></SidebarMenu> : <WorkspaceSwitcher workspace={workspace} production={production} recentContexts={recentContexts} onOpenRecentContext={onOpenRecentContext} onCreateWorkspace={onCreateWorkspace} onManageWorkspaces={onManageWorkspaces} />}</SidebarHeader>
    <SidebarContent>
      {navigationLoading ? <SidebarNavigationLoading /> : <>
      {route?.mode === "account" && <AccountNavigation route={route} returnPath={accountReturnPath} returnLabel={accountReturnLabel} onOpenAccountCenter={onOpenAccountCenter} />}
      {route?.mode === "production" && workspace && production && <>
        <SidebarGroup className="pb-0"><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={production.workspaceNavigable === false ? "返回我的活动" : `返回 ${workspace.name}`} onClick={(event) => { if (production?.isCreationSession && onLeaveCreation) { event.preventDefault(); onLeaveCreation(); } }} render={<NavLink to={production.workspaceNavigable === false ? "/work?tab=participating" : workspacePath(workspace.id, "home")} />}><ArrowLeft /><span className="truncate">{production.workspaceNavigable === false ? "我的活动" : workspace.name}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
        <NavigationGroups groups={productionGroups} route={route} workspace={workspace} production={production} creationSession={Boolean(production?.isCreationSession)} />
      </>}
      {route?.mode === "workspace" && workspace && <NavigationGroups groups={workspaceGroups} route={route} workspace={workspace} />}
      {workspaceSelectionMode && <NavigationGroups groups={workspaceGroups} route={route} workspace={workspace} disabled />}
      {!route && !workspaceSelectionMode && <SidebarGroup><SidebarMenu><SidebarMenuItem><SidebarMenuButton disabled><MonitorCog /><span>正在加载导航</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>}
      </>}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton tooltip="搜索" onClick={() => notify.message("全局搜索将在数据服务接入后开放", { description: "计划快捷键：Ctrl / Cmd + K" })}><Search /><span>搜索</span><span className="ml-auto text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">Ctrl K</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton tooltip="帮助与文档" onClick={onOpenDocuments}><FileText /><span>帮助与文档</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
      {user ? <NavUser user={user} subscription={subscription} onOpenAccountCenter={onOpenAccountCenter} onLogout={onLogout} /> : <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="登录" onClick={onRequireAuth}><Sparkles /><span>登录 StagePilot</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>}
    </SidebarFooter>
    <SidebarRail disabled={!railEnabled} />
  </Sidebar>;
}
