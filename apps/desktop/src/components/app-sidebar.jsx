import { useState } from "react";
import {
  ArrowLeft, Building2, CalendarDays, ClipboardCheck, ContactRound, FileText, FolderKanban,
  Gauge, KeyRound, LayoutTemplate, LoaderCircle, MapPin, Mic2, MonitorCog, Package, Plus,
  RotateCcw, Search, Settings, Sparkles, Theater, UsersRound, Workflow, Check, ChevronsUpDown, Bell, CreditCard, LockKeyhole, UserRound, Terminal,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import {
  accountPath, formatProductionDate, pickSidebarProductions, productionPath, productionStatus,
  sidebarProductionBadge, workspacePath,
} from "@/lib/navigation";
import { notify } from "@/components/ui/sonner";

const workspaceGroups = [
  { label: "核心", items: [["home", "工作台", Gauge], ["productions", "活动", FolderKanban], ["calendar", "日历", CalendarDays], ["files", "文件资料", FileText]] },
  { label: "资源库", items: [["programs", "节目库", Mic2], ["people", "人员库", ContactRound], ["organizations", "机构", Building2], ["venues", "场地", MapPin], ["equipment", "设备", Package]] },
  { label: "协作与权限", items: [["members", "成员", UsersRound], ["roles", "角色与权限", KeyRound]] },
  { label: "管理", items: [["templates", "模板", LayoutTemplate], ["settings", "工作空间设置", Settings]] },
];

const productionGroups = [
  { label: null, items: [["overview", "概览", Gauge]] },
  { label: "筹备", items: [["recruitment", "征集与审核", ClipboardCheck], ["programs", "节目", Mic2], ["people", "人员", UsersRound]] },
  { label: "制作与现场", items: [["rundown", "流程编排", Workflow], ["stage", "舞台执行", Theater]] },
  { label: "资料", items: [["files", "文件", FileText], ["settings", "活动设置", Settings]] },
];

const accountGroups = [
  { label: "账户", items: [["profile", "个人资料", UserRound], ["preferences", "偏好与通知", Bell], ["security", "登录与安全", LockKeyhole], ["billing", "方案与账单", CreditCard]] },
  ...(import.meta.env.DEV ? [{ label: "开发", items: [["developer", "开发工具", Terminal]] }] : []),
];

/** 二级菜单中的单个活动行。 */
function ProductionMenuRow({ production, active, onClick }) {
  if (!production) return null;
  const status = productionStatus[production.status] ?? productionStatus.draft;
  return (
    <DropdownMenuItem className="items-start gap-2 p-2" onClick={onClick}>
      <Theater className="mt-0.5 size-4" />
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-sm">{production.name}</span>
        <span className="truncate text-xs text-muted-foreground">{formatProductionDate(production)}</span>
      </div>
      <span className="text-[11px] text-muted-foreground">{status.label}</span>
      {active && <span aria-label="当前活动"><Check className="size-3.5" /></span>}
    </DropdownMenuItem>
  );
}

/**
 * 一级菜单中的工作空间行：桌面点击 = 进入该空间工作台；hover 展开二级 = 活动预览。
 * 触屏没有 hover：tap 展开子菜单（openOnHover=false 时点击即 toggle），
 * 由子菜单内的「进入工作台」补足直达路径。二级数据在首次展开时按需加载，
 * 加载与失败状态都在行内呈现，不发 toast——hover 展开不属于用户动作。
 */
function WorkspaceMenuRow({ item, workspace, production, cachedProductions, loadState, isMobile, closeMenu, onEnterWorkspace, onOpenProduction, onViewAllProductions, onReloadProductions }) {
  const cached = cachedProductions ?? null;
  const preview = pickSidebarProductions(cached ?? []).filter(Boolean);
  const isCurrent = item.id === workspace?.id;
  return (
    <DropdownMenuSub openOnHover={!isMobile}>
      <DropdownMenuSubTrigger
        className="gap-2 p-2"
        onClick={(event) => {
          // 触屏点击留给 Base UI 展开/收起子菜单；桌面点击直达工作台。
          if (isMobile) { event.preventDefault(); return; }
          closeMenu();
          onEnterWorkspace(item);
        }}
      >
        <div className="flex size-7 shrink-0 items-center justify-center border text-xs font-semibold">{item.logo || <Sparkles className="size-3.5" />}</div>
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">{cached != null ? sidebarProductionBadge(cached.length) : item.plan}</span>
        </div>
        {isCurrent && <span aria-label="当前工作空间"><Check className="size-3.5" /></span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-64" collisionPadding={8} onOpenChange={(open) => {
        if (open && cached == null && loadState !== "loading") onReloadProductions(item.id);
      }}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">活动空间</DropdownMenuLabel>
          {cached == null && loadState === "loading" && <DropdownMenuItem disabled><LoaderCircle className="animate-spin" />加载中…</DropdownMenuItem>}
          {cached == null && loadState === "error" && <DropdownMenuItem onClick={() => onReloadProductions(item.id)}><RotateCcw />加载失败，点击重试</DropdownMenuItem>}
          {cached != null && preview.map((productionItem) => (
            <ProductionMenuRow
              key={productionItem.id}
              production={productionItem}
              active={isCurrent && productionItem.id === production?.id}
              onClick={() => { closeMenu(); onOpenProduction(item, productionItem); }}
            />
          ))}
          {cached != null && !preview.length && <DropdownMenuItem disabled>该工作空间暂无活动</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {isMobile && <DropdownMenuItem onClick={() => { closeMenu(); onEnterWorkspace(item); }}><Building2 />进入工作台</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => { closeMenu(); onViewAllProductions(item); }}><FolderKanban />查看全部活动</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * 侧栏 Header 合并下拉：一级 = 工作空间（点击进入工作台），二级 = 活动预览。
 * 根菜单使用受控 open，保证任何入口完成导航后整棵菜单树都能收起。
 */
function WorkspaceSwitcher({ workspaces, workspace, production, productionsByWorkspace, loadStates, onEnterWorkspace, onOpenProduction, onViewAllProductions, onReloadProductions, onCreateWorkspace, onManageWorkspaces }) {
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  return <SidebarMenu><SidebarMenuItem><DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip="工作空间与活动" className="data-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center" />}>
    <div className="flex size-8 shrink-0 items-center justify-center bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">{workspace?.logo || <Sparkles className="size-4" />}</div>
    <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden"><span className="truncate text-sm font-medium">{workspace?.name || "选择工作空间"}</span><span className="truncate text-xs text-muted-foreground">{production ? production.name : workspace?.plan || "进入后解锁导航"}</span></div>
    <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
  </DropdownMenuTrigger><DropdownMenuContent className="min-w-64" side={isMobile ? "bottom" : "right"} align="start" sideOffset={4}>
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-xs text-muted-foreground">工作空间</DropdownMenuLabel>
      {workspaces.map((item) => <WorkspaceMenuRow
        key={item.id}
        item={item}
        workspace={workspace}
        production={production}
        cachedProductions={productionsByWorkspace[item.id]}
        loadState={loadStates[item.id] ?? "idle"}
        isMobile={isMobile}
        closeMenu={closeMenu}
        onEnterWorkspace={onEnterWorkspace}
        onOpenProduction={onOpenProduction}
        onViewAllProductions={onViewAllProductions}
        onReloadProductions={onReloadProductions}
      />)}
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={() => { closeMenu(); onCreateWorkspace(); }}><span className="flex size-7 items-center justify-center border"><Plus className="size-3.5" /></span>创建工作空间</DropdownMenuItem>
    <DropdownMenuItem onClick={() => { closeMenu(); onManageWorkspaces(); }}><span className="flex size-7 items-center justify-center border"><Settings className="size-3.5" /></span>管理工作空间</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu></SidebarMenuItem></SidebarMenu>;
}

function NavigationGroups({ groups, route, workspace, production, disabled = false, account = false, accountReturnPath }) {
  return groups.map((group, index) => <SidebarGroup key={group.label ?? `primary-${index}`}>
    {group.label && <SidebarGroupLabel className={disabled || production?.isLocalDraft ? "opacity-50 blur-[1px]" : undefined}>{group.label}</SidebarGroupLabel>}
    <SidebarMenu>{group.items.map(([page, label, Icon]) => {
      const itemDisabled = disabled || Boolean(production?.isLocalDraft && page !== "overview");
      const href = account ? accountPath(page, accountReturnPath) : (workspace ? (production ? productionPath(workspace.id, production.id, page) : workspacePath(workspace.id, page)) : undefined);
      const active = Boolean(route?.page === page);
      if (itemDisabled) {
        return <SidebarMenuItem key={page}><SidebarMenuButton disabled tooltip={`${label}（当前不可用）`} className="opacity-50 blur-[1px]"><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
      }
      return <SidebarMenuItem key={page}><SidebarMenuButton isActive={active} tooltip={label} render={<NavLink to={href} aria-current={active ? "page" : undefined} />}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
    })}</SidebarMenu>
  </SidebarGroup>);
}

function AccountNavigation({ route, returnPath, returnLabel = "返回工作空间" }) {
  return <>
    <SidebarGroup className="pb-0"><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={returnLabel} render={<NavLink to={returnPath || "/"} />}><ArrowLeft /><span className="truncate">{returnLabel}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
    <NavigationGroups groups={accountGroups} route={route} account accountReturnPath={returnPath} />
  </>;
}

export function AppSidebar({ route, workspaces, workspace, production, productions = [], productionsByWorkspace = {}, productionLoadStates = {}, workspaceSelectionMode = false, railEnabled = true, accountReturnPath, accountReturnLabel, onEnterWorkspace, onOpenProduction, onViewAllProductions, onReloadProductions, onCreateWorkspace, onManageWorkspaces, onOpenDocuments, user, subscription, onOpenAccountCenter, onLogout, onRequireAuth, ...props }) {
  return <Sidebar collapsible="icon" {...props}>
    <SidebarHeader>{route?.mode === "account" ? <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" tooltip="账户中心" className="group-data-[collapsible=icon]:justify-center"><div className="flex size-8 shrink-0 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground"><UserRound className="size-4" /></div><div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden"><span className="truncate text-sm font-medium">账户中心</span><span className="truncate text-xs text-muted-foreground">个人设置</span></div></SidebarMenuButton></SidebarMenuItem></SidebarMenu> : <WorkspaceSwitcher workspaces={workspaces} workspace={workspace} production={production} productionsByWorkspace={productionsByWorkspace} loadStates={productionLoadStates} onEnterWorkspace={onEnterWorkspace} onOpenProduction={onOpenProduction} onViewAllProductions={onViewAllProductions} onReloadProductions={onReloadProductions} onCreateWorkspace={onCreateWorkspace} onManageWorkspaces={onManageWorkspaces} />}</SidebarHeader>
    <SidebarContent>
      {route?.mode === "account" && <AccountNavigation route={route} returnPath={accountReturnPath} returnLabel={accountReturnLabel} />}
      {route?.mode === "production" && workspace && production && <>
        <SidebarGroup className="pb-0"><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={`返回 ${workspace.name}`} render={<NavLink to={workspacePath(workspace.id, "home")} />}><ArrowLeft /><span className="truncate">{workspace.name}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
        <NavigationGroups groups={productionGroups} route={route} workspace={workspace} production={production} />
      </>}
      {route?.mode === "workspace" && workspace && <NavigationGroups groups={workspaceGroups} route={route} workspace={workspace} />}
      {workspaceSelectionMode && <NavigationGroups groups={workspaceGroups} route={route} workspace={workspace} disabled />}
      {!route && !workspaceSelectionMode && <SidebarGroup><SidebarMenu><SidebarMenuItem><SidebarMenuButton disabled><MonitorCog /><span>正在加载导航</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>}
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
