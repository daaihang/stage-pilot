import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, Info, Menu, Minus, Moon, Power, Sparkles, Square, Terminal, X } from "@/components/ui/icons";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { AppContentLayout } from "@/components/app-content-layout";
import { OverlayAvoidanceProvider } from "@/components/overlay-avoidance-context";
import { GlobalUtilityBar } from "@/components/global-utility-bar";
import { AccountCenter } from "@/components/account-center";
import { DeveloperTools } from "@/components/developer-tools";
import { PageChromeProvider, PageDetailTitlebarAction, usePageChrome } from "@/components/page-chrome";
import { WindowDetailHost, WindowDetailProvider } from "@/components/window-detail-context";
import { AppModalLayerProvider, useAppModalLayer } from "@/components/modal-layer-context";
import { NavigationProvider, useNavigationData } from "@/components/navigation-provider";
import { WorkspaceProvider, useWorkspaceContext } from "@/components/workspace-provider";
import { UserPreferencesProvider, useUserPreferences } from "@/components/user-preferences-provider";
import { WorkspacesPage } from "@/components/workspaces-page";
import { UnifiedWorkContextPage } from "@/components/unified-work-context-page";
import { WorkspaceSettingsPage } from "@/components/workspace-settings-page";
import { WorkspaceFormsReviewSettingsPage } from "@/components/workspace-forms-review-settings-page";
import { ProductionOverviewPage } from "@/components/production-overview-page";
import { ProductionSettingsPage } from "@/components/production-settings-page";
import { ProductionMembersPage, ProductionRolesPage } from "@/components/production-access-pages";
import { InvitationAcceptPage } from "@/components/production-invite-page";
import { PublicProgramSheetPage } from "@/components/public-program-sheet-page";
import { PublicCampaignFormPage } from "@/components/public-campaign-form-page";
import { ProgramLibraryPage } from "@/components/program-library-page";
import { ProgramSheetsPage } from "@/components/program-sheets-page";
import { ProductionProgramsPage } from "@/components/production-programs-page";
import { FileTypeManagementPage } from "@/components/file-type-management-page";
import { ProgramSheetSegmentTypeManagementPage } from "@/components/program-sheet-segment-type-management-page";
import { WorkspaceResourcePage } from "@/components/workspace-resource-pages";
import { FilesPage } from "@/components/files-page";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { NavigationFailure, PlaceholderPage, ProductionsPage, WorkspaceHome } from "@/components/stagepilot-pages";
import { ProductionPlanningPlaceholderPage } from "@/components/production-planning-placeholder-page";
import { ProductionActivityInfoPage, ProductionCampaignDetailPage, ProductionCollectionWorkflowsPage, ProductionFormTemplatesPage, ProductionFormsPage } from "@/components/production-collection-pages";
import { WorkspaceMembersPage, WorkspaceRolesPage } from "@/components/workspace-access-pages";
import { WorkspaceTemplateLibraryPage } from "@/components/workspace-template-library-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from "@/components/ui/menubar";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSonner, notify } from "@/components/ui/sonner";
import { AuthDialog } from "@/components/auth-dialog";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { JoinInvitationDialog } from "@/components/invitation-management-ui";
import { login as loginAccount, register as registerAccount, onSessionInvalidated, restoreSession, logout as logoutAccount } from "@/lib/auth";
import { appStore, getRecentContexts, isTauriRuntime, saveRecentContext } from "@/lib/app-store";
import { accountPath, buildBreadcrumbItems, directProductionPath, matchStagePilotRoute, productionPath, resolveAccountReturnTarget, workspacePath } from "@/lib/navigation";
import { resolveAppShellLayout } from "@/lib/app-shell-layout";
import { TitlebarBreadcrumbs } from "@/components/titlebar-breadcrumbs";
import { resolveTitlebarCenterBounds, resolveTitlebarMenuMode } from "@/lib/titlebar-layout";
import { createProduction, getAccessibleProduction, toProductionSummary, updateAccessibleProduction, updateProduction } from "@/lib/production-api";

const documentationUrl = "https://github.com/daaihang/stagepilot";
const subscriptionDefaults = { plan: "free" };
const isMac = navigator.userAgent.includes("Mac");
const isWindows = navigator.userAgent.includes("Windows");
const developerActions = new Set(["open-file", "open-folder", "copy-path", "notify", "open-devtools"]);

const menuBar = [
  { label: "文件", items: [{ label: "选择文件…", action: "open-file" }, { label: "选择文件夹…", action: "open-folder" }, { label: "复制当前路径", action: "copy-path" }] },
  { label: "视图", items: [{ label: "切换深色主题", action: "toggle-theme" }, { label: "打开开发者工具", action: "open-devtools" }, { label: "隐藏到托盘", action: "toggle-window" }, "separator", { label: "发送测试通知", action: "notify" }] },
  { label: "帮助", items: [{ label: "关于 StagePilot", action: "about" }, "separator", { label: "退出", action: "quit" }] },
];

const contextMenuItems = [
  { label: "切换深色主题", action: "toggle-theme", icon: Moon },
  { label: "打开开发工具", action: "open-devtools", icon: Terminal },
  "separator",
  { label: "关于 StagePilot", action: "about", icon: Info },
  { label: "退出", action: "quit", icon: Power },
];

function TitlebarMenuItems({ items, onAction, variant = "menubar" }) {
  const controls = variant === "menubar" ? {
    checkbox: MenubarCheckboxItem,
    content: MenubarContent,
    item: MenubarItem,
    radio: MenubarRadioItem,
    separator: MenubarSeparator,
    shortcut: MenubarShortcut,
    sub: MenubarSub,
    subContent: MenubarSubContent,
    subTrigger: MenubarSubTrigger,
  } : {
    checkbox: DropdownMenuCheckboxItem,
    content: DropdownMenuContent,
    item: DropdownMenuItem,
    radio: DropdownMenuRadioItem,
    separator: DropdownMenuSeparator,
    shortcut: DropdownMenuShortcut,
    sub: DropdownMenuSub,
    subContent: DropdownMenuSubContent,
    subTrigger: DropdownMenuSubTrigger,
  };
  const renderItem = (item, index) => {
    if (item === "separator" || item.type === "separator") return <controls.separator key={`sep-${index}`} />;
    const Icon = item.icon;
    const label = <>{Icon && <Icon />}<span>{item.label}</span>{item.shortcut && <controls.shortcut>{item.shortcut}</controls.shortcut>}</>;
    if (item.submenu) return <controls.sub key={item.label}><controls.subTrigger>{label}</controls.subTrigger><controls.subContent>{item.submenu.map(renderItem)}</controls.subContent></controls.sub>;
    if (item.type === "checkbox") return <controls.checkbox key={item.label} checked={item.checked} onCheckedChange={item.onCheckedChange}>{label}</controls.checkbox>;
    if (item.type === "radio") return <controls.radio key={item.label} value={item.value} disabled={item.disabled}>{label}</controls.radio>;
    return <controls.item key={item.action ?? item.label} disabled={item.disabled} data-variant={item.variant} onClick={() => item.action && onAction(item.action)}>{label}</controls.item>;
  };
  return items.map(renderItem);
}

function TitlebarMenuBar({ onAction }) {
  return <Menubar className="shrink-0">{menuBar.map((menu) => <MenubarMenu key={menu.label}><MenubarTrigger>{menu.label}</MenubarTrigger><MenubarContent><TitlebarMenuItems items={menu.items} onAction={onAction} /></MenubarContent></MenubarMenu>)}</Menubar>;
}

function TitlebarMainMenu({ onAction }) {
  return <DropdownMenu>
    <Tooltip>
      <TooltipTrigger render={<DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="主菜单"><Menu className="size-4" /></Button>} />} />
      <TooltipContent side="bottom" sideOffset={6}>主菜单</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" className="min-w-48">
      {menuBar.map((menu, index) => <DropdownMenuSub key={menu.label}><DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger><DropdownMenuSubContent className="min-w-48"><TitlebarMenuItems items={menu.items} onAction={onAction} variant="dropdown" /></DropdownMenuSubContent></DropdownMenuSub>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function useTitlebarLayout({ headerRef, leftControlsRef, fullMenuMeasureRef, compactMenuMeasureRef, rightControlsRef }) {
  const [layout, setLayout] = useState({ center: { inlineStart: 0, inlineSize: 0, visible: false }, menuMode: "full" });

  useLayoutEffect(() => {
    const header = headerRef.current;
    const leftControls = leftControlsRef.current;
    const fullMenu = fullMenuMeasureRef.current;
    const compactMenu = compactMenuMeasureRef.current;
    const rightControls = rightControlsRef.current;
    if (!header || !leftControls || !fullMenu || !compactMenu || !rightControls) return undefined;

    const update = () => {
      const headerRect = header.getBoundingClientRect();
      const leftRect = leftControls.getBoundingClientRect();
      const fullMenuRect = fullMenu.getBoundingClientRect();
      const compactMenuRect = compactMenu.getBoundingClientRect();
      const rightRect = rightControls.getBoundingClientRect();
      const actualMenuWidth = layout.menuMode === "full" ? fullMenuRect.width : compactMenuRect.width;
      const leftWithoutMenu = Math.max(0, leftRect.right - headerRect.left - actualMenuWidth);
      const fullCenter = resolveTitlebarCenterBounds({
        width: headerRect.width,
        leftEnd: leftWithoutMenu + fullMenuRect.width,
        rightStart: rightRect.left - headerRect.left,
      });
      const nextMode = resolveTitlebarMenuMode({ mode: layout.menuMode, fullMenuCenterWidth: fullCenter.inlineSize });
      const targetMenuWidth = nextMode === "full" ? fullMenuRect.width : compactMenuRect.width;
      const center = resolveTitlebarCenterBounds({
        width: headerRect.width,
        leftEnd: leftWithoutMenu + targetMenuWidth,
        rightStart: rightRect.left - headerRect.left,
      });
      setLayout((current) => current.menuMode === nextMode
        && current.center.inlineStart === center.inlineStart
        && current.center.inlineSize === center.inlineSize
        && current.center.visible === center.visible
        ? current
        : { menuMode: nextMode, center });
    };

    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    [header, leftControls, fullMenu, compactMenu, rightControls].forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [compactMenuMeasureRef, fullMenuMeasureRef, headerRef, layout.menuMode, leftControlsRef, rightControlsRef]);

  return layout;
}

function AppLoading() {
  return <main className="flex h-full min-h-0 items-center justify-center bg-muted/20 p-6"><div className="w-full max-w-2xl space-y-4"><div className="h-8 w-48 animate-pulse bg-muted" /><div className="h-4 w-80 animate-pulse bg-muted" /><div className="grid gap-4 md:grid-cols-2"><div className="h-36 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div><div className="h-48 animate-pulse bg-muted" /></div></main>;
}

function ProductionLocationsRouteRedirect({ workspace, production, direct = false }) {
  const navigate = useNavigate();
  useEffect(() => {
    const path = direct ? directProductionPath(production.id, "overview") : productionPath(workspace.id, production.id, "overview");
    navigate(`${path}?panel=locations`, { replace: true });
  }, [direct, navigate, production.id, workspace.id]);
  return <AppLoading />;
}

function UnauthenticatedHome({ onOpenAuth }) {
  return <main className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-xl"><CardHeader><CardTitle>欢迎来到 StagePilot</CardTitle><CardDescription>登录后即可管理演出活动、制作资源和团队工作空间。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3"><div className="border p-3">活动与制作流程</div><div className="border p-3">长期资源管理</div><div className="border p-3">团队协作空间</div></div><Button onClick={onOpenAuth}>登录或创建账号</Button></CardContent></Card></main>;
}

function RoutedMainShell({ authStatus, user, onUserUpdate, subscription, devtools, onDevtoolsChange, onRequireAuth, onOpenDocuments, onLogout, onNativeAction, isMaximized, onMinimize, onToggleMaximize, onHide }) {
  const { active: modalOpen } = useAppModalLayer();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    theme, detailOpenMode, contentWidth, showTitlebarTitle, titlebarTitleMode,
    sidebarRailEnabled, floatingActionExpandAtEnd, loading: preferencesLoading, updateTheme,
  } = useUserPreferences();
  const { pageHeaderVisible } = usePageChrome();
  const titlebarRef = useRef(null);
  const titlebarLeftControlsRef = useRef(null);
  const fullMenuMeasureRef = useRef(null);
  const compactMenuMeasureRef = useRef(null);
  const titlebarRightControlsRef = useRef(null);
  const titlebarLayout = useTitlebarLayout({
    headerRef: titlebarRef,
    leftControlsRef: titlebarLeftControlsRef,
    fullMenuMeasureRef,
    compactMenuMeasureRef,
    rightControlsRef: titlebarRightControlsRef,
  });
  const { status: workspaceStatus, workspaces, currentWorkspace, switchWorkspace, adoptCreatedWorkspace, refreshWorkspaces, error: workspaceError, retry: retryWorkspaces } = useWorkspaceContext();
  const { productionsByWorkspace, creationSession, loadProductions, repository, setProductionsByWorkspaceEntry, createCreationSession, updateCreationSession, discardCreationSession, getCreationSession } = useNavigationData();
  const navigationRepositoryRef = useRef(repository);
  const creationRequestRef = useRef(null);
  const creationRouteIdRef = useRef(null);
  const [creationRequestPending, setCreationRequestPending] = useState(false);
  navigationRepositoryRef.current = repository;
  const route = matchStagePilotRoute(location.pathname, location.search);
  const [directProductionState, setDirectProductionState] = useState({ id: "", loading: false, value: null, failed: false });
  const isWorkspacesRoute = location.pathname === "/workspaces";
  const isWorkRoute = route?.mode === "work";
  const shellLayout = resolveAppShellLayout(route);
  const isInviteRoute = route?.mode === "invite";
  const isAccountRoute = route?.mode === "account";
  const accountReturnPath = isAccountRoute ? resolveAccountReturnTarget(location.search, currentWorkspace ? workspacePath(currentWorkspace.id) : "/workspaces") : null;
  const accountReturnRoute = accountReturnPath ? matchStagePilotRoute(accountReturnPath.split("?")[0]) : null;
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [joinInvitationOpen, setJoinInvitationOpen] = useState(false);
  const [recentContexts, setRecentContexts] = useState([]);
  const recentContextAccountKey = user?.id || user?.email || "anonymous";
  useEffect(() => {
    let active = true;
    if (authStatus !== "authenticated") { setRecentContexts([]); return undefined; }
    getRecentContexts(recentContextAccountKey).then((items) => { if (active) setRecentContexts(items); });
    return () => { active = false; };
  }, [authStatus, recentContextAccountKey]);
  const rememberContext = useCallback(async (context) => {
    const next = await saveRecentContext(recentContextAccountKey, { ...context, lastOpenedAt: Date.now() });
    setRecentContexts(next);
  }, [recentContextAccountKey]);
  const workspace = route?.direct && directProductionState.value ? { id: directProductionState.value.workspaceId, name: directProductionState.value.workspaceName, role: directProductionState.value.workspaceRole, plan: "活动协作者", workspaceNavigable: directProductionState.value.workspaceNavigable } : (route ? workspaces.find((item) => item.id === route.workspaceId) : null);
  // Direct production routes load the activity independently and do not have
  // a workspace cache key. They must not be blocked by the workspace list gate.
  const productionsLoaded = route?.direct ? true : route ? Object.prototype.hasOwnProperty.call(productionsByWorkspace, route.workspaceId) : false;
  const remoteProductions = route ? productionsByWorkspace[route.workspaceId] ?? [] : [];
  const productions = remoteProductions;
  const isProductionRoute = route?.mode === "production";
  useEffect(() => {
    if (!route?.direct || authStatus !== "authenticated") return undefined;
    let active = true;
    setDirectProductionState({ id: route.productionId, loading: true, value: null, failed: false });
    getAccessibleProduction(route.productionId).then((value) => {
      if (active) setDirectProductionState({ id: route.productionId, loading: false, value: toProductionSummary(value), failed: false });
    }).catch(() => { if (active) setDirectProductionState({ id: route.productionId, loading: false, value: null, failed: true }); });
    return () => { active = false; };
  }, [authStatus, route?.direct, route?.productionId]);
  // Production Context：依附 currentWorkspace/route.workspaceId；
  // 深链恢复时由 productionDetail 单独加载，绝不出现父子和 URL 不一致的状态。
  const creationRoute = Boolean(isProductionRoute && creationSession?.id === route.productionId && creationSession.workspaceId === route.workspaceId);
  const isCreationSessionRoute = Boolean(isProductionRoute && route.productionId?.startsWith("creation-session-"));
  if (creationRoute) creationRouteIdRef.current = creationSession.id;
  const productionFromList = isProductionRoute ? productions.find((item) => item.id === route.productionId) : null;
  const productionRouteKey = isProductionRoute ? `${route.workspaceId}:${route.productionId}` : null;
  const productionDeepLink = Boolean(isProductionRoute && workspace && productionsLoaded && !productionFromList && !creationRoute && !isCreationSessionRoute);
  const [productionDetail, setProductionDetail] = useState({ key: null, loading: false, production: null, failed: false });
  const [productionError, setProductionError] = useState(null);
  const routeProductionDetail = productionDetail.key === productionRouteKey ? productionDetail : null;
  const productionDetailLoading = Boolean(productionDeepLink && (!routeProductionDetail || routeProductionDetail.loading));

  useEffect(() => {
    if (!productionDeepLink) {
      if (!productionRouteKey) setProductionDetail((current) => current.key === null ? current : { key: null, loading: false, production: null, failed: false });
      return undefined;
    }
    const requestKey = productionRouteKey;
    let active = true;
    setProductionDetail({ key: requestKey, loading: true, production: null, failed: false });
    const repository = navigationRepositoryRef.current;
    (async () => {
      try {
        const found = await repository.getProduction(route.workspaceId, route.productionId);
        if (!active) return;
        if (!found) {
          setProductionDetail({ key: requestKey, loading: false, production: null, failed: true });
          return;
        }
        setProductionDetail({ key: requestKey, loading: false, production: found, failed: false });
        setProductionsByWorkspaceEntry(route.workspaceId, found);
      } catch {
        if (active) setProductionDetail({ key: requestKey, loading: false, production: null, failed: true });
      }
    })();
    return () => { active = false; };
  }, [productionDeepLink, productionRouteKey, route?.workspaceId, route?.productionId, setProductionsByWorkspaceEntry]);
  const production = route?.direct ? directProductionState.value : (productionFromList || (creationRoute ? creationSession : null) || (productionDeepLink && routeProductionDetail && !routeProductionDetail.loading && !routeProductionDetail.failed ? routeProductionDetail.production : null));
  const productionUnavailable = Boolean(productionDeepLink && routeProductionDetail && !routeProductionDetail.loading && routeProductionDetail.failed);
  const creationSessionExpired = Boolean(isCreationSessionRoute && !creationRoute);

  useEffect(() => {
    if (authStatus !== "authenticated" || !route || !workspace) return;
    if (route.mode === "production" && production && !production.isCreationSession) {
      void rememberContext({ type: "production", id: production.id, name: production.name, path: route.direct ? directProductionPath(production.id) : productionPath(workspace.id, production.id), workspaceId: workspace.id, workspaceName: workspace.name });
      return;
    }
    if (route.mode === "workspace") {
      void rememberContext({ type: "workspace", id: workspace.id, name: workspace.name, path: workspacePath(workspace.id) });
    }
  }, [authStatus, location.pathname, production, rememberContext, route?.mode, route?.workspaceId, workspace]);

  useEffect(() => {
    setProductionError(null);
  }, [route?.workspaceId]);

  useEffect(() => {
    if (!creationSession || !creationRouteIdRef.current || creationRoute || creationRequestPending) return;
    discardCreationSession(creationSession.id);
    creationRouteIdRef.current = null;
  }, [creationRoute, creationRequestPending, creationSession, discardCreationSession]);

  useEffect(() => {
    if (authStatus !== "authenticated" && creationSession) {
      discardCreationSession(creationSession.id);
      creationRouteIdRef.current = null;
    }
  }, [authStatus, creationSession, discardCreationSession]);

  const refreshProductions = useCallback(async () => {
    if (!route?.workspaceId || !workspace) return;
    setProductionError(null);
    try { await loadProductions(route.workspaceId, { force: true }); }
    catch (nextError) { setProductionError(nextError instanceof Error ? nextError : new Error(String(nextError))); }
  }, [loadProductions, route?.workspaceId, workspace]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !route?.workspaceId || !workspace || productionsLoaded) return;
    loadProductions(route.workspaceId).catch((nextError) => setProductionError(nextError instanceof Error ? nextError : new Error(String(nextError))));
  }, [authStatus, loadProductions, productionsLoaded, route?.workspaceId, workspace]);

  // 合并下拉：每个工作空间活动预览的按需加载状态（行内呈现，不进全局错误页）。
  const [productionLoadStates, setProductionLoadStates] = useState({});
  const reloadProductionsForMenu = useCallback(async (targetWorkspaceId, { force = false } = {}) => {
    if (!targetWorkspaceId) return;
    setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "loading" }));
    try {
      await loadProductions(targetWorkspaceId, { force });
      setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "ready" }));
    } catch {
      setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "error" }));
    }
  }, [loadProductions]);

  // 登录后的工作空间生命周期：
  // - 无工作空间 → /workspaces onboarding（AC-01）
  // - 有可恢复/唯一的当前工作空间 → 自动进入
  // - 多个工作空间且无可恢复记录 → /workspaces selector
  useEffect(() => {
    if (authStatus !== "authenticated" || workspaceStatus === "loading") return;
    if (isAccountRoute || isWorkRoute || isInviteRoute || route?.direct) return;
    if (location.pathname !== "/") {
      if ((workspaceStatus === "none") || (workspaceStatus === "selecting")) navigate("/workspaces", { replace: true });
      return;
    }
    if (workspaceStatus === "none" || workspaceStatus === "selecting") navigate("/workspaces", { replace: true });
    else if (workspaceStatus === "ready" && currentWorkspace) navigate(workspacePath(currentWorkspace.id), { replace: true });
  }, [authStatus, workspaceStatus, currentWorkspace, location.pathname, navigate, isAccountRoute, isWorkRoute, isInviteRoute, route?.direct]);

  // 已登录状态下访问 /w/:id/* 且 id 不在可访问列表时，渲染不可访问页面。
  const workspaceForbidden = Boolean(route && !route.direct && authStatus === "authenticated" && workspaceStatus === "ready" && !workspace);

  const changeWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace || nextWorkspace.id === workspace?.id) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    try {
      await switchWorkspace(nextWorkspace.id);
      if (creationSession) discardCreationSession(creationSession.id);
      navigate(workspacePath(nextWorkspace.id));
      notify.info(`已切换到 ${nextWorkspace.name}`);
    } catch (nextError) { notify.error("无法切换工作空间", { description: String(nextError) }); }
  };

  // 合并下拉的动作集：进入工作台 / 打开活动（必要时先切空间）/ 查看全部活动。
  const enterWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (nextWorkspace.id === workspace?.id) {
      if (creationSession) discardCreationSession(creationSession.id);
      navigate(workspacePath(nextWorkspace.id), { replace: Boolean(creationSession) });
      return;
    }
    await changeWorkspace(nextWorkspace);
  };

  const openProduction = async (targetWorkspace, nextProduction) => {
    if (!targetWorkspace || !nextProduction || nextProduction.isCreationSession) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
    if (targetWorkspace.id !== workspace?.id) {
      try {
        await switchWorkspace(targetWorkspace.id);
      } catch (nextError) {
        notify.error("无法切换工作空间", { description: String(nextError) });
        return;
      }
    }
    navigate(productionPath(targetWorkspace.id, nextProduction.id));
    if (targetWorkspace.id !== workspace?.id) notify.info(`已切换到 ${targetWorkspace.name}`);
  };

  const openRecentContext = async (item) => {
    if (!item?.path) return;
    if (creationRequestPending && creationSession) { notify.info("正在创建活动，请稍候"); return; }
    if (item.workspaceId && item.workspaceId !== workspace?.id) {
      try { await switchWorkspace(item.workspaceId); }
      catch (nextError) { notify.error("无法切换工作空间", { description: String(nextError) }); return; }
    }
    if (creationSession) discardCreationSession(creationSession.id);
    navigate(item.path);
  };

  const viewAllProductions = async (targetWorkspace) => {
    if (!targetWorkspace) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
    if (targetWorkspace.id !== workspace?.id) {
      try {
        await switchWorkspace(targetWorkspace.id);
      } catch (nextError) {
        notify.error("无法切换工作空间", { description: String(nextError) });
        return;
      }
    }
    navigate(workspacePath(targetWorkspace.id, "productions"));
    if (targetWorkspace.id !== workspace?.id) notify.info(`已切换到 ${targetWorkspace.name}`);
  };

  const createCreation = () => {
    if (!workspace) return null;
    const session = createCreationSession(workspace.id);
    if (session && route?.mode !== "production") navigate(productionPath(workspace.id, session.id));
    return session;
  };
  const createCreationFromHome = () => {
    createCreation();
  };
  const openWorkspaceProductions = () => navigate(workspacePath(workspace.id, "productions"));
  const openWorkspaceCalendar = () => navigate(workspacePath(workspace.id, "calendar"));
  const updateProductionData = async (patch) => {
    if (!workspace || !production) return false;
    const next = { ...production, ...patch };
    if (next.plannedStartAt && next.plannedEndAt && new Date(next.plannedEndAt) < new Date(next.plannedStartAt)) {
      notify.error("无法保存活动信息", { description: "结束时间不能早于开始时间。" });
      return { ok: false, message: "结束时间不能早于开始时间。" };
    }
    const hasMeaningfulInfo = Boolean(
      (next.name?.trim() && next.name.trim() !== (next.defaultName || "活动-0")) ||
      next.plannedStartAt || next.plannedEndAt || next.description?.trim() ||
      (next.timezone && next.timezone !== "Asia/Shanghai"),
    );
    try {
      if (production.isCreationSession) {
        if (!hasMeaningfulInfo) {
          updateCreationSession(production.id, patch);
          return true;
        }
        // 失焦事件可能在请求已经开始后继续到达；保留它们，创建完成后再作为正式活动修改提交。
        if (creationRequestRef.current) {
          updateCreationSession(production.id, patch);
          return creationRequestRef.current;
        }
        const latest = updateCreationSession(production.id, patch) || { ...production, ...patch };
        setCreationRequestPending(true);
        const request = (async () => {
          try {
            const created = await createProduction(workspace.id, {
              name: latest.name?.trim() || production.name, description: latest.description?.trim() || "", timezone: latest.timezone || "Asia/Shanghai",
              plannedStartAt: latest.plannedStartAt || null, plannedEndAt: latest.plannedEndAt || null,
            });
            const latestSession = getCreationSession() || latest;
            const summary = toProductionSummary(created);
            setProductionsByWorkspaceEntry(workspace.id, summary);
            discardCreationSession(production.id);
            creationRouteIdRef.current = null;
            navigate(productionPath(workspace.id, created.id, "overview"), { replace: true });
            notify.success("活动已创建", { description: "基础信息已保存，活动导航已解锁。" });
            return true;
          } catch (nextError) {
            notify.error("无法创建活动", { description: nextError instanceof Error ? nextError.message : String(nextError) });
            return { ok: false, error: nextError };
          } finally {
            creationRequestRef.current = null;
            setCreationRequestPending(false);
          }
        })();
        creationRequestRef.current = request;
        return request;
      }
      const body = {};
      if (Object.prototype.hasOwnProperty.call(patch, "name")) body.name = String(patch.name).trim();
      if (Object.prototype.hasOwnProperty.call(patch, "description")) body.description = String(patch.description ?? "").trim();
      if (Object.prototype.hasOwnProperty.call(patch, "timezone")) body.timezone = patch.timezone;
      if (Object.prototype.hasOwnProperty.call(patch, "timezoneChangeStrategy")) body.timezone_change_strategy = patch.timezoneChangeStrategy;
      if (Object.prototype.hasOwnProperty.call(patch, "plannedStartAt")) body.planned_start_at = patch.plannedStartAt || null;
      if (Object.prototype.hasOwnProperty.call(patch, "plannedEndAt")) body.planned_end_at = patch.plannedEndAt || null;
      if (!Object.keys(body).length) {
        return true;
      }
      const updated = route?.direct ? await updateAccessibleProduction(production.id, body) : await updateProduction(workspace.id, production.id, body);
      const summary = toProductionSummary(updated);
      if (route?.direct) setDirectProductionState({ id: production.id, loading: false, value: summary, failed: false });
      else setProductionsByWorkspaceEntry(workspace.id, summary);
      notify.success("活动信息已保存");
      return true;
    } catch (nextError) {
      notify.error("无法保存活动信息", { description: nextError instanceof Error ? nextError.message : String(nextError) });
      return { ok: false, error: nextError };
    }
  };
  const updateProductionSettings = async (patch) => {
    if (!workspace || !production || production.isCreationSession) throw new Error("创建会话只能在活动概览中完善基础信息。");
    const updated = route?.direct ? await updateAccessibleProduction(production.id, patch) : await updateProduction(workspace.id, production.id, patch);
    const summary = toProductionSummary(updated);
    setProductionsByWorkspaceEntry(workspace.id, summary);
    return summary;
  };
  const leaveCreationSession = () => {
    if (!workspace || !production?.isCreationSession) return;
    if (creationRequestRef.current) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    discardCreationSession(production.id);
    creationRouteIdRef.current = null;
    navigate(workspacePath(workspace.id, "productions"), { replace: true });
  };
  const accountReturnProduction = accountReturnRoute?.mode === "production"
    ? (productionsByWorkspace[accountReturnRoute.workspaceId] ?? []).find((item) => item.id === accountReturnRoute.productionId)
    : null;
  const accountReturnWorkspace = accountReturnRoute?.workspaceId ? workspaces.find((item) => item.id === accountReturnRoute.workspaceId) : currentWorkspace;
  const accountReturnLabel = accountReturnProduction
    ? `返回活动：${accountReturnProduction.name}`
    : accountReturnRoute?.mode === "production" ? "返回活动" : `返回工作空间：${accountReturnWorkspace?.name || "工作空间"}`;
  const navigateAccount = useCallback((view = "profile", developerAction) => {
    if (creationRequestRef.current && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    const from = isAccountRoute
      ? accountReturnPath
      : (creationSession ? workspacePath(creationSession.workspaceId, "productions") : `${location.pathname}${location.search}`);
    if (creationSession) discardCreationSession(creationSession.id);
    const action = developerAction ? `&action=${encodeURIComponent(developerAction)}` : "";
    navigate(`${accountPath(view, from)}${action}`);
  }, [accountReturnPath, creationRequestPending, creationSession, discardCreationSession, isAccountRoute, location.pathname, location.search, navigate]);
  const handleShellLogout = useCallback(() => {
    if (creationRequestRef.current && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
    onLogout();
  }, [creationRequestPending, creationSession, discardCreationSession, onLogout]);
  const handleShellNativeAction = useCallback((action) => {
    if (developerActions.has(action)) {
      if (import.meta.env.DEV) navigateAccount("developer", action);
      else notify.message("此功能仅在开发构建中提供");
      return;
    }
    onNativeAction(action);
  }, [navigateAccount, onNativeAction]);
  const handleGlobalSearch = useCallback(() => {
    notify.message("全局搜索将在数据服务接入后开放", { description: "计划快捷键：Ctrl / Cmd + K" });
  }, []);
  useEffect(() => {
    const onWindowAction = (event) => handleShellNativeAction(event.detail);
    window.addEventListener("stagepilot-native-action", onWindowAction);
    if (!isTauriRuntime) return () => window.removeEventListener("stagepilot-native-action", onWindowAction);
    let cleanup;
    listen("native-action", (event) => handleShellNativeAction(event.payload)).then((next) => { cleanup = next; });
    return () => { cleanup?.(); window.removeEventListener("stagepilot-native-action", onWindowAction); };
  }, [handleShellNativeAction]);
  useEffect(() => {
    const toggleTheme = () => updateTheme(theme === "dark" ? "light" : "dark").catch(() => {});
    window.addEventListener("stagepilot-toggle-theme", toggleTheme);
    return () => window.removeEventListener("stagepilot-toggle-theme", toggleTheme);
  }, [theme, updateTheme]);
  const pageTitle = titlebarTitleMode === "app" ? "StagePilot" : route?.meta.title ?? "StagePilot";
  const titlebarBreadcrumbItems = buildBreadcrumbItems({ route, workspace, production });

  let content;
  if (route?.mode === "public-program-sheet") content = <PublicProgramSheetPage token={route.token} onRequireAuth={onRequireAuth} />;
  else if (route?.mode === "public-campaign") content = <PublicCampaignFormPage token={route.token} short={route.short} />;
  else if (authStatus === "loading" || (authStatus === "authenticated" && (workspaceStatus === "loading" || preferencesLoading))) content = <AppLoading />;
  else if (route?.mode === "invite" && authStatus !== "authenticated") content = <InvitationAcceptPage code={route.code} authenticated={false} onRequireAuth={onRequireAuth} />;
  else if (authStatus !== "authenticated") content = <UnauthenticatedHome onOpenAuth={onRequireAuth} />;
  else if (isAccountRoute && route.page === "developer" && import.meta.env.DEV) content = <DeveloperTools workspace={workspace} devtools={devtools} onDevtoolsChange={onDevtoolsChange} contentWidth={contentWidth} initialAction={new URLSearchParams(location.search).get("action")} />;
  else if (isAccountRoute) content = <AccountCenter page={route.page} user={user} onUserUpdate={onUserUpdate} subscription={subscription} devtools={devtools} onDevtoolsChange={onDevtoolsChange} initialAction={new URLSearchParams(location.search).get("action")} backTo={accountReturnPath} backLabel={accountReturnLabel} />;
  else if (route?.mode === "invite") content = <InvitationAcceptPage code={route.code} />;
  else if (isWorkRoute) content = <UnifiedWorkContextPage initialTab={route.tab} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onEnterWorkspace={enterWorkspace} onJoinInvitation={() => setJoinInvitationOpen(true)} />;
  else if (isWorkspacesRoute) content = <WorkspacesPage onCreateWorkspace={() => setCreateWorkspaceOpen(true)} />;
  else if (workspaceError && !currentWorkspace) content = <NavigationFailure description={workspaceError.message} onRetry={retryWorkspaces} />;
  else if (location.pathname === "/") content = <AppLoading />;
  else if (!route) content = <NavigationFailure title="页面不存在" description="这个 StagePilot 页面地址无效或已经移动。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (route.direct && directProductionState.loading) content = <AppLoading />;
  else if (route.direct && directProductionState.failed) content = <NavigationFailure title="活动不可访问" description="这场活动不存在，或你已没有访问权限。" homePath="/work?tab=participating" />;
  else if (workspaceForbidden) content = <NavigationFailure title="工作空间不可访问" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : (workspaces[0] ? workspacePath(workspaces[0].id) : undefined)} />;
  else if (!workspace) content = <NavigationFailure title="工作空间不存在" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (creationSessionExpired) content = <NavigationFailure title="创建会话已结束" description="这次创建内容尚未提交，离开或刷新后不会恢复。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionError) content = <NavigationFailure title="无法加载活动" description={productionError.message} onRetry={refreshProductions} homePath={workspacePath(workspace.id)} />;
  else if (productionUnavailable) content = <NavigationFailure title="活动不可访问" description="这场活动不存在、已归档，或者不属于当前工作空间。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionDeepLink && productionDetailLoading) content = <AppLoading />;
  else if (isProductionRoute && !productionsLoaded && !creationRoute) content = <AppLoading />;
  else if (isProductionRoute && !production) content = <NavigationFailure title="活动不可访问" description="这场活动不存在、已归档，或者不属于当前工作空间。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (route.mode === "workspace" && route.page === "home") content = <WorkspaceHome route={route} workspace={workspace} productions={productions} onCreate={createCreationFromHome} onViewProductions={openWorkspaceProductions} onOpenCalendar={openWorkspaceCalendar} />;
  else if (route.mode === "workspace" && route.page === "productions") content = <ProductionsPage route={route} workspace={workspace} productions={productions} loading={!productionsLoaded} onCreate={createCreation} />;
  else if (route.mode === "workspace" && route.page === "members") content = <WorkspaceMembersPage route={route} workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "roles") content = <WorkspaceRolesPage route={route} workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "templates") content = <WorkspaceTemplateLibraryPage route={route} workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "file-types") content = <FileTypeManagementPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "program-sheet-segment-types") content = <ProgramSheetSegmentTypeManagementPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "programs") content = <ProgramLibraryPage workspace={workspace} selectedResourceId={route.resourceId} panel={route.panel} />;
  else if (route.mode === "workspace" && ["people", "organizations", "venues", "equipment"].includes(route.page)) content = <WorkspaceResourcePage workspace={workspace} resourceType={route.page} selectedResourceId={route.resourceId} panel={route.panel} />;
  else if (route.mode === "workspace" && route.page === "settings") content = <WorkspaceSettingsPage workspaceId={workspace.id} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "forms-review") content = <WorkspaceFormsReviewSettingsPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "files") content = <FilesPage workspace={workspace} backTo={workspacePath(workspace.id, "home")} backLabel={workspace.name} />;
  else if (route.mode === "production" && route.page === "overview") content = <ProductionOverviewPage workspace={workspace} production={production} onUpdateProduction={updateProductionData} onLeaveCreation={leaveCreationSession} creationBusy={creationRequestPending} key={route.productionId} />;
  else if (route.mode === "production" && production?.isCreationSession) content = <NavigationFailure title="创建会话仅支持概览" description="提交第一个有效字段后，活动的其他模块会自动开放。" homePath={productionPath(workspace.id, production.id, "overview")} />;
  else if (route.mode === "production" && route.page === "activity-info") content = <ProductionActivityInfoPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "form-templates") content = <ProductionFormTemplatesPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "forms" && route.campaignId) content = <ProductionCampaignDetailPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "forms") content = <ProductionFormsPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "recruitment") content = <ProductionFormsPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "collection-workflows") content = <ProductionCollectionWorkflowsPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "program-sheets") content = <ProgramSheetsPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "programs") content = <ProductionProgramsPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && ["schedule", "occurrences", "rehearsals"].includes(route.page)) content = <ProductionPlanningPlaceholderPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "settings") content = <ProductionSettingsPage workspace={workspace} production={production} onUpdateProduction={updateProductionSettings} key={production.id} />;
  else if (route.mode === "production" && route.page === "locations") content = <ProductionLocationsRouteRedirect workspace={workspace} production={production} direct={route.direct} />;
  else if (route.mode === "production" && route.page === "members") content = <ProductionMembersPage route={route} workspace={workspace} production={production} key={production.id} />;
  else if (route.mode === "production" && route.page === "roles") content = <ProductionRolesPage workspace={workspace} production={production} key={production.id} />;
  else if (route.mode === "production" && route.page === "files") content = <FilesPage workspace={workspace} production={production} productionId={route.productionId} title="活动文件" backTo={route.direct ? directProductionPath(production.id, "overview") : productionPath(workspace.id, production.id, "overview")} backLabel="活动概览" key={route.productionId} />;
  else content = <PlaceholderPage route={route} workspace={workspace} production={production} />;

  const resourceDetailLayout = route?.mode === "workspace" && ["programs", "people", "organizations", "venues", "equipment"].includes(route?.page);
  const planningDetailLayout = route?.mode === "production" && ["schedule", "occurrences", "rehearsals", "programs", "program-sheets"].includes(route?.page);
  const productionLocationDetailLayout = route?.mode === "production" && ["overview", "settings"].includes(route?.page);
  const collectionDetailLayout = route?.mode === "production" && route?.page === "forms" && Boolean(route?.campaignId);
  const membersDetailLayout = (route?.mode === "workspace" && route?.page === "members") || (route?.mode === "production" && route?.page === "members");
  const contentLayout = resourceDetailLayout || planningDetailLayout || productionLocationDetailLayout || collectionDetailLayout || membersDetailLayout || (isAccountRoute && route?.page === "developer" && import.meta.env.DEV) ? "workspace" : "document";

  const handleWorkspaceCreated = async (created) => {
    await adoptCreatedWorkspace(created);
    navigate(workspacePath(created.id), { replace: true });
  };

  const handleInvitationAccepted = async (result) => {
    if (result?.scope_kind === "workspace" && result.workspace_id) {
      await refreshWorkspaces?.();
      navigate(workspacePath(result.workspace_id), { replace: true });
    } else if (result?.production_id) {
      navigate(directProductionPath(result.production_id), { replace: true });
    }
  };

  // 创建会话需要保留 Production Context 的返回入口和禁用导航，
  // 但它从未加入 productionsByWorkspace，因此不会出现在正式活动预览中。
  const sidebarProduction = production;
  const navigationLoading = authStatus === "loading" || (authStatus === "authenticated" && workspaceStatus === "loading" && !workspace && !isWorkRoute && !isAccountRoute && !isInviteRoute);
  const utilityBarProps = {
    user,
    subscription,
    onOpenSearch: handleGlobalSearch,
    onOpenDocuments,
    onOpenAccountCenter: navigateAccount,
    onLogout: handleShellLogout,
    onRequireAuth,
  };
  if (route?.mode === "public-program-sheet") return <div className="min-h-svh bg-background">{content}</div>;
  if (route?.mode === "public-campaign") return <div className="min-h-svh bg-background">{content}</div>;
  return <OverlayAvoidanceProvider><WindowDetailProvider contentWidth={contentWidth} detailOpenMode={detailOpenMode}><SidebarProvider desktopOnly className="min-h-0 min-w-0 flex h-svh flex-col" defaultOpen><div className="app-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header ref={titlebarRef} className="titlebar-content relative z-30 flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b bg-background pl-2">
      <div aria-hidden="true" className="absolute inset-0" data-tauri-drag-region />
      <div ref={titlebarLeftControlsRef} className={cn("relative z-20 flex min-w-0 shrink-0 items-center gap-1", isMac && "pl-[68px]")}>
        {titlebarLayout.menuMode === "compact" ? <TitlebarMainMenu onAction={handleShellNativeAction} /> : <TitlebarMenuBar onAction={handleShellNativeAction} />}
        {shellLayout.showSidebarTrigger && <SidebarTrigger className="shrink-0" />}
      </div>
      <div aria-hidden="true" inert="" className="pointer-events-none absolute -left-[10000px] top-0 flex h-[var(--app-titlebar-height)] items-center opacity-0">
        <div ref={fullMenuMeasureRef}><TitlebarMenuBar onAction={handleShellNativeAction} /></div>
        <div ref={compactMenuMeasureRef}><Button type="button" variant="ghost" size="icon-sm"><Menu className="size-4" /></Button></div>
      </div>
      <TitlebarBreadcrumbs
        available={titlebarLayout.center.visible}
        bounds={titlebarLayout.center}
        items={titlebarBreadcrumbItems}
        pageTitle={pageTitle}
        showTitle={showTitlebarTitle}
        pageHeaderVisible={pageHeaderVisible}
        titlebarTitleMode={titlebarTitleMode}
      />
      <div ref={titlebarRightControlsRef} className="relative z-20 ml-auto flex h-full shrink-0 items-center">
        <PageDetailTitlebarAction />
        {isWindows && <div className="flex h-full shrink-0"><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onMinimize}><Minus className="size-3" /></Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onToggleMaximize}>{isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}</Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px] hover:bg-destructive/15 hover:text-destructive" onClick={onHide}><X /></Button></div>}
      </div>
    </header>
    <div className="flex min-h-0 min-w-0 flex-1" inert={modalOpen ? "" : undefined}>{shellLayout.showSidebar && <AppSidebar navigationLoading={navigationLoading} route={route} workspace={workspace} production={sidebarProduction} recentContexts={recentContexts} onOpenRecentContext={openRecentContext} workspaceSelectionMode={isWorkspacesRoute} railEnabled={sidebarRailEnabled} accountReturnPath={accountReturnPath} accountReturnLabel={accountReturnLabel} onLeaveCreation={leaveCreationSession} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onJoinInvitation={() => setJoinInvitationOpen(true)} onManageWorkspaces={() => { if (creationRequestPending && creationSession) { notify.info("正在创建活动，请稍候"); return; } if (creationSession) discardCreationSession(creationSession.id); navigate("/work"); }} {...utilityBarProps} />}<SidebarInset className="min-h-0 min-w-0 overflow-hidden"><WindowDetailHost><AppContentLayout mode={contentLayout} contentWidth={contentWidth} floatingActionExpandAtEnd={floatingActionExpandAtEnd} bottomBar={shellLayout.showGlobalUtilityBar ? <GlobalUtilityBar variant="bottom" {...utilityBarProps} /> : null}>{content}</AppContentLayout></WindowDetailHost></SidebarInset></div>
   </div><CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} onCreated={handleWorkspaceCreated} /><JoinInvitationDialog open={joinInvitationOpen} onOpenChange={setJoinInvitationOpen} onAccepted={handleInvitationAccepted} /><AppSonner sidebarVisible={shellLayout.toastSidebarVisible} bottomOffset={shellLayout.toastBottomOffset} /></SidebarProvider></WindowDetailProvider></OverlayAvoidanceProvider>;
}

function SafeRoutedMainShell({ authDialogOpen, onAuthDialogChange, onLogin, onRegister, aboutOpen, onAboutOpenChange, ...props }) {
  const location = useLocation();
  const route = matchStagePilotRoute(location.pathname, location.search);
  const titlebarVisible = route?.mode !== "public-program-sheet" && route?.mode !== "public-campaign";
  return <AppModalLayerProvider titlebarVisible={titlebarVisible}>
    <PageChromeProvider><AppErrorBoundary resetKey={`${location.pathname}${location.search}`}><RoutedMainShell {...props} /></AppErrorBoundary></PageChromeProvider>
    <AuthDialog open={authDialogOpen} onOpenChange={onAuthDialogChange} onLogin={onLogin} onRegister={onRegister} />
    <Dialog open={aboutOpen} onOpenChange={onAboutOpenChange}><DialogContent size="sm"><DialogHeader><DialogTitle>StagePilot</DialogTitle><DialogDescription>多租户演艺活动运营平台。</DialogDescription></DialogHeader><DialogBody><p className="text-sm text-muted-foreground">Workspace 沉淀长期资产，Production 组织筹备与现场执行。</p></DialogBody></DialogContent></Dialog>
  </AppModalLayerProvider>;
}

function MainApp() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [devtools, setDevtools] = useState(true);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const hideWindow = async () => { try { await getCurrentWindow().hide(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const minimizeWindow = async () => { try { await getCurrentWindow().minimize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const toggleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const openDocuments = async () => { try { await openUrl(documentationUrl); notify.success("已打开帮助文档"); } catch (error) { notify.error("无法打开文档", { description: String(error) }); } };

  const handleNativeAction = useCallback(async (action) => {
    if (developerActions.has(action)) {
      window.dispatchEvent(new CustomEvent("stagepilot-native-action", { detail: action }));
      return;
    }
    if (action === "toggle-theme") window.dispatchEvent(new Event("stagepilot-toggle-theme"));
    if (action === "about") setAboutOpen(true);
    if (action === "toggle-window") await hideWindow();
    if (action === "quit") await invoke("quit_app");
  }, []);

  const handleLogin = async (email, password) => { const nextUser = await loginAccount(email, password); setUser(nextUser); setAuthStatus("authenticated"); setAuthDialogOpen(false); };
  const handleRegister = async (email, password) => { const result = await registerAccount(email, password); setUser(result.user); setAuthStatus("authenticated"); setAuthDialogOpen(false); return result; };
  const handleLogout = async () => { const result = await logoutAccount(); setUser(null); setAuthStatus("signed_out"); setAuthDialogOpen(true); if (result.remotelyRevoked) notify.success("已退出登录"); else notify.warning("已清除本机登录信息", { description: "无法连接服务端，会话会在到期后失效。" }); };

  useEffect(() => onSessionInvalidated(({ reason }) => {
    setUser(null);
    setAuthStatus("signed_out");
    setAuthDialogOpen(true);
    if (reason === "refresh_failed") notify.error("登录状态已失效", { description: "请重新登录后继续。" });
  }), []);

  useEffect(() => { (async () => { try { await appStore.init(); const [savedDevtools, savedSubscription, restoredUser] = await Promise.all([appStore.get("devtools"), appStore.get("subscription"), restoreSession()]); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); setUser(restoredUser); setAuthStatus(restoredUser ? "authenticated" : "signed_out"); setAuthDialogOpen(!restoredUser); } catch { setAuthStatus("signed_out"); setAuthDialogOpen(true); } })(); }, []);

  useEffect(() => { if (!isWindows) return; let unlisten; (async () => { try { const win = getCurrentWindow(); setIsMaximized(await win.isMaximized()); unlisten = await win.onResized(() => win.isMaximized().then(setIsMaximized).catch(() => {})); } catch {} })(); return () => unlisten?.(); }, []);
  useEffect(() => { const suppress = (event) => event.preventDefault(); document.addEventListener("contextmenu", suppress); return () => document.removeEventListener("contextmenu", suppress); }, []);

  const handleDevtoolsChange = async (checked) => { setDevtools(checked); await appStore.set("devtools", checked); if (isTauriRuntime && checked) { try { await invoke("set_devtools", { enabled: true }); } catch {} } notify.message(checked ? "开发者工具已开启" : "开发者工具已关闭"); };
 return <TooltipProvider><ContextMenu><ContextMenuTrigger className="contents select-text"><HashRouter><UserPreferencesProvider authStatus={authStatus} user={user}><NavigationProvider authStatus={authStatus}><WorkspaceProvider authStatus={authStatus}><SafeRoutedMainShell authStatus={authStatus} user={user} onUserUpdate={setUser} subscription={subscription} devtools={devtools} onDevtoolsChange={handleDevtoolsChange} onRequireAuth={() => setAuthDialogOpen(true)} onOpenDocuments={openDocuments} onLogout={handleLogout} onNativeAction={handleNativeAction} isMaximized={isMaximized} onMinimize={minimizeWindow} onToggleMaximize={toggleMaximize} onHide={hideWindow} authDialogOpen={authDialogOpen} onAuthDialogChange={setAuthDialogOpen} onLogin={handleLogin} onRegister={handleRegister} aboutOpen={aboutOpen} onAboutOpenChange={setAboutOpen} /></WorkspaceProvider></NavigationProvider></UserPreferencesProvider></HashRouter></ContextMenuTrigger><ContextMenuContent className="min-w-48">{contextMenuItems.map((item, index) => item === "separator" ? <ContextMenuSeparator key={`sep-${index}`} /> : <ContextMenuItem key={item.action} onClick={() => handleNativeAction(item.action)}><item.icon /><span>{item.label}</span></ContextMenuItem>)}</ContextMenuContent></ContextMenu></TooltipProvider>;
}

function App() { return <MainApp />; }

export default App;
